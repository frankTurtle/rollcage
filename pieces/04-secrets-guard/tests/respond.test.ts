import { describe, expect, it } from 'vitest';
import { AlertEventSchema } from '../src/lambda/alert.ts';
import { respondToAlert } from '../src/lambda/respond.ts';
import { KEY, NOW, TEMP_KEY, config, fakePorts, fixture } from './helpers.ts';

const event = (
  over: { action?: string; secret?: string | null; created_at?: string | null } = {},
) => {
  const base = JSON.parse(fixture('alert-created.json'));
  if (over.action) base.action = over.action;
  if (over.secret === null) delete base.alert.secret;
  else if (over.secret) base.alert.secret = over.secret;
  if (over.created_at === null) delete base.alert.created_at;
  return AlertEventSchema.parse(base);
};
const run = (ev = event(), over: Parameters<typeof fakePorts>[0] = {}, cfg = config()) => {
  const fake = fakePorts(over);
  return respondToAlert(ev, fake.ports, cfg, () => NOW).then((entries) => ({ entries, ...fake }));
};
const decisions = (r: { entries: { decision: string }[] }) => r.entries.map((e) => e.decision);

describe('AC-4 deactivation', () => {
  it('deactivates an in-scope key, tags the user, notifies, and audits with the elapsed time', async () => {
    const r = await run();
    expect(decisions(r)).toEqual(['deactivated']);
    expect(r.calls.deactivated).toEqual([[KEY, 'leak-test']]);
    const [tagged] = r.calls.tagged;
    expect(tagged?.[0]).toBe('leak-test');
    expect(tagged?.[1]).toMatchObject({
      'secrets-guard-deactivated-at': NOW.toISOString(),
      'secrets-guard-alert': 'example-org/example-repo#7',
    });
    expect(r.calls.notified).toHaveLength(1);
    expect(r.calls.notified[0]?.subject).toBe('Leaked AWS key deactivated');
    expect(r.entries[0]).toMatchObject({
      actor: 'secrets-guard',
      action: 'respond-to-leak',
      detail: { user: 'leak-test', keySuffix: 'MPLE', leakToActionSeconds: 95, dryRun: false },
    });
    expect(r.calls.audit).toEqual(r.entries);
  });

  it('omits the elapsed time when the alert has no timestamp', async () => {
    const r = await run(event({ created_at: null }));
    expect(r.entries[0]?.detail.leakToActionSeconds).toBeUndefined();
    expect(decisions(r)).toEqual(['deactivated']);
  });

  it('handles several keys in one alert', async () => {
    const r = await run(event({ secret: `${KEY} AKIAAAAAAAAAAEXAMPLE` }));
    expect(decisions(r)).toEqual(['deactivated', 'deactivated']);
  });

  it('works for a publicly_leaked alert, and fetches the secret when the payload has none', async () => {
    const r = await run(event({ action: 'publicly_leaked', secret: null }), {
      fetchSecret: async () => `found ${KEY}`,
    });
    expect(decisions(r)).toEqual(['deactivated']);
  });
});

describe('AC-5 dry run', () => {
  it('never changes IAM, but still audits and notifies', async () => {
    const r = await run(event(), {}, config({ dryRun: true }));
    expect(decisions(r)).toEqual(['dry-run']);
    expect(r.calls.deactivated).toEqual([]);
    expect(r.calls.tagged).toEqual([]);
    expect(r.calls.notified[0]?.message).toContain('DRY_RUN is on');
    expect(r.entries[0]?.detail.dryRun).toBe(true);
  });
});

