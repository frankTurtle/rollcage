import { parseYamlConfig } from '@adl/shared';
import { z } from 'zod';

const ConfigSchema = z
  .object({
    deployments: z
      .object({
        source: z.enum(['deployments-api', 'releases', 'workflow-runs']).default('deployments-api'),
        environment: z.string().min(1).default('production'),
        workflow: z.string().min(1).default('deploy.yml'),
        branch: z.string().min(1).default('main'),
      })
      .default({}),
    failure_window_hours: z.number().positive().default(72),
    incident_label: z.string().min(1).default('incident'),
    hotfix_labels: z.array(z.string().min(1)).default(['hotfix']),
    revert_title_prefix: z.string().min(1).default('Revert'),
    recovery_source: z.enum(['incidents', 'next-deploy']).default('incidents'),
    min_samples: z.number().int().min(1).default(5),
    max_requests: z.number().int().min(1).default(800),
  })
  .strict();

export type DoraConfig = z.infer<typeof ConfigSchema>;

export function loadDoraConfig(yamlText?: string): DoraConfig {
  return parseYamlConfig(ConfigSchema, yamlText);
}
