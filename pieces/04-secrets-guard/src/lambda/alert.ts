import { z } from 'zod';

/** The parts of a `secret_scanning_alert` webhook this handler uses. */
export const AlertEventSchema = z.object({
  action: z.string(),
  alert: z.object({
    number: z.number().int(),
    created_at: z.string().optional(),
    secret_type: z.string().optional(),
    secret: z.string().optional(),
    html_url: z.string().optional(),
  }),
  repository: z.object({ full_name: z.string() }),
});
export type AlertEvent = z.infer<typeof AlertEventSchema>;

/** Actions that mean "a secret was just found". Resolved, reopened and the rest are ignored. */
export const ACTIONABLE = new Set(['created', 'publicly_leaked']);

export interface KeyId {
  id: string;
  /** Long-lived IAM user keys start AKIA and can be deactivated. Temporary STS keys start ASIA. */
  kind: 'long-lived' | 'temporary';
}

/** Distinct AWS access key ids in a piece of text. */
export function findAccessKeyIds(text: string): KeyId[] {
  const found = new Map<string, KeyId>();
  for (const m of text.matchAll(/\b(AKIA|ASIA)[A-Z2-7]{16}\b/g)) {
    found.set(m[0], { id: m[0], kind: m[1] === 'AKIA' ? 'long-lived' : 'temporary' });
  }
  return [...found.values()];
}
