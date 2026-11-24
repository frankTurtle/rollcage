import type { PolicyResult } from './policy.js';
import type { PreScore } from './prescore.js';
import type { ReviewResult } from './review.js';
import type { RiskLevel } from './types.js';

/** Hidden marker used to find and update the gate's one comment. */
export const COMMENT_MARKER = '<!-- pr-risk-gate:v1 -->';

/** Make model or PR text safe to post: no live @mentions, no raw HTML, one line. */
export function sanitize(text: string, max = 300): string {
  const flat = text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/@/g, '@​')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

const VERDICT_TEXT = {
  pass: 'pass',
  fail: 'blocked',
  'observe-would-fail': 'would block (observe mode)',
} as const;

export interface CommentInput {
  mode: 'enforce' | 'observe';
  level: RiskLevel;
  pre: PreScore;
  review: ReviewResult;
  policy: PolicyResult;
}

export function renderComment(input: CommentInput): string {
  const { level, pre, review, policy, mode } = input;
  const verdict = VERDICT_TEXT[policy.verdict];
  const lines: string[] = [
    COMMENT_MARKER,
    `## PR risk gate: ${level.toUpperCase()} risk, ${verdict}`,
    '',
    '| | |',
    '|---|---|',
    `| Final level | ${level} (pre-score ${pre.level} ${pre.score}/100, model ${review.source === 'model' ? review.riskLevel : 'not used'}) |`,
    `| Test files changed | ${pre.hasTestChanges ? 'yes' : 'no'} |`,
    `| Human approvals | ${policy.approvers.length} |`,
    `| Mode | ${mode} |`,
    '',
  ];

  if (policy.violations.length > 0) {
    lines.push(
      '### Blocking issues',
      ...policy.violations.map((v) => `- **${v.id}**: ${v.message}`),
      '',
    );
  }

  lines.push('### Why this level (deterministic rules)');
  lines.push(
    ...(pre.reasons.length
      ? pre.reasons.map((r) => `- ${sanitize(r, 400)}`)
      : ['- No risk rules matched.']),
    '',
  );

  if (review.reasons.length > 0) {
    lines.push('### Model findings (advisory, each cites an added line)');
    lines.push(...review.reasons.map((r) => `- \`${r.file}:${r.line}\` ${sanitize(r.text)}`), '');
  }
  if (review.droppedReasons > 0) {
    lines.push(
      `_${review.droppedReasons} model finding(s) were dropped because they did not cite a line in this diff._`,
      '',
    );
  }
  if (review.requiredChecks.length > 0) {
    lines.push('### Suggested checks', ...review.requiredChecks.map((c) => `- ${sanitize(c)}`), '');
  }

  lines.push('### Assumptions');
  const assumptions =
    review.assumptions.length > 0 ? review.assumptions : ['The model listed no assumptions.'];
  lines.push(...assumptions.map((a) => `- ${sanitize(a)}`), '');
  lines.push(
    '_The level and verdict come from deterministic rules. Model text is advisory and unverified beyond the cited lines existing in the diff. This check never approves or merges._',
  );
  return lines.join('\n');
}
