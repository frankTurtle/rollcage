import type { DoraConfig } from './config.js';
import { DAY_MS, HOUR_MS, median, percentile, round1 } from './stats.js';
import type { Metrics } from './schema.js';
import type { Change, Deployment, DoraData, Range } from './types.js';

const ms = (iso: string): number => Date.parse(iso);
const inRange = (t: number, r: Range): boolean => t >= r.since.getTime() && t < r.until.getTime();

const isRevert = (c: Change, cfg: DoraConfig): boolean =>
  c.title.startsWith(cfg.revert_title_prefix) || c.labels.includes('revert');
const isHotfix = (c: Change, cfg: DoraConfig): boolean =>
  c.labels.some((l) => cfg.hotfix_labels.includes(l));

/** Index of the first element with time >= t in an ascending list, or -1. */
function firstAtOrAfter(sorted: Deployment[], t: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ms((sorted[mid] as Deployment).at) >= t) hi = mid;
    else lo = mid + 1;
  }
  return lo < sorted.length ? lo : -1;
}

/** Index of the last element with time < t, or -1. */
function lastBefore(sorted: Deployment[], t: number): number {
  const i = firstAtOrAfter(sorted, t);
  return (i === -1 ? sorted.length : i) - 1;
}

/**
 * Compute the five metrics for one period. Events (deployments, merges, incidents) are counted if
 * they fall in the period; lookups such as "the next deployment" use all the data, so a change
 * merged just before the period ends can still be matched to a deployment just after it.
 */
export function computeMetrics(data: DoraData, period: Range, config: DoraConfig): Metrics {
  const min = config.min_samples;
  const windowMs = config.failure_window_hours * HOUR_MS;
  const success = data.deployments
    .filter((d) => d.status === 'success')
    .sort((a, b) => ms(a.at) - ms(b.at));
  const inPeriod = success.filter((d) => inRange(ms(d.at), period));
  const days = (period.until.getTime() - period.since.getTime()) / DAY_MS;

  // Remediation signals: revert or hotfix merges, and incidents opening.
  const remediations = data.changes.filter((c) => isRevert(c, config) || isHotfix(c, config));
  const signalTimes = [
    ...remediations.map((c) => ms(c.mergedAt)),
    ...data.incidents.map((i) => ms(i.openedAt)),
  ];

  // Failed deployments: the latest successful deployment before each signal, inside the window.
  const failed = new Set<string>();
  for (const t of signalTimes) {
    const i = lastBefore(success, t);
    const d = success[i];
    if (d && t - ms(d.at) <= windowMs) failed.add(d.id);
  }
  // Rework deployments: the first deployment at or after each revert or hotfix merge.
  const rework = new Set<string>();
  for (const c of remediations) {
    const d = success[firstAtOrAfter(success, ms(c.mergedAt))];
    if (d) rework.add(d.id);
  }
  const countIn = (ids: Set<string>) => inPeriod.filter((d) => ids.has(d.id)).length;

  // Frequency.
  const times = inPeriod.map((d) => ms(d.at));
  const gaps = times.slice(1).map((t, i) => (t - (times[i] as number)) / DAY_MS);
  const freqN = inPeriod.length;
  const freqOk = freqN >= min;

  // Lead time.
  const leads: number[] = [];
  let undeployed = 0;
  for (const c of data.changes.filter((x) => inRange(ms(x.mergedAt), period))) {
    const d = success[firstAtOrAfter(success, ms(c.mergedAt))];
    if (!d) undeployed++;
    else leads.push(Math.max(0, (ms(d.at) - ms(c.firstCommitAt)) / HOUR_MS));
  }

  // Recovery.
  const recoveries: number[] = [];
  if (config.recovery_source === 'incidents') {
    for (const i of data.incidents) {
      if (i.closedAt && inRange(ms(i.openedAt), period)) {
        recoveries.push((ms(i.closedAt) - ms(i.openedAt)) / HOUR_MS);
      }
    }
  } else {
    const failures = [
      ...data.deployments.filter((d) => d.status === 'failure'),
      ...success.filter((d) => failed.has(d.id)),
    ].filter((d) => inRange(ms(d.at), period));
    for (const f of failures) {
      const next = success.find((d) => ms(d.at) > ms(f.at) && !failed.has(d.id));
      if (next) recoveries.push((ms(next.at) - ms(f.at)) / HOUR_MS);
    }
  }

  const rate = (count: number): Metrics['changeFailRate'] => ({
    n: freqN,
    insufficient: !freqOk,
    count,
    rate: freqOk ? round1((count / freqN) * 100) : null,
  });
  const hours = (values: number[], p: number): number | null =>
    values.length >= min
      ? round1(p === 50 ? (median(values) as number) : (percentile(values, p) as number))
      : null;

  return {
    period: {
      since: period.since.toISOString(),
      until: period.until.toISOString(),
      days: round1(days),
    },
    deploymentFrequency: {
      n: freqN,
      insufficient: !freqOk,
      perWeek: freqOk && days > 0 ? round1(freqN / (days / 7)) : null,
      medianDaysBetween: freqOk && gaps.length > 0 ? round1(median(gaps) as number) : null,
    },
    changeLeadTime: {
      n: leads.length,
      insufficient: leads.length < min,
      undeployed,
      medianHours: hours(leads, 50),
      p90Hours: hours(leads, 90),
    },
    changeFailRate: rate(countIn(failed)),
    failedDeploymentRecovery: {
      n: recoveries.length,
      insufficient: recoveries.length < min,
      source: config.recovery_source,
      medianHours: hours(recoveries, 50),
      p90Hours: hours(recoveries, 90),
    },
    deploymentReworkRate: rate(countIn(rework)),
  };
}
