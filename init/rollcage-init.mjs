#!/usr/bin/env node
// One-command Rollcage setup for an existing repository.
//
//   npx rollcage-init [options]
//   (or) curl -fsSL https://raw.githubusercontent.com/frankTurtle/rollcage/main/init/rollcage-init.mjs | node - [options]
//
// It detects the repo, then writes the files for the production-proven pieces (01 PR risk gate,
// 02 agent policy, 03 DORA metrics, 04 secrets guard, 05 SBOM and CVE triage, 06 policy gates and a
// manual 10 provenance workflow), with every Rollcage reference pinned to a commit SHA.
// It never overwrites a file, never pushes, and never calls GitHub. Node 20+, git, and pnpm (only to
// build the piece 02 hook) are the only requirements.
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const DEFAULT_REF = 'v0.6.1';
const REPO_URL = 'https://github.com/frankTurtle/rollcage';
export const DEFAULT_PIECES = ['01', '02', '03', '04', '05', '06', '10'];
const PIECE_NAMES = {
  '01': 'PR risk gate',
  '02': 'Agent policy',
  '03': 'DORA metrics',
  '04': 'Secrets guard',
  '05': 'SBOM and CVE triage',
  '06': 'Policy gates',
  10: 'Provenance (manual workflow)',
};

const CHECKOUT = 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1';
const PNPM = 'pnpm/action-setup@73e46992e05b19abd31f2f3c20e0e7370d762115 # v6.1.1';

class InitError extends Error {}

// ---------------------------------------------------------------- validation

// A leading dash would let a ref act as a git option.
const SAFE_REF = /^[A-Za-z0-9._][A-Za-z0-9._/-]{0,99}$/;
const SAFE_OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const SAFE_REPO = /^[A-Za-z0-9._-]{1,100}$/;

export function parsePieces(only, without) {
  const list = (text) =>
    String(text ?? '')
      .split(',')
      .map((s) => s.trim().padStart(2, '0'))
      .filter((s) => s !== '00');
  const chosen = only ? list(only) : [...DEFAULT_PIECES];
  const bad = [...chosen, ...list(without)].filter((p) => !(p in PIECE_NAMES));
  if (bad.length > 0) {
    throw new InitError(
      `unknown or not-yet-supported piece ${bad.join(', ')}; supported: ${Object.keys(PIECE_NAMES).join(', ')}`,
    );
  }
  const drop = new Set(list(without));
  return chosen.filter((p) => !drop.has(p));
}

// ----------------------------------------------------------------- detection

const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

export function parseRemote(url) {
  const m = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url ?? '');
  return m ? { owner: m[1], repo: m[2] } : null;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'vendor', '.terraform']);

function hasFileMatching(dir, test, depth = 3) {
  if (depth < 0) return false;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  return entries.some((e) => {
    if (SKIP_DIRS.has(e.name)) return false;
    return e.isDirectory() ? hasFileMatching(join(dir, e.name), test, depth - 1) : test(e.name);
  });
}

/** What the repo is, so the output and next steps fit it. Pure reads, no writes. */
function detect(root) {
  const pkg = readJson(join(root, 'package.json'));
  const has = (name) => existsSync(join(root, name));
  const languages = [
    pkg && 'javascript/typescript',
    (has('pyproject.toml') || has('requirements.txt')) && 'python',
    has('go.mod') && 'go',
    has('Cargo.toml') && 'rust',
    (has('pom.xml') || has('build.gradle') || has('build.gradle.kts')) && 'java',
  ].filter(Boolean);
  let remote = null;
  try {
    remote = parseRemote(git(root, 'remote', 'get-url', 'origin'));
  } catch {
    // not a git repo, or no origin: owner falls back to --owner
  }
  const workflowsDir = join(root, '.github/workflows');
  const ciWorkflows = existsSync(workflowsDir)
    ? readdirSync(workflowsDir).filter((f) => /\.ya?ml$/.test(f))
    : [];
  const calledWorkflows = ciWorkflows
    .filter((f) => f !== 'rollcage.yml')
    .flatMap((f) =>
      [
        ...readFileSync(join(workflowsDir, f), 'utf8').matchAll(
          /uses:\s*\.\/\.github\/workflows\/([\w.-]+\.ya?ml)/g,
        ),
      ].map((m) => m[1]),
    );
  return {
    languages,
    usesPnpm: typeof pkg?.packageManager === 'string' && pkg.packageManager.startsWith('pnpm@'),
    terraform: hasFileMatching(root, (n) => n.endsWith('.tf')),
    ciWorkflows,
    calledWorkflows,
    remote,
  };
}

