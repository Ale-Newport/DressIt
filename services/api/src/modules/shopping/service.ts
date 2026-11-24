import {
  COLOR_FAMILIES,
  getOccasion,
  getSubcategory,
  type GarmentDto,
  type LinkToWardrobeRequest,
  type OutfitDto,
  type ProductSummaryDto,
  type ShoppingRecommendationDto,
  type ShoppingSection,
  type ShoppingSectionDto,
  type SimulationResponse,
  type VisualSearchResponse,
  type WardrobeGapDto,
  type WishlistItemDto,
} from '@dressit/shared';
import {
  evaluateCandidate,
  findSimilarOwned,
  productScore,
  seasonOf,
  styleMatchOf,
  toEngineGarment,
  wardrobeGaps,
  type EngineContext,
  type EngineGarment,
} from '@dressit/stylist-engine';
import type { AppContext } from '../../context.ts';
import type { Tx } from '../../db/index.ts';
import { badRequest, notFound } from '../../lib/errors.ts';
import { engineDuration } from '../../lib/metrics.ts';
import { catalogBase, catalogDto, catalogSize, getCatalogProduct, importedSummary, nearestProducts, type CatalogRow } from '../catalog/service.ts';
import { loadHistory, loadOutfitDtos, loadProfile, persistOutfit, todayIn } from '../outfits/service.ts';
import { getImported, importedToWardrobe } from '../retail/link-import.ts';
import { garmentSelect, loadEngineWardrobe, createGarment } from '../wardrobe/service.ts';
import { toGarmentDto, type GarmentRow } from '../wardrobe/mappers.ts';
import { loadImageBytes } from '../images/service.ts';

const NO_CATALOG = 'Todavía no hay catálogos comerciales autorizados conectados (feeds de afiliación o APIs oficiales). Mientras tanto puedes guardar productos pegando su enlace o compartiéndolos desde la tienda.';

async function shoppingContexts(trx: Tx, userId: string): Promise<{ contexts: EngineContext[]; profile: Awaited<ReturnType<typeof loadProfile>>['profile']; prefs: Awaited<ReturnType<typeof loadProfile>>['prefs']; date: string }> {
  const { profile, prefs } = await loadProfile(trx, userId);
  const user = await trx.selectFrom('users').select('timezone').where('id', '=', userId).executeTakeFirstOrThrow();
  const date = todayIn(user.timezone);
  const occasions = [...new Set([...(prefs.usual_contexts.length ? prefs.usual_contexts : ['dia_informal']), 'dia_informal'])].slice(0, 3);
  const contexts = occasions
    .map((id) => getOccasion(id))
    .filter((o) => !!o)
    .map((occasion) => ({
      date,
      occasion: occasion!,
      weather: null,
      season: seasonOf(date),
      indoorShare: occasion!.indoorShare,
      adjustments: { formality: 0 as const, warmth: 0 as const, elegance: 0 as const },
      mustInclude: [],
      exclude: new Set<string>(),
      excludeSubcategories: new Set<string>(),
      temperatureSensitivity: prefs.temperature_sensitivity,
    }));
  return { contexts, profile, prefs, date };
}

/** Engine garment for a product (catalog or imported) — inference is explicit and reported. */
export function productToCandidate(p: ProductSummaryDto, embedding: number[] | null = null): { garment: EngineGarment | null; confidence: number; warnings: string[] } {
  const warnings: string[] = [];
  const sub = p.subcategory ? getSubcategory(p.subcategory) : undefined;
  if (!sub) return { garment: null, confidence: 0, warnings: ['No sabemos con seguridad qué tipo de prenda es este producto.'] };
  const fam = p.colorFamily ? COLOR_FAMILIES.find((c) => c.id === p.colorFamily) : undefined;
  if (!fam) warnings.push('Color no identificado: se asume un tono neutro para simular.');
  warnings.push('Tipo y color deducidos del nombre del producto en la tienda.');
  return {
    garment: toEngineGarment({
      id: `${p.kind}:${p.id}`,
      name: p.title,
      category: sub.category,
      subcategory: sub.id,
      colors: [{ hex: fam?.hex ?? '#8c8c8c', share: 1, family: fam?.id ?? 'gris' }],
      pattern: 'liso',
      isCandidate: true,
      embedding,
    }),
    confidence: fam ? 0.75 : 0.55,
    warnings,
  };
}

