import type { Metrics, Row } from './schema.js';
import { round1 } from './stats.js';

/** Changes smaller than this (relative, percent) are reported as "same". */
export const SAME_THRESHOLD_PCT = 5;

/** The five headline numbers: how to find each in a Metrics object, and which direction is better. */
export const METRIC_ROWS: {
  key: Row['key'];
  label: string;
  unit: string;
  betterWhen: Row['betterWhen'];
  pick: (m: Metrics) => { value: number | null; n: number };
}[] = [
  {
    key: 'deploymentFrequency',
    label: 'Deployment frequency',
    unit: 'per week',
    betterWhen: 'higher',
    pick: (m) => ({ value: m.deploymentFrequency.perWeek, n: m.deploymentFrequency.n }),
  },
  {
    key: 'changeLeadTime',
    label: 'Change lead time (median)',
    unit: 'hours',
    betterWhen: 'lower',
    pick: (m) => ({ value: m.changeLeadTime.medianHours, n: m.changeLeadTime.n }),
  },
  {
    key: 'changeFailRate',
    label: 'Change fail rate',
    unit: '%',
    betterWhen: 'lower',
    pick: (m) => ({ value: m.changeFailRate.rate, n: m.changeFailRate.n }),
  },
  {
    key: 'failedDeploymentRecovery',
    label: 'Failed deployment recovery time (median)',
    unit: 'hours',
    betterWhen: 'lower',
    pick: (m) => ({
      value: m.failedDeploymentRecovery.medianHours,
      n: m.failedDeploymentRecovery.n,
    }),
  },
  {
    key: 'deploymentReworkRate',
    label: 'Deployment rework rate',
    unit: '%',
    betterWhen: 'lower',
    pick: (m) => ({ value: m.deploymentReworkRate.rate, n: m.deploymentReworkRate.n }),
  },
];

function judge(before: number | null, after: number | null, betterWhen: Row['betterWhen']) {
  if (before === null || after === null)
    return { changePct: null, verdict: 'insufficient' as const };
  if (before === after) return { changePct: 0, verdict: 'same' as const };
  const changePct = before === 0 ? null : round1(((after - before) / before) * 100);
  if (changePct !== null && Math.abs(changePct) < SAME_THRESHOLD_PCT) {
    return { changePct, verdict: 'same' as const };
  }
  const improved = betterWhen === 'higher' ? after > before : after < before;
  return { changePct, verdict: improved ? ('better' as const) : ('worse' as const) };
}

/** One row per metric: the headline value before and after, and whether that is better or worse. */
export function compareMetrics(before: Metrics, after: Metrics): Row[] {
  return METRIC_ROWS.map(({ pick, ...meta }) => {
    const b = pick(before);
    const a = pick(after);
    return {
      ...meta,
      before: b.value,
      after: a.value,
      nBefore: b.n,
      nAfter: a.n,
      ...judge(b.value, a.value, meta.betterWhen),
    };
  });
}
