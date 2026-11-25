# Rollcage

**The AI DevSecOps Library: making AI-accelerated delivery safe to ship, and measurable.**

A roll cage lets a car go fast and survive the crash. This repository does the same for
AI-assisted software delivery: working code, tests and CI for guardrails you can adopt, and
numbers that show whether AI is paying off.

> Status: all 14 pieces are built. 0.1.0 shipped Phase 0 and the MVP (pieces 01 to 04); 0.2.0 adds
> pieces 05 to 14; 0.3.0 adds the adoption guide, shared helpers and Escapement 0.3.0.

## For engineering leaders

AI coding tools raise how much code a team produces. The same research that reports the gains
also reports that AI amplifies whatever a team already does, good or bad, and that developers
say they do not fully trust the output (see [docs/sources.md](docs/sources.md); figures there
are flagged VERIFY BEFORE PUBLISHING). Review, security and compliance checks have to keep up,
and you need numbers to show whether they do.

Each piece below solves a problem you probably already have. Each ships as code with tests,
CI and a demo script.

| # | Piece | Problem | What it proves | Metric | Status | Video |
|---|-------|---------|----------------|--------|--------|-------|
| 01 | [pr-risk-gate](pieces/01-pr-risk-gate/README.md) | Risky AI-assisted changes merge without extra scrutiny | High-risk PRs without tests are blocked, with cited reasons | Change failure rate; % high-risk PRs shipped with tests | MVP, done | TBD |
| 02 | [agent-policy](pieces/02-agent-policy/README.md) | Engineers already use coding agents with no written rules | A one-page policy backed by enforced guardrails and an audit trail | Blocked risky actions per week; % sessions with complete audit trail | MVP, done | TBD |
| 03 | [dora-metrics](pieces/03-dora-metrics/README.md) | No proof AI is paying off | Delivery metrics before and after an AI rollout date | The five DORA metrics | MVP, done | TBD |
| 04 | [secrets-guard](pieces/04-secrets-guard/README.md) | A leaked cloud key can be abused within hours | Three layers: pre-commit, CI scan, automatic key deactivation | Leaks blocked pre-commit; time from leak to deactivation | MVP, done | TBD |
| 05 | [sbom-vuln-triage](pieces/05-sbom-vuln-triage/README.md) | Hundreds of CVEs, few that matter | Evidence-based prioritization | Open criticals; mean time to remediate | done | TBD |
| 06 | [policy-gates](pieces/06-policy-gates/README.md) | Compliance issues found after deployment | Policy as code in the pipeline | Violations caught pre-merge vs after deploy | done | TBD |
| 07 | [ci-failure-triage](pieces/07-ci-failure-triage/README.md) | Teams cannot tell code failures from pipeline failures | Classified failures and flaky-test quarantine proposals | Time to green; flaky-test rate | done | TBD |
| 08 | [aws-cost-explainer](pieces/08-aws-cost-explainer/README.md) | Cloud bill changes nobody can explain | Weekly plain-English cost summary from computed deltas | Unexplained spend | done | TBD |
| 09 | [postmortem-drafter](pieces/09-postmortem-drafter/README.md) | Postmortems are slow and inconsistent | Blameless drafts from logs, with redaction | Incident close to published postmortem | done | TBD |
| 10 | [provenance-signing](pieces/10-provenance-signing/README.md) | No proof a deployed artifact is the one built | Signed provenance verified at deploy | % deployed artifacts signed and verified | done | TBD |
| 11 | [rag-onboarding](pieces/11-rag-onboarding/README.md) | New engineers take weeks to get productive | Cited answers over code and runbooks | Time to first merged PR; eval accuracy | done | TBD |
| 12 | [golden-path-template](pieces/12-golden-path-template/README.md) | Every repo wires its own pipeline | A template that applies the pieces by default | Time from new repo to first deploy | done | TBD |
| 13 | [multi-agent-workflow](pieces/13-multi-agent-workflow/README.md) | Agent changes are hard to review | Every handoff logged and replayable | % agent changes with a complete trace | done | TBD |
| 14 | [ai-dev-tool-eval](pieces/14-ai-dev-tool-eval/README.md) | No consistent way to compare AI dev tools | Rubric and pilot plan tied to measured results | Weighted score; pilot before/after | done | TBD |

## Add it to your repository

One command, from the root of your git repository (Node 24+ and pnpm needed). It adds new files
only, never overwrites, never commits or pushes, and pins the workflows to the exact commit it
fetched. Preview first with `--dry-run`:

```bash
curl -fsSL https://raw.githubusercontent.com/frankTurtle/rollcage/v0.3.0/install.sh | bash -s -- --dry-run
curl -fsSL https://raw.githubusercontent.com/frankTurtle/rollcage/v0.3.0/install.sh | bash
```

