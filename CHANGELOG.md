# Changelog

## Unreleased

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
