import type { Selectable } from 'kysely';
import {
  COLOR_FAMILIES,
  colorFamilyFromText,
  getSubcategory,
  type FieldSource,
  type ImagePolicy,
  type ImportedProductDto,
  type LinkToWardrobeRequest,
  type PageCaptureRequest,
  type ProvenancedField,
} from '@dressit/shared';
import type { AppContext } from '../../context.ts';
import type { Tx } from '../../db/index.ts';
import type { ImportedProducts } from '../../db/types.ts';
import { badRequest, notFound } from '../../lib/errors.ts';
import { businessEvents } from '../../lib/metrics.ts';
import { FetchBlockedError, safeFetch, validateUrl } from '../../lib/safe-fetch.ts';
import { createGarment } from '../wardrobe/service.ts';
import { inferMaterials, inferSubcategory } from './categorize.ts';
import { extractFromHtml, extractFromStructured, type ExtractedProduct, type Sourced } from './extract.ts';
import { RETAILERS, retailerForHost, type RetailerDef } from './registry.ts';

const VERIFIED_SOURCES = new Set<FieldSource>(['json_ld', 'microdata', 'open_graph', 'meta', 'page_capture', 'feed', 'api']);
const SINGLE_BRAND = new Set(['zara', 'pullandbear', 'bershka', 'massimodutti', 'stradivarius', 'oysho', 'lefties', 'mango', 'hm', 'uniqlo', 'springfield', 'nike', 'adidas']);

type StoredField<T> = { value: T; source: FieldSource };
interface StoredData {
  title?: StoredField<string>;
  brand?: StoredField<string>;
  description?: StoredField<string>;
  category?: StoredField<string>;
  subcategory?: StoredField<string>;
  colorName?: StoredField<string>;
  colorFamily?: StoredField<string>;
  materials?: StoredField<string[]>;
  price?: StoredField<{ cents: number; currency: string }>;
  originalPrice?: StoredField<{ cents: number; currency: string }>;
  availability?: StoredField<'in_stock' | 'out_of_stock' | 'preorder' | 'unknown'>;
  sizes?: StoredField<string[]>;
  variants?: ExtractedProduct['variants'];
  gtin?: StoredField<string>;
  sku?: StoredField<string>;
}

const fieldOf = <T>(s: Sourced<T> | null | undefined): StoredField<T> | undefined => (s ? { value: s.value, source: s.source } : undefined);

function toStored(extracted: ExtractedProduct, retailer: RetailerDef | null, sourceOverride?: FieldSource): StoredData {
  const remap = <T>(f: StoredField<T> | undefined): StoredField<T> | undefined => (f && sourceOverride ? { ...f, source: sourceOverride } : f);
  const data: StoredData = {
    title: remap(fieldOf(extracted.title)),
    brand: remap(fieldOf(extracted.brand)),
    description: remap(fieldOf(extracted.description)),
    colorName: remap(fieldOf(extracted.color)),
    price: remap(fieldOf(extracted.price)),
    originalPrice: remap(fieldOf(extracted.originalPrice)),
    availability: remap(fieldOf(extracted.availability)),
    sizes: extracted.sizes && extracted.sizes.value.length ? remap(fieldOf(extracted.sizes)) : undefined,
    variants: extracted.variants.slice(0, 80),
    gtin: remap(fieldOf(extracted.gtin)),
    sku: remap(fieldOf(extracted.sku)),
  };
  if (!data.brand && retailer && SINGLE_BRAND.has(retailer.id)) data.brand = { value: retailer.name, source: 'inferred' };
  const guess = inferSubcategory(data.title?.value, extracted.category?.value);
  if (guess) {
    data.category = { value: guess.category, source: 'inferred' };
    data.subcategory = { value: guess.subcategory, source: 'inferred' };
  }
  const fam = colorFamilyFromText(data.colorName?.value) ?? colorFamilyFromText(data.title?.value);
  if (fam) data.colorFamily = { value: fam, source: 'inferred' };
  const mats = inferMaterials(extracted.material?.value, data.title?.value, data.description?.value);
  if (mats.length) data.materials = { value: mats, source: 'inferred' };
  return data;
}

function statusOf(data: StoredData, isProductPage = true): 'resolved' | 'partial' | 'not_product' {
  if (!isProductPage) return 'not_product';
  if (data.title && data.price) return 'resolved';
  if (data.title || data.price) return 'partial';
  return 'not_product';
}

