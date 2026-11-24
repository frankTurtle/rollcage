import type { Range } from './types.js';

export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

/** Milliseconds since the epoch for an ISO 8601 string. */
export const ms = (iso: string): number => Date.parse(iso);

/** Half-open range check: `since` is included, `until` is not. */
export const inRange = (t: number, r: Range): boolean =>
  t >= r.since.getTime() && t < r.until.getTime();

/** "2026-03-15" for a Date or an ISO string. */
export const isoDay = (d: Date | string): string =>
  (typeof d === 'string' ? d : d.toISOString()).slice(0, 10);

/** Parse a UTC calendar date like 2026-03-15. Impossible dates such as 2026-02-30 are rejected. */
export function parseDate(value: string, flag: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  const valid =
    /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(date.getTime()) && isoDay(date) === value;
  if (!valid) throw new Error(`${flag} must be a date like 2026-03-15`);
  return date;
}