async function loadProduct(app: AppContext, trx: Tx, ref: { kind: 'catalog' | 'imported'; id: string }): Promise<ProductSummaryDto> {
  if (ref.kind === 'catalog') return getCatalogProduct(trx, ref.id, app.cfg.PRICE_FRESHNESS_HOURS);
  return importedSummary(await getImported(trx, ref.id), app.cfg.PRICE_FRESHNESS_HOURS);
}

async function garmentDtos(app: AppContext, trx: Tx, ids: string[]): Promise<Map<string, GarmentDto>> {
  const m = new Map<string, GarmentDto>();
  if (!ids.length) return m;
  for (const r of (await garmentSelect(trx).where('g.id', 'in', ids).execute()) as GarmentRow[]) m.set(r.id, toGarmentDto(r, app.signer));
  return m;
}

export async function gaps(app: AppContext, trx: Tx, userId: string): Promise<WardrobeGapDto[]> {
  const wardrobe = await loadEngineWardrobe(trx, { statuses: ['available', 'laundry', 'lent', 'stored'] });
  if (wardrobe.length < 3) return [];
  const { contexts, profile, date } = await shoppingContexts(trx, userId);
  const end = engineDuration.startTimer({ operation: 'gaps' });
  const result = wardrobeGaps(wardrobe, contexts, profile, await loadHistory(trx, date), { limit: 6, season: seasonOf(date) });
  end();
  const out: WardrobeGapDto[] = [];
  for (const g of result) {
    const rows = (await catalogBase(trx).where('p.subcategory', '=', g.subcategory).where('p.color_family', '=', g.colorFamily).limit(4).execute()) as CatalogRow[];
    out.push({ key: g.key, label: g.label, subcategory: g.subcategory, colorFamily: g.colorFamily, newOutfits: g.newOutfits, partners: g.partners, reason: g.reason, matchingProducts: rows.map((r) => catalogDto(r, app.cfg.PRICE_FRESHNESS_HOURS)) });
  }
  return out;
}

const SECTION_TITLES: Record<ShoppingSection, string> = {
  para_ti: 'Recomendado para ti',
  completa_armario: 'Completa tu armario',
  combina_favoritos: 'Combina con tus favoritos',
  novedades: 'Nuevas colecciones',
  versatiles: 'Prendas versátiles',
  ofertas_marcas: 'Ofertas en tus marcas favoritas',
  bajo_presupuesto: 'Por debajo de tu presupuesto',
};

/**
 * Ranked shopping sections. The candidate pool is filtered per section and each
 * product is scored with the wardrobe-aware productScore (commission is not an input).
 */
