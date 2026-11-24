import type { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import type { IAMClient } from '@aws-sdk/client-iam';
import type { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import type { SNSClient } from '@aws-sdk/client-sns';
import type { STSClient } from '@aws-sdk/client-sts';
import { describe, expect, it } from 'vitest';
import {
  accountIdOf,
  alertSecretFetcher,
  auditWriter,
  iamPort,
  notifier,
  secretReader,
} from '../src/lambda/aws-adapters.ts';
import type { AuditEntry } from '../src/lambda/ports.ts';

interface Sent {
  name: string;
  input: Record<string, unknown>;
}

/** A fake SDK client: records each command by class name and input, and answers from `reply`. */
function fakeClient<T>(reply: (s: Sent) => unknown = () => ({})) {
  const sent: Sent[] = [];
  const client = {
    send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      const s = { name: command.constructor.name, input: command.input };
      sent.push(s);
      const out = reply(s);
      if (out instanceof Error) throw out;
      return out;
    },
  } as unknown as T;
  return { client, sent };
}

describe('iamPort', () => {
  it('finds the owner of a key, and null when IAM says the key does not exist', async () => {
    const found = fakeClient<IAMClient>(() => ({ UserName: 'alice' }));
    expect(await iamPort(found.client).keyOwner('AKIA1')).toBe('alice');
    expect(found.sent).toEqual([
      { name: 'GetAccessKeyLastUsedCommand', input: { AccessKeyId: 'AKIA1' } },
    ]);

    const missing = fakeClient<IAMClient>(() =>
      Object.assign(new Error('x'), { name: 'NoSuchEntityException' }),
    );
    expect(await iamPort(missing.client).keyOwner('AKIA1')).toBeNull();
    const noUser = fakeClient<IAMClient>(() => ({}));
    expect(await iamPort(noUser.client).keyOwner('AKIA1')).toBeNull();
  });

  it('rethrows other IAM errors', async () => {
    const denied = fakeClient<IAMClient>(() =>
      Object.assign(new Error('no'), { name: 'AccessDenied' }),
    );
    await expect(iamPort(denied.client).keyOwner('AKIA1')).rejects.toThrow('no');
    const notError = { send: async () => Promise.reject('plain') } as unknown as IAMClient;
    await expect(iamPort(notError).keyOwner('AKIA1')).rejects.toBe('plain');
  });

  it('reads the user path, defaulting to the root', async () => {
    expect(
      await iamPort(fakeClient<IAMClient>(() => ({ User: { Path: '/a/' } })).client).userPath('u'),
    ).toBe('/a/');
    expect(await iamPort(fakeClient<IAMClient>(() => ({})).client).userPath('u')).toBe('/');
  });

  it('deactivates by setting Inactive, never by deleting, and tags the user', async () => {
    const { client, sent } = fakeClient<IAMClient>();
    const port = iamPort(client);
    await port.deactivate('AKIA1', 'alice');
    await port.tagUser('alice', { a: '1', b: '2' });
    expect(sent).toEqual([
      {
        name: 'UpdateAccessKeyCommand',
        input: { AccessKeyId: 'AKIA1', UserName: 'alice', Status: 'Inactive' },
      },
      {
        name: 'TagUserCommand',
        input: {
          UserName: 'alice',
          Tags: [
            { Key: 'a', Value: '1' },
            { Key: 'b', Value: '2' },
          ],
        },
      },
    ]);
    expect(sent.some((s) => s.name.includes('Delete'))).toBe(false);
  });
});

describe('other adapters', () => {
  it('accountIdOf returns the caller account, or throws when STS gives none', async () => {
    expect(await accountIdOf(fakeClient<STSClient>(() => ({ Account: '1' })).client)()).toBe('1');
    await expect(accountIdOf(fakeClient<STSClient>().client)()).rejects.toThrow('no account');
  });

  it('notifier publishes with a subject cut to 100 characters', async () => {
    const { client, sent } = fakeClient<SNSClient>();
    await notifier(client, 'arn:topic')('s'.repeat(150), 'message');
    expect(sent[0]?.name).toBe('PublishCommand');
    expect(sent[0]?.input).toMatchObject({ TopicArn: 'arn:topic', Message: 'message' });
    expect((sent[0]?.input['Subject'] as string).length).toBe(100);
  });

  it('auditWriter does a conditional put so an existing record is never overwritten', async () => {
    const entry: AuditEntry = {
      timestamp: '2026-02-01T10:01:35.000Z',
      actor: 'secrets-guard',
      action: 'respond-to-leak',
      inputHash: 'abcdef0123456789'.repeat(4),
      decision: 'dry-run',
      detail: { repo: 'o/r', alertNumber: 7, dryRun: true },
    };
    const { client, sent } = fakeClient<DynamoDBClient>();
    await auditWriter(client, 'tbl')(entry);
    expect(sent[0]?.name).toBe('PutItemCommand');
    expect(sent[0]?.input).toMatchObject({
      TableName: 'tbl',
      ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
    });
    const item = sent[0]?.input['Item'] as Record<string, { S: string }>;
    expect(item['pk']?.S).toBe('o/r#7');
    expect(JSON.parse(item['record']?.S ?? '{}')).toEqual(entry);
  });

  it('secretReader returns the string value or throws', async () => {
    expect(
      await secretReader(fakeClient<SecretsManagerClient>(() => ({ SecretString: 'v' })).client)(
        'id',
      ),
    ).toBe('v');
    await expect(secretReader(fakeClient<SecretsManagerClient>().client)('id')).rejects.toThrow(
      'no string value',
    );
  });

  it('alertSecretFetcher reads the alert over REST with the token, no network', async () => {
    const seen: { url: string; auth: string | null }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen.push({ url, auth: new Headers(init.headers).get('authorization') });
      return new Response(JSON.stringify({ secret: 'AKIAIOSFODNN7EXAMPLE' }));
    }) as unknown as typeof fetch;
    expect(await alertSecretFetcher('test-token-not-real', fetchImpl)('o/r', 7)).toBe(
      'AKIAIOSFODNN7EXAMPLE',
    );
    expect(seen[0]).toEqual({
      url: 'https://api.github.com/repos/o/r/secret-scanning/alerts/7',
      auth: 'Bearer test-token-not-real',
    });
  });
});
