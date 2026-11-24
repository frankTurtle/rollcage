import { describe, expect, it } from 'vitest';
import { COMMENT_MARKER } from '../src/comment.ts';
import { GitHubApi, GitHubIO } from '../src/github.ts';
import type { PrRef } from '../src/github.ts';

const ref: PrRef = { owner: 'o', repo: 'r', number: 5 };

interface Call {
  method: string;
  url: string;
  body?: unknown;
}

/** Fake GitHub: routes by method and path, records every call. */
function fakeGitHub(routes: Record<string, (call: Call) => unknown>) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init: RequestInit) => {
    const call: Call = {
      method: init.method ?? 'GET',
      url: url.replace('https://api.github.com', ''),
      ...(init.body ? { body: JSON.parse(String(init.body)) } : {}),
    };
    calls.push(call);
    const key = `${call.method} ${call.url.split('?')[0]}`;
    const route = routes[key];
    if (!route) return new Response('not found', { status: 404 });
    const result = route(call);
    return typeof result === 'string' ? new Response(result) : new Response(JSON.stringify(result));
  };
  return { api: new GitHubApi('test-token-not-real', fetchImpl), calls };
}

const pull = {
  number: 5,
  title: 'T',
  user: { login: 'dev' },
  labels: [{ name: 'x' }, { name: 'y' }],
};

describe('GitHubApi reads', () => {
  it('maps PR metadata and sends auth and API version headers', async () => {
    let headers: Headers | undefined;
    const api = new GitHubApi('test-token-not-real', async (_u, init) => {
      headers = new Headers(init.headers);
      return new Response(JSON.stringify(pull));
    });
    expect(await api.getPull(ref)).toEqual({
      number: 5,
      title: 'T',
      author: 'dev',
      labels: ['x', 'y'],
    });
    expect(headers?.get('authorization')).toBe('Bearer test-token-not-real');
    expect(headers?.get('x-github-api-version')).toBe('2022-11-28');
  });

  it('requests the diff media type', async () => {
    let accept = '';
    const api = new GitHubApi('t', async (_u, init) => {
      accept = new Headers(init.headers).get('accept') ?? '';
      return new Response('diff --git a/x b/x');
    });
    expect(await api.getDiff(ref)).toContain('diff --git');
    expect(accept).toBe('application/vnd.github.diff');
  });

  it('counts the latest review per human; comments and bots do not count', async () => {
    const reviews = [
      { state: 'APPROVED', user: { login: 'a', type: 'User' } },
      { state: 'CHANGES_REQUESTED', user: { login: 'b', type: 'User' } },
      { state: 'APPROVED', user: { login: 'b', type: 'User' } },
      { state: 'APPROVED', user: { login: 'c', type: 'User' } },
      { state: 'DISMISSED', user: { login: 'c', type: 'User' } },
      { state: 'APPROVED', user: { login: 'bot', type: 'Bot' } },
      { state: 'COMMENTED', user: { login: 'a', type: 'User' } },
      { state: 'PENDING', user: { login: 'd', type: 'User' } },
      { state: 'APPROVED', user: null },
    ];
    const { api } = fakeGitHub({ 'GET /repos/o/r/pulls/5/reviews': () => reviews });
    expect(await api.getApprovers(ref)).toEqual(['a', 'b']);
  });

  it('paginates until a short page', async () => {
    const page = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ state: 'APPROVED', user: { login: `u${i}` } }));
    const { api, calls } = fakeGitHub({
      'GET /repos/o/r/pulls/5/reviews': (c) => (c.url.includes('&page=1') ? page(100) : page(3)),
    });
    expect((await api.getApprovers(ref)).length).toBe(100);
    expect(calls).toHaveLength(2);
  });

  it('reports status only on failure, never the body', async () => {
    const api = new GitHubApi('t', async () => new Response('secret body', { status: 403 }));
    const err = await api.getPull(ref).catch((e: Error) => e);
    expect((err as Error).message).toBe('GitHub API GET /repos/o/r/pulls/5 failed with status 403');
  });
});

describe('AC-9 upsertComment', () => {
  it('creates when no marker comment exists', async () => {
    const { api, calls } = fakeGitHub({
      'GET /repos/o/r/issues/5/comments': () => [{ id: 1, body: 'unrelated' }, { id: 2 }],
      'POST /repos/o/r/issues/5/comments': () => ({}),
    });
    expect(await api.upsertComment(ref, 'body')).toBe('created');
    expect(calls.at(-1)).toMatchObject({ method: 'POST', body: { body: 'body' } });
  });

  it('updates in place when a marker comment exists', async () => {
    const { api, calls } = fakeGitHub({
      'GET /repos/o/r/issues/5/comments': () => [{ id: 9, body: `${COMMENT_MARKER}\nold` }],
      'PATCH /repos/o/r/issues/comments/9': () => ({}),
    });
    expect(await api.upsertComment(ref, 'new')).toBe('updated');
    expect(calls.map((c) => c.method)).toEqual(['GET', 'PATCH']);
  });
});

describe('AC-10 the client cannot approve, merge or write code', () => {
  it('only GETs plus comment POST/PATCH are ever issued', async () => {
    const { api, calls } = fakeGitHub({
      'GET /repos/o/r/pulls/5': () => pull,
      'GET /repos/o/r/pulls/5/reviews': () => [],
      'GET /repos/o/r/issues/5/comments': () => [],
      'POST /repos/o/r/issues/5/comments': () => ({}),
    });
    const io = new GitHubIO(api, ref, false, () => undefined);
    await io.load();
    await io.publish('x');
    for (const c of calls) {
      const allowed =
        c.method === 'GET' ||
        (c.method === 'POST' && /\/issues\/\d+\/comments$/.test(c.url)) ||
        (c.method === 'PATCH' && /\/issues\/comments\/\d+$/.test(c.url));
      expect(allowed, `${c.method} ${c.url}`).toBe(true);
    }
    expect(
      Object.getOwnPropertyNames(GitHubApi.prototype).filter((n) =>
        /^(approve|merge|push|dismiss)/i.test(n),
      ),
    ).toEqual([]);
  });

  it('dry-run prints instead of posting', async () => {
    const { api, calls } = fakeGitHub({
      'GET /repos/o/r/pulls/5': () => pull,
      'GET /repos/o/r/pulls/5/reviews': () => [],
    });
    const printed: string[] = [];
    const io = new GitHubIO(api, ref, true, (t) => printed.push(t));
    await io.load();
    expect(await io.publish('hello')).toContain('dry-run');
    expect(printed).toEqual(['hello']);
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });
});
