import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAuditRecords, verifyAuditChain } from '@adl/shared';
import { describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.ts';
import { runHook } from '../src/hook.ts';
import { withLock } from '../src/lock.ts';

const PIECE = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXED = () => new Date('2026-01-07T10:00:00.000Z');

function project() {
  const dir = mkdtempSync(join(tmpdir(), 'ap-'));
  const audit = join(dir, '.claude', 'audit', 'agent.audit.jsonl');
  return { dir, audit, env: { CLAUDE_PROJECT_DIR: dir } as Record<string, string> };
}

const payload = (
  tool_name: string,
  tool_input: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) =>
  JSON.stringify({
    session_id: 's1',
    tool_use_id: 'toolu_1',
    hook_event_name: 'PreToolUse',
    cwd: '/work',
    tool_name,
    tool_input,
    ...extra,
  });

const run = (kind: 'pre' | 'post', stdin: string, env: Record<string, string>) =>
  runHook(kind, stdin, { env, home: '/home/dev', now: FIXED });

describe('AC-7 pre hook fails closed', () => {
  it('blocks with exit 2 and a message naming the rule', () => {
    const p = project();
    const r = run('pre', payload('Read', { file_path: `${p.dir}/.env` }), p.env);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('[secret-read]');
    expect(r.stderr).toContain('policy/AI_CODING_AGENT_POLICY.md');
  });

  it('allows with exit 0 and no output', () => {
    const p = project();
    expect(run('pre', payload('Bash', { command: 'pnpm test' }), p.env)).toEqual({
      exitCode: 0,
      stderr: '',
    });
  });

  it('blocks invalid JSON, a missing tool name and a non-object', () => {
    const p = project();
    for (const bad of ['not json', '{}', '[]', JSON.stringify({ tool_name: '' })]) {
      const r = run('pre', bad, p.env);
      expect(r.exitCode, bad).toBe(2);
      expect(r.stderr).toContain('[invalid-input]');
    }
  });

  it('blocks everything when the config is invalid', () => {
    const p = project();
    mkdirSync(join(p.dir, '.claude'), { recursive: true });
    writeFileSync(join(p.dir, '.claude', 'agent-policy.yml'), 'allowed_host: [x]\n');
    const r = run('pre', payload('Bash', { command: 'ls' }), p.env);
    expect(r).toMatchObject({ exitCode: 2 });
    expect(r.stderr).toContain('[config-error]');
  });

  it('reads the repo config', () => {
    const p = project();
    mkdirSync(join(p.dir, '.claude'), { recursive: true });
    writeFileSync(join(p.dir, '.claude', 'agent-policy.yml'), 'allowed_hosts: ["tools.test"]\n');
    const ok = run('pre', payload('WebFetch', { url: 'https://tools.test/x' }), p.env);
    expect(ok.exitCode).toBe(0);
    expect(run('pre', payload('WebFetch', { url: 'https://github.com/x' }), p.env).exitCode).toBe(
      2,
    );
  });

  it('blocks an allowed call when the audit log cannot be written', () => {
    const p = project();
    const env = { ...p.env, AGENT_POLICY_AUDIT: '/dev/null/nope/audit.jsonl' };
    const r = run('pre', payload('Bash', { command: 'ls' }), env);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('[audit-unavailable]');
  });

  it('lets the call through if audit_required is false', () => {
    const p = project();
    mkdirSync(join(p.dir, '.claude'), { recursive: true });
    writeFileSync(join(p.dir, '.claude', 'agent-policy.yml'), 'audit_required: false\n');
    const env = { ...p.env, AGENT_POLICY_AUDIT: '/dev/null/nope/audit.jsonl' };
    expect(run('pre', payload('Bash', { command: 'ls' }), env).exitCode).toBe(0);
  });

  it('still blocks a bad call when the audit log cannot be written', () => {
    const p = project();
    const env = { ...p.env, AGENT_POLICY_AUDIT: '/dev/null/nope/audit.jsonl' };
    const r = run('pre', payload('Read', { file_path: `${p.dir}/.env` }), env);
    expect(r.stderr).toContain('[secret-read]');
  });

  it('falls back to the payload cwd without CLAUDE_PROJECT_DIR', () => {
    const p = project();
    const r = run('pre', payload('Read', { file_path: '.env' }, { cwd: p.dir }), {});
    expect(r.exitCode).toBe(2);
    expect(existsSync(p.audit)).toBe(true);
  });
});

describe('AC-8 audit records', () => {
  it('writes one record per pre decision and per post outcome, hash-chained', () => {
    const p = project();
    const secret = 'AKIAIOSFODNN7EXAMPLE';
    run('pre', payload('Bash', { command: `echo ${secret} | wc` }, { tool_use_id: 'a' }), p.env);
    run('post', payload('Bash', {}, { tool_use_id: 'a', hook_event_name: 'PostToolUse' }), p.env);
    run('pre', payload('Read', { file_path: `${p.dir}/.env` }, { tool_use_id: 'b' }), p.env);
    run('pre', payload('Bash', { command: 'ls' }, { tool_use_id: 'c' }), p.env);
    run(
      'post',
      payload('Bash', {}, { tool_use_id: 'c', hook_event_name: 'PostToolUseFailure' }),
      p.env,
    );

    const records = readAuditRecords(p.audit);
    expect(records.map((r) => [r.action, r.decision])).toEqual([
      ['pre-tool-use', 'allow'],
      ['post-tool-use', 'executed'],
      ['pre-tool-use', 'deny'],
      ['pre-tool-use', 'allow'],
      ['post-tool-use', 'failed'],
    ]);
    expect(records[2]?.detail).toMatchObject({
      rule: 'secret-read',
      target: `${p.dir}/.env`,
      session: 's1',
      toolUseId: 'b',
      tool: 'Read',
    });
    expect(verifyAuditChain(p.audit).ok).toBe(true);
    // No command text or file contents are stored, only hashes and metadata.
    expect(readFileSync(p.audit, 'utf8')).not.toContain(secret);
  });

  it('a post hook that cannot write exits 1 (non-blocking)', () => {
    const env = { AGENT_POLICY_AUDIT: '/dev/null/nope/audit.jsonl', CLAUDE_PROJECT_DIR: '/tmp' };
    const r = run('post', payload('Bash', {}), env);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('post hook');
    expect(run('post', 'garbage', env).exitCode).toBe(1);
  });

  it('keeps the chain valid when hook processes run in parallel', async () => {
    const p = project();
    const spawnHook = (id: number) =>
      new Promise<number | null>((resolve) => {
        const child = spawn(process.execPath, ['--import', 'tsx', 'src/bin.ts', 'hook', 'pre'], {
          cwd: PIECE,
          env: { ...process.env, CLAUDE_PROJECT_DIR: p.dir },
        });
        child.on('close', resolve);
        child.stdin.end(payload('Bash', { command: 'ls' }, { tool_use_id: `t${id}`, cwd: p.dir }));
      });
    const codes = await Promise.all(Array.from({ length: 8 }, (_, i) => spawnHook(i)));
    expect(codes).toEqual(Array(8).fill(0));
    expect(verifyAuditChain(p.audit)).toEqual({ ok: true, records: 8 });
  }, 30_000);
});

describe('withLock', () => {
  it('serializes, releases, and returns the result', () => {
    const lock = join(mkdtempSync(join(tmpdir(), 'lk-')), 'nested', 'x.lock');
    expect(withLock(lock, () => 42)).toBe(42);
    expect(existsSync(lock)).toBe(false);
    expect(() =>
      withLock(lock, () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(existsSync(lock)).toBe(false);
  });

  it('times out on a live lock and recovers a stale one', () => {
    const lock = join(mkdtempSync(join(tmpdir(), 'lk-')), 'x.lock');
    mkdirSync(lock);
    expect(() => withLock(lock, () => 1, { timeoutMs: 60, staleMs: 60_000 })).toThrow('timed out');
    const old = new Date(Date.now() - 60_000);
    utimesSync(lock, old, old);
    expect(withLock(lock, () => 'recovered', { staleMs: 1000 })).toBe('recovered');
  });

  it('rethrows unexpected filesystem errors', () => {
    expect(() => withLock('/dev/null/x.lock', () => 1)).toThrow();
  });
});

describe('cli', () => {
  const cli = (argv: string[], stdin = '', env: Record<string, string> = {}) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = runCli(argv, {
      env,
      home: '/home/dev',
      now: FIXED,
      stdin: () => stdin,
      out: (t) => out.push(t),
      err: (t) => err.push(t),
    });
    return { code, out: out.join('\n'), err: err.join('\n') };
  };

  it('hook pre blocks, hook post logs, and bad usage exits 2', () => {
    const p = project();
    expect(
      cli(['hook', 'pre'], payload('Read', { file_path: `${p.dir}/.env` }), p.env),
    ).toMatchObject({
      code: 2,
    });
    expect(cli(['hook', 'post'], payload('Bash', {}), p.env).code).toBe(0);
    expect(cli(['hook', 'sideways']).code).toBe(2);
    expect(cli(['bogus']).err).toContain('Usage');
    expect(cli([]).code).toBe(2);
  });

  it('metrics prints a summary and needs --log', () => {
    const p = project();
    cli(['hook', 'pre'], payload('Read', { file_path: `${p.dir}/.env` }), p.env);
    const r = cli(['metrics', '--log', p.audit, '--label', 'demo']);
    expect(r.out).toContain('Blocked risky actions: 1');
    expect(cli(['metrics']).err).toContain('--log');
  });
});
