import type { DoraConfig } from './config.js';
import type { Change, Deployment, DoraData, Incident, Range, Source } from './types.js';

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export class RequestBudgetError extends Error {}

const API_VERSION = '2026-03-10';
const CHUNK = 5;

interface RawDeployment {
  id: number;
  sha: string;
  created_at: string;
}
interface RawStatus {
  state: string;
  created_at: string;
}
interface RawRelease {
  tag_name: string;
  target_commitish: string;
  published_at: string | null;
  draft: boolean;
  prerelease: boolean;
}
interface RawRun {
  id: number;
  head_sha: string;
  conclusion: string | null;
  updated_at: string;
}
interface RawPull {
  number: number;
  title: string;
  merged_at: string | null;
  updated_at: string;
  labels: { name: string }[];
}
interface RawCommit {
  commit: { author?: { date?: string } | null; committer?: { date?: string } | null };
}
interface RawIssue {
  number: number;
  created_at: string;
  closed_at: string | null;
  pull_request?: unknown;
}

const t = (iso: string): number => Date.parse(iso);

/**
 * Reads deployments, merged pull requests and incident issues from the GitHub REST API (GET only).
 * Ordering of several list endpoints is not documented, so lists are sorted or filtered
 * client-side, and every request counts against `max_requests`.
 */
export class GitHubSource implements Source {
  readonly name = 'github';
  readonly warnings: string[] = [];
  private requests = 0;

  constructor(
    private readonly repo: { owner: string; name: string },
    private readonly token: string,
    private readonly config: DoraConfig,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly baseUrl = 'https://api.github.com',
  ) {}

  get requestCount(): number {
    return this.requests;
  }

  private path(suffix: string): string {
    return `/repos/${this.repo.owner}/${this.repo.name}${suffix}`;
  }

