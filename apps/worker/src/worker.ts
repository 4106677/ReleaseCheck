import type { ComparisonResult } from '@releasecheck/contracts';
import { run, type Task } from 'graphile-worker';
import { z } from 'zod';
import { Repository, type Pool } from '@releasecheck/db';
import { LocalStorage } from '@releasecheck/storage';
import {
  compareCaptures,
  captureInputSchema,
  localFixtureOrigin,
  type CaptureInput,
  type CaptureOutput,
} from '@releasecheck/checks';
import { executeCapture } from './runner.js';

export function captureTask(
  repository: Repository,
  storage: LocalStorage,
  fixtureOrigin: string,
  execute: (input: CaptureInput) => Promise<CaptureOutput> = executeCapture,
): Task {
  const origin = localFixtureOrigin(fixtureOrigin);
  return async (payload, helpers) => {
    const { runId } = z.object({ runId: z.uuid() }).parse(payload);
    const claim = await repository.claim(runId);
    if (!claim) return;
    let uploadedKey: string | undefined;
    try {
      const output = await execute(
        captureInputSchema.parse({
          url: claim.snapshot.url,
          fixtureOrigin: origin,
          width: claim.snapshot.width,
          height: claim.snapshot.height,
        }),
      );
      if (!output.ok) {
        await repository.fail(runId, claim.attempt, output.error);
        return;
      }
      const png = Buffer.from(output.screenshot, 'base64');
      const artifact = await storage.putPng(png);
      uploadedKey = artifact.key;
      const candidates = claim.snapshot.baselines ?? [];
      const baseline = candidates.find((candidate) => candidate.profileHash === output.profileHash);
      let comparison: ComparisonResult = candidates.length
        ? { status: 'incompatible', reason: 'profile' }
        : { status: 'no_baseline' };
      let diffArtifact: Awaited<ReturnType<LocalStorage['putPng']>> | undefined;
      if (baseline) {
        const before = await repository.artifact(baseline.artifactId);
        if (!before) throw new Error('Baseline artifact is missing');
        const result = compareCaptures(
          { png: await storage.read(before.key), profileHash: baseline.profileHash },
          { png, profileHash: output.profileHash },
          claim.snapshot.comparisonOptions,
        );
        if (result.status === 'incompatible') comparison = result;
        else {
          diffArtifact = await storage.putPng(result.diffPng);
          comparison = {
            status: result.status,
            baseline,
            diffArtifactId: diffArtifact.id,
            changedPixels: result.changedPixels,
            totalPixels: result.totalPixels,
            diffRatio: result.diffRatio,
            maxDiffRatio: result.maxDiffRatio,
            pixelThreshold: result.pixelThreshold,
          };
        }
      }
      const accepted = await repository.complete(
        runId,
        claim.attempt,
        {
          width: output.width,
          height: output.height,
          browserVersion: output.browserVersion,
          profileHash: output.profileHash,
          findings: output.findings,
        },
        artifact,
        comparison,
        diffArtifact,
      );
      // A stale attempt must not leave a second published artifact.
      if (!accepted) {
        await storage.remove(artifact.key);
        if (diffArtifact) await storage.remove(diffArtifact.key);
      }
    } catch (error) {
      // Do not remove a possibly committed file after an ambiguous database failure;
      // orphan collection will be implemented with retention, once references are checked.
      helpers.logger.error(
        `Capture infrastructure failed for run ${runId}, attempt ${claim.attempt}${uploadedKey ? ' after upload' : ''}`,
      );
      if (helpers.job.attempts >= helpers.job.max_attempts) {
        await repository.fail(runId, claim.attempt, 'CAPTURE_INFRASTRUCTURE_FAILED');
      }
      throw error;
    }
  };
}

export async function startWorker(pool: Pool, storage: LocalStorage, fixtureOrigin: string) {
  const repository = new Repository(pool);
  await repository.recoverRuns();
  return run({
    pgPool: pool,
    concurrency: 1,
    pollInterval: 250,
    noHandleSignals: true,
    parsedCronItems: [],
    taskList: { capture_run: captureTask(repository, storage, fixtureOrigin) },
  });
}
