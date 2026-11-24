/** Median of the values, or null when there are none. Expects a sorted array. */
function medianOfSorted(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

export function median(values: number[]): number | null {
  return medianOfSorted([...values].sort((a, b) => a - b));
}

/** Nearest-rank percentile (p in 0..100), or null when there are no values. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(1, Math.ceil((p / 100) * sorted.length)) - 1] as number;
}

export const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Median and p90 rounded to one decimal, or nulls when there are fewer than `min` values. */
export function summarize(
  values: number[],
  min: number,
): { median: number | null; p90: number | null } {
  if (values.length < min) return { median: null, p90: null };
  const sorted = [...values].sort((a, b) => a - b);
  const p90 = sorted[Math.max(1, Math.ceil(0.9 * sorted.length)) - 1] as number;
  return { median: round1(medianOfSorted(sorted) as number), p90: round1(p90) };
}
