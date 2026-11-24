import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.ts';
import { loadDoraConfig } from '../src/config.ts';
import { buildReport } from '../src/report.ts';
import { renderHtml } from '../src/render-html.ts';
import { renderSummary } from '../src/render-summary.ts';
import { renderText } from '../src/render-text.ts';
import { ReportSchema } from '../src/schema.ts';
import { cfg, day, fixture, range, sample } from './helpers.ts';

const r = range('2026-01-01', '2026-01-15');
const compared = (over: Partial<Parameters<typeof buildReport>[0]> = {}) =>
  buildReport({
    data: sample(),
    config: cfg(),
    range: r,
    compareAt: day('2026-01-08'),
    source: 'file',
    ...over,
  });

describe('AC-7 html dashboard', () => {
  it('is one file with no scripts and no external references', () => {
    const html = renderHtml(compared());
    expect(html).toContain('<table>');
    expect(html).not.toMatch(/<script|<link|<img|src=|href=|https?:\/\//i);
  });

  it('escapes every string it prints', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const html = renderHtml(
      compared({ repo: evil, source: evil, warnings: [`<script>${evil}</script>`] }),
    );
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;img');
    expect(html).toContain('&quot;'.replace('&quot;', '&lt;'));
  });

  it('shows the synthetic banner, the caveats and data notes', () => {
    const html = renderHtml(compared({ synthetic: true, warnings: ['one deployment skipped'] }));
    expect(html).toContain('Synthetic example data');
    expect(html).toContain('What this does not show');
    expect(html).toContain('one deployment skipped');
  });

  it('renders a single period without a comparison table', () => {
    const html = renderHtml(compared({ compareAt: undefined }));
    expect(html).toContain('<pre>');
    expect(html).not.toContain('<table>');
  });

  it('draws a bar for each side of a comparison', () => {
    expect(renderHtml(compared())).toContain('class="bar after"');
  });
});

describe('AC-7 summary and text', () => {
  it('the summary names the numbers, sample sizes and caveats', () => {
    const md = renderSummary(compared());
    expect(md).toContain('## The five numbers');
    expect(md).toMatch(/Deployment frequency:\*\* .* per week before/);
    expect(md).toContain('samples:');
    expect(md).toContain('## What this does not show');
    expect(md).not.toContain('Synthetic example data');
  });

  it('says so when there is not enough data, and when nothing moved', () => {
    const md = renderSummary(
      buildReport({
        data: sample(),
        config: loadDoraConfig('min_samples: 3'),
        range: r,
        compareAt: day('2026-01-08'),
        source: 'file',
      }),
    );
    expect(md).toContain('not enough data to compare');
    expect(md).toContain('No metric moved clearly');
  });

  it('labels synthetic data, adds data notes, and asks for a rollout date when there is no comparison', () => {
    const md = renderSummary(compared({ synthetic: true, warnings: ['a note'], repo: 'o/r' }));
    expect(md).toContain('Synthetic example data');
    expect(md).toContain('## Data notes');
    expect(md).toContain('o/r');
    const single = renderSummary(compared({ compareAt: undefined }));
    expect(single).toContain('Run with a rollout date');
  });

  it('the text table lists five rows with before, after and verdict', () => {
    const text = renderText(compared({ synthetic: true }));
    expect(text).toContain('SYNTHETIC DATA');
    expect(text.split('\n').filter((l) => /\(n=\d+\/\d+\)/.test(l))).toHaveLength(5);
  });

  it('the text for a single period shows five values', () => {
    const text = renderText(compared({ compareAt: undefined }));
    expect(text).toContain('Deployment frequency');
    expect(text).toContain('n=');
  });
});

