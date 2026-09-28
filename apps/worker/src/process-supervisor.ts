import { spawn } from 'node:child_process';

export interface ProcessLimits {
  timeoutMs: number;
  stdoutBytes: number;
}

// Only trusted runner code may report a browser PID. This is process cleanup,
// not an isolation boundary for arbitrary executables or untrusted websites.
export function runRunnerProcess(
  script: string,
  input: unknown,
  env: NodeJS.ProcessEnv,
  limits: ProcessLimits,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      env,
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });
    let browserPid: number | undefined;
    let size = 0;
    const chunks: Buffer[] = [];
    let failure: Error | undefined;
    const killBrowser = () => {
      if (browserPid === undefined) return;
      try {
        process.kill(-browserPid, 'SIGKILL');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH')
          failure ??= new Error('RUNNER_CLEANUP_FAILED');
      }
      browserPid = undefined;
    };
    const terminate = (reason: string) => {
      failure ??= new Error(reason);
      killBrowser();
      child.kill('SIGKILL');
    };
    const timer = setTimeout(() => terminate('RUNNER_TIMEOUT'), limits.timeoutMs);
    child.on('message', (message: unknown) => {
      if (
        message &&
        typeof message === 'object' &&
        'type' in message &&
        message.type === 'browser-stopped' &&
        'pid' in message &&
        message.pid === browserPid
      ) {
        browserPid = undefined;
        return;
      }
      if (
        message &&
        typeof message === 'object' &&
        'type' in message &&
        message.type === 'browser-started' &&
        'pid' in message &&
        typeof message.pid === 'number' &&
        Number.isSafeInteger(message.pid) &&
        message.pid > 1 &&
        message.pid !== process.pid &&
        message.pid !== child.pid &&
        browserPid === undefined
      ) {
        browserPid = message.pid;
        if (failure) killBrowser();
      }
    });
    child.stdout!.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limits.stdoutBytes) return terminate('RUNNER_OUTPUT_LIMIT');
      chunks.push(chunk);
    });
    // Drain stderr without retaining page content or accidental secrets in errors.
    child.stderr!.resume();
    child.stdin!.on('error', () => {
      /* The close/error event reports early child exit. */
    });
    child.once('error', () => {
      clearTimeout(timer);
      killBrowser();
      reject(new Error('RUNNER_START_FAILED'));
    });
    child.once('exit', () => {
      // Browser descendants can retain stdout/stderr after Node exits. Kill them
      // on exit, before waiting for close (which waits for these pipes).
      killBrowser();
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      killBrowser();
      if (failure) return reject(failure);
      if (code !== 0) return reject(new Error('RUNNER_EXIT_FAILED'));
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('RUNNER_INVALID_OUTPUT'));
      }
    });
    child.stdin!.end(JSON.stringify(input));
  });
}
