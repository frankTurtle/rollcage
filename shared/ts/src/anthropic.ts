import { resolveModel } from './config.js';
import type { FetchLike } from './fetch.js';
import type { LlmClient, LlmRequest, LlmResponse } from './llm.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

/**
 * Live client for the Anthropic Messages API, using fetch (no SDK dependency).
 * The API key is read from the environment only and is never logged.
 * Tests inject `fetchImpl`; nothing in the test suite touches the network.
 */
export class AnthropicLlm implements LlmClient {
  private readonly apiKey: string;

  constructor(
    private readonly env: Record<string, string | undefined> = process.env,
    private readonly fetchImpl: FetchLike = fetch,
  ) {
    const key = env['ANTHROPIC_API_KEY'];
    if (!key) {
      throw new Error('AnthropicLlm: ANTHROPIC_API_KEY is not set in the environment');
    }
    this.apiKey = key;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const model = request.model ?? resolveModel(this.env);
    const body = {
      model,
      max_tokens: request.maxTokens ?? 1024,
      ...(request.system ? { system: request.system } : {}),
      messages: [{ role: 'user', content: request.prompt }],
    };
    const res = await this.fetchImpl(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': API_VERSION,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      // Status only: the response body is not echoed, so nothing sensitive can leak into logs.
      throw new Error(`AnthropicLlm: API request failed with status ${res.status}`);
    }
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = (data.content ?? [])
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('');
    return { text, model };
  }
}
