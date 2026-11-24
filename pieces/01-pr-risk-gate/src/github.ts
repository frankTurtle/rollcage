import { COMMENT_MARKER } from './comment.js';
import type { GateIO, PrContext, PrMeta } from './types.js';

export interface PrRef {
  owner: string;
  repo: string;
  number: number;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

interface Review {
  state: string;
  user: { login: string; type?: string } | null;
}

/**
 * Small GitHub REST client. It reads PRs and creates or updates one issue comment.
 * It has no method to approve, merge, or push, so the gate cannot do those things.
 */
export class GitHubApi {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly baseUrl = 'https://api.github.com',
  ) {}

  private async request(
    method: string,
    path: string,
    opts: { accept?: string; body?: unknown } = {},
  ): Promise<Response> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        accept: opts.accept ?? 'application/vnd.github+json',
        'x-github-api-version': '2026-03-10',
        ...(opts.body ? { 'content-type': 'application/json' } : {}),
      },
      ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
    });
    if (!res.ok) {
      // Status only. Response bodies are not echoed.
      throw new Error(
        `GitHub API ${method} ${path.split('?')[0]} failed with status ${res.status}`,
      );
    }
    return res;
  }

  private async paginate<T>(path: string): Promise<T[]> {
    const all: T[] = [];
    for (let page = 1; page <= 10; page++) {
      const res = await this.request('GET', `${path}?per_page=100&page=${page}`);
      const items = (await res.json()) as T[];
      all.push(...items);
      if (items.length < 100) break;
    }
    return all;
  }

  async getPull(ref: PrRef): Promise<PrMeta> {
    const res = await this.request('GET', `/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`);
    const pr = (await res.json()) as {
      number: number;
      title: string;
      user: { login: string };
      labels: { name: string }[];
    };
    return {
      number: pr.number,
      title: pr.title,
      author: pr.user.login,
      labels: pr.labels.map((l) => l.name),
    };
  }

  async getDiff(ref: PrRef): Promise<string> {
    const res = await this.request('GET', `/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`, {
      accept: 'application/vnd.github.diff',
    });
    return res.text();
  }

  /** Logins whose most recent approving or rejecting review is an approval. Bots are excluded. */
  async getApprovers(ref: PrRef): Promise<string[]> {
    const reviews = await this.paginate<Review>(
      `/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}/reviews`,
    );
    const latest = new Map<string, string>();
    for (const r of reviews) {
      if (!r.user || r.user.type === 'Bot') continue;
      if (r.state === 'COMMENTED' || r.state === 'PENDING') continue;
      latest.set(r.user.login, r.state);
    }
    return [...latest].filter(([, state]) => state === 'APPROVED').map(([login]) => login);
  }

  /** Create the gate's comment, or update it in place if one with the marker already exists. */
  async upsertComment(ref: PrRef, body: string): Promise<'created' | 'updated'> {
    const base = `/repos/${ref.owner}/${ref.repo}/issues`;
    const comments = await this.paginate<{ id: number; body?: string }>(
      `${base}/${ref.number}/comments`,
    );
    const existing = comments.find((c) => c.body?.includes(COMMENT_MARKER));
    if (existing) {
      await this.request('PATCH', `${base}/comments/${existing.id}`, { body: { body } });
      return 'updated';
    }
    await this.request('POST', `${base}/${ref.number}/comments`, { body: { body } });
    return 'created';
  }
}

/** Reads a PR from GitHub. Publishes to GitHub, or only reads when `dryRun` is set. */
export class GitHubIO implements GateIO {
  constructor(
    private readonly api: GitHubApi,
    private readonly ref: PrRef,
    private readonly dryRun: boolean,
    private readonly print: (text: string) => void,
  ) {}

  async load(): Promise<PrContext> {
    const [meta, diff, approvals] = await Promise.all([
      this.api.getPull(this.ref),
      this.api.getDiff(this.ref),
      this.api.getApprovers(this.ref),
    ]);
    return { meta, diff, approvals };
  }

  async publish(body: string): Promise<string> {
    if (this.dryRun) {
      this.print(body);
      return 'dry-run (printed, not posted)';
    }
    return this.api.upsertComment(this.ref, body);
  }
}
