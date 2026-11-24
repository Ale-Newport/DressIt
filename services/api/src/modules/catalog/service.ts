import { sql, type Selectable } from 'kysely';
import { colorFamilyFromText, type CatalogSearchQuery, type Paginated, type ProductSummaryDto } from '@dressit/shared';
import type { Database, Tx } from '../../db/index.ts';
import { toVectorLiteral } from '../../db/index.ts';
import type { ImportedProducts } from '../../db/types.ts';
import { notFound } from '../../lib/errors.ts';
import { inferMaterials, inferSubcategory } from '../retail/categorize.ts';
import type { FeedProduct, Provenance } from './sources/types.ts';
import { RETAILERS } from '../retail/registry.ts';

export interface CatalogRow {
  id: string;
  retailer_id: string;
  retailer_name: string;
  group_name: string | null;
  title: string;
  brand: string | null;
  category: string | null;
  subcategory: string | null;
  color_name: string | null;
  color_family: string | null;
  product_url: string;
  is_sponsored: boolean;
  last_verified_at: Date | null;
  price_cents: number | null;
  original_price_cents: number | null;
  currency: string | null;
  availability: string | null;
  image_url: string | null;
  affiliate_url: string | null;
  sizes: Array<{ label: string; available: boolean | null }> | null;
  materials: string[];
  styles: string[];
}

export function catalogBase(db: Database | Tx) {
  return db
    .selectFrom('catalog_products as p')
    .innerJoin('retailers as r', 'r.id', 'p.retailer_id')
    .select([
      'p.id',
      'p.retailer_id',
      'r.name as retailer_name',
      'r.group_name',
      'p.title',
      'p.brand',
      'p.category',
      'p.subcategory',
      'p.color_name',
      'p.color_family',
      'p.product_url',
      'p.is_sponsored',
      'p.last_verified_at',
      'p.materials',
      'p.styles',
      sql<number | null>`(select price_cents from product_prices pp where pp.product_id = p.id order by observed_at desc limit 1)`.as('price_cents'),
      sql<number | null>`(select original_price_cents from product_prices pp where pp.product_id = p.id order by observed_at desc limit 1)`.as('original_price_cents'),
      sql<string | null>`(select currency from product_prices pp where pp.product_id = p.id order by observed_at desc limit 1)`.as('currency'),
      sql<string | null>`(select availability from product_availability pa where pa.product_id = p.id order by observed_at desc limit 1)`.as('availability'),
      sql<string | null>`(select url from product_images pi where pi.product_id = p.id and pi.license = 'licensed' order by position limit 1)`.as('image_url'),
      sql<string | null>`(select url from affiliate_links al where al.product_id = p.id limit 1)`.as('affiliate_url'),
      sql<Array<{ label: string; available: boolean | null }> | null>`(select json_agg(json_build_object('label', size_label, 'available', null)) from product_variants pv where pv.product_id = p.id and size_label is not null)`.as('sizes'),
    ])
    .where('p.is_active', '=', true);
}

export function catalogDto(r: CatalogRow, freshnessHours: number): ProductSummaryDto {
  const verifiedAt = r.last_verified_at;
  const isStale = !verifiedAt || Date.now() - verifiedAt.getTime() > freshnessHours * 3600_000;
  const price = r.price_cents !== null ? { cents: r.price_cents, currency: r.currency ?? 'EUR' } : null;
  const original = r.original_price_cents !== null && price && r.original_price_cents > price.cents ? { cents: r.original_price_cents, currency: price.currency } : null;
  return {
    id: r.id,
    kind: 'catalog',
    retailer: { id: r.retailer_id, name: r.retailer_name, group: r.group_name },
    brand: r.brand,
    title: r.title,
    category: (r.category as ProductSummaryDto['category']) ?? null,
    subcategory: r.subcategory,
    colorName: r.color_name,
    colorFamily: r.color_family,
    price,
    originalPrice: original,
    discountPercent: original && price ? Math.round((1 - price.cents / original.cents) * 100) : null,
    sizes: r.sizes ?? [],
    availability: (r.availability as ProductSummaryDto['availability']) ?? 'unknown',
    image: r.image_url ? { id: `${r.id}:img`, url: r.image_url, thumbUrl: r.image_url, width: null, height: null, isCutout: false, license: 'retailer_licensed', attribution: `Imagen: ${r.retailer_name}` } : null,
    productUrl: r.product_url,
    verifiedAt: verifiedAt?.toISOString() ?? null,
    isStale,
    isSponsored: r.is_sponsored,
    isAffiliate: !!r.affiliate_url,
  };
}

