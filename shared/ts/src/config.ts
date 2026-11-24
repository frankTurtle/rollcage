/**
 * The one place the default model id lives.
 * Source: https://platform.claude.com/docs/en/about-claude/models/overview (read 2026-11-24).
 * Override at runtime with the ANTHROPIC_MODEL environment variable.
 */
export const DEFAULT_MODEL = 'claude-sonnet-5-5';

export function resolveModel(env: Record<string, string | undefined> = process.env): string {
  const fromEnv = env['ANTHROPIC_MODEL']?.trim();
  return fromEnv ? fromEnv : DEFAULT_MODEL;
}

/** Live LLM calls are opt-in. Tests and default demos never set this. */
export function isLiveMode(env: Record<string, string | undefined> = process.env): boolean {
  return env['DEMO_LIVE'] === '1';
}
