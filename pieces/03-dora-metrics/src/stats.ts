import { medianOfSorted, percentileOfSorted, round1 } from '@adl/shared';

/** Median and p90 rounded to one decimal, or nulls when there are fewer than `min` values. */
export function summarize(
  values: number[],
  min: number,
): { median: number | null; p90: number | null } {
  if (values.length < min) return { median: null, p90: null };
  const sorted = [...values].sort((a, b) => a - b);
  return {
    median: round1(medianOfSorted(sorted) as number),
    p90: round1(percentileOfSorted(sorted, 90) as number),
  };
}
