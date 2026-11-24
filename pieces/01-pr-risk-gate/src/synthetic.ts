import { rmSync } from 'node:fs';
import { AuditLogger } from '@adl/shared';
import { AUDIT_ACTION, AUDIT_ACTOR } from './run.js';

/** Small seeded PRNG (mulberry32) so synthetic history is identical on every run. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Write a SYNTHETIC audit log for demos. It illustrates how the metric is read; it is not
 * measured data. Ungated: some high-risk PRs have no tests. Gated: a high-risk PR without tests
 * is recorded as failing first, then passing once tests were added.
 */
export function writeSyntheticHistory(
  path: string,
  opts: { seed: number; prs: number; gated: boolean },
): void {
  rmSync(path, { force: true });
  const rand = seededRandom(opts.seed);
  let tick = Date.UTC(2026, 0, 5);
  const log = new AuditLogger(path, () => new Date((tick += 3_600_000)));
  const write = (pr: number, level: string, hasTests: boolean, fail: boolean) =>
    log.append({
      actor: AUDIT_ACTOR,
      action: AUDIT_ACTION,
      input: { pr, synthetic: true },
      decision: fail ? 'fail' : 'pass',
      detail: { pr, level, hasTests, synthetic: true },
    });

  for (let pr = 1; pr <= opts.prs; pr++) {
    const high = rand() < 0.3;
    const level = high ? 'high' : rand() < 0.4 ? 'medium' : 'low';
    const hasTests = !high || rand() < 0.45;
    if (opts.gated && high && !hasTests) {
      write(pr, level, false, true);
      write(pr, level, true, false);
    } else {
      write(pr, level, hasTests, false);
    }
  }
}
