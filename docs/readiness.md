# Readiness review

Reviewed 2026-11-25 against `develop` plus the open live-proof PR. The question: can someone else
adopt Rollcage in their own repository today? Short answer: **yes for the four PR guardrails
(risk gate, secrets scan, SBOM triage, policy gates), with the caveats below. Not yet for
everything else, and not before the items marked Blocker are done.**

## Verdict by area

| Area | State | Notes |
| ---- | ----- | ----- |
| Install path | Ready after merge | `install.sh` and `scaffold init` add the four guardrails to an existing repo, new files only, pinned to a commit SHA. Verified on a fresh git repo with a local source. The URL in the README works once `install.sh` is on `main` (and better from a tag). |
| Agent path | Ready after merge | [agent-setup.md](agent-setup.md) is a numbered, stop-and-ask script for a coding agent. Not yet tried with a real agent on a real repo. |
| PR guardrails on GitHub | Proven | The same workflows run green in `rollcage-example`: `risk-gate / gate`, `secrets / gitleaks`, `sbom / sbom`, `policy / policy`. `init` writes the same files under `rollcage-*` names; a repository set up that way has not run yet. |
| Live paths | Mostly proven | See [live-proof-report.md](live-proof-report.md). Unproven: piece 05's composite action on a runner (the command it runs was proven), piece 08 live Cost Explorer, piece 10 attestation. |
| Tests and CI | Green | `pnpm check` passes; per-piece CI workflows pass on the open PR. |
| Secrets in history | Clean | `gitleaks detect` over 148 commits: no leaks. |
| Dependencies | Caveat | `pnpm audit`: 9 advisories, all in dev tooling except one. See the first Blocker below. |
| License and policy files | Ready | MIT, SECURITY.md, CONTRIBUTING.md, CODEOWNERS, Dependabot, PR template. |
| Repository settings | Gap | `main` and `develop` have no branch protection, and the repository has no topics. The library teaches branch protection; its own default branch should have it. A maintainer sets this (`docs/branch-protection.md` in the template has the command). |
| Docs honesty | Gap | 14 "TBD" video links in the README table, and 4 statistics in `docs/sources.md` still marked VERIFY BEFORE PUBLISHING. |
| Placeholder content | Known | Piece 14's rubric weights are drafts and its example tools are placeholders (A, B, C). Compliance mappings are labeled illustrative. |

## Blockers before telling people to adopt

1. **Dependency advisories.** `zod` 3.25.76 (a production dependency of every piece) has a high
   advisory, fixed only in zod 4.6.6 or later: a memory-exhaustion risk when validating very large
   constrained collections. Inputs here are local config, tool output and model replies, so the
   exposure is small, but a library about security should not ship it. The fix is a zod 3 to 4
   migration across 13 packages. The dev-only advisories (two critical in `tinypool`, plus
   `vitest`, `glob`, `minimatch`) clear with `vitest` and `@vitest/coverage-v8` at 4.1.12 or later; I
   tried it and it works, but v8's branch counting moved and pieces 13 and 14 fall below their 85%
   branch threshold, so it needs a few more tests first. Not done here.
2. **Branch protection on `main`** (above). A maintainer action.
3. **Tag a release that contains `install.sh`.** The README URL uses `main` until then. Cut the
   tag from `main` after this PR merges, then change the URL to the tag.

## Should do soon

- Run the `init` output in a real throwaway repository and watch the four checks go green, then
  try the agent path with a real agent. Both are untested against GitHub today; I did not create
  a repository to do it.
- Piece 07: filter Dependabot runs out of triage (it misreads them as network failures).
- Piece 13: Escapement's JSON turn format is fragile with a real model (1 of 3 live runs halted).
- Replace the 14 "TBD" video entries or drop the column; confirm or remove the 4 flagged statistics.
- A scoped read-only AWS profile, so piece 08's live mode can be proven.

## Not in scope here

Pieces 02, 03, 07 to 11, 13 and 14 are not installed by `init`. They need configuration (an agent
policy, a DORA config, cloud credentials) that a one-command install cannot choose for someone.
[adopting.md](adopting.md) covers them in order.
