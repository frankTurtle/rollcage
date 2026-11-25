import { afterEach, describe, expect, it, vi } from 'vitest';
import { bold, green, header, red, runStages, summarize } from '../src/index.js';

afterEach(() => vi.restoreAllMocks());

describe('demo helpers', () => {
  it('colors only on a terminal', () => {
    const original = process.stdout.isTTY;
    process.stdout.isTTY = false;
    expect([bold('a'), red('b'), green('c')]).toEqual(['a', 'b', 'c']);
    process.stdout.isTTY = true;
    expect(bold('a')).toBe('\u001b[1ma\u001b[0m');
    expect(red('b')).toContain('\u001b[31m');
    expect(green('c')).toContain('\u001b[32m');
    process.stdout.isTTY = original;
  });

  it('prints a header', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    header('Title');
    expect(log.mock.calls[0]?.[0]).toContain('== Title ==');
  });

  it('runs all stages in order, one stage, or reports an unknown one', async () => {
    const order: string[] = [];
    const stages = {
      one: () => void order.push('one'),
      two: async () => void order.push('two'),
    };
    expect(await runStages(stages)).toBe(0);
    expect(await runStages(stages, 'two')).toBe(0);
    expect(order).toEqual(['one', 'two', 'two']);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await runStages(stages, 'nope')).toBe(2);
    expect(err.mock.calls[0]?.[0]).toContain('unknown stage: nope');
  });
});

describe('summarize', () => {
  it('gives median and p90, or nulls below the minimum or for no values', () => {
    expect(summarize([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5)).toEqual({ median: 5.5, p90: 9 });
    expect(summarize([3, 1, 2], 4)).toEqual({ median: null, p90: null });
    expect(summarize([])).toEqual({ median: null, p90: null });
    expect(summarize([7])).toEqual({ median: 7, p90: 7 });
  });
});
