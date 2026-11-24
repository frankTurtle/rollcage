import type { DoraConfig } from './config.js';
import { HOUR_MS, DAY_MS, inRange, ms } from './dates.js';
import type { Metrics } from './schema.js';
import { round1, summarize } from './stats.js';
import type { Change, Deployment, DoraData, Range } from './types.js';

const isRevert = (c: Change, cfg: DoraConfig): boolean =>
  c.title.startsWith(cfg.revert_title_prefix) || c.labels.includes('revert');
const isHotfix = (c: Change, cfg: DoraConfig): boolean =>
  c.labels.some((l) => cfg.hotfix_labels.includes(l));

/** Index of the first time >= t in an ascending list (the length if there is none). */
function firstAtOrAfter(times: number[], t: number): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((times[mid] as number) >= t) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** Work that does not depend on the period, done once and shared by the before and after runs. */
export interface Prepared {
  /** Successful deployments, ascending by time. */
  success: Deployment[];
  /** Epoch milliseconds of each successful deployment, same order. */
  times: number[];
  /** Successful deployments followed by a revert, hotfix or incident inside the failure window. */
  failed: Set<string>;
  /** First successful deployments after each revert or hotfix merge. */
  rework: Set<string>;
}

export function prepare(data: DoraData, config: DoraConfig): Prepared {
  const sorted = data.deployments
    .filter((d) => d.status === 'success')
    .map((d) => ({ d, t: ms(d.at) }))
    .sort((a, b) => a.t - b.t);
  const success = sorted.map((x) => x.d);
  const times = sorted.map((x) => x.t);
  const windowMs = config.failure_window_hours * HOUR_MS;

  const remediations = data.changes
    .filter((c) => isRevert(c, config) || isHotfix(c, config))
    .map((c) => ms(c.mergedAt));
  const signals = [...remediations, ...data.incidents.map((i) => ms(i.openedAt))];

  // Failed: the latest successful deployment before each signal, if it is inside the window.
  const failed = new Set<string>();
  for (const t of signals) {
    const i = firstAtOrAfter(times, t) - 1;
    if (i >= 0 && t - (times[i] as number) <= windowMs) failed.add((success[i] as Deployment).id);
  }
  // Rework: the first successful deployment at or after each revert or hotfix merge.
  const rework = new Set<string>();
  for (const t of remediations) {
    const d = success[firstAtOrAfter(times, t)];
    if (d) rework.add(d.id);
  }
  return { success, times, failed, rework };
}

/**
 * Compute the five metrics for one period. Events (deployments, merges, incidents) are counted if
 * they fall in the period; lookups such as "the next deployment" use all the data, so a change
 * merged just before the period ends can still be matched to a deployment just after it.
 * A metric with fewer than `min_samples` data points is null, never a misleading number.
 */
export function computeMetrics(
  data: DoraData,
  period: Range,
  config: DoraConfig,
  prepared: Prepared = prepare(data, config),
): Metrics {
  const { success, times, failed, rework } = prepared;
  const min = config.min_samples;
  const days = (period.until.getTime() - period.since.getTime()) / DAY_MS;
  const inPeriod = success.filter((_, i) => inRange(times[i] as number, period));
  const n = inPeriod.length;
  const enough = n >= min;
  const countIn = (ids: Set<string>) => inPeriod.filter((d) => ids.has(d.id)).length;

  // Lead time: first commit to the first successful deployment at or after the merge.
  const leads: number[] = [];
  let undeployed = 0;
  for (const c of data.changes) {
    const merged = ms(c.mergedAt);
    if (!inRange(merged, period)) continue;
    const i = firstAtOrAfter(times, merged);
    if (i >= times.length) undeployed++;
    else leads.push(Math.max(0, ((times[i] as number) - ms(c.firstCommitAt)) / HOUR_MS));
  }

  // Recovery: incident open to close, or each failure to the next good deployment.
  const recoveries: number[] = [];
  if (config.recovery_source === 'incidents') {
    for (const inc of data.incidents) {
      if (inc.closedAt && inRange(ms(inc.openedAt), period)) {
        recoveries.push((ms(inc.closedAt) - ms(inc.openedAt)) / HOUR_MS);
      }
    }
  } else {
    const failureTimes = [
      ...data.deployments.filter((d) => d.status === 'failure').map((d) => ms(d.at)),
      ...success.flatMap((d, i) => (failed.has(d.id) ? [times[i] as number] : [])),
    ].filter((t) => inRange(t, period));
    for (const t of failureTimes) {
      let i = firstAtOrAfter(times, t + 1);
      while (success[i] && failed.has((success[i] as Deployment).id)) i++;
      if (times[i] !== undefined) recoveries.push(((times[i] as number) - t) / HOUR_MS);
    }
  }

  const lead = summarize(leads, min);
  const recovery = summarize(recoveries, min);
  const rate = (count: number): Metrics['changeFailRate'] => ({
    n,
    count,
    rate: enough ? round1((count / n) * 100) : null,
  });

  return {
    period: {
      since: period.since.toISOString(),
      until: period.until.toISOString(),
      days: round1(days),
    },
    deploymentFrequency: { n, perWeek: enough && days > 0 ? round1(n / (days / 7)) : null },
    changeLeadTime: { n: leads.length, undeployed, medianHours: lead.median, p90Hours: lead.p90 },
    changeFailRate: rate(countIn(failed)),
    failedDeploymentRecovery: {
      n: recoveries.length,
      source: config.recovery_source,
      medianHours: recovery.median,
      p90Hours: recovery.p90,
    },
    deploymentReworkRate: rate(countIn(rework)),
  };
}
