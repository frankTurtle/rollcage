---
name: pr-risk-gate
description: Score the risk of the current branch's changes before opening a pull request, using the repo's PR risk gate. Use when the user asks how risky a change is, whether it needs extra review or tests, or before they open a PR that touches auth, IAM or infrastructure, migrations, CI workflows, dependencies or secrets-adjacent config.
---

# PR risk gate (local pre-check)

Run the same deterministic scoring the CI gate uses, on the current branch, before a PR exists.

## Steps

1. Pick the base branch (`develop` or `main`; ask if unclear) and write the diff and a metadata
   file to a temporary directory outside the repo:

   ```bash
   TMP=$(mktemp -d)
   git diff "<base>...HEAD" > "$TMP/pr.diff"
   printf '{"number":1,"title":"local pre-check","author":"local","labels":[],"approvals":[]}' > "$TMP/pr.meta.json"
   ```

2. Run the gate without a model (deterministic only, no network):

   ```bash
   pnpm --filter @adl/pr-risk-gate risk-gate evaluate \
     --diff "$TMP/pr.diff" --meta "$TMP/pr.meta.json" --config risk-gate.yml --llm none
   ```

   Add `--llm auto` only if the user wants the model review and `ANTHROPIC_API_KEY` is set.

3. Report to the user:
   - the level and the deterministic reasons, verbatim;
   - any model findings with their `file:line` citations, if a model ran;
   - what would block the PR (tests, approvals) and the smallest change that resolves it.

## Rules

- The level comes from the tool's output. Do not re-score it or soften it.
- Do not describe a finding as exploitable or confirmed. Say what looks risky and what you assumed.
- Approvals in this local run are always zero by construction; say so rather than reporting a
  missing approval as a defect.
- Never post a comment, approve, or merge anything. The local check only reads the diff.
