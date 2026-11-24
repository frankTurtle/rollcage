/**
 * Demo driver. Layer 1 uses the real gitleaks binary in a temporary git repository. Layer 3 runs the
 * real webhook handler against fake AWS clients. The "key" is random text shaped like an AWS access
 * key id, generated at run time: it is not a credential and is only ever shown masked.
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
import { readAuditRecords, seededRandom } from '@adl/shared';
import { computeMetrics, formatMetrics } from '../src/metrics.ts';
import { createHandler } from '../src/lambda/handler.ts';
import type { AuditEntry, Ports } from '../src/lambda/ports.ts';
import { sign } from '../src/lambda/signature.ts';
import { loadGuardConfig } from '../src/lambda/config.ts';

const here = dirname(fileURLToPath(import.meta.url));
const piece = join(here, '..');
const out = join(here, 'out');
const repo = join(out, 'repo');
const lambdaLog = join(out, 'lambda.audit.jsonl');
const tty = process.stdout.isTTY;
const bold = (t: string) => (tty ? `\u001b[1m${t}\u001b[0m` : t);
const green = (t: string) => (tty ? `\u001b[32m${t}\u001b[0m` : t);
const red = (t: string) => (tty ? `\u001b[31m${t}\u001b[0m` : t);
const header = (t: string) => console.log(`\n${bold(`== ${t} ==`)}`);

/** AKIA plus 16 random base32 characters. Deterministic, random-looking, not a real credential. */
function fakeKey(seed: number): string {
  const rand = seededRandom(seed);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  return `AKIA${Array.from({ length: 16 }, () => alphabet[Math.floor(rand() * 32)]).join('')}`;
}
const mask = (key: string) => `${key.slice(0, 4)}${'*'.repeat(12)}${key.slice(-4)}`;

const git = (args: string[], cwd = repo) =>
  spawnSync('git', ['-c', 'user.name=demo', '-c', 'user.email=demo@example.invalid', ...args], {
    cwd,
    encoding: 'utf8',
  });

function freshRepo(): void {
  rmSync(repo, { recursive: true, force: true });
  mkdirSync(repo, { recursive: true });
  git(['init', '-q']);
  writeFileSync(join(repo, 'config.env'), `AWS_ACCESS_KEY_ID=${fakeKey(1)}\nREGION=eu-west-1\n`);
  copyFileSync(join(piece, 'templates', 'gitleaks.toml'), join(repo, '.gitleaks.toml'));
}

const hasGitleaks = () => spawnSync('gitleaks', ['version']).status === 0;

function before(): void {
  header('BEFORE: no guard');
  freshRepo();
  git(['add', 'config.env']);
  const res = git(['commit', '-q', '-m', 'add config']);
  console.log(`Staged config.env (AWS_ACCESS_KEY_ID=${mask(fakeKey(1))}) and ran: git commit`);
  console.log(
    res.status === 0
      ? red('The commit went through. The key is now in history.')
      : 'unexpected failure',
  );
}

function layer1(): void {
  header('LAYER 1: pre-commit hook');
  if (!hasGitleaks()) {
    console.log(
      'gitleaks is not installed, so this layer is skipped. Install it: brew install gitleaks',
    );
    return;
  }
  freshRepo();
  const tsx = join(piece, 'node_modules', '.bin', 'tsx');
  const hook = join(repo, '.git', 'hooks', 'pre-commit');
  writeFileSync(
    hook,
    `#!/bin/sh\nexec "${tsx}" "${join(piece, 'src', 'bin.ts')}" precommit --config .gitleaks.toml\n`,
  );
  chmodSync(hook, 0o755);
  git(['add', 'config.env', '.gitleaks.toml']);
  const res = git(['commit', '-q', '-m', 'add config']);
  console.log(
    `${res.stdout}${res.stderr}`
      .trim()
      .split('\n')
      .filter((l) => !l.includes('gitleaks_'))
      .join('\n'),
  );
  console.log(
    res.status === 0
      ? red('The commit went through.')
      : green('Commit blocked. Nothing entered history.'),
  );
  const log = join(repo, '.git', 'secrets-guard.audit.jsonl');
  if (existsSync(log)) {
    console.log(
      `\nRecord written to .git/secrets-guard.audit.jsonl (rule ids and files, no value):`,
    );
    console.log(`  ${readFileSync(log, 'utf8').trim().slice(0, 170)}...`);
  }
}

const SECRET = 'demo-webhook-secret-not-real';
const ALERT_AT = Date.parse('2026-02-01T10:00:00Z');

