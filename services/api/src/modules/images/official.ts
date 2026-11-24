/**
 * Official product photo of an owned garment. The garment's embedding is searched among the
 * products of *authorised* catalogues (affiliate feeds / APIs with licensed images); only very
 * close matches of the same type are proposed, as "posible coincidencia", and nothing is added until
 * the user confirms it is the same product. The confirmed photo is downloaded once (SSRF-safe),
 * stored as the garment's `product_reference` image with the retailer's attribution, and can be
 * chosen as the main picture. The user's own photos are kept.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { ImageRefDto } from '@dressit/shared';
import sharp from 'sharp';
import type { AppContext } from '../../context.ts';
import { parseVector, type Tx } from '../../db/index.ts';
import { badRequest, notFound } from '../../lib/errors.ts';
import { safeFetch } from '../../lib/safe-fetch.ts';
import { nearestProducts } from '../catalog/service.ts';
import { imageRef } from '../wardrobe/mappers.ts';
import { dHash } from './service.ts';
import { sql } from 'kysely';

/** Same product (not just similar): calibrated against the fixture catalogue; see docs. */
export const OFFICIAL_MIN_SIMILARITY = 0.9;

export interface OfficialMatch {
  productId: string;
  title: string;
  retailer: string;
  imageUrl: string;
  similarity: number;
  url: string | null;
}

export async function officialMatches(trx: Tx, garmentId: string): Promise<{ matches: OfficialMatch[]; message: string }> {
  const g = await trx.selectFrom('garments').select(['id', 'category', 'subcategory']).where('id', '=', garmentId).executeTakeFirst();
  if (!g) throw notFound('Prenda');
  const emb = await trx.selectFrom('garment_embeddings').select(sql<string | null>`embedding::text`.as('e')).where('garment_id', '=', garmentId).executeTakeFirst();
  const vector = parseVector(emb?.e ?? null);
  if (!vector) return { matches: [], message: 'Esta prenda todavía no tiene análisis visual.' };
  const total = await trx.selectFrom('catalog_products').select((eb) => eb.fn.countAll<number>().as('n')).where('is_active', '=', true).executeTakeFirst();
  if (!Number(total?.n)) return { matches: [], message: 'No hay catálogos de tiendas autorizados conectados, así que no podemos buscar la foto oficial.' };
  const near = (await nearestProducts(trx, vector, 8, g.category)).filter((n) => n.cos >= OFFICIAL_MIN_SIMILARITY);
  if (!near.length) return { matches: [], message: 'No hemos encontrado este producto en los catálogos conectados.' };
  const rows = await trx
    .selectFrom('catalog_products as p')
    .innerJoin('retailers as r', 'r.id', 'p.retailer_id')
    .innerJoin('product_images as i', (j) => j.onRef('i.product_id', '=', 'p.id').on('i.license', '=', 'licensed'))
    .select(['p.id', 'p.title', 'p.subcategory', 'p.product_url', 'r.name as retailer', 'i.url as image_url', 'i.position'])
    .where('p.id', 'in', near.map((n) => n.id))
    .orderBy('i.position')
    .execute();
  const seen = new Set<string>();
  const matches: OfficialMatch[] = [];
  for (const n of near) {
    const r = rows.find((x) => x.id === n.id && (!x.subcategory || x.subcategory === g.subcategory));
    if (!r || seen.has(r.id)) continue;
    seen.add(r.id);
    matches.push({ productId: r.id, title: r.title, retailer: r.retailer, imageUrl: r.image_url, similarity: Math.round(n.cos * 1000) / 1000, url: r.product_url });
  }
  return { matches: matches.slice(0, 4), message: matches.length ? 'Posibles coincidencias: confirma solo si es exactamente tu prenda.' : 'No hemos encontrado este producto en los catálogos conectados.' };
}

/** The user confirmed the product: store its licensed photo as the garment's official picture. */
export async function addOfficialImage(ctx: AppContext, trx: Tx, userId: string, garmentId: string, productId: string): Promise<ImageRefDto> {
  const { matches } = await officialMatches(trx, garmentId);
  const m = matches.find((x) => x.productId === productId);
  if (!m) throw badRequest('Ese producto no es una coincidencia de esta prenda.');
  const res = await safeFetch(m.imageUrl, {
    userAgent: ctx.cfg.LINK_IMPORT_USER_AGENT,
    timeoutMs: ctx.cfg.LINK_IMPORT_TIMEOUT_MS,
    maxBytes: 8_000_000,
    allowedContentTypes: /^image\//,
    accept: 'image/*',
    allowPrivate: ctx.cfg.LINK_IMPORT_ALLOW_PRIVATE,
  });
  const normalized = await sharp(res.raw).rotate().resize(2048, 2048, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer({ resolveWithObject: true });
  const thumb = await sharp(normalized.data).resize(480, 480, { fit: 'inside' }).webp({ quality: 82 }).toBuffer();
  const id = randomUUID();
  const key = `u/${userId}/${id}/official.jpg`;
  const thumbKey = `u/${userId}/${id}/thumb.webp`;
  await ctx.storage.put(key, normalized.data, 'image/jpeg');
  await ctx.storage.put(thumbKey, thumb, 'image/webp');
  await trx
    .insertInto('garment_images')
    .values({
      id,
      user_id: userId,
      garment_id: garmentId,
      kind: 'product_reference',
      storage_key: key,
      thumb_storage_key: thumbKey,
      mime: 'image/jpeg',
      width: normalized.info.width,
      height: normalized.info.height,
      bytes: normalized.data.length,
      sha256: createHash('sha256').update(normalized.data).digest('hex'),
      phash: await dHash(normalized.data),
      license: 'retailer_licensed',
      attribution: `Foto oficial de ${m.retailer}`,
      source_url: m.url ?? m.imageUrl,
    })
    .execute();
  const img = await trx.selectFrom('garment_images').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  return imageRef(ctx.signer, userId, img);
}
