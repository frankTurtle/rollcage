import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AnthropicLlm,
  DEFAULT_MODEL,
  FakeLlm,
  RecordReplayLlm,
  canonicalJson,
  isLiveMode,
  requestKey,
  resolveModel,
} from '../src/index.js';

describe('config', () => {
  it('defaults the model and honors ANTHROPIC_MODEL', () => {
    expect(resolveModel({})).toBe(DEFAULT_MODEL);
    expect(resolveModel({ ANTHROPIC_MODEL: '  ' })).toBe(DEFAULT_MODEL);
    expect(resolveModel({ ANTHROPIC_MODEL: 'custom-model' })).toBe('custom-model');
  });

  it('live mode is opt-in', () => {
    expect(isLiveMode({})).toBe(false);
    expect(isLiveMode({ DEMO_LIVE: '0' })).toBe(false);
    expect(isLiveMode({ DEMO_LIVE: '1' })).toBe(true);
  });
});

describe('request keys', () => {
  it('canonical JSON ignores key order', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { y: 1, x: 2 }] } })).toBe(
      canonicalJson({ a: { c: [3, { x: 2, y: 1 }], d: 2 }, b: 1 }),
    );
  });

  it('same request, same key; different prompt, different key', () => {
    expect(requestKey({ prompt: 'a' })).toBe(requestKey({ prompt: 'a', maxTokens: 5 }));
    expect(requestKey({ prompt: 'a' })).not.toBe(requestKey({ prompt: 'b' }));
    expect(requestKey({ prompt: 'a', system: 's' })).not.toBe(requestKey({ prompt: 'a' }));
  });
});

describe('FakeLlm', () => {
  it('returns scripted replies in order and records calls', async () => {
    const fake = new FakeLlm(['one', (r) => `echo:${r.prompt}`]);
    expect((await fake.complete({ prompt: 'x' })).text).toBe('one');
    expect((await fake.complete({ prompt: 'y' })).text).toBe('echo:y');
    expect(fake.calls).toHaveLength(2);
  });

  it('throws a scripted error and when out of replies', async () => {
    const fake = new FakeLlm([new Error('boom')]);
    await expect(fake.complete({ prompt: 'x' })).rejects.toThrow('boom');
    await expect(fake.complete({ prompt: 'x' })).rejects.toThrow('no scripted reply');
  });
});

describe('RecordReplayLlm', () => {
  it('records through a live client, then replays without it', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'adl-')), 'fixtures');
    const live = new FakeLlm(['recorded answer']);
    const recorder = new RecordReplayLlm(dir, 'record', live);
    const first = await recorder.complete({ prompt: 'q' });
    expect(first.text).toBe('recorded answer');
    expect(readdirSync(dir)).toHaveLength(1);

    const replayer = new RecordReplayLlm(dir);
    expect((await replayer.complete({ prompt: 'q' })).text).toBe('recorded answer');
  });

  it('replay fails on a missing fixture and record needs a live client', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'adl-'));
    await expect(new RecordReplayLlm(dir).complete({ prompt: 'nope' })).rejects.toThrow(
      'no recorded fixture',
    );
    expect(() => new RecordReplayLlm(dir, 'record')).toThrow('requires a live client');
  });
});

describe('AnthropicLlm (injected fetch, no network)', () => {
  const ok = (body: unknown) => async () => new Response(JSON.stringify(body), { status: 200 });

  it('requires ANTHROPIC_API_KEY from the environment', () => {
    expect(() => new AnthropicLlm({})).toThrow('ANTHROPIC_API_KEY');
  });

  it('sends the request and joins text blocks', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const client = new AnthropicLlm(
      { ANTHROPIC_API_KEY: 'test-key-not-real', ANTHROPIC_MODEL: 'm-1' },
      async (url, init) => {
        seen = { url, init };
        return new Response(
          JSON.stringify({
            content: [
              { type: 'text', text: 'he' },
              { type: 'text', text: 'llo' },
            ],
          }),
        );
      },
    );
    const res = await client.complete({ system: 'sys', prompt: 'hi', maxTokens: 10 });
    expect(res).toEqual({ text: 'hello', model: 'm-1' });
    expect(seen?.url).toContain('/v1/messages');
    const body = JSON.parse(String(seen?.init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ model: 'm-1', max_tokens: 10, system: 'sys' });
  });

  it('handles missing content and omits system when absent', async () => {
    const client = new AnthropicLlm({ ANTHROPIC_API_KEY: 'k' }, ok({}));
    expect((await client.complete({ prompt: 'hi' })).text).toBe('');
  });

  it('reports status only on failure, never the body', async () => {
    const client = new AnthropicLlm(
      { ANTHROPIC_API_KEY: 'k' },
      async () => new Response('secret-detail', { status: 500 }),
    );
    const err = await client.complete({ prompt: 'x' }).catch((e: Error) => e);
    expect((err as Error).message).toBe('AnthropicLlm: API request failed with status 500');
  });
});
