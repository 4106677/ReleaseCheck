import { integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { Baseline, ComparisonResult, Finding, Run } from '@releasecheck/contracts';

export type Snapshot = {
  url: string;
  variant: Run['variant'];
  viewport?: Run['viewport'];
  width: number;
  height: number;
  settingsVersion?: number;
  comparisonOptions?: { pixelThreshold: number; maxDiffRatio: number };
  baselines?: Baseline[];
};
export const projects = pgTable('rc_projects', {
  id: uuid().primaryKey(),
  name: text().notNull(),
  settingsVersion: integer('settings_version').notNull(),
  maxDiffBasisPoints: integer('max_diff_basis_points').notNull(),
});
export const runs = pgTable('rc_runs', {
  id: uuid().primaryKey(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id),
  idempotencyKey: text('idempotency_key').notNull(),
  snapshot: jsonb().$type<Snapshot>().notNull(),
  status: text().$type<Run['status']>().notNull(),
  verdict: text().$type<Run['verdict']>().notNull(),
  attempt: integer().notNull(),
  attemptDeadline: timestamp('attempt_deadline', { withTimezone: true }),
  error: text(),
  comparison: jsonb().$type<ComparisonResult>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
});
export const artifacts = pgTable('rc_artifacts', {
  id: uuid().primaryKey(),
  runId: uuid('run_id')
    .notNull()
    .references(() => runs.id),
  key: text('storage_key').notNull(),
  bytes: integer().notNull(),
  checksum: text().notNull(),
});
export const captures = pgTable('rc_captures', {
  runId: uuid('run_id')
    .primaryKey()
    .references(() => runs.id),
  artifactId: uuid('artifact_id')
    .notNull()
    .references(() => artifacts.id),
  width: integer().notNull(),
  height: integer().notNull(),
  browserVersion: text('browser_version').notNull(),
  profileHash: text('profile_hash'),
  findings: jsonb().$type<Finding[]>().notNull(),
});

export const baselines = pgTable('rc_baselines', {
  id: uuid().primaryKey(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id),
  profileHash: text('profile_hash').notNull(),
  version: integer().notNull(),
  sourceRunId: uuid('source_run_id')
    .notNull()
    .references(() => captures.runId),
  artifactId: uuid('artifact_id')
    .notNull()
    .references(() => artifacts.id),
  approvedAt: timestamp('approved_at', { withTimezone: true }).notNull(),
  approvedBy: text('approved_by').notNull(),
});
