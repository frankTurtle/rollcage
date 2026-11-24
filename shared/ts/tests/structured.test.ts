import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FakeLlm, completeStructured, extractJson } from '../src/index.js';

const schema = z.object({ risk: z.enum(['low', 'high']) });
const fallback = () => ({ risk: 'high' as const });

describe('extractJson', () => {
  it('parses bare and fenced JSON', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('text\n```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(extractJson('```\n{"a":3}\n```')).toEqual({ a: 3 });
  });
});

describe('completeStructured', () => {
  it('returns the validated model output', async () => {
    const llm = new FakeLlm(['{"risk":"low"}']);
    const r = await completeStructured(llm, { prompt: 'p' }, schema, fallback);
    expect(r).toEqual({ value: { risk: 'low' }, source: 'model', attempts: 1 });
  });

  it('retries once on invalid output, then succeeds', async () => {
    const llm = new FakeLlm(['{"risk":"medium"}', '{"risk":"low"}']);
    const r = await completeStructured(llm, { prompt: 'p' }, schema, fallback);
    expect(r.source).toBe('model');
    expect(r.attempts).toBe(2);
  });

  it('falls back after two invalid outputs and says why', async () => {
    const llm = new FakeLlm(['not json', '{"risk":"nope"}']);
    const r = await completeStructured(llm, { prompt: 'p' }, schema, fallback);
    expect(r.source).toBe('fallback');
    expect(r.value).toEqual({ risk: 'high' });
    expect(r.reason).toContain('schema validation failed');
  });

  it('falls back when the model is unavailable', async () => {
    const llm = new FakeLlm([new Error('unavailable'), new Error('unavailable')]);
    const r = await completeStructured(llm, { prompt: 'p' }, schema, fallback);
    expect(r).toMatchObject({ source: 'fallback', reason: 'unavailable' });
  });

  it('records a non-Error failure generically', async () => {
    const llm = { complete: () => Promise.reject('weird') };
    const r = await completeStructured(llm, { prompt: 'p' }, schema, fallback);
    expect(r.reason).toBe('call failed');
  });
});
