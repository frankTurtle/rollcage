import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AuditLogger } from '@adl/shared';
import { z } from 'zod';
import { loadPolicyConfig } from './config.js';
import type { PolicyConfig } from './config.js';
import { deny, evaluate } from './guard.js';
import type { Decision } from './guard.js';
import { withLock } from './lock.js';

export const AUDIT_ACTOR = 'agent-policy';

const HookInput = z
  .object({
    tool_name: z.string().min(1),
    tool_input: z.record(z.unknown()).default({}),
    cwd: z.string().optional(),
    session_id: z.string().optional(),
    tool_use_id: z.string().optional(),
    hook_event_name: z.string().optional(),
  })
  .passthrough();

export interface HookDeps {
  env: Record<string, string | undefined>;
  home: string;
  now?: () => Date;
}

export interface HookResult {
  /** 2 blocks the tool call. 1 is a non-blocking error. 0 is success. */
  exitCode: 0 | 1 | 2;
  stderr: string;
}

function blockMessage(d: Decision): string {
  const target = d.target ? ` (${d.target})` : '';
  return `Blocked by agent policy [${d.rule}]: ${d.reason}${target} See policy/AI_CODING_AGENT_POLICY.md.`;
}

function appendAudit(
  auditPath: string,
  entry: Parameters<AuditLogger['append']>[0],
  now: (() => Date) | undefined,
): void {
  withLock(`${auditPath}.lock`, () => new AuditLogger(auditPath, now).append(entry));
}

/**
 * Handle one hook invocation. `pre` decides and logs; `post` logs the outcome.
 * Every failure in `pre` ends in exit code 2, because exit code 1 would let the call proceed.
 */
export function runHook(kind: 'pre' | 'post', stdin: string, deps: HookDeps): HookResult {
  const failure = (rule: Parameters<typeof deny>[0], reason: string): HookResult =>
    kind === 'pre'
      ? { exitCode: 2, stderr: blockMessage(deny(rule, reason)) }
      : { exitCode: 1, stderr: `agent-policy post hook: ${reason}` };

  let parsed: z.infer<typeof HookInput>;
  try {
    parsed = HookInput.parse(JSON.parse(stdin));
  } catch {
    return failure('invalid-input', 'The hook input is not valid JSON for a tool call.');
  }

  const projectDir = deps.env['CLAUDE_PROJECT_DIR'] ?? parsed.cwd ?? process.cwd();
  const auditPath =
    deps.env['AGENT_POLICY_AUDIT'] ?? join(projectDir, '.claude', 'audit', 'agent.audit.jsonl');
  const detailBase = {
    session: parsed.session_id ?? null,
    toolUseId: parsed.tool_use_id ?? null,
    tool: parsed.tool_name,
  };
  const input = { tool_name: parsed.tool_name, tool_input: parsed.tool_input };

  if (kind === 'post') {
    try {
      const failed = parsed.hook_event_name === 'PostToolUseFailure';
      appendAudit(
        auditPath,
        {
          actor: AUDIT_ACTOR,
          action: 'post-tool-use',
          input,
          decision: failed ? 'failed' : 'executed',
          detail: detailBase,
        },
        deps.now,
      );
      return { exitCode: 0, stderr: '' };
    } catch (error) {
      return failure('audit-unavailable', `could not write the audit log (${String(error)})`);
    }
  }

  let config: PolicyConfig;
  try {
    const path = join(projectDir, '.claude', 'agent-policy.yml');
    config = loadPolicyConfig(existsSync(path) ? readFileSync(path, 'utf8') : undefined);
  } catch {
    return failure('config-error', 'The agent policy config is invalid.');
  }

  let decision = evaluate(
    { tool_name: parsed.tool_name, tool_input: parsed.tool_input, cwd: parsed.cwd ?? projectDir },
    { projectDir, home: deps.home, config },
  );
  try {
    appendAudit(
      auditPath,
      {
        actor: AUDIT_ACTOR,
        action: 'pre-tool-use',
        input,
        decision: decision.allow ? 'allow' : 'deny',
        detail: {
          ...detailBase,
          ...(decision.rule ? { rule: decision.rule } : {}),
          ...(decision.target ? { target: decision.target } : {}),
        },
      },
      deps.now,
    );
  } catch {
    if (config.audit_required && decision.allow) {
      decision = deny(
        'audit-unavailable',
        'The audit log cannot be written, so the call is blocked.',
      );
    }
  }
  return decision.allow
    ? { exitCode: 0, stderr: '' }
    : { exitCode: 2, stderr: blockMessage(decision) };
}
