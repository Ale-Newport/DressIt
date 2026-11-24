import { sql } from 'kysely';
import {
  getColorFamily,
  getSubcategory,
  getMaterial,
  hexToLab,
  nearestColorFamily,
  GARMENT_STATUSES,
  type BulkGarmentUpdate,
  type GarmentDetailDto,
  type GarmentDto,
  type GarmentListQuery,
  type GarmentSource,
  type GarmentWriteDto,
  type Paginated,
  type WardrobeStatsDto,
  type GarmentStatus,
} from '@dressit/shared';
import { findSimilarOwned, toEngineGarment, type EngineGarment } from '@dressit/stylist-engine';
import type { Tx } from '../../db/index.ts';
import { parseVector } from '../../db/index.ts';
import { badRequest, notFound } from '../../lib/errors.ts';
import type { UrlSigner } from '../../lib/signing.ts';
import { imageRef, toGarmentDto, type GarmentRow } from './mappers.ts';

/** Base select joining the primary image and tag names. */
export function garmentSelect(trx: Tx) {
  return trx
    .selectFrom('garments as g')
    .leftJoin('garment_images as pi', 'pi.id', 'g.primary_image_id')
    .selectAll('g')
    .select([
      'pi.id as img_id',
      'pi.kind as img_kind',
      'pi.width as img_width',
      'pi.height as img_height',
      'pi.license as img_license',
      'pi.attribution as img_attribution',
      'pi.source_url as img_source_url',
      sql<string[]>`coalesce((select array_agg(t.name order by t.name) from garment_tags gt join tags t on t.id = gt.tag_id where gt.garment_id = g.id), '{}')`.as('tag_names'),
    ]);
}

export async function getDefaultWardrobeId(trx: Tx, userId: string): Promise<string> {
  const w = await trx.selectFrom('wardrobes').select('id').where('user_id', '=', userId).where('is_default', '=', true).executeTakeFirst();
  if (w) return w.id;
  const created = await trx.insertInto('wardrobes').values({ user_id: userId, name: 'Mi armario', is_default: true }).returning('id').executeTakeFirstOrThrow();
  return created.id;
}

function normalizeColors(colors: GarmentWriteDto['colors']): Array<{ hex: string; family: string; share: number }> {
  if (!colors?.length) return [];
  const total = colors.reduce((a, c) => a + (c.share ?? 1), 0) || 1;
  return colors.slice(0, 4).map((c) => ({ hex: c.hex.toLowerCase(), family: nearestColorFamily(hexToLab(c.hex)).family, share: Math.round(((c.share ?? 1) / total) * 1000) / 1000 }));
}

/** Default formality/warmth/waterproof from the vocabulary + materials when not given. */
export function resolveDefaults(input: GarmentWriteDto & { subcategory: string }) {
  const sub = getSubcategory(input.subcategory);
  if (!sub) throw badRequest(`Subcategoría desconocida: ${input.subcategory}`);
  const mats = (input.materials ?? []).map((m) => getMaterial(m)).filter((m) => m !== undefined);
  const warmthDelta = mats.length ? mats.reduce((a, m) => a + m.warmth, 0) / mats.length : 0;
  return {
    category: sub.category,
    formality: input.formality ?? sub.formality,
    warmth: input.warmth ?? Math.round(sub.clo * (1 + warmthDelta) * 100) / 100,
    waterproof: input.waterproof ?? ((sub.waterproof ?? false) || mats.some((m) => m.waterproof === true)),
  };
}

async function setTags(trx: Tx, userId: string, garmentId: string, names: string[]) {
  await trx.deleteFrom('garment_tags').where('garment_id', '=', garmentId).execute();
  const clean = [...new Set(names.map((n) => n.trim()).filter(Boolean))].slice(0, 20);
  for (const name of clean) {
    const existing = await trx.selectFrom('tags').select('id').where('user_id', '=', userId).where(sql`lower(name)`, '=', name.toLowerCase()).executeTakeFirst();
    const tagId = existing?.id ?? (await trx.insertInto('tags').values({ user_id: userId, name }).returning('id').executeTakeFirstOrThrow()).id;
    await trx.insertInto('garment_tags').values({ garment_id: garmentId, tag_id: tagId, user_id: userId }).onConflict((oc) => oc.doNothing()).execute();
  }
}

