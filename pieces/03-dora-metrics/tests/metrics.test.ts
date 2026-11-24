import { describe, expect, it } from 'vitest';
import { loadDoraConfig } from '../src/config.ts';
import { computeMetrics } from '../src/metrics.ts';
import { median, percentile } from '../src/stats.ts';
import { cfg, change, deploy, empty, range, sample } from './helpers.ts';

const period = range('2026-01-01', '2026-01-15'); // 14 days = 2 weeks

describe('AC-1 the five metrics on hand-built data', () => {
  const m = computeMetrics(sample(), period, cfg());

  it('deployment frequency counts successful deployments only', () => {
    expect(m.deploymentFrequency).toEqual({
      n: 3,
      insufficient: false,
      perWeek: 1.5,
      medianDaysBetween: 4, // gaps of 2 and 6 days
    });
  });

  it('change lead time runs from first commit to the first deployment at or after the merge', () => {
    // c1: 24h to d1. c2: 36h to d2. c3: 142h to d3. c4 merged after the last deployment.
    expect(m.changeLeadTime).toMatchObject({
      n: 3,
      undeployed: 1,
      medianHours: 36,
      p90Hours: 142,
    });
  });

  it('change fail rate marks the deployment before a revert or incident, once', () => {
    // The revert (merged 3h after d2) and the incident (2h after d2) both point at d2.
    expect(m.changeFailRate).toMatchObject({ n: 3, count: 1, rate: 33.3 });
  });

  it('rework rate counts the deployment that follows a revert or hotfix', () => {
    // The revert merged 01-04T15:00; the next deployment is d3.
    expect(m.deploymentReworkRate).toMatchObject({ n: 3, count: 1, rate: 33.3 });
  });

  it('recovery time from incidents is opened to closed', () => {
    expect(m.failedDeploymentRecovery).toMatchObject({ source: 'incidents', n: 1, medianHours: 6 });
  });

  it('recovery time from next-deploy runs from each failure to the next good deployment', () => {
    // f1 (failed attempt) 01-06T12 to d3 = 96h. d2 (marked failed) to d3 = 144h.
    const r = computeMetrics(sample(), period, cfg('recovery_source: next-deploy'));
    expect(r.failedDeploymentRecovery).toMatchObject({
      source: 'next-deploy',
      n: 2,
      medianHours: 120,
    });
  });

  it('reports the period', () => {
    expect(m.period).toEqual({
      since: '2026-01-01T00:00:00.000Z',
      until: '2026-01-15T00:00:00.000Z',
      days: 14,
    });
  });
});

describe('edge cases', () => {
  it('no data gives insufficient metrics, not zeros', () => {
    const m = computeMetrics(empty(), period, cfg());
    expect(m.deploymentFrequency).toMatchObject({ n: 0, insufficient: true, perWeek: null });
    expect(m.changeLeadTime).toMatchObject({ n: 0, insufficient: true, medianHours: null });
    expect(m.changeFailRate).toMatchObject({ insufficient: true, rate: null });
    expect(m.failedDeploymentRecovery.insufficient).toBe(true);
    expect(m.deploymentReworkRate.rate).toBeNull();
  });

  it('a single deployment has no gap between deployments', () => {
    const m = computeMetrics(
      { ...empty(), deployments: [deploy('d1', '2026-01-02T00:00:00Z')] },
      period,
      cfg(),
    );
    expect(m.deploymentFrequency).toMatchObject({ n: 1, perWeek: 0.5, medianDaysBetween: null });
  });

  it('a deployment exactly at since counts; one exactly at until does not', () => {
    const data = {
      ...empty(),
      deployments: [deploy('a', '2026-01-01T00:00:00Z'), deploy('b', '2026-01-15T00:00:00Z')],
    };
    expect(computeMetrics(data, period, cfg()).deploymentFrequency.n).toBe(1);
  });

  it('a negative lead time (clock skew) is clamped to zero', () => {
    const data = {
      ...empty(),
      deployments: [deploy('d1', '2026-01-02T00:00:00Z')],
      changes: [change(1, 'x', '2026-01-03T00:00:00Z', '2026-01-02T00:00:00Z')],
    };
    expect(computeMetrics(data, period, cfg()).changeLeadTime.medianHours).toBe(0);
  });

  it('a change merged in the period is matched to a deployment just after the period ends', () => {
    const data = {
      ...empty(),
      deployments: [deploy('late', '2026-01-15T06:00:00Z')],
      changes: [change(1, 'x', '2026-01-14T00:00:00Z', '2026-01-14T12:00:00Z')],
    };
    expect(computeMetrics(data, period, cfg()).changeLeadTime).toMatchObject({
      n: 1,
      medianHours: 30,
    });
  });

  it('recovery by next-deploy skips a failure with no later good deployment', () => {
    const data = { ...empty(), deployments: [deploy('f', '2026-01-02T00:00:00Z', 'failure')] };
    const m = computeMetrics(data, period, cfg('recovery_source: next-deploy'));
    expect(m.failedDeploymentRecovery.n).toBe(0);
  });

  it('an open incident does not count towards recovery time', () => {
    const data = {
      ...empty(),
      incidents: [{ id: 1, openedAt: '2026-01-02T00:00:00Z', closedAt: null }],
    };
    expect(computeMetrics(data, period, cfg()).failedDeploymentRecovery.n).toBe(0);
  });
});

