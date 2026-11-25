import { AuditLogger } from '@adl/shared';
import { z } from 'zod';

/** The exit code we ask gitleaks to use when it finds leaks (its own failures stay at 1). */
const LEAKS_FOUND = 99;

const Report = z.array(z.object({ RuleID: z.string(), File: z.string() }));

export interface PrecommitDeps {
  /** Run gitleaks with these arguments. `error` is set if it could not start. */
  runGitleaks(args: string[]): { status: number | null; error?: Error };
  /** The JSON report gitleaks wrote, if any. */
  readReport(): string | undefined;
  reportPath: string;
  auditPath: string;
  /** A gitleaks config file to use, if the repository has one. */
  configPath?: string | undefined;
  now(): Date;
  err(text: string): void;
  /** Called once at the end, whatever the outcome, to remove temporary files. */
  cleanup?(): void;
}

/** Exit codes: 0 clean, 1 blocked, 2 could not run the scan (also blocks the commit). */
export function runPrecommit(deps: PrecommitDeps): 0 | 1 | 2 {
  try {
    return scan(deps);
  } finally {
    deps.cleanup?.();
  }
}

function scan(deps: PrecommitDeps): 0 | 1 | 2 {
  const args = [
    'git',
    '--pre-commit',
    '--staged',
    '--redact',
    // gitleaks exits 1 for both "leaks found" and "failed to run". A separate code tells them apart.
    '--exit-code',
    String(LEAKS_FOUND),
    '--verbose',
    '--no-banner',
    '--report-format',
    'json',
    '--report-path',
    deps.reportPath,
    ...(deps.configPath ? ['--config', deps.configPath] : []),
  ];
  const result = deps.runGitleaks(args);
  if (result.error) {
    deps.err(
      `secrets-guard: could not run gitleaks (${result.error.message}). Install it, then retry.`,
    );
    return 2;
  }
  if (result.status === 0) return 0;
  if (result.status !== LEAKS_FOUND) {
    deps.err(`secrets-guard: gitleaks exited with status ${result.status}.`);
    return 2;
  }

  // Leaks found. Record that the commit was blocked: rule ids and file paths, never values.
  const rules: Record<string, number> = {};
  const files = new Set<string>();
  const report = Report.safeParse(safeJson(deps.readReport()));
  for (const f of report.success ? report.data : []) {
    rules[f.RuleID] = (rules[f.RuleID] ?? 0) + 1;
    files.add(f.File);
  }
  const sorted = [...files].sort();
  try {
    new AuditLogger(deps.auditPath, deps.now).append({
      actor: 'secrets-guard',
      action: 'precommit-block',
      input: { rules, files: sorted },
      decision: 'blocked',
      detail: { rules, files: sorted.slice(0, 20), fileCount: sorted.length },
    });
  } catch {
    deps.err('secrets-guard: could not write the audit record. The commit is still blocked.');
  }
  deps.err(
    'secrets-guard: commit blocked. Remove the secret, then commit again. Do not bypass this hook.',
  );
  return 1;
}

function safeJson(text: string | undefined): unknown {
  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
}
