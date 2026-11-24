import { changeText, periodLabel, VERDICT_WORD, withUnit } from './format.js';
import type { Report, Row } from './schema.js';

const sentence = (r: Row): string => {
  if (r.verdict === 'insufficient') {
    return `**${r.label}:** not enough data to compare (${r.nBefore} before, ${r.nAfter} after).`;
  }
  const change = changeText(r);
  return `**${r.label}:** ${withUnit(r.before, r.unit)} before, ${withUnit(r.after, r.unit)} after${change ? ` (${change})` : ''}. That is ${VERDICT_WORD[r.verdict]} (samples: ${r.nBefore} before, ${r.nAfter} after).`;
};

/** A short markdown summary written for a reader who is not an engineer. */
export function renderSummary(report: Report): string {
  const lines: string[] = ['# Software delivery: before and after', ''];
  if (report.synthetic) {
    lines.push(
      '> **Synthetic example data.** Invented for a demo. Not a measurement of any real team.',
      '',
    );
  }
  const where = report.repo ?? 'the example data';
  if (!report.comparison) {
    lines.push(`Delivery metrics for ${where}, ${periodLabel(report, 'all')}.`, '');
    lines.push('Run with a rollout date to compare before and after.', '');
  } else {
    lines.push(
      `Delivery metrics for ${where}, split at ${report.compareAt?.slice(0, 10)}.`,
      `Before: ${periodLabel(report, 'before')}. After: ${periodLabel(report, 'after')}.`,
      '',
      '## The five numbers',
      '',
      ...report.comparison.map((r) => `- ${sentence(r)}`),
      '',
    );
    const worse = report.comparison
      .filter((r) => r.verdict === 'worse')
      .map((r) => r.label.toLowerCase());
    const better = report.comparison
      .filter((r) => r.verdict === 'better')
      .map((r) => r.label.toLowerCase());
    lines.push('## In one paragraph', '');
    lines.push(
      better.length || worse.length
        ? `Better: ${better.join(', ') || 'none'}. Worse: ${worse.join(', ') || 'none'}. Throughput and stability need to be read together; a gain in one that costs the other is not a clear win.`
        : 'No metric moved clearly in either direction, or there was not enough data.',
      '',
    );
  }
  lines.push('## What this does not show', '', ...report.caveats.map((c) => `- ${c}`), '');
  if (report.warnings.length)
    lines.push('## Data notes', '', ...report.warnings.map((w) => `- ${w}`), '');
  return lines.join('\n');
}
