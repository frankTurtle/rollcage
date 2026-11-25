import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readAuditRecords, verifyAuditChain } from '@adl/shared';
import { describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.ts';
import type { LeakAuditEntry } from '../src/types.ts';
import { computeMetrics, formatMetrics } from '../src/metrics.ts';
import { runPrecommit } from '../src/precommit.ts';
import type { PrecommitDeps } from '../src/precommit.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'sg-'));
const NOW = new Date('2026-02-01T10:00:00Z');

function deps(over: Partial<PrecommitDeps> & { status?: number | null; report?: string } = {}) {
  const dir = tmp();
  const errors: string[] = [];
  const ran: string[][] = [];
  const d: PrecommitDeps = {
    runGitleaks: (args) => {
      ran.push(args);
      return over.status === null
        ? { status: null, error: new Error('spawn gitleaks ENOENT') }
        : { status: over.status ?? 0 };
    },
    readReport: () => over.report,
    reportPath: join(dir, 'report.json'),
    auditPath: join(dir, 'audit.jsonl'),
    configPath: over.configPath,
    now: () => NOW,
    err: (t) => errors.push(t),
  };
  return { d, errors, ran, auditPath: d.auditPath };
}

const REPORT = JSON.stringify([
  { RuleID: 'aws-access-token', File: 'config.env', Secret: 'REDACTED', Match: 'REDACTED' },
  { RuleID: 'aws-access-token', File: 'other.env' },
  { RuleID: 'generic-api-key', File: 'config.env' },
]);

describe('AC-10 pre-commit wrapper', () => {
  it('passes a clean commit and writes nothing', () => {
    const { d, auditPath } = deps();
    expect(runPrecommit(d)).toBe(0);
    expect(() => readFileSync(auditPath)).toThrow();
  });

  it('passes the staged flags, redaction and the config to gitleaks', () => {
    const { d, ran } = deps({ configPath: '.gitleaks.toml' });
    runPrecommit(d);
    const args = ran[0] ?? [];
    expect(args).toEqual(
      expect.arrayContaining([
        'git',
        '--pre-commit',
        '--staged',
        '--redact',
        '--config',
        '.gitleaks.toml',
      ]),
    );
    expect(args).toContain('--report-path');
  });

  it('blocks and records rule ids and files, never values', () => {
    const { d, auditPath, errors } = deps({ status: 1, report: REPORT });
    expect(runPrecommit(d)).toBe(1);
    const [rec] = readAuditRecords(auditPath);
    expect(rec).toMatchObject({
      actor: 'secrets-guard',
      action: 'precommit-block',
      decision: 'blocked',
      detail: {
        rules: { 'aws-access-token': 2, 'generic-api-key': 1 },
        files: ['config.env', 'other.env'],
        fileCount: 2,
      },
    });
    expect(verifyAuditChain(auditPath).ok).toBe(true);
    expect(JSON.stringify(rec)).not.toContain('REDACTED');
    expect(errors.join(' ')).toContain('commit blocked');
  });

  it('still blocks when the report is missing or unreadable', () => {
    for (const report of [undefined, 'not json', '{"a":1}']) {
      const { d, auditPath } = deps({ status: 1, ...(report === undefined ? {} : { report }) });
      expect(runPrecommit(d)).toBe(1);
      expect(readAuditRecords(auditPath)[0]?.detail).toMatchObject({ rules: {}, fileCount: 0 });
    }
  });

  it('still blocks when the audit file cannot be written', () => {
    const { d, errors } = deps({ status: 1, report: REPORT });
    d.auditPath = '/dev/null/x/audit.jsonl';
    expect(runPrecommit(d)).toBe(1);
    expect(errors.join(' ')).toContain('could not write the audit record');
  });

  it('fails closed (exit 2) when gitleaks is missing or exits oddly', () => {
    const missing = deps({ status: null });
    expect(runPrecommit(missing.d)).toBe(2);
    expect(missing.errors.join(' ')).toContain('Install it');
    const odd = deps({ status: 126 });
    expect(runPrecommit(odd.d)).toBe(2);
    expect(odd.errors.join(' ')).toContain('status 126');
  });
});

const entry = (decision: LeakAuditEntry['decision'], seconds?: number): LeakAuditEntry => ({
  timestamp: NOW.toISOString(),
  actor: 'secrets-guard',
  action: 'respond-to-leak',
  inputHash: 'h',
  decision,
  detail: {
    repo: 'o/r',
    alertNumber: 1,
    dryRun: false,
    ...(seconds === undefined ? {} : { leakToActionSeconds: seconds }),
  },
});

describe('AC-11 metrics', () => {
  it('counts blocks by rule and summarizes alert-to-deactivation time', () => {
    const dir = tmp();
    const log = join(dir, 'a.jsonl');
    const { d } = deps({ status: 1, report: REPORT });
    d.auditPath = log;
    runPrecommit(d);
    runPrecommit(d);
    const m = computeMetrics(readAuditRecords(log), [
      entry('deactivated', 60),
      entry('deactivated', 120),
      entry('deactivated', 300),
      entry('deactivated'),
      entry('dry-run'),
      entry('error'),
      entry('unknown-key'),
    ]);
    expect(m).toMatchObject({
      blockedPreCommit: 2,
      blockedByRule: { 'aws-access-token': 4, 'generic-api-key': 2 },
      deactivated: 4,
      dryRuns: 1,
      errors: 1,
      skipped: 1,
      leakToDeactivation: { n: 3, medianSeconds: 120, p90Seconds: 300 },
    });
    const text = formatMetrics('label', m);
    expect(text).toContain('Leaks blocked at pre-commit: 2');
    expect(text).toContain('median 120s, p90 300s (n=3)');
  });

  it('ignores records that are not pre-commit blocks, and handles empty input', () => {
    const m = computeMetrics([{ ...JSON.parse('{"actor":"x","action":"other","detail":{}}') }], []);
    expect(m.blockedPreCommit).toBe(0);
    expect(m.leakToDeactivation).toEqual({ n: 0, medianSeconds: null, p90Seconds: null });
    const text = formatMetrics('x', m);
    expect(text).toContain('median n/a');
    expect(text).not.toContain('By rule');
  });
});

describe('cli', () => {
  const run = (argv: string[], pre = deps()) => {
    const out: string[] = [];
    const err: string[] = [];
    const seenConfig: (string | undefined)[] = [];
    const code = runCli(argv, {
      out: (t) => out.push(t),
      err: (t) => err.push(t),
      precommit: (config) => {
        seenConfig.push(config);
        return pre.d;
      },
    });
    return { code, out: out.join('\n'), err: err.join('\n'), seenConfig };
  };

  it('runs the pre-commit wrapper with the config flag', () => {
    expect(run(['precommit', '--config', 'my.toml']).seenConfig).toEqual(['my.toml']);
    expect(run(['precommit']).code).toBe(0);
  });

  it('prints metrics from files, and usage for anything else', () => {
    const dir = tmp();
    const lambda = join(dir, 'l.jsonl');
    writeFileSync(lambda, `${JSON.stringify(entry('deactivated', 90))}\n`);
    const res = run(['metrics', '--lambda', lambda, '--label', 'demo']);
    expect(res.code).toBe(0);
    expect(res.out).toContain('median 90s');
    expect(run(['metrics']).out).toContain('Keys deactivated: 0');
    expect(run([]).err).toContain('Usage');
    expect(run(['metrics', '--lambda', '/nope']).code).toBe(2);
  });
});
