import {
  getSubcategory,
  type DetectionDto,
  type GarmentWriteDto,
  type ImportJobDto,
  type PhotoImportRequest,
  type ReceiptImportResult,
  type ReceiptTextImportRequest,
} from '@dressit/shared';
import type { Selectable } from 'kysely';
import type { AppContext } from '../../context.ts';
import { parseVector, toVectorLiteral, type Tx } from '../../db/index.ts';
import type { ImportDetections, ImportJobs } from '../../db/types.ts';
import { badRequest, notFound } from '../../lib/errors.ts';
import { businessEvents } from '../../lib/metrics.ts';
import { imageRef } from '../wardrobe/mappers.ts';
import { createGarment } from '../wardrobe/service.ts';
import { RETAILERS, retailerForHost } from '../retail/registry.ts';
import { inferSubcategory } from '../retail/categorize.ts';
import { parsePrice } from '../retail/extract.ts';
import { loadImageBytes } from '../images/service.ts';

type Field<T> = { value: T; confidence: number; alternatives?: Array<{ value: T; confidence: number }> };
interface Predicted {
  category?: Field<string>;
  subcategory?: Field<string>;
  colors?: Array<{ hex: string; family: string; share: number }>;
  pattern?: Field<string>;
  materials?: Field<string[]>;
  styles?: Field<string[]>;
  seasons?: Field<string[]>;
  fit?: Field<string>;
}

export async function createPhotoImport(ctx: AppContext, trx: Tx, userId: string, body: PhotoImportRequest): Promise<string> {
  const ids = [...new Set(body.imageIds)];
  if (!ids.length || ids.length > 50) throw badRequest('Envía entre 1 y 50 fotos por lote.');
  const found = await trx.selectFrom('garment_images').select(['id', 'kind']).where('id', 'in', ids).execute();
  if (found.length !== ids.length || found.some((f) => f.kind !== 'original')) throw badRequest('Alguna foto no existe o no es una foto de prenda.');
  const consent = await trx.selectFrom('consents').select('granted').where('kind', '=', 'photo_processing').orderBy('created_at', 'desc').executeTakeFirst();
  if (consent && !consent.granted) throw badRequest('Has retirado el consentimiento para analizar tus fotos. Actívalo en Perfil → Privacidad para usar el reconocimiento automático.');
  const source = await trx.insertInto('import_sources').values({ user_id: userId, kind: body.source, detail: JSON.stringify({ count: ids.length, mode: body.mode }) }).returning('id').executeTakeFirstOrThrow();
  const job = await trx
    .insertInto('import_jobs')
    .values({ user_id: userId, source_id: source.id, kind: 'image_analysis', status: 'queued', total: ids.length, input: JSON.stringify({ imageIds: ids, mode: body.mode }) })
    .returning('id')
    .executeTakeFirstOrThrow();
  return job.id;
}

function detectionDto(ctx: AppContext, userId: string, d: Selectable<ImportDetections>, cutout: { id: string; width: number | null; height: number | null } | undefined): DetectionDto {
  return {
    id: d.id,
    imageId: d.image_id,
    cutout: cutout ? imageRef(ctx.signer, userId, { ...cutout, kind: 'cutout', license: 'user_owned', attribution: null }) : null,
    bbox: (d.bbox as DetectionDto['bbox']) ?? null,
    state: d.state as DetectionDto['state'],
    garmentId: d.garment_id,
    predicted: d.predicted as DetectionDto['predicted'],
    duplicate: (d.duplicate as DetectionDto['duplicate']) ?? null,
    warnings: d.warnings,
  };
}

export async function jobDto(ctx: AppContext, trx: Tx, userId: string, job: Selectable<ImportJobs>): Promise<ImportJobDto> {
  const dets = await trx.selectFrom('import_detections').selectAll().where('job_id', '=', job.id).orderBy('created_at').execute();
  const cutoutIds = dets.map((d) => d.cutout_image_id).filter((x): x is string => !!x);
  const cutouts = cutoutIds.length ? await trx.selectFrom('garment_images').select(['id', 'width', 'height']).where('id', 'in', cutoutIds).execute() : [];
  const byId = new Map(cutouts.map((c) => [c.id, c]));
  return {
    id: job.id,
    kind: job.kind as ImportJobDto['kind'],
    status: job.status as ImportJobDto['status'],
    progress: job.total ? Math.round((job.processed / job.total) * 100) / 100 : 0,
    total: job.total,
    processed: job.processed,
    detections: dets.map((d) => detectionDto(ctx, userId, d, d.cutout_image_id ? byId.get(d.cutout_image_id) : undefined)),
    error: job.error,
    createdAt: job.created_at.toISOString(),
    updatedAt: job.updated_at.toISOString(),
  };
}

