import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';
import { parseDiff } from '../src/diff.ts';
import { evaluatePolicy, humanApprovers } from '../src/policy.ts';
import { prescore } from '../src/prescore.ts';
import { addDiff, demoConfig, fixture } from './helpers.ts';

const score = (diff: string, yaml?: string) => prescore(parseDiff(diff), loadConfig(yaml));

describe('AC-2 prescore', () => {
  it('docs-only is low', () => {
    const p = prescore(parseDiff(fixture('pr1-docs.diff')), demoConfig());
    expect(p).toMatchObject({ level: 'low', score: 0 });
  });

  it('an empty diff is low', () => {
    expect(score('')).toMatchObject({ level: 'low', score: 0 });
  });

  it('auth change is high and names the file', () => {
    const p = prescore(parseDiff(fixture('pr3-auth-no-tests.diff')), demoConfig());
    expect(p.level).toBe('high');
    expect(p.categories['auth']).toEqual(['src/auth/session.ts']);
    expect(p.hasTestChanges).toBe(false);
    expect(p.reasons[0]).toContain('Touches auth');
  });

  it.each([
    ['infra/main.tf', 'iam_iac'],
    ['db/migrations/001_init.sql', 'migrations'],
    ['.github/workflows/ci.yml', 'ci_workflows'],
    ['config/app-secrets.json', 'secrets_config'],
  ])('%s is high via %s', (path, category) => {
    const p = score(addDiff(path, 3));
    expect(p.level).toBe('high');
    expect(Object.keys(p.categories)).toContain(category);
  });

  it('a lockfile alone is medium', () => {
    expect(score(addDiff('pnpm-lock.yaml', 3)).level).toBe('medium');
  });

  it('feature with lockfile and tests is medium (demo PR 2)', () => {
    const p = prescore(parseDiff(fixture('pr2-feature.diff')), demoConfig());
    expect(p).toMatchObject({ level: 'medium', hasTestChanges: true, score: 45 });
  });

  it('size and a low test ratio add points', () => {
    const cfg = 'thresholds:\n  medium_diff_lines: 10\n  large_diff_lines: 50\n';
    expect(score(addDiff('src/a.ts', 12), cfg)).toMatchObject({ score: 35, level: 'medium' });
    const big = score(addDiff('src/a.ts', 60), cfg);
    expect(big.score).toBe(50);
    expect(big.reasons.some((r) => r.includes('Test lines are 0%'))).toBe(true);
    const tested = score(addDiff('src/a.ts', 12) + addDiff('tests/a.test.ts', 6), cfg);
    expect(tested.score).toBe(15);
  });

  it('caps the score at 100 and honors custom categories', () => {
    const cfg =
      'thresholds:\n  medium_diff_lines: 1\n  large_diff_lines: 2\nrisk_paths:\n  payments:\n    level: high\n    paths: ["src/payments/**"]\n';
    const p = score(addDiff('src/payments/charge.ts', 30), cfg);
    expect(p.score).toBe(100);
    expect(Object.keys(p.categories)).toEqual(['payments']);
  });
});

describe('AC-3 test and doc files never trigger risk', () => {
  it('a test file inside a risk path stays low', () => {
    const p = score(addDiff('src/auth/tests/session.test.ts', 10));
    expect(p).toMatchObject({ level: 'low', hasTestChanges: true });
    expect(p.categories).toEqual({});
  });

  it('a markdown file in a risk path stays low', () => {
    expect(score(addDiff('src/auth/README.md', 5)).level).toBe('low');
  });
});

const meta = { number: 1, title: 't', author: 'author', labels: [] as string[] };
const policy = (over: Partial<Parameters<typeof evaluatePolicy>[0]> = {}) =>
  evaluatePolicy({
    level: 'high',
    hasTestChanges: true,
    meta,
    approvals: ['a', 'b'],
    config: loadConfig(),
    ...over,
  });

describe('AC-7 policy', () => {
  it('passes high risk with tests and two approvals', () => {
    expect(policy()).toMatchObject({ violations: [], verdict: 'pass' });
  });

  it('fails high risk with no tests', () => {
    expect(policy({ hasTestChanges: false }).violations.map((v) => v.id)).toEqual([
      'tests-required',
    ]);
  });

  it('fails high risk with too few approvals', () => {
    const r = policy({ approvals: ['a'] });
    expect(r.violations.map((v) => v.id)).toEqual(['approvals-required']);
    expect(r.violations[0]?.message).toContain('has 1');
    expect(r.verdict).toBe('fail');
  });

  it('does not count the author, bots or duplicates', () => {
    expect(humanApprovers(['Author', 'dependabot[bot]', 'a', 'A', 'b'], 'author')).toEqual([
      'a',
      'b',
    ]);
    expect(policy({ approvals: ['author', 'ci[bot]', 'a', 'a'] }).violations).toHaveLength(1);
  });

  it('does nothing for low and medium risk', () => {
    for (const level of ['low', 'medium'] as const) {
      expect(policy({ level, hasTestChanges: false, approvals: [] }).violations).toEqual([]);
    }
  });

  it('label mode accepts the label and rejects its absence', () => {
    const config = loadConfig('second_approval:\n  mode: label\n  label: ok-to-merge\n');
    expect(
      policy({ config, approvals: [], meta: { ...meta, labels: ['ok-to-merge'] } }).violations,
    ).toEqual([]);
    const missing = policy({ config, approvals: ['a', 'b'] });
    expect(missing.violations[0]?.message).toContain('ok-to-merge');
  });
});

describe('AC-8 observe mode', () => {
  it('lists violations but never blocks', () => {
    const r = policy({ hasTestChanges: false, config: loadConfig('mode: observe') });
    expect(r.violations.length).toBeGreaterThan(0);
    expect(r.verdict).toBe('observe-would-fail');
  });
});
