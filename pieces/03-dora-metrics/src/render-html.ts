import { isoDay } from './dates.js';
import { changeText, num, periodLabel, VERDICT_WORD } from './format.js';
import type { Report, Row } from './schema.js';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const CSS = `body{font:16px/1.5 system-ui,sans-serif;max-width:60rem;margin:2rem auto;padding:0 1rem;color:#1b1f23}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:.5rem;border-bottom:1px solid #d0d7de}
.bar{height:.6rem;background:#8b949e;border-radius:2px}.bar.after{background:#0969da}
.better{font-weight:700}.worse{font-weight:700;text-decoration:underline}
.banner{background:#fff8c5;border:1px solid #d4a72c;padding:.75rem;margin:1rem 0}
small{color:#57606a}`;

function bars(r: Row): string {
  const max = Math.max(r.before ?? 0, r.after ?? 0);
  const w = (v: number | null) => (max > 0 && v !== null ? Math.round((v / max) * 100) : 0);
  return `<div class="bar" style="width:${w(r.before)}%" title="before"></div><div class="bar after" style="width:${w(r.after)}%" title="after"></div>`;
}

/** One self-contained HTML file: no scripts, no external assets. Every string is escaped. */
export function renderHtml(report: Report): string {
  const title = 'DORA metrics';
  const body: string[] = [`<h1>${title}</h1>`];
  if (report.synthetic) {
    body.push(
      '<div class="banner"><strong>Synthetic example data.</strong> Invented for a demo, not a measurement.</div>',
    );
  }
  body.push(
    `<p>${esc(report.repo ?? 'Example data')} <small>as of ${esc(isoDay(report.asOf))}, source: ${esc(report.source)}</small></p>`,
  );
  if (report.comparison) {
    body.push(
      `<p>Before: ${esc(periodLabel(report, 'before'))}. After: ${esc(periodLabel(report, 'after'))}.</p>`,
      '<table><thead><tr><th>Metric</th><th>Before</th><th>After</th><th>Change</th><th>Verdict</th><th>Samples</th><th></th></tr></thead><tbody>',
      ...report.comparison.map(
        (r) =>
          `<tr><td>${esc(r.label)} <small>(${esc(r.unit)}, ${r.betterWhen} is better)</small></td><td>${num(r.before)}</td><td>${num(r.after)}</td><td>${esc(changeText(r))}</td><td class="${r.verdict}">${esc(VERDICT_WORD[r.verdict])}</td><td>${r.nBefore} / ${r.nAfter}</td><td style="width:20%">${bars(r)}</td></tr>`,
      ),
      '</tbody></table>',
    );
  } else {
    body.push(
      `<p>Period: ${esc(periodLabel(report, 'all'))}</p><pre>${esc(JSON.stringify(report.periods[0]?.metrics, null, 2))}</pre>`,
    );
  }
  body.push(
    '<h2>What this does not show</h2><ul>',
    ...report.caveats.map((c) => `<li>${esc(c)}</li>`),
    '</ul>',
  );
  if (report.warnings.length) {
    body.push(
      '<h2>Data notes</h2><ul>',
      ...report.warnings.map((w) => `<li>${esc(w)}</li>`),
      '</ul>',
    );
  }
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>${CSS}</style></head><body>\n${body.join('\n')}\n</body></html>\n`;
}