export async function sections(app: AppContext, trx: Tx, userId: string, wanted: ShoppingSection[]): Promise<ShoppingSectionDto[]> {
  const size = await catalogSize(trx);
  if (size === 0) return wanted.map((s) => ({ section: s, title: SECTION_TITLES[s], items: [], emptyReason: NO_CATALOG }));
  const wardrobe = await loadEngineWardrobe(trx, { statuses: ['available', 'laundry', 'lent', 'stored'], withEmbeddings: true });
  const { contexts, profile, prefs, date } = await shoppingContexts(trx, userId);
  const history = await loadHistory(trx, date);
  const budgetMax = prefs.budget_max_eur;
  const favBrands = prefs.favorite_brands;
  const sizesPref = prefs.sizes as Record<string, string>;
  const result: ShoppingSectionDto[] = [];
  const gapList = wanted.includes('completa_armario') ? await gaps(app, trx, userId) : [];
  for (const section of wanted) {
    let q = catalogBase(trx).where('p.subcategory', 'is not', null);
    switch (section) {
      case 'novedades':
        q = q.orderBy('p.first_seen_at', 'desc');
        break;
      case 'ofertas_marcas':
        if (!favBrands.length) {
          result.push({ section, title: SECTION_TITLES[section], items: [], emptyReason: 'Indica tus marcas favoritas en el perfil para ver sus ofertas.' });
          continue;
        }
        q = q.where('p.brand', 'in', favBrands);
        break;
      case 'bajo_presupuesto':
        if (!budgetMax) {
          result.push({ section, title: SECTION_TITLES[section], items: [], emptyReason: 'Indica tu presupuesto en el perfil.' });
          continue;
        }
        break;
      case 'completa_armario':
        if (!gapList.length) {
          result.push({ section, title: SECTION_TITLES[section], items: [], emptyReason: 'Añade más prendas para analizar qué le falta a tu armario.' });
          continue;
        }
        q = q.where((eb) => eb.or(gapList.map((g) => eb.and([eb('p.subcategory', '=', g.subcategory), eb('p.color_family', '=', g.colorFamily)]))));
        break;
      case 'combina_favoritos': {
        const favs = wardrobe.filter((g) => g.favorite);
        if (!favs.length) {
          result.push({ section, title: SECTION_TITLES[section], items: [], emptyReason: 'Marca prendas como favoritas para ver qué combina con ellas.' });
          continue;
        }
        q = q.where('p.category', 'not in', [...new Set(favs.map((f) => f.category))]);
        break;
      }
      default:
        q = q.orderBy('p.data_quality', 'desc');
    }
    const rows = (await q.limit(40).execute()) as CatalogRow[];
    const scored: ShoppingRecommendationDto[] = [];
    for (const r of rows) {
      const dto = catalogDto(r, app.cfg.PRICE_FRESHNESS_HOURS);
      if (section === 'ofertas_marcas' && !dto.discountPercent) continue;
      if (section === 'bajo_presupuesto' && (!dto.price || dto.price.cents > budgetMax! * 100)) continue;
      const cand = productToCandidate(dto);
      if (!cand.garment) continue;
      const ev = evaluateCandidate(wardrobe, cand.garment, contexts.slice(0, 2), profile, history, { perContext: 5 });
      const redundancy = findSimilarOwned(wardrobe, cand.garment, 1)[0]?.similarity ?? 0;
      const sizeKey = cand.garment.category === 'footwear' ? 'shoes' : cand.garment.category === 'bottom' ? 'bottom' : 'top';
      const wantedSize = sizesPref[sizeKey];
      const sizeAvailable = wantedSize && dto.sizes.length ? dto.sizes.some((s) => s.label.toLowerCase() === wantedSize.toLowerCase()) : null;
      const { score, breakdown } = productScore({
        newOutfits: ev.newOutfits,
        partners: ev.partners.length,
        styleMatch: ev.outfits[0] ? styleMatchOf(ev.outfits[0], profile) : 0.5,
        redundancy,
        priceEur: dto.price ? dto.price.cents / 100 : null,
        budget: { min: prefs.budget_min_eur, max: prefs.budget_max_eur },
        brand: dto.brand,
        favoriteBrands: favBrands,
        sizeAvailable,
        dataQuality: 1,
        isStale: dto.isStale,
      });
      const reasons: string[] = [];
      if (ev.newOutfits > 0) reasons.push(`Podrías crear ${ev.newOutfits} conjunto${ev.newOutfits === 1 ? '' : 's'} con ${ev.partners.length} prenda${ev.partners.length === 1 ? '' : 's'} que ya tienes.`);
      if (redundancy >= 0.75) reasons.push('Se parece mucho a algo que ya tienes.');
      if (sizeAvailable === false) reasons.push(`Tu talla (${wantedSize}) no figura en el catálogo.`);
      if (dto.isStale) reasons.push('Precio sin verificar recientemente.');
      if (redundancy >= 0.85 && ev.newOutfits < 2) continue; // never push near-duplicates without a clear reason
      scored.push({ product: dto, score: Math.round(score * 1000) / 1000, newOutfits: ev.newOutfits, redundancy: Math.round(redundancy * 100) / 100, reasons, breakdown });
    }
    scored.sort((a, b) => b.score - a.score);
    result.push({ section, title: SECTION_TITLES[section], items: scored.slice(0, 12), emptyReason: scored.length ? null : 'No hay productos del catálogo conectado que encajen con esta sección ahora mismo.' });
  }
  return result;
}

