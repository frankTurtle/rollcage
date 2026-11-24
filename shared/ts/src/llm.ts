import { createHash } from 'node:crypto';

export interface LlmRequest {
  system?: string;
  prompt: string;
  maxTokens?: number;
  model?: string;
}

export interface LlmResponse {
  text: string;
  model: string;
}

/** Every LLM call in the library goes through this interface. */
export interface LlmClient {
  complete(request: LlmRequest): Promise<LlmResponse>;
}

/** Stable JSON: object keys sorted, so equal requests hash equally. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
      );
    }
    return v;
  });
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Hash of the fields that determine a response. Used as the fixture key. */
export function requestKey(request: LlmRequest): string {
  return sha256Hex(
    canonicalJson({
      system: request.system ?? null,
      prompt: request.prompt,
      model: request.model ?? null,
    }),
  );
}
