/**
 * Ingests product data from AUTHORISED official sources into the catalog, then computes visual
 * embeddings for products with licensed images.
 *
 *   pnpm --filter @dressit/api catalog:ingest                         # every configured source
 *   pnpm --filter @dressit/api catalog:ingest -- --source rakuten      # only one source
 *   pnpm --filter @dressit/api catalog:ingest -- --status              # show what is configured, ingest nothing
 *   pnpm --filter @dressit/api catalog:ingest -- --retailer decathlon --feed <awin-csv-url-or-path> [--sponsored]
 *
 * Sources (see .env.example and docs/conectar-tiendas.md):
 *   awin_feed      Awin Create-a-Feed CSV (AWIN_FEED_URLS) + automatic feed list (AWIN_PUBLISHER_ID + AWIN_PRODUCTDATA_API_KEY)
 *   awin_enhanced  Awin Enhanced feeds API (AWIN_PUBLISHER_ID + AWIN_API_TOKEN + AWIN_ADVERTISERS)
 *   rakuten        Rakuten Advertising Product Search API (RAKUTEN_* + RAKUTEN_ADVERTISERS)
 *   tradedoubler   Tradedoubler Products API (TRADEDOUBLER_PRODUCTS_TOKEN + TRADEDOUBLER_FEEDS)
 *   cj             CJ Product Feed GraphQL API (CJ_* + CJ_ADVERTISERS)
 * Only use data you are authorised to use under each network's and advertiser's terms.
 */
import { parseArgs } from 'node:util';
import { loadConfig } from '../src/config.ts';
import { createDb, toVectorLiteral } from '../src/db/index.ts';
import { createCatalogProviders, readFeed } from '../src/modules/catalog/providers.ts';
import { runIngestJob } from '../src/modules/catalog/ingest.ts';
import type { IngestJob } from '../src/modules/catalog/sources/types.ts';
import { redactUrl } from '../src/modules/catalog/sources/http.ts';
import { syncRetailers } from '../src/modules/retail/sync.ts';
import { VisionClient } from '../src/modules/vision/client.ts';
import { safeFetch } from '../src/lib/safe-fetch.ts';

const { values } = parseArgs({
  // `pnpm … catalog:ingest -- --source x` forwards the literal `--`; ignore it.
  args: process.argv.slice(2).filter((a, i) => !(i === 0 && a === '--')),
  options: {
    source: { type: 'string' },
    retailer: { type: 'string' },
    feed: { type: 'string' },
    sponsored: { type: 'boolean', default: false },
    status: { type: 'boolean', default: false },
    'no-embeddings': { type: 'boolean', default: false },
  },
});
const cfg = loadConfig();
const providers = createCatalogProviders(cfg);

if (values.status) {
  for (const s of providers.sources) {
    const missing = s.missing();
    console.log(`${missing.length ? '·' : '✓'} ${s.id.padEnd(14)} ${s.name}${missing.length ? ` — faltan: ${missing.join(', ')}` : ' — credenciales presentes'}`);
  }
  process.exit(0);
}

const { db } = createDb(process.env.DATABASE_ADMIN_URL ?? cfg.DATABASE_URL, 4);
await syncRetailers(db);
const vision = new VisionClient(cfg.VISION_SERVICE_URL, cfg.VISION_TIMEOUT_MS);

let jobs: IngestJob[] = [];
if (values.retailer && values.feed) {
  const feed = values.feed;
  jobs = [{ sourceId: 'awin_feed', provider: 'awin', network: 'awin', provenance: 'feed', retailerId: values.retailer, label: `awin:${redactUrl(feed)}`, fetch: async () => ({ products: await readFeed(feed), warnings: [] }) }];
} else {
  const selected = providers.sources.filter((s) => !values.source || s.id === values.source || s.provider === values.source);
  if (values.source && !selected.length) {
    console.error(`Fuente desconocida: ${values.source}. Usa una de: ${providers.sources.map((s) => s.id).join(', ')}`);
    process.exit(1);
  }
  for (const s of selected) {
    if (s.missing().length) {
      console.log(`· ${s.id}: sin credenciales (${s.missing().join(', ')}), se omite`);
      continue;
    }
    try {
      jobs.push(...(await s.jobs()));
    } catch (err) {
      console.error(`✗ ${s.id}: no se pudo preparar la ingesta: ${(err as Error).message}`);
    }
  }
}
if (!jobs.length) {
  console.error('No hay ninguna fuente autorizada configurada con tiendas asignadas. Consulta docs/conectar-tiendas.md (o ejecuta con --status).');
  await db.destroy();
  process.exit(1);
}

let failures = 0;
for (const job of jobs) {
  const res = await runIngestJob(db, job, { sponsored: values.sponsored });
  for (const w of res.warnings) console.warn(`  ⚠ ${job.retailerId}: ${w}`);
  if (!res.ok) {
    failures++;
    console.error(`✗ ${job.retailerId} (${job.label}): ${res.error}`);
    continue;
  }
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
  console.log(`✓ ${job.retailerId} (${job.label}): ${res.upserted} actualizados, ${res.deactivated} desactivados, ${embedded} embeddings`);
}
await db.destroy();
process.exit(failures ? 2 : 0);