  private async get<T>(path: string, query: Record<string, string | number> = {}): Promise<T> {
    if (++this.requests > this.config.max_requests) {
      throw new RequestBudgetError(
        `Stopped after ${this.config.max_requests} API requests. Raise max_requests, narrow the date range, or use a token with a higher rate limit.`,
      );
    }
    const qs = new URLSearchParams(
      Object.entries(query).map(([k, v]): [string, string] => [k, String(v)]),
    );
    const res = await this.fetchImpl(`${this.baseUrl}${path}${qs.size ? `?${qs}` : ''}`, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${this.token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': API_VERSION,
      },
    });
    if (!res.ok) {
      const limited = res.headers.get('x-ratelimit-remaining') === '0';
      const reset = res.headers.get('x-ratelimit-reset');
      throw new Error(
        `GitHub API GET ${path} failed with status ${res.status}${limited ? ` (rate limit reached, resets at epoch ${reset})` : ''}`,
      );
    }
    return (await res.json()) as T;
  }

  private async pages<B, T>(
    path: string,
    query: Record<string, string | number>,
    pick: (body: B) => T[],
    opts: { stop?: (items: T[]) => boolean; maxPages?: number } = {},
  ): Promise<T[]> {
    const all: T[] = [];
    for (let page = 1; page <= (opts.maxPages ?? 20); page++) {
      const items = pick(await this.get<B>(path, { ...query, per_page: 100, page }));
      all.push(...items);
      if (items.length < 100 || opts.stop?.(items)) break;
    }
    return all;
  }

  async load(range: Range): Promise<DoraData> {
    const deployments = await this.loadDeployments(range);
    const changes = await this.loadChanges(range);
    const incidents = await this.loadIncidents(range);
    return { deployments, changes, incidents };
  }

  private async loadDeployments(range: Range): Promise<Deployment[]> {
    const { source, environment, workflow, branch } = this.config.deployments;
    const inRange = (iso: string) =>
      t(iso) >= range.since.getTime() && t(iso) < range.until.getTime();

    if (source === 'releases') {
      const releases = await this.pages<RawRelease[], RawRelease>(
        this.path('/releases'),
        {},
        (b) => b,
      );
      return releases
        .filter((r) => !r.draft && !r.prerelease && r.published_at && inRange(r.published_at))
        .map((r) => ({
          id: r.tag_name,
          sha: r.target_commitish,
          at: r.published_at as string,
          status: 'success' as const,
        }));
    }

    if (source === 'workflow-runs') {
      const day = (d: Date) => d.toISOString().slice(0, 10);
      const runs = await this.pages<{ workflow_runs: RawRun[] }, RawRun>(
        this.path(`/actions/workflows/${workflow}/runs`),
        { branch, status: 'completed', created: `${day(range.since)}..${day(range.until)}` },
        (b) => b.workflow_runs,
        { maxPages: 10 },
      );
      if (runs.length >= 1000)
        this.warnings.push(
          "The workflow run list hit GitHub's 1,000 result limit; older runs are missing.",
        );
      return runs.flatMap((r): Deployment[] => {
        const status =
          r.conclusion === 'success'
            ? 'success'
            : r.conclusion === 'failure' || r.conclusion === 'timed_out'
              ? 'failure'
              : null;
        return status && inRange(r.updated_at)
          ? [{ id: String(r.id), sha: r.head_sha, at: r.updated_at, status }]
          : [];
      });
    }

    const list = await this.pages<RawDeployment[], RawDeployment>(
      this.path('/deployments'),
      { environment },
      (b) => b,
      { stop: (items) => items.every((d) => t(d.created_at) < range.since.getTime()) },
    );
    const wanted = list.filter((d) => inRange(d.created_at));
    const out: Deployment[] = [];
    let skipped = 0;
    for (let i = 0; i < wanted.length; i += CHUNK) {
      const chunk = wanted.slice(i, i + CHUNK);
      const statuses = await Promise.all(
        chunk.map((d) =>
          this.get<RawStatus[]>(this.path(`/deployments/${d.id}/statuses`), { per_page: 100 }),
        ),
      );
      chunk.forEach((d, k) => {
        const own = (statuses[k] as RawStatus[]).sort((a, b) => t(a.created_at) - t(b.created_at));
        const ok = own.find((s) => s.state === 'success');
        const bad = [...own].reverse().find((s) => s.state === 'failure' || s.state === 'error');
        if (ok) out.push({ id: String(d.id), sha: d.sha, at: ok.created_at, status: 'success' });
        else if (bad)
          out.push({ id: String(d.id), sha: d.sha, at: bad.created_at, status: 'failure' });
        else skipped++;
      });
    }
    if (skipped > 0) {
      this.warnings.push(
        `${skipped} deployment(s) had no success or failure status (still running, or older than the 90 days GitHub keeps statuses) and were skipped.`,
      );
    }
    return out;
  }

  private async loadChanges(range: Range): Promise<Change[]> {
    const pulls = await this.pages<RawPull[], RawPull>(
      this.path('/pulls'),
      { state: 'closed', base: this.config.deployments.branch, sort: 'updated', direction: 'desc' },
      (b) => b,
      { stop: (items) => items.every((p) => t(p.updated_at) < range.since.getTime()) },
    );
    const merged = pulls.filter(
      (p) =>
        p.merged_at &&
        t(p.merged_at) >= range.since.getTime() &&
        t(p.merged_at) < range.until.getTime(),
    );
    const out: Change[] = [];
    for (let i = 0; i < merged.length; i += CHUNK) {
      const chunk = merged.slice(i, i + CHUNK);
      const firsts = await Promise.all(chunk.map((p) => this.firstCommitAt(p.number)));
      chunk.forEach((p, k) =>
        out.push({
          id: p.number,
          title: p.title,
          labels: p.labels.map((l) => l.name),
          firstCommitAt: firsts[k] ?? (p.merged_at as string),
          mergedAt: p.merged_at as string,
        }),
      );
    }
    return out;
  }

  /** Earliest commit author date on a PR. Commit order is not documented, so take the minimum. */
  private async firstCommitAt(pr: number): Promise<string | undefined> {
    const commits = await this.pages<RawCommit[], RawCommit>(
      this.path(`/pulls/${pr}/commits`),
      {},
      (b) => b,
      { maxPages: 3 },
    );
    const dates = commits.flatMap((c) => c.commit.author?.date ?? c.commit.committer?.date ?? []);
    return dates.sort((a, b) => t(a) - t(b))[0];
  }

  private async loadIncidents(range: Range): Promise<Incident[]> {
    const issues = await this.pages<RawIssue[], RawIssue>(
      this.path('/issues'),
      { labels: this.config.incident_label, state: 'all', since: range.since.toISOString() },
      (b) => b,
    );
    return issues
      .filter(
        (i) =>
          !i.pull_request &&
          t(i.created_at) >= range.since.getTime() &&
          t(i.created_at) < range.until.getTime(),
      )
      .map((i) => ({ id: i.number, openedAt: i.created_at, closedAt: i.closed_at }));
  }
}