Prefer to read it first: download `install.sh`, then `bash install.sh`. To have an AI coding agent
do it, give it this URL and ask it to follow it:
[docs/agent-setup.md](docs/agent-setup.md). Details and options:
[piece 12](pieces/12-golden-path-template/README.md#add-to-an-existing-repository).

## Quickstart

```bash
git clone https://github.com/frankTurtle/rollcage.git && cd rollcage
pnpm install
pnpm check        # lint, format check, typecheck, tests with coverage
```

Requires Node 24 or newer and pnpm. Piece 11 also needs uv; piece 05's live mode needs syft and
grype, piece 06 needs conftest and opa, and piece 10's demo needs cosign. The demos run offline and are deterministic:

```bash
pnpm demo:01   # PR risk gate: three PRs, before and after the gate
pnpm demo:02   # agent policy: blocked tool calls and the audit trail
pnpm demo:03   # DORA metrics: five numbers before and after a (synthetic) rollout
pnpm demo:04   # secrets guard: pre-commit block and the webhook handler (needs gitleaks)
pnpm demo:05   # SBOM triage: 20 findings down to a prioritized list with code evidence
pnpm demo:06   # policy gates: a Terraform plan fails with control ids, then passes after the fix
pnpm demo:07   # CI triage: failed runs classified, one flaky test gets a quarantine proposal
pnpm demo:08   # AWS cost: a weekly week-over-week explanation from fixture cost data
pnpm demo:09   # postmortem: a redacted, blameless draft from logs, chat and deploys
pnpm demo:10   # provenance: sign a tarball, change one byte, the deploy gate blocks it
pnpm demo:11   # RAG onboarding: cited answers and a refusal (needs uv)
pnpm demo:12   # golden path: scaffold a service and run its pipeline locally
pnpm demo:13   # multi-agent: planner to reviewer, human approval, exact replay
pnpm demo:14   # tool eval: weighted scorecard and ranking
pnpm demo:NN:reset   # restore the before state for another take
```

## How to adopt

1. Start with **02 (agent policy)** so the rules and guardrails exist before usage grows.
2. Add **01 (PR risk gate)** so risky changes get extra scrutiny.
3. Measure with **03 (DORA metrics)**, using the date you rolled out AI tools as the split.

For the full path in a real repo, with checks at each step, see [docs/adopting.md](docs/adopting.md).

## Principles

- Code makes the decisions and the model explains them. Thresholds, pass/fail and policy live
  in code. The model classifies, summarizes and drafts, and its output is schema-validated with
  a deterministic fallback.
- When the model is unavailable, high-risk categories are blocked.
- Decisions append to a hash-chained JSONL audit log.
- gitleaks runs pre-commit and in CI, and tests never touch the network.
- AI output states its assumptions and does not claim confirmation without evidence.

Compliance mappings in this repo are illustrative mappings, not compliance attestations.

## What is built

- Pieces 05 to 14: see each piece's README from the table above. Open items are listed
  in [docs/follow-ups.md](docs/follow-ups.md).
- `pieces/04-secrets-guard`: three secret-leak layers: a gitleaks pre-commit wrapper that records
  blocks, a CI scan template, and a SAM app that verifies a GitHub secret scanning webhook and
  deactivates (never deletes) a leaked AWS key. Dry run by default; deployed and tested once against a canary IAM user.
- `pieces/03-dora-metrics`: the five DORA metrics from the GitHub API, a before and after split
  around an AI rollout date, a JSON report, a single-file HTML dashboard and a CFO summary.
- `pieces/02-agent-policy`: a one-page AI coding agent policy, Claude Code hooks that block
  secret reads, force-pushes, writes outside the repo and unlisted hosts, an audit log, a CI check
  and metrics.
- `pieces/01-pr-risk-gate`: PR risk scoring, cited model review, test and approval rules, one
  updating PR comment, audit log, GitHub Action and Claude Code skill.

### Phase 0 foundation

- `shared/ts`: LLM client interface, scripted fake, record/replay fixtures, a fetch-based
  Anthropic client, a schema-validated structured-output helper, and the audit logger.
- Root CI: secrets scan, lint, format check, typecheck, tests with a coverage floor,
  dependency review. Actions are pinned by commit SHA.
- `docs/sources.md`, `docs/video-map.md`, `docs/decisions/`.

## About the author

Rollcage is maintained by Barret "Bear" Nobel ([frankTurtle](https://github.com/frankTurtle)).
Each piece gets a short video walkthrough that solves one problem; the Video column links them
as they are recorded. To contribute, read [CONTRIBUTING.md](CONTRIBUTING.md). To report a
vulnerability, follow [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE).
