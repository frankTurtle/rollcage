import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_USER_PATH } from '../src/lambda/config.ts';
import type { GuardConfig } from '../src/lambda/config.ts';
import type { Ports } from '../src/lambda/ports.ts';
import type { LeakAuditEntry } from '../src/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
export const fixture = (name: string): string => readFileSync(join(here, 'fixtures', name), 'utf8');

export const KEY = 'AKIAIOSFODNN7EXAMPLE'; // AWS's documented example key
export const TEMP_KEY = 'ASIAIOSFODNN7EXAMPLE';
export const ACCOUNT = '111122223333';
export const NOW = new Date('2026-02-01T10:01:35Z'); // 95 seconds after the alert

export interface Calls {
  deactivated: [string, string][];
  tagged: [string, Record<string, string>][];
  notified: { subject: string; message: string }[];
  audit: LeakAuditEntry[];
}

/** Fake AWS: records calls, answers from simple tables. */
export function fakePorts(
  over: {
    owner?: string | null;
    path?: string;
    account?: string;
    fetchSecret?: Ports['fetchSecret'];
    failOn?: 'deactivate' | 'tag' | 'audit' | 'iam' | 'notify';
  } = {},
) {
  const calls: Calls = { deactivated: [], tagged: [], notified: [], audit: [] };
  const boom = (where: string) => {
    if (over.failOn === where)
      throw Object.assign(new Error(`secret detail ${KEY}`), { name: 'AccessDenied' });
  };
  const ports: Ports = {
    iam: {
      async keyOwner() {
        boom('iam');
        return over.owner === undefined ? 'leak-test' : over.owner;
      },
      async userPath() {
        return over.path ?? DEFAULT_USER_PATH;
      },
      async deactivate(id, user) {
        boom('deactivate');
        calls.deactivated.push([id, user]);
      },
      async tagUser(user, tags) {
        boom('tag');
        calls.tagged.push([user, tags]);
      },
    },
    accountId: async () => over.account ?? ACCOUNT,
    async notify(subject, message) {
      boom('notify');
      calls.notified.push({ subject, message });
    },
    async writeAudit(entry) {
      boom('audit');
      calls.audit.push(entry);
    },
    ...(over.fetchSecret ? { fetchSecret: over.fetchSecret } : {}),
  };
  return { ports, calls };
}

export const config = (over: Partial<GuardConfig> = {}): GuardConfig => ({
  dryRun: false,
  allowedAccountIds: [ACCOUNT],
  userPath: DEFAULT_USER_PATH,
  ...over,
});