// ------------------------------------------------------------ source checkout

/** Shallow clone of the rollcage repo at `ref` into a new temp dir; returns its path and SHA. */
function fetchSource(ref, url = REPO_URL) {
  if (!SAFE_REF.test(ref)) throw new InitError(`invalid --ref ${ref}`);
  const dir = mkdtempSync(join(tmpdir(), 'rollcage-src-'));
  const run = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  try {
    try {
      execFileSync('git', ['clone', '--quiet', '--depth', '1', '--branch', ref, url, dir], {
        stdio: 'ignore',
      });
    } catch {
      // `ref` may be a commit SHA, which --branch cannot take.
      run('init', '--quiet');
      run('fetch', '--quiet', '--depth', '1', url, ref);
      run('checkout', '--quiet', 'FETCH_HEAD');
    }
  } catch {
    rmSync(dir, { recursive: true, force: true });
    throw new InitError(`could not fetch ${url} at ${ref}; check the ref and your network`);
  }
  return { dir, sha: git(dir, 'rev-parse', 'HEAD'), temporary: true };
}

// ----------------------------------------------------------------- rendering

/** Pin line for a rollcage reference: `<sha> # <ref>` so Dependabot and humans can read it. */
function pinned(ctx) {
  return `${ctx.sha} # ${ctx.ref}`;
}

const readSource = (ctx, rel) => readFileSync(join(ctx.source, rel), 'utf8');
const template12 = (ctx, name) =>
  readSource(ctx, `pieces/12-golden-path-template/template/${name}`)
    .replaceAll('__ROLLCAGE_REF__', pinned(ctx))
    .replaceAll('__OWNER__', ctx.owner);

/** The piece actions install pnpm through corepack, so the caller only needs the step when its own
 * package.json pins pnpm; without a pin, pnpm/action-setup fails on a non-pnpm repo. */
const dropPnpmSetup = (ctx, text) =>
  ctx.detected.usesPnpm ? text : text.replace(/^\s*- uses: pnpm\/action-setup@.*\n/gm, '');

const ROLLCAGE_WORKFLOW_JOBS = {
  '01': {
    name: 'risk-gate',
    file: 'gate-pr-risk.yml',
    job: `  risk-gate:
    if: github.event_name == 'pull_request'
    permissions:
      contents: read
      pull-requests: write
    uses: ./.github/workflows/gate-pr-risk.yml`,
  },
  '02': {
    name: 'agent-policy',
    file: 'agent-policy.yml',
    job: `  agent-policy:
    uses: ./.github/workflows/agent-policy.yml`,
  },
  '04': {
    name: 'secrets',
    file: 'secrets-scan.yml',
    job: `  secrets:
    permissions:
      contents: read
      pull-requests: read
    uses: ./.github/workflows/secrets-scan.yml
    secrets:
      GITLEAKS_LICENSE: \${{ secrets.GITLEAKS_LICENSE }}`,
  },
  '05': {
    name: 'sbom',
    file: 'sbom-vuln.yml',
    job: `  sbom:
    uses: ./.github/workflows/sbom-vuln.yml
    with:
      path: .
      fail-on: critical`,
  },
  '06': {
    name: 'policy',
    file: 'policy-gates.yml',
    job: `  policy:
    uses: ./.github/workflows/policy-gates.yml
    with:
      path: .`,
  },
};

const agentPolicyWorkflow = (
  ctx,
) => `# Piece 02: fail the build if the policy file or guardrail settings are removed or weakened.
name: agent-policy

on:
  workflow_call:

permissions:
  contents: read

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: ${CHECKOUT}
        with:
          persist-credentials: false
      - uses: frankTurtle/rollcage/pieces/02-agent-policy@${pinned(ctx)}
`;

const doraWorkflow = (
  ctx,
) => `# Piece 03: weekly delivery metrics, split at the date AI tools were rolled out.
name: dora-weekly

on:
  schedule:
    - cron: '0 6 * * 1'
  workflow_dispatch:

permissions:
  contents: read
  actions: read
  deployments: read
  issues: read
  pull-requests: read

jobs:
  dora:
    runs-on: ubuntu-latest
    steps:
      - uses: ${CHECKOUT}
        with:
          persist-credentials: false
${ctx.detected.usesPnpm ? `      - uses: ${PNPM}\n` : ''}      - uses: frankTurtle/rollcage/pieces/03-dora-metrics@${pinned(ctx)}
        with:
          compare-at: '${ctx.date}' # SET THIS: the day your team rolled out AI tools
`;