export async function simulate(app: AppContext, trx: Tx, userId: string, body: { product: { kind: 'catalog' | 'imported'; id: string }; occasion?: string; limit?: number }): Promise<SimulationResponse> {
  const product = await loadProduct(app, trx, body.product);
  const cand = productToCandidate(product);
  if (!cand.garment) throw badRequest('No podemos simular este producto: no sabemos qué tipo de prenda es. Edita el tipo al guardarlo.');
  const wardrobe = await loadEngineWardrobe(trx, { statuses: ['available', 'laundry', 'lent', 'stored'], withEmbeddings: true });
  const { contexts, profile, date } = await shoppingContexts(trx, userId);
  const ctxs = body.occasion && getOccasion(body.occasion) ? [{ ...contexts[0]!, occasion: getOccasion(body.occasion)!, indoorShare: getOccasion(body.occasion)!.indoorShare }] : contexts;
  const history = await loadHistory(trx, date);
  const end = engineDuration.startTimer({ operation: 'simulate' });
  const ev = evaluateCandidate(wardrobe, cand.garment, ctxs, profile, history, { perContext: 8 });
  end();
  const similar = findSimilarOwned(wardrobe, cand.garment, 4);
  const limit = Math.min(body.limit ?? 6, 10);
  const outfitIds: string[] = [];
  for (const o of ev.outfits.slice(0, limit)) outfitIds.push(await persistOutfit(trx, userId, o, ctxs[0]!, 'simulation', null));
  const outfits: OutfitDto[] = await loadOutfitDtos(trx, app.signer, outfitIds, new Map([[`${product.kind}:${product.id}`, product]]));
  const garments = await garmentDtos(app, trx, [...ev.partners.map((p) => p.id), ...similar.map((s) => s.garment.id)]);
  const redundancy = similar[0]?.similarity ?? 0;
  const gain = ev.newOutfits;
  const label: SimulationResponse['utility']['label'] = redundancy >= 0.85 && gain < 3 ? 'redundante' : gain >= 6 ? 'alta' : gain >= 3 ? 'media' : 'baja';
  const explanation =
    label === 'redundante'
      ? `Se parece mucho a ${similar[0]!.garment.name.toLowerCase()}, que ya tienes; añadiría poca variedad.`
      : gain === 0
        ? 'Con tu armario actual no hemos encontrado conjuntos de calidad con este producto.'
        : `Con este producto podrías crear ${gain} conjunto${gain === 1 ? '' : 's'} nuevo${gain === 1 ? '' : 's'} combinándolo con ${ev.partners.length} prenda${ev.partners.length === 1 ? '' : 's'} que ya tienes.`;
  return {
    product,
    inferred: { category: cand.garment.category, subcategory: cand.garment.subcategory, colorFamily: product.colorFamily, confidence: cand.confidence, warnings: cand.warnings },
    outfits,
    baseline: { outfitCount: ev.baseline.outfitCount, avgScore: Math.round(ev.baseline.avgScore * 1000) / 1000 },
    withProduct: { outfitCount: ev.baseline.outfitCount + gain, newOutfits: gain, avgScore: Math.round(ev.avgScore * 1000) / 1000 },
    partners: ev.partners.map((p) => garments.get(p.id)).filter((g): g is GarmentDto => !!g),
    similarOwned: similar.map((s) => ({ garment: garments.get(s.garment.id)!, similarity: Math.round(s.similarity * 100) / 100, reason: s.reason })).filter((s) => s.garment),
    utility: { score: Math.min(1, gain / 8) * (1 - redundancy * 0.6), label, explanation },
  };
}

