/**
 * Demo driver. Layer 1 uses the real gitleaks binary and the bundled CLI in a temporary git
 * repository. Layer 3 runs the real webhook handler against fake AWS clients. The "key" is random
 * text shaped like an AWS access key id, generated at run time: it is not a credential and is only
 * ever shown masked.
 */
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { green, header, readAuditRecords, red, runStages, seededRandom } from '@adl/shared';
import { loadGuardConfig } from '../src/lambda/config.ts';
import { createHandler } from '../src/lambda/handler.ts';
import type { Ports } from '../src/lambda/ports.ts';
import { sign } from '../src/lambda/signature.ts';
import { computeMetrics, formatMetrics } from '../src/metrics.ts';
import type { LeakAuditEntry } from '../src/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const piece = join(here, '..');
const out = join(here, 'out');
const repo = join(out, 'repo');
const lambdaLog = join(out, 'lambda.audit.jsonl');
const precommitLog = join(repo, '.git', 'secrets-guard.audit.jsonl');

/** AKIA plus 16 random base32 characters. Deterministic, random-looking, not a real credential. */
function fakeKey(seed: number): string {
  const rand = seededRandom(seed);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  return `AKIA${Array.from({ length: 16 }, () => alphabet[Math.floor(rand() * 32)]).join('')}`;
}
const mask = (key: string) => `${key.slice(0, 4)}${'*'.repeat(12)}${key.slice(-4)}`;
const FILE_KEY = fakeKey(1);

const git = (args: string[]) =>
  spawnSync('git', ['-c', 'user.name=demo', '-c', 'user.email=demo@example.invalid', ...args], {
    cwd: repo,
    encoding: 'utf8',
  });

function freshRepo(): void {
  rmSync(repo, { recursive: true, force: true });
  mkdirSync(repo, { recursive: true });
  git(['init', '-q']);
  writeFileSync(join(repo, 'config.env'), `AWS_ACCESS_KEY_ID=${FILE_KEY}\nREGION=eu-west-1\n`);
  copyFileSync(join(piece, 'templates', 'gitleaks.toml'), join(repo, '.gitleaks.toml'));
}

function before(): void {
  header('BEFORE: no guard');
  freshRepo();
  git(['add', 'config.env']);
  const res = git(['commit', '-q', '-m', 'add config']);
  console.log(`Staged config.env (AWS_ACCESS_KEY_ID=${mask(FILE_KEY)}) and ran: git commit`);
  console.log(
    res.status === 0
      ? red('The commit went through. The key is now in history.')
      : 'unexpected failure',
  );
}

function layer1(): void {
  header('LAYER 1: pre-commit hook');
  if (spawnSync('gitleaks', ['version']).status !== 0) {
    console.log(
      'gitleaks is not installed, so this layer is skipped. Install it: brew install gitleaks',
    );
    return;
  }
  freshRepo();
  const hook = join(repo, '.git', 'hooks', 'pre-commit');
  writeFileSync(
    hook,
    `#!/bin/sh\nexec node "${join(piece, 'dist', 'secrets-guard.mjs')}" precommit --config .gitleaks.toml\n`,
  );
  chmodSync(hook, 0o755);
  git(['add', 'config.env', '.gitleaks.toml']);
  const res = git(['commit', '-q', '-m', 'add config']);
  const text = `${res.stdout}${res.stderr}`
    .split('\n')
    .filter((l) => l.trim() && !l.includes('gitleaks_'));
  console.log(text.join('\n'));
  console.log(
    res.status === 0
      ? red('The commit went through.')
      : green('Commit blocked. Nothing entered history.'),
  );
  if (existsSync(precommitLog)) {
    console.log(
      '\nRecord written to .git/secrets-guard.audit.jsonl (rule ids and files, no value):',
    );
    console.log(`  ${readFileSync(precommitLog, 'utf8').trim().slice(0, 170)}...`);
  }
}

const SECRET = 'demo-webhook-secret-not-real';
const ACCOUNT = '111122223333';
const ALERT_AT = Date.parse('2026-02-01T10:00:00Z');
const USERS: Record<string, { name: string; path: string }> = {
  [fakeKey(11)]: { name: 'demo-user-1', path: '/secrets-guard-demo/' },
  [fakeKey(12)]: { name: 'demo-user-2', path: '/secrets-guard-demo/' },
  [fakeKey(13)]: { name: 'demo-user-3', path: '/secrets-guard-demo/' },
  [fakeKey(14)]: { name: 'prod-service', path: '/prod/' },
};

