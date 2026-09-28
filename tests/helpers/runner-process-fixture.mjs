import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
let input = '';
for await (const chunk of process.stdin) input += chunk;
const { mode, pidFile } = JSON.parse(input);
if (mode === 'normal') {
  process.stdout.write(JSON.stringify({ ok: true }));
  process.disconnect();
} else if (mode === 'invalid') {
  process.stdout.write('not-json');
  process.disconnect();
} else if (mode === 'stderr') {
  process.stderr.write('DO_NOT_EXPOSE_SECRET');
  process.exit(1);
} else {
  const browser = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    detached: true,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  await writeFile(pidFile, String(browser.pid));
  await new Promise((resolve, reject) =>
    process.send({ type: 'browser-started', pid: browser.pid }, (error) =>
      error ? reject(error) : resolve(),
    ),
  );
  if (mode === 'exit') process.exit(1);
  if (mode === 'overflow') process.stdout.write('🙂'.repeat(400));
  setInterval(() => {}, 1000);
}