describe('AC-2 failure attribution', () => {
  const base = {
    ...empty(),
    deployments: [deploy('d1', '2026-01-02T00:00:00Z'), deploy('d2', '2026-01-08T00:00:00Z')],
  };

  it('ignores a signal outside the failure window', () => {
    const data = {
      ...base,
      changes: [change(1, 'Fix', '2026-01-04T00:00:00Z', '2026-01-04T12:00:00Z', ['hotfix'])],
    };
    // 60h after d1: inside the default 72h window. With a 48h window it is outside.
    expect(computeMetrics(data, period, cfg()).changeFailRate.count).toBe(1);
    expect(computeMetrics(data, period, cfg('failure_window_hours: 48')).changeFailRate.count).toBe(
      0,
    );
  });

  it('counts a deployment once however many signals point at it', () => {
    const data = {
      ...base,
      changes: [
        change(1, 'Revert "a"', '2026-01-02T01:00:00Z', '2026-01-02T02:00:00Z'),
        change(2, 'Fix', '2026-01-02T03:00:00Z', '2026-01-02T04:00:00Z', ['hotfix']),
      ],
      incidents: [{ id: 5, openedAt: '2026-01-02T01:30:00Z', closedAt: null }],
    };
    expect(computeMetrics(data, period, cfg()).changeFailRate.count).toBe(1);
  });

  it('a signal before any deployment marks nothing', () => {
    const data = {
      ...base,
      incidents: [{ id: 5, openedAt: '2025-12-31T00:00:00Z', closedAt: null }],
    };
    expect(computeMetrics(data, period, cfg()).changeFailRate.count).toBe(0);
  });

  it('a revert label counts as well as the title prefix, and a custom prefix works', () => {
    const byLabel = {
      ...base,
      changes: [change(1, 'Undo it', '2026-01-02T01:00:00Z', '2026-01-02T02:00:00Z', ['revert'])],
    };
    expect(computeMetrics(byLabel, period, cfg()).changeFailRate.count).toBe(1);
    const byPrefix = {
      ...base,
      changes: [change(1, 'Rollback: it', '2026-01-02T01:00:00Z', '2026-01-02T02:00:00Z')],
    };
    expect(computeMetrics(byPrefix, period, cfg()).changeFailRate.count).toBe(0);
    expect(
      computeMetrics(byPrefix, period, cfg('revert_title_prefix: Rollback')).changeFailRate.count,
    ).toBe(1);
  });
});

describe('AC-3 rework differs from change fail rate', () => {
  it('an incident with no revert or hotfix is a failure but not rework', () => {
    const data = {
      ...empty(),
      deployments: [deploy('d1', '2026-01-02T00:00:00Z'), deploy('d2', '2026-01-03T00:00:00Z')],
      incidents: [{ id: 1, openedAt: '2026-01-02T06:00:00Z', closedAt: '2026-01-02T09:00:00Z' }],
    };
    const m = computeMetrics(data, period, cfg());
    expect(m.changeFailRate.count).toBe(1);
    expect(m.deploymentReworkRate.count).toBe(0);
  });
});

describe('AC-4 minimum samples', () => {
  it('shows insufficient data when there are fewer samples than min_samples', () => {
    const m = computeMetrics(sample(), period, loadDoraConfig());
    expect(m.deploymentFrequency).toMatchObject({ n: 3, insufficient: true, perWeek: null });
    expect(m.changeLeadTime).toMatchObject({
      n: 3,
      insufficient: true,
      medianHours: null,
      p90Hours: null,
    });
    expect(m.changeFailRate.rate).toBeNull();
    expect(m.failedDeploymentRecovery.medianHours).toBeNull();
  });
});

describe('stats', () => {
  it('median and nearest-rank percentile', () => {
    expect(median([])).toBeNull();
    expect(median([5])).toBe(5);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(percentile([], 90)).toBeNull();
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
    expect(percentile([7], 90)).toBe(7);
    expect(percentile([3, 1, 2], 0)).toBe(1);
  });
});

describe('AC-9 config', () => {
  it('has defaults, merges partial settings and rejects unknown keys and bad values', () => {
    const d = loadDoraConfig();
    expect(d).toMatchObject({
      failure_window_hours: 72,
      min_samples: 5,
      recovery_source: 'incidents',
    });
    expect(d.deployments).toEqual({
      source: 'deployments-api',
      environment: 'production',
      workflow: 'deploy.yml',
      branch: 'main',
    });
    expect(loadDoraConfig('deployments:\n  source: releases\n').deployments.branch).toBe('main');
    expect(() => loadDoraConfig('window: 5')).toThrow();
    expect(() => loadDoraConfig('recovery_source: magic')).toThrow();
    expect(() => loadDoraConfig('failure_window_hours: 0')).toThrow();
    expect(() => loadDoraConfig('deployments:\n  source: ftp\n')).toThrow();
  });
});