/** Steps: label, key seed, seconds after the alert, dry run, and whether to sign with a wrong secret. */
const STEPS: [string, number, number, boolean, boolean][] = [
  ['1. Wrong signature', 11, 1, false, true],
  ['2. Dry run (the default)', 11, 60, true, false],
  ['3. Dry run off, in-scope user', 11, 60, false, false],
  ['4. Another in-scope key', 12, 95, false, false],
  ['5. And another', 13, 140, false, false],
  ['6. A user outside the guarded path', 14, 30, false, false],
];

async function layer3(): Promise<void> {
  header('LAYER 3: webhook handler against fake AWS');
  mkdirSync(out, { recursive: true });
  const changes: string[] = [];
  const audit: LeakAuditEntry[] = [];
  let nowMs = ALERT_AT;
  const ports: Ports = {
    iam: {
      keyOwner: async (id) => USERS[id]?.name ?? null,
      userPath: async (name) => Object.values(USERS).find((u) => u.name === name)?.path ?? '/',
      deactivate: async (id, user) =>
        void changes.push(`UpdateAccessKey Inactive: ${user} (${mask(id)})`),
      tagUser: async (user) => void changes.push(`TagUser: ${user}`),
    },
    accountId: async () => ACCOUNT,
    notify: async (subject) => void changes.push(`SNS: ${subject}`),
    writeAudit: async (entry) => void audit.push(entry),
  };

  for (const [number, [label, seed, delay, dryRun, badSignature]] of STEPS.entries()) {
    nowMs = ALERT_AT + delay * 1000;
    const handler = createHandler({
      ports,
      config: loadGuardConfig({ DRY_RUN: String(dryRun), ALLOWED_ACCOUNT_IDS: ACCOUNT }),
      webhookSecret: async () => SECRET,
      now: () => new Date(nowMs),
    });
    const body = JSON.stringify({
      action: 'created',
      alert: {
        number: number + 1,
        created_at: new Date(ALERT_AT).toISOString(),
        secret: fakeKey(seed),
      },
      repository: { full_name: 'example-org/example-repo' },
    });
    changes.length = 0;
    const res = await handler({
      headers: {
        'x-github-event': 'secret_scanning_alert',
        'x-hub-signature-256': sign(badSignature ? 'wrong' : SECRET, body),
      },
      body,
    });
    const parsed = JSON.parse(res.body) as { decisions?: string[]; error?: string };
    console.log(
      `\n${label}\n  key ${mask(fakeKey(seed))}  ->  HTTP ${res.statusCode} ${parsed.decisions?.join(',') ?? parsed.error}`,
    );
    console.log(changes.length ? changes.map((c) => `  ${c}`).join('\n') : '  no AWS changes');
  }
  writeFileSync(lambdaLog, audit.map((e) => JSON.stringify(e)).join('\n') + '\n');
  console.log('\n(The delays between alert and action are simulated.)');
}

const lambdaEntries = (): LeakAuditEntry[] =>
  existsSync(lambdaLog) ? readAuditRecords<LeakAuditEntry>(lambdaLog) : [];

function after(): void {
  header('AFTER: the evidence');
  if (!existsSync(lambdaLog)) throw new Error('run the "run" stage first');
  for (const e of lambdaEntries()) {
    const secs =
      e.detail.leakToActionSeconds === undefined
        ? ''
        : `  ${e.detail.leakToActionSeconds}s after alert`;
    console.log(
      `${e.decision.padEnd(18)} alert ${String(e.detail.alertNumber).padEnd(3)} key ...${e.detail.keySuffix ?? '----'}${secs}`,
    );
  }
  const leaked = [lambdaLog, precommitLog]
    .filter(existsSync)
    .some((f) => /AKIA[A-Z2-7]{16}/.test(readFileSync(f, 'utf8')));
  console.log(
    leaked
      ? red('\nA key value was found in an audit file!')
      : green('\nNo key value appears in any audit file.'),
  );
}

function metric(): void {
  header('METRIC');
  const precommit = existsSync(precommitLog) ? readAuditRecords(precommitLog) : [];
  console.log(
    formatMetrics(
      'From the records just written (alert times simulated)',
      computeMetrics(precommit, lambdaEntries()),
    ),
  );
}

if (process.argv[2] === undefined || process.argv[2] === 'all')
  rmSync(out, { recursive: true, force: true });
process.exitCode = await runStages(
  { before, run: async () => (layer1(), layer3()), after, metric },
  process.argv[2],
);
