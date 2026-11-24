import type { GateConfig } from './config.js';
import type { PrMeta, RiskLevel } from './types.js';

export interface Violation {
  id: 'tests-required' | 'approvals-required';
  message: string;
}

export interface PolicyInput {
  level: RiskLevel;
  hasTestChanges: boolean;
  meta: PrMeta;
  approvals: string[];
  config: GateConfig;
}

export type Verdict = 'pass' | 'fail' | 'observe-would-fail';

export interface PolicyResult {
  violations: Violation[];
  /** Distinct human approvers counted (author and bots removed). */
  approvers: string[];
  /** fail: violations in enforce mode. observe-would-fail: violations in observe mode. */
  verdict: Verdict;
}

/** Distinct approvers, excluding the PR author and bot accounts. */
export function humanApprovers(approvals: string[], author: string): string[] {
  const seen = new Set<string>();
  for (const login of approvals) {
    const key = login.toLowerCase();
    if (key !== author.toLowerCase() && !key.endsWith('[bot]')) seen.add(key);
  }
  return [...seen];
}

/** The rules. Only the level, test presence and approvals matter; model prose never does. */
export function evaluatePolicy(input: PolicyInput): PolicyResult {
  const { level, hasTestChanges, meta, config } = input;
  const approvers = humanApprovers(input.approvals, meta.author);
  const violations: Violation[] = [];

  if (level === 'high') {
    if (!hasTestChanges) {
      violations.push({
        id: 'tests-required',
        message: 'High-risk change with no test changes. Add or update tests.',
      });
    }
    const { mode, required, label } = config.second_approval;
    const satisfied = mode === 'label' ? meta.labels.includes(label) : approvers.length >= required;
    if (!satisfied) {
      violations.push({
        id: 'approvals-required',
        message:
          mode === 'label'
            ? `High-risk change needs the "${label}" label from a maintainer.`
            : `High-risk change needs ${required} human approvals (has ${approvers.length}).`,
      });
    }
  }

  const verdict: Verdict =
    violations.length === 0 ? 'pass' : config.mode === 'enforce' ? 'fail' : 'observe-would-fail';
  return { violations, approvers, verdict };
}
