/** What the guard needs from AWS and GitHub. Real versions are in aws-adapters.ts; tests use fakes. */
export interface IamPort {
  /** The IAM user a key belongs to, or null if the key is not in this account. */
  keyOwner(accessKeyId: string): Promise<string | null>;
  userPath(userName: string): Promise<string>;
  /** Set the key to Inactive. Never deletes. Safe to repeat. */
  deactivate(accessKeyId: string, userName: string): Promise<void>;
  tagUser(userName: string, tags: Record<string, string>): Promise<void>;
}

export interface Ports {
  iam: IamPort;
  accountId(): Promise<string>;
  notify(subject: string, message: string): Promise<void>;
  writeAudit(record: AuditEntry): Promise<void>;
  /** Fetch the secret for an alert when the webhook did not carry it. Optional. */
  fetchSecret?(repo: string, alertNumber: number): Promise<string | undefined>;
}

export interface AuditEntry {
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

export type Decision =
  | 'ignored-event'
  | 'no-secret'
  | 'not-an-access-key'
  | 'temporary-key'
  | 'no-allowlist'
  | 'account-not-allowed'
  | 'unknown-key'
  | 'user-out-of-scope'
  | 'dry-run'
  | 'deactivated'
  | 'error';
