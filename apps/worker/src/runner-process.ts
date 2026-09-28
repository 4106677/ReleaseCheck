import { captureFixture, captureInputSchema } from '@releasecheck/checks';

let browserPid: number | undefined;
let parentGone = false;
process.on('disconnect', () => {
  parentGone = true;
  if (browserPid) {
    try {
      process.kill(-browserPid, 'SIGKILL');
    } catch {
      /* Already closed. */
    }
    process.exitCode = 1;
  }
});
let input = '';
for await (const chunk of process.stdin) {
  input += String(chunk);
  if (input.length > 8192) throw new Error('Runner input exceeds limit');
}
if (parentGone) throw new Error('Runner supervisor disconnected');
const result = await captureFixture(captureInputSchema.parse(JSON.parse(input)), async (pid) => {
  browserPid = pid;
  if (parentGone || !process.send || !process.connected)
    throw new Error('Runner supervisor disconnected');
  await new Promise<void>((resolve, reject) =>
    process.send!({ type: 'browser-started', pid }, (error) => (error ? reject(error) : resolve())),
  );
});
if (process.connected) {
  await new Promise<void>((resolve, reject) =>
    process.send!({ type: 'browser-stopped', pid: browserPid }, (error) =>
      error ? reject(error) : resolve(),
    ),
  );
  browserPid = undefined;
  process.stdout.write(JSON.stringify(result));
  process.disconnect();
}
