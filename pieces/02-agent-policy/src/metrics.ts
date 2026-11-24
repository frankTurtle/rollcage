import type { AuditRecord } from '@adl/shared';
import { AUDIT_ACTOR } from './hook.js';

export interface PolicyMetrics {
  totalBlocked: number;
  /** ISO week (for example 2026-W04) to number of blocked calls. */
  blockedByWeek: Record<string, number>;
  blockedByRule: Record<string, number>;
  sessions: number;
  completeSessions: number;
  /** Percent, or null with no sessions. */
  pctComplete: number | null;
  incompleteSessions: string[];
}

export function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

const bump = (m: Record<string, number>, key: string) => {
  m[key] = (m[key] ?? 0) + 1;
};

/**
 * A session has a complete trail when every call the pre hook allowed has a matching post record
 * (success or failure). A session that is still running, or was killed mid-call, shows as incomplete.
 */
export function computeMetrics(records: AuditRecord[]): PolicyMetrics {
  const blockedByWeek: Record<string, number> = {};
  const blockedByRule: Record<string, number> = {};
  let totalBlocked = 0;
  const sessions = new Map<
    string,
    { allowed: Set<string>; done: Set<string>; unmatched: boolean }
  >();

  for (const r of records) {
    if (r.actor !== AUDIT_ACTOR) continue;
    const d = r.detail ?? {};
    const session = typeof d['session'] === 'string' ? d['session'] : 'unknown';
    const toolUseId = typeof d['toolUseId'] === 'string' ? d['toolUseId'] : undefined;
    const s = sessions.get(session) ?? { allowed: new Set(), done: new Set(), unmatched: false };
    sessions.set(session, s);

    if (r.action === 'pre-tool-use' && r.decision === 'deny') {
      totalBlocked++;
      bump(blockedByWeek, isoWeek(new Date(r.timestamp)));
      bump(blockedByRule, typeof d['rule'] === 'string' ? d['rule'] : 'unknown');
    } else if (r.action === 'pre-tool-use') {
      if (toolUseId) s.allowed.add(toolUseId);
      else s.unmatched = true;
    } else if (r.action === 'post-tool-use' && toolUseId) {
      s.done.add(toolUseId);
    }
  }

  const incompleteSessions = [...sessions]
    .filter(([, s]) => s.unmatched || [...s.allowed].some((id) => !s.done.has(id)))
    .map(([id]) => id);
  const total = sessions.size;
  return {
    totalBlocked,
    blockedByWeek,
    blockedByRule,
    sessions: total,
    completeSessions: total - incompleteSessions.length,
    pctComplete:
      total === 0 ? null : Math.round(((total - incompleteSessions.length) / total) * 1000) / 10,
    incompleteSessions,
  };
}

export function formatMetrics(label: string, m: PolicyMetrics): string {
  const rows = (o: Record<string, number>) =>
    Object.entries(o)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `    ${k}: ${v}`);
  const pct = m.pctComplete === null ? 'n/a' : `${m.pctComplete}%`;
  return [
    label,
    `  Blocked risky actions: ${m.totalBlocked}`,
    '  By week:',
    ...(m.totalBlocked ? rows(m.blockedByWeek) : ['    none']),
    '  By rule:',
    ...(m.totalBlocked ? rows(m.blockedByRule) : ['    none']),
    `  Sessions with a complete audit trail: ${m.completeSessions}/${m.sessions} (${pct})`,
  ].join('\n');
}
