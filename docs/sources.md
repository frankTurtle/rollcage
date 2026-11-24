# Sources

Every statistic cited anywhere in this repo must be listed here. All entries are flagged
**VERIFY BEFORE PUBLISHING**. "Checked" means an automated fetch read the page on 2026-11-24;
it does not replace a human reading the primary source.

## Google Cloud DORA, State of AI-assisted Software Development (2025)

- URL: https://dora.dev/research/2025/dora-report/ (landing page). Full report download is
  linked from https://cloud.google.com/dora (not yet read).
- Claims to support, with status:
  - About 90% use AI at work. **Not found on the landing page. Not confirmed.**
  - AI adoption correlates with higher throughput and higher delivery instability. **Not found on the landing page. Not confirmed.**
  - About 30% report little or no trust in AI-generated code. **Not found on the landing page. Not confirmed.**
  - "AI doesn't fix a team; it amplifies what's already there." **Exact quote not found.** The landing page says the report's "primary role is as an amplifier, magnifying an organization's existing strengths and weaknesses." Use that wording, or confirm the quote in the full report.
- Status: VERIFY BEFORE PUBLISHING. Read the full report before citing any number.

## GitLab Global DevSecOps Report (Harris Poll)

- URL found: https://about.gitlab.com/developer-survey/ (canonical per page metadata:
  https://about.gitlab.com/resources/developer-survey/). **This is the 2026 edition**, not 2025.
  The 2025 edition URL has not been located.
- Claims to support, with status:
  - 7 hours a week lost to inefficient processes. **Not confirmed.** (2026 page references hours lost but gives no figure in the text read.)
  - 70% say AI makes compliance harder. **Not confirmed.**
  - 76% find compliance issues after deployment more than during development. **Not confirmed.**
- Status: VERIFY BEFORE PUBLISHING. Do not cite until the 2025 report is located and read.
  Piece 06's hook ("76% find compliance issues after deployment") depends on this.

## Stack Overflow Developer Survey 2025, AI section

- URL: https://survey.stackoverflow.co/2025/ai
- Checked on the page:
  - 84% of respondents use or plan to use AI tools in their development process (up from 76%).
  - 46% actively distrust the accuracy of AI tools; 33% trust it.
  - 66% cite "AI solutions that are almost right, but not quite" as the biggest frustration.
  - 45% say debugging AI-generated code is more time-consuming. (Page wording is "more time-consuming"; use that, not "takes longer".)
- Caution: the AI agents section has a different 84% figure (agent use). Do not conflate them.
- Status: VERIFY BEFORE PUBLISHING.

## DORA software delivery metrics (definitions)

- URL: https://dora.dev/guides/dora-metrics/ (page last updated 2026-01-05 per the page).
- Finding that affects piece 03: DORA now describes **five** software delivery performance
  metrics, not four. Throughput: change lead time, deployment frequency, failed deployment
  recovery time. Instability: change fail rate, deployment rework rate. DORA moved from MTTR to
  "failed deployment recovery time". Piece 03 should use these names and decide whether to ship
  four numbers (the original keys) or all five. Open question for the maintainer.
- Status: VERIFY BEFORE PUBLISHING.

## Claude model identifiers

- URL: https://platform.claude.com/docs/en/about-claude/models/overview (read 2026-11-24).
- Listed IDs: `claude-fable-5-2`, `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`.
  The default in `shared/ts/src/config.ts` is `claude-sonnet-5-5` (structured classification
  and summaries; override with `ANTHROPIC_MODEL`).
- Status: re-check before each release; model lineups change.
