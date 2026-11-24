import { z } from 'zod';

const iso = z.string().datetime({ offset: true });

export const DeploymentSchema = z.object({
  id: z.string(),
  sha: z.string(),
  /** When the deployment finished (ISO 8601). */
  at: iso,
  status: z.enum(['success', 'failure']),
});

export const ChangeSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  labels: z.array(z.string()),
  firstCommitAt: iso,
  mergedAt: iso,
});

export const IncidentSchema = z.object({
  id: z.number().int(),
  openedAt: iso,
  closedAt: iso.nullable(),
});

/** The normalized input for the metrics. Any source (GitHub, GitLab, a file) produces this. */
export const DoraDataSchema = z.object({
  deployments: z.array(DeploymentSchema),
  changes: z.array(ChangeSchema),
  incidents: z.array(IncidentSchema),
});

export type Deployment = z.infer<typeof DeploymentSchema>;
export type Change = z.infer<typeof ChangeSchema>;
export type Incident = z.infer<typeof IncidentSchema>;
export type DoraData = z.infer<typeof DoraDataSchema>;

/** Half-open time range: `since` is included, `until` is not. */
export interface Range {
  since: Date;
  until: Date;
}

export interface LoadResult {
  data: DoraData;
  /** Notes about data that was skipped or incomplete. */
  warnings: string[];
}

/** Where the data comes from. GitHub is the only implementation; a GitLab adapter would add one. */
export interface Source {
  readonly name: string;
  load(range: Range): Promise<LoadResult>;
}
