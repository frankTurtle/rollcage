import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface SelftestCheck {
  name: string;
  ok: boolean;
  detail: string;
}

/** Runs a shell command with the given stdin and environment. Injected so tests need no processes. */
export type Runner = (
  command: string,
  stdin: string,
  env: NodeJS.ProcessEnv,
) => { status: number | null; stderr: string };

const realRunner: Runner = (command, stdin, env) => {
  const r = spawnSync('sh', ['-c', command], { input: stdin, env, encoding: 'utf8' });
  return { status: r.status, stderr: r.stderr ?? '' };
};

function preToolUseCommand(root: string): string | undefined {
  const path = join(root, '.claude', 'settings.json');
  if (!existsSync(path)) return undefined;
  try {
    const settings = JSON.parse(readFileSync(path, 'utf8')) as {
      hooks?: { PreToolUse?: { hooks?: { command?: unknown }[] }[] };
    };
    const hooks = settings.hooks?.PreToolUse?.flatMap((g) => g.hooks ?? []) ?? [];
    return hooks.map((h) => h.command).find((c): c is string => typeof c === 'string');
  } catch {
    return undefined;
  }
}

/**
 * Run the PreToolUse hook command exactly as Claude Code would, from `.claude/settings.json`, and
 * check that it lets a harmless call through and blocks a secret read. Run it after changing hook
 * code and before starting a session: a broken hook with `onFailure: block` stops every tool call.
 */
export function selftest(root: string, run: Runner = realRunner): SelftestCheck[] {
  const command = preToolUseCommand(root);
  if (!command) {
    return [
      {
        name: 'hook configured',
        ok: false,
        detail: 'no PreToolUse hook command in .claude/settings.json',
      },
    ];
  }
  const dir = mkdtempSync(join(tmpdir(), 'agent-policy-selftest-'));
  try {
    const env = {
      ...process.env,
      CLAUDE_PROJECT_DIR: root,
      AGENT_POLICY_AUDIT: join(dir, 'audit.jsonl'),
    };
    const call = (tool_name: string, tool_input: Record<string, unknown>) =>
      run(
        command,
        JSON.stringify({
          session_id: 'selftest',
          tool_use_id: 'selftest',
          hook_event_name: 'PreToolUse',
          cwd: root,
          tool_name,
          tool_input,
        }),
        env,
      );
    const allowed = call('Bash', { command: 'ls' });
    const blocked = call('Read', { file_path: join(root, '.env') });
    return [
      {
        name: 'allows a harmless command',
        ok: allowed.status === 0,
        detail:
          allowed.status === 0
            ? 'exit 0'
            : `exit ${allowed.status}: ${allowed.stderr.trim().slice(0, 200)}`,
      },
      {
        name: 'blocks reading .env',
        ok: blocked.status === 2 && blocked.stderr.includes('secret-read'),
        detail: blocked.status === 2 ? 'exit 2' : `exit ${blocked.status} (the hook did not block)`,
      },
    ];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
