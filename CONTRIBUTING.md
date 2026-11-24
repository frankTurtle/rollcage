# Contributing

## Setup

```bash
pnpm install
pre-commit install --hook-type pre-commit --hook-type commit-msg
pnpm check           # lint, format check, typecheck, tests with coverage
```

Requires Node 24 or newer, pnpm, and gitleaks (`brew install gitleaks`).

## Branching (gitflow)

- `main`: released, stable. Only release and hotfix merges land here.
- `develop`: integration branch. All feature work merges here.
- `feature/<name>`: branch from `develop`, one per piece (`feature/01-pr-risk-gate`) or change.
- `release/<version>` and `hotfix/<name>`: standard gitflow; merge to both `main` and `develop`.

Merge with `--no-ff` so each feature stays visible in history. Delete the feature branch after
the merge.

## Commits (Conventional Commits)

Format: `type(scope): summary`, for example `feat(pr-risk-gate): add diff parser`.

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`,
`revert`. Use `!` after the type or scope for a breaking change. The `commit-msg` hook rejects
anything else.

## Before a feature branch merges (the "PR")

1. Documentation is current: the piece's `README.md` and `DEMO.md`, the root README status
   table, `docs/video-map.md`, `CHANGELOG.md`, and `docs/sources.md` for any new statistic.
2. Unit tests cover the acceptance criteria in the piece README. Coverage stays at or above 90%.
3. Run `/simplify` on the branch diff and apply what it finds.
4. `pnpm check` passes and gitleaks is clean.
5. A maintainer reviews. Nothing is pushed or made public without an explicit go-ahead.

## Rules

1. **Docs and tests first.** For a new piece, write the README and DEMO.md, then failing tests
   from the README's acceptance criteria, then the code.
2. **No network in tests.** LLM calls go through `LlmClient` in `shared/ts`. Use `FakeLlm` or
   recorded fixtures. Live mode is opt-in (`DEMO_LIVE=1`).
3. **Deterministic code decides; the model explains.** Thresholds, pass/fail and policy live in
   code. Model output is validated with a schema. Invalid output falls back to the
   deterministic result.
4. **No secrets.** Use AWS's documented example keys (`AKIAIOSFODNN7EXAMPLE`) in fixtures.
5. **Cite statistics** only if they are in `docs/sources.md`.
6. **Pin GitHub Actions by commit SHA** and set least-privilege `permissions:`.
7. Keep runtime dependencies minimal and justify each in the piece's README.

Writing style: plain and direct. No hype words, no emoji.
