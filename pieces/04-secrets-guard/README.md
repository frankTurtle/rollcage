# 04 Secrets guard

Three layers that keep cloud credentials out of git, and shut a leaked AWS key off fast if one gets
out anyway: a pre-commit scan, a CI scan, and an AWS SAM app that deactivates a leaked access key.

## For engineering leaders

**The problem.** A cloud key committed to a repository can be found and abused by automated scanners, and the
bill or the breach follows. Reports of how fast and how costly are listed in
[docs/sources.md](../../docs/sources.md); they could not be read in this session, so this README
quotes no figure. One layer is not enough: developers bypass hooks, CI runs
after the push, and nobody is watching at 2 a.m.

**What this proves.**

- Layer 1 stops the commit on the developer's machine, and records that it did.
- Layer 2 scans every pull request and the whole history on a schedule, so a bypassed hook is caught.
- Layer 3 reacts when GitHub raises a secret scanning alert for an AWS key: it verifies the request,
  checks the key belongs to a user it is allowed to touch, deactivates it (never deletes it), tags
  the user, notifies you, and writes an audit record.
- The AWS part is safe by default: dry-run on, one allowlisted account, one IAM user path, no
  delete permission.

**The metrics.** Leaks blocked at pre-commit (count, by rule), and time from alert to key
deactivation (median and p90, from the audit records). "Good" is zero leaks reaching a pushed
commit, and a deactivation time you can state in minutes; this piece does not claim a number for
you.

**Adopt it in a week.**

1. Day 1: install the pre-commit template (layer 1) on one repository.
2. Day 2: add the CI workflow template (layer 2) and turn on GitHub secret scanning and push
   protection (see below).
3. Day 3: in a throwaway sandbox AWS account, deploy the SAM app in dry-run mode and send it a test
   alert. Read the audit records.
4. Day 4: create one demo IAM user under the guarded path, leak its key on purpose, and confirm the
   alert path. Delete the user afterwards.
5. Day 5: decide whether to switch off dry-run, and for which account.

**Limits.**

- GitHub itself notifies AWS when it finds an AWS key in a public repository (AWS is a secret
  scanning partner). AWS's managed policy `AWSCompromisedKeyQuarantine` exists for the case where
  "an IAM user's credentials have been compromised or exposed publicly"; AWS applies it, and it
  denies actions such as creating keys, users and instances. AWS's pages do not say when it is
  applied. Layer 3 is a second line, and it covers private repositories where you have secret
  scanning enabled.
- Only long-lived IAM user access keys (`AKIA...`) can be deactivated. Temporary keys (`ASIA...`)
  cannot, and are reported only.
- Deactivation can break a running service that uses the key. That is why dry-run is the default,
  and why the guarded IAM user path is explicit.
- The webhook may not carry the secret value. The documented payload fields do not say whether it
  does, so the app can fetch the alert through GitHub's REST API with a token you provide. Without
  a secret value it records "no secret available" and acts on nothing.
- This does not rotate the key, clean git history, or find the key's past use. Deactivating is the
  first step of the response, not the whole of it.
- Secret scanning for private repositories needs a paid GitHub plan with Secret Protection.

## For engineers

### Architecture

```mermaid
flowchart LR
  D[Developer commits] --> P[Layer 1: pre-commit gitleaks + audit]
  P -->|blocked| X[no commit]
  P -->|clean| R[push]
  R --> C[Layer 2: CI scan on PR + weekly full history]
  R --> G[GitHub secret scanning + push protection]
  G -->|secret_scanning_alert webhook| F[Layer 3: Lambda function URL]
  F --> S{signature valid?}
  S -->|no| N[401]
  S -->|yes| A[parse alert, find AKIA key]
  A --> E{account allowed, user in path?}
  E -->|dry run| L[audit: would deactivate]
  E -->|act| U[UpdateAccessKey Inactive + TagUser + SNS + audit]
```

### What is in the folder

| Path                           | What it is                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------ |
| `templates/`                   | Copy-in files: pre-commit config, gitleaks rules, CI workflow.                 |
| `src/precommit.ts`             | Wraps gitleaks, records blocked commits (no secret values) in `.git/`.         |
| `src/lambda/`                  | The webhook handler: signature check, alert parsing, decision, AWS adapters.   |
| `src/types.ts`                 | The decision list and the audit record shape the Lambda writes.                |
| `template.yaml`                | The SAM template (Function URL, SNS topic, DynamoDB audit table, scoped role). |
| `scripts/`                     | `build.mjs` (one-file hook CLI) and `build-lambda.mjs` (the Lambda bundle).    |
| `src/metrics.ts`               | Blocks pre-commit, and time from alert to deactivation.                        |
| `demo/`                        | Offline demo: a real pre-commit block, and the handler run against fakes.      |

