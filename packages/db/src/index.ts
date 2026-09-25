import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import {
  DEMO_PROJECT_ID,
  runSchema,
  baselineSchema,
  type ApproveBaseline,
  type ComparisonResult,
  type CreateRun,
  type Finding,
} from '@releasecheck/contracts';
import { artifacts, baselines, captures, runs, type Snapshot } from './schema.js';
export { migrate } from './migrate.js';
export { Pool } from 'pg';

export function createPool(connectionString: string) {
  const pool = new Pool({ connectionString, connectionTimeoutMillis: 5000 });
  // Pool/client background errors must have listeners; otherwise EventEmitter
  // can terminate the process outside the active request's error handler.
  const reportError = (error: Error) => console.error('PostgreSQL connection error', error.name);
  pool.on('error', reportError);
  pool.on('connect', (client) => client.on('error', reportError));
  return pool;
}

export class Conflict extends Error {
  constructor(
    readonly code:
      'IDEMPOTENCY_CONFLICT' | 'RUN_ACTIVE' | 'BASELINE_VERSION_CONFLICT' | 'CAPTURE_NOT_ELIGIBLE',
  ) {
    super(code);
  }
}

export class Repository {
  readonly db;
  constructor(readonly pool: Pool) {
    this.db = drizzle(pool);
  }

