import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';
import { PIECE, tmp } from './helpers.js';

function io(env: Record<string, string> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: { env, out: (t: string) => out.push(t), err: (t: string) => err.push(t) },
  };
}
const REPLIES = join(PIECE, 'fixtures', 'replies-clean.json');
const RUN = (dir: string) => ['--run-id', 'demo-clean', '--out', dir];

describe('cli', () => {
  it('runs offline from recorded replies, pauses, blocks, approves, commits, replays', async () => {
    const dir = tmp();
    const a = io();
    expect(await runCli(['run', '--task', 'greet', '--replies', REPLIES, ...RUN(dir)], a.io)).toBe(
      0,
    );
    expect(a.out.join('\n')).toContain('awaiting-approval');
    const record = join(dir, 'run-demo-clean.json');
    expect(existsSync(record)).toBe(true);

    const blocked = io();
    expect(await runCli(['commit', record], blocked.io)).toBe(3);
    expect(blocked.out.join('\n')).toContain('BLOCKED');

    const agent = io();
    expect(await runCli(['approve', record, '--by', 'agent:reviewer'], agent.io)).toBe(2);

    const approve = io();
    expect(await runCli(['approve', record, '--by', 'alice'], approve.io)).toBe(0);
    const commit = io();
    expect(await runCli(['commit', record], commit.io)).toBe(0);
    expect(commit.out.join('\n')).toContain('dry-run');

    const replay = io();
    expect(await runCli(['replay', record], replay.io)).toBe(0);
    expect(replay.out.join('\n')).toContain('identical');

    const metrics = io();
    expect(await runCli(['metrics', dir], metrics.io)).toBe(0);
    expect(metrics.out.join('\n')).toContain('100%');
  });

  it('refuses to approve or commit a run that proposed no change', async () => {
    const dir = tmp();
    await runCli(['run', '--task', 'greet', '--replies', REPLIES, ...RUN(dir)], io().io);
    const record = join(dir, 'run-demo-clean.json');
    const parsed = JSON.parse(readFileSync(record, 'utf8')) as Record<string, unknown>;
    delete parsed.change;
    (await import('node:fs')).writeFileSync(record, JSON.stringify(parsed));
    for (const args of [
      ['approve', record, '--by', 'alice'],
      ['commit', record],
    ]) {
      const r = io();
      expect(await runCli(args, r.io)).toBe(2);
      expect(r.err.join('\n')).toContain('proposed no change');
    }
  });

  it('fails replay with exit 1 when the record was edited', async () => {
    const dir = tmp();
    await runCli(['run', '--task', 'greet', '--replies', REPLIES, ...RUN(dir)], io().io);
    const record = join(dir, 'run-demo-clean.json');
    const edited = readFileSync(record, 'utf8').replace('Plan: 1.', 'Plan: 9.');
    (await import('node:fs')).writeFileSync(record, edited);
    const r = io();
    expect(await runCli(['replay', record], r.io)).toBe(1);
    expect(r.out.join('\n')).toContain('MISMATCH');
  });

  it('refuses to run without a model source, and live mode needs a key', async () => {
    const a = io();
    expect(await runCli(['run', '--task', 'x', '--out', tmp()], a.io)).toBe(2);
    const b = io();
    expect(await runCli(['run', '--task', 'x', '--live', '--out', tmp()], b.io)).toBe(2);
    expect(b.err.join('\n')).toContain('ANTHROPIC_API_KEY');
    const c = io();
    expect(await runCli(['run', '--replies', REPLIES, '--out', tmp()], c.io)).toBe(2);
  });

  it('prints usage for an unknown command', async () => {
    const a = io();
    expect(await runCli(['frobnicate'], a.io)).toBe(2);
    expect(a.err.join('\n')).toContain('usage');
    expect(await runCli([], io().io)).toBe(2);
  });
});
