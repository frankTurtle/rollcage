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
import { lazy, remember } from './memo.js';
import type { Ports } from './ports.js';

/** Lambda entry point: wires the real AWS clients. Not unit tested; it holds no decisions. */
const env = process.env;

const secrets = lazy(() => secretReader(new SecretsManagerClient({})));
const webhookSecret = remember(() => secrets()(env['WEBHOOK_SECRET_ARN'] ?? ''));
const githubToken = remember(() => secrets()(env['GITHUB_TOKEN_SECRET_ARN'] ?? ''));
const iam = lazy(() => iamPort(new IAMClient({})));
const sts = lazy(() => accountIdOf(new STSClient({})));
const account = remember(() => sts()());
const sns = lazy(() => notifier(new SNSClient({}), env['TOPIC_ARN'] ?? ''));
const audit = lazy(() => auditWriter(new DynamoDBClient({}), env['TABLE_NAME'] ?? ''));

const ports: Ports = {
  iam: {
    keyOwner: (id) => iam().keyOwner(id),
    userPath: (user) => iam().userPath(user),
    keyIsActive: (id, user) => iam().keyIsActive(id, user),
    deactivate: (id, user) => iam().deactivate(id, user),
    tagUser: (user, tags) => iam().tagUser(user, tags),
  },
  accountId: account,
  notify: (subject, message) => sns()(subject, message),
  writeAudit: (entry) => audit()(entry),
  ...(env['GITHUB_TOKEN_SECRET_ARN']
    ? {
        fetchSecret: async (repo: string, alertNumber: number) =>
          alertSecretFetcher(await githubToken())(repo, alertNumber),
      }
    : {}),
};

const handle = createHandler({
  config: loadGuardConfig(env),
  now: () => new Date(),
  webhookSecret,
  ports,
});

export const handler = (event: FunctionUrlEvent) => handle(event);
