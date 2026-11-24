import { canonicalJson, sha256Hex } from '@adl/shared';
import { ACTIONABLE, findAccessKeyIds } from './alert.js';
import type { AlertEvent } from './alert.js';
import type { GuardConfig } from './config.js';
import type { AuditEntry, Decision, Ports } from './ports.js';

const ACTOR = 'secrets-guard' as const;
const ACTION = 'respond-to-leak' as const;

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
): Promise<AuditEntry[]> {
  const { alert, repository } = event;
  const base = { repo: repository.full_name, alertNumber: alert.number, dryRun: config.dryRun };
  const entries: AuditEntry[] = [];

  const record = async (
    decision: Decision,
    keyId: string | undefined,
    extra: Partial<AuditEntry['detail']> = {},
  ): Promise<void> => {
    const entry: AuditEntry = {
      timestamp: now().toISOString(),
      actor: ACTOR,
      action: ACTION,
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
    await record('ignored-event', undefined);
    return entries;
  }
  const secret = alert.secret ?? (await ports.fetchSecret?.(base.repo, alert.number));
  if (!secret) {
    await record('no-secret', undefined);
    return entries;
  }
  const keys = findAccessKeyIds(secret);
  if (keys.length === 0) {
    await record('not-an-access-key', undefined);
    return entries;
  }

  for (const key of keys) {
    try {
      if (key.kind === 'temporary') {
        await record('temporary-key', key.id);
        continue;
      }
      if (config.allowedAccountIds.length === 0) {
        await record('no-allowlist', key.id);
        continue;
      }
      const account = await ports.accountId();
      if (!config.allowedAccountIds.includes(account)) {
        await record('account-not-allowed', key.id);
        continue;
      }
      const user = await ports.iam.keyOwner(key.id);
      if (!user) {
        await record('unknown-key', key.id);
        continue;
      }
      if (!(await ports.iam.userPath(user)).startsWith(config.userPath)) {
        await record('user-out-of-scope', key.id, { user });
        continue;
      }
      if (config.dryRun) {
        await record('dry-run', key.id, { user });
        await ports.notify(
          'Leaked AWS key: dry run',
          `Would deactivate the access key ending ${key.id.slice(-4)} of IAM user ${user} (repository ${base.repo}, alert ${alert.number}). DRY_RUN is on, so nothing was changed.`,
        );
        continue;
      }
      await ports.iam.deactivate(key.id, user);
      await ports.iam.tagUser(user, {
        'secrets-guard-deactivated-at': now().toISOString(),
        'secrets-guard-alert': `${base.repo}#${alert.number}`,
      });
      const seconds = alert.created_at
        ? Math.max(0, Math.round((now().getTime() - Date.parse(alert.created_at)) / 1000))
        : undefined;
      await record('deactivated', key.id, {
        user,
        ...(seconds === undefined ? {} : { leakToActionSeconds: seconds }),
      });
      await ports.notify(
        'Leaked AWS key deactivated',
        `The access key ending ${key.id.slice(-4)} of IAM user ${user} was set to Inactive (repository ${base.repo}, alert ${alert.number}). It was not deleted. Rotate the credentials and review recent activity.`,
      );
    } catch (error) {
      await record('error', key.id, {
        error: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  }
  return entries;
}
