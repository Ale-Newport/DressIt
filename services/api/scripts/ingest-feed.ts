/**
 * Ingests AUTHORISED affiliate product feeds (Awin "productdata" CSV/CSV.GZ) into the
 * catalog, then computes visual embeddings for products with licensed images.
 *
 *   pnpm --filter @dressit/api catalog:ingest -- --retailer decathlon --feed <url-or-path> [--network awin] [--sponsored]
 *
 * Without arguments it uses AWIN_FEED_URLS (format: retailerId=url,retailerId=url).
 * Only use feeds you are authorised to use under the network/advertiser terms.
 */
import { parseArgs } from 'node:util';
import { loadConfig } from '../src/config.ts';
import { createDb, toVectorLiteral } from '../src/db/index.ts';
import { readFeed } from '../src/modules/catalog/providers.ts';
import { upsertFeedProducts } from '../src/modules/catalog/service.ts';
import { syncRetailers } from '../src/modules/retail/sync.ts';
import { VisionClient } from '../src/modules/vision/client.ts';
import { safeFetch } from '../src/lib/safe-fetch.ts';

const { values } = parseArgs({ options: { retailer: { type: 'string' }, feed: { type: 'string' }, network: { type: 'string', default: 'awin' }, sponsored: { type: 'boolean', default: false }, 'no-embeddings': { type: 'boolean', default: false } } });
const cfg = loadConfig();
const { db } = createDb(process.env.DATABASE_ADMIN_URL ?? cfg.DATABASE_URL, 4);
await syncRetailers(db);
const vision = new VisionClient(cfg.VISION_SERVICE_URL, cfg.VISION_TIMEOUT_MS);

const jobs: Array<{ retailer: string; feed: string }> = values.retailer && values.feed
  ? [{ retailer: values.retailer, feed: values.feed }]
  : (cfg.AWIN_FEED_URLS ?? '').split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
      const [retailer, ...rest] = s.split('=');
      return { retailer: retailer!, feed: rest.join('=') };
    });
if (!jobs.length) {
  console.error('No hay feeds autorizados configurados. Usa --retailer y --feed, o AWIN_FEED_URLS=retailer=url,...');
  process.exit(1);
}

for (const job of jobs) {
  const retailer = await db.selectFrom('retailers').select('id').where('id', '=', job.retailer).executeTakeFirst();
  if (!retailer) throw new Error(`Tienda desconocida: ${job.retailer}`);
  const integration = await db.selectFrom('retailer_integrations').select('id').where('retailer_id', '=', job.retailer).where('kind', '=', 'affiliate_feed').executeTakeFirst();
  const run = await db.insertInto('catalog_sync_runs').values({ integration_id: integration?.id ?? null, source: job.feed.replace(/\/apikey\/[^/]+/, '/apikey/***'), status: 'running' }).returning('id').executeTakeFirstOrThrow();
  try {
    const products = await readFeed(job.feed);
    console.log(`${job.retailer}: ${products.length} productos en el feed`);
    const seen = new Set(products.map((p) => p.externalId));
    const res = await upsertFeedProducts(db, job.retailer, integration?.id ?? null, values.network!, products, values.sponsored);
    // Products no longer in the feed are deactivated (never shown as available).
    const stale = await db.selectFrom('catalog_products').select(['id', 'external_id']).where('retailer_id', '=', job.retailer).where('is_active', '=', true).execute();
    const gone = stale.filter((s) => !seen.has(s.external_id)).map((s) => s.id);
    if (gone.length) await db.updateTable('catalog_products').set({ is_active: false }).where('id', 'in', gone).execute();
    let embedded = 0;
    if (!values['no-embeddings']) {
      for (const p of res.needEmbedding) {
        try {
          const img = await safeFetch(p.imageUrl, { userAgent: cfg.LINK_IMPORT_USER_AGENT, timeoutMs: 15_000, maxBytes: 8_000_000, respectRobots: false, accept: 'image/*', allowedContentTypes: /^image\// });
          const e = await vision.embedImage(img.raw, img.contentType);
          await db.insertInto('product_embeddings').values({ product_id: p.id, model: e.model, image_url: p.imageUrl, embedding: toVectorLiteral(e.embedding) }).onConflict((oc) => oc.column('product_id').doNothing()).execute();
          embedded++;
        } catch (err) {
          console.warn(`  sin embedding para ${p.id}: ${(err as Error).message}`);
        }
      }
    }
    if (integration) await db.updateTable('retailer_integrations').set({ status: 'operational', last_checked_at: new Date(), last_check_result: `Feed ingerido: ${res.upserted} productos, ${embedded} con análisis visual` }).where('id', '=', integration.id).execute();
    await db.updateTable('catalog_sync_runs').set({ status: 'completed', finished_at: new Date(), stats: JSON.stringify({ products: products.length, upserted: res.upserted, deactivated: gone.length, embedded }) }).where('id', '=', run.id).execute();
    console.log(`✓ ${job.retailer}: ${res.upserted} actualizados, ${gone.length} desactivados, ${embedded} embeddings`);
  } catch (err) {
    await db.updateTable('catalog_sync_runs').set({ status: 'failed', finished_at: new Date(), error: (err as Error).message }).where('id', '=', run.id).execute();
    console.error(`✗ ${job.retailer}: ${(err as Error).message}`);
  }
}
await db.destroy();
