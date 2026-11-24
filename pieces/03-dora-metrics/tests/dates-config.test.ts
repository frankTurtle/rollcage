import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadDoraConfig } from '../src/config.ts';
import { inRange, isoDay, ms, parseDate } from '../src/dates.ts';
import { summarize } from '../src/stats.ts';
import { day, range } from './helpers.ts';

describe('dates', () => {
  it('parseDate accepts real dates and rejects impossible or malformed ones', () => {
    expect(parseDate('2026-03-15', '--x').toISOString()).toBe('2026-03-15T00:00:00.000Z');
    for (const bad of ['2026-02-30', '2026-13-01', '15/03/2026', 'yesterday', '2026-3-5', '']) {
      expect(() => parseDate(bad, '--since')).toThrow('--since must be a date like 2026-03-15');
    }
  });

  it('isoDay takes a Date or an ISO string; ms parses ISO', () => {
    expect(isoDay(day('2026-03-15'))).toBe('2026-03-15');
    expect(isoDay('2026-03-15T10:00:00Z')).toBe('2026-03-15');
    expect(ms('1970-01-01T00:00:01Z')).toBe(1000);
  });

  it('inRange includes since and excludes until', () => {
    const r = range('2026-01-01', '2026-01-02');
    expect(inRange(day('2026-01-01').getTime(), r)).toBe(true);
    expect(inRange(day('2026-01-02').getTime() - 1, r)).toBe(true);
    expect(inRange(day('2026-01-02').getTime(), r)).toBe(false);
    expect(inRange(day('2025-12-31').getTime(), r)).toBe(false);
  });
});

describe('stats.summarize', () => {
  it('gives median and p90, or nulls below the minimum', () => {
    expect(summarize([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5)).toEqual({ median: 5.5, p90: 9 });
    expect(summarize([3, 1, 2], 4)).toEqual({ median: null, p90: null });
    expect(summarize([], 1)).toEqual({ median: null, p90: null });
  });
});

describe('docs match the code', () => {
  it('dora.example.yml sets exactly the defaults', () => {
    const example = readFileSync(join(import.meta.dirname, '..', 'dora.example.yml'), 'utf8');
    expect(loadDoraConfig(example)).toEqual(loadDoraConfig());
  });
});
