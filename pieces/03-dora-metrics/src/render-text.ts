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
    const rows: [string, string, number][] = [
      [
        'Deployment frequency (per week)',
        num(m.deploymentFrequency.perWeek),
        m.deploymentFrequency.n,
      ],
      ['Change lead time, median (hours)', num(m.changeLeadTime.medianHours), m.changeLeadTime.n],
      ['Change fail rate (%)', num(m.changeFailRate.rate), m.changeFailRate.n],
      [
        'Failed deployment recovery, median (hours)',
        num(m.failedDeploymentRecovery.medianHours),
        m.failedDeploymentRecovery.n,
      ],
      ['Deployment rework rate (%)', num(m.deploymentReworkRate.rate), m.deploymentReworkRate.n],
    ];
    for (const [label, value, n] of rows) lines.push(`${pad(label, 52)}${pad(value, 10)}n=${n}`);
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