/** Imported (link/capture) products as product summaries — always the user's own. */
export function importedSummary(row: Selectable<ImportedProducts>, freshnessHours: number): ProductSummaryDto {
  const d = row.data as Record<string, { value: unknown; source: string } | undefined>;
  const retailer = RETAILERS.find((r) => r.id === row.retailer_id);
  const price = (d.price?.value as { cents: number; currency: string } | undefined) ?? null;
  const orig = (d.originalPrice?.value as { cents: number; currency: string } | undefined) ?? null;
  const isStale = !row.verified_at || Date.now() - row.verified_at.getTime() > freshnessHours * 3600_000;
  const imgs = row.image_policy === 'none' ? [] : row.image_urls;
  return {
    id: row.id,
    kind: 'imported',
    retailer: retailer ? { id: retailer.id, name: retailer.name, group: retailer.group } : { id: 'desconocida', name: new URL(row.url).hostname.replace(/^www\./, ''), group: null },
    brand: (d.brand?.value as string) ?? null,
    title: (d.title?.value as string) ?? 'Producto sin título',
    category: (d.category?.value as ProductSummaryDto['category']) ?? null,
    subcategory: (d.subcategory?.value as string) ?? null,
    colorName: (d.colorName?.value as string) ?? null,
    colorFamily: (d.colorFamily?.value as string) ?? null,
    price,
    originalPrice: orig && price && orig.cents > price.cents ? orig : null,
    discountPercent: orig && price && orig.cents > price.cents ? Math.round((1 - price.cents / orig.cents) * 100) : null,
    sizes: ((d.sizes?.value as string[]) ?? []).map((label) => ({ label, available: null })),
    availability: (d.availability?.value as ProductSummaryDto['availability']) ?? 'unknown',
    image: imgs[0] ? { id: `${row.id}:0`, url: imgs[0], thumbUrl: imgs[0], width: null, height: null, isCutout: false, license: 'retailer_link_preview', attribution: retailer ? `Imagen: ${retailer.name}` : null } : null,
    productUrl: row.canonical_url ?? row.url,
    verifiedAt: row.verified_at?.toISOString() ?? null,
    isStale,
    isSponsored: false,
    isAffiliate: false,
  };
}

export async function searchCatalog(db: Database | Tx, q: CatalogSearchQuery, freshnessHours: number): Promise<Paginated<ProductSummaryDto>> {
  const limit = Math.min(Math.max(q.limit ?? 30, 1), 100);
  const offset = q.cursor ? Number.parseInt(q.cursor, 10) || 0 : 0;
  let query = catalogBase(db);
  if (q.q) query = query.where(sql<boolean>`p.search_text @@ plainto_tsquery('spanish', immutable_unaccent(${q.q.slice(0, 100)}))`);
  if (q.retailer) query = query.where('p.retailer_id', '=', q.retailer);
  if (q.brand) query = query.where('p.brand', 'ilike', `%${q.brand.replace(/[%_]/g, '')}%`);
  if (q.category) query = query.where('p.category', '=', q.category);
  if (q.subcategory) query = query.where('p.subcategory', '=', q.subcategory);
  if (q.color) query = query.where('p.color_family', '=', q.color);
  if (q.style) query = query.where(sql<boolean>`${q.style} = any(p.styles)`);
  if (q.size) query = query.where(sql<boolean>`exists (select 1 from product_variants pv where pv.product_id = p.id and lower(pv.size_label) = lower(${q.size}))`);
  const priceExpr = sql<number>`(select price_cents from product_prices pp where pp.product_id = p.id order by observed_at desc limit 1)`;
  if (q.minPrice !== undefined) query = query.where(priceExpr, '>=', Math.round(q.minPrice * 100));
  if (q.maxPrice !== undefined) query = query.where(priceExpr, '<=', Math.round(q.maxPrice * 100));
  if (q.inStock) query = query.where(sql<boolean>`(select availability from product_availability pa where pa.product_id = p.id order by observed_at desc limit 1) = 'in_stock'`);
  switch (q.sort) {
    case 'price_asc':
      query = query.orderBy(priceExpr, 'asc');
      break;
    case 'price_desc':
      query = query.orderBy(priceExpr, 'desc');
      break;
    case 'newest':
      query = query.orderBy('p.first_seen_at', 'desc');
      break;
    case 'discount':
      query = query.orderBy(sql`(select (original_price_cents - price_cents)::float / nullif(original_price_cents, 0) from product_prices pp where pp.product_id = p.id order by observed_at desc limit 1)`, (ob) => ob.desc().nullsLast());
      break;
    default:
      query = q.q ? query.orderBy(sql`ts_rank(p.search_text, plainto_tsquery('spanish', immutable_unaccent(${q.q.slice(0, 100)})))`, 'desc') : query.orderBy('p.last_seen_at', 'desc');
  }
  const rows = (await query.orderBy('p.id').limit(limit + 1).offset(offset).execute()) as CatalogRow[];
  return { items: rows.slice(0, limit).map((r) => catalogDto(r, freshnessHours)), nextCursor: rows.length > limit ? String(offset + limit) : null };
}

export async function getCatalogProduct(db: Database | Tx, id: string, freshnessHours: number): Promise<ProductSummaryDto> {
  const row = (await catalogBase(db).where('p.id', '=', id).executeTakeFirst()) as CatalogRow | undefined;
  if (!row) throw notFound('Producto');
  return catalogDto(row, freshnessHours);
}

