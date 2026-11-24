import { describe, expect, it } from 'vitest';
import { GITHUB_API_VERSION, GitHubHttp } from '../src/index.js';

interface Call {
  method: string;
  url: URL;
  headers: Headers;
  body?: unknown;
}

function fake(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init: RequestInit) => {
    const call: Call = {
      method: init.method ?? 'GET',
      url: new URL(url),
      headers: new Headers(init.headers),
      ...(init.body ? { body: JSON.parse(String(init.body)) } : {}),
    };
    calls.push(call);
    return respond(call);
  };
  return { fetchImpl, calls };
}
const ok =
  (body: unknown = {}) =>
  () =>
    new Response(JSON.stringify(body));

describe('GitHubHttp', () => {
  it('sends auth and the pinned API version, encodes the query, and omits a body on GET', async () => {
    const { fetchImpl, calls } = fake(ok({ a: 1 }));
    const http = new GitHubHttp('test-token-not-real', fetchImpl);
    expect(await http.json('/repos/o/r/x', { state: 'all', n: 2 })).toEqual({ a: 1 });
    const c = calls[0] as Call;
    expect(c.url.href).toBe('https://api.github.com/repos/o/r/x?state=all&n=2');
    expect(c.headers.get('authorization')).toBe('Bearer test-token-not-real');
    expect(c.headers.get('x-github-api-version')).toBe(GITHUB_API_VERSION);
    expect(c.headers.get('accept')).toBe('application/vnd.github+json');
    expect(c.headers.has('content-type')).toBe(false);
    expect(c.body).toBeUndefined();
  });

  it('sends a JSON body and a custom accept header, and uses a custom base URL', async () => {
    const { fetchImpl, calls } = fake(ok());
    const http = new GitHubHttp('t', fetchImpl, 'https://ghe.example.test/api');
    await http.request('POST', '/x', {
      body: { hello: 'world' },
      accept: 'application/vnd.github.diff',
    });
    const c = calls[0] as Call;
    expect(c.url.href).toBe('https://ghe.example.test/api/x');
    expect(c.body).toEqual({ hello: 'world' });
    expect(c.headers.get('content-type')).toBe('application/json');
    expect(c.headers.get('accept')).toBe('application/vnd.github.diff');
  });

  it('reports the status only, plus a rate-limit hint, never the body', async () => {
    const limited = new GitHubHttp(
      't',
      fake(
        () =>
          new Response('secret body', {
            status: 403,
            headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1767225600' },
          }),
      ).fetchImpl,
    );
    const err = (await limited.json('/p?x=1').catch((e: Error) => e)) as Error;
    expect(err.message).toBe(
      'GitHub API GET /p?x=1 failed with status 403 (rate limit reached, resets at epoch 1767225600)',
    );
    expect(err.message).not.toContain('secret body');
    const plain = new GitHubHttp('t', fake(() => new Response('x', { status: 500 })).fetchImpl);
    expect(((await plain.json('/p').catch((e: Error) => e)) as Error).message).toBe(
      'GitHub API GET /p failed with status 500',
    );
  });

  it('calls beforeRequest for every request, and a throw there stops the call', async () => {
    const { fetchImpl, calls } = fake(ok());
    let n = 0;
    const http = new GitHubHttp('t', fetchImpl, undefined, () => {
      if (++n > 1) throw new Error('budget');
    });
    await http.json('/a');
    await expect(http.json('/b')).rejects.toThrow('budget');
    expect(calls).toHaveLength(1);
  });

  it('paginates until a short page, a stop signal, or maxPages', async () => {
    const full = Array.from({ length: 100 }, (_, i) => i);
    const { fetchImpl, calls } = fake(
      (c) => new Response(JSON.stringify(c.url.searchParams.get('page') === '3' ? [1] : full)),
    );
    const http = new GitHubHttp('t', fetchImpl);
    expect(await http.paginate<number[], number>('/l', {}, (b) => b)).toHaveLength(201);
    expect(calls.map((c) => c.url.searchParams.get('per_page'))).toEqual(['100', '100', '100']);

    calls.length = 0;
    expect(await http.paginate<number[], number>('/l', {}, (b) => b, { maxPages: 2 })).toHaveLength(
      200,
    );
    expect(calls).toHaveLength(2);

    calls.length = 0;
    await http.paginate<number[], number>('/l', {}, (b) => b, { stop: () => true });
    expect(calls).toHaveLength(1);
  });

  it('picks items out of an object body', async () => {
    const { fetchImpl } = fake(ok({ items: [1, 2] }));
    expect(
      await new GitHubHttp('t', fetchImpl).paginate<{ items: number[] }, number>(
        '/l',
        {},
        (b) => b.items,
      ),
    ).toEqual([1, 2]);
  });
});
