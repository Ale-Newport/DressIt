import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely';
import pg from 'pg';
import type { DB } from './types.ts';

// numeric → number, date → 'YYYY-MM-DD' string (no timezone shifts), vector → number[]
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number.parseFloat(v)));
pg.types.setTypeParser(1082, (v) => v);

export type Database = Kysely<DB>;
export type Tx = Transaction<DB>;
export type { DB };

export function createDb(connectionString: string, max = 10): { db: Database; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString, max, idleTimeoutMillis: 30_000, application_name: 'dressit-api' });
  const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
  return { db, pool };
}

/**
 * Runs `fn` in a transaction scoped to a user: sets `app.user_id` so that every
 * row-level-security policy applies. All access to personal data goes through here.
 */
export async function withUser<T>(db: Database, userId: string, fn: (trx: Tx) => Promise<T>): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await sql`select set_config('app.user_id', ${userId}, true)`.execute(trx);
    return fn(trx);
  });
}

export function toVectorLiteral(v: ArrayLike<number>): string {
  return `[${Array.from(v, (x) => (Number.isFinite(x) ? x : 0)).join(',')}]`;
}

export function parseVector(v: unknown): number[] | null {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.map(Number);
  if (typeof v === 'string') return v.slice(1, -1).split(',').filter(Boolean).map(Number);
  return null;
}

export { sql };
