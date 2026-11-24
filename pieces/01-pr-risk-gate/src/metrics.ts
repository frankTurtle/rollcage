import { readFileSync } from 'node:fs';
import type { AuditRecord } from '@adl/shared';
import { AUDIT_ACTION, AUDIT_ACTOR } from './run.js';

export interface GateMetrics {
  /** Distinct PRs evaluated (each PR counted once, by its latest decision). */
  prs: number;
  highRisk: number;
  highRiskWithTests: number;
  /** Percent, or null when there were no high-risk PRs. */
  pctHighRiskWithTests: number | null;
  /** PRs whose latest decision is a failure. */
  blocked: number;
}

export function readRecords(path: string): AuditRecord[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as AuditRecord);
}

export function computeMetrics(records: AuditRecord[]): GateMetrics {
  const latest = new Map<number, AuditRecord>();
  for (const r of records) {
    if (r.actor !== AUDIT_ACTOR || r.action !== AUDIT_ACTION) continue;
    const pr = r.detail?.['pr'];
    if (typeof pr === 'number') latest.set(pr, r);
  }
  let highRisk = 0;
  let highRiskWithTests = 0;
  let blocked = 0;
  for (const r of latest.values()) {
    if (r.decision === 'fail') blocked++;
    if (r.detail?.['level'] === 'high') {
      highRisk++;
      if (r.detail['hasTests'] === true) highRiskWithTests++;
    }
  }
  return {
    prs: latest.size,
    highRisk,
    highRiskWithTests,
    pctHighRiskWithTests:
      highRisk === 0 ? null : Math.round((highRiskWithTests / highRisk) * 1000) / 10,
    blocked,
  };
}

export function formatMetrics(label: string, m: GateMetrics): string {
  const pct = m.pctHighRiskWithTests === null ? 'n/a' : `${m.pctHighRiskWithTests}%`;
  return [
    label,
    `  PRs evaluated:                     ${m.prs}`,
    `  High-risk PRs:                     ${m.highRisk}`,
    `  High-risk PRs with tests:          ${m.highRiskWithTests}`,
    `  High-risk PRs that shipped w/tests: ${pct}`,
    `  PRs whose latest decision is fail: ${m.blocked}`,
  ].join('\n');
}
