export type Decision =
  | 'ignored-event'
  | 'no-secret'
  | 'not-an-access-key'
  | 'temporary-key'
  | 'no-allowlist'
  | 'account-not-allowed'
  | 'unknown-key'
  | 'user-out-of-scope'
  | 'already-inactive'
  | 'dry-run'
  | 'deactivated'
  | 'notify-failed'
  | 'error';

/**
 * One audit record written by the Lambda. It has the same top-level fields as the shared
 * `AuditRecord` but is not hash-chained: DynamoDB stores each record under a conditional put, so an
 * existing record cannot be overwritten. See docs/decisions/0005.
 */
export interface LeakAuditEntry {
  timestamp: string;
  actor: 'secrets-guard';
  action: 'respond-to-leak';
  /** SHA-256 of the alert and key, so the record can be matched without holding the key. */
  inputHash: string;
  decision: Decision;
  detail: {
    repo: string;
    alertNumber: number;
    keySuffix?: string;
    user?: string;
    dryRun: boolean;
    leakToActionSeconds?: number;
    error?: string;
  };
}
