import { medianOfSorted, percentileOfSorted, round1 } from '@adl/shared';
import type { AuditRecord } from '@adl/shared';
import type { AuditEntry } from './lambda/ports.js';

export interface GuardMetrics {
  blockedPreCommit: number;
  blockedByRule: Record<string, number>;
  /** Lambda decisions: deactivated, dry-run, error, and everything else (skipped). */
  deactivated: number;
  dryRuns: number;
  errors: number;
  skipped: number;
  /** Seconds from the alert being raised to the key being deactivated. */
  leakToDeactivation: { n: number; medianSeconds: number | null; p90Seconds: number | null };
}

/** Counts from the pre-commit log (hash-chained records) and the Lambda audit records. */
export function computeMetrics(precommit: AuditRecord[], lambda: AuditEntry[]): GuardMetrics {
  const blockedByRule: Record<string, number> = {};
  let blockedPreCommit = 0;
  for (const r of precommit) {
    if (r.action !== 'precommit-block') continue;
    blockedPreCommit++;
    const rules = r.detail?.['rules'];
    for (const [rule, count] of Object.entries((rules ?? {}) as Record<string, number>)) {
      blockedByRule[rule] = (blockedByRule[rule] ?? 0) + count;
    }
  }

  const seconds: number[] = [];
  let deactivated = 0;
  let dryRuns = 0;
  let errors = 0;
  let skipped = 0;
  for (const e of lambda) {
    if (e.decision === 'deactivated') {
      deactivated++;
      if (typeof e.detail.leakToActionSeconds === 'number')
        seconds.push(e.detail.leakToActionSeconds);
    } else if (e.decision === 'dry-run') dryRuns++;
    else if (e.decision === 'error') errors++;
    else skipped++;
  }
  seconds.sort((a, b) => a - b);
  const med = medianOfSorted(seconds);
  const p90 = percentileOfSorted(seconds, 90);
  return {
    blockedPreCommit,
    blockedByRule,
    deactivated,
    dryRuns,
    errors,
    skipped,
    leakToDeactivation: {
      n: seconds.length,
      medianSeconds: med === null ? null : round1(med),
      p90Seconds: p90 === null ? null : round1(p90),
    },
  };
}

export function formatMetrics(label: string, m: GuardMetrics): string {
  const s = (v: number | null) => (v === null ? 'n/a' : `${v}s`);
  const rules = Object.entries(m.blockedByRule)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `    ${k}: ${v}`);
  return [
    label,
    `  Leaks blocked at pre-commit: ${m.blockedPreCommit}`,
    ...(rules.length ? ['  By rule:', ...rules] : []),
    `  Keys deactivated: ${m.deactivated}   dry runs: ${m.dryRuns}   skipped: ${m.skipped}   errors: ${m.errors}`,
    `  Alert to deactivation: median ${s(m.leakToDeactivation.medianSeconds)}, p90 ${s(m.leakToDeactivation.p90Seconds)} (n=${m.leakToDeactivation.n})`,
  ].join('\n');
}