async function layer3(): Promise<void> {
  header('LAYER 3: webhook handler against fake AWS');
  rmSync(lambdaLog, { force: true });
  mkdirSync(out, { recursive: true });
  const users: Record<string, { name: string; path: string }> = {
    [fakeKey(11)]: { name: 'demo-user-1', path: '/secrets-guard-demo/' },
    [fakeKey(12)]: { name: 'demo-user-2', path: '/secrets-guard-demo/' },
    [fakeKey(13)]: { name: 'demo-user-3', path: '/secrets-guard-demo/' },
    [fakeKey(14)]: { name: 'prod-service', path: '/prod/' },
  };
  const changes: string[] = [];
  const audit: AuditEntry[] = [];
  let nowMs = ALERT_AT;
  const ports: Ports = {
    iam: {
      keyOwner: async (id) => users[id]?.name ?? null,
      userPath: async (name) => Object.values(users).find((u) => u.name === name)?.path ?? '/',
      deactivate: async (id, user) =>
        void changes.push(`UpdateAccessKey Inactive: ${user} (${mask(id)})`),
      tagUser: async (user) => void changes.push(`TagUser: ${user}`),
    },
    accountId: async () => '111122223333',
    notify: async (subject) => void changes.push(`SNS: ${subject}`),
    writeAudit: async (entry) => void audit.push(entry),
  };
  const send = async (
    label: string,
    opts: { key: string; number: number; delay: number; dryRun: boolean; badSignature?: boolean },
  ) => {
    nowMs = ALERT_AT + opts.delay * 1000;
    const handler = createHandler({
      ports,
      config: loadGuardConfig({
        DRY_RUN: String(opts.dryRun),
        ALLOWED_ACCOUNT_IDS: '111122223333',
      }),
      webhookSecret: async () => SECRET,
      now: () => new Date(nowMs),
    });
    const body = JSON.stringify({
      action: 'created',
      alert: {
        number: opts.number,
        created_at: new Date(ALERT_AT).toISOString(),
        secret_type: 'aws_access_key_id',
        secret: opts.key,
      },
      repository: { full_name: 'example-org/example-repo' },
    });
    changes.length = 0;
    const res = await handler({
      headers: {
        'x-github-event': 'secret_scanning_alert',
        'x-hub-signature-256': sign(opts.badSignature ? 'wrong' : SECRET, body),
      },
      body,
    });
    const decisions = JSON.parse(res.body) as { decisions?: string[]; error?: string };
    console.log(
      `\n${label}\n  key ${mask(opts.key)}  ->  HTTP ${res.statusCode} ${decisions.decisions?.join(',') ?? decisions.error}`,
    );
    for (const c of changes) console.log(`  ${c}`);
    if (changes.length === 0) console.log('  no AWS changes');
  };

  await send('1. Wrong signature', {
    key: fakeKey(11),
    number: 1,
    delay: 1,
    dryRun: false,
    badSignature: true,
  });
  await send('2. Dry run (the default)', { key: fakeKey(11), number: 2, delay: 60, dryRun: true });
  await send('3. Dry run off, in-scope user', {
    key: fakeKey(11),
    number: 3,
    delay: 60,
    dryRun: false,
  });
  await send('4. Another in-scope key', { key: fakeKey(12), number: 4, delay: 95, dryRun: false });
  await send('5. And another', { key: fakeKey(13), number: 5, delay: 140, dryRun: false });
  await send('6. A user outside the guarded path', {
    key: fakeKey(14),
    number: 6,
    delay: 30,
    dryRun: false,
  });
  writeFileSync(lambdaLog, audit.map((e) => JSON.stringify(e)).join('\n') + '\n');
  console.log('\n(The delays between alert and action are simulated.)');
}

async function run(): Promise<void> {
  layer1();
  await layer3();
}

function after(): void {
  header('AFTER: the evidence');
  if (!existsSync(lambdaLog)) throw new Error('run the "run" stage first');
  for (const e of readFileSync(lambdaLog, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as AuditEntry)) {
    const secs =
      e.detail.leakToActionSeconds === undefined
        ? ''
        : `  ${e.detail.leakToActionSeconds}s after alert`;
    console.log(
      `${e.decision.padEnd(18)} alert ${String(e.detail.alertNumber).padEnd(3)} key ...${e.detail.keySuffix ?? '----'}${secs}`,
    );
  }
  const files = [lambdaLog, join(repo, '.git', 'secrets-guard.audit.jsonl')].filter(existsSync);
  const leaked = files.some((f) =>
    [fakeKey(1), fakeKey(11), fakeKey(12), fakeKey(13), fakeKey(14)].some((k) =>
      readFileSync(f, 'utf8').includes(k),
    ),
  );
  console.log(
    leaked
      ? red('\nA key value was found in an audit file!')
      : green('\nNo key value appears in any audit file.'),
  );
}

function metric(): void {
  header('METRIC');
  const precommit = join(repo, '.git', 'secrets-guard.audit.jsonl');
  const lambda = existsSync(lambdaLog)
    ? readFileSync(lambdaLog, 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l) as AuditEntry)
    : [];
  console.log(
    formatMetrics(
      'From the records just written (alert times simulated)',
      computeMetrics(existsSync(precommit) ? readAuditRecords(precommit) : [], lambda),
    ),
  );
}

const stage = process.argv[2] ?? 'all';
if (stage === 'all') rmSync(out, { recursive: true, force: true });
if (stage === 'all') {
  before();
  await run();
  after();
  metric();
} else if (stage === 'before') before();
else if (stage === 'run') await run();
else if (stage === 'after') after();
else if (stage === 'metric') metric();
else {
  console.error(`unknown stage: ${stage}`);
  process.exitCode = 2;
}
