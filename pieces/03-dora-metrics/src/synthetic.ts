import { seededRandom } from '@adl/shared';
import { DAY_MS, HOUR_MS } from './dates.js';
import type { Change, Deployment, DoraData, Incident, Range } from './types.js';

/**
 * Generate a SYNTHETIC delivery history for demos and tests. It is invented data with a fixed seed.
 * After `rolloutAt`: more deployments and shorter lead time, but also more failures and more
 * rework. That mix is deliberate: it shows why throughput and instability are read together.
 */
export function generateSynthetic(opts: { seed: number; range: Range; rolloutAt: Date }): DoraData {
  const rand = seededRandom(opts.seed);
  const between = (lo: number, hi: number) => lo + rand() * (hi - lo);
  const iso = (ms: number) => new Date(ms).toISOString();
  const { since, until } = opts.range;

  const deployments: Deployment[] = [];
  const changes: Change[] = [];
  const incidents: Incident[] = [];
  let ids = 0;
  let prs = 0;

  const deploy = (at: number, status: Deployment['status'] = 'success'): number => {
    deployments.push({ id: `d${++ids}`, sha: `sha${ids}`, at: iso(at), status });
    return at;
  };
  const change = (title: string, labels: string[], mergedAt: number, leadHours: number) => {
    changes.push({
      id: ++prs,
      title,
      labels,
      firstCommitAt: iso(mergedAt - leadHours * HOUR_MS),
      mergedAt: iso(mergedAt),
    });
  };

  for (let day = since.getTime(); day < until.getTime(); day += DAY_MS) {
    const after = day >= opts.rolloutAt.getTime();
    const perDay = after ? 5 / 7 : 2 / 7;
    const failRate = after ? 0.24 : 0.15;
    const leadBase = after ? 20 : 48;

    if (rand() >= perDay) continue;
    const at = day + between(9, 17) * HOUR_MS;
    if (at >= until.getTime()) continue;
    if (rand() < 0.04) deploy(at - HOUR_MS, 'failure');
    deploy(at);

    for (let k = 0, n = 1 + Math.floor(rand() * 3); k < n; k++) {
      const mergedAt = at - between(1, after ? 18 : 36) * HOUR_MS;
      change(`Add feature ${prs + 1}`, [], mergedAt, leadBase * between(0.4, 1.6));
    }

    if (rand() < failRate) {
      const fixMergedAt = at + between(2, 20) * HOUR_MS;
      const fixDeployAt = fixMergedAt + between(1, 3) * HOUR_MS;
      if (fixDeployAt >= until.getTime()) continue;
      const kind = rand();
      // About one failure in five is fixed by redeploying the previous version, with no PR.
      if (kind >= 0.5)
        change(`Fix production issue ${prs + 1}`, ['hotfix'], fixMergedAt, between(1, 6));
      else if (kind >= 0.2) change(`Revert "Add feature ${prs}"`, [], fixMergedAt, 1);
      deploy(fixDeployAt);
      const openedAt = at + between(0.5, 2) * HOUR_MS;
      const closed = fixDeployAt + between(0.25, 2) * HOUR_MS;
      incidents.push({
        id: ++prs,
        openedAt: iso(openedAt),
        closedAt: closed < until.getTime() ? iso(closed) : null,
      });
    }
  }

  // ISO strings from toISOString() sort the same as the times they stand for.
  const asc =
    <T>(key: (x: T) => string) =>
    (a: T, b: T) =>
      key(a).localeCompare(key(b));
  return {
    deployments: deployments.sort(asc((d) => d.at)),
    changes: changes.sort(asc((c) => c.mergedAt)),
    incidents: incidents.sort(asc((i) => i.openedAt)),
  };
}
