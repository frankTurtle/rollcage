import { existsSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { AuditLogger, readAuditRecords } from '@adl/shared';
import type { FetchLike } from '@adl/shared';
import { loadConfig } from './config.js';
import { GitHubApi, GitHubIO } from './github.js';
import type { PrRef } from './github.js';
import { parseLlmMode, selectLlm } from './llm-select.js';
import { LocalIO } from './local-io.js';
import { computeMetrics, formatMetrics } from './metrics.js';
import { runGate } from './run.js';
import type { GateResult } from './run.js';
import { writeSyntheticHistory } from './synthetic.js';
import type { GateIO } from './types.js';

export interface CliDeps {
  env: Record<string, string | undefined>;
  out: (text: string) => void;
  err: (text: string) => void;
  fetchImpl?: FetchLike;
}

const USAGE = `Usage:
  risk-gate evaluate [--diff F --meta F | --pr N] [--config F] [--audit F] [--mode enforce|observe]
                     [--llm auto|live|replay|none] [--fixtures DIR] [--dry-run] [--summary-only]
  risk-gate metrics --log F [--label TEXT]
  risk-gate synthetic --out F [--seed N] [--prs N] [--gated]`;

export async function runCli(argv: string[], deps: CliDeps): Promise<number> {
  const [command, ...rest] = argv;
  try {
    if (command === 'evaluate') return await evaluate(rest, deps);
    if (command === 'metrics') return metrics(rest, deps);
    if (command === 'synthetic') return synthetic(rest, deps);
    deps.err(USAGE);
    return 2;
  } catch (error) {
    deps.err(`error: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}

function readPrNumber(env: CliDeps['env'], flag: string | undefined): number {
  if (flag) return Number(flag);
  const eventPath = env['GITHUB_EVENT_PATH'];
  if (eventPath) {
    const event = JSON.parse(readFileSync(eventPath, 'utf8')) as {
      number?: number;
      pull_request?: { number?: number };
    };
    const n = event.pull_request?.number ?? event.number;
    if (n) return n;
  }
  throw new Error('no PR number: pass --pr or run inside a pull_request workflow');
}

function githubIo(values: { pr?: string; 'dry-run'?: boolean }, deps: CliDeps): GateIO {
  const repo = deps.env['GITHUB_REPOSITORY'];
  const token = deps.env['GITHUB_TOKEN'];
  if (!repo?.includes('/') || !token) {
    throw new Error(
      'GitHub mode needs GITHUB_REPOSITORY and GITHUB_TOKEN (or use --diff and --meta)',
    );
  }
  const [owner = '', name = ''] = repo.split('/');
  const ref: PrRef = { owner, repo: name, number: readPrNumber(deps.env, values.pr) };
  return new GitHubIO(
    new GitHubApi(token, deps.fetchImpl),
    ref,
    values['dry-run'] === true,
    deps.out,
  );
}

async function evaluate(args: string[], deps: CliDeps): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      diff: { type: 'string' },
      meta: { type: 'string' },
      pr: { type: 'string' },
      config: { type: 'string' },
      audit: { type: 'string' },
      mode: { type: 'string' },
      llm: { type: 'string', default: 'auto' },
      fixtures: { type: 'string' },
      'dry-run': { type: 'boolean' },
      'summary-only': { type: 'boolean' },
    },
  });

  const configPath = values.config ?? 'risk-gate.yml';
  if (values.config && !existsSync(configPath))
    throw new Error(`config file not found: ${configPath}`);
  const config = loadConfig(existsSync(configPath) ? readFileSync(configPath, 'utf8') : undefined);
  if (values.mode !== undefined) {
    if (values.mode !== 'enforce' && values.mode !== 'observe')
      throw new Error('--mode must be enforce or observe');
    config.mode = values.mode;
  }

  const print = values['summary-only'] ? () => undefined : deps.out;
  const io: GateIO =
    values.diff && values.meta
      ? new LocalIO(values.diff, values.meta, print)
      : githubIo(values, deps);

  const result = await runGate({
    io,
    llm: selectLlm(parseLlmMode(values.llm), deps.env, values.fixtures),
    config,
    ...(values.audit ? { audit: new AuditLogger(values.audit) } : {}),
  });
  deps.out(summarize(result));
  return result.exitCode;
}

const STATUS = { pass: 'PASS', fail: 'FAIL', 'observe-would-fail': 'WOULD BLOCK' } as const;

export function summarize(r: GateResult): string {
  const status = STATUS[r.policy.verdict];
  const model = r.review.source === 'model' ? r.review.riskLevel : 'not used';
  return [
    `${status}  level=${r.level.toUpperCase()} (pre-score ${r.pre.level}, model ${model})`,
    `  tests changed: ${r.pre.hasTestChanges ? 'yes' : 'no'}   approvals: ${r.policy.approvers.length}   comment: ${r.published}`,
    ...r.policy.violations.map((v) => `  - ${v.id}: ${v.message}`),
  ].join('\n');
}

function metrics(args: string[], deps: CliDeps): number {
  const { values } = parseArgs({
    args,
    options: { log: { type: 'string' }, label: { type: 'string' } },
  });
  if (!values.log) throw new Error('metrics needs --log <audit.jsonl>');
  deps.out(formatMetrics(values.label ?? values.log, computeMetrics(readAuditRecords(values.log))));
  return 0;
}

function synthetic(args: string[], deps: CliDeps): number {
  const { values } = parseArgs({
    args,
    options: {
      out: { type: 'string' },
      seed: { type: 'string', default: '1' },
      prs: { type: 'string', default: '40' },
      gated: { type: 'boolean' },
    },
  });
  if (!values.out) throw new Error('synthetic needs --out <file>');
  writeSyntheticHistory(values.out, {
    seed: Number(values.seed),
    prs: Number(values.prs),
    gated: values.gated === true,
  });
  deps.out(`wrote SYNTHETIC history to ${values.out}`);
  return 0;
}