export async function visualSearch(app: AppContext, trx: Tx, body: { imageId: string; category?: string; limit?: number }): Promise<VisualSearchResponse> {
  const size = await catalogSize(trx);
  if (size === 0) return { results: [], searchedProducts: 0, sources: [], message: NO_CATALOG };
  const img = await loadImageBytes(app, trx, body.imageId);
  const { embedding } = await app.vision.embedImage(img.body, img.mime, { segment: true });
  const near = await nearestProducts(trx, embedding, Math.min(body.limit ?? 20, 50), body.category);
  if (!near.length) return { results: [], searchedProducts: size, sources: [], message: 'Los productos del catálogo aún no tienen análisis visual. Ejecuta la ingesta de catálogo con el servicio de visión activo.' };
  const rows = (await catalogBase(trx).where('p.id', 'in', near.map((n) => n.id)).execute()) as CatalogRow[];
  const byId = new Map(rows.map((r) => [r.id, catalogDto(r, app.cfg.PRICE_FRESHNESS_HOURS)]));
  const results = near
    .filter((n) => byId.has(n.id) && n.cos >= 0.5)
    .map((n) => ({ product: byId.get(n.id)!, similarity: Math.round(n.cos * 1000) / 1000, match: 'similar' as const }));
  return { results, searchedProducts: size, sources: [...new Set(results.map((r) => r.product.retailer.name))], message: results.length ? 'Resultados visualmente parecidos: no son necesariamente el mismo producto.' : 'No hemos encontrado productos parecidos en los catálogos conectados.' };
}

// ---------------------------------------------------------------------------
// Wishlist & outbound
// ---------------------------------------------------------------------------

async function defaultWishlist(trx: Tx, userId: string): Promise<string> {
  const w = await trx.selectFrom('wishlists').select('id').where('is_default', '=', true).executeTakeFirst();
  if (w) return w.id;
  return (await trx.insertInto('wishlists').values({ user_id: userId }).returning('id').executeTakeFirstOrThrow()).id;
}

export async function listWishlist(app: AppContext, trx: Tx): Promise<WishlistItemDto[]> {
  const items = await trx.selectFrom('wishlist_items').selectAll().orderBy('created_at', 'desc').execute();
  const out: WishlistItemDto[] = [];
  for (const i of items) {
    try {
      const product = await loadProduct(app, trx, i.catalog_product_id ? { kind: 'catalog', id: i.catalog_product_id } : { kind: 'imported', id: i.imported_product_id! });
      out.push({ id: i.id, product, note: i.note, createdAt: i.created_at.toISOString() });
    } catch {
      /* product removed from catalog */
    }
  }
  return out;
}

export async function addToWishlist(app: AppContext, trx: Tx, userId: string, ref: { kind: 'catalog' | 'imported'; id: string }, note?: string): Promise<WishlistItemDto> {
  const product = await loadProduct(app, trx, ref);
  const wishlistId = await defaultWishlist(trx, userId);
  const existing = await trx
    .selectFrom('wishlist_items')
    .selectAll()
    .where('wishlist_id', '=', wishlistId)
    .where(ref.kind === 'catalog' ? 'catalog_product_id' : 'imported_product_id', '=', ref.id)
    .executeTakeFirst();
  const row =
    existing ??
    (await trx
      .insertInto('wishlist_items')
      .values({ user_id: userId, wishlist_id: wishlistId, catalog_product_id: ref.kind === 'catalog' ? ref.id : null, imported_product_id: ref.kind === 'imported' ? ref.id : null, note: note ?? null })
      .returningAll()
      .executeTakeFirstOrThrow());
  await trx.insertInto('recommendation_events').values({ user_id: userId, kind: 'wishlist_add', product_ref: `${ref.kind}:${ref.id}`, context: '{}' }).execute();
  return { id: row.id, product, note: row.note, createdAt: row.created_at.toISOString() };
}

