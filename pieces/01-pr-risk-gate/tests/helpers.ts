import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.ts';
import type { GateIO, PrContext } from '../src/types.ts';

export const PIECE = join(dirname(fileURLToPath(import.meta.url)), '..');
export const FX = join(PIECE, 'demo', 'fixtures');
export const LLM_FX = join(PIECE, 'demo', 'llm-fixtures');
export const DEMO_CONFIG = join(PIECE, 'demo', 'risk-gate.demo.yml');

export const demoConfig = () => loadConfig(readFileSync(DEMO_CONFIG, 'utf8'));
export const fixture = (name: string) => readFileSync(join(FX, name), 'utf8');

/** A minimal single-file diff that adds `lines` lines to `path`, starting at line 1. */
export function addDiff(path: string, lines: number): string {
  const body = Array.from({ length: lines }, (_, i) => `+line ${i + 1}`).join('\n');
  return `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines} @@\n${body}\n`;
}

export class MemoryIO implements GateIO {
  published: string[] = [];
  constructor(private readonly ctx: PrContext) {}
  async load(): Promise<PrContext> {
    return this.ctx;
  }
  async publish(body: string): Promise<string> {
    this.published.push(body);
    return 'memory';
  }
}

export const ctx = (diff: string, over: Partial<PrContext> = {}): PrContext => ({
  meta: { number: 7, title: 'Test PR', author: 'author', labels: [] },
  diff,
  approvals: [],
  ...over,
});