const provenanceWorkflow = (
  ctx,
) => `# Piece 10: attest a release artifact, then verify it the way a deploy would.
# Manual only: attestation writes a public Sigstore entry that names this repository, so it never
# runs on push or pull_request. EDIT the build step and artifact name for your project, then run it
# from the Actions tab. Only this job holds id-token and attestations write.
name: provenance

on:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  provenance:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
      attestations: write
    steps:
      - uses: ${CHECKOUT}
        with:
          persist-credentials: false
      # TODO: build your release here, then pack it into ONE file (the gate verifies one file).
      - run: tar -czf release.tgz --exclude=.git --exclude=release.tgz .
      - uses: frankTurtle/rollcage/pieces/10-provenance-signing@${pinned(ctx)}
        with:
          artifact: release.tgz
          mode: attest
      # What a deploy job would run: block unless this workflow signed this exact file.
      - uses: frankTurtle/rollcage/pieces/10-provenance-signing@${pinned(ctx)}
        with:
          artifact: release.tgz
          mode: verify
          signer-workflow: ${ctx.owner}/${ctx.repo}/.github/workflows/provenance.yml
`;

/** Jobs for the pieces that no existing workflow already calls (so a repo that has a ci.yml
 * calling them is not run twice). */
const callerJobs = (ctx) =>
  ctx.pieces
    .map((p) => ROLLCAGE_WORKFLOW_JOBS[p])
    .filter((j) => j && !ctx.detected.calledWorkflows.includes(j.file));

const callerWorkflow = (ctx) => {
  const jobs = callerJobs(ctx)
    .map((j) => j.job)
    .join('\n\n');
  return `# Rollcage: runs each enabled piece as a job. Your own build and test workflow stays separate.
# Each job calls a reusable workflow in this folder, which calls the piece at a pinned commit.
name: rollcage

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

concurrency:
  group: rollcage-\${{ github.ref }}
  cancel-in-progress: true

jobs:
${jobs}
`;
};

const branchProtection = (ctx) => {
  const checks = ctx.pieces
    .filter((p) => ROLLCAGE_WORKFLOW_JOBS[p])
    .map((p) => ROLLCAGE_WORKFLOW_JOBS[p].name);
  const bullets = checks.map((c) => `- \`${c}\``).join('\n');
  return `# Branch protection

Rollcage's checks only bind once branch protection requires them. Until then a red check is advice.
Do this after the first pull request has run, so you can pick the exact check names.

Require these on \`main\` (Settings, Branches, or a ruleset):

- A pull request before merging, with review from Code Owners (\`.github/CODEOWNERS\`)
- These status checks, from \`.github/workflows/rollcage.yml\` (they show as \`<job> / <job>\`):

${bullets}

- Dismiss stale approvals, no force pushes, no deletions

A single-maintainer repo cannot meet "one approving review" on its own pull requests. Add a second
reviewer or lower the count, and accept the weaker control.
`;
};

const preCommit = `# Install once: pip install pre-commit && pre-commit install --hook-type pre-commit --hook-type commit-msg
# Piece 04, layer 1: gitleaks blocks a commit that contains a secret, before the commit exists.
# gitleaks must be installed locally (brew install gitleaks). For the audited variant, see
# pieces/04-secrets-guard/templates/pre-commit-config.yaml in the rollcage repo.
repos:
  - repo: local
    hooks:
      - id: gitleaks
        name: gitleaks (staged changes)
        entry: gitleaks git --pre-commit --staged --redact --verbose
        language: system
        pass_filenames: false
`;

const dependabot = `version: 2
updates:
  # Keeps the commit SHAs in .github/workflows current, including the rollcage pins.
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
`;

const riskGateConfig = `# Config for the PR risk gate (piece 01). Start in observe mode, tune, then switch to enforce.
# Every key is optional. See pieces/01-pr-risk-gate/risk-gate.example.yml in the rollcage repo.
mode: observe
`;

const doraConfig = `# Piece 03 config. Deployments are read from GitHub releases until you use the deployments API.
deployments:
  source: releases
  branch: main
incident_label: incident
hotfix_labels: [hotfix]
`;

