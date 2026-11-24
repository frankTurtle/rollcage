import type { AuditLogger, LlmClient } from '@adl/shared';
import { sha256Hex } from '@adl/shared';
import { renderComment } from './comment.js';
import type { GateConfig } from './config.js';
import { parseDiff } from './diff.js';
import { evaluatePolicy } from './policy.js';
import type { PolicyResult } from './policy.js';
import { prescore } from './prescore.js';
import type { PreScore } from './prescore.js';
import { reviewPr } from './review.js';
import type { ReviewResult } from './review.js';
import { maxLevel } from './types.js';
import type { GateIO, RiskLevel } from './types.js';

export interface GateResult {
  exitCode: 0 | 1;
  level: RiskLevel;
  pre: PreScore;
  review: ReviewResult;
  policy: PolicyResult;
  comment: string;
  published: string;
}

export const AUDIT_ACTOR = 'pr-risk-gate';
export const AUDIT_ACTION = 'evaluate';

export async function runGate(args: {
  io: GateIO;
  llm: LlmClient;
  config: GateConfig;
  audit?: AuditLogger;
}): Promise<GateResult> {
  const { io, llm, config, audit } = args;
  const { meta, diff, approvals } = await io.load();

  const files = parseDiff(diff);
  const pre = prescore(files, config);
  const review = await reviewPr({ llm, meta, diffText: diff, files, pre, config });
  // The model may raise the level; it can never lower the deterministic one.
  const level = maxLevel(pre.level, review.riskLevel);
  const policy = evaluatePolicy({
    level,
    hasTestChanges: pre.hasTestChanges,
    meta,
    approvals,
    config,
  });

  const comment = renderComment({
    prNumber: meta.number,
    mode: config.mode,
    level,
    pre,
    review,
    policy,
  });
  const published = await io.publish(comment);

  audit?.append({
    actor: AUDIT_ACTOR,
    action: AUDIT_ACTION,
    input: { pr: meta.number, diffSha256: sha256Hex(diff) },
    decision:
      policy.violations.length === 0
        ? 'pass'
        : config.mode === 'enforce'
          ? 'fail'
          : 'observe-would-fail',
    detail: {
      pr: meta.number,
      level,
      preLevel: pre.level,
      hasTests: pre.hasTestChanges,
      approvals: policy.approvers.length,
      violations: policy.violations.map((v) => v.id),
      categories: Object.keys(pre.categories),
      modelSource: review.source,
      mode: config.mode,
    },
  });

  return { exitCode: policy.blocked ? 1 : 0, level, pre, review, policy, comment, published };
}
