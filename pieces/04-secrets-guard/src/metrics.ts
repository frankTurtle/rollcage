import { summarize } from '@adl/shared';
import type { AuditRecord } from '@adl/shared';
import type { Decision, LeakAuditEntry } from './types.js';

export interface GuardMetrics {
  blockedPreCommit: number;
  blockedByRule: Record<string, number>;
  /** Lambda decisions, grouped. Every Decision lands in exactly one group. */
  deactivated: number;
  dryRuns: number;
  errors: number;
  skipped: number;
  /** Seconds from the alert being raised to the key being deactivated. */
  leakToDeactivation: { n: number; medianSeconds: number | null; p90Seconds: number | null };
}

type Group = 'deactivated' | 'dryRuns' | 'errors' | 'skipped';

/** Exhaustive: adding a Decision without choosing its group is a compile error. */
const GROUP: Record<Decision, Group> = {
  deactivated: 'deactivated',
  'dry-run': 'dryRuns',
  error: 'errors',
  'ignored-event': 'skipped',
  'no-secret': 'skipped',
  'not-an-access-key': 'skipped',
  'temporary-key': 'skipped',
  'no-allowlist': 'skipped',
  'account-not-allowed': 'skipped',
  'unknown-key': 'skipped',
  'user-out-of-scope': 'skipped',
  'already-inactive': 'skipped',
  'notify-failed': 'errors',
};

/** Counts from the pre-commit log (hash-chained records) and the Lambda audit records. */
export function computeMetrics(precommit: AuditRecord[], lambda: LeakAuditEntry[]): GuardMetrics {
  const blocks = precommit.filter((r) => r.action === 'precommit-block');
  const blockedByRule: Record<string, number> = {};
  for (const r of blocks) {
    for (const [rule, count] of Object.entries(
      (r.detail?.['rules'] ?? {}) as Record<string, number>,
    )) {
      blockedByRule[rule] = (blockedByRule[rule] ?? 0) + count;
    }
  }

  const counts: Record<Group, number> = { deactivated: 0, dryRuns: 0, errors: 0, skipped: 0 };
  for (const e of lambda) counts[GROUP[e.decision]]++;
  const seconds = lambda.flatMap((e) =>
    e.decision === 'deactivated' && e.detail.leakToActionSeconds !== undefined
      ? [e.detail.leakToActionSeconds]
      : [],
  );
  const { median, p90 } = summarize(seconds);
  return {
    blockedPreCommit: blocks.length,
    blockedByRule,
    ...counts,
    leakToDeactivation: { n: seconds.length, medianSeconds: median, p90Seconds: p90 },
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
