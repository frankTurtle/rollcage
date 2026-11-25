import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.ts';
import { selftest } from '../src/selftest.ts';
import type { Runner } from '../src/selftest.ts';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function project(settings: unknown): string {
  const root = mkdtempSync(join(tmpdir(), 'st-'));
  mkdirSync(join(root, '.claude'));
  writeFileSync(
    join(root, '.claude', 'settings.json'),
    typeof settings === 'string' ? settings : JSON.stringify(settings),
  );
  return root;
}
const withHook = (command: unknown) => ({
  hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command }] }] },
});

/** A runner that behaves like a good hook: allows `ls`, blocks .env with the rule name. */
const goodRunner: Runner = (_command, stdin) => {
  const call = JSON.parse(stdin) as { tool_name: string };
  return call.tool_name === 'Read'
    ? { status: 2, stderr: 'Blocked by agent policy [secret-read]' }
    : { status: 0, stderr: '' };
};

describe('selftest', () => {
  it('passes when the hook allows a harmless call and blocks a secret read', () => {
    const checks = selftest(project(withHook('hook')), goodRunner);
    expect(checks.map((c) => c.ok)).toEqual([true, true]);
  });

  it('runs the configured command with the project dir and a private audit path', () => {
    const seen: { command: string; env: NodeJS.ProcessEnv }[] = [];
    const root = project(withHook('my-hook --flag'));
    selftest(root, (command, stdin, env) => {
      seen.push({ command, env });
      return goodRunner(command, stdin, env);
    });
    expect(seen.map((s) => s.command)).toEqual(['my-hook --flag', 'my-hook --flag']);
    expect(seen[0]?.env['CLAUDE_PROJECT_DIR']).toBe(root);
    expect(seen[0]?.env['AGENT_POLICY_AUDIT']).not.toContain(root);
  });

  it('fails when the hook crashes on a harmless call (it would block every tool call)', () => {
    const checks = selftest(project(withHook('hook')), () => ({
      status: 127,
      stderr: 'tsx: not found',
    }));
    expect(checks[0]).toMatchObject({ ok: false });
    expect(checks[0]?.detail).toContain('exit 127');
    expect(checks[0]?.detail).toContain('not found');
  });

  it('fails when the hook lets a secret read through (it fails open)', () => {
    const checks = selftest(project(withHook('hook')), () => ({ status: 0, stderr: '' }));
    expect(checks[1]).toMatchObject({ ok: false });
    expect(checks[1]?.detail).toContain('did not block');
  });

  it('fails when it blocks for the wrong reason or with the wrong code', () => {
    expect(
      selftest(project(withHook('hook')), (_c, stdin) =>
        JSON.parse(stdin).tool_name === 'Read'
          ? { status: 2, stderr: 'something else' }
          : { status: 0, stderr: '' },
      )[1]?.ok,
    ).toBe(false);
    expect(
      selftest(project(withHook('hook')), (_c, stdin) =>
        JSON.parse(stdin).tool_name === 'Read'
          ? { status: 1, stderr: 'secret-read' }
          : { status: 0, stderr: '' },
      )[1]?.ok,
    ).toBe(false);
  });

  it('reports a missing or unreadable configuration instead of crashing', () => {
    const none = mkdtempSync(join(tmpdir(), 'st-'));
    for (const root of [none, project('{ not json'), project({}), project(withHook(42))]) {
      const checks = selftest(root, goodRunner);
      expect(checks).toHaveLength(1);
      expect(checks[0]).toMatchObject({ name: 'hook configured', ok: false });
    }
  });

  it("this repository's real hook passes (runs the real command)", () => {
    expect(selftest(REPO_ROOT).map((c) => c.ok)).toEqual([true, true]);
  }, 30_000);

  it('the cli prints each check and exits 1 on a failure', () => {
    const out: string[] = [];
    const deps = {
      env: {},
      home: '/h',
      stdin: () => '',
      out: (t: string) => out.push(t),
      err: () => undefined,
    };
    expect(runCli(['selftest', '--root', REPO_ROOT], deps)).toBe(0);
    expect(out.join('\n')).toContain('ok   blocks reading .env');
    expect(runCli(['selftest', '--root', mkdtempSync(join(tmpdir(), 'st-'))], deps)).toBe(1);
  }, 30_000);
});
