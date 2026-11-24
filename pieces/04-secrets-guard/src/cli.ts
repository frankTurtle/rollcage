import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { readAuditRecords } from '@adl/shared';
import { computeMetrics, formatMetrics } from './metrics.js';
import type { LeakAuditEntry } from './types.js';
import { runPrecommit } from './precommit.js';
import type { PrecommitDeps } from './precommit.js';

export interface CliDeps {
  out: (text: string) => void;
  err: (text: string) => void;
  /** Build the real pre-commit dependencies for a gitleaks config path (or none). */
  precommit: (configPath: string | undefined) => PrecommitDeps;
}

const USAGE = `Usage:
  secrets-guard precommit [--config FILE]     run as a git pre-commit hook
  secrets-guard metrics [--precommit FILE] [--lambda FILE] [--label TEXT]`;

export function runCli(argv: string[], deps: CliDeps): number {
  const [command, ...rest] = argv;
  try {
    if (command === 'precommit') {
      const { values } = parseArgs({ args: rest, options: { config: { type: 'string' } } });
      const config = values.config ?? (existsSync('.gitleaks.toml') ? '.gitleaks.toml' : undefined);
      return runPrecommit(deps.precommit(config));
    }
    if (command === 'metrics') {
      const { values } = parseArgs({
        args: rest,
        options: {
          precommit: { type: 'string' },
          lambda: { type: 'string' },
          label: { type: 'string' },
        },
      });
      const metrics = computeMetrics(
        values.precommit ? readAuditRecords(values.precommit) : [],
        values.lambda ? readAuditRecords<LeakAuditEntry>(values.lambda) : [],
      );
      deps.out(formatMetrics(values.label ?? 'Secrets guard', metrics));
      return 0;
    }
    deps.err(USAGE);
    return 2;
  } catch (error) {
    deps.err(`error: ${error instanceof Error ? error.message : String(error)}`);
    // Exit 2 makes a failing pre-commit hook block the commit.
    return 2;
  }
}