### Layer 1: pre-commit

Build the one-file CLI with `pnpm --filter @adl/secrets-guard build` (it writes
`dist/secrets-guard.mjs`), copy it to `.githooks/`, and copy `templates/pre-commit-config.yaml` and
`templates/gitleaks.toml` into your repository. The hook runs `secrets-guard precommit`, which runs
gitleaks (asking it to exit 99 on leaks, so a gitleaks failure such as a broken config is not
mistaken for a leak) on the staged changes with `--redact`, and when
it blocks, appends a record (time, rule ids, file count) to `.git/secrets-guard.audit.jsonl`. No
secret value is ever written. The custom rules in `gitleaks.toml` show how to add an internal token
format; the starting config extends gitleaks' defaults.

### Layer 2: CI

Copy `templates/workflows/secrets-scan.yml`. It scans every pull request and runs a full-history
scan weekly. Actions are pinned by SHA and permissions are read-only. The `gitleaks-action` is free
for personal accounts; an organization needs a `GITLEAKS_LICENSE` secret.

**Turn on GitHub's own scanning.** Public repositories get secret scanning free. For private
repositories in an organization you need GitHub Secret Protection. Via the REST API, `PATCH
/repos/{owner}/{repo}` accepts `security_and_analysis.secret_scanning.status` and
`security_and_analysis.secret_scanning_push_protection.status` set to `enabled`. The settings
page path was not confirmed (the docs page I tried returned 404), so use the repository's
Settings, then Code security.

### Layer 3: auto-deactivation (SAM app)

**Nothing is deployed by this repository.** `sam validate --lint` runs offline. Deploying is a
manual step, described in `DEPLOY.md`, with what it creates, what it costs, and how to remove it.

Behavior, in order:

1. Verify `X-Hub-Signature-256` (HMAC SHA-256 over the raw body, constant-time compare). Wrong or
   missing signature: 401, nothing else happens.
2. Accept only `secret_scanning_alert` events with action `created` or `publicly_leaked`. Others:
   202, ignored.
3. Get the secret from the payload, or from the REST API if a GitHub token secret is configured.
   None: audit `no-secret`.
4. Pick out access key ids. `ASIA...` is reported, not acted on. Only `AKIA...` continues.
5. Confirm the running account is in `ALLOWED_ACCOUNT_IDS`. If not, refuse (this guards against the
   stack being deployed to the wrong account).
6. Find the key's owner (`GetAccessKeyLastUsed`) and the user's path (`GetUser`). A user outside
   `USER_PATH` is skipped. A key that is already `Inactive` (for example on a GitHub retry) is
   recorded as `already-inactive` and left alone.
7. Dry-run (default): audit "would deactivate" and notify. Otherwise `UpdateAccessKey` to
   `Inactive`, `TagUser`, notify, audit with `leakToActionSeconds`.

The role has no `DeleteAccessKey`. `UpdateAccessKey`, `GetUser`, `ListAccessKeys` and `TagUser` are
limited to the guarded user path. `GetAccessKeyLastUsed` is granted on all resources on purpose:
AWS's authorization reference lists a user resource type for it, so it could be scoped, but then a
key owned by a user outside the path would fail with AccessDenied (and cause GitHub retries)
instead of being reported as out of scope. It only reads the owner name and last-used time.

### Config (environment of the function)

| Variable                  | Default (template)      | Meaning                                                     |
| ------------------------- | ----------------------- | ----------------------------------------------------------- |
| `DRY_RUN`                 | `true`                  | When `true`, nothing is changed in IAM.                     |
| `ALLOWED_ACCOUNT_IDS`     | none, required          | Comma-separated. The function refuses to act elsewhere.     |
| `USER_PATH`               | `/secrets-guard-demo/`  | Only users whose path starts with this are touched.         |
| `WEBHOOK_SECRET_ARN`      | created by the stack    | Secrets Manager secret holding the webhook secret.          |
| `GITHUB_TOKEN_SECRET_ARN` | empty                   | Optional token to fetch the alert's secret over REST.       |
| `TOPIC_ARN`, `TABLE_NAME` | created by the stack    | SNS topic for notifications, DynamoDB table for audit.      |

