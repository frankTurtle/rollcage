# Use Rollcage as GitHub Actions

Eight pieces ship as composite actions. Call them with `uses:` from any repository. No copying,
no fork.

```yaml
- uses: frankTurtle/rollcage/pieces/02-agent-policy@<commit sha> # v0.6.1
```

Pin to a full commit SHA and keep the version in a comment, so Dependabot can propose upgrades.
A tag such as `@v0.6.0` also works, but a tag can move.

| Piece | Action path | What it does | Needs |
| ----- | ----------- | ------------ | ----- |
| 01 | `pieces/01-pr-risk-gate` | Scores a pull request from its diff, posts one comment, enforces test and approval rules | `pull-requests: write` on a `pull_request` job |
| 02 | `pieces/02-agent-policy` | Fails if the agent policy, Claude Code guardrail settings or hook are missing or weakened | `contents: read` |
| 03 | `pieces/03-dora-metrics` | Weekly delivery metrics, split at the date AI tools were rolled out | `actions`, `deployments`, `issues`, `pull-requests`: read |
| 04 | `pieces/04-secrets-guard` | gitleaks scan of a pull request, a push or the full history | `fetch-depth: 0` checkout; `GITLEAKS_LICENSE` for organizations |
| 05 | `pieces/05-sbom-vuln-triage` | SBOM and CVE triage; fails on a known-exploited finding at or above a severity | `contents: read` |
| 06 | `pieces/06-policy-gates` | OPA and Rego policies over Terraform plans and workflow YAML | `contents: read` |
| 07 | `pieces/07-ci-failure-triage` | Read-only weekly classification of failed CI runs | `actions: read` |
| 10 | `pieces/10-provenance-signing` | Attests a build artifact, or blocks a deploy unless its attestation verifies | `id-token` and `attestations: write` to attest |

Each action's inputs are listed in its `action.yml`.

## One action for everything

The repository root is an action too. Pick a gate with `piece`:

```yaml
- uses: frankTurtle/rollcage@<sha> # v0.6.1
  with:
    piece: sbom
    fail-on: high
```

`piece` is one of `risk-gate`, `agent-policy`, `dora`, `secrets`, `sbom`, `policy-gates`, `ci-triage`
or `provenance`. The root action carries the common inputs; the per-piece actions above carry all of
them. The root action calls each piece at the same release tag, so one version covers everything.

## One workflow, five gates

```yaml
name: rollcage
on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  gates:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          fetch-depth: 0
          persist-credentials: false
      - uses: frankTurtle/rollcage/pieces/02-agent-policy@<sha> # v0.6.1
      - uses: frankTurtle/rollcage/pieces/04-secrets-guard@<sha> # v0.6.1
        with:
          license: ${{ secrets.GITLEAKS_LICENSE }}
      - uses: frankTurtle/rollcage/pieces/05-sbom-vuln-triage@<sha> # v0.6.1
      - uses: frankTurtle/rollcage/pieces/06-policy-gates@<sha> # v0.6.1
      - if: github.event_name == 'pull_request'
        uses: frankTurtle/rollcage/pieces/01-pr-risk-gate@<sha> # v0.6.1
```

Jobs that hold different permissions should stay separate, as in
[rollcage-example](https://github.com/frankTurtle/rollcage-example/blob/main/.github/workflows/ci.yml).
`npx rollcage-init` writes this layout for you.

## Notes

- The actions install their own dependencies with pnpm on the runner. They need a Linux runner.
- Actions that use `pnpm` rely on corepack. Your repository does not need to use pnpm.
- Pieces 08, 09, 11, 13 and 14 run from a clone, not as actions.
