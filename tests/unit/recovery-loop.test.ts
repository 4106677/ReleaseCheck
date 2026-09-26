import { afterEach, describe, expect, it, vi } from 'vitest';
import { startRecovery } from '../../apps/api/dist/recovery.js';

afterEach(() => vi.useRealTimers());

describe('Recovery scheduler', () => {
  it('retries database failures and stops cleanly', async () => {
    vi.useFakeTimers();
    const recoverRuns = vi
      .fn()
      .mockRejectedValueOnce(new Error('Temporary database failure'))
      .mockResolvedValue([{ id: 'recovered', error: 'RUN_DEADLINE_EXCEEDED' }]);
    const logger = { info: vi.fn(), error: vi.fn() };
    const stop = startRecovery({ recoverRuns }, logger, 10);
    await vi.advanceTimersByTimeAsync(10);
    expect(recoverRuns).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledTimes(1);
    await stop();
    await vi.advanceTimersByTimeAsync(100);
    expect(recoverRuns).toHaveBeenCalledTimes(2);
  });

  it('never overlaps a pending sweep and waits for it during shutdown', async () => {
    vi.useFakeTimers();
    let resolve!: (value: []) => void;
    const recoverRuns = vi.fn(
      () =>
        new Promise<[]>((done) => {
          resolve = done;
        }),
    );
    const stop = startRecovery({ recoverRuns }, { info: vi.fn(), error: vi.fn() }, 10);
    await vi.advanceTimersByTimeAsync(100);
    expect(recoverRuns).toHaveBeenCalledTimes(1);
    let stopped = false;
    const stopping = stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    resolve([]);
    await stopping;
    await vi.advanceTimersByTimeAsync(100);
    expect(recoverRuns).toHaveBeenCalledTimes(1);
  });
});
