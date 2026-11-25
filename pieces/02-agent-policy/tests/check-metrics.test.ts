import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuditLogger } from '@adl/shared';
import type { AuditRecord } from '@adl/shared';
import { describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.ts';
import { checkRepo } from '../src/check.ts';
import { loadPolicyConfig } from '../src/config.ts';
import { AUDIT_ACTOR } from '../src/audit-schema.ts';
import { computeMetrics, formatMetrics, isoWeek } from '../src/metrics.ts';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const hookGroup = (command: string, extra: Record<string, unknown> = {}) => [
  { matcher: '*', hooks: [{ type: 'command', command, ...extra }] },
];
const goodSettings = () => ({
  permissions: { deny: ['Read(./.env)', 'Bash(git push --force *)'] },
  hooks: {
    PreToolUse: hookGroup('node .claude/hooks/agent-policy-hook.mjs hook pre', {
      onFailure: 'block',
    }),
    PostToolUse: hookGroup('node .claude/hooks/agent-policy-hook.mjs hook post'),
  },
});

function repo(settings: unknown | undefined, policy: string | null = '# Policy\n\ntext\n') {
  const root = mkdtempSync(join(tmpdir(), 'chk-'));
  if (policy !== null) {
    mkdirSync(join(root, 'policy'));
    writeFileSync(join(root, 'policy', 'AI_CODING_AGENT_POLICY.md'), policy);
  }
  if (settings !== undefined) {
    mkdirSync(join(root, '.claude'));
    writeFileSync(
      join(root, '.claude', 'settings.json'),
      typeof settings === 'string' ? settings : JSON.stringify(settings),
    );
  }
  return root;
}

const ids = (root: string) => checkRepo(root).map((f) => f.id);

describe('AC-9 checkRepo', () => {
  it('passes a repo with the policy and guardrails', () => {
    expect(ids(repo(goodSettings()))).toEqual([]);
  });

  it('this repository passes its own check', () => {
    expect(checkRepo(REPO_ROOT)).toEqual([]);
  });

  it('fails without the policy file or with an empty one', () => {
    expect(ids(repo(goodSettings(), null))).toEqual(['policy-missing']);
    expect(ids(repo(goodSettings(), '   \n'))).toEqual(['policy-empty']);
  });

  it('fails without settings, or with invalid settings', () => {
    expect(ids(repo(undefined))).toEqual(['settings-missing']);
    expect(ids(repo('{ nope'))).toEqual(['settings-invalid']);
  });

  it('fails when hooks are missing, unrelated or disabled', () => {
    const noHooks = { permissions: goodSettings().permissions };
    expect(ids(repo(noHooks))).toEqual(['hook-pre-missing', 'hook-post-missing']);
    const other = {
      ...goodSettings(),
      hooks: { PreToolUse: hookGroup('echo hi'), PostToolUse: [] },
    };
    expect(ids(repo(other))).toEqual(['hook-pre-missing', 'hook-post-missing']);
    expect(ids(repo({ ...goodSettings(), disableAllHooks: true }))).toEqual(['hooks-disabled']);
  });

  it('fails when the PreToolUse hook does not block on failure', () => {
    const lax = {
      ...goodSettings(),
      hooks: {
        ...goodSettings().hooks,
        PreToolUse: hookGroup('node agent-policy-hook.mjs hook pre'),
      },
    };
    expect(ids(repo(lax))).toEqual(['hook-pre-not-blocking']);
    const wrong = {
      ...goodSettings(),
      hooks: {
        ...goodSettings().hooks,
        PreToolUse: hookGroup('node agent-policy-hook.mjs hook pre', { onFailure: 'continue' }),
      },
    };
    expect(ids(repo(wrong))).toEqual(['hook-pre-not-blocking']);
  });

  it('fails when the deny rules are missing', () => {
    const settings = { ...goodSettings(), permissions: { deny: ['Bash(rm -rf /)', 5] } };
    expect(ids(repo(settings))).toEqual(['deny-secret-read', 'deny-force-push']);
    expect(ids(repo({ ...goodSettings(), permissions: {} }))).toEqual([
      'deny-secret-read',
      'deny-force-push',
    ]);
  });

  it('honors a custom policy path', () => {
    const root = repo(goodSettings(), null);
    mkdirSync(join(root, 'docs'));
    writeFileSync(join(root, 'docs', 'ai.md'), '# AI\n');
    expect(checkRepo(root, { policyPath: 'docs/ai.md' })).toEqual([]);
    rmSync(root, { recursive: true });
  });

  it('the cli reports findings and exits 1', () => {
    const out: string[] = [];
    const err: string[] = [];
    const deps = {
      env: {},
      home: '/h',
      stdin: () => '',
      out: (t: string) => out.push(t),
      err: (t: string) => err.push(t),
    };
    expect(runCli(['check', '--root', repo(undefined)], deps)).toBe(1);
    expect(err.join('\n')).toContain('FAIL settings-missing');
    expect(runCli(['check', '--root', repo(goodSettings())], deps)).toBe(0);
    expect(out.join('\n')).toContain('passed');
    expect(runCli(['check', '--root', repo(goodSettings(), null), '--policy', 'x.md'], deps)).toBe(
      1,
    );
  });
});

function auditWith(entries: [string, string, string, Record<string, unknown>][]): AuditRecord[] {
  const path = join(mkdtempSync(join(tmpdir(), 'm-')), 'a.jsonl');
  let t = Date.parse('2026-01-05T00:00:00Z');
  const log = new AuditLogger(path, () => new Date((t += 86_400_000)));
  return entries.map(([action, decision, , detail]) =>
    log.append({ actor: AUDIT_ACTOR, action, input: detail, decision, detail }),
  );
}

describe('AC-10 metrics', () => {
  it('computes ISO weeks', () => {
    expect(isoWeek(new Date('2026-01-01T00:00:00Z'))).toBe('2026-W01');
    expect(isoWeek(new Date('2024-12-30T00:00:00Z'))).toBe('2025-W01');
    expect(isoWeek(new Date('2021-01-03T00:00:00Z'))).toBe('2020-W53');
    expect(isoWeek(new Date('2026-07-15T12:00:00Z'))).toBe('2026-W29');
  });

  it('counts blocks by week and rule, and complete sessions', () => {
    const records = auditWith([
      ['pre-tool-use', 'allow', '', { session: 's1', toolUseId: 'a' }],
      ['post-tool-use', 'executed', '', { session: 's1', toolUseId: 'a' }],
      ['pre-tool-use', 'deny', '', { session: 's1', toolUseId: 'b', rule: 'secret-read' }],
      ['pre-tool-use', 'deny', '', { session: 's2', toolUseId: 'c', rule: 'force-push' }],
      ['pre-tool-use', 'allow', '', { session: 's3', toolUseId: 'd' }],
      ['pre-tool-use', 'allow', '', { session: 's4' }],
      ['pre-tool-use', 'allow', '', { session: 's5', toolUseId: 'e' }],
      ['post-tool-use', 'failed', '', { session: 's5', toolUseId: 'e' }],
      ['pre-tool-use', 'deny', '', { toolUseId: 'f' }],
    ]);
    records.push({ ...records[0], actor: 'someone-else' } as AuditRecord);
    const m = computeMetrics(records);
    expect(m.totalBlocked).toBe(3);
    expect(m.blockedByRule).toEqual({ 'secret-read': 1, 'force-push': 1, unknown: 1 });
    expect(Object.values(m.blockedByWeek).reduce((a, b) => a + b, 0)).toBe(3);
    expect(m.sessions).toBe(6);
    expect(m.incompleteSessions.sort()).toEqual(['s3', 's4']);
    expect(m.pctComplete).toBe(66.7);
    const text = formatMetrics('label', m);
    expect(text).toContain('Blocked risky actions: 3');
    expect(text).toContain('4/6 (66.7%)');
  });

  it('handles an empty log', () => {
    const m = computeMetrics([]);
    expect(m.pctComplete).toBeNull();
    const text = formatMetrics('x', m);
    expect(text).toContain('n/a');
    expect(text).toContain('none');
  });
});

describe('templates stay in sync', () => {
  const read = (path: string) =>
    JSON.parse(readFileSync(join(REPO_ROOT, path), 'utf8')) as {
      hooks: Record<string, { hooks: { command: string }[] }[]>;
    };
  const normalize = (settings: ReturnType<typeof read>) =>
    JSON.parse(
      JSON.stringify(settings, (key, value: unknown) => (key === 'command' ? 'HOOK' : value)),
    ) as unknown;

  it('the repo settings equal the template apart from the hook command', () => {
    expect(normalize(read('.claude/settings.json'))).toEqual(
      normalize(read('pieces/02-agent-policy/templates/settings.json')),
    );
  });

  it('the template config lists exactly the default hosts', () => {
    const template = readFileSync(
      join(REPO_ROOT, 'pieces/02-agent-policy/templates/agent-policy.yml'),
      'utf8',
    );
    expect(loadPolicyConfig(template).allowed_hosts).toEqual(loadPolicyConfig().allowed_hosts);
  });
});