// Placeholders in the piece 02 policy that have a sensible default; the rest are listed for a human.
const POLICY_FILL = (ctx) => ({
  '<NAME OR TEAM>': ctx.owner,
  '<DATE>': ctx.date,
  '<N>': '6',
  '<WEEKLY/MONTHLY>': 'weekly',
  '<ROLE>': 'the repository owner',
  '<LABEL>': 'ai-assisted',
  '<LOCATION>': 'docs/policy-exceptions.md',
  '<ALLOWED HOSTS>': 'see `.claude/agent-policy.yml`',
  '<ALLOWED SCRATCH DIRECTORIES>': '`/tmp`',
  '<PROTECTED PATHS>': 'see `.claude/agent-policy.yml`',
  '<SECURITY CONTACT>': 'SECURITY.md',
});

const PROTECTED_PATHS = [
  '.claude/settings.json',
  '.claude/settings.local.json',
  '.claude/agent-policy.yml',
  '.claude/hooks/**',
  'policy/AI_CODING_AGENT_POLICY.md',
  '.github/workflows/agent-policy.yml',
  '.github/CODEOWNERS',
];

/** String replace that fails loudly if the upstream template changed shape. */
function mustReplace(text, pattern, replacement) {
  const out = text.replace(pattern, replacement);
  if (out === text) throw new InitError(`template changed upstream: ${pattern} no longer matches`);
  return out;
}

function agentPolicyConfig(ctx) {
  const base = readSource(ctx, 'pieces/02-agent-policy/templates/agent-policy.yml');
  // Replace the vendored-source entry in the template with this repo's real protected paths.
  return mustReplace(
    base,
    /^(protected_paths:\n)(?:[ \t]+-.*\n?)+/m,
    `$1${PROTECTED_PATHS.map((p) => `  - ${p}\n`).join('')}`,
  );
}

function agentPolicyPolicy(ctx) {
  const fill = POLICY_FILL(ctx);
  let text = mustReplace(
    readSource(ctx, 'pieces/02-agent-policy/policy/AI_CODING_AGENT_POLICY.md'),
    'Template. Replace every `<PLACEHOLDER>`. ',
    '',
  );
  for (const [token, value] of Object.entries(fill)) text = text.replaceAll(token, value);
  return text;
}

/** The files to write: `{ path, content }` for text, `{ path, hook: true }` for the built hook. */
function plan(ctx) {
  const files = [];
  const add = (path, content) => files.push({ path, content });
  const wf = (name, content) => add(`.github/workflows/${name}`, content);
  const on = (p) => ctx.pieces.includes(p);

  if (on('01')) {
    wf(
      'gate-pr-risk.yml',
      dropPnpmSetup(ctx, template12(ctx, '.github/workflows/gate-pr-risk.yml')),
    );
    add('risk-gate.yml', riskGateConfig);
  }
  if (on('02')) {
    wf('agent-policy.yml', agentPolicyWorkflow(ctx));
    add('.claude/settings.json', readSource(ctx, 'pieces/02-agent-policy/templates/settings.json'));
    add('.claude/agent-policy.yml', agentPolicyConfig(ctx));
    add('policy/AI_CODING_AGENT_POLICY.md', agentPolicyPolicy(ctx));
    add(
      'docs/policy-exceptions.md',
      '# Policy exceptions\n\nRecord each exception: what, who approved it, and the end date.\n',
    );
    files.push({ path: '.claude/hooks/agent-policy-hook.mjs', hook: true });
  }
  if (on('03')) {
    wf('dora-weekly.yml', doraWorkflow(ctx));
    add('dora.yml', doraConfig);
  }
  if (on('04')) {
    wf('secrets-scan.yml', template12(ctx, '.github/workflows/secrets-scan.yml'));
    add('.pre-commit-config.yaml', preCommit);
  }
  if (on('05')) wf('sbom-vuln.yml', template12(ctx, '.github/workflows/sbom-vuln.yml'));
  if (on('06')) wf('policy-gates.yml', template12(ctx, '.github/workflows/policy-gates.yml'));
  if (on('10')) wf('provenance.yml', provenanceWorkflow(ctx));

  if (callerJobs(ctx).length > 0) wf('rollcage.yml', callerWorkflow(ctx));
  add('.github/CODEOWNERS', template12(ctx, '.github/CODEOWNERS'));
  add('.github/pull_request_template.md', template12(ctx, '.github/pull_request_template.md'));
  add('.github/dependabot.yml', dependabot);
  add('SECURITY.md', template12(ctx, 'SECURITY.md'));
  add('docs/branch-protection.md', branchProtection(ctx));
  add(
    '.rollcage.json',
    `${JSON.stringify({ ref: ctx.ref, sha: ctx.sha, pieces: ctx.pieces, initialized: ctx.date }, null, 2)}\n`,
  );
  return files;
}

