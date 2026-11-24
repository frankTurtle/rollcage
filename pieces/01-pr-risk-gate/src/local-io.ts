import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { GateIO, PrContext } from './types.js';

const LocalMeta = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  author: z.string(),
  labels: z.array(z.string()).default([]),
  approvals: z.array(z.string()).default([]),
});

/** Reads a PR from a diff file plus a metadata JSON file. Used by tests, demos and offline runs. */
export class LocalIO implements GateIO {
  constructor(
    private readonly diffPath: string,
    private readonly metaPath: string,
    private readonly print: (text: string) => void,
  ) {}

  async load(): Promise<PrContext> {
    const { approvals, ...meta } = LocalMeta.parse(JSON.parse(readFileSync(this.metaPath, 'utf8')));
    return { meta, diff: readFileSync(this.diffPath, 'utf8'), approvals };
  }

  async publish(body: string): Promise<string> {
    this.print(body);
    return 'local mode, nothing posted';
  }
}