const TRACKED_ATTRIBUTES = ['category', 'subcategory', 'colors', 'pattern', 'materials', 'styles', 'seasons', 'formality', 'warmth', 'fit', 'brand', 'size', 'condition', 'waterproof'] as const;

/** Record provenance for attribute values (user corrections get confidence 1). */
export async function recordAttributes(
  trx: Tx,
  userId: string,
  garmentId: string,
  values: Partial<Record<(typeof TRACKED_ATTRIBUTES)[number], unknown>>,
  source: string,
  confidence: Partial<Record<string, number>> = {},
) {
  const entries = Object.entries(values).filter(([k, v]) => (TRACKED_ATTRIBUTES as readonly string[]).includes(k) && v !== undefined);
  if (!entries.length) return;
  await trx
    .updateTable('garment_attributes')
    .set({ is_current: false })
    .where('garment_id', '=', garmentId)
    .where('attribute', 'in', entries.map(([k]) => k))
    .execute();
  await trx
    .insertInto('garment_attributes')
    .values(entries.map(([attribute, value]) => ({ user_id: userId, garment_id: garmentId, attribute, value: JSON.stringify(value ?? null), confidence: Math.max(0, Math.min(1, confidence[attribute] ?? 1)), source, is_current: true })))
    .execute();
}

export interface CreateGarmentOptions {
  source: GarmentSource;
  sourceUrl?: string | null;
  importedProductId?: string | null;
  catalogProductId?: string | null;
  isDemo?: boolean;
  attributeSource?: string;
  confidence?: Partial<Record<string, number>>;
}

