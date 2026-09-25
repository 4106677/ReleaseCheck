import { createPool } from './index.js';
import { migrate } from './migrate.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = createPool(process.env.DATABASE_URL);
try {
  await migrate(pool);
  console.log('ReleaseCheck migrations applied.');
} finally {
  await pool.end();
}
