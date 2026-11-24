import { z } from 'zod';

const nullableNumber = z.number().nullable();

export const MetricsSchema = z.object({
  period: z.object({ since: z.string(), until: z.string(), days: z.number() }),
  deploymentFrequency: z.object({
    n: z.number(),
    insufficient: z.boolean(),
    perWeek: nullableNumber,
    medianDaysBetween: nullableNumber,
  }),
  changeLeadTime: z.object({
    n: z.number(),
    insufficient: z.boolean(),
    undeployed: z.number(),
    medianHours: nullableNumber,
    p90Hours: nullableNumber,
  }),
  changeFailRate: z.object({
    n: z.number(),
    insufficient: z.boolean(),
    count: z.number(),
    rate: nullableNumber,
  }),
  failedDeploymentRecovery: z.object({
    n: z.number(),
    insufficient: z.boolean(),
    source: z.enum(['incidents', 'next-deploy']),
    medianHours: nullableNumber,
    p90Hours: nullableNumber,
  }),
  deploymentReworkRate: z.object({
    n: z.number(),
    insufficient: z.boolean(),
    count: z.number(),
    rate: nullableNumber,
  }),
});

export const RowSchema = z.object({
  key: z.enum([
    'deploymentFrequency',
    'changeLeadTime',
    'changeFailRate',
    'failedDeploymentRecovery',
    'deploymentReworkRate',
  ]),
  label: z.string(),
  unit: z.string(),
  betterWhen: z.enum(['higher', 'lower']),
  before: nullableNumber,
  after: nullableNumber,
  nBefore: z.number(),
  nAfter: z.number(),
  changePct: nullableNumber,
  verdict: z.enum(['better', 'worse', 'same', 'insufficient']),
});

export const ReportSchema = z.object({
  schemaVersion: z.literal(1),
  /** The end of the measured range. Used instead of a wall-clock time so reports are reproducible. */
  asOf: z.string(),
  source: z.string(),
  repo: z.string().nullable(),
  /** True when the data was generated, not read from a real repository. */
  synthetic: z.boolean(),
  compareAt: z.string().nullable(),
  /** One entry, or two (before and after) when compareAt is set. */
  periods: z.array(z.object({ name: z.enum(['all', 'before', 'after']), metrics: MetricsSchema })),
  comparison: z.array(RowSchema).nullable(),
  warnings: z.array(z.string()),
  caveats: z.array(z.string()),
});

export type Metrics = z.infer<typeof MetricsSchema>;
export type Row = z.infer<typeof RowSchema>;
export type Report = z.infer<typeof ReportSchema>;
export type Verdict = Row['verdict'];
