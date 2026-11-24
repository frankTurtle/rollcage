import { describe, expect, it } from 'vitest';
import { AlertEventSchema, findAccessKeyIds } from '../src/lambda/alert.ts';
import { loadGuardConfig } from '../src/lambda/config.ts';
import { createHandler } from '../src/lambda/handler.ts';
import type { FunctionUrlEvent } from '../src/lambda/handler.ts';
import { sign, verifySignature } from '../src/lambda/signature.ts';
import { ACCOUNT, KEY, NOW, config, fakePorts, fixture } from './helpers.ts';

const SECRET = 'webhook-secret-not-real';

describe('AC-1 signature verification', () => {
  it("passes GitHub's documented test vector", () => {
    const header = 'sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17';
    expect(verifySignature("It's a Secret to Everybody", 'Hello, World!', header)).toBe(true);
    expect(sign("It's a Secret to Everybody", 'Hello, World!')).toBe(header);
  });

  it('accepts its own signature and rejects everything else', () => {
    const body = '{"a":1}';
    const good = sign(SECRET, body);
    expect(verifySignature(SECRET, body, good)).toBe(true);
    expect(verifySignature(SECRET, Buffer.from(body), good)).toBe(true);
    expect(verifySignature(SECRET, '{"a":2}', good)).toBe(false);
    expect(verifySignature('other-secret', body, good)).toBe(false);
    expect(verifySignature(SECRET, body, undefined)).toBe(false);
    expect(verifySignature(SECRET, body, '')).toBe(false);
    expect(verifySignature(SECRET, body, good.replace('sha256=', 'sha1='))).toBe(false);
    expect(verifySignature(SECRET, body, 'sha256=zz')).toBe(false);
    expect(verifySignature(SECRET, body, good.slice(0, -2))).toBe(false);
    expect(verifySignature('', body, good)).toBe(false);
  });
});

describe('alert parsing', () => {
  it('parses the fixture and finds keys', () => {
    expect(AlertEventSchema.parse(JSON.parse(fixture('alert-created.json'))).alert.number).toBe(7);
    expect(findAccessKeyIds(`x ${KEY} ASIAIOSFODNN7EXAMPLE ${KEY} AKIAshort`)).toEqual([
      { id: KEY, kind: 'long-lived' },
      { id: 'ASIAIOSFODNN7EXAMPLE', kind: 'temporary' },
    ]);
    expect(findAccessKeyIds('nothing here')).toEqual([]);
  });

  it('rejects a payload without the fields it needs', () => {
    expect(AlertEventSchema.safeParse({ action: 'created' }).success).toBe(false);
  });
});

describe('config', () => {
  it('defaults to dry run and refuses to guess an account list', () => {
    expect(loadGuardConfig({})).toEqual({
      dryRun: true,
      allowedAccountIds: [],
      userPath: '/secrets-guard-demo/',
    });
    expect(loadGuardConfig({ DRY_RUN: 'TRUE' }).dryRun).toBe(true);
    expect(loadGuardConfig({ DRY_RUN: '' }).dryRun).toBe(true);
    expect(loadGuardConfig({ DRY_RUN: 'false' }).dryRun).toBe(false);
  });

  it('parses the account list and validates the path', () => {
    expect(
      loadGuardConfig({ ALLOWED_ACCOUNT_IDS: ' 111122223333 , 444455556666,', USER_PATH: '/a/b/' }),
    ).toMatchObject({
      allowedAccountIds: ['111122223333', '444455556666'],
      userPath: '/a/b/',
    });
    expect(() => loadGuardConfig({ USER_PATH: 'no-slashes' })).toThrow('USER_PATH');
    expect(() => loadGuardConfig({ USER_PATH: '/missing-end' })).toThrow();
  });
});

function setup(over: Parameters<typeof fakePorts>[0] = {}, cfg = config()) {
  const fake = fakePorts(over);
  const handler = createHandler({
    ports: fake.ports,
    config: cfg,
    webhookSecret: async () => SECRET,
    now: () => NOW,
  });
  return { ...fake, handler };
}

const request = (
  body: string,
  headers: Record<string, string> = {},
  extra: Partial<FunctionUrlEvent> = {},
): FunctionUrlEvent => ({
  headers: {
    'x-github-event': 'secret_scanning_alert',
    'x-hub-signature-256': sign(SECRET, body),
    ...headers,
  },
  body,
  ...extra,
});

describe('AC-2 and AC-3 the handler gate', () => {
  const body = fixture('alert-created.json');

  it('returns 401 for a bad or missing signature and touches nothing', async () => {
    const { handler, calls } = setup();
    for (const headers of [{ 'x-hub-signature-256': 'sha256=00' }, { 'x-hub-signature-256': '' }]) {
      const res = await handler(request(body, headers));
      expect(res.statusCode).toBe(401);
    }
    expect((await handler({ body })).statusCode).toBe(401);
    expect(calls.audit).toEqual([]);
    expect(calls.deactivated).toEqual([]);
  });

  it('verifies the signature on the raw body, including a base64 body and any header casing', async () => {
    const { handler, calls } = setup();
    const res = await handler({
      headers: {
        'X-GitHub-Event': 'secret_scanning_alert',
        'X-Hub-Signature-256': sign(SECRET, body),
      },
      body: Buffer.from(body).toString('base64'),
      isBase64Encoded: true,
    });
    expect(res.statusCode).toBe(200);
    expect(calls.deactivated).toEqual([[KEY, 'leak-test']]);
  });

  it('ignores other events with 202 and bad payloads with 400', async () => {
    const { handler, calls } = setup();
    expect((await handler(request(body, { 'x-github-event': 'push' }))).statusCode).toBe(202);
    expect((await handler(request('not json'))).statusCode).toBe(400);
    expect((await handler(request('{"action":"created"}'))).statusCode).toBe(400);
    expect(calls.audit).toEqual([]);
  });

  it('records an ignored action, such as a resolved alert', async () => {
    const { handler, calls } = setup();
    const resolved = JSON.stringify({ ...JSON.parse(body), action: 'resolved' });
    expect((await handler(request(resolved))).statusCode).toBe(200);
    expect(calls.audit.map((e) => e.decision)).toEqual(['ignored-event']);
    expect(calls.deactivated).toEqual([]);
  });

  it('returns 500 if the webhook secret cannot be read', async () => {
    const fake = fakePorts();
    const handler = createHandler({
      ports: fake.ports,
      config: config(),
      webhookSecret: async () => {
        throw new Error('nope');
      },
      now: () => NOW,
    });
    expect((await handler(request(body))).statusCode).toBe(500);
  });

  it('handles a request with no body', async () => {
    const { handler } = setup();
    expect((await handler({ headers: {} })).statusCode).toBe(401);
  });

  it('mentions the account only through the allowlist, never in the response', async () => {
    const { handler } = setup();
    const res = await handler(request(body));
    expect(res.body).not.toContain(KEY);
    expect(res.body).not.toContain(ACCOUNT);
  });
});