export async function createGarment(trx: Tx, userId: string, input: GarmentWriteDto, opts: CreateGarmentOptions): Promise<string> {
  if (!input.subcategory) throw badRequest('Indica el tipo de prenda (subcategoría).');
  const d = resolveDefaults({ ...input, subcategory: input.subcategory });
  if (input.category && input.category !== d.category) throw badRequest('La categoría no corresponde a la subcategoría indicada.');
  const colors = normalizeColors(input.colors);
  const wardrobeId = await getDefaultWardrobeId(trx, userId);
  const sub = getSubcategory(input.subcategory)!;
  // «Zapatillas de lona en negro»: avoids gender/number agreement errors with colour adjectives.
  const colorLabel = colors[0] ? getColorFamily(nearestColorFamily(colors[0].hex).family)?.label.toLowerCase() : null;
  const name = input.name?.trim() || (colorLabel ? `${sub.label} en ${colorLabel}` : sub.label);
  if (input.imageId) {
    const img = await trx.selectFrom('garment_images').select('id').where('id', '=', input.imageId).executeTakeFirst();
    if (!img) throw badRequest('La imagen indicada no existe.');
  }
  const row = await trx
    .insertInto('garments')
    .values({
      user_id: userId,
      wardrobe_id: wardrobeId,
      space_id: input.spaceId ?? null,
      name: name.slice(0, 120),
      category: d.category,
      subcategory: input.subcategory,
      brand: input.brand ?? null,
      model: input.model ?? null,
      size: input.size ?? null,
      colors: JSON.stringify(colors),
      primary_color: colors[0]?.family ?? null,
      pattern: input.pattern ?? null,
      materials: input.materials ?? [],
      styles: input.styles ?? [],
      seasons: input.seasons ?? [],
      occasions: input.occasions ?? [],
      formality: Math.round(d.formality),
      warmth_clo: d.warmth,
      waterproof: d.waterproof,
      fit: input.fit ?? null,
      condition: input.condition ?? null,
      favorite: input.favorite ?? false,
      notes: input.notes ?? null,
      purchase_date: input.purchaseDate ?? null,
      purchase_price_cents: input.purchasePriceCents ?? null,
      source: opts.source,
      source_url: opts.sourceUrl ?? null,
      imported_product_id: opts.importedProductId ?? null,
      catalog_product_id: opts.catalogProductId ?? null,
      is_demo: opts.isDemo ?? false,
      primary_image_id: input.imageId ?? null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  if (input.imageId) {
    await trx.updateTable('garment_images').set({ garment_id: row.id }).where((eb) => eb.or([eb('id', '=', input.imageId!), eb('parent_image_id', '=', input.imageId!)])).execute();
  }
  await trx.insertInto('garment_availability').values({ user_id: userId, garment_id: row.id, status: 'available' }).execute();
  if (input.tags?.length) await setTags(trx, userId, row.id, input.tags);
  await recordAttributes(
    trx,
    userId,
    row.id,
    { category: d.category, subcategory: input.subcategory, colors, pattern: input.pattern, materials: input.materials, styles: input.styles, seasons: input.seasons, formality: d.formality, warmth: d.warmth, fit: input.fit, brand: input.brand, size: input.size, condition: input.condition },
    opts.attributeSource ?? 'user',
    opts.confidence,
  );
  return row.id;
}

export async function updateGarment(trx: Tx, userId: string, id: string, patch: GarmentWriteDto, source = 'user'): Promise<void> {
  const current = await trx.selectFrom('garments').selectAll().where('id', '=', id).executeTakeFirst();
  if (!current) throw notFound('Prenda');
  const subcategory = patch.subcategory ?? current.subcategory;
  const sub = getSubcategory(subcategory);
  if (!sub) throw badRequest(`Subcategoría desconocida: ${subcategory}`);
  const colors = patch.colors ? normalizeColors(patch.colors) : undefined;
  const values: Record<string, unknown> = {};
  if (patch.name !== undefined) values.name = patch.name.trim().slice(0, 120) || current.name;
  if (patch.subcategory !== undefined) {
    values.subcategory = subcategory;
    values.category = sub.category;
  }
  if (patch.brand !== undefined) values.brand = patch.brand;
  if (patch.model !== undefined) values.model = patch.model;
  if (patch.size !== undefined) values.size = patch.size;
  if (colors) {
    values.colors = JSON.stringify(colors);
    values.primary_color = colors[0]?.family ?? null;
  }
  if (patch.pattern !== undefined) values.pattern = patch.pattern;
  if (patch.materials !== undefined) values.materials = patch.materials;
  if (patch.styles !== undefined) values.styles = patch.styles;
  if (patch.seasons !== undefined) values.seasons = patch.seasons;
  if (patch.occasions !== undefined) values.occasions = patch.occasions;
  if (patch.formality !== undefined) values.formality = Math.round(Math.max(0, Math.min(100, patch.formality)));
  if (patch.warmth !== undefined) values.warmth_clo = Math.max(0, Math.min(3, patch.warmth));
  else if (patch.subcategory !== undefined || patch.materials !== undefined) values.warmth_clo = resolveDefaults({ ...patch, subcategory, materials: patch.materials ?? current.materials }).warmth;
  if (patch.waterproof !== undefined) values.waterproof = patch.waterproof;
  if (patch.fit !== undefined) values.fit = patch.fit;
  if (patch.condition !== undefined) values.condition = patch.condition;
  if (patch.favorite !== undefined) values.favorite = patch.favorite;
  if (patch.spaceId !== undefined) values.space_id = patch.spaceId;
  if (patch.notes !== undefined) values.notes = patch.notes;
  if (patch.purchaseDate !== undefined) values.purchase_date = patch.purchaseDate;
  if (patch.purchasePriceCents !== undefined) values.purchase_price_cents = patch.purchasePriceCents;
  if (patch.imageId !== undefined) {
    if (patch.imageId) {
      const img = await trx.selectFrom('garment_images').select('id').where('id', '=', patch.imageId).executeTakeFirst();
      if (!img) throw badRequest('La imagen indicada no existe.');
      await trx.updateTable('garment_images').set({ garment_id: id }).where((eb) => eb.or([eb('id', '=', patch.imageId!), eb('parent_image_id', '=', patch.imageId!)])).execute();
      const cutout = await trx.selectFrom('garment_images').select('id').where('parent_image_id', '=', patch.imageId).where('kind', '=', 'cutout').executeTakeFirst();
      values.primary_image_id = cutout?.id ?? patch.imageId;
    } else values.primary_image_id = null;
  }
  if (Object.keys(values).length) await trx.updateTable('garments').set(values).where('id', '=', id).execute();
  if (patch.tags) await setTags(trx, userId, id, patch.tags);
  await recordAttributes(
    trx,
    userId,
    id,
    {
      subcategory: patch.subcategory,
      category: patch.subcategory ? sub.category : undefined,
      colors,
      pattern: patch.pattern,
      materials: patch.materials,
      styles: patch.styles,
      seasons: patch.seasons,
      formality: patch.formality,
      warmth: patch.warmth,
      fit: patch.fit,
      brand: patch.brand,
      size: patch.size,
      condition: patch.condition,
      waterproof: patch.waterproof,
    },
    source,
  );
}

export async function changeStatus(trx: Tx, userId: string, id: string, status: GarmentStatus, note?: string, lentTo?: string) {
  if (!GARMENT_STATUSES.includes(status)) throw badRequest('Estado no válido.');
  const g = await trx.selectFrom('garments').select(['id', 'status']).where('id', '=', id).executeTakeFirst();
  if (!g) throw notFound('Prenda');
  if (g.status === status && !note && !lentTo) return;
  await trx.updateTable('garment_availability').set({ ended_at: new Date() }).where('garment_id', '=', id).where('ended_at', 'is', null).execute();
  await trx.insertInto('garment_availability').values({ user_id: userId, garment_id: id, status, note: note ?? null, lent_to: lentTo ?? null }).execute();
  await trx.updateTable('garments').set({ status }).where('id', '=', id).execute();
}

export async function logWear(trx: Tx, userId: string, garmentIds: string[], date: string, outfitId: string | null, occasion: string | null) {
  if (!garmentIds.length) return;
  const found = await trx.selectFrom('garments').select('id').where('id', 'in', garmentIds).execute();
  if (found.length !== new Set(garmentIds).size) throw badRequest('Alguna prenda no existe en tu armario.');
  const existing = outfitId
    ? await trx.selectFrom('outfit_usage_history').select('id').where('outfit_id', '=', outfitId).where('worn_on', '=', date).executeTakeFirst()
    : await trx.selectFrom('outfit_usage_history').select('id').where('outfit_id', 'is', null).where('worn_on', '=', date).where('garment_ids', '=', sql<string[]>`${garmentIds}::uuid[]`).executeTakeFirst();
  if (existing) return; // idempotent
  await trx.insertInto('outfit_usage_history').values({ user_id: userId, outfit_id: outfitId, worn_on: date, garment_ids: garmentIds, occasion }).execute();
  await trx
    .updateTable('garments')
    .set((eb) => ({
      wear_count: eb('wear_count', '+', 1),
      last_worn_on: sql<string>`greatest(coalesce(last_worn_on, ${date}::date), ${date}::date)`,
    }))
    .where('id', 'in', garmentIds)
    .execute();
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function listGarments(trx: Tx, signer: UrlSigner, q: GarmentListQuery): Promise<Paginated<GarmentDto>> {
  const limit = Math.min(Math.max(q.limit ?? 60, 1), 200);
  const offset = q.cursor ? Math.max(0, Number.parseInt(q.cursor, 10) || 0) : 0;
  let query = garmentSelect(trx);
  const status = q.status ?? 'all';
  if (status !== 'all') query = query.where('g.status', '=', status);
  else query = query.where('g.status', '!=', 'retired');
  if (q.category) query = query.where('g.category', '=', q.category);
  if (q.subcategory) query = query.where('g.subcategory', '=', q.subcategory);
  if (q.color) query = query.where((eb) => eb.or([eb('g.primary_color', '=', q.color!), eb(sql`g.colors`, '@>', sql`${JSON.stringify([{ family: q.color }])}::jsonb`)]));
  if (q.brand) query = query.where('g.brand', 'ilike', `%${q.brand.replace(/[%_]/g, '')}%`);
  if (q.style) query = query.where(sql<boolean>`${q.style} = any(g.styles)`);
  if (q.season) query = query.where(sql<boolean>`${q.season} = any(g.seasons)`);
  if (q.material) query = query.where(sql<boolean>`${q.material} = any(g.materials)`);
  if (q.occasion) query = query.where(sql<boolean>`${q.occasion} = any(g.occasions)`);
  if (q.favorite) query = query.where('g.favorite', '=', true);
  if (q.spaceId) query = query.where('g.space_id', '=', q.spaceId);
  if (q.tag) query = query.where(sql<boolean>`exists (select 1 from garment_tags gt join tags t on t.id = gt.tag_id where gt.garment_id = g.id and lower(t.name) = lower(${q.tag}))`);
  if (q.usage === 'new') query = query.where('g.created_at', '>=', new Date(Date.now() - 30 * 86_400_000));
  if (q.usage === 'unused') query = query.where('g.wear_count', '=', 0).where('g.created_at', '<', new Date(Date.now() - 30 * 86_400_000));
  if (q.usage === 'rarely_used') query = query.where('g.wear_count', '<=', 2);
  if (q.q) {
    const text = q.q.trim().slice(0, 100);
    query = query.where((eb) =>
      eb.or([
        eb(sql`g.search_text`, '@@', sql`plainto_tsquery('spanish', immutable_unaccent(${text}))`),
        eb('g.name', 'ilike', `%${text.replace(/[%_]/g, '')}%`),
        eb('g.brand', 'ilike', `%${text.replace(/[%_]/g, '')}%`),
      ]),
    );
  }
  const sort = q.sort ?? (q.usage === 'most_used' ? 'most_worn' : 'recent');
  switch (sort) {
    case 'oldest':
      query = query.orderBy('g.created_at', 'asc');
      break;
    case 'least_worn':
      query = query.orderBy('g.wear_count', 'asc').orderBy('g.last_worn_on', (ob) => ob.asc().nullsFirst());
      break;
    case 'most_worn':
      query = query.orderBy('g.wear_count', 'desc');
      break;
    case 'cost_per_wear':
      query = query.orderBy(sql`g.purchase_price_cents::float / greatest(g.wear_count, 1)`, (ob) => ob.desc().nullsLast());
      break;
    case 'name':
      query = query.orderBy('g.name', 'asc');
      break;
    default:
      query = query.orderBy('g.created_at', 'desc');
  }
  const rows = (await query.orderBy('g.id').limit(limit + 1).offset(offset).execute()) as GarmentRow[];
  const items = rows.slice(0, limit).map((r) => toGarmentDto(r, signer));
  return { items, nextCursor: rows.length > limit ? String(offset + limit) : null };
}

export async function getGarmentDto(trx: Tx, signer: UrlSigner, id: string): Promise<GarmentDto> {
  const row = (await garmentSelect(trx).where('g.id', '=', id).executeTakeFirst()) as GarmentRow | undefined;
  if (!row) throw notFound('Prenda');
  return toGarmentDto(row, signer);
}

export async function getGarmentDetail(trx: Tx, signer: UrlSigner, id: string): Promise<GarmentDetailDto> {
  const row = (await garmentSelect(trx).where('g.id', '=', id).executeTakeFirst()) as GarmentRow | undefined;
  if (!row) throw notFound('Prenda');
  const [images, attributes, availability, wears] = await Promise.all([
    trx.selectFrom('garment_images').selectAll().where('garment_id', '=', id).orderBy('created_at').execute(),
    trx.selectFrom('garment_attributes').selectAll().where('garment_id', '=', id).orderBy('created_at', 'desc').limit(100).execute(),
    trx.selectFrom('garment_availability').selectAll().where('garment_id', '=', id).orderBy('started_at', 'desc').limit(50).execute(),
    trx.selectFrom('outfit_usage_history').select(['worn_on', 'outfit_id']).where(sql<boolean>`${id}::uuid = any(garment_ids)`).orderBy('worn_on', 'desc').limit(100).execute(),
  ]);
  return {
    ...toGarmentDto(row, signer),
    notes: row.notes,
    model: row.model,
    images: images.filter((i) => i.kind === 'original' || i.kind === 'cutout' || i.kind === 'product_reference' || i.kind === 'label').map((i) => imageRef(signer, row.user_id, i)),
    attributes: attributes.map((a) => ({ attribute: a.attribute, value: a.value, confidence: Number(a.confidence), source: a.source, isCurrent: a.is_current, createdAt: a.created_at.toISOString() })),
    availabilityHistory: availability.map((a) => ({ status: a.status as GarmentStatus, startedAt: a.started_at.toISOString(), endedAt: a.ended_at?.toISOString() ?? null, note: a.lent_to ? `Prestada a ${a.lent_to}${a.note ? ` · ${a.note}` : ''}` : a.note })),
    wearHistory: wears.map((w) => ({ wornOn: w.worn_on, outfitId: w.outfit_id })),
    compatibleCount: null,
  };
}

/** Load the wardrobe in engine form (available garments by default). */
export async function loadEngineWardrobe(trx: Tx, opts: { statuses?: GarmentStatus[]; withEmbeddings?: boolean } = {}): Promise<EngineGarment[]> {
  const statuses = opts.statuses ?? ['available'];
  let q = trx
    .selectFrom('garments as g')
    .leftJoin('garment_images as pi', 'pi.id', 'g.primary_image_id')
    .selectAll('g')
    .select(['pi.width as img_width', 'pi.height as img_height'])
    .where('g.status', 'in', statuses);
  if (opts.withEmbeddings) {
    q = q.leftJoin('garment_embeddings as e', 'e.garment_id', 'g.id').select(sql<string | null>`e.embedding::text`.as('embedding_text')) as unknown as typeof q;
  }
  const rows = (await q.execute()) as Array<GarmentRow & { embedding_text?: string | null; img_width?: number | null; img_height?: number | null }>;
  return rows.map((r) =>
    toEngineGarment({
      id: r.id,
      name: r.name,
      category: r.category as never,
      subcategory: r.subcategory,
      colors: ((r.colors as unknown as Array<{ hex: string; share: number; family: string }>) ?? []).map((c) => ({ hex: c.hex, share: c.share, family: c.family })),
      pattern: r.pattern,
      materials: r.materials,
      styles: r.styles as never,
      formality: r.formality,
      warmth: Number(r.warmth_clo),
      waterproof: r.waterproof,
      fit: r.fit as never,
      seasons: r.seasons as never,
      favorite: r.favorite,
      wearCount: r.wear_count,
      lastWornOn: r.last_worn_on,
      createdAt: r.created_at.toISOString(),
      embedding: parseVector(r.embedding_text ?? null),
      imageAspect: r.img_width && r.img_height ? r.img_width / r.img_height : null,
    }),
  );
}

export async function similarGarments(trx: Tx, signer: UrlSigner, id: string): Promise<Array<{ garment: GarmentDto; score: number; reason: string }>> {
  const all = await loadEngineWardrobe(trx, { statuses: ['available', 'laundry', 'lent', 'stored'], withEmbeddings: true });
  const target = all.find((g) => g.id === id);
  if (!target) throw notFound('Prenda');
  const similar = findSimilarOwned(all.filter((g) => g.id !== id), target, 8);
  const dtos = new Map<string, GarmentDto>();
  if (similar.length) {
    const rows = (await garmentSelect(trx).where('g.id', 'in', similar.map((s) => s.garment.id)).execute()) as GarmentRow[];
    for (const r of rows) dtos.set(r.id, toGarmentDto(r, signer));
  }
  return similar.filter((s) => dtos.has(s.garment.id)).map((s) => ({ garment: dtos.get(s.garment.id)!, score: Math.round(s.similarity * 100) / 100, reason: s.reason }));
}

export async function wardrobeStats(trx: Tx, signer: UrlSigner): Promise<WardrobeStatsDto> {
  const rows = (await garmentSelect(trx).where('g.status', '!=', 'retired').execute()) as GarmentRow[];
  const dtos = rows.map((r) => toGarmentDto(r, signer));
  const count = (key: (g: GarmentDto) => string[] | string | null) => {
    const m = new Map<string, number>();
    for (const g of dtos) {
      const k = key(g);
      for (const v of Array.isArray(k) ? k : k ? [k] : []) m.set(v, (m.get(v) ?? 0) + 1);
    }
    return [...m.entries()].map(([k, c]) => ({ key: k, count: c })).sort((a, b) => b.count - a.count);
  };
  const priced = dtos.filter((g) => g.purchasePrice);
  const totalValue = priced.reduce((a, g) => a + g.purchasePrice!.cents, 0);
  const cpw = priced.filter((g) => g.wearCount > 0);
  const now = Date.now();
  const neverWorn = dtos.filter((g) => g.wearCount === 0 && now - Date.parse(g.createdAt) > 14 * 86_400_000);
  const worn = [...dtos].sort((a, b) => b.wearCount - a.wearCount);
  // Over-representation: same subcategory + color family repeated.
  const groups = new Map<string, GarmentDto[]>();
  for (const g of dtos) {
    const k = `${g.subcategory}|${g.primaryColor ?? ''}`;
    groups.set(k, [...(groups.get(k) ?? []), g]);
  }
  const overRepresented = [...groups.entries()]
    .filter(([, list]) => list.length >= 3)
    .map(([k, list]) => {
      const [sub, color] = k.split('|');
      const label = getSubcategory(sub!)?.label.toLowerCase() ?? sub;
      return { subcategory: sub!, colorFamily: color || null, count: list.length, message: `Tienes ${list.length} prendas del tipo «${label}»${color ? ` en ${color.replace('_', ' ')}` : ''}.` };
    })
    .sort((a, b) => b.count - a.count);
  // Near-duplicates (engine similarity ≥ 0.85).
  const engine = await loadEngineWardrobe(trx, { statuses: ['available', 'laundry', 'lent', 'stored'], withEmbeddings: true });
  const seen = new Set<string>();
  const duplicateGroups: WardrobeStatsDto['duplicateGroups'] = [];
  for (const g of engine) {
    if (seen.has(g.id)) continue;
    const sims = findSimilarOwned(engine.filter((o) => o.id !== g.id && !seen.has(o.id)), g, 5).filter((s) => s.similarity >= 0.85);
    if (sims.length) {
      const ids = [g.id, ...sims.map((s) => s.garment.id)];
      ids.forEach((x) => seen.add(x));
      duplicateGroups.push({ garmentIds: ids, reason: sims[0]!.reason, score: Math.round(sims[0]!.similarity * 100) / 100 });
    }
  }
  const outfits30 = await trx
    .selectFrom('outfit_usage_history')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('worn_on', '>=', new Date(now - 30 * 86_400_000).toISOString().slice(0, 10))
    .executeTakeFirst();
  return {
    totalGarments: dtos.length,
    byCategory: count((g) => g.category),
    byColor: count((g) => g.primaryColor),
    byStyle: count((g) => g.styles),
    byStatus: count((g) => g.status),
    bySeason: count((g) => g.seasons),
    totalValue: priced.length ? { cents: totalValue, currency: 'EUR' } : null,
    avgCostPerWear: cpw.length ? { cents: Math.round(cpw.reduce((a, g) => a + g.costPerWear!.cents, 0) / cpw.length), currency: 'EUR' } : null,
    neverWorn: neverWorn.slice(0, 12),
    mostWorn: worn.filter((g) => g.wearCount > 0).slice(0, 8),
    leastWorn: [...worn].reverse().slice(0, 8),
    overRepresented,
    duplicateGroups,
    outfitsWornLast30Days: Number(outfits30?.n ?? 0),
  };
}

export async function bulkUpdate(trx: Tx, userId: string, body: BulkGarmentUpdate): Promise<number> {
  const ids = [...new Set(body.ids)].slice(0, 500);
  const found = await trx.selectFrom('garments').select('id').where('id', 'in', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']).execute();
  for (const { id } of found) {
    if (body.patch.status) await changeStatus(trx, userId, id, body.patch.status);
    const patch: GarmentWriteDto = {};
    if (body.patch.spaceId !== undefined) patch.spaceId = body.patch.spaceId;
    if (body.patch.favorite !== undefined) patch.favorite = body.patch.favorite;
    if (body.patch.seasons) patch.seasons = body.patch.seasons;
    if (body.patch.styles) patch.styles = body.patch.styles;
    if (body.patch.addTags?.length || body.patch.removeTags?.length) {
      const current = await trx.selectFrom('garment_tags as gt').innerJoin('tags as t', 't.id', 'gt.tag_id').select('t.name').where('gt.garment_id', '=', id).execute();
      const remove = new Set((body.patch.removeTags ?? []).map((t) => t.toLowerCase()));
      patch.tags = [...new Set([...current.map((c) => c.name).filter((n) => !remove.has(n.toLowerCase())), ...(body.patch.addTags ?? [])])];
    }
    if (Object.keys(patch).length) await updateGarment(trx, userId, id, patch);
  }
  return found.length;
}
