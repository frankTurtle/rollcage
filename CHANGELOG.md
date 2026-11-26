# Changelog

## Unreleased

## 0.6.1 (2026-11-26)

- Root action renamed to `Rollcage DevSecOps Guardrails`: the name `Rollcage` is taken on GitHub, which blocked the
  Marketplace listing. The action pins and the `rollcage-init` default move to v0.6.1.

## 0.6.0 (2026-11-26)

- `rollcage-init` defaults to the v0.6.0 release.
- README badge linking to the GitHub Actions catalog.

- Root `action.yml`: one umbrella action (`uses: frankTurtle/rollcage@<sha>` with `piece:`) for a GitHub Marketplace
  listing. A test keeps its pins on one version and pointing at real pieces.

- Pieces 02 and 04 are composite actions (`pieces/02-agent-policy`, `pieces/04-secrets-guard`), so eight pieces are now
  `uses:` targets. New `docs/github-actions.md` lists them all.
- `rollcage-init` and the piece 12 template call those actions instead of cloning rollcage or inlining gitleaks.

## 0.5.2 (2026-11-25)

- README badges: CI, npm version, npm provenance, release and license. The example repo gets a CI badge.

## 0.5.1 (2026-11-25)

- `rollcage-init` defaults to the v0.5.0 release instead of v0.4.0. Version 0.5.1 is the first published by
  GitHub Actions with provenance.
- `docs/readiness.md` names the npm package as the install path.

## 0.5.0 (2026-11-25)

- The installer is published to npm as `rollcage-init` (`npx rollcage-init`), with provenance via trusted
  publishing. The curl command still works as a fallback.

## 0.4.1 (2026-11-25)

- The scaffold, `init` and docs default to the v0.4.0 release. Piece 10 attestation proven on a real run.
- `SETUP.md`: states the `origin` remote and first-commit requirements, uses full links, and says how to
  test the hook by hand. Found by testing the installer on a fresh repository.
- Dependencies: zod 4 (clears the high advisory) and vitest 4.1.12.

## 0.4.0 (2026-11-25)

- `init/rollcage-init.mjs`: one command that sets Rollcage up in an existing repository (pieces 01
  to 06 and a manual 10 workflow), pinned to a commit SHA, never overwriting files. `SETUP.md` and
  `llms.txt` give coding agents the same steps at a stable URL.
- README: a plain-English what, who and why section at the top.
- Live proofs (see `docs/live-proof-report.md`): pieces 05, 06, 07, 09, 11, 12 and 13 were run
  against the real tools and model. Real Grype, syft, Terraform plan and GitHub log output is now
  pinned as fixtures. Piece 11's recorded responses are real model output and its baseline is 100%.
- Piece 06: PG002 matches an encryption resource that points at its bucket by reference, which is
  what a real plan contains.
- Pieces 05 and 08: the live model calls asked for too few tokens and fell back to the template.
- Piece 07: strips the byte order mark real job logs start with. Piece 05: table column spacing.
- Piece 11: `fixtures --with-model`. Piece 12: template Markdown tables are formatted.

## 0.3.0 (2026-11-25)

- Piece 13 moves to Escapement 0.3.0: the four agents run as an Escapement `pipeline()` with linked
  ledgers, model turns go through `textProvider`, tool handlers are typed from their schemas, and
  replay and evals use `replayProvider` and `caseFromLedger`. `LlmModelProvider` is now the
  function `llmModelProvider`, and a malformed model reply is repaired inside the run instead of
  retried once outside it.
- Piece 10's attestation job is enabled for manual runs (`workflow_dispatch`) only, and its SLSA
  level claims are sourced.
- Piece 02 blocks agents from editing the guard's own config and source (`protected_paths`).
- Shared helpers moved into `@adl/shared`: `selectLlm`, `unifiedDiff`, the markdown link checker
  and `daysBetween`; `completeStructured` rejects zod schemas that use `.transform`.
- Piece 05's feed parsers are pinned to real KEV and EPSS responses; piece 08 was deployed once in
  fixture mode.
- `docs/adopting.md`: a guide for adopting the library in a real project, with an example project
  that pins a release tag.
