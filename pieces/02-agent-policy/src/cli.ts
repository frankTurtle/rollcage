import { parseArgs } from 'node:util';
import { readAuditRecords } from '@adl/shared';
import { checkRepo } from './check.js';
import { runHook } from './hook.js';
import type { HookDeps } from './hook.js';
import { computeMetrics, formatMetrics } from './metrics.js';
import { selftest } from './selftest.js';

export interface CliDeps extends HookDeps {
  stdin: () => string;
  out: (text: string) => void;
  err: (text: string) => void;
}

const USAGE = `Usage:
  agent-policy hook pre|post          (reads the Claude Code hook JSON on stdin)
  agent-policy check [--root DIR] [--policy FILE]
  agent-policy metrics --log FILE [--label TEXT]
  agent-policy selftest [--root DIR]    (runs the configured PreToolUse hook against two sample calls)`;

export function runCli(argv: string[], deps: CliDeps): number {
  const [command, ...rest] = argv;
  try {
    if (command === 'hook') {
      const kind = rest[0];
      if (kind !== 'pre' && kind !== 'post') throw new Error('hook needs pre or post');
      const result = runHook(kind, deps.stdin(), deps);
      if (result.stderr) deps.err(result.stderr);
      return result.exitCode;
    }
    if (command === 'check') {
      const { values } = parseArgs({
        args: rest,
        options: { root: { type: 'string', default: '.' }, policy: { type: 'string' } },
      });
      const findings = checkRepo(values.root, values.policy ? { policyPath: values.policy } : {});
      for (const f of findings) deps.err(`FAIL ${f.id}: ${f.message}`);
      deps.out(
        findings.length === 0 ? 'agent policy check passed' : `${findings.length} problem(s) found`,
      );
      return findings.length === 0 ? 0 : 1;
    }
    if (command === 'selftest') {
      const { values } = parseArgs({
        args: rest,
        options: { root: { type: 'string', default: '.' } },
      });
      const checks = selftest(values.root);
      for (const c of checks) deps.out(`${c.ok ? 'ok  ' : 'FAIL'} ${c.name}: ${c.detail}`);
      return checks.every((c) => c.ok) ? 0 : 1;
    }
    if (command === 'metrics') {
      const { values } = parseArgs({
        args: rest,
        options: { log: { type: 'string' }, label: { type: 'string' } },
      });
      if (!values.log) throw new Error('metrics needs --log FILE');
      deps.out(
        formatMetrics(values.label ?? values.log, computeMetrics(readAuditRecords(values.log))),
      );
      return 0;
    }
    deps.err(USAGE);
    return 2;
  } catch (error) {
    deps.err(`error: ${error instanceof Error ? error.message : String(error)}`);
    // Exit 2 also blocks a tool call, so a crashing `hook pre` fails closed.
    return 2;
  }
}
