import type { ZodType } from 'zod';
import type { LlmClient, LlmRequest } from './llm.js';

export interface StructuredResult<T> {
  value: T;
  /** 'model' when the LLM output validated; 'fallback' when the deterministic result was used. */
  source: 'model' | 'fallback';
  attempts: number;
  /** Why the fallback was used. Present only when source is 'fallback'. */
  reason?: string;
}

/** Pull a JSON object out of model text, tolerating a ```json fence. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = (fenced?.[1] ?? text).trim();
  return JSON.parse(candidate);
}

/**
 * Ask the model for JSON and validate it with a schema.
 * Invalid output (or a failed call): retry once, then return `fallback()`.
 * The caller supplies the fallback, so a gate decides what "fail closed" means for its domain.
 */
export async function completeStructured<T>(
  client: LlmClient,
  request: LlmRequest,
  schema: ZodType<T>,
  fallback: () => T,
): Promise<StructuredResult<T>> {
  let reason = 'unknown';
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await client.complete(request);
      const parsed = schema.safeParse(extractJson(response.text));
      if (parsed.success) {
        return { value: parsed.data, source: 'model', attempts: attempt };
      }
      reason = `schema validation failed: ${parsed.error.issues[0]?.message ?? 'invalid'}`;
    } catch (error) {
      reason = error instanceof Error ? error.message : 'call failed';
    }
  }
  return { value: fallback(), source: 'fallback', attempts: 2, reason };
}
