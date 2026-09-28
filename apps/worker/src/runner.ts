import { fileURLToPath } from 'node:url';
import { captureOutputSchema, type CaptureInput, type CaptureOutput } from '@releasecheck/checks';
import { runRunnerProcess } from './process-supervisor.js';

export async function executeCapture(input: CaptureInput): Promise<CaptureOutput> {
  if (process.platform === 'win32') throw new Error('Runner cleanup requires a POSIX host');
  // Credentials never reach browser code. Filesystem/network isolation remains
  // a separate deployment requirement: this local runner only accepts fixtures.
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'PLAYWRIGHT_BROWSERS_PATH']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  const output = await runRunnerProcess(
    fileURLToPath(new URL('./runner-process.js', import.meta.url)),
    input,
    env,
    { timeoutMs: 60_000, stdoutBytes: 6 * 1024 * 1024 },
  );
  return captureOutputSchema.parse(output);
}