describe('AC-6 and AC-7 things it must not touch', () => {
  it.each([
    ['a temporary key', event({ secret: TEMP_KEY }), {}, config(), 'temporary-key'],
    ['text with no key', event({ secret: 'ghp_not_a_key' }), {}, config(), 'not-an-access-key'],
    ['an unknown key', event(), { owner: null }, config(), 'unknown-key'],
    ['a user outside the path', event(), { path: '/prod/' }, config(), 'user-out-of-scope'],
    ['another account', event(), { account: '999999999999' }, config(), 'account-not-allowed'],
    ['no allowlist at all', event(), {}, config({ allowedAccountIds: [] }), 'no-allowlist'],
    ['an ignored action', event({ action: 'reopened' }), {}, config(), 'ignored-event'],
  ] as const)('%s is not touched and is audited as %s', async (_name, ev, over, cfg, expected) => {
    const r = await run(ev, over, cfg);
    expect(decisions(r)).toEqual([expected]);
    expect(r.calls.deactivated).toEqual([]);
    expect(r.calls.tagged).toEqual([]);
    expect(r.calls.notified).toEqual([]);
  });

  it('records no-secret when neither the payload nor the REST fetch has one', async () => {
    expect(decisions(await run(event({ secret: null })))).toEqual(['no-secret']);
    const r = await run(event({ secret: null }), { fetchSecret: async () => undefined });
    expect(decisions(r)).toEqual(['no-secret']);
  });

  it('does not look up IAM at all when the account check fails', async () => {
    const fake = fakePorts({ account: '999999999999', failOn: 'iam' });
    const entries = await respondToAlert(event(), fake.ports, config(), () => NOW);
    expect(entries.map((e) => e.decision)).toEqual(['account-not-allowed']);
  });
});

describe('AC-8 no secret value leaks out', () => {
  it('keeps the key out of audit records, notifications and tags', async () => {
    const r = await run();
    const everything = JSON.stringify([r.entries, r.calls.notified, r.calls.tagged]);
    expect(everything).not.toContain(KEY);
    expect(everything).not.toContain('AKIAIOSFODNN7');
    expect(r.entries[0]?.inputHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not copy an AWS error message into the audit record', async () => {
    const r = await run(event(), { failOn: 'deactivate' });
    expect(decisions(r)).toEqual(['error']);
    expect(r.entries[0]?.detail.error).toBe('AccessDenied');
    expect(JSON.stringify(r.entries)).not.toContain(KEY);
  });
});

describe('AC-9 errors', () => {
  it.each([
    ['iam', { deactivated: 0, tagged: 0, notified: 0 }],
    ['deactivate', { deactivated: 0, tagged: 0, notified: 0 }],
    ['tag', { deactivated: 1, tagged: 0, notified: 0 }],
    ['notify', { deactivated: 1, tagged: 1, notified: 0 }],
  ] as const)(
    'an AWS failure at %s is audited as an error and stops what follows',
    async (where, done) => {
      const r = await run(event(), { failOn: where });
      expect(decisions(r)).toContain(where === 'notify' ? 'notify-failed' : 'error');
      expect([r.calls.deactivated.length, r.calls.tagged.length, r.calls.notified.length]).toEqual([
        done.deactivated,
        done.tagged,
        done.notified,
      ]);
    },
  );

  it('the same alert gives the same inputHash and the same IAM calls', async () => {
    const a = await run();
    const b = await run();
    expect(a.entries[0]?.inputHash).toBe(b.entries[0]?.inputHash);
    expect(a.calls.deactivated).toEqual(b.calls.deactivated);
  });
});

describe('review fixes: retries, notification failures and unreadable alerts', () => {
  it('an already inactive key is left alone and recorded, so a retry adds no second deactivation', async () => {
    const r = await run(event(), { active: false });
    expect(decisions(r)).toEqual(['already-inactive']);
    expect(r.calls.deactivated).toEqual([]);
    expect(r.calls.tagged).toEqual([]);
    expect(r.calls.notified).toEqual([]);
    expect(r.entries[0]?.detail.user).toBe('leak-test');
  });

  it('is also reported in dry run', async () => {
    expect(decisions(await run(event(), { active: false }, config({ dryRun: true })))).toEqual([
      'already-inactive',
    ]);
  });

  it('a notification failure after deactivation is its own decision, not an error', async () => {
    const r = await run(event(), { failOn: 'notify' });
    expect(decisions(r)).toEqual(['deactivated', 'notify-failed']);
    expect(r.calls.deactivated).toEqual([[KEY, 'leak-test']]);
  });

  it('a failed secret fetch still leaves an audit record', async () => {
    const r = await run(event({ secret: null }), {
      fetchSecret: async () => {
        throw Object.assign(new Error(`token failure ${KEY}`), { name: 'TokenExpired' });
      },
    });
    expect(decisions(r)).toEqual(['error']);
    expect(r.entries[0]?.detail.error).toBe('TokenExpired');
    expect(JSON.stringify(r.entries)).not.toContain(KEY);
    expect(r.calls.deactivated).toEqual([]);
  });
});
