import { compareMetrics } from './compare.js';
import type { DoraConfig } from './config.js';
import { computeMetrics } from './metrics.js';
import type { Report } from './schema.js';
import type { DoraData, Range } from './types.js';

const CAVEATS = [
  'A before and after comparison shows what changed, not why. Rollout of AI tools is one of many things that changed in the period.',
  "DORA's guide names the five metrics but does not fix their start and end events. The definitions here are this tool's choices; see the README.",
  'Change fail rate and rework rate depend on revert titles, hotfix labels and incident labels being used consistently.',
  'Numbers with fewer than the minimum number of samples are shown as insufficient data, not as a value.',
];

export interface ReportInput {
  data: DoraData;
  config: DoraConfig;
  range: Range;
  compareAt?: Date | undefined;
  source: string;
  repo?: string | undefined;
  synthetic?: boolean | undefined;
  warnings?: readonly string[] | undefined;
}

/** Compute the metrics for the whole range, or for the periods either side of `compareAt`. */
export function buildReport(input: ReportInput): Report {
  const { data, config, range, compareAt } = input;
  let periods: Report['periods'];
  if (compareAt) {
    if (compareAt <= range.since || compareAt >= range.until) {
      throw new Error('compare-at must be inside the date range');
    }
    periods = [
      {
        name: 'before',
        metrics: computeMetrics(data, { since: range.since, until: compareAt }, config),
      },
      {
        name: 'after',
        metrics: computeMetrics(data, { since: compareAt, until: range.until }, config),
      },
    ];
  } else {
    periods = [{ name: 'all', metrics: computeMetrics(data, range, config) }];
  }
  const [first, second] = periods;
  return {
    schemaVersion: 1,
    asOf: range.until.toISOString(),
    source: input.source,
    repo: input.repo ?? null,
    synthetic: input.synthetic ?? false,
    compareAt: compareAt ? compareAt.toISOString() : null,
    periods,
    comparison: first && second ? compareMetrics(first.metrics, second.metrics) : null,
    warnings: [...(input.warnings ?? [])],
    caveats: CAVEATS,
  };
}
