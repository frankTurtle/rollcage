import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { requestKey } from './llm.js';
import type { LlmClient, LlmRequest, LlmResponse } from './llm.js';

export type ReplayMode = 'replay' | 'record';

/**
 * Record/replay wrapper.
 * - replay (default): answers only from fixture files; a missing fixture throws. No network.
 * - record: calls the wrapped live client and writes the response to a fixture file.
 * Record mode needs an explicit `live` client, so it can never happen by accident.
 */
export class RecordReplayLlm implements LlmClient {
  constructor(
    private readonly fixtureDir: string,
    private readonly mode: ReplayMode = 'replay',
    private readonly live?: LlmClient,
  ) {
    if (mode === 'record' && !live) {
      throw new Error('RecordReplayLlm: record mode requires a live client');
    }
  }

  fixturePath(request: LlmRequest): string {
    return join(this.fixtureDir, `${requestKey(request)}.json`);
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const path = this.fixturePath(request);
    if (this.mode === 'replay') {
      if (!existsSync(path)) {
        throw new Error(`RecordReplayLlm: no recorded fixture at ${path}`);
      }
      return JSON.parse(readFileSync(path, 'utf8')) as LlmResponse;
    }
    const response = await (this.live as LlmClient).complete(request);
    mkdirSync(this.fixtureDir, { recursive: true });
    writeFileSync(path, `${JSON.stringify(response, null, 2)}\n`);
    return response;
  }
}
