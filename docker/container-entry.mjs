import { captureFixture, captureInputSchema } from '@releasecheck/checks';
import { createFixtureServer } from './fixtures/demo-site/dist/server.js';

// A kernel/container lifetime bound is still required if this timer cannot run.
const deadline = setTimeout(() => process.exit(124), 60_000);
let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
  if (Buffer.byteLength(input) > 8192) throw new Error('Runner input exceeds limit');
}
const request = captureInputSchema.parse(JSON.parse(input));
if (request.fixtureOrigin !== 'http://127.0.0.1:4174')
  throw new Error('Container fixture origin must use port 4174');
const fixture = createFixtureServer();
await new Promise((resolve, reject) => {
  fixture.once('error', reject);
  fixture.listen(4174, '127.0.0.1', resolve);
});
try {
  const output = await captureFixture(request);
  process.stdout.write(JSON.stringify(output));
} finally {
  fixture.closeAllConnections();
  await new Promise((resolve) => fixture.close(resolve));
  clearTimeout(deadline);
}
