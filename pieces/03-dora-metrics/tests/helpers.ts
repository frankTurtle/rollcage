import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDoraConfig } from '../src/config.ts';
import type { DoraData, Range } from '../src/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURES = join(here, 'fixtures', 'github');
export const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'));

export const day = (d: string): Date => new Date(`${d}T00:00:00.000Z`);
export const range = (since: string, until: string): Range => ({
  since: day(since),
  until: day(until),
});
/** Config with min_samples 1, so small hand-built data yields numbers. */
export const cfg = (yaml = '') => loadDoraConfig(`min_samples: 1\n${yaml}`);

export const deploy = (id: string, at: string, status: 'success' | 'failure' = 'success') => ({
  id,
  sha: `sha-${id}`,
  at,
  status,
});
export const change = (
  id: number,
  title: string,
  firstCommitAt: string,
  mergedAt: string,
  labels: string[] = [],
) => ({
  id,
  title,
  labels,
  firstCommitAt,
  mergedAt,
});
export const empty = (): DoraData => ({ deployments: [], changes: [], incidents: [] });

/** The hand-built history the metric tests check against (numbers are worked out in the tests). */
export const sample = (): DoraData => ({
  deployments: [
    deploy('d1', '2026-01-02T12:00:00Z'),
    deploy('d2', '2026-01-04T12:00:00Z'),
    deploy('f1', '2026-01-06T12:00:00Z', 'failure'),
    deploy('d3', '2026-01-10T12:00:00Z'),
  ],
  changes: [
    change(1, 'Add search', '2026-01-01T12:00:00Z', '2026-01-02T00:00:00Z'),
    change(2, 'Add filters', '2026-01-03T00:00:00Z', '2026-01-03T12:00:00Z'),
    change(3, 'Revert "Add filters"', '2026-01-04T14:00:00Z', '2026-01-04T15:00:00Z'),
    change(4, 'Add export', '2026-01-10T20:00:00Z', '2026-01-11T00:00:00Z'),
  ],
  incidents: [{ id: 9, openedAt: '2026-01-04T14:00:00Z', closedAt: '2026-01-04T20:00:00Z' }],
});
