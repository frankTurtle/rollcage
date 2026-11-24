# Changelog

## Unreleased

- Piece 02, agent policy: policy template, Claude Code PreToolUse/PostToolUse hooks (secret reads,
  force-push, writes outside the repo, host allowlist), shell command analyzer, hash-chained audit
  trail, repo check for CI, metrics, offline demo. `shared/ts` gains the glob matcher.
- Piece 01, PR risk gate: deterministic pre-score, schema-validated model review with citation
  checks, test and approval policy, in-place PR comment, hash-chained audit log, metrics command,
  GitHub Action, Claude Code skill, offline demo.
- Process: gitflow, Conventional Commits (enforced by a commit-msg hook), PR checklist.

- Phase 0: repo scaffold, root CI, pre-commit with gitleaks, shared TypeScript library
  (LLM client interface, fake, record/replay, Anthropic client, structured-output helper,
  hash-chained JSONL audit logger), docs/sources.md, docs/video-map.md.
