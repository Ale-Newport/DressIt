/** Applies the data-retention rules (schedule daily). See src/modules/maintenance/retention.ts. */
import pg from 'pg';
import { loadConfig } from '../src/config.ts';
import { createStorage } from '../src/lib/storage.ts';
import { runRetention } from '../src/modules/maintenance/retention.ts';

const cfg = loadConfig();
const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error('Falta DATABASE_ADMIN_URL');
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  console.log('Retención aplicada:', await runRetention(client, createStorage(cfg)));
} finally {
  await client.end();
}
