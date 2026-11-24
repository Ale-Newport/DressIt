/**
 * Runs one ingestion job from an official source (see ./sources) into the catalog:
 * records a catalog_sync_runs row (with a secret-free label), upserts products with their
 * provenance (`feed` | `api`), deactivates products that disappeared from THIS integration's
 * data, and updates the integration status that /v1/retailers reports.
 */
import type { Database } from '../../db/index.ts';
import { upsertFeedProducts } from './service.ts';
import type { IngestJob } from './sources/types.ts';

export interface IngestResult {
  retailerId: string;
  label: string;
  ok: boolean;
  products: number;
  upserted: number;
  deactivated: number;
  warnings: string[];
  error: string | null;
  needEmbedding: Array<{ id: string; imageUrl: string }>;
  integrationId: string | null;
}

/** Finds (or creates) the retailer_integrations row for this provider so status can be reported. */
export async function ensureIntegration(db: Database, retailerId: string, provider: string): Promise<string | null> {
  const found = await db.selectFrom('retailer_integrations').select('id').where('retailer_id', '=', retailerId).where('kind', '=', 'affiliate_feed').where('provider', '=', provider).executeTakeFirst();
  if (found) return found.id;
  const retailer = await db.selectFrom('retailers').select('id').where('id', '=', retailerId).executeTakeFirst();
  if (!retailer) return null;
  const row = await db
    .insertInto('retailer_integrations')
    .values({ retailer_id: retailerId, kind: 'affiliate_feed', provider, status: 'pending_authorization', image_policy: 'licensed', capabilities: JSON.stringify({ catalogSearch: true, prices: true, availability: true, images: true, affiliateLinks: true, visualSearch: true }), notes: `Integración creada por la ingesta de ${provider}.` })
    .onConflict((oc) => oc.columns(['retailer_id', 'kind', 'provider']).doNothing())
    .returning('id')
    .executeTakeFirst();
  return row?.id ?? null;
}

export async function runIngestJob(db: Database, job: IngestJob, opts: { sponsored?: boolean } = {}): Promise<IngestResult> {
  const retailer = await db.selectFrom('retailers').select('id').where('id', '=', job.retailerId).executeTakeFirst();
  const base = { retailerId: job.retailerId, label: job.label, products: 0, upserted: 0, deactivated: 0, warnings: [] as string[], needEmbedding: [] as IngestResult['needEmbedding'] };
  if (!retailer) return { ...base, ok: false, error: `Tienda desconocida: ${job.retailerId} (revisa el mapeo tienda=ID)`, integrationId: null };
  const integrationId = await ensureIntegration(db, job.retailerId, job.provider);
  const run = await db.insertInto('catalog_sync_runs').values({ integration_id: integrationId, source: job.label.slice(0, 500), status: 'running' }).returning('id').executeTakeFirstOrThrow();
  try {
    const { products, warnings } = await job.fetch();
    // An empty download is far more likely an access/format problem than a store with no products:
    // never deactivate the whole catalogue because of it.
    if (!products.length) throw new Error('La fuente no devolvió ningún producto válido (¿programa aún no aprobado o feed vacío?). No se ha desactivado nada.');
    const seen = new Set(products.map((p) => p.externalId));
    const res = await upsertFeedProducts(db, job.retailerId, integrationId, job.network, products, opts.sponsored ?? false, job.provenance);
    let active = db.selectFrom('catalog_products').select(['id', 'external_id']).where('retailer_id', '=', job.retailerId).where('is_active', '=', true);
    active = integrationId ? active.where('integration_id', '=', integrationId) : active.where('integration_id', 'is', null);
    const gone = (await active.execute()).filter((s) => !seen.has(s.external_id)).map((s) => s.id);
    if (gone.length) await db.updateTable('catalog_products').set({ is_active: false }).where('id', 'in', gone).execute();
    if (integrationId) {
      await db
        .updateTable('retailer_integrations')
        .set({ status: 'operational', last_checked_at: new Date(), last_check_result: `Ingesta correcta (${job.provenance === 'api' ? 'API oficial' : 'feed'}): ${res.upserted} productos` })
        .where('id', '=', integrationId)
        .execute();
    }
    await db
      .updateTable('catalog_sync_runs')
      .set({ status: 'completed', finished_at: new Date(), stats: JSON.stringify({ source: job.sourceId, provenance: job.provenance, products: products.length, upserted: res.upserted, deactivated: gone.length, warnings }) })
      .where('id', '=', run.id)
      .execute();
    return { ...base, ok: true, products: products.length, upserted: res.upserted, deactivated: gone.length, warnings, error: null, needEmbedding: res.needEmbedding, integrationId };
  } catch (err) {
    const message = (err as Error).message.slice(0, 1000);
    await db.updateTable('catalog_sync_runs').set({ status: 'failed', finished_at: new Date(), error: message, stats: JSON.stringify({ source: job.sourceId, provenance: job.provenance }) }).where('id', '=', run.id).execute();
    if (integrationId) await db.updateTable('retailer_integrations').set({ last_checked_at: new Date(), last_check_result: `Error en la última ingesta: ${message}` }).where('id', '=', integrationId).execute();
    return { ...base, ok: false, error: message, integrationId };
  }
}
