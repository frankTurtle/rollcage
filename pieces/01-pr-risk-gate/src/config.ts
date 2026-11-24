import { parse } from 'yaml';
import { z } from 'zod';

const Category = z.object({
  level: z.enum(['medium', 'high']),
  paths: z.array(z.string().min(1)).min(1),
});

const DEFAULT_RISK_PATHS: Record<string, z.infer<typeof Category>> = {
  auth: {
    level: 'high',
    paths: ['**/auth/**', '**/*auth*', '**/*login*', '**/*jwt*', '**/*cognito*', '**/*password*'],
  },
  iam_iac: {
    level: 'high',
    paths: [
      '**/*.tf',
      '**/*.tfvars',
      '**/iam/**',
      '**/*iam*.json',
      '**/*iam*.yaml',
      '**/*iam*.yml',
      '**/template.yaml',
      '**/template.yml',
      '**/cloudformation/**',
    ],
  },
  migrations: { level: 'high', paths: ['**/migrations/**', '**/migrate/**', '**/*.sql'] },
  ci_workflows: {
    level: 'high',
    paths: ['.github/workflows/**', '.github/actions/**', '.gitlab-ci.yml', 'Jenkinsfile'],
  },
  secrets_config: {
    level: 'high',
    paths: ['.env', '.env.*', '**/*secret*', '**/*credentials*', '*.pem', '*.key'],
  },
  dependencies: {
    level: 'medium',
    paths: [
      'package-lock.json',
      'pnpm-lock.yaml',
      'yarn.lock',
      'poetry.lock',
      'uv.lock',
      'Pipfile.lock',
      'requirements*.txt',
      'go.sum',
      'Cargo.lock',
    ],
  },
};

const DEFAULT_TEST_PATHS = [
  '**/tests/**',
  '**/test/**',
  '**/__tests__/**',
  '*.test.*',
  '*.spec.*',
  'test_*.py',
  '*_test.py',
  '*_test.go',
];

const DEFAULT_DOC_PATHS = ['*.md', '*.mdx', '*.rst', 'docs/**', 'LICENSE', 'CHANGELOG*'];

const Thresholds = z.object({
  medium_diff_lines: z.number().int().positive().default(100),
  large_diff_lines: z.number().int().positive().default(400),
  min_test_ratio: z.number().min(0).max(1).default(0.25),
});

const SecondApproval = z.object({
  mode: z.enum(['reviews', 'label']).default('reviews'),
  required: z.number().int().min(1).default(2),
  label: z.string().min(1).default('second-approval'),
});

const ConfigSchema = z
  .object({
    mode: z.enum(['enforce', 'observe']).default('enforce'),
    risk_paths: z.record(Category).default(DEFAULT_RISK_PATHS),
    test_paths: z.array(z.string().min(1)).default(DEFAULT_TEST_PATHS),
    doc_paths: z.array(z.string().min(1)).default(DEFAULT_DOC_PATHS),
    thresholds: Thresholds.default({}),
    second_approval: SecondApproval.default({}),
    max_diff_chars: z.number().int().positive().default(60000),
  })
  .strict()
  .refine((c) => c.thresholds.large_diff_lines >= c.thresholds.medium_diff_lines, {
    message: 'thresholds.large_diff_lines must be >= thresholds.medium_diff_lines',
  });

export type GateConfig = z.infer<typeof ConfigSchema>;

/** Parse risk-gate.yml text. Empty or missing text yields the defaults. Unknown keys are errors. */
export function loadConfig(yamlText?: string): GateConfig {
  const raw: unknown = yamlText?.trim() ? parse(yamlText) : {};
  return ConfigSchema.parse(raw ?? {});
}
