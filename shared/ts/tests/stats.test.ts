import { describe, expect, it } from 'vitest';
import { median, percentile, round1 } from '../src/index.js';

describe('stats', () => {
  it('median and nearest-rank percentile', () => {
    expect(median([])).toBeNull();
    expect(median([5])).toBe(5);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(percentile([], 90)).toBeNull();
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
    expect(percentile([7], 90)).toBe(7);
    expect(percentile([3, 1, 2], 0)).toBe(1);
  });
});

describe('round1', () => {
  it('rounds to one decimal', () => {
    expect(round1(2.345)).toBe(2.3);
    expect(round1(2.35)).toBe(2.4);
    expect(round1(5)).toBe(5);
  });
});
