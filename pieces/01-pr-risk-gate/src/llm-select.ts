import { AnthropicLlm, RecordReplayLlm } from '@adl/shared';
import type { LlmClient, LlmResponse } from '@adl/shared';

export type LlmMode = 'auto' | 'live' | 'replay' | 'none';

/** Stands in when no model is configured. Always fails, so the gate uses its deterministic result. */
export class UnavailableLlm implements LlmClient {
  constructor(private readonly why: string) {}
  async complete(): Promise<LlmResponse> {
    throw new Error(this.why);
  }
}

/**
 * Choose the LLM client.
 * auto: live if ANTHROPIC_API_KEY is set, otherwise none. Never replay, never silent network
 * without a key. replay: recorded fixtures only. none: deterministic result only.
 */
export function selectLlm(
  mode: LlmMode,
  env: Record<string, string | undefined>,
  fixturesDir?: string,
): LlmClient {
  switch (mode) {
    case 'live':
      return new AnthropicLlm(env);
    case 'replay':
      if (!fixturesDir) throw new Error('--llm replay requires --fixtures <dir>');
      return new RecordReplayLlm(fixturesDir, 'replay');
    case 'none':
      return new UnavailableLlm('LLM disabled (--llm none)');
    case 'auto':
      return env['ANTHROPIC_API_KEY']
        ? new AnthropicLlm(env)
        : new UnavailableLlm('ANTHROPIC_API_KEY is not set');
  }
}
