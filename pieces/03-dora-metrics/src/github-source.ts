import { GitHubHttp } from '@adl/shared';
import type { FetchLike } from '@adl/shared';
import type { DoraConfig } from './config.js';
import { inRange, isoDay, ms } from './dates.js';
import type { Change, Deployment, Incident, LoadResult, Range, Source } from './types.js';

export class RequestBudgetError extends Error {}

/** How many requests run at once. The binding limit is the hourly budget, not concurrency. */
const CONCURRENCY = 5;
const RUNS_MAX_PAGES = 10;
/** GitHub returns at most this many results for a filtered workflow-run listing. */
const RUNS_RESULT_CAP = RUNS_MAX_PAGES * 100;

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

const RUN_OUTCOME: Record<string, Deployment['status']> = {
  success: 'success',
  failure: 'failure',
  timed_out: 'failure',
};

/** True if the page's timestamps never increase from one item to the next. */
const isNewestFirst = (items: { created_at: string }[]): boolean =>
  items.every(
    (d, i) =>
      i === 0 || ms(d.created_at) <= ms((items[i - 1] as { created_at: string }).created_at),
  );

/** Map items through `fn` with at most `size` calls in flight, keeping the input order. */
async function mapPool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}

/**
 * Reads deployments, merged pull requests and incident issues from the GitHub REST API (GET only).
 * Ordering of several list endpoints is not documented, so lists are sorted or filtered
 * client-side, and every request counts against `max_requests`.
 */
export class GitHubSource implements Source {
  readonly name = 'github';
  private requests = 0;
  private readonly http: GitHubHttp;

  constructor(
    private readonly repo: { owner: string; name: string },
    token: string,
    private readonly config: DoraConfig,
    fetchImpl?: FetchLike,
    baseUrl?: string,
  ) {
    this.http = new GitHubHttp(token, fetchImpl, baseUrl, () => {
      if (++this.requests > config.max_requests) {
        throw new RequestBudgetError(
          `Stopped after ${config.max_requests} API requests. Raise max_requests, narrow the date range, or use a token with a higher rate limit.`,
        );
      }
    });
  }

  private path(suffix: string): string {
    return `/repos/${this.repo.owner}/${this.repo.name}${suffix}`;
  }

  async load(range: Range): Promise<LoadResult> {
    const warnings: string[] = [];
    const deployments = await this.loadDeployments(range, warnings);
    // A PR merged after the last successful deployment has no lead time yet (it is "undeployed"),
    // so its commits are not fetched. It is still listed: a revert or hotfix there is a signal.
    const lastDeployed = deployments.reduce(
      (latest, d) => (d.status === 'success' ? Math.max(latest, ms(d.at)) : latest),
      -Infinity,
    );
    const [changes, incidents] = await Promise.all([
      this.loadChanges(range, lastDeployed),
      this.loadIncidents(range),
    ]);
    return { data: { deployments, changes, incidents }, warnings };
  }

  private loadDeployments(range: Range, warnings: string[]): Promise<Deployment[]> {
    const source = this.config.deployments.source;
    if (source === 'releases') return this.fromReleases(range);
    if (source === 'workflow-runs') return this.fromRuns(range, warnings);
    return this.fromDeploymentsApi(range, warnings);
  }

  private async fromReleases(range: Range): Promise<Deployment[]> {
    const releases = await this.http.paginate<RawRelease[], RawRelease>(
      this.path('/releases'),
      {},
      (b) => b,
    );
    return releases
      .filter(
        (r) => !r.draft && !r.prerelease && r.published_at && inRange(ms(r.published_at), range),
      )
      .map((r) => ({
        id: r.tag_name,
        sha: r.target_commitish,
        at: r.published_at as string,
        status: 'success' as const,
      }));
  }