export async function getJob(trx: Tx, id: string) {
  const job = await trx.selectFrom('import_jobs').selectAll().where('id', '=', id).executeTakeFirst();
  if (!job) throw notFound('Importación');
  return job;
}

async function refreshJobStatus(trx: Tx, jobId: string) {
  const pending = await trx.selectFrom('import_detections').select('id').where('job_id', '=', jobId).where('state', '=', 'pending').executeTakeFirst();
  if (!pending) await trx.updateTable('import_jobs').set({ status: 'completed', completed_at: new Date() }).where('id', '=', jobId).where('status', '=', 'needs_review').execute();
}

export async function acceptDetection(ctx: AppContext, trx: Tx, userId: string, jobId: string, detectionId: string, overrides: GarmentWriteDto = {}): Promise<string> {
  const job = await getJob(trx, jobId);
  const det = await trx.selectFrom('import_detections').selectAll().where('id', '=', detectionId).where('job_id', '=', jobId).executeTakeFirst();
  if (!det) throw notFound('Detección');
  if (det.state !== 'pending') throw badRequest('Esta detección ya se ha revisado.');
  const p = det.predicted as Predicted;
  const subcategory = overrides.subcategory ?? p.subcategory?.value;
  if (!subcategory || !getSubcategory(subcategory)) throw badRequest('Indica qué tipo de prenda es: no lo hemos identificado con seguridad.');
  const source = job.source_id ? await trx.selectFrom('import_sources').select('kind').where('id', '=', job.source_id).executeTakeFirst() : undefined;
  const garmentSource = (source?.kind === 'camera' || source?.kind === 'gallery' || source?.kind === 'batch' ? source.kind : 'gallery') as 'camera' | 'gallery' | 'batch';
  const conf: Record<string, number> = {};
  if (!overrides.subcategory && p.subcategory) conf.subcategory = p.subcategory.confidence;
  if (!overrides.subcategory && p.category) conf.category = p.category.confidence;
  if (!overrides.pattern && p.pattern) conf.pattern = p.pattern.confidence;
  if (!overrides.materials && p.materials) conf.materials = p.materials.confidence;
  if (!overrides.styles && p.styles) conf.styles = p.styles.confidence;
  if (!overrides.seasons && p.seasons) conf.seasons = p.seasons.confidence;
  if (!overrides.fit && p.fit) conf.fit = p.fit.confidence;
  if (!overrides.colors && p.colors) conf.colors = 0.85;
  const garmentId = await createGarment(
    trx,
    userId,
    {
      ...overrides,
      subcategory,
      colors: overrides.colors ?? p.colors?.map((c) => ({ hex: c.hex, share: c.share })),
      pattern: overrides.pattern ?? p.pattern?.value ?? null,
      materials: overrides.materials ?? p.materials?.value,
      styles: (overrides.styles ?? p.styles?.value) as GarmentWriteDto['styles'],
      seasons: (overrides.seasons ?? p.seasons?.value) as GarmentWriteDto['seasons'],
      fit: (overrides.fit ?? p.fit?.value ?? null) as GarmentWriteDto['fit'],
      imageId: det.image_id,
    },
    { source: garmentSource, attributeSource: 'vision', confidence: conf },
  );
  if (det.cutout_image_id) {
    await trx.updateTable('garment_images').set({ garment_id: garmentId }).where('id', '=', det.cutout_image_id).execute();
    await trx.updateTable('garments').set({ primary_image_id: det.cutout_image_id }).where('id', '=', garmentId).execute();
  }
  const emb = parseVector(det.embedding);
  if (emb?.length === 768) {
    await trx
      .insertInto('garment_embeddings')
      .values({ garment_id: garmentId, user_id: userId, image_id: det.cutout_image_id ?? det.image_id, model: det.embedding_model ?? 'unknown', embedding: toVectorLiteral(emb) })
      .execute();
  }
  await trx.updateTable('import_detections').set({ state: 'accepted', garment_id: garmentId }).where('id', '=', det.id).execute();
  await refreshJobStatus(trx, jobId);
  businessEvents.inc({ event: 'garment_added', outcome: garmentSource });
  return garmentId;
}

export async function rejectDetection(trx: Tx, jobId: string, detectionId: string) {
  const r = await trx.updateTable('import_detections').set({ state: 'rejected' }).where('id', '=', detectionId).where('job_id', '=', jobId).where('state', '=', 'pending').returning('id').executeTakeFirst();
  if (!r) throw notFound('Detección pendiente');
  await refreshJobStatus(trx, jobId);
}