describe('AC-8 cli', () => {
  const run = async (
    argv: string[],
    env: Record<string, string> = {},
    extra: Partial<Parameters<typeof runCli>[1]> = {},
  ) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runCli(argv, {
      env,
      out: (t) => out.push(t),
      err: (t) => err.push(t),
      ...extra,
    });
    return { code, out: out.join('\n'), err: err.join('\n') };
  };
  const synthetic = [
    'report',
    '--source',
    'synthetic',
    '--seed',
    '8',
    '--since',
    '2025-10-06',
    '--until',
    '2026-07-06',
    '--compare-at',
    '2026-04-06',
  ];

  it('runs end to end on the synthetic source, writes three valid files, and is deterministic', async () => {
    const a = mkdtempSync(join(tmpdir(), 'dora-'));
    const b = mkdtempSync(join(tmpdir(), 'dora-'));
    const first = await run([...synthetic, '--out', a]);
    await run([...synthetic, '--out', b]);
    expect(first.code).toBe(0);
    expect(first.out).toContain('SYNTHETIC DATA');
    for (const file of ['dora.json', 'dora.html', 'summary.md']) {
      expect(readFileSync(join(a, file), 'utf8')).toBe(readFileSync(join(b, file), 'utf8'));
    }
    const json = ReportSchema.parse(JSON.parse(readFileSync(join(a, 'dora.json'), 'utf8')));
    expect(json.synthetic).toBe(true);
    expect(json.comparison).toHaveLength(5);
  });

  it('reads a normalized data file', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'dora-')), 'data.json');
    writeFileSync(file, JSON.stringify(sample()));
    const res = await run([
      'report',
      '--data',
      file,
      '--since',
      '2026-01-01',
      '--until',
      '2026-01-15',
    ]);
    expect(res.code).toBe(0);
    expect(res.out).toContain('Period: 2026-01-01 to 2026-01-15');
  });

  it('defaults to the 90 days before today', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'dora-')), 'data.json');
    writeFileSync(file, JSON.stringify(sample()));
    const res = await run(
      ['report', '--data', file],
      {},
      { now: () => new Date('2026-04-01T12:00:00Z') },
    );
    expect(res.out).toContain('Period: 2026-01-01 to 2026-04-01');
  });

  it('reads GitHub through the API, with a config file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dora-'));
    const config = join(dir, 'dora.yml');
    writeFileSync(config, 'min_samples: 1\ndeployments:\n  source: releases\n');
    const routes: Record<string, unknown> = {
      '/repos/o/r/releases': fixture('releases.json'),
      '/repos/o/r/pulls': fixture('pulls.json'),
      '/repos/o/r/pulls/10/commits': fixture('pull-commits-10.json'),
      '/repos/o/r/pulls/12/commits': fixture('pull-commits-12.json'),
      '/repos/o/r/issues': fixture('issues.json'),
    };
    const fetchImpl = async (url: string) =>
      new Response(JSON.stringify(routes[new URL(url).pathname] ?? []));
    const res = await run(
      [
        'report',
        '--repo',
        'o/r',
        '--config',
        config,
        '--since',
        '2026-01-01',
        '--until',
        '2026-02-01',
        '--out',
        dir,
      ],
      { GITHUB_TOKEN: 'test-token-not-real' },
      { fetchImpl },
    );
    expect(res.code).toBe(0);
    const json = ReportSchema.parse(JSON.parse(readFileSync(join(dir, 'dora.json'), 'utf8')));
    expect(json).toMatchObject({ source: 'github', repo: 'o/r', synthetic: false });
    expect(json.periods[0]?.metrics.changeLeadTime.n).toBe(2);
  });

  it('explains what is wrong with bad input and exits 2', async () => {
    expect((await run([])).err).toContain('Usage');
    expect((await run(['bogus'])).code).toBe(2);
    expect((await run(['report', '--source', 'synthetic', '--until', '2026-01-01'])).err).toContain(
      '--compare-at',
    );
    expect((await run(['report', '--since', 'yesterday', '--repo', 'o/r'])).err).toContain(
      '--since must be a date',
    );
    expect((await run(['report', '--since', '2026-02-30', '--repo', 'o/r'])).err).toContain(
      '--since must be a date',
    );
    expect(
      (await run(['report', '--since', '2026-03-01', '--until', '2026-02-01', '--repo', 'o/r']))
        .err,
    ).toContain('before --until');
    expect((await run(['report'])).err).toContain('--repo OWNER/NAME');
    expect((await run(['report', '--repo', 'o/r'])).err).toContain('GITHUB_TOKEN');
    expect(
      (await run(['report', '--repo', 'o/r', '--config', '/nope/dora.yml'], { GITHUB_TOKEN: 't' }))
        .err,
    ).toContain('config file not found');
    expect((await run([...synthetic.slice(0, -1), '2030-01-01'])).err).toContain(
      'inside the date range',
    );
  });
});
