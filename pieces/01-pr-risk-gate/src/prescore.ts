import type { GateConfig } from './config.js';
import { matchesAny } from '@adl/shared';
import type { DiffFile, RiskLevel } from './types.js';

export interface PreScore {
  level: RiskLevel;
  /** 0 to 100. */
  score: number;
  /** Risk category name to the non-test, non-doc files that triggered it. */
  categories: Record<string, string[]>;
  hasTestChanges: boolean;
  reasons: string[];
}

const CATEGORY_POINTS = { medium: 30, high: 60 } as const;

export function prescore(files: DiffFile[], config: GateConfig): PreScore {
  const categories: Record<string, string[]> = {};
  let sourceLines = 0;
  let testLines = 0;
  let docFiles = 0;
  let categoryPoints = 0;

  for (const file of files) {
    const changed = file.added + file.removed;
    if (file.path === '') {
      // A file we cannot name could be anything, including a risky one. Fail closed.
      (categories['unreadable_path'] ??= []).push('(path could not be read)');
      categoryPoints = Math.max(categoryPoints, CATEGORY_POINTS.high);
      continue;
    }
    if (matchesAny(file.path, config.test_paths)) {
      testLines += changed;
    } else if (matchesAny(file.path, config.doc_paths)) {
      docFiles++;
    } else {
      sourceLines += changed;
      for (const [name, cat] of Object.entries(config.risk_paths)) {
        if (matchesAny(file.path, cat.paths)) {
          (categories[name] ??= []).push(file.path);
          categoryPoints = Math.max(categoryPoints, CATEGORY_POINTS[cat.level]);
        }
      }
    }
  }

  const docsOnly = files.length > 0 && docFiles === files.length;
  const { medium_diff_lines, large_diff_lines, min_test_ratio } = config.thresholds;
  const reasons: string[] = [];

  for (const [name, paths] of Object.entries(categories)) {
    reasons.push(`Touches ${name}: ${paths.join(', ')}`);
  }

  let sizePoints = 0;
  if (sourceLines >= large_diff_lines) sizePoints = 30;
  else if (sourceLines >= medium_diff_lines) sizePoints = 15;
  if (sizePoints > 0) {
    reasons.push(
      `${sourceLines} changed source lines (thresholds ${medium_diff_lines}/${large_diff_lines})`,
    );
  }

  let ratioPoints = 0;
  if (sourceLines >= medium_diff_lines && testLines / sourceLines < min_test_ratio) {
    ratioPoints = 20;
    reasons.push(
      `Test lines are ${Math.round((testLines / sourceLines) * 100)}% of source lines (minimum ${Math.round(min_test_ratio * 100)}%)`,
    );
  }

  const score = docsOnly ? 0 : Math.min(100, categoryPoints + sizePoints + ratioPoints);
  const level: RiskLevel = score >= 60 ? 'high' : score >= 25 ? 'medium' : 'low';
  return {
    level,
    score,
    categories,
    hasTestChanges: testLines > 0,
    reasons,
  };
}
