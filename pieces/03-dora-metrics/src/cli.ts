import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { loadDoraConfig } from './config.js';
import { GitHubSource } from './github-source.js';
import type { FetchLike } from './github-source.js';
import { renderHtml } from './render-html.js';
import { renderSummary } from './render-summary.js';
import { renderText } from './render-text.js';
import { buildReport } from './report.js';
import { ReportSchema } from './schema.js';
import { DAY_MS } from './stats.js';
import { generateSynthetic } from './synthetic.js';
import { DoraDataSchema } from './types.js';
import type { DoraData, Range, Source } from './types.js';

export interface CliDeps {
  env: Record<string, string | undefined>;
  out: (text: string) => void;
  err: (text: string) => void;
  now?: () => Date;
  fetchImpl?: FetchLike;
}

const USAGE = `Usage:
  dora report [--repo OWNER/NAME | --data FILE | --source synthetic] [--config FILE]
              [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--compare-at YYYY-MM-DD]
              [--seed N] [--out DIR]
Dates are UTC. The range is [since, until). Default: the 90 days before today.`;

export function parseDate(value: string, flag: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  // The round trip rejects impossible dates such as 2026-02-30, which Date would roll forward.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${flag} must be a date like 2026-03-15`);
  }
  return date;
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
    if (values.config && !existsSync(configPath))
      throw new Error(`config file not found: ${configPath}`);
    const config = loadDoraConfig(
      existsSync(configPath) ? readFileSync(configPath, 'utf8') : undefined,
    );

    const today = (deps.now?.() ?? new Date()).toISOString().slice(0, 10);
    const until = parseDate(values.until ?? today, '--until');
    const since = values.since
      ? parseDate(values.since, '--since')
      : new Date(until.getTime() - 90 * DAY_MS);
    if (since >= until) throw new Error('--since must be before --until');
    const range: Range = { since, until };
    const compareAt = values['compare-at']
      ? parseDate(values['compare-at'], '--compare-at')
      : undefined;

    let data: DoraData;
    let source: Source | undefined;
    let sourceName: string;
    let synthetic = false;
    if (values.data) {
      data = DoraDataSchema.parse(JSON.parse(readFileSync(values.data, 'utf8')));
      sourceName = 'file';
    } else if (values.source === 'synthetic') {
      if (!compareAt)
        throw new Error('--source synthetic needs --compare-at (the made-up rollout date)');
      data = generateSynthetic({ seed: Number(values.seed), range, rolloutAt: compareAt });
      sourceName = 'synthetic';
      synthetic = true;
    } else {
      const [owner, name] = (values.repo ?? '').split('/');
      const token = deps.env['GITHUB_TOKEN'];
      if (!owner || !name)
        throw new Error('give --repo OWNER/NAME, --data FILE or --source synthetic');
      if (!token) throw new Error('GITHUB_TOKEN is not set');
      source = new GitHubSource({ owner, name }, token, config, deps.fetchImpl);
      data = await source.load(range);
      sourceName = source.name;
    }

    const report = ReportSchema.parse(
      buildReport({
        data,
        config,
        range,
        compareAt,
        source: sourceName,
        repo: values.repo,
        synthetic,
        warnings: source?.warnings,
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