- Docs: unconfirmed statistics removed from `docs/sources.md`, and ADR 0011 recorded as never issued.

## 0.2.0 (2026-11-25)

- Pieces 05 to 14, built in parallel and in review: SBOM and vulnerability triage (Syft, Grype,
  KEV, EPSS, code evidence), policy gates (OPA/Rego with conftest, illustrative NIST SP 800-171
  mapping), CI failure triage (signatures, flip-rate history, quarantine proposals), AWS cost
  explainer (SAM app, not deployed), postmortem drafter (redaction before any model call),
  provenance signing (deploy gate; the attestation job is disabled until approved), RAG onboarding
  (Python, cited answers, refusals, eval gate), golden path template (scaffold CLI and reusable
  workflows), multi-agent workflow (built on Escapement 0.2.0, approval checkpoint, exact replay)
  and AI dev tool evaluation (rubric, pilot plan, weighted scorecard).
- Video hooks for pieces 06 and 12 no longer cite unverified statistics.

## 0.1.0 (2026-11-25)

- Piece 04 deployed to AWS (us-east-1) and tested with signed webhooks and a canary IAM user. The
  live test found that tagging a user with `#` in the value fails; the tag separator is now `:`,
  and a failed tag no longer hides a successful deactivation or skips the notification. Template
  gains `RetainAuditTable` so a demo stack deletes in one command; `canary.template.yaml` added;
  every resource is tagged `project=rollcage`. Video 01's DORA hook is now sourced.

- Release prep: security contact set; the unsourced "$40K" hook dropped; AWS facts for piece 04
  checked against AWS docs (runtime `nodejs24.x`, SDK bundled, Lambda bundled by `build:lambda`
  because the SAM esbuild builder cannot resolve the workspace dependency); the agent-policy hook
  gets `selftest` (`pnpm policy:selftest`) so a broken hook is caught before it blocks a session.

- MVP review fixes: guard sees through wrappers with option values (`xargs -I`, `timeout -s`) and
  `find -exec`, and no longer trusts `~user` paths; the risk gate reads git-quoted (non-ASCII) paths
  and fails closed on unreadable ones; the policy check requires `onFailure: block` on the
  PreToolUse hook; secrets guard distinguishes gitleaks failures from leaks, records retries as
  `already-inactive`, treats notification failures as non-fatal, and audits unreadable alerts; DORA
  deployment paging no longer assumes an undocumented order; the duplicate CI secrets scan is gone.

- Piece 04, secrets guard: gitleaks pre-commit wrapper with block records, CI scan template, SAM app
  (webhook signature check, scoped deactivation, dry-run default, audit table) and an offline demo.
  Not deployed; AWS documentation pages could not be read in this session. `shared/ts` gains
  median/percentile helpers.
- Piece 03, DORA metrics: all five DORA metrics from the GitHub API (Deployments API, releases or
  workflow runs), before/after split, JSON, HTML and CFO summary outputs, synthetic demo history.
  `shared/ts` gains a YAML config helper, a seeded random helper and a GitHub REST transport (auth,
  API version, pagination, redacted errors) now used by pieces 01 and 03.
- Piece 02 fixes found by using the hooks on this repo: BSD `sed -i ''` and wildcard handling.
- Piece 02, agent policy: policy template, Claude Code PreToolUse/PostToolUse hooks (secret reads,
  force-push, writes outside the repo, host allowlist), shell command analyzer, hash-chained audit
  trail, repo check for CI, metrics, offline demo. `shared/ts` gains the glob matcher and a file
  lock; `AuditLogger` now appends under that lock and reads only the log tail.
- Piece 01, PR risk gate: deterministic pre-score, schema-validated model review with citation
  checks, test and approval policy, in-place PR comment, hash-chained audit log, metrics command,
  GitHub Action, Claude Code skill, offline demo.
- Process: gitflow, Conventional Commits (enforced by a commit-msg hook), PR checklist.

- Phase 0: repo scaffold, root CI, pre-commit with gitleaks, shared TypeScript library
  (LLM client interface, fake, record/replay, Anthropic client, structured-output helper,
  hash-chained JSONL audit logger), docs/sources.md, docs/video-map.md.
