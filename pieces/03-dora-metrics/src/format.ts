import { isoDay } from './dates.js';
import type { Report, Row } from './schema.js';

/** "12.3", or "n/a" when the value is missing. */
export const num = (v: number | null): string => (v === null ? 'n/a' : String(v));

/** "12.5%" for percentages, "12.5 hours" otherwise. */
export const withUnit = (v: number | null, unit: string): string =>
  v === null ? 'n/a' : unit === '%' ? `${v}%` : `${v} ${unit}`;

export const VERDICT_WORD: Record<Row['verdict'], string> = {
  better: 'better',
  worse: 'worse',
  same: 'about the same',
  insufficient: 'insufficient data',
};

export function changeText(row: Row): string {
  if (row.changePct === null) return row.verdict === 'insufficient' ? '' : 'n/a';
  return `${row.changePct > 0 ? '+' : ''}${row.changePct}%`;
}

export function periodLabel(report: Report, name: 'all' | 'before' | 'after'): string {
  const p = report.periods.find((x) => x.name === name);
  if (!p) return name;
  return `${isoDay(p.metrics.period.since)} to ${isoDay(p.metrics.period.until)}`;
}
