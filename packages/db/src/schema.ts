import { integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { Finding, Run } from '@releasecheck/contracts';

export type Snapshot = { url: string; variant: Run['variant']; width: number; height: number };
export const projects = pgTable('rc_projects', { id: uuid().primaryKey(), name: text().notNull() });
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
  error: text(),
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
  findings: jsonb().$type<Finding[]>().notNull(),
});
