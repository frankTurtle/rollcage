/** Median of a sorted array, or null when it is empty. */
export function medianOfSorted(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

export function median(values: number[]): number | null {
  return medianOfSorted([...values].sort((a, b) => a - b));
}

/** Nearest-rank percentile (p in 0..100) of a sorted array, or null when it is empty. */
export function percentileOfSorted(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.max(1, Math.ceil((p / 100) * sorted.length)) - 1] as number;
}

export function percentile(values: number[], p: number): number | null {
  return percentileOfSorted(
    [...values].sort((a, b) => a - b),
    p,
  );
}

/** Round to one decimal place. */
export const round1 = (n: number): number => Math.round(n * 10) / 10;
