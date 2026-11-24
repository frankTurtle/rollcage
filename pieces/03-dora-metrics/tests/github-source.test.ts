import { describe, expect, it } from 'vitest';
import { loadDoraConfig } from '../src/config.ts';
import { GitHubSource, RequestBudgetError } from '../src/github-source.ts';
import { fixture, range } from './helpers.ts';

type Handler = (query: URLSearchParams) => unknown;

/** Fake GitHub: routes by path, records every call, answers with recorded response shapes. */
function fakeGitHub(
  routes: Record<string, Handler>,
  status = 200,
  headers: Record<string, string> = {},
) {
  const calls: { method: string; path: string; query: URLSearchParams; headers: Headers }[] = [];
  const fetchImpl = async (url: string, init: RequestInit) => {
    const u = new URL(url);
    calls.push({
      method: init.method ?? 'GET',
      path: u.pathname,
      query: u.searchParams,
      headers: new Headers(init.headers),
    });
    if (status !== 200) return new Response('secret body', { status, headers });
    const route = routes[u.pathname];
    if (!route) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(route(u.searchParams)));
  };
  return { fetchImpl, calls };
}

const R = (p: string) => `/repos/o/r${p}`;
const span = range('2026-01-01', '2026-02-01');
const source = (yaml: string, routes: Record<string, Handler>) => {
  const fake = fakeGitHub(routes);
  const gh = new GitHubSource(
    { owner: 'o', name: 'r' },
    'test-token-not-real',
    loadDoraConfig(yaml),
    fake.fetchImpl,
  );
  return { gh, ...fake };
};

describe('AC-6 deployments from the Deployments API', () => {
  const routes: Record<string, Handler> = {
    [R('/deployments')]: () => fixture('deployments.json'),
    [R('/deployments/1/statuses')]: () => fixture('statuses-1.json'),
    [R('/deployments/2/statuses')]: () => fixture('statuses-2.json'),
    [R('/deployments/3/statuses')]: () => fixture('statuses-3.json'),
    [R('/deployments/4/statuses')]: () => fixture('statuses-4.json'),
  };

  it('builds deployments: success time is the success status, failures are kept, unknown are skipped', async () => {
    const full = { ...routes, [R('/pulls')]: () => [], [R('/issues')]: () => [] };
    const { gh } = source('', full);
    const data = await gh.load(span);
    const byId = Object.fromEntries(data.deployments.map((d) => [d.id, d]));
    expect(byId['1']).toMatchObject({ status: 'success', at: '2026-01-05T10:06:00Z', sha: 'sha1' });
    expect(byId['2']).toMatchObject({ status: 'failure', at: '2026-01-10T10:09:00Z' });
    expect(byId['4']).toMatchObject({ status: 'failure' });
    expect(byId['3']).toBeUndefined();
    expect(gh.warnings.join(' ')).toContain('1 deployment(s) had no success or failure status');
  });

  it('sends the environment, auth and API version headers, and only GETs', async () => {
    const full = { ...routes, [R('/pulls')]: () => [], [R('/issues')]: () => [] };
    const { gh, calls } = source('deployments:\n  environment: staging\n', full);
    await gh.load(span);
    const list = calls.find((c) => c.path === R('/deployments'));
    expect(list?.query.get('environment')).toBe('staging');
    expect(list?.query.get('per_page')).toBe('100');
    expect(list?.headers.get('authorization')).toBe('Bearer test-token-not-real');
    expect(list?.headers.get('x-github-api-version')).toBe('2026-03-10');
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
    expect(gh.requestCount).toBe(calls.length);
  });
});

describe('AC-6 deployments from releases and workflow runs', () => {
  it('uses published, non-draft, non-prerelease releases in range', async () => {
    const { gh } = source('deployments:\n  source: releases\n', {
      [R('/releases')]: () => fixture('releases.json'),
      [R('/pulls')]: () => [],
      [R('/issues')]: () => [],
    });
    const { deployments } = await gh.load(span);
    expect(deployments).toEqual([
      { id: 'v2', sha: 'abc', at: '2026-01-14T10:00:00Z', status: 'success' },
    ]);
  });

  it('maps workflow run conclusions and ignores cancelled runs and runs out of range', async () => {
    const { gh, calls } = source(
      'deployments:\n  source: workflow-runs\n  workflow: ship.yml\n  branch: trunk\n',
      {
        [R('/actions/workflows/ship.yml/runs')]: () => fixture('runs.json'),
        [R('/pulls')]: () => [],
        [R('/issues')]: () => [],
      },
    );
    const { deployments } = await gh.load(span);
    expect(deployments.map((d) => [d.id, d.status])).toEqual([
      ['501', 'success'],
      ['502', 'failure'],
      ['504', 'failure'],
    ]);
    const runs = calls.find((c) => c.path.endsWith('/runs'));
    expect(runs?.query.get('branch')).toBe('trunk');
    expect(runs?.query.get('status')).toBe('completed');
    expect(runs?.query.get('created')).toBe('2026-01-01..2026-02-01');
  });

  it('warns when the workflow run list hits the 1,000 result limit', async () => {
    const page = Array.from({ length: 100 }, (_, i) => ({
      id: i,
      head_sha: 's',
      conclusion: 'success',
      updated_at: '2026-01-05T00:00:00Z',
    }));
    const { gh } = source('deployments:\n  source: workflow-runs\n', {
      [R('/actions/workflows/deploy.yml/runs')]: () => ({ workflow_runs: page }),
      [R('/pulls')]: () => [],
      [R('/issues')]: () => [],
    });
    await gh.load(span);
    expect(gh.warnings.join(' ')).toContain('1,000 result limit');
  });
});

