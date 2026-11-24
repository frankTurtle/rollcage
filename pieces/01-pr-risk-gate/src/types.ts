export type RiskLevel = 'low' | 'medium' | 'high';

const ORDER: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

export function maxLevel(a: RiskLevel, b: RiskLevel): RiskLevel {
  return ORDER[a] >= ORDER[b] ? a : b;
}

export interface DiffFile {
  path: string;
  oldPath?: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed';
  added: number;
  removed: number;
  /** Line numbers (in the new file) of every added line. */
  addedLines: number[];
  binary: boolean;
}

export interface PrMeta {
  number: number;
  title: string;
  author: string;
  labels: string[];
}

export interface PrContext {
  meta: PrMeta;
  diff: string;
  /** Logins whose latest review is an approval. May include the author or bots; policy filters. */
  approvals: string[];
}

/** Where the gate reads a PR from and publishes its comment to. */
export interface GateIO {
  load(): Promise<PrContext>;
  /** Returns a short description of what happened, for example "created" or "updated". */
  publish(body: string): Promise<string>;
}
