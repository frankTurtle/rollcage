import { METRIC_ROWS } from './compare.js';
import { changeText, num, periodLabel, VERDICT_WORD } from './format.js';
import type { Report } from './schema.js';

const pad = (s: string, n: number) => s.padEnd(n);

/** A fixed-width table for the terminal. */
export function renderText(report: Report): string {
  const lines: string[] = [];
  if (report.synthetic)
    lines.push('SYNTHETIC DATA: invented for this demo, not a measurement.', '');
  if (!report.comparison) {
    const m = report.periods[0]?.metrics;
    if (!m) return lines.join('\n');
    lines.push(`Period: ${periodLabel(report, 'all')}`, '');
    for (const row of METRIC_ROWS) {
      const { value, n } = row.pick(m);
      lines.push(`${pad(`${row.label} (${row.unit})`, 52)}${pad(num(value), 10)}n=${n}`);
    }
    return lines.join('\n');
  }
  lines.push(
    `Before: ${periodLabel(report, 'before')}`,
    `After:  ${periodLabel(report, 'after')}`,
    '',
    `${pad('Metric', 52)}${pad('Before', 10)}${pad('After', 10)}${pad('Change', 10)}Verdict`,
  );
  for (const r of report.comparison) {
    lines.push(
      `${pad(`${r.label} (${r.unit})`, 52)}${pad(num(r.before), 10)}${pad(num(r.after), 10)}${pad(changeText(r), 10)}${VERDICT_WORD[r.verdict]}  (n=${r.nBefore}/${r.nAfter})`,
    );
  }
  return lines.join('\n');
}
