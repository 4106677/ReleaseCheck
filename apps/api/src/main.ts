import { createPool, Repository } from '@releasecheck/db';
import { LocalStorage } from '@releasecheck/storage';
import { buildApp } from './app.js';

if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test')
  throw new Error(
    'API is local-only until authentication is implemented. Set NODE_ENV=development.',
  );
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = createPool(process.env.DATABASE_URL);
const app = buildApp(
  new Repository(pool),
  new LocalStorage(process.env.ARTIFACT_DIR ?? '.artifacts'),
  process.env.FIXTURE_ORIGIN ?? 'http://127.0.0.1:4174',
  true,
);
app.addHook('onClose', async () => {
  await pool.end();
});
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void app.close();
  });
await app.listen({ host: '127.0.0.1', port: Number(process.env.API_PORT ?? 3001) });