  private async fromRuns(range: Range, warnings: string[]): Promise<Deployment[]> {
    const { workflow, branch } = this.config.deployments;
    const runs = await this.http.paginate<{ workflow_runs: RawRun[] }, RawRun>(
      this.path(`/actions/workflows/${workflow}/runs`),
      { branch, status: 'completed', created: `${isoDay(range.since)}..${isoDay(range.until)}` },
      (b) => b.workflow_runs,
      { maxPages: RUNS_MAX_PAGES },
    );
    if (runs.length >= RUNS_RESULT_CAP) {
      warnings.push(
        `The workflow run list hit GitHub's ${RUNS_RESULT_CAP.toLocaleString('en-US')} result limit; older runs are missing.`,
      );
    }
    return runs.flatMap((r): Deployment[] => {
      const status = RUN_OUTCOME[r.conclusion ?? ''];
      return status && inRange(ms(r.updated_at), range)
        ? [{ id: String(r.id), sha: r.head_sha, at: r.updated_at, status }]
        : [];
    });
  }

  private async fromDeploymentsApi(range: Range, warnings: string[]): Promise<Deployment[]> {
    const list = await this.http.paginate<RawDeployment[], RawDeployment>(
      this.path('/deployments'),
      { environment: this.config.deployments.environment },
      (b) => b,
      {
        // Stop early only when the list is visibly newest-first. GitHub does not document the
        // order, so an ascending page must not end the paging.
        stop: (items) =>
          isNewestFirst(items) && items.every((d) => ms(d.created_at) < range.since.getTime()),
      },
    );
    const wanted = list.filter((d) => inRange(ms(d.created_at), range));
    const results = await mapPool(wanted, CONCURRENCY, async (d): Promise<Deployment | null> => {
      const statuses = await this.http.json<RawStatus[]>(
        this.path(`/deployments/${d.id}/statuses`),
        { per_page: 100 },
      );
      const own = [...statuses].sort((a, b) => ms(a.created_at) - ms(b.created_at));
      const ok = own.find((s) => s.state === 'success');
      const bad = own.findLast((s) => s.state === 'failure' || s.state === 'error');
      const final = ok ?? bad;
      return final
        ? { id: String(d.id), sha: d.sha, at: final.created_at, status: ok ? 'success' : 'failure' }
        : null;
    });
    const out = results.filter((d): d is Deployment => d !== null);
    const skipped = results.length - out.length;
    if (skipped > 0) {
      warnings.push(
        `${skipped} deployment(s) had no success or failure status (still running, or older than the 90 days GitHub keeps statuses) and were skipped.`,
      );
    }
    return out;
  }

  private async loadChanges(range: Range, lastDeployed: number): Promise<Change[]> {
    const pulls = await this.http.paginate<RawPull[], RawPull>(
      this.path('/pulls'),
      { state: 'closed', base: this.config.deployments.branch, sort: 'updated', direction: 'desc' },
      (b) => b,
      { stop: (items) => items.every((p) => ms(p.updated_at) < range.since.getTime()) },
    );
    const merged = pulls.filter((p) => p.merged_at && inRange(ms(p.merged_at), range));
    return mapPool(merged, CONCURRENCY, async (p): Promise<Change> => {
      const mergedAt = p.merged_at as string;
      const first = ms(mergedAt) > lastDeployed ? undefined : await this.firstCommitAt(p.number);
      return {
        id: p.number,
        title: p.title,
        labels: p.labels.map((l) => l.name),
        firstCommitAt: first ?? mergedAt,
        mergedAt,
      };
    });
  }

  /** Earliest commit author date on a PR. Commit order is not documented, so take the minimum. */
  private async firstCommitAt(pr: number): Promise<string | undefined> {
    const commits = await this.http.paginate<RawCommit[], RawCommit>(
      this.path(`/pulls/${pr}/commits`),
      {},
      (b) => b,
      { maxPages: 3 },
    );
    return commits
      .flatMap((c) => c.commit.author?.date ?? c.commit.committer?.date ?? [])
      .sort((a, b) => ms(a) - ms(b))[0];
  }

  private async loadIncidents(range: Range): Promise<Incident[]> {
    const issues = await this.http.paginate<RawIssue[], RawIssue>(
      this.path('/issues'),
      { labels: this.config.incident_label, state: 'all', since: range.since.toISOString() },
      (b) => b,
    );
    return issues
      .filter((i) => !i.pull_request && inRange(ms(i.created_at), range))
      .map((i) => ({ id: i.number, openedAt: i.created_at, closedAt: i.closed_at }));
  }
}
