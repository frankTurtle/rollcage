import type { LlmClient, LlmRequest, LlmResponse } from './llm.js';

export type FakeReply = string | Error | ((request: LlmRequest) => string);

/**
 * Scripted LLM for tests. Replies are consumed in order.
 * Running out of replies throws, so a test never silently gets a default answer.
 */
export class FakeLlm implements LlmClient {
  readonly calls: LlmRequest[] = [];
  private readonly replies: FakeReply[];

  constructor(
    replies: FakeReply[],
    private readonly model = 'fake-model',
  ) {
    this.replies = [...replies];
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    this.calls.push(request);
    const next = this.replies.shift();
    if (next === undefined) {
      throw new Error('FakeLlm: no scripted reply left for this call');
    }
    if (next instanceof Error) {
      throw next;
    }
    const text = typeof next === 'function' ? next(request) : next;
    return { text, model: this.model };
  }
}