/** Accepts all confident, non-duplicate detections; leaves the rest for manual review. */
export async function acceptAll(ctx: AppContext, trx: Tx, userId: string, jobId: string): Promise<{ accepted: number; garmentIds: string[] }> {
  const dets = await trx.selectFrom('import_detections').selectAll().where('job_id', '=', jobId).where('state', '=', 'pending').execute();
  const ids: string[] = [];
  for (const d of dets) {
    const p = d.predicted as Predicted;
    if (!p.subcategory || d.duplicate) continue;
    ids.push(await acceptDetection(ctx, trx, userId, jobId, d.id, {}));
  }
  return { accepted: ids.length, garmentIds: ids };
}

// ---------------------------------------------------------------------------
// Receipts, e-mails, labels, screenshots (text recognised on-device or by OCR)
// ---------------------------------------------------------------------------

const EAN_RE = /\b(\d{13}|\d{8})\b/g;
const URL_RE = /https?:\/\/[^\s<>"')]+/gi;
const PRICE_RE = /(\d{1,4}(?:[.,]\d{2}))\s?(?:€|eur)/i;
const SIZE_RE = /\b(?:talla|size|t\.)\s*[:\-]?\s*(XXS|XS|S|M|L|XL|XXL|\d{2}(?:[.,]5)?)\b/i;
const ORDER_RE = /(?:pedido|order|n[.ºo°]*\s*de\s*pedido|ticket|factura)\s*[:#nº°.]*\s*([A-Z0-9-]{5,})/i;
const DATE_RE = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/;

export function validEan(code: string): boolean {
  if (!/^\d{8}$|^\d{13}$/.test(code)) return false;
  const digits = code.split('').map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((a, d, i) => a + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

export async function parseReceiptText(ctx: AppContext, trx: Tx, body: ReceiptTextImportRequest): Promise<ReceiptImportResult> {
  let text = body.text?.trim() ?? '';
  const warnings: string[] = [];
  if (!text && body.imageId) {
    const img = await loadImageBytes(ctx, trx, body.imageId);
    try {
      text = (await ctx.vision.ocr(img.body, img.mime)).text;
    } catch {
      warnings.push('El reconocimiento de texto no está disponible ahora; pega el texto o inténtalo más tarde.');
    }
  }
  if (!text) return { retailer: null, orderRef: null, purchaseDate: null, lines: [], productUrls: [], warnings: [...warnings, 'No hay texto que analizar.'] };
  text = text.slice(0, 50_000);
  const urls = [...new Set((text.match(URL_RE) ?? []).map((u) => u.replace(/[.,;]+$/, '')))];
  const productUrls = urls.filter((u) => {
    try {
      return retailerForHost(new URL(u).hostname) !== null;
    } catch {
      return false;
    }
  });
  const lower = text.toLowerCase();
  const retailer = RETAILERS.find((r) => lower.includes(r.name.toLowerCase()) || r.domains.some((d) => lower.includes(d))) ?? (productUrls[0] ? retailerForHost(new URL(productUrls[0]).hostname) : null);
  const order = ORDER_RE.exec(text)?.[1] ?? null;
  const dm = DATE_RE.exec(text);
  let purchaseDate: string | null = null;
  if (dm) {
    const y = dm[3]!.length === 2 ? `20${dm[3]}` : dm[3]!;
    const iso = `${y}-${dm[2]!.padStart(2, '0')}-${dm[1]!.padStart(2, '0')}`;
    if (!Number.isNaN(Date.parse(iso))) purchaseDate = iso;
  }
  const lines: ReceiptImportResult['lines'] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length < 4) continue;
    const eans = [...line.matchAll(EAN_RE)].map((m) => m[1]!).filter(validEan);
    const guess = inferSubcategory(line);
    const price = PRICE_RE.exec(line);
    if (!guess && !eans.length) continue;
    const ean = eans[0] ?? null;
    let catalogProductId: string | null = null;
    if (ean) {
      const v = await trx.selectFrom('product_variants').select('product_id').where('gtin', '=', ean.padStart(13, '0')).executeTakeFirst();
      catalogProductId = v?.product_id ?? null;
    }
    lines.push({
      description: line.slice(0, 200),
      reference: /\b\d{4}\/\d{3}\/\d{3}\b/.exec(line)?.[0] ?? null,
      ean,
      size: SIZE_RE.exec(line)?.[1] ?? null,
      colorName: null,
      priceCents: price ? parsePrice(price[1]!) : null,
      productUrl: null,
      catalogProductId,
    });
  }
  if (!lines.length && !productUrls.length) warnings.push('No hemos reconocido artículos de ropa en el texto. Puedes añadirlos manualmente.');
  if (lines.some((l) => l.ean && !l.catalogProductId)) warnings.push('Algunos códigos EAN no están en los catálogos autorizados conectados; añade una foto para completarlos.');
  return { retailer: retailer ? { id: retailer.id, name: retailer.name, group: retailer.group } : null, orderRef: order, purchaseDate, lines: lines.slice(0, 60), productUrls: productUrls.slice(0, 30), warnings };
}
