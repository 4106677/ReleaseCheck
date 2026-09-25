import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { captureOutputSchema, type CaptureInput, type CaptureOutput } from '@releasecheck/checks';

export function executeCapture(input: CaptureInput): Promise<CaptureOutput> {
  return new Promise((resolve, reject) => {
    // Pass only runtime settings. In particular, DATABASE_URL and storage credentials
    // never reach the process that executes browser code.
    const env: NodeJS.ProcessEnv = {};
    for (const key of [
      'PATH',
      'HOME',
      'TMPDIR',
      'TEMP',
      'TMP',
      'SystemRoot',
      'PLAYWRIGHT_BROWSERS_PATH',
    ]) {
      if (process.env[key]) env[key] = process.env[key];
    }
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL('./runner-process.js', import.meta.url))],
      { env, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    let failure: Error | undefined;
    const timer = setTimeout(() => {
      failure = new Error('RUNNER_TIMEOUT');
      child.kill('SIGKILL');
    }, 60_000);
    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length + chunk.length > 6 * 1024 * 1024) {
        failure = new Error('RUNNER_OUTPUT_LIMIT');
        child.kill('SIGKILL');
        return;
      }
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 8192) stderr += chunk.toString().slice(0, 8192 - stderr.length);
    });
    child.stdin.on('error', () => {
      /* A failed child is reported by close/error below. */
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (failure) return reject(failure);
      if (code !== 0) return reject(new Error(`Runner exited (${code}): ${stderr}`));
      try {
        resolve(captureOutputSchema.parse(JSON.parse(stdout)));
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(JSON.stringify(input));
  });
}
