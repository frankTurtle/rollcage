import type { FetchLike } from './fetch.js';

/** The REST API version header sent on every request. One place to bump it. */
export const GITHUB_API_VERSION = '2026-03-10';

export interface RequestOptions {
  query?: Record<string, string | number>;
  accept?: string;
  body?: unknown;
}

/**
 * Minimal GitHub REST transport: auth and version headers, query encoding, pagination, and
 * errors that carry the status (and a rate-limit hint) but never the response body.
 * `beforeRequest` runs before each call, so a caller can count or cap requests.
 */
export class GitHubHttp {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly baseUrl = 'https://api.github.com',
    private readonly beforeRequest: () => void = () => undefined,
  ) {}

  async request(method: string, path: string, opts: RequestOptions = {}): Promise<Response> {
    this.beforeRequest();
    const qs = new URLSearchParams(
      Object.entries(opts.query ?? {}).map(([k, v]): [string, string] => [k, String(v)]),
    );
    const res = await this.fetchImpl(`${this.baseUrl}${path}${qs.size ? `?${qs}` : ''}`, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        accept: opts.accept ?? 'application/vnd.github+json',
        'x-github-api-version': GITHUB_API_VERSION,
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
    if (!res.ok) {
      const limited = res.headers.get('x-ratelimit-remaining') === '0';
      const hint = limited
        ? ` (rate limit reached, resets at epoch ${res.headers.get('x-ratelimit-reset')})`
        : '';
      throw new Error(`GitHub API ${method} ${path} failed with status ${res.status}${hint}`);
    }
    return res;
  }

  async json<T>(path: string, query?: Record<string, string | number>): Promise<T> {
    return (await (await this.request('GET', path, query ? { query } : {})).json()) as T;
  }

  /**
   * GET every page (`per_page=100`) until a short page, `stop` says so, or `maxPages` is reached.
   * `pick` extracts the items from a page body (identity for arrays, `b.items` for objects).
   */
  async paginate<B, T>(
    path: string,
    query: Record<string, string | number>,
    pick: (body: B) => T[],
    opts: { stop?: (items: T[]) => boolean; maxPages?: number } = {},
  ): Promise<T[]> {
    const all: T[] = [];
    for (let page = 1; page <= (opts.maxPages ?? 20); page++) {
      const items = pick(await this.json<B>(path, { ...query, per_page: 100, page }));
      all.push(...items);
      if (items.length < 100 || opts.stop?.(items)) break;
    }
    return all;
  }
}
