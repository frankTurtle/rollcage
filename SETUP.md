# Set up Rollcage in a repository (instructions for a coding agent or a person)

Rollcage adds safety checks to a GitHub repository so AI-written code is reviewed, scanned and
measured before it ships. This page is written so an agent can follow it step by step. A person can
follow it too.

Stable URL: https://raw.githubusercontent.com/frankTurtle/rollcage/main/SETUP.md

## What you get

By default the setup enables the pieces proven in CI on a real example repository
([rollcage-example](https://github.com/frankTurtle/rollcage-example)):

| Piece | What it adds                                                               |
| ----- | -------------------------------------------------------------------------- |
| 01    | PR risk gate: one comment per pull request with a risk level (observe mode) |
| 02    | Agent policy: rules, a Claude Code hook that blocks risky tool calls, a CI check |
| 03    | DORA metrics: a weekly delivery report                                      |
| 04    | Secrets guard: a gitleaks pre-commit hook and a CI scan                     |
| 05    | SBOM and CVE triage on every pull request                                   |
| 06    | Policy gates: workflow (and Terraform) rules                                |
| 10    | Provenance: a manual workflow to sign and verify a release artifact        |

Other pieces (07, 08, 09, 11, 13, 14) are not set up by this command; see
[docs/adopting.md](https://raw.githubusercontent.com/frankTurtle/rollcage/main/docs/adopting.md).

## Requirements

- Run it from the root of a git repository that has at least one commit, on a branch that is not
  `main`.
- The repository needs an `origin` remote on GitHub. For a repository with no remote yet, pass
  `--owner <login> --repo <name>` (the command stops with "cannot tell the GitHub owner" without
  them).
- `git` and Node 20 or newer. `pnpm` and Node 24 are needed only to build the piece 02 hook; without
  them the command skips the hook and prints how to build it.
- Network access to github.com and raw.githubusercontent.com.

## Steps

1. Create a branch: `git switch -c chore/rollcage`.
2. Preview. Nothing is written:

   ```bash
   npx rollcage-init --dry-run
   ```

   No npm? Use the fallback: `curl -fsSL https://raw.githubusercontent.com/frankTurtle/rollcage/main/init/rollcage-init.mjs | node - --dry-run`.

3. Run it for real:

   ```bash
   npx rollcage-init
   ```

   Fallback without npm: `curl -fsSL https://raw.githubusercontent.com/frankTurtle/rollcage/main/init/rollcage-init.mjs | node -`.

   Options (add after the command, or after `node -` for the curl fallback):
   - `--pieces 01,04,05` enables only those pieces. `--without 03,10` removes some from the default.
   - `--ref v0.6.1` picks the Rollcage release. It is resolved to a commit SHA and every reference
     is pinned to that SHA.
   - `--owner <login>` and `--repo <name>` if there is no `origin` remote on GitHub (also add them
     to the preview in step 2).
   - `--no-build` skips building the piece 02 hook.

   It never overwrites an existing file; it lists those as `skipped`. It reads the repo to avoid
   duplicating jobs your own workflows already call.

4. Read the output. Each line says `written`, `skipped` or `manual`. Then do the printed "Next
   steps". The common ones:
   - Set `compare-at` in `.github/workflows/dora-weekly.yml` to the day the team started using AI
     tools (ask the user if you do not know it). It is prefilled with today's date and marked
     `# SET THIS`.
   - Review `policy/AI_CODING_AGENT_POLICY.md` and `allowed_hosts` in `.claude/agent-policy.yml`.
     Keep every `protected_paths` entry.
   - Edit the build step in `.github/workflows/provenance.yml` for the project. It runs only by hand
     and writes a public Sigstore entry, so do not run it without the user's approval.
   - Organizations add a `GITLEAKS_LICENSE` repository secret. Personal accounts need nothing.
   - The commit hook for secrets needs `pre-commit` (`pip install pre-commit`) and `gitleaks`
     (`brew install gitleaks`). They are optional; the CI scan runs without them.

5. Commit the files on the branch with a conventional commit (for example
   `chore: add rollcage guardrails`) and open a pull request. Do not push to the default branch.
6. After the first pull request has run, a person makes the checks required with
   `docs/branch-protection.md` (written into the repo by the setup). Until then a red check is only advice.

## Rules for an agent doing this

- Do not edit `.claude/settings.json`, `.claude/agent-policy.yml`, `.claude/hooks/**`, the policy
  file or `CODEOWNERS` after setup. They are protected paths; a human edits them.
- Do not remove a SHA pin or replace it with a tag. To upgrade, rerun with a newer `--ref`.
- Do not run the provenance workflow, add repository secrets, or change branch protection yourself.
- If a step fails, report the exact output instead of working around it.

## Check it worked

- `git status` shows the new files and nothing else changed.
- Open the pull request: a "PR risk" comment appears, and the `rollcage` checks run.
- With the hook built, an agent's edit to `.claude/agent-policy.yml` is blocked with rule
  `protected-path`. To test it by hand, pipe a tool-call JSON for that file into
  `node .claude/hooks/agent-policy-hook.mjs hook pre` (the `hook pre` arguments are required).

Status: the checks have run in CI on the example repository. The other pieces are being proven
against live services; see [docs/follow-ups.md](https://raw.githubusercontent.com/frankTurtle/rollcage/main/docs/follow-ups.md).
