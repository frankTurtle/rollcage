import {
  appendFileSync,
  closeSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { canonicalJson, sha256Hex } from './llm.js';
import { withLock } from './lock.js';

export interface AuditRecord {
  /** ISO 8601 timestamp. */
  timestamp: string;
  actor: string;
  action: string;
  /** SHA-256 of the canonical JSON of the input. The input itself is never stored. */
  inputHash: string;
  decision: string;
  detail?: Record<string, unknown>;
  /** Hash of the previous line's content, or 'genesis' for the first line. Makes edits detectable. */
  prevHash: string;
}

export interface AuditEntry {
  actor: string;
  action: string;
  input: unknown;
  decision: string;
  detail?: Record<string, unknown>;
}

const GENESIS = 'genesis';

/**
 * Append-only JSONL audit log. There is no API to rewrite or truncate it.
 * Each line carries a hash of the previous line, so verifyAuditChain detects edits and deletions
 * in the middle of the file (not truncation of the tail; ship the log off-box for that).
 */
export class AuditLogger {
  constructor(
    private readonly path: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    mkdirSync(dirname(path), { recursive: true });
  }

  /**
   * Append one record. The last line is read under a file lock, so several processes (for example
   * parallel hooks) can append to the same log without forking the hash chain.
   */
  append(entry: AuditEntry): AuditRecord {
    return withLock(`${this.path}.lock`, () => {
      const last = lastLine(this.path);
      const record: AuditRecord = {
        timestamp: this.now().toISOString(),
        actor: entry.actor,
        action: entry.action,
        inputHash: sha256Hex(canonicalJson(entry.input)),
        decision: entry.decision,
        ...(entry.detail ? { detail: entry.detail } : {}),
        prevHash: last ? sha256Hex(last) : GENESIS,
      };
      appendFileSync(this.path, `${JSON.stringify(record)}\n`, { flag: 'a' });
      return record;
    });
  }
}

const TAIL_CHUNK = 8192;

/** The last non-empty line of a file, read from the end so cost does not grow with the log. */
function lastLine(path: string): string | undefined {
  let fd: number;
  try {
    fd = openSync(path, 'r');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  try {
    let end = fstatSync(fd).size;
    let acc = Buffer.alloc(0);
    while (end > 0) {
      const start = Math.max(0, end - TAIL_CHUNK);
      const chunk = Buffer.alloc(end - start);
      readSync(fd, chunk, 0, chunk.length, start);
      acc = Buffer.concat([chunk, acc]);
      end = start;
      let stop = acc.length;
      while (stop > 0 && acc[stop - 1] === 0x0a) stop--;
      const newline = acc.subarray(0, stop).lastIndexOf(0x0a);
      if (newline >= 0 || end === 0) {
        const line = acc.subarray(newline + 1, stop).toString('utf8');
        return line || undefined;
      }
    }
    return undefined;
  } finally {
    closeSync(fd);
  }
}

/** Read every record from an audit log. Throws on a line that is not JSON. */
export function readAuditRecords(path: string): AuditRecord[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as AuditRecord);
}

export interface ChainCheck {
  ok: boolean;
  records: number;
  /** 1-based line number of the first broken link, when ok is false. */
  brokenAt?: number;
}

export function verifyAuditChain(path: string): ChainCheck {
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
  let expected = GENESIS;
  for (const [i, line] of lines.entries()) {
    let parsed: AuditRecord;
    try {
      parsed = JSON.parse(line) as AuditRecord;
    } catch {
      return { ok: false, records: lines.length, brokenAt: i + 1 };
    }
    if (parsed.prevHash !== expected) {
      return { ok: false, records: lines.length, brokenAt: i + 1 };
    }
    expected = sha256Hex(line);
  }
  return { ok: true, records: lines.length };
}
