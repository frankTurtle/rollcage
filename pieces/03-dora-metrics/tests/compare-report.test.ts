import { describe, expect, it } from 'vitest';
import { compareMetrics } from '../src/compare.ts';
import { loadDoraConfig } from '../src/config.ts';
import { computeMetrics } from '../src/metrics.ts';
import { buildReport } from '../src/report.ts';
import { ReportSchema } from '../src/schema.ts';
import type { Metrics } from '../src/schema.ts';
import { generateSynthetic } from '../src/synthetic.ts';
import { cfg, day, range, sample } from './helpers.ts';

/** A Metrics object with only the headline values set. */
function metrics(
  v: Partial<Record<'freq' | 'lead' | 'cfr' | 'rec' | 'rework', number | null>>,
): Metrics {
  const n = 10;
  const val = (x: number | null | undefined) => (x === undefined ? null : x);
  return {
    period: { since: 's', until: 'u', days: 7 },
    deploymentFrequency: { n, perWeek: val(v.freq) },
    changeLeadTime: {
      n,
      undeployed: 0,
      medianHours: val(v.lead),
      p90Hours: null,
    },
    changeFailRate: { n, count: 0, rate: val(v.cfr) },
    failedDeploymentRecovery: {
      n,
      source: 'incidents',
      medianHours: val(v.rec),
      p90Hours: null,
    },
    deploymentReworkRate: { n, count: 0, rate: val(v.rework) },
  };
}

describe('AC-5 compareMetrics', () => {
  const rows = compareMetrics(
    metrics({ freq: 2, lead: 50, cfr: 10, rec: null, rework: 0 }),
    metrics({ freq: 4, lead: 25, cfr: 10.2, rec: 5, rework: 5 }),
  );
  const row = (key: string) => rows.find((r) => r.key === key);

  it('respects each metric direction', () => {
    expect(row('deploymentFrequency')).toMatchObject({
      verdict: 'better',
      changePct: 100,
      betterWhen: 'higher',
    });
    expect(row('changeLeadTime')).toMatchObject({
      verdict: 'better',
      changePct: -50,
      betterWhen: 'lower',
    });
  });

  it('calls a change under 5 percent "same"', () => {
    expect(row('changeFailRate')).toMatchObject({ verdict: 'same', changePct: 2 });
  });

  it('marks a missing value as insufficient', () => {
    expect(row('failedDeploymentRecovery')).toMatchObject({
      verdict: 'insufficient',
      changePct: null,
    });
  });

  it('handles a zero baseline', () => {
    expect(row('deploymentReworkRate')).toMatchObject({ verdict: 'worse', changePct: null });
    const flat = compareMetrics(metrics({ rework: 0 }), metrics({ rework: 0 }));
    expect(flat.find((r) => r.key === 'deploymentReworkRate')).toMatchObject({
      verdict: 'same',
      changePct: 0,
    });
  });

  it('flags a worse lower-is-better metric', () => {
    const r = compareMetrics(metrics({ cfr: 5 }), metrics({ cfr: 15 }));
    expect(r.find((x) => x.key === 'changeFailRate')).toMatchObject({
      verdict: 'worse',
      changePct: 200,
    });
  });

  it('carries sample sizes', () => {
    expect(row('deploymentFrequency')).toMatchObject({ nBefore: 10, nAfter: 10 });
  });
});

describe('AC-5 buildReport', () => {
  const data = sample();
  const r = range('2026-01-01', '2026-01-15');

  it('without compare-at there is one period and no comparison', () => {
    const report = buildReport({ data, config: cfg(), range: r, source: 'file' });
    expect(report.periods.map((p) => p.name)).toEqual(['all']);
    expect(report.comparison).toBeNull();
    expect(report.compareAt).toBeNull();
    expect(report.repo).toBeNull();
  });

  it('with compare-at splits the range into before and after', () => {
    const report = buildReport({
      data,
      config: cfg(),
      range: r,
      compareAt: day('2026-01-08'),
      source: 'github',
      repo: 'o/r',
      warnings: ['w'],
    });
    expect(report.periods.map((p) => p.name)).toEqual(['before', 'after']);
    expect(report.comparison).toHaveLength(5);
    expect(report.periods[0]?.metrics.deploymentFrequency.n).toBe(2);
    expect(report.periods[1]?.metrics.deploymentFrequency.n).toBe(1);
    expect(report).toMatchObject({
      repo: 'o/r',
      warnings: ['w'],
      compareAt: '2026-01-08T00:00:00.000Z',
    });
  });

  it('rejects a compare-at outside the range', () => {
    for (const d of ['2025-12-31', '2026-01-01', '2026-01-15', '2026-02-01']) {
      expect(() =>
        buildReport({ data, config: cfg(), range: r, compareAt: day(d), source: 'file' }),
      ).toThrow('inside the date range');
    }
  });

  it('the report validates against its schema (AC-7)', () => {
    const report = buildReport({
      data,
      config: cfg(),
      range: r,
      compareAt: day('2026-01-08'),
      source: 'file',
      synthetic: true,
    });
    expect(ReportSchema.parse(report)).toEqual(report);
    expect(report.caveats.length).toBeGreaterThan(0);
  });
});

describe('synthetic history', () => {
  const span = range('2025-10-06', '2026-07-06');
  const rollout = day('2026-04-06');

  it('is deterministic for a seed and differs between seeds', () => {
    const a = generateSynthetic({ seed: 8, range: span, rolloutAt: rollout });
    expect(generateSynthetic({ seed: 8, range: span, rolloutAt: rollout })).toEqual(a);
    expect(generateSynthetic({ seed: 9, range: span, rolloutAt: rollout })).not.toEqual(a);
  });

  it('stays inside the range, sorted by time', () => {
    const d = generateSynthetic({ seed: 8, range: span, rolloutAt: rollout });
    for (const x of d.deployments) {
      expect(Date.parse(x.at)).toBeGreaterThanOrEqual(span.since.getTime());
      expect(Date.parse(x.at)).toBeLessThan(span.until.getTime());
    }
    const times = d.deployments.map((x) => Date.parse(x.at));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('shows more throughput and more failures after the rollout (the demo story)', () => {
    const d = generateSynthetic({ seed: 8, range: span, rolloutAt: rollout });
    const before = computeMetrics(d, { since: span.since, until: rollout }, loadDoraConfig());
    const after = computeMetrics(d, { since: rollout, until: span.until }, loadDoraConfig());
    expect(after.deploymentFrequency.perWeek as number).toBeGreaterThan(
      before.deploymentFrequency.perWeek as number,
    );
    expect(after.changeLeadTime.medianHours as number).toBeLessThan(
      before.changeLeadTime.medianHours as number,
    );
    expect(after.changeFailRate.rate as number).toBeGreaterThan(
      before.changeFailRate.rate as number,
    );
    expect(before.failedDeploymentRecovery.medianHours).not.toBeNull();
    expect(before.changeFailRate.count).not.toBe(before.deploymentReworkRate.count);
  });

  it('a one-day range may be empty', () => {
    const d = generateSynthetic({
      seed: 1,
      range: range('2026-01-01', '2026-01-02'),
      rolloutAt: day('2026-01-01'),
    });
    expect(d.deployments.length).toBeLessThanOrEqual(1);
  });
});