export async function removeFromWishlist(trx: Tx, id: string) {
  const r = await trx.deleteFrom('wishlist_items').where('id', '=', id).returning('id').executeTakeFirst();
  if (!r) throw notFound('Elemento de la lista de deseos');
}

/** "Ya lo tengo": only after the user confirms ownership the product becomes a garment. */
export async function wishlistOwned(app: AppContext, trx: Tx, userId: string, id: string, body: LinkToWardrobeRequest): Promise<string> {
  const item = await trx.selectFrom('wishlist_items').selectAll().where('id', '=', id).executeTakeFirst();
  if (!item) throw notFound('Elemento de la lista de deseos');
  let garmentId: string;
  if (item.imported_product_id) garmentId = await importedToWardrobe(app, trx, userId, item.imported_product_id, body);
  else {
    const p = await getCatalogProduct(trx, item.catalog_product_id!, app.cfg.PRICE_FRESHNESS_HOURS);
    const cand = productToCandidate(p);
    const subcategory = body.overrides?.subcategory ?? cand.garment?.subcategory;
    if (!subcategory) throw badRequest('Indica qué tipo de prenda es.');
    const fam = COLOR_FAMILIES.find((c) => c.id === p.colorFamily);
    garmentId = await createGarment(
      trx,
      userId,
      { ...body.overrides, name: body.overrides?.name ?? p.title, subcategory, brand: body.overrides?.brand ?? p.brand, size: body.size ?? null, colors: body.overrides?.colors ?? (fam ? [{ hex: fam.hex }] : undefined), purchaseDate: body.purchaseDate ?? null, purchasePriceCents: body.purchasePriceCents ?? p.price?.cents ?? null, imageId: body.imageId ?? null },
      { source: 'link', sourceUrl: p.productUrl, catalogProductId: p.id, attributeSource: `retailer:${p.retailer.id}` },
    );
    await trx.insertInto('purchases').values({ user_id: userId, garment_id: garmentId, catalog_product_id: p.id, retailer_id: p.retailer.id, purchased_on: body.purchaseDate ?? null, price_cents: body.purchasePriceCents ?? p.price?.cents ?? null, size_label: body.size ?? null, source: 'wishlist' }).execute();
  }
  await trx.deleteFrom('wishlist_items').where('id', '=', id).execute();
  await trx.insertInto('recommendation_events').values({ user_id: userId, kind: 'purchase_confirmed', garment_id: garmentId, product_ref: item.catalog_product_id ? `catalog:${item.catalog_product_id}` : `imported:${item.imported_product_id}`, context: '{}' }).execute();
  return garmentId;
}

export async function outbound(app: AppContext, trx: Tx, userId: string, ref: { kind: 'catalog' | 'imported'; id: string }, context?: string) {
  let url: string;
  let isAffiliate = false;
  if (ref.kind === 'catalog') {
    const p = await trx.selectFrom('catalog_products').select(['product_url']).where('id', '=', ref.id).executeTakeFirst();
    if (!p) throw notFound('Producto');
    const aff = await trx.selectFrom('affiliate_links').select('url').where('product_id', '=', ref.id).executeTakeFirst();
    url = aff?.url ?? p.product_url;
    isAffiliate = !!aff;
  } else {
    const row = await getImported(trx, ref.id);
    url = row.canonical_url ?? row.url;
  }
  await trx.insertInto('recommendation_events').values({ user_id: userId, kind: 'product_click', product_ref: `${ref.kind}:${ref.id}`, context: JSON.stringify({ context: context ?? null, affiliate: isAffiliate }) }).execute();
  return { url, isAffiliate, disclosure: isAffiliate ? 'Enlace de afiliado: si compras, DressIt puede recibir una comisión sin coste para ti. No influye en el orden de las recomendaciones.' : null };
}
