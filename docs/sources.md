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

## GitHub REST API (references for piece 03)

- Read 2026-11-24 from docs.github.com/en/rest: deployments, deployment statuses, pull requests,
  workflow runs, issues, releases, rate limits, pagination. Not statistics; listed here so the
  endpoint facts piece 03 relies on have a source.
- Facts used: `per_page` max 100; list ordering is not documented for deployments, statuses, PR
  commits or releases (sorted client-side); deployment statuses older than 90 days are deleted;
  the issues list also returns pull requests (`pull_request` key); `GITHUB_TOKEN` in Actions has a
  limit of 1,000 requests per hour per repository; the docs show `X-GitHub-Api-Version: 2026-03-10`.
- Not confirmed from the docs: the per-workflow runs endpoint was read from a summary only (its
  parameters match the repo-wide runs endpoint). Verify before relying on it.
- Status: re-check before each release; API versions and limits change.

## Cost and speed of leaked AWS keys (not used)

The "$40K overnight" figure in the original piece 04 video title had **no source and was dropped**
(2026-11-25). On 2026-11-25 an attempt to read the candidate pages below was refused by this
repository's own agent guardrails (their hosts are not on the allowlist), so **no figure from
them has been verified, and none is quoted anywhere in the repo**. Do not quote them until a
person has read them.

- Tom's Hardware, "$45,000 AWS Crypto-Mining Hack Generates $800 of Monero":
  https://www.tomshardware.com/news/aws-45000-usd-bill-for-crypto-mining-hack
- The Register, 2023, "Cryptojackers steal AWS credentials from GitHub in 5 minutes":
  https://www.theregister.com/2023/10/30/cryptojackers-steal-aws-credentials-from-github-in-5-minutes/522761
- Palo Alto Networks Unit 42, EleKtra-Leak research on exposed IAM keys:
  https://unit42.paloaltonetworks.com/malicious-operations-of-exposed-iam-keys-cryptojacking/
- Status: unread. VERIFY BEFORE USING.

## GitHub secret scanning (references for piece 04)

- Read 2026-11-24: webhook events and payloads
  (https://docs.github.com/en/webhooks/webhook-events-and-payloads), validating webhook deliveries
  (https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries), supported
  secret scanning patterns, about secret scanning, REST secret scanning alerts and repository
  update.
- Facts used: `secret_scanning_alert` actions include `created` and `publicly_leaked`;
  `X-Hub-Signature-256` is `sha256=` plus the HMAC hex digest of the raw body; the AWS access key
  id slug is `aws_access_key_id` and AWS is a secret scanning partner; the REST alert object has
  `secret`, `created_at`, `secret_type`, `number` and `repository.full_name`, and
  `hide_secret` defaults to false.
- Not confirmed: whether the **webhook** payload includes the literal secret (the page documents no
  `alert` sub-fields). The handler therefore supports fetching it over REST.

- Status: re-check before each release.

## AWS documentation (references for piece 04)

- Read 2026-11-25 from docs.aws.amazon.com: the IAM service authorization reference (partly read),
  Lambda runtimes (https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html), Function URL
  invocation (https://docs.aws.amazon.com/lambda/latest/dg/urls-invocation.html), the SAM build
  command reference, and the managed policy AWSCompromisedKeyQuarantine
  (https://docs.aws.amazon.com/aws-managed-policy/latest/reference/AWSCompromisedKeyQuarantine.html).
- Facts used: `nodejs24.x` and `nodejs22.x` are supported (projected deprecation dates April 2028
  and May 2027, subject to change); Function URL events follow API Gateway payload format 2.0;
  AWS recommends including the SDK modules your code uses in the package; the quarantine policy
  exists for "compromised or exposed publicly" credentials and denies actions such as
  `iam:CreateAccessKey`, `iam:UpdateAccessKey` and `ec2:RunInstances`.
- Not found in the pages read: the SAM esbuild build options, and AWS's own statement about keys in
  public GitHub repositories.
- Status: re-check before each release; runtimes and deprecation dates change.