async function imagePolicyFor(trx: Tx, retailerId: string | null, kind: 'link_import' | 'page_capture'): Promise<ImagePolicy> {
  if (!retailerId) return 'none';
  const row = await trx.selectFrom('retailer_integrations').select('image_policy').where('retailer_id', '=', retailerId).where('kind', '=', kind).executeTakeFirst();
  return (row?.image_policy as ImagePolicy) ?? 'none';
}

export async function importedToDto(trx: Tx, row: Selectable<ImportedProducts>): Promise<ImportedProductDto> {
  const d = row.data as unknown as StoredData;
  const retailer = row.retailer_id ? RETAILERS.find((r) => r.id === row.retailer_id) : null;
  const pv = <T>(f: StoredField<T> | undefined): ProvenancedField<T> | null => (f ? { value: f.value, verified: VERIFIED_SOURCES.has(f.source), source: f.source } : null);
  const policy = row.image_policy as ImagePolicy;
  return {
    id: row.id,
    retailer: retailer ? { id: retailer.id, name: retailer.name, group: retailer.group } : null,
    url: row.url,
    canonicalUrl: row.canonical_url,
    externalId: row.external_id,
    title: pv(d.title),
    brand: pv(d.brand),
    description: pv(d.description),
    category: pv(d.category) as ImportedProductDto['category'],
    subcategory: pv(d.subcategory),
    colorName: pv(d.colorName),
    colorFamily: pv(d.colorFamily),
    price: pv(d.price),
    originalPrice: pv(d.originalPrice),
    availability: pv(d.availability),
    sizes: pv(d.sizes),
    variants: (d.variants ?? []).map((v) => ({ id: v.id, color: v.color, size: v.size, sku: v.sku, gtin: v.gtin, available: v.available })),
    images:
      policy === 'none'
        ? []
        : row.image_urls.map((u, i) => ({ id: `${row.id}:${i}`, url: u, thumbUrl: u, width: null, height: null, isCutout: false, license: policy === 'licensed' ? ('retailer_licensed' as const) : ('retailer_link_preview' as const), attribution: retailer ? `Imagen: ${retailer.name}` : null })),
    imagePolicy: policy,
    fetchStatus: row.fetch_status as ImportedProductDto['fetchStatus'],
    fetchMessage: row.fetch_message,
    verifiedAt: row.verified_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

function externalIdFrom(url: URL, data: StoredData): string | null {
  if (data.sku?.value) return data.sku.value;
  const m = /(?:-p|\/p\/[^/]+\/[^/]+\/[^/]+\/|productpage\.|\/products\/|\/prd\/|-l|c0p|\/A)(\d{5,})/i.exec(url.pathname) ?? /(\d{6,})/.exec(url.pathname);
  return m?.[1] ?? null;
}

const MESSAGES = {
  blocked: 'La tienda impide la lectura automática de esta página desde nuestros servidores. Ábrela en el navegador de la app y pulsa «Capturar este producto», o añade los datos y una foto tuya.',
  robots: 'La tienda no permite la lectura automática de esta página (robots.txt). Ábrela en el navegador de la app para capturarla, o añade los datos manualmente.',
  error: 'No hemos podido leer la página ahora mismo. Puedes intentarlo desde el navegador de la app o completar los datos tú.',
  not_product: 'No hemos encontrado datos de producto en esta página. ¿Es la página de un artículo concreto?',
  partial: 'Hemos leído parte de los datos de la página. Revisa y completa el resto.',
  unsupported: 'Esta tienda aún no está en nuestra lista; hemos intentado leer los datos públicos de la página.',
};

export async function importLink(ctx: AppContext, trx: Tx, userId: string, rawUrl: string): Promise<ImportedProductDto> {
  let url: URL;
  try {
    url = validateUrl(rawUrl, ctx.cfg.LINK_IMPORT_ALLOW_PRIVATE);
  } catch (e) {
    throw badRequest(e instanceof FetchBlockedError ? e.message : 'Enlace no válido.');
  }
  const retailer = retailerForHost(url.hostname);
  let fetchStatus: ImportedProductDto['fetchStatus'];
  let message: string | null = null;
  let data: StoredData = {};
  let canonical: string | null = null;
  let images: string[] = [];
  let verifiedAt: Date | null = null;
  try {
    const res = await safeFetch(url.toString(), {
      userAgent: ctx.cfg.LINK_IMPORT_USER_AGENT,
      timeoutMs: ctx.cfg.LINK_IMPORT_TIMEOUT_MS,
      maxBytes: ctx.cfg.LINK_IMPORT_MAX_BYTES,
      allowPrivate: ctx.cfg.LINK_IMPORT_ALLOW_PRIVATE,
      respectRobots: true,
    });
    const extracted = extractFromHtml(res.body, res.finalUrl);
    if (extracted.looksBlocked) {
      fetchStatus = 'blocked';
      message = MESSAGES.blocked;
    } else {
      data = toStored(extracted, retailer);
      canonical = extracted.canonicalUrl ?? res.finalUrl;
      images = extracted.images?.value ?? [];
      fetchStatus = statusOf(data, extracted.isProductPage);
      verifiedAt = fetchStatus === 'not_product' ? null : new Date();
      message = fetchStatus === 'not_product' ? MESSAGES.not_product : fetchStatus === 'partial' ? MESSAGES.partial : !retailer ? MESSAGES.unsupported : null;
    }
  } catch (e) {
    if (e instanceof FetchBlockedError) {
      if (e.reason === 'private_address' || e.reason === 'invalid_url') throw badRequest(e.message);
      if (e.reason === 'robots_disallowed') {
        fetchStatus = 'blocked';
        message = MESSAGES.robots;
      } else if (e.reason === 'http_status' && (e.status === 403 || e.status === 429 || e.status === 401 || e.status === 503)) {
        fetchStatus = 'blocked';
        message = MESSAGES.blocked;
      } else if (e.reason === 'http_status' && e.status === 404) {
        fetchStatus = 'not_product';
        message = 'La página no existe (404). Comprueba el enlace.';
      } else {
        fetchStatus = 'error';
        message = MESSAGES.error;
      }
    } else throw e;
  }
  const row = await trx
    .insertInto('imported_products')
    .values({
      user_id: userId,
      retailer_id: retailer?.id ?? null,
      url: url.toString(),
      canonical_url: canonical,
      external_id: externalIdFrom(url, data),
      data: JSON.stringify(data),
      image_urls: images,
      image_policy: await imagePolicyFor(trx, retailer?.id ?? null, 'link_import'),
      fetch_status: fetchStatus,
      fetch_message: message,
      verified_at: verifiedAt,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await trx.insertInto('import_sources').values({ user_id: userId, kind: 'link', detail: JSON.stringify({ importedProductId: row.id, retailer: retailer?.id ?? null, status: fetchStatus }) }).execute();
  businessEvents.inc({ event: 'link_import', outcome: fetchStatus });
  return importedToDto(trx, row);
}

/** Data captured on the user's device from the page they are viewing (in-app browser / Safari share). */
export async function importCapture(ctx: AppContext, trx: Tx, userId: string, body: PageCaptureRequest): Promise<ImportedProductDto> {
  let url: URL;
  try {
    url = validateUrl(body.url, true);
  } catch {
    throw badRequest('Enlace no válido.');
  }
  if (body.jsonLd.length > 20 || body.jsonLd.some((b) => b.length > 200_000)) throw badRequest('Los datos capturados son demasiado grandes.');
  const retailer = retailerForHost(url.hostname);
  const extracted = extractFromStructured({ jsonLd: body.jsonLd, meta: body.meta, microdata: body.microdata, title: body.title, baseUrl: url.toString() });
  // JSON-LD url (if any) must belong to the same site as the captured page.
  if (extracted.canonicalUrl) {
    try {
      const c = new URL(extracted.canonicalUrl, url);
      const base = (h: string) => h.replace(/^www\d?\./, '').split('.').slice(-2).join('.');
      if (base(c.hostname) !== base(url.hostname)) extracted.canonicalUrl = null;
    } catch {
      extracted.canonicalUrl = null;
    }
  }
  const data = toStored(extracted, retailer, 'page_capture');
  const fetchStatus = statusOf(data, extracted.isProductPage);
  const capturedAt = Number.isNaN(Date.parse(body.capturedAt)) ? new Date() : new Date(Math.min(Date.parse(body.capturedAt), Date.now()));
  const row = await trx
    .insertInto('imported_products')
    .values({
      user_id: userId,
      retailer_id: retailer?.id ?? null,
      url: url.toString(),
      canonical_url: extracted.canonicalUrl ?? url.toString(),
      external_id: externalIdFrom(url, data),
      data: JSON.stringify(data),
      image_urls: extracted.images?.value ?? [],
      image_policy: await imagePolicyFor(trx, retailer?.id ?? null, 'page_capture'),
      fetch_status: fetchStatus,
      fetch_message: fetchStatus === 'not_product' ? MESSAGES.not_product : fetchStatus === 'partial' ? MESSAGES.partial : null,
      verified_at: fetchStatus === 'not_product' ? null : capturedAt,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await trx.insertInto('import_sources').values({ user_id: userId, kind: 'page_capture', detail: JSON.stringify({ importedProductId: row.id, retailer: retailer?.id ?? null, status: fetchStatus }) }).execute();
  businessEvents.inc({ event: 'page_capture', outcome: fetchStatus });
  return importedToDto(trx, row);
}

export async function getImported(trx: Tx, id: string): Promise<Selectable<ImportedProducts>> {
  const row = await trx.selectFrom('imported_products').selectAll().where('id', '=', id).executeTakeFirst();
  if (!row) throw notFound('Producto importado');
  return row;
}

/** Add an imported product to the wardrobe. Only called after the user confirms they own it. */
export async function importedToWardrobe(ctx: AppContext, trx: Tx, userId: string, id: string, body: LinkToWardrobeRequest): Promise<string> {
  const row = await getImported(trx, id);
  const d = row.data as unknown as StoredData;
  const subcategory = body.overrides?.subcategory ?? d.subcategory?.value;
  if (!subcategory || !getSubcategory(subcategory)) throw badRequest('Indica qué tipo de prenda es (no hemos podido deducirlo con seguridad).');
  const family = body.overrides?.colors ? null : (d.colorFamily?.value ?? null);
  const famHex = family ? COLOR_FAMILIES.find((c) => c.id === family)?.hex : undefined;
  const garmentId = await createGarment(
    trx,
    userId,
    {
      name: body.overrides?.name ?? d.title?.value ?? getSubcategory(subcategory)!.label,
      subcategory,
      brand: body.overrides?.brand ?? d.brand?.value ?? null,
      size: body.size ?? body.overrides?.size ?? null,
      colors: body.overrides?.colors ?? (famHex ? [{ hex: famHex, share: 1 }] : undefined),
      materials: body.overrides?.materials ?? d.materials?.value,
      styles: body.overrides?.styles,
      seasons: body.overrides?.seasons,
      pattern: body.overrides?.pattern,
      fit: body.overrides?.fit,
      notes: body.overrides?.notes ?? null,
      purchaseDate: body.purchaseDate ?? null,
      purchasePriceCents: body.purchasePriceCents ?? d.price?.value.cents ?? null,
      imageId: body.imageId ?? null,
      tags: body.overrides?.tags,
    },
    {
      source: 'link',
      sourceUrl: row.canonical_url ?? row.url,
      importedProductId: row.id,
      attributeSource: row.retailer_id ? `retailer:${row.retailer_id}` : 'link',
      confidence: { subcategory: d.subcategory?.source === 'inferred' && !body.overrides?.subcategory ? 0.8 : 1, colors: family ? 0.7 : 1 },
    },
  );
  await trx
    .insertInto('purchases')
    .values({
      user_id: userId,
      garment_id: garmentId,
      imported_product_id: row.id,
      retailer_id: row.retailer_id,
      purchased_on: body.purchaseDate ?? null,
      price_cents: body.purchasePriceCents ?? d.price?.value.cents ?? null,
      size_label: body.size ?? null,
      source: 'link',
    })
    .execute();
  if (body.imageId) {
    const hasCutout = await trx.selectFrom('garment_images').select('id').where('parent_image_id', '=', body.imageId).where('kind', '=', 'cutout').executeTakeFirst();
    if (!hasCutout) await enqueueGarmentImageProcessing(ctx, trx, userId, garmentId, body.imageId);
  }
  businessEvents.inc({ event: 'garment_added', outcome: 'link' });
  return garmentId;
}

/** Background removal + embedding for a user photo attached to an existing garment (attributes untouched). */
export async function enqueueGarmentImageProcessing(ctx: AppContext, trx: Tx, userId: string, garmentId: string, imageId: string) {
  const job = await trx
    .insertInto('import_jobs')
    .values({ user_id: userId, kind: 'image_analysis', status: 'queued', total: 1, input: JSON.stringify({ imageIds: [imageId], mode: 'single', attachGarmentId: garmentId }) })
    .returning('id')
    .executeTakeFirstOrThrow();
  await ctx.queue.enqueueImageAnalysis({ importJobId: job.id, userId });
}
