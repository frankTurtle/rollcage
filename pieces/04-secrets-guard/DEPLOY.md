# Deploying layer 3 (manual, sandbox account only)

**Nothing in this repository deploys this stack, and nothing here has been run against AWS.**
Do this only in a throwaway sandbox AWS account, and only after you have read this page.

## What it creates

One stack, `secrets-guard`, with:

| Resource                    | Purpose                                                              |
| --------------------------- | -------------------------------------------------------------------- |
| Lambda function (arm64, Node.js 24) | The webhook handler, reserved concurrency 2.                         |
| Lambda Function URL         | Public HTTPS endpoint; the HMAC signature is the only gate.          |
| Secrets Manager secret      | The generated webhook secret.                                        |
| DynamoDB table (on demand)  | Audit records. **Retained** when the stack is deleted.               |
| SNS topic (+ email, if set) | Notifications.                                                       |
| CloudWatch log group        | 90-day retention.                                                    |
| IAM role                    | Least privilege, no delete permission, scoped to the guarded path.   |

## What it costs

Small, but not zero. Lambda and SNS are well inside free usage for this traffic. The Secrets
Manager secret is billed per month and per 10,000 API calls, DynamoDB on demand is billed per
request, and CloudWatch Logs per GB. I did not read AWS's current price pages, so check them:
https://aws.amazon.com/secrets-manager/pricing/ and https://aws.amazon.com/dynamodb/pricing/.

## Before you deploy, verify

See "Verify before you deploy" in the README. In short: the IAM user-path scoping has not been run
against AWS, and nothing here has been deployed.

## Steps

```bash
cd pieces/04-secrets-guard
sam validate --lint --template-file template.yaml     # offline
pnpm --filter @adl/secrets-guard build:lambda          # bundles the handler and the AWS SDK clients
sam build                                             # copies the bundle (dist/lambda), offline
sam deploy --guided                                   # needs sandbox credentials; asks for parameters
```

Parameters to choose deliberately: `AllowedAccountIds` (the sandbox account id), `UserPath` (leave
the default), `DryRun` (leave `true`).

Then, in the GitHub repository, add a webhook: payload URL = the `WebhookUrl` output, content type
`application/json`, secret = the value in the `WebhookSecretArn` secret, event = "Secret scanning
alerts". Read the secret with `aws secretsmanager get-secret-value`, and do not paste it anywhere
else.

## A live test, safely

1. Create an IAM user under the guarded path, with **no permissions**, for example
   `/secrets-guard-demo/leak-test`. Create one access key for it.
2. Do not commit that key. Use GitHub's own secret scanning test flow, or a private repository you
   control, and delete everything afterwards.
3. With `DryRun=true`, confirm the audit table and the notification say "would deactivate".
4. Only then, if you want to see a real deactivation, redeploy with `DryRun=false` and repeat.
5. Delete the IAM user and its keys.

Never put a real key in a document, a screen recording or a shared terminal.

## Tear down

```bash
sam delete --stack-name secrets-guard
aws dynamodb scan --table-name <AuditTableName>      # export what you need first
aws dynamodb delete-table --table-name <AuditTableName>   # the table is retained by design
```

Also delete the demo IAM user, the webhook in GitHub, and any email subscription.
