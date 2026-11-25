import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { checkPins } from './pins.ts';
import { DEFAULT_REF, ScaffoldError, TEMPLATE_DIR } from './scaffold.ts';
import { validateOwner, validateRef } from './validate.ts';

/** The pieces `init` can wire into an existing repository. */
export const PIECES = ['risk-gate', 'secrets', 'sbom', 'policy', 'provenance'] as const;
export type PieceId = (typeof PIECES)[number];

/** On by default. Provenance needs a built artifact to verify, so it is opt-in. */
export const DEFAULT_PIECES: readonly PieceId[] = ['risk-gate', 'secrets', 'sbom', 'policy'];

interface PieceSpec {
  /** Reusable workflow in the template, copied beside the caller as `rollcage-<name>`. */
  workflow: string;
  /** The caller job. Its name is the first half of the required check name. */
  job: string;
  /** The reusable workflow's job, the second half of the check name. */
  inner: string;
  /** Lines under the job's key in the caller workflow. */
  caller: string[];
  /** Other files the piece needs. */
  files?: string[];
}

const PIECE_SPECS: Record<PieceId, PieceSpec> = {
  'risk-gate': {
    workflow: 'gate-pr-risk.yml',
    job: 'risk-gate',
    inner: 'gate',
    caller: [
      "if: github.event_name == 'pull_request'",
      'permissions:',
      '  contents: read',
      '  pull-requests: write',
    ],
    files: ['risk-gate.yml'],
  },
  secrets: {
    workflow: 'secrets-scan.yml',
    job: 'secrets',
    inner: 'gitleaks',
    caller: [
      'permissions:',
      '  contents: read',
      '  pull-requests: read',
      'secrets:',
      '  GITLEAKS_LICENSE: ${{ secrets.GITLEAKS_LICENSE }}',
    ],
  },
  sbom: {
    workflow: 'sbom-vuln.yml',
    job: 'sbom',
    inner: 'sbom',
    caller: ['with:', '  path: .', '  fail-on: critical'],
  },
  policy: {
    workflow: 'policy-gates.yml',
    job: 'policy',
    inner: 'policy',
    caller: ['with:', '  path: .'],
  },
  provenance: {
    workflow: 'provenance.yml',
    job: 'provenance',
    inner: 'provenance',
    caller: ['with:', '  artifact: dist', '  mode: verify'],
  },
};

/** Files that belong to a repository's own governance. Only written with `extras`. */
const EXTRAS = [
  '.github/CODEOWNERS',
  '.github/dependabot.yml',
  '.github/pull_request_template.md',
  'SECURITY.md',
];

export const CALLER = '.github/workflows/rollcage.yml';
const workflowPath = (piece: PieceId): string =>
  `.github/workflows/rollcage-${PIECE_SPECS[piece].workflow}`;

export interface InitOptions {
  targetDir: string;
  ref?: string;
  pieces?: readonly PieceId[];
  /** Also add CODEOWNERS, Dependabot, SECURITY.md and a PR template. Needs `owner`. */
  extras?: boolean;
  owner?: string;
  /** Plan only: report what would be written and write nothing. */
  dryRun?: boolean;
  templateDir?: string;
}

export interface InitResult {
  created: string[];
  /** Already present, so left alone. */
  skipped: string[];
  warnings: string[];
  /** The check names to require in branch protection, once the first PR has run. */
  checks: string[];
}

function callerWorkflow(pieces: readonly PieceId[]): string {
  const jobs = pieces.flatMap((id) => {
    const spec = PIECE_SPECS[id];
    const body = [`uses: ./${workflowPath(id)}`, ...spec.caller].map((l) => `    ${l}`);
    return ['', `  ${spec.job}:`, ...body];
  });
  return [
    '# Rollcage guardrails. Each job runs one reusable workflow from this folder.',
    '# Remove a job here (and its rollcage-*.yml file) to turn a guardrail off.',
    'name: rollcage',
    '',
    'on:',
    '  push:',
    '    branches: [main]',
    '  pull_request:',
    '',
    'permissions:',
    '  contents: read',
    '',
    'concurrency:',
    '  group: rollcage-${{ github.ref }}',
    '  cancel-in-progress: true',
    '',
    'jobs:',
    ...jobs.slice(1),
    '',
  ].join('\n');
}

/**
 * Add the selected rollcage guardrails to an existing repository. It never overwrites: a file that
 * already exists is skipped and reported. Everything is rendered and pin-checked before the first
 * write, so a failure writes nothing.
 */
export function init(options: InitOptions): InitResult {
  const {
    targetDir,
    ref = DEFAULT_REF,
    pieces = DEFAULT_PIECES,
    extras = false,
    owner,
    dryRun = false,
    templateDir = TEMPLATE_DIR,
  } = options;
  const problem = validateRef(ref) ?? (owner === undefined ? undefined : validateOwner(owner));
  if (problem) throw new ScaffoldError(problem);
  if (!existsSync(targetDir) || !statSync(targetDir).isDirectory()) {
    throw new ScaffoldError(`${targetDir} is not a directory`);
  }
  if (pieces.length === 0) throw new ScaffoldError('choose at least one piece');
  if (extras && owner === undefined) {
    throw new ScaffoldError('--extras needs --owner (the CODEOWNERS and SECURITY.md owner)');
  }

  // The template repository uses pnpm, so its risk-gate workflow sets pnpm up for it. The piece's
  // own action runs corepack, and the setup step fails in a repository with no pnpm version.
  const PNPM_SETUP = /^ *- uses: pnpm\/action-setup@.*\n/m;
  const render = (rel: string): string =>
    readFileSync(join(templateDir, rel), 'utf8')
      .replace(rel.endsWith('gate-pr-risk.yml') ? PNPM_SETUP : /(?!)/, '')
      .replace(/__ROLLCAGE_REF__/g, ref)
      .replace(/__OWNER__/g, owner ?? '')
      .replace(/__NAME__/g, '');

  const planned = new Map<string, string>();
  planned.set(CALLER, callerWorkflow(pieces));
  for (const id of pieces) {
    planned.set(workflowPath(id), render(`.github/workflows/${PIECE_SPECS[id].workflow}`));
    for (const file of PIECE_SPECS[id].files ?? []) planned.set(file, render(file));
  }
  if (extras) for (const file of EXTRAS) planned.set(file, render(file));

  const workflows = Object.fromEntries(
    [...planned].filter(([rel]) => rel.startsWith('.github/workflows/')),
  );
  const pins = checkPins(workflows, ref);
  if (pins.errors.length > 0) {
    throw new ScaffoldError(`pin check failed:\n${pins.errors.join('\n')}`);
  }

  const created: string[] = [];
  const skipped: string[] = [];
  for (const [rel, text] of planned) {
    const full = join(targetDir, rel);
    if (existsSync(full)) {
      skipped.push(rel);
      continue;
    }
    if (!dryRun) {
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, text, { flag: 'wx' });
    }
    created.push(rel);
  }
  const warnings = [...pins.warnings];
  if (!existsSync(join(targetDir, '.git'))) {
    warnings.push(`${targetDir} has no .git folder; commit these files in the repository you mean`);
  }
  if (pieces.includes('provenance')) {
    warnings.push('provenance verifies a build artifact (artifact: dist); point it at yours');
  }
  const checks = pieces.map((id) => `${PIECE_SPECS[id].job} / ${PIECE_SPECS[id].inner}`);
  return { created, skipped, warnings, checks };
}
