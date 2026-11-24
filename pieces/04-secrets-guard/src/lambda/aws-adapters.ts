import type { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { PutItemCommand } from '@aws-sdk/client-dynamodb';
import type { IAMClient } from '@aws-sdk/client-iam';
import {
  GetAccessKeyLastUsedCommand,
  GetUserCommand,
  TagUserCommand,
  UpdateAccessKeyCommand,
} from '@aws-sdk/client-iam';
import type { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import type { SNSClient } from '@aws-sdk/client-sns';
import { PublishCommand } from '@aws-sdk/client-sns';
import type { STSClient } from '@aws-sdk/client-sts';
import { GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { GitHubHttp } from '@adl/shared';
import type { AuditEntry, IamPort } from './ports.js';

/** Thin wrappers over the AWS SDK v3. They hold no decisions; the logic is in respond.ts. */

export function iamPort(client: IAMClient): IamPort {
  return {
    async keyOwner(accessKeyId) {
      try {
        const out = await client.send(
          new GetAccessKeyLastUsedCommand({ AccessKeyId: accessKeyId }),
        );
        return out.UserName ?? null;
      } catch (error) {
        if (error instanceof Error && error.name === 'NoSuchEntityException') return null;
        throw error;
      }
    },
    async userPath(userName) {
      const out = await client.send(new GetUserCommand({ UserName: userName }));
      return out.User?.Path ?? '/';
    },
    async deactivate(accessKeyId, userName) {
      await client.send(
        new UpdateAccessKeyCommand({
          AccessKeyId: accessKeyId,
          UserName: userName,
          Status: 'Inactive',
        }),
      );
    },
    async tagUser(userName, tags) {
      await client.send(
        new TagUserCommand({
          UserName: userName,
          Tags: Object.entries(tags).map(([Key, Value]) => ({ Key, Value })),
        }),
      );
    },
  };
}

export const accountIdOf = (client: STSClient) => async (): Promise<string> => {
  const out = await client.send(new GetCallerIdentityCommand({}));
  if (!out.Account) throw new Error('STS returned no account');
  return out.Account;
};

export const notifier =
  (client: SNSClient, topicArn: string) =>
  async (subject: string, message: string): Promise<void> => {
    await client.send(
      new PublishCommand({ TopicArn: topicArn, Subject: subject.slice(0, 100), Message: message }),
    );
  };

/** Append-only: the condition makes a second write with the same key fail instead of overwriting. */
export const auditWriter =
  (client: DynamoDBClient, tableName: string) =>
  async (entry: AuditEntry): Promise<void> => {
    await client.send(
      new PutItemCommand({
        TableName: tableName,
        Item: {
          pk: { S: `${entry.detail.repo}#${entry.detail.alertNumber}` },
          sk: { S: `${entry.timestamp}#${entry.inputHash.slice(0, 12)}` },
          decision: { S: entry.decision },
          record: { S: JSON.stringify(entry) },
        },
        ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
      }),
    );
  };

export const secretReader =
  (client: SecretsManagerClient) =>
  async (secretId: string): Promise<string> => {
    const out = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
    if (!out.SecretString) throw new Error('secret has no string value');
    return out.SecretString;
  };

/** Fetch an alert's literal secret over REST, for when the webhook payload does not carry it. */
export const alertSecretFetcher =
  (token: string, fetchImpl?: typeof fetch) =>
  async (repo: string, alertNumber: number): Promise<string | undefined> => {
    const http = new GitHubHttp(token, fetchImpl);
    const alert = await http.json<{ secret?: string }>(
      `/repos/${repo}/secret-scanning/alerts/${alertNumber}`,
    );
    return alert.secret;
  };
