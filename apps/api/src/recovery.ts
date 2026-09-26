import type { Repository } from '@releasecheck/db';

type RecoveryLogger = {
  info: (data: unknown, message: string) => void;
  error: (data: unknown, message: string) => void;
};

/** Lives with the API so a crashed worker cannot take its recovery loop down. */
export function startRecovery(
  repository: Pick<Repository, 'recoverRuns'>,
  logger: RecoveryLogger,
  intervalMs = 15_000,
) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Promise<void>;
  const tick = async () => {
    try {
      const recovered = await repository.recoverRuns();
      if (recovered.length) logger.info({ recovered }, 'Recovered interrupted checks');
    } catch (error) {
      logger.error({ err: error }, 'Run recovery failed; will retry');
    } finally {
      if (!stopped) {
        timer = setTimeout(() => {
          pending = tick();
        }, intervalMs);
        timer.unref();
      }
    }
  };
  pending = tick();
  return async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    await pending;
  };
}
