import type { LeakAuditEntry } from '../types.js';

/** What the guard needs from AWS and GitHub. Real versions are in aws-adapters.ts; tests use fakes. */
export interface IamPort {
  /** The IAM user a key belongs to, or null if the key is not in this account. */
  keyOwner(accessKeyId: string): Promise<string | null>;
  userPath(userName: string): Promise<string>;
  /** Whether the key is currently Active. An Inactive key needs no action (a retry, for example). */
  keyIsActive(accessKeyId: string, userName: string): Promise<boolean>;
  /** Set the key to Inactive. Never deletes. Safe to repeat. */
  deactivate(accessKeyId: string, userName: string): Promise<void>;
  tagUser(userName: string, tags: Record<string, string>): Promise<void>;
}

export interface Ports {
  iam: IamPort;
  accountId(): Promise<string>;
  notify(subject: string, message: string): Promise<void>;
  writeAudit(record: LeakAuditEntry): Promise<void>;
  /** Fetch the secret for an alert when the webhook did not carry it. Optional. */
  fetchSecret?(repo: string, alertNumber: number): Promise<string | undefined>;
}
