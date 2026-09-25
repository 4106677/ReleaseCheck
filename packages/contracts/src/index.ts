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
export const runSchema = z.object({
  id: runIdSchema,
  status: runStatusSchema,
  verdict: z.enum(['attention', 'inconclusive']),
  variant: z.enum(['baseline', 'regression']),
  attempt: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
  error: z.string().nullable(),
  capture: z
    .object({
      artifactId: z.uuid(),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      browserVersion: z.string(),
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