### Acceptance criteria (each has a test)

- AC-1: signature verification accepts a correct signature, rejects a wrong, missing or malformed
  one, and uses the documented test vector.
- AC-2: the handler returns 401 for a bad signature and does nothing else.
- AC-3: events other than `secret_scanning_alert` created or publicly leaked are ignored.
- AC-4: an `AKIA` key owned by an in-scope user in an allowed account is deactivated, the user is
  tagged, SNS is notified and one audit record is written.
- AC-5: dry-run (the default) never calls `UpdateAccessKey` or `TagUser`.
- AC-6: `ASIA` keys, unknown keys, users outside the path and accounts outside the allowlist are
  not touched, and each outcome is audited with a distinct decision.
- AC-7: a missing allowlist refuses to act at all.
- AC-8: the secret value is never written to the audit record, the notification or the logs.
- AC-9: an AWS error is audited and returns 500, so GitHub can retry; a retry finds the key already
  inactive and records that instead of a second deactivation; a failed notification is recorded as
  `notify-failed` and does not cause a retry; an unreadable alert still leaves an audit record.
- AC-10: the pre-commit wrapper records a blocked commit without any secret value, and passes a
  clean commit.
- AC-11: metrics report blocks by rule and leak-to-deactivation median and p90.
- AC-12: the SAM template has no delete permission, no wildcard IAM action, and defaults to dry-run.

### Runtime dependencies

| Package                  | Why                                                           |
| ------------------------ | ------------------------------------------------------------- |
| `zod`                    | Validate the webhook payload and config.                      |
| `@adl/shared`            | Audit record helpers, hashing (workspace).                    |
| AWS SDK v3 clients (dev) | `iam`, `sts`, `sns`, `dynamodb`, `secrets-manager`. Bundled into the Lambda file by `build:lambda`, as AWS recommends. |

### Security notes

- The webhook endpoint is a public Lambda Function URL with no AWS auth. The HMAC signature is the
  only gate, so the webhook secret must be long and random (the stack generates one).
- Raw bodies are verified before they are parsed. The secret is never logged, notified or stored;
  only a SHA-256 of the key id and its last four characters are kept.
- All tests use fakes. No test calls AWS or GitHub.
- Lambda audit records go to a DynamoDB table with a conditional put, not into the hash chain the
  local logs use (see `docs/decisions/0005`). The table is retained when the stack is deleted.
- A failed Secrets Manager read is not cached, so one throttled call does not break a warm
  environment. SDK clients are built on first use, so a request rejected at the signature check
  builds none of them.
- GitHub details were checked against the current docs on 2026-11-24, and AWS details on
  2026-11-25 (see `docs/sources.md`). What is still unverified is listed under "Verify before you
  deploy".

### Verify before you deploy

Checked against AWS documentation on 2026-11-25:

- `nodejs24.x` is a supported Lambda runtime (projected deprecation April 2028). `nodejs22.x` is
  too, until May 2027. The template uses `nodejs24.x`.
- The Function URL event follows the API Gateway version 2.0 format (`body`, `isBase64Encoded`,
  `headers`). The docs do not say header names are lowercased, so the handler matches them
  case-insensitively.
- AWS recommends including the SDK modules your code uses in the deployment package, so the
  handler bundles them instead of relying on the runtime's copy.
- `sam build` works locally on the bundled folder (`dist/lambda`). The SAM esbuild builder does not,
  because it runs `npm install` on a package that depends on a workspace package; the SAM pages
  I could read do not document its esbuild options, so the bundle is built by `build:lambda`.

Still unverified, so check them before you deploy:

- That the IAM actions work with the user-path ARN scoping in the template. AWS's authorization
  page was only partly readable (the user resource type was confirmed from a summary of it).
- Whether AWS's quarantine policy and this function interact in any way you care about (it is
  attached to the exposed user and restricts that user's own actions).
- A real deployment in a sandbox account. Nothing here has run against AWS.

### Status

Draft for review. Not deployed, and never run against AWS or a real GitHub webhook. The demo runs
the real handler and the real gitleaks binary against fakes and a temporary repository.
