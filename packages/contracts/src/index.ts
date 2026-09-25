import { z } from 'zod';

export const DEMO_PROJECT_ID = '00000000-0000-4000-8000-000000000001';
export const createRunSchema = z.strictObject({
  variant: z.enum(['baseline', 'regression']).default('baseline'),
});
export const idempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[a-zA-Z0-9_-]+$/);
export const runIdSchema = z.uuid();
export const runStatusSchema = z.enum(['queued', 'running', 'completed', 'failed']);
export const findingSchema = z.object({
  kind: z.enum(['javascript', 'console', 'http', 'transport']),
  message: z.string().max(2000),
  url: z.string().max(2048).optional(),
});
export const baselineSchema = z.object({
  id: z.uuid(),
  profileHash: z.string().regex(/^[a-f0-9]{64}$/),
  version: z.number().int().positive(),
  sourceRunId: z.uuid(),
  artifactId: z.uuid(),
  approvedAt: z.iso.datetime(),
});
export const baselineStateSchema = z.object({ baseline: baselineSchema.nullable() });
export const approveBaselineSchema = z.strictObject({
  runId: z.uuid(),
  expectedVersion: z.number().int().min(0).max(2147483646),
});
export const comparisonSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('no_baseline') }),
  z.object({
    status: z.literal('incompatible'),
    reason: z.enum(['profile', 'dimensions']),
  }),
  z.object({
    status: z.enum(['matched', 'changed']),
    baseline: baselineSchema,
    diffArtifactId: z.uuid(),
    changedPixels: z.number().int().nonnegative(),
    totalPixels: z.number().int().positive(),
    diffRatio: z.number().min(0).max(1),
    maxDiffRatio: z.number().min(0).max(1),
    pixelThreshold: z.number().min(0).max(1),
  }),
]);
export type Baseline = z.infer<typeof baselineSchema>;
export type ComparisonResult = z.infer<typeof comparisonSchema>;
export type ApproveBaseline = z.infer<typeof approveBaselineSchema>;
export const runSchema = z.object({
  id: runIdSchema,
  status: runStatusSchema,
  verdict: z.enum(['pass', 'attention', 'inconclusive']),
  variant: z.enum(['baseline', 'regression']),
  attempt: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
  error: z.string().nullable(),
  comparison: comparisonSchema.nullable(),
  capture: z
    .object({
      artifactId: z.uuid(),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      browserVersion: z.string(),
      profileHash: z.string().nullable(),
      findings: z.array(findingSchema),
    })
    .nullable(),
});
export type CreateRun = z.infer<typeof createRunSchema>;
export type Finding = z.infer<typeof findingSchema>;
export type Run = z.infer<typeof runSchema>;
export const runHistorySchema = z.array(
  runSchema.pick({ id: true, status: true, createdAt: true }),
);
export const createdRunSchema = z.object({ id: runIdSchema, reused: z.boolean() });
export const isTerminal = (status: Run['status']) => status === 'completed' || status === 'failed';