describe('AC-6 changes and incidents', () => {
  const routes: Record<string, Handler> = {
    [R('/releases')]: () => [],
    [R('/pulls')]: () => fixture('pulls.json'),
    [R('/pulls/10/commits')]: () => fixture('pull-commits-10.json'),
    [R('/pulls/12/commits')]: () => fixture('pull-commits-12.json'),
    [R('/issues')]: () => fixture('issues.json'),
  };
  const load = () => source('deployments:\n  source: releases\n', routes);

  it('keeps merged pull requests in range and takes the earliest commit date, whatever the order', async () => {
    const { gh } = load();
    const { changes } = await gh.load(span);
    expect(changes).toEqual([
      {
        id: 12,
        title: 'Revert "Add cart"',
        labels: ['revert'],
        firstCommitAt: '2026-01-11T08:30:00Z',
        mergedAt: '2026-01-11T09:00:00Z',
      },
      {
        id: 10,
        title: 'Add cart',
        labels: ['feature'],
        firstCommitAt: '2026-01-03T09:00:00Z',
        mergedAt: '2026-01-04T16:00:00Z',
      },
    ]);
  });

  it('falls back to the merge time when a PR has no commit dates', async () => {
    const { gh } = source('deployments:\n  source: releases\n', {
      ...routes,
      [R('/pulls/10/commits')]: () => [],
    });
    const { changes } = await gh.load(span);
    expect(changes.find((c) => c.id === 10)?.firstCommitAt).toBe('2026-01-04T16:00:00Z');
  });

  it('filters pull requests out of the issue list and respects the range', async () => {
    const { gh, calls } = load();
    const { incidents } = await gh.load(span);
    expect(incidents).toEqual([
      { id: 30, openedAt: '2026-01-10T11:00:00Z', closedAt: '2026-01-10T15:00:00Z' },
      { id: 31, openedAt: '2026-01-12T11:00:00Z', closedAt: null },
    ]);
    const q = calls.find((c) => c.path === R('/issues'))?.query;
    expect(q?.get('labels')).toBe('incident');
    expect(q?.get('state')).toBe('all');
    expect(q?.get('since')).toBe('2026-01-01T00:00:00.000Z');
  });

  it('paginates until a short page', async () => {
    const issue = (n: number) => ({
      number: n,
      created_at: '2026-01-10T00:00:00Z',
      closed_at: null,
    });
    const { gh, calls } = source('deployments:\n  source: releases\n', {
      ...routes,
      [R('/issues')]: (q) =>
        q.get('page') === '1'
          ? Array.from({ length: 100 }, (_, i) => issue(i))
          : [issue(500), issue(501)],
    });
    const { incidents } = await gh.load(span);
    expect(incidents).toHaveLength(102);
    expect(calls.filter((c) => c.path === R('/issues'))).toHaveLength(2);
  });
});

describe('AC-6 limits and errors', () => {
  it('stops at the request budget with a clear message', async () => {
    const { gh } = source('max_requests: 2\ndeployments:\n  source: releases\n', {
      [R('/releases')]: () => [],
      [R('/pulls')]: () => [],
      [R('/issues')]: () => [],
    });
    await expect(gh.load(span)).rejects.toBeInstanceOf(RequestBudgetError);
    await expect(gh.load(span)).rejects.toThrow('Raise max_requests');
  });

  it('reports the status and rate-limit reset, never the body', async () => {
    const { fetchImpl } = fakeGitHub({}, 403, {
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': '1767225600',
    });
    const gh = new GitHubSource(
      { owner: 'o', name: 'r' },
      't',
      loadDoraConfig('deployments:\n  source: releases\n'),
      fetchImpl,
    );
    const err = await gh.load(span).catch((e: Error) => e);
    expect((err as Error).message).toContain('status 403');
    expect((err as Error).message).toContain('rate limit reached');
    expect((err as Error).message).not.toContain('secret body');
    const plain = fakeGitHub({}, 500);
    const gh2 = new GitHubSource(
      { owner: 'o', name: 'r' },
      't',
      loadDoraConfig('deployments:\n  source: releases\n'),
      plain.fetchImpl,
    );
    expect(((await gh2.load(span).catch((e: Error) => e)) as Error).message).toBe(
      'GitHub API GET /repos/o/r/releases failed with status 500',
    );
  });
});
