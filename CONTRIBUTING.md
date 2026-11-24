# Contributing

## Setup

```bash
pnpm install
pre-commit install   # runs gitleaks, prettier and eslint on commit
pnpm check           # lint, format check, typecheck, tests with coverage
```

Requires Node 24 or newer, pnpm, and gitleaks (`brew install gitleaks`).

## Rules

1. **Docs and tests first.** For a new piece, write the README and DEMO.md, then failing tests
   from the README's acceptance criteria, then the code.
2. **No network in tests.** LLM calls go through `LlmClient` in `shared/ts`. Use `FakeLlm` or
   recorded fixtures. Live mode is opt-in (`DEMO_LIVE=1`).
3. **Deterministic code decides; the model explains.** Thresholds, pass/fail and policy live in
   code. Model output is validated with a schema. Invalid output falls back to the
   deterministic result.
4. **Coverage floor:** 90% lines per piece, enforced in CI.
5. **No secrets.** Use AWS's documented example keys (`AKIAIOSFODNN7EXAMPLE`) in fixtures.
6. **Cite statistics** only if they are in `docs/sources.md`.
7. **Pin GitHub Actions by commit SHA** and set least-privilege `permissions:`.
8. Keep runtime dependencies minimal and justify each in the piece's README.

Writing style: plain and direct. No hype words, no emoji.
