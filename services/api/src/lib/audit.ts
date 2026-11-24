import type { Tx } from '../db/index.ts';

/** Append-only audit trail of security- and privacy-relevant actions (no payload PII). */
export async function audit(trx: Tx, userId: string | null, action: string, entity?: { type: string; id: string }, metadata: Record<string, unknown> = {}) {
  await trx
    .insertInto('audit_events')
    .values({ user_id: userId, actor: userId ? 'user' : 'system', action, entity: entity?.type ?? null, entity_id: entity?.id ?? null, metadata: JSON.stringify(metadata) })
    .execute();
}
