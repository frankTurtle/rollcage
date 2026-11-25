# Changelog

## Unreleased

- One-command install: `scaffold init` and `install.sh` add the four PR guardrails to an existing
  repository (new files only, pinned to a commit SHA). `docs/agent-setup.md` lets a coding agent do
  it from a URL. `docs/readiness.md` records the readiness review.

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