// ------------------------------------------------------------------ apply

function buildHook(ctx) {
  const run = (cmd, args) =>
    execFileSync(cmd, args, { cwd: ctx.source, stdio: 'ignore', env: { ...process.env, CI: '1' } });
  run('pnpm', ['install', '--frozen-lockfile', '--filter', '@adl/agent-policy...']);
  run('pnpm', ['--filter', '@adl/agent-policy', 'build']);
  const out = join(ctx.source, 'pieces/02-agent-policy/dist/agent-policy-hook.mjs');
  if (!existsSync(out)) throw new Error('build produced no hook');
  return out;
}

/**
 * Write the plan. Existing files are skipped, never overwritten. Returns what happened per path.
 * With `dryRun` nothing is written and the hook is not built.
 */
function apply(ctx, files, { dryRun = false, buildHooks = true } = {}) {
  const results = [];
  let hookBuild = null;
  for (const file of files) {
    const target = join(ctx.root, file.path);
    if (existsSync(target)) {
      results.push({ path: file.path, status: 'skipped', reason: 'already exists' });
      continue;
    }
    if (file.hook) {
      if (dryRun || !buildHooks) {
        results.push({ path: file.path, status: dryRun ? 'would-write' : 'manual' });
        continue;
      }
      try {
        hookBuild ??= buildHook(ctx);
      } catch {
        results.push({ path: file.path, status: 'manual', reason: 'hook build failed' });
        continue;
      }
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(hookBuild, target);
      results.push({ path: file.path, status: 'written' });
      continue;
    }
    if (dryRun) {
      results.push({ path: file.path, status: 'would-write' });
      continue;
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.content, { flag: 'wx' });
    results.push({ path: file.path, status: 'written' });
  }
  return results;
}

function nextSteps(ctx, results) {
  const steps = [];
  // Only tell people to configure files this run actually created.
  const on = (p, file) =>
    ctx.pieces.includes(p) && results.some((r) => r.path === file && r.status !== 'skipped');
  const manualHook = results.find(
    (r) => r.path.endsWith('agent-policy-hook.mjs') && r.status === 'manual',
  );
  if (manualHook) {
    steps.push(
      `Build the agent hook (needs pnpm and Node 24): in a clone of ${REPO_URL} at ${ctx.ref}, run ` +
        '`pnpm install --frozen-lockfile --filter "@adl/agent-policy..." && pnpm --filter @adl/agent-policy build`, ' +
        'then copy `pieces/02-agent-policy/dist/agent-policy-hook.mjs` to `.claude/hooks/`.',
    );
  }
  if (on('02', 'policy/AI_CODING_AGENT_POLICY.md')) {
    steps.push(
      'Read `policy/AI_CODING_AGENT_POLICY.md`: defaults are filled in (owner, 6-month review, weekly log review). Change what your org needs and get it approved.',
      'Review `allowed_hosts` in `.claude/agent-policy.yml`. Keep every `protected_paths` entry.',
    );
  }
  if (on('03', '.github/workflows/dora-weekly.yml'))
    steps.push(
      'Set `compare-at` in `.github/workflows/dora-weekly.yml` to the day your team started using AI tools.',
    );
  if (on('04', '.pre-commit-config.yaml')) {
    steps.push(
      'Install the commit hook: `pip install pre-commit && pre-commit install --hook-type pre-commit --hook-type commit-msg` (and `brew install gitleaks`).',
      'Organizations: add a `GITLEAKS_LICENSE` repository secret. Personal accounts need nothing.',
    );
  }
  if (on('10', '.github/workflows/provenance.yml'))
    steps.push(
      'Edit the build step in `.github/workflows/provenance.yml`; it runs by hand only and writes a public Sigstore entry.',
    );
  if (ctx.pieces.includes('06') && !ctx.detected.terraform) {
    steps.push('Piece 06 found no Terraform here, so only the workflow-file rules apply.');
  }
  steps.push(
    'Review the diff, commit it on a branch, and open a pull request. The risk gate comments on it (observe mode).',
    'After that first PR has run, make the checks required: see `docs/branch-protection.md`.',
    `To upgrade, rerun with a newer --ref on a clean branch, or bump the SHAs in .github/workflows (Dependabot proposes them).`,
  );
  return steps;
}

// -------------------------------------------------------------------- cli

