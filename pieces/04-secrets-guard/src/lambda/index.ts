import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { IAMClient } from '@aws-sdk/client-iam';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { SNSClient } from '@aws-sdk/client-sns';
import { STSClient } from '@aws-sdk/client-sts';
import {
  accountIdOf,
  alertSecretFetcher,
  auditWriter,
  iamPort,
  notifier,
  secretReader,
} from './aws-adapters.js';
import { loadGuardConfig } from './config.js';
import { createHandler } from './handler.js';
import type { FunctionUrlEvent } from './handler.js';

/** Lambda entry point: wires the real AWS clients. Not unit tested; it holds no logic. */
const env = process.env;
const config = loadGuardConfig(env);
const readSecret = secretReader(new SecretsManagerClient({}));
let cachedWebhookSecret: Promise<string> | undefined;
let cachedGithubToken: Promise<string> | undefined;

const handle = createHandler({
  config,
  now: () => new Date(),
  webhookSecret: () => (cachedWebhookSecret ??= readSecret(env['WEBHOOK_SECRET_ARN'] ?? '')),
  ports: {
    iam: iamPort(new IAMClient({})),
    accountId: accountIdOf(new STSClient({})),
    notify: notifier(new SNSClient({}), env['TOPIC_ARN'] ?? ''),
    writeAudit: auditWriter(new DynamoDBClient({}), env['TABLE_NAME'] ?? ''),
    ...(env['GITHUB_TOKEN_SECRET_ARN']
      ? {
          fetchSecret: async (repo: string, alertNumber: number) => {
            cachedGithubToken ??= readSecret(env['GITHUB_TOKEN_SECRET_ARN'] ?? '');
            return alertSecretFetcher(await cachedGithubToken)(repo, alertNumber);
          },
        }
      : {}),
  },
});

export const handler = (event: FunctionUrlEvent) => handle(event);
