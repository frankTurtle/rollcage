import { GitHubHttp } from '@adl/shared';
import type { FetchLike } from '@adl/shared';
import { COMMENT_MARKER } from './comment.js';
import type { GateIO, PrContext, PrMeta } from './types.js';

export interface PrRef {
  owner: string;
  repo: string;
  number: number;
}

interface Review {
  state: string;
  user: { login: string; type?: string } | null;
}

/**
 * Small GitHub REST client. It reads PRs and creates or updates one issue comment.
 * It has no method to approve, merge, or push, so the gate cannot do those things.
 */
export class GitHubApi {
  private readonly http: GitHubHttp;

  constructor(token: string, fetchImpl?: FetchLike, baseUrl?: string) {
    this.http = new GitHubHttp(token, fetchImpl, baseUrl);
  }

  private listAll<T>(path: string): Promise<T[]> {
    return this.http.paginate<T[], T>(path, {}, (b) => b, { maxPages: 10 });
  }

  async getPull(ref: PrRef): Promise<PrMeta> {
    const pr = await this.http.json<{
      number: number;
      title: string;
      user: { login: string };
      labels: { name: string }[];
    }>(`/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`);
    return {
      number: pr.number,
      title: pr.title,
      author: pr.user.login,
      labels: pr.labels.map((l) => l.name),
    };
  }

  async getDiff(ref: PrRef): Promise<string> {
    const res = await this.http.request(
      'GET',
      `/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`,
      {
        accept: 'application/vnd.github.diff',
      },
    );
    return res.text();
  }

  /** Logins whose most recent approving or rejecting review is an approval. Bots are excluded. */
  async getApprovers(ref: PrRef): Promise<string[]> {
    const reviews = await this.listAll<Review>(
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
    const comments = await this.listAll<{ id: number; body?: string }>(
      `${base}/${ref.number}/comments`,
    );
    const existing = comments.find((c) => c.body?.includes(COMMENT_MARKER));
    if (existing) {
      await this.http.request('PATCH', `${base}/comments/${existing.id}`, { body: { body } });
      return 'updated';
    }
    await this.http.request('POST', `${base}/${ref.number}/comments`, { body: { body } });
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
