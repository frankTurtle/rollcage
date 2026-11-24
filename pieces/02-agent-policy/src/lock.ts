import { mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Run `fn` while holding a directory-based lock (mkdir is atomic). Hooks run as separate
 * processes and can run in parallel, so this keeps audit-log writes ordered. A lock older than
 * `staleMs` is assumed to belong to a crashed process and is removed.
 */
export function withLock<T>(
  lockPath: string,
  fn: () => T,
  opts: { timeoutMs?: number; staleMs?: number } = {},
): T {
  const { timeoutMs = 3000, staleMs = 10_000 } = opts;
  mkdirSync(dirname(lockPath), { recursive: true });
  const start = Date.now();
  for (;;) {
    try {
      mkdirSync(lockPath);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const mtime = statSync(lockPath, { throwIfNoEntry: false })?.mtimeMs;
      if (mtime === undefined || Date.now() - mtime > staleMs) {
        rmSync(lockPath, { recursive: true, force: true });
        continue;
      }
      if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for the audit lock');
      sleep(15);
    }
  }
  try {
    return fn();
  } finally {
    rmSync(lockPath, { recursive: true, force: true });
  }
}
