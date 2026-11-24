import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type { FetchLike } from '@adl/shared';
import { loadDoraConfig } from './config.js';
import type { DoraConfig } from './config.js';
import { DAY_MS, isoDay, parseDate } from './dates.js';
import { GitHubSource } from './github-source.js';
import { renderHtml } from './render-html.js';
import { renderSummary } from './render-summary.js';
import { renderText } from './render-text.js';
import { buildReport } from './report.js';
import { ReportSchema } from './schema.js';
import { generateSynthetic } from './synthetic.js';
import { DoraDataSchema } from './types.js';
import type { LoadResult, Range } from './types.js';

export interface CliDeps {
  env: Record<string, string | undefined>;
  out: (text: string) => void;
  err: (text: string) => void;
  now?: () => Date;
  fetchImpl?: FetchLike;
}

/** How far back a report looks when --since is not given. */
const DEFAULT_RANGE_DAYS = 90;

const USAGE = `Usage:
  dora report [--repo OWNER/NAME | --data FILE | --source synthetic] [--config FILE]
              [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--compare-at YYYY-MM-DD]
              [--seed N] [--out DIR]
Dates are UTC. The range is [since, until). Default: the ${DEFAULT_RANGE_DAYS} days before today.`;

interface DataFlags {
  data?: string | undefined;
  source?: string | undefined;
  repo?: string | undefined;
  seed?: string | undefined;
}

/** Pick the data source from the flags: a data file, the synthetic generator, or GitHub. */
async function loadData(
  values: DataFlags,
  config: DoraConfig,
  range: Range,
  compareAt: Date | undefined,
  deps: CliDeps,
): Promise<{ result: LoadResult; sourceName: string; synthetic: boolean }> {
  if (values.data) {
    const data = DoraDataSchema.parse(JSON.parse(readFileSync(values.data, 'utf8')));
    return { result: { data, warnings: [] }, sourceName: 'file', synthetic: false };
  }
  if (values.source === 'synthetic') {
    if (!compareAt)
      throw new Error('--source synthetic needs --compare-at (the made-up rollout date)');
    const data = generateSynthetic({ seed: Number(values.seed), range, rolloutAt: compareAt });
    return { result: { data, warnings: [] }, sourceName: 'synthetic', synthetic: true };
  }
  const [owner, name] = (values.repo ?? '').split('/');
  const token = deps.env['GITHUB_TOKEN'];
  if (!owner || !name) throw new Error('give --repo OWNER/NAME, --data FILE or --source synthetic');
  if (!token) throw new Error('GITHUB_TOKEN is not set');
  const source = new GitHubSource({ owner, name }, token, config, deps.fetchImpl);
  return { result: await source.load(range), sourceName: source.name, synthetic: false };
}

export async function runCli(argv: string[], deps: CliDeps): Promise<number> {
  const [command, ...rest] = argv;
  if (command !== 'report') {
    deps.err(USAGE);
    return 2;
  }
  try {
    const { values } = parseArgs({
      args: rest,
      options: {
        repo: { type: 'string' },
        data: { type: 'string' },
        source: { type: 'string' },
        config: { type: 'string' },
        since: { type: 'string' },
        until: { type: 'string' },
        'compare-at': { type: 'string' },
        seed: { type: 'string', default: '1' },
        out: { type: 'string' },
      },
    });

    const configPath = values.config ?? 'dora.yml';
    const hasConfig = existsSync(configPath);
    if (values.config && !hasConfig) throw new Error(`config file not found: ${configPath}`);
    const config = loadDoraConfig(hasConfig ? readFileSync(configPath, 'utf8') : undefined);

    const today = isoDay(deps.now?.() ?? new Date());
    const until = parseDate(values.until ?? today, '--until');
    const since = values.since
      ? parseDate(values.since, '--since')
      : new Date(until.getTime() - DEFAULT_RANGE_DAYS * DAY_MS);
    if (since >= until) throw new Error('--since must be before --until');
    const range: Range = { since, until };
    const compareAt = values['compare-at']
      ? parseDate(values['compare-at'], '--compare-at')
      : undefined;

    const { result, sourceName, synthetic } = await loadData(
      values,
      config,
      range,
      compareAt,
      deps,
    );
    const report = ReportSchema.parse(
      buildReport({
        data: result.data,
        config,
        range,
        compareAt,
        source: sourceName,
        repo: values.repo,
        synthetic,
        warnings: result.warnings,
      }),
    );
    deps.out(renderText(report));
    if (values.out) {
      mkdirSync(values.out, { recursive: true });
      writeFileSync(join(values.out, 'dora.json'), `${JSON.stringify(report, null, 2)}\n`);
      writeFileSync(join(values.out, 'dora.html'), renderHtml(report));
      writeFileSync(join(values.out, 'summary.md'), renderSummary(report));
      deps.out(`\nWrote dora.json, dora.html and summary.md to ${values.out}`);
    }
    return 0;
  } catch (error) {
    deps.err(`error: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}
