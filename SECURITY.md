# Security policy

## Reporting a vulnerability

Do not open a public issue for a security problem.

Contact: **security@barretnobel.com**. You can also use GitHub's "Report a vulnerability" (private
security advisory) on the repository once it is enabled.

Please include the affected piece, steps to reproduce, and the impact you see. Do not
include real credentials in a report.

## Scope and design notes

- No secrets in the repository. gitleaks runs as a pre-commit hook and in CI. Test fixtures
  use only AWS's documented example credentials and obviously fake tokens.
- Tests make no network calls. Live LLM and AWS access are opt-in.
- Tools that act on AWS default to dry-run.
