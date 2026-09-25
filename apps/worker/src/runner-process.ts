import { captureFixture, captureInputSchema } from '@releasecheck/checks';

let input = '';
for await (const chunk of process.stdin) {
  input += String(chunk);
  if (input.length > 8192) throw new Error('Runner input exceeds limit');
}
const result = await captureFixture(captureInputSchema.parse(JSON.parse(input)));
process.stdout.write(JSON.stringify(result));