export async function catalogSize(db: Database | Tx): Promise<number> {
  const r = await db.selectFrom('catalog_products').select((eb) => eb.fn.countAll<number>().as('n')).where('is_active', '=', true).executeTakeFirst();
  return Number(r?.n ?? 0);
}

/** Upsert feed products for a retailer. Returns ids of products that need (re)embedding. */
export async function upsertFeedProducts(db: Database, retailerId: string, integrationId: string | null, network: string, products: FeedProduct[], isSponsored = false, provenance: Provenance = 'feed'): Promise<{ upserted: number; needEmbedding: Array<{ id: string; imageUrl: string }> }> {
  const now = new Date();
  const needEmbedding: Array<{ id: string; imageUrl: string }> = [];
  let upserted = 0;
  for (const p of products) {
    const guess = inferSubcategory(p.title, p.category);
    const colorFamily = colorFamilyFromText(p.colorName) ?? colorFamilyFromText(p.title);
    const row = await db
      .insertInto('catalog_products')
      .values({
        retailer_id: retailerId,
        integration_id: integrationId,
        external_id: p.externalId,
        title: p.title.slice(0, 300),
        brand: p.brand,
        description: p.description,
        category: guess?.category ?? null,
        subcategory: guess?.subcategory ?? null,
        color_name: p.colorName,
        color_family: colorFamily,
        materials: inferMaterials(p.material, p.title, p.description),
        product_url: p.productUrl,
        is_sponsored: isSponsored,
        data_quality: (p.priceCents ? 0.3 : 0) + (p.imageUrls.length ? 0.3 : 0) + (guess ? 0.2 : 0) + (colorFamily ? 0.2 : 0),
        last_seen_at: now,
        last_verified_at: now,
        is_active: true,
      })
      .onConflict((oc) =>
        oc.columns(['retailer_id', 'external_id']).doUpdateSet((eb) => ({
          integration_id: eb.ref('excluded.integration_id'),
          title: eb.ref('excluded.title'),
          brand: eb.ref('excluded.brand'),
          description: eb.ref('excluded.description'),
          category: eb.ref('excluded.category'),
          subcategory: eb.ref('excluded.subcategory'),
          color_name: eb.ref('excluded.color_name'),
          color_family: eb.ref('excluded.color_family'),
          materials: eb.ref('excluded.materials'),
          product_url: eb.ref('excluded.product_url'),
          data_quality: eb.ref('excluded.data_quality'),
          last_seen_at: now,
          last_verified_at: now,
          is_active: true,
        })),
      )
      .returning('id')
      .executeTakeFirstOrThrow();
    if (p.priceCents !== null) {
      await db.insertInto('product_prices').values({ product_id: row.id, price_cents: p.priceCents, original_price_cents: p.originalPriceCents, currency: p.currency, source: provenance, observed_at: now }).execute();
    }
    await db.insertInto('product_availability').values({ product_id: row.id, availability: p.inStock === true ? 'in_stock' : p.inStock === false ? 'out_of_stock' : 'unknown', source: provenance, observed_at: now }).execute();
    for (const [i, url] of p.imageUrls.entries()) {
      await db.insertInto('product_images').values({ product_id: row.id, url, position: i, license: 'licensed', attribution: p.brand ?? null }).onConflict((oc) => oc.columns(['product_id', 'url']).doNothing()).execute();
    }
    for (const s of p.sizes) {
      await db
        .insertInto('product_variants')
        .values({ product_id: row.id, external_variant_id: `${p.externalId}:${s.label}`, size_label: s.label, color_name: p.colorName, gtin: p.gtin && /^\d{8,14}$/.test(p.gtin) ? p.gtin.padStart(13, '0') : null })
        .onConflict((oc) => oc.columns(['product_id', 'external_variant_id']).doNothing())
        .execute();
    }
    if (p.affiliateUrl) {
      await db.insertInto('affiliate_links').values({ product_id: row.id, network, url: p.affiliateUrl }).onConflict((oc) => oc.columns(['product_id', 'network']).doUpdateSet({ url: p.affiliateUrl! })).execute();
    }
    const hasEmb = await db.selectFrom('product_embeddings').select('product_id').where('product_id', '=', row.id).executeTakeFirst();
    if (!hasEmb && p.imageUrls[0]) needEmbedding.push({ id: row.id, imageUrl: p.imageUrls[0] });
    upserted++;
  }
  return { upserted, needEmbedding };
}

export async function nearestProducts(db: Database | Tx, embedding: number[], limit: number, category?: string): Promise<Array<{ id: string; cos: number }>> {
  let q = db
    .selectFrom('product_embeddings as e')
    .innerJoin('catalog_products as p', 'p.id', 'e.product_id')
    .select(['e.product_id as id', sql<number>`1 - (e.embedding <=> ${toVectorLiteral(embedding)}::vector)`.as('cos')])
    .where('p.is_active', '=', true);
  if (category) q = q.where('p.category', '=', category);
  return q.orderBy(sql`e.embedding <=> ${toVectorLiteral(embedding)}::vector`).limit(limit).execute();
}
