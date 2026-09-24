import { run, type Task } from 'graphile-worker';
import { z } from 'zod';
import { Repository, type Pool } from '@releasecheck/db';
import { LocalStorage } from '@releasecheck/storage';
import { localFixtureOrigin, type CaptureInput, type CaptureOutput } from '@releasecheck/checks';
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
      const output = await execute({
        url: claim.snapshot.url,
        fixtureOrigin: origin,
        width: 1440,
        height: 900,
      });
      if (!output.ok) {
        await repository.fail(runId, claim.attempt, output.error);
        return;
      }
      const artifact = await storage.putPng(Buffer.from(output.screenshot, 'base64'));
      uploadedKey = artifact.key;
      const accepted = await repository.complete(
        runId,
        claim.attempt,
        {
          width: output.width,
          height: output.height,
          browserVersion: output.browserVersion,
          findings: output.findings,
        },
        artifact,
      );
      // A stale attempt must not leave a second published artifact.
      if (!accepted) await storage.remove(artifact.key);
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
  return run({
    pgPool: pool,
    concurrency: 1,
    pollInterval: 250,
    noHandleSignals: true,
    parsedCronItems: [],
    taskList: { capture_run: captureTask(new Repository(pool), storage, fixtureOrigin) },
  });
}