const USAGE = `Usage: rollcage-init [options]

Set up Rollcage in the git repository in the current directory (or --dir).

  --ref <ref>        Rollcage tag, branch or commit to pin to (default ${DEFAULT_REF}). Resolved to a SHA.
  --owner <login>    GitHub owner for CODEOWNERS (default: from the origin remote).
  --repo <name>      GitHub repo name for the provenance signer (default: from the origin remote).
  --pieces <list>    Comma list of pieces to enable (default: ${DEFAULT_PIECES.join(',')}).
  --without <list>   Pieces to leave out of the default set.
  --dir <path>       Target repository (default: current directory).
  --source <path>    Use a local rollcage checkout instead of cloning (for testing).
  --no-build         Do not build the piece 02 hook; print how to build it instead.
  --dry-run          Print what would be written, change nothing.
  --json             Machine-readable output.
  -h, --help         This text.

Never overwrites an existing file. Exit codes: 0 ok, 1 failed, 2 usage error.`;

const OPTIONS = {
  ref: { type: 'string' },
  owner: { type: 'string' },
  repo: { type: 'string' },
  pieces: { type: 'string' },
  without: { type: 'string' },
  dir: { type: 'string' },
  source: { type: 'string' },
  'no-build': { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
};

export function run(argv, io = { out: console.log, err: console.error }) {
  let values;
  try {
    values = parseArgs({ args: argv, options: OPTIONS, strict: true }).values;
  } catch (error) {
    io.err(`${error.message}\n${USAGE}`);
    return 2;
  }
  if (values.help) {
    io.out(USAGE);
    return 0;
  }

  let source;
  try {
    const root = resolve(values.dir ?? process.cwd());
    if (!existsSync(join(root, '.git'))) {
      throw new InitError(
        `${root} is not the root of a git repository; run this from the repo root`,
      );
    }
    const pieces = parsePieces(values.pieces, values.without);
    const detected = detect(root);
    const ref = values.ref ?? DEFAULT_REF;
    const owner = values.owner ?? detected.remote?.owner;
    const repo = values.repo ?? detected.remote?.repo ?? 'REPO';
    if (!owner) throw new InitError('cannot tell the GitHub owner; pass --owner <login>');
    if (!SAFE_OWNER.test(owner)) throw new InitError(`invalid --owner ${owner}`);
    if (!SAFE_REPO.test(repo)) throw new InitError(`invalid --repo ${repo}`);

    if (values.source) {
      if (!SAFE_REF.test(ref)) throw new InitError(`invalid --ref ${ref}`);
      source = {
        dir: resolve(values.source),
        sha: git(resolve(values.source), 'rev-parse', 'HEAD'),
      };
    } else {
      source = fetchSource(ref);
    }
    const ctx = {
      root,
      source: source.dir,
      ref,
      sha: source.sha,
      owner,
      repo,
      pieces,
      detected,
      date: new Date().toISOString().slice(0, 10),
    };
    const files = plan(ctx);
    const results = apply(ctx, files, {
      dryRun: values['dry-run'] === true,
      buildHooks: values['no-build'] !== true,
    });
    const steps = nextSteps(ctx, results);

    if (values.json) {
      io.out(
        JSON.stringify(
          { ref, sha: ctx.sha, owner, repo, pieces, detected, results, steps },
          null,
          2,
        ),
      );
      return 0;
    }
    io.out(`Rollcage ${ref} (${ctx.sha.slice(0, 12)}) for ${owner}/${repo}`);
    io.out(
      `Detected: ${detected.languages.join(', ') || 'no known language'}; ` +
        `${detected.ciWorkflows.length} existing workflow(s); terraform: ${detected.terraform ? 'yes' : 'no'}`,
    );
    io.out(`Pieces: ${pieces.map((p) => `${p} ${PIECE_NAMES[p]}`).join(', ')}`);
    for (const r of results)
      io.out(`  ${r.status.padEnd(11)} ${r.path}${r.reason ? ` (${r.reason})` : ''}`);
    io.out('\nNext steps:');
    steps.forEach((s, i) => io.out(`  ${i + 1}. ${s}`));
    return 0;
  } catch (error) {
    if (error instanceof InitError) {
      io.err(`rollcage-init: ${error.message}`);
      return 1;
    }
    throw error;
  } finally {
    if (source?.temporary) rmSync(source.dir, { recursive: true, force: true });
  }
}

// Run as a script, or piped to `node -` (no argv[1]); importing it for tests has no side effects.
const entry = process.argv[1];
if (
  !entry ||
  entry === '-' ||
  realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))
) {
  process.exitCode = run(process.argv.slice(2));
}
