import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Finding {
  id: string;
  message: string;
}

/** Text that must appear in a hook command, so an unrelated command does not count. */
const HOOK_MARKER = 'agent-policy';

export interface CheckOptions {
  policyPath?: string;
}

interface HookGroup {
  hooks?: { command?: unknown; onFailure?: unknown }[];
}

/** True if a hook for this tool runs `marker` and (when `blocking`) is set to block if it fails. */
const hasHook = (groups: unknown, marker: string, blocking = false): boolean =>
  Array.isArray(groups) &&
  (groups as HookGroup[]).some((g) =>
    g.hooks?.some(
      (h) =>
        typeof h.command === 'string' &&
        h.command.includes(marker) &&
        (!blocking || h.onFailure === 'block'),
    ),
  );

/** Verify a repository has the policy file and the Claude Code guardrail settings. */
export function checkRepo(root: string, opts: CheckOptions = {}): Finding[] {
  const policyPath = opts.policyPath ?? 'policy/AI_CODING_AGENT_POLICY.md';
  const marker = HOOK_MARKER;
  const findings: Finding[] = [];

  const policy = join(root, policyPath);
  if (!existsSync(policy)) {
    findings.push({ id: 'policy-missing', message: `${policyPath} is missing.` });
  } else if (!/^#\s+\S/m.test(readFileSync(policy, 'utf8'))) {
    findings.push({ id: 'policy-empty', message: `${policyPath} has no content.` });
  }

  const settingsPath = join(root, '.claude', 'settings.json');
  if (!existsSync(settingsPath)) {
    findings.push({ id: 'settings-missing', message: '.claude/settings.json is missing.' });
    return findings;
  }
  let settings: {
    hooks?: Record<string, unknown>;
    permissions?: { deny?: unknown };
    disableAllHooks?: unknown;
  };
  try {
    settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as typeof settings;
  } catch {
    findings.push({ id: 'settings-invalid', message: '.claude/settings.json is not valid JSON.' });
    return findings;
  }

  if (!hasHook(settings.hooks?.['PreToolUse'], marker)) {
    findings.push({ id: 'hook-pre-missing', message: `No PreToolUse hook runs ${marker}.` });
  } else if (!hasHook(settings.hooks?.['PreToolUse'], marker, true)) {
    // Without onFailure "block", a missing or crashing hook is a non-blocking error and the call runs.
    findings.push({
      id: 'hook-pre-not-blocking',
      message: `The PreToolUse hook for ${marker} must set "onFailure": "block", or a crash lets calls through.`,
    });
  }
  if (!hasHook(settings.hooks?.['PostToolUse'], marker)) {
    findings.push({ id: 'hook-post-missing', message: `No PostToolUse hook runs ${marker}.` });
  }
  if (settings.disableAllHooks === true) {
    findings.push({ id: 'hooks-disabled', message: 'disableAllHooks is true.' });
  }

  const deny = Array.isArray(settings.permissions?.deny)
    ? (settings.permissions.deny as unknown[]).filter((d): d is string => typeof d === 'string')
    : [];
  if (!deny.some((d) => d.startsWith('Read(') && d.includes('.env'))) {
    findings.push({
      id: 'deny-secret-read',
      message: 'permissions.deny has no Read rule for .env files.',
    });
  }
  if (!deny.some((d) => /^Bash\(git push\b.*(--force|-f)/.test(d))) {
    findings.push({
      id: 'deny-force-push',
      message: 'permissions.deny has no rule for git push --force.',
    });
  }
  return findings;
}
