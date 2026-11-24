import { existsSync, mkdirSync, mkdtempSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { withLock } from '../src/index.js';

describe('withLock', () => {
  it('serializes, releases, and returns the result', () => {
    const lock = join(mkdtempSync(join(tmpdir(), 'lk-')), 'nested', 'x.lock');
    expect(withLock(lock, () => 42)).toBe(42);
    expect(existsSync(lock)).toBe(false);
    expect(() =>
      withLock(lock, () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(existsSync(lock)).toBe(false);
  });

  it('times out on a live lock and recovers a stale one', () => {
    const lock = join(mkdtempSync(join(tmpdir(), 'lk-')), 'x.lock');
    mkdirSync(lock);
    expect(() => withLock(lock, () => 1, { timeoutMs: 60, staleMs: 60_000 })).toThrow('timed out');
    const old = new Date(Date.now() - 60_000);
    utimesSync(lock, old, old);
    expect(withLock(lock, () => 'recovered', { staleMs: 1000 })).toBe('recovered');
  });

  it('rethrows unexpected filesystem errors', () => {
    expect(() => withLock('/dev/null/x.lock', () => 1)).toThrow();
  });
});
