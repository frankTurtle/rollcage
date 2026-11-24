import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { canonicalJson, sha256Hex } from './llm.js';

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
  private lastHash: string;

  constructor(
    private readonly path: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    mkdirSync(dirname(path), { recursive: true });
    this.lastHash = GENESIS;
    if (existsSync(path)) {
      const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
      const last = lines[lines.length - 1];
      if (last) this.lastHash = sha256Hex(last);
    }
  }

  append(entry: AuditEntry): AuditRecord {
    const record: AuditRecord = {
      timestamp: this.now().toISOString(),
      actor: entry.actor,
      action: entry.action,
      inputHash: sha256Hex(canonicalJson(entry.input)),
      decision: entry.decision,
      ...(entry.detail ? { detail: entry.detail } : {}),
      prevHash: this.lastHash,
    };
    const line = JSON.stringify(record);
    appendFileSync(this.path, `${line}\n`, { flag: 'a' });
    this.lastHash = sha256Hex(line);
    return record;
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
