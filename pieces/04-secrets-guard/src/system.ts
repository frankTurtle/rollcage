import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PrecommitDeps } from './precommit.js';

/** The real pre-commit dependencies: spawn gitleaks, read its report, find the .git directory. */
export function systemPrecommitDeps(configPath: string | undefined): PrecommitDeps {
  const reportPath = join(mkdtempSync(join(tmpdir(), 'secrets-guard-')), 'report.json');
  const gitPath = spawnSync('git', ['rev-parse', '--git-path', 'secrets-guard.audit.jsonl'], {
    encoding: 'utf8',
  }).stdout.trim();
  return {
    runGitleaks: (args) => {
      const r = spawnSync('gitleaks', args, { stdio: ['ignore', 'inherit', 'inherit'] });
      return { status: r.status, ...(r.error ? { error: r.error } : {}) };
    },
    readReport: () => {
      try {
        return readFileSync(reportPath, 'utf8');
      } catch {
        return undefined;
      }
    },
    reportPath,
    auditPath: gitPath || '.git/secrets-guard.audit.jsonl',
    configPath,
    now: () => new Date(),
    err: (text) => console.error(text),
  };
}
