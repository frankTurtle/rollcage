import { parse } from 'yaml';
import { z } from 'zod';

const DEFAULT_SECRET_PATHS = [
  '.env',
  '.env.*',
  '*.pem',
  '*.key',
  '*.p12',
  '*.pfx',
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'credentials',
  'credentials.json',
  'secrets.json',
  'secrets.yml',
  'secrets.yaml',
  '.npmrc',
  '.netrc',
  '.pgpass',
  '*.tfstate',
  '*.tfstate.backup',
  '**/.aws/**',
  '**/.ssh/**',
  '**/.gnupg/**',
  '**/.kube/config',
  '**/.docker/config.json',
];

const DEFAULT_SECRET_EXCEPTIONS = ['.env.example', '.env.sample', '.env.template', '*.pub'];

const DEFAULT_HOSTS = [
  'github.com',
  'api.github.com',
  'raw.githubusercontent.com',
  'docs.github.com',
  'registry.npmjs.org',
  'pypi.org',
  'files.pythonhosted.org',
  'code.claude.com',
  'docs.claude.com',
  'platform.claude.com',
  'api.anthropic.com',
];

const ConfigSchema = z
  .object({
    allowed_hosts: z.array(z.string().min(1)).default(DEFAULT_HOSTS),
    allow_loopback: z.boolean().default(true),
    allow_write_dirs: z.array(z.string().min(1)).default(['/tmp', '/private/tmp', '~/.claude']),
    secret_paths: z.array(z.string().min(1)).default(DEFAULT_SECRET_PATHS),
    secret_exceptions: z.array(z.string().min(1)).default(DEFAULT_SECRET_EXCEPTIONS),
    allow_web_search: z.boolean().default(true),
    audit_required: z.boolean().default(true),
  })
  .strict();

export type PolicyConfig = z.infer<typeof ConfigSchema>;

/** Parse agent-policy.yml text. Empty text gives the defaults; unknown keys are errors. */
export function loadPolicyConfig(yamlText?: string): PolicyConfig {
  const raw: unknown = yamlText?.trim() ? parse(yamlText) : {};
  return ConfigSchema.parse(raw ?? {});
}
