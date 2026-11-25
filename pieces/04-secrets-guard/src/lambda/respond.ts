import { canonicalJson, sha256Hex } from '@adl/shared';
import type { AlertEvent, KeyId } from './alert.js';
import { ACTIONABLE, findAccessKeyIds } from './alert.js';
import type { GuardConfig } from './config.js';
import type { Ports } from './ports.js';
import type { Decision, LeakAuditEntry } from '../types.js';

interface Notice {
  subject: string;
  message: string;
}

/** What happened for one key: the decision, details for the audit record, and a message to send. */
interface KeyResult {
  decision: Decision;
  detail?: Partial<LeakAuditEntry['detail']>;
  notice?: Notice;
}

const errorName = (error: unknown): string =>
  error instanceof Error ? error.name : 'UnknownError';

/**
 * Decide and act on one secret scanning alert. Returns one audit entry per access key found
 * (or one entry explaining why there was nothing to do). Every entry is written to the audit
 * sink before this returns, and the secret value never appears in an entry or a notification.
 * If the audit sink fails, this throws, so the caller can return an error and GitHub retries.
 */
export async function respondToAlert(
  event: AlertEvent,
  ports: Ports,
  config: GuardConfig,
  now: () => Date,
): Promise<LeakAuditEntry[]> {
  const { alert, repository } = event;
  const base = { repo: repository.full_name, alertNumber: alert.number, dryRun: config.dryRun };
  const entries: LeakAuditEntry[] = [];

  const record = async (
    decision: Decision,
    keyId?: string,
    extra: KeyResult['detail'] = {},
    at: Date = now(),
  ): Promise<void> => {
    const entry: LeakAuditEntry = {
      timestamp: at.toISOString(),
      actor: 'secrets-guard',
      action: 'respond-to-leak',
      inputHash: sha256Hex(
        canonicalJson({ repo: base.repo, alert: alert.number, key: keyId ?? null }),
      ),
      decision,
      detail: { ...base, ...(keyId ? { keySuffix: keyId.slice(-4) } : {}), ...extra },
    };
    await ports.writeAudit(entry);
    entries.push(entry);
  };

  if (!ACTIONABLE.has(event.action)) {
    await record('ignored-event');
    return entries;
  }
  let secret = alert.secret;
  if (!secret && ports.fetchSecret) {
    try {
      secret = await ports.fetchSecret(base.repo, alert.number);
    } catch (error) {
      // Still leave a record, so an alert we could not read is not invisible.
      await record('error', undefined, { error: errorName(error) });
      return entries;
    }
  }
  if (!secret) {
    await record('no-secret');
    return entries;
  }
  const keys = findAccessKeyIds(secret);
  if (keys.length === 0) {
    await record('not-an-access-key');
    return entries;
  }

  // One STS call per alert, made only when a key needs it.
  let account: Promise<string> | undefined;
  const accountId = () => (account ??= ports.accountId());

  const decideKey = async (key: KeyId, at: Date): Promise<KeyResult> => {
    if (key.kind === 'temporary') return { decision: 'temporary-key' };
    if (config.allowedAccountIds.length === 0) return { decision: 'no-allowlist' };
    if (!config.allowedAccountIds.includes(await accountId())) {
      return { decision: 'account-not-allowed' };
    }
    const user = await ports.iam.keyOwner(key.id);
    if (!user) return { decision: 'unknown-key' };
    if (!(await ports.iam.userPath(user)).startsWith(config.userPath)) {
      return { decision: 'user-out-of-scope', detail: { user } };
    }

    if (!(await ports.iam.keyIsActive(key.id, user))) {
      return { decision: 'already-inactive', detail: { user } };
    }

    const where = `(repository ${base.repo}, alert ${alert.number})`;
    const what = `the access key ending ${key.id.slice(-4)} of IAM user ${user}`;
    if (config.dryRun) {
      return {
        decision: 'dry-run',
        detail: { user },
        notice: {
          subject: 'Leaked AWS key: dry run',
          message: `Would deactivate ${what} ${where}. DRY_RUN is on, so nothing was changed.`,
        },
      };
    }
    await ports.iam.deactivate(key.id, user);
    await ports.iam.tagUser(user, {
      'secrets-guard-deactivated-at': at.toISOString(),
      'secrets-guard-alert': `${base.repo}#${alert.number}`,
    });
    const seconds = alert.created_at
      ? Math.max(0, Math.round((at.getTime() - Date.parse(alert.created_at)) / 1000))
      : undefined;
    return {
      decision: 'deactivated',
      detail: { user, ...(seconds === undefined ? {} : { leakToActionSeconds: seconds }) },
      notice: {
        subject: 'Leaked AWS key deactivated',
        message: `${what[0]?.toUpperCase()}${what.slice(1)} was set to Inactive ${where}. It was not deleted. Rotate the credentials and review recent activity.`,
      },
    };
  };

  for (const key of keys) {
    const at = now();
    const result = await decideKey(key, at).catch((error: unknown): KeyResult => ({
      decision: 'error',
      detail: { error: errorName(error) },
    }));
    await record(result.decision, key.id, result.detail, at);
    if (result.notice) {
      // The key is already handled and recorded. A notification failure must not trigger a retry.
      await ports
        .notify(result.notice.subject, result.notice.message)
        .catch((error: unknown) =>
          record('notify-failed', key.id, { error: errorName(error) }, at),
        );
    }
  }
  return entries;
}
