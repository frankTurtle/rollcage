import { z } from 'zod';

/** The IAM user path the template and the README use for the demo. Change it for real use. */
export const DEFAULT_USER_PATH = '/secrets-guard-demo/';

const Env = z.object({
  DRY_RUN: z.string().optional(),
  ALLOWED_ACCOUNT_IDS: z.string().default(''),
  USER_PATH: z
    .string()
    .regex(/^\/([A-Za-z0-9+=,.@_-]+\/)*$/, 'USER_PATH must start and end with /')
    .default(DEFAULT_USER_PATH),
});

export interface GuardConfig {
  /** True unless DRY_RUN is exactly "false". The safe value is the default. */
  dryRun: boolean;
  /** Accounts the function may act in. Empty means it refuses to act anywhere. */
  allowedAccountIds: string[];
  /** Only IAM users whose path starts with this are touched. */
  userPath: string;
}

export function loadGuardConfig(env: Record<string, string | undefined>): GuardConfig {
  const parsed = Env.parse(env);
  return {
    dryRun: parsed.DRY_RUN !== 'false',
    allowedAccountIds: parsed.ALLOWED_ACCOUNT_IDS.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    userPath: parsed.USER_PATH,
  };
}