  async createRun(input: CreateRun, key: string, fixtureOrigin: string) {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${DEMO_PROJECT_ID}))`);
      const [existing] = await tx
        .select()
        .from(runs)
        .where(and(eq(runs.projectId, DEMO_PROJECT_ID), eq(runs.idempotencyKey, key)));
      if (existing) {
        if (existing.snapshot.variant !== input.variant) throw new Conflict('IDEMPOTENCY_CONFLICT');
        return { id: existing.id, reused: true };
      }
      const [active] = await tx
        .select({ id: runs.id })
        .from(runs)
        .where(
          and(eq(runs.projectId, DEMO_PROJECT_ID), inArray(runs.status, ['queued', 'running'])),
        );
      if (active) throw new Conflict('RUN_ACTIVE');
      const id = randomUUID();
      const url = new URL(input.variant === 'regression' ? '/?regression=1' : '/', fixtureOrigin)
        .href;
      const candidates = await tx
        .selectDistinctOn([baselines.profileHash])
        .from(baselines)
        .where(eq(baselines.projectId, DEMO_PROJECT_ID))
        .orderBy(baselines.profileHash, desc(baselines.version));
      await tx.insert(runs).values({
        id,
        projectId: DEMO_PROJECT_ID,
        idempotencyKey: key,
        snapshot: {
          url,
          variant: input.variant,
          width: 1440,
          height: 900,
          comparisonOptions: { pixelThreshold: 0.1, maxDiffRatio: 0.001 },
          baselines: candidates.map(toBaseline),
        },
        status: 'queued',
        verdict: 'inconclusive',
        attempt: 0,
        createdAt: new Date(),
      });
      await tx.execute(
        sql`select graphile_worker.add_job('capture_run', payload := json_build_object('runId', ${id}::text), max_attempts := 3, job_key := ${id})`,
      );
      return { id, reused: false };
    });
  }

  async getRun(id: string) {
    const [row] = await this.db
      .select()
      .from(runs)
      .leftJoin(captures, eq(captures.runId, runs.id))
      .where(eq(runs.id, id));
    if (!row) return null;
    const run = row.rc_runs;
    const capture = row.rc_captures;
    return runSchema.parse({
      id: run.id,
      status: run.status,
      verdict: run.verdict,
      variant: run.snapshot.variant,
      attempt: run.attempt,
      createdAt: run.createdAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
      error: run.error,
      comparison: run.comparison,
      capture: capture
        ? {
            artifactId: capture.artifactId,
            width: capture.width,
            height: capture.height,
            browserVersion: capture.browserVersion,
            profileHash: capture.profileHash,
            findings: capture.findings,
          }
        : null,
    });
  }

  async listRuns() {
    return this.db
      .select({ id: runs.id, status: runs.status, createdAt: runs.createdAt })
      .from(runs)
      .orderBy(desc(runs.createdAt), desc(runs.id))
      .limit(20);
  }

  async claim(id: string) {
    const [row] = await this.db
      .update(runs)
      .set({ status: 'running', attempt: sql`${runs.attempt} + 1`, error: null })
      .where(and(eq(runs.id, id), inArray(runs.status, ['queued', 'running'])))
      .returning({ attempt: runs.attempt, snapshot: runs.snapshot });
    return row ?? null;
  }

  async complete(
    id: string,
    attempt: number,
    capture: {
      width: number;
      height: number;
      browserVersion: string;
      profileHash: string | null;
      findings: Finding[];
    },
    artifact: { id: string; key: string; checksum: string; bytes: number },
    comparison: ComparisonResult = { status: 'no_baseline' },
    diffArtifact?: { id: string; key: string; checksum: string; bytes: number },
  ) {
    return this.db.transaction(async (tx) => {
      const updated = await tx
        .update(runs)
        .set({
          status: 'completed',
          verdict:
            capture.findings.length || comparison.status === 'changed'
              ? 'attention'
              : comparison.status === 'matched'
                ? 'pass'
                : 'inconclusive',
          comparison,
          finishedAt: new Date(),
        })
        .where(and(eq(runs.id, id), eq(runs.attempt, attempt), eq(runs.status, 'running')))
        .returning({ id: runs.id });
      if (!updated.length) return false;
      if (
        (comparison.status === 'matched' || comparison.status === 'changed') &&
        (!diffArtifact || comparison.diffArtifactId !== diffArtifact.id)
      )
        throw new Error('Comparison must reference its persisted diff artifact');
      await tx.insert(artifacts).values({ ...artifact, runId: id });
      if (diffArtifact) await tx.insert(artifacts).values({ ...diffArtifact, runId: id });
      await tx.insert(captures).values({ ...capture, runId: id, artifactId: artifact.id });
      return true;
    });
  }

  async fail(id: string, attempt: number, error: string) {
    await this.db
      .update(runs)
      .set({ status: 'failed', verdict: 'inconclusive', error, finishedAt: new Date() })
      .where(and(eq(runs.id, id), eq(runs.attempt, attempt), eq(runs.status, 'running')));
  }

  async baselineForRun(id: string) {
    const run = await this.getRun(id);
    if (!run) return null;
    if (!run.capture?.profileHash) return { baseline: null };
    const [row] = await this.db
      .select()
      .from(baselines)
      .where(
        and(
          eq(baselines.projectId, DEMO_PROJECT_ID),
          eq(baselines.profileHash, run.capture.profileHash),
        ),
      )
      .orderBy(desc(baselines.version))
      .limit(1);
    return { baseline: row ? toBaseline(row) : null };
  }

  async approveBaseline(input: ApproveBaseline) {
    return this.db.transaction(async (tx) => {
      // Shared with createRun: either the approval or the queued snapshot wins,
      // never a mixture. Versions are append-only and never change old reports.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${DEMO_PROJECT_ID}))`);
      const [source] = await tx
        .select()
        .from(runs)
        .innerJoin(captures, eq(captures.runId, runs.id))
        .where(and(eq(runs.id, input.runId), eq(runs.projectId, DEMO_PROJECT_ID)));
      if (!source || source.rc_runs.status !== 'completed' || !source.rc_captures.profileHash)
        throw new Conflict('CAPTURE_NOT_ELIGIBLE');
      const capture = source.rc_captures;
      const profileHash = capture.profileHash!;
      const [current] = await tx
        .select()
        .from(baselines)
        .where(
          and(eq(baselines.projectId, DEMO_PROJECT_ID), eq(baselines.profileHash, profileHash)),
        )
        .orderBy(desc(baselines.version))
        .limit(1);
      // An exact retry is safe even when the client lost the first response.
      if (
        current?.sourceRunId === input.runId &&
        (input.expectedVersion === current.version - 1 || input.expectedVersion === current.version)
      )
        return { baseline: toBaseline(current) };
      if ((current?.version ?? 0) !== input.expectedVersion)
        throw new Conflict('BASELINE_VERSION_CONFLICT');
      const [approved] = await tx
        .insert(baselines)
        .values({
          id: randomUUID(),
          projectId: DEMO_PROJECT_ID,
          profileHash,
          version: input.expectedVersion + 1,
          sourceRunId: input.runId,
          artifactId: capture.artifactId,
          approvedAt: new Date(),
          approvedBy: 'local-dev-user',
        })
        .returning();
      return { baseline: toBaseline(approved!) };
    });
  }

  async artifact(id: string) {
    const [row] = await this.db.select().from(artifacts).where(eq(artifacts.id, id));
    return row ?? null;
  }
}
export type { Snapshot };

function toBaseline(row: typeof baselines.$inferSelect) {
  return baselineSchema.parse({ ...row, approvedAt: row.approvedAt.toISOString() });
}
