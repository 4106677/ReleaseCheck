import { createFixtureServer } from './server.js';
const server = createFixtureServer();
server.listen(Number(process.env.FIXTURE_PORT ?? 4174), '127.0.0.1', () =>
  console.log('ReleaseCheck fixture ready.'),
);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => server.close());
