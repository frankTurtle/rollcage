# AI DevSecOps Library: making AI-accelerated delivery safe to ship

Working code, tests and CI for making AI-assisted software delivery safe to ship, and for
measuring whether it is paying off.

> Status: Phase 0 (skeleton) is done. Pieces 01 to 04 (the MVP) are done. The rest are planned.

## For engineering leaders

**The problem.** AI coding tools raise how much code a team produces. The same research that
reports the gains also reports that AI amplifies whatever a team already does, good or bad,
and developers say they do not fully trust the output (see [docs/sources.md](docs/sources.md);
figures there are flagged VERIFY BEFORE PUBLISHING). Review, security and compliance
checks have to keep up, and you need numbers to show whether they do.

Each piece below solves one problem you probably already have. Each ships as code with tests and
CI, and each has a demo script.

| # | Piece | Problem | What it proves | Metric | Status | Video |
|---|-------|---------|----------------|--------|--------|-------|
| 01 | [pr-risk-gate](pieces/01-pr-risk-gate/README.md) | Risky AI-assisted changes merge without extra scrutiny | High-risk PRs without tests are blocked, with cited reasons | Change failure rate; % high-risk PRs shipped with tests | MVP, done | TBD |
| 02 | [agent-policy](pieces/02-agent-policy/README.md) | Engineers already use coding agents with no written rules | A one-page policy backed by enforced guardrails and an audit trail | Blocked risky actions per week; % sessions with complete audit trail | MVP, done | TBD |
| 03 | [dora-metrics](pieces/03-dora-metrics/README.md) | No proof AI is paying off | Delivery metrics before and after an AI rollout date | The five DORA metrics | MVP, done | TBD |
| 04 | [secrets-guard](pieces/04-secrets-guard/README.md) | A leaked cloud key can be abused within hours | Three layers: pre-commit, CI scan, automatic key deactivation | Leaks blocked pre-commit; time from leak to deactivation | MVP, done | TBD |
| 05 | sbom-vuln-triage | Hundreds of CVEs, few that matter | Evidence-based prioritization | Open criticals; mean time to remediate | backlog | TBD |
| 06 | policy-gates | Compliance issues found after deployment | Policy as code in the pipeline | Violations caught pre-merge vs after deploy | backlog | TBD |
| 07 | ci-failure-triage | Teams cannot tell code failures from pipeline failures | Classified failures and flaky-test quarantine proposals | Time to green; flaky-test rate | backlog | TBD |
| 08 | aws-cost-explainer | Cloud bill changes nobody can explain | Weekly plain-English cost summary from computed deltas | Unexplained spend | backlog | TBD |
| 09 | postmortem-drafter | Postmortems are slow and inconsistent | Blameless drafts from logs, with redaction | Incident close to published postmortem | backlog | TBD |
| 10 | provenance-signing | No proof a deployed artifact is the one built | Signed provenance verified at deploy | % deployed artifacts signed and verified | backlog | TBD |
| 11 | rag-onboarding | New engineers take weeks to get productive | Cited answers over code and runbooks | Time to first merged PR; eval accuracy | backlog | TBD |
| 12 | golden-path-template | Every repo wires its own pipeline | A template that applies the pieces by default | Time from new repo to first deploy | backlog | TBD |
| 13 | multi-agent-workflow | Agent changes are hard to review | Every handoff logged and replayable | % agent changes with a complete trace | backlog | TBD |
| 14 | ai-dev-tool-eval | No consistent way to compare AI dev tools | Rubric and pilot plan tied to measured results | Weighted score; pilot before/after | backlog | TBD |

## Quickstart

```bash
git clone <repo-url> && cd ai-devsecops-library
pnpm install
pnpm check        # lint, format check, typecheck, tests with coverage
```

Requires Node 24 or newer and pnpm. The demos run offline and are deterministic:

```bash
pnpm demo:01   # PR risk gate: three PRs, before and after the gate
pnpm demo:02   # agent policy: blocked tool calls and the audit trail
pnpm demo:03   # DORA metrics: five numbers before and after a (synthetic) rollout
pnpm demo:04   # secrets guard: pre-commit block and the webhook handler (needs gitleaks)
pnpm demo:0N:reset   # restore the before state for another take
```

## How to adopt

1. Start with **02 (agent policy)** so the rules and guardrails exist before usage grows.
2. Add **01 (PR risk gate)** so risky changes get extra scrutiny.
3. Measure with **03 (DORA metrics)**, using the date you rolled out AI tools as the split.

## Principles

- **Deterministic decisions, AI explanations.** Thresholds, pass/fail and policy live in code.
  The model classifies, summarizes and drafts; its output is schema-validated, with a
  deterministic fallback.
- **Fail closed.** If the model is unavailable, high-risk categories are blocked, not waved through.
- **Every action is logged.** Decisions append to a hash-chained JSONL audit log.
- **No secrets in code.** gitleaks runs pre-commit and in CI. Tests never touch the network.
- **AI output states its assumptions** and does not claim confirmation without evidence.

Compliance mappings in this repo are illustrative mappings, not compliance attestations.

## What is built

- `pieces/04-secrets-guard`: three secret-leak layers: a gitleaks pre-commit wrapper that records
  blocks, a CI scan template, and a SAM app that verifies a GitHub secret scanning webhook and
  deactivates (never deletes) a leaked AWS key. Dry run by default; not deployed.
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

_Placeholder: to be written by the maintainer._

## License

MIT. See [LICENSE](LICENSE).
