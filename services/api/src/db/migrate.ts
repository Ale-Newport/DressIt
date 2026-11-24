/**
 * Minimal, transactional SQL migration runner.
 * Uses DATABASE_ADMIN_URL (table owner). Each file in /migrations runs once, in order.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import pg from 'pg';

export async function migrate(connectionString: string, log: (m: string) => void = console.log): Promise<string[]> {
  const dir = resolve(import.meta.dirname, '../../migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const client = new pg.Client({ connectionString });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query(`create table if not exists schema_migrations (
      name text primary key, checksum text not null, applied_at timestamptz not null default now())`);
    await client.query('select pg_advisory_lock(727274)');
    const done = new Map((await client.query<{ name: string; checksum: string }>('select name, checksum from schema_migrations')).rows.map((r) => [r.name, r.checksum]));
    for (const file of files) {
      const sql = readFileSync(resolve(dir, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      if (done.has(file)) {
        if (done.get(file) !== checksum) throw new Error(`La migración ${file} ya aplicada ha cambiado (checksum distinto). Crea una nueva migración.`);
        continue;
      }
      log(`→ aplicando ${file}`);
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into schema_migrations(name, checksum) values ($1, $2)', [file, checksum]);
        await client.query('commit');
        applied.push(file);
      } catch (err) {
        await client.query('rollback');
        throw new Error(`Error en ${file}: ${(err as Error).message}`);
      }
    }
    await client.query('select pg_advisory_unlock(727274)');
  } finally {
    await client.end();
  }
  return applied;
}

if (import.meta.main) {
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) {
    console.error('Falta DATABASE_ADMIN_URL');
    process.exit(1);
  }
  migrate(url)
    .then((a) => console.log(a.length ? `✓ ${a.length} migración(es) aplicada(s)` : '✓ Esquema al día'))
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
