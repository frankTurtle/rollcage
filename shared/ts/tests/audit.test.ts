import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AuditLogger,
  canonicalJson,
  readAuditRecords,
  sha256Hex,
  verifyAuditChain,
} from '../src/index.js';

const fixedNow = () => new Date('2026-01-02T03:04:05.000Z');
const tmpLog = () => join(mkdtempSync(join(tmpdir(), 'adl-audit-')), 'nested', 'a.audit.jsonl');

describe('AuditLogger', () => {
  it('appends one JSON line per entry with the required fields', () => {
    const path = tmpLog();
    const log = new AuditLogger(path, fixedNow);
    const rec = log.append({
      actor: 'pr-risk-gate',
      action: 'score',
      input: { b: 2, a: 1 },
      decision: 'block',
      detail: { why: 'no tests' },
    });
    const lines = readFileSync(path, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] as string)).toEqual(rec);
    expect(rec).toMatchObject({
      timestamp: '2026-01-02T03:04:05.000Z',
      actor: 'pr-risk-gate',
      action: 'score',
      decision: 'block',
      prevHash: 'genesis',
    });
    expect(rec.inputHash).toBe(sha256Hex(canonicalJson({ a: 1, b: 2 })));
  });

  it('never stores the input itself', () => {
    const path = tmpLog();
    new AuditLogger(path, fixedNow).append({
      actor: 'a',
      action: 'b',
      input: 'AKIAIOSFODNN7EXAMPLE',
      decision: 'blocked',
    });
    expect(readFileSync(path, 'utf8')).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('chains records and continues the chain across instances', () => {
    const path = tmpLog();
    new AuditLogger(path, fixedNow).append({ actor: 'a', action: 'x', input: 1, decision: 'ok' });
    new AuditLogger(path, fixedNow).append({ actor: 'a', action: 'y', input: 2, decision: 'ok' });
    expect(verifyAuditChain(path)).toEqual({ ok: true, records: 2 });
  });

  it('detects an edited line and a deleted line', () => {
    const path = tmpLog();
    const log = new AuditLogger(path, fixedNow);
    for (const n of [1, 2, 3]) {
      log.append({ actor: 'a', action: 'x', input: n, decision: 'ok' });
    }
    const lines = readFileSync(path, 'utf8').trim().split('\n');

    writeFileSync(
      path,
      [lines[0], lines[1]?.replace('"ok"', '"allow"'), lines[2]].join('\n') + '\n',
    );
    expect(verifyAuditChain(path)).toMatchObject({ ok: false, brokenAt: 3 });

    writeFileSync(path, [lines[0], lines[2]].join('\n') + '\n');
    expect(verifyAuditChain(path)).toMatchObject({ ok: false, brokenAt: 2 });
  });

  it('flags a line that is not JSON', () => {
    const path = tmpLog();
    new AuditLogger(path, fixedNow).append({ actor: 'a', action: 'x', input: 1, decision: 'ok' });
    writeFileSync(path, 'garbage\n');
    expect(verifyAuditChain(path)).toMatchObject({ ok: false, brokenAt: 1 });
  });

  it('reads records back in order', () => {
    const path = tmpLog();
    const log = new AuditLogger(path, fixedNow);
    log.append({ actor: 'a', action: 'x', input: 1, decision: 'one' });
    log.append({ actor: 'a', action: 'y', input: 2, decision: 'two' });
    expect(readAuditRecords(path).map((r) => r.decision)).toEqual(['one', 'two']);
  });

  it('finds the last line when it is longer than the tail window, and ignores trailing blank lines', () => {
    const path = tmpLog();
    const log = new AuditLogger(path, fixedNow);
    log.append({
      actor: 'a',
      action: 'x',
      input: 1,
      decision: 'ok',
      detail: { big: 'é'.repeat(20_000) },
    });
    log.append({ actor: 'a', action: 'y', input: 2, decision: 'ok' });
    appendFileSync(path, '\n\n');
    new AuditLogger(path, fixedNow).append({ actor: 'a', action: 'z', input: 3, decision: 'ok' });
    expect(verifyAuditChain(path)).toEqual({ ok: true, records: 3 });
  });

  it('starts a chain on an empty file and rethrows unexpected read errors', () => {
    const path = tmpLog();
    const log = new AuditLogger(path, fixedNow); // creates the directory
    writeFileSync(path, '');
    log.append({ actor: 'a', action: 'x', input: 1, decision: 'ok' });
    expect(verifyAuditChain(path).ok).toBe(true);
    expect(() =>
      new AuditLogger('/dev/null/x/a.jsonl', fixedNow).append({
        actor: 'a',
        action: 'x',
        input: 1,
        decision: 'ok',
      }),
    ).toThrow();
  });

  it('uses the real clock by default', () => {
    const path = tmpLog();
    const rec = new AuditLogger(path).append({ actor: 'a', action: 'x', input: 1, decision: 'ok' });
    expect(Number.isNaN(Date.parse(rec.timestamp))).toBe(false);
  });
});
