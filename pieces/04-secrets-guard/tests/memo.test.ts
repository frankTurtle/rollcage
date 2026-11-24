import { describe, expect, it } from 'vitest';
import { lazy, remember } from '../src/lambda/memo.ts';

describe('lazy', () => {
  it('builds once, on first use', () => {
    let built = 0;
    const get = lazy(() => ++built);
    expect(built).toBe(0);
    expect([get(), get()]).toEqual([1, 1]);
    expect(built).toBe(1);
  });
});

describe('remember', () => {
  it('keeps a successful result', async () => {
    let calls = 0;
    const get = remember(async () => ++calls);
    expect([await get(), await get()]).toEqual([1, 1]);
  });

  it('does not keep a failure, so the next call tries again', async () => {
    let calls = 0;
    const get = remember(async () => {
      if (++calls === 1) throw new Error('throttled');
      return 'ok';
    });
    await expect(get()).rejects.toThrow('throttled');
    expect(await get()).toBe('ok');
    expect(await get()).toBe('ok');
    expect(calls).toBe(2);
  });
});
