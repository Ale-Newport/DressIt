/**
 * Catalogue photo of a garment ("foto de catálogo"). Asynchronous pipeline per garment/detection:
 *
 *  1. read the garment (labels, logos) with OCR → brand, text, reference codes;
 *  2. search the product: authorised catalogues (FashionSigLIP, no external call) and, with the
 *     `visual_search_external` consent, Google Lens (SerpApi), Cloud Vision Web Detection and Lykdat,
 *     each with the garment crop and the whole photo (cached per photo; daily limits and budget);
 *  3. verify the best candidates: download their photo (SSRF-safe), read the store page when allowed
 *     (structured data → more official photos, brand, colour), and compare every photo with the
 *     user's garment (vision /v1/catalog/check): exact (verified + independent evidence) or
 *     possible (shown to the user, never chosen automatically);
 *  4. with no usable exact official photo (or on request) generate a packshot from the user's photo
 *     with the configured models (FASHN → fal.ai → ComfyUI), check presentation AND fidelity, retry
 *     with corrections (up to PACKSHOT_MAX_ATTEMPTS) and ask the user when it still fails;
 *  5. the user compares original / official / generated and chooses; the wardrobe is updated and the
 *     user's own photos are kept.
 */
import { createHash, randomUUID } from 'node:crypto';
import {
  getSubcategory,
  type CatalogAttemptDto,
  type CatalogCheckDto,
  type CatalogMatchDto,
  type CatalogPhotoChoiceRequest,
  type CatalogPhotoDto,
  type CatalogPhotoServiceStatusDto,
  type CatalogPhotoSummaryDto,
  type CatalogProviderStateDto,
  type OfficialPhotoUsage,
} from '@dressit/shared';
import { sql, type Selectable } from 'kysely';
import sharp from 'sharp';
import type { Config } from '../../config.ts';
import type { AppContext } from '../../context.ts';
import { parseVector, withUser, type Tx } from '../../db/index.ts';
import type { CatalogPhotoJobs } from '../../db/types.ts';
import { badRequest, notFound } from '../../lib/errors.ts';
import { businessEvents } from '../../lib/metrics.ts';
import { safeFetch } from '../../lib/safe-fetch.ts';
import type { AttemptInfo, CatalogPhotoJob } from '../../jobs/queue.ts';
import { nearestProducts } from '../catalog/service.ts';
import { dHash, loadImageBytes, storeCutout, storeGenerated } from '../images/service.ts';
import type { ImageGenerator } from '../imagegen/generator.ts';
import { extractFromHtml } from '../retail/extract.ts';
import type { CatalogCheckResult } from '../vision/client.ts';
import { imageRef } from '../wardrobe/mappers.ts';
import { createPackshotGenerators, GenerationError, type PackshotGenerator } from './generate.ts';
import { judgeMatch, labelWords, mergeCandidates, recognise, textOnLabelMatches, type MergedCandidate, type Recognised } from './matching.ts';
import { buildPackshotPrompt, type GarmentDescription } from './prompt.ts';
import { CloudVisionWeb, LykdatSearch, SearchError, SerpApiLens, type SearchProvider, type WebCandidate } from './search.ts';

export interface CatalogPhotoProviders {
  search: SearchProvider[];
  generators: PackshotGenerator[];
}

export function createCatalogPhotoProviders(cfg: Config, imagegen: ImageGenerator, fetcher?: typeof fetch): CatalogPhotoProviders {
  return {
    search: [
      new SerpApiLens({ apiKey: cfg.SERPAPI_API_KEY, country: cfg.SERPAPI_COUNTRY, hl: cfg.SERPAPI_HL, costCents: cfg.SERPAPI_COST_CENTS, fetcher }),
      new CloudVisionWeb({ apiKey: cfg.GOOGLE_CLOUD_VISION_API_KEY, costCents: cfg.GOOGLE_CLOUD_VISION_COST_CENTS, fetcher }),
      new LykdatSearch({ apiKey: cfg.LYKDAT_API_KEY, costCents: cfg.LYKDAT_COST_CENTS, fetcher }),
    ],
    generators: createPackshotGenerators(cfg, imagegen, fetcher),
  };
}

const ACTIVE = ['queued', 'searching', 'generating'] as const;
const CANVAS = { width: 896, height: 1120 }; // 4:5, ~1 MP
const VERIFY_MAX = 6;

type JobRow = Selectable<CatalogPhotoJobs>;

interface StoredMatch {
  id: string;
  provider: MergedCandidate['provider'];
  verdict: 'exact' | 'possible';
  title: string | null;
  brand: string | null;
  retailer: string | null;
  retailerId: string | null;
  domain: string | null;
  pageUrl: string | null;
  imageUrl: string;
  price: { cents: number; currency: string } | null;
  similarity: number;
  evidence: string[];
  doubts: string[];
  usage: OfficialPhotoUsage;
  studioLike: boolean;
  catalogProductId?: string;
}

interface StoredAttempt extends CatalogAttemptDto {
  codes: string[];
  imageId?: string | null;
}

interface GenerationState {
  attempts?: StoredAttempt[];
  passed?: boolean;
  model?: string | null;
  promptVersion?: string;
  skipped?: string | null;
}

interface SearchState {
  providers?: CatalogProviderStateDto[];
  recognised?: Recognised;
}

interface JobInput {
  force?: boolean;
  pendingChoice?: CatalogPhotoChoiceRequest | null;
}

// ---------------------------------------------------------------------------
// Status, consent, limits
// ---------------------------------------------------------------------------

export async function catalogPhotoStatus(ctx: AppContext): Promise<CatalogPhotoServiceStatusDto> {
  const gens = await Promise.all(
    ctx.catalogPhoto.generators.map(async (g) => ({ id: g.id, label: g.label, model: g.model, configured: g.configured, available: await g.available().catch(() => false), missing: g.configured ? [] : g.requires })),
  );
  return {
    auto: ctx.cfg.CATALOG_PHOTO_AUTO,
    search: [
      { id: 'catalog' as const, label: 'Catálogos autorizados', configured: true, missing: [] },
      ...ctx.catalogPhoto.search.map((s) => ({ id: s.id, label: s.label, configured: s.configured, missing: s.configured ? [] : s.requires })),
    ],
    generation: gens,
    webImages: ctx.cfg.OFFICIAL_PHOTO_WEB_IMAGES,
    limits: {
      searchesPerDay: ctx.cfg.CATALOG_DAILY_SEARCHES_PER_USER,
      generationsPerDay: ctx.cfg.CATALOG_DAILY_GENERATIONS_PER_USER,
      monthlyBudgetCents: ctx.cfg.CATALOG_MONTHLY_BUDGET_CENTS,
      maxAttempts: ctx.cfg.PACKSHOT_MAX_ATTEMPTS,
    },
  };
}

async function consent(trx: Tx, kind: string): Promise<boolean> {
  const row = await trx.selectFrom('consents').select('granted').where('kind', '=', kind).orderBy('created_at', 'desc').limit(1).executeTakeFirst();
  return row?.granted === true;
}

/** Can this user spend one more paid call on `provider` today, within the monthly budget? */
async function allowance(ctx: AppContext, trx: Tx, kind: 'search' | 'generation', costCents: number): Promise<string | null> {
  if (costCents > 0) {
    const spent = Number((await sql<{ c: string }>`select external_api_month_cost() as c`.execute(trx)).rows[0]?.c ?? 0);
    if (spent + costCents > ctx.cfg.CATALOG_MONTHLY_BUDGET_CENTS) return 'Se ha alcanzado el presupuesto mensual de este servicio.';
  }
  const limit = kind === 'search' ? ctx.cfg.CATALOG_DAILY_SEARCHES_PER_USER : ctx.cfg.CATALOG_DAILY_GENERATIONS_PER_USER;
  const providers = kind === 'search' ? ['serpapi_lens', 'cloud_vision', 'lykdat'] : ['fashn', 'fal', 'comfy'];
  const used = await trx.selectFrom('external_api_usage').select((eb) => eb.fn.coalesce(eb.fn.sum<number>('calls'), sql<number>`0`).as('n')).where('provider', 'in', providers).where('day', '=', sql<string>`current_date`).executeTakeFirst();
  if (Number(used?.n ?? 0) >= limit) return kind === 'search' ? 'Has llegado al límite diario de búsquedas de fotos oficiales.' : 'Has llegado al límite diario de fotos generadas.';
  return null;
}

async function recordUsage(ctx: AppContext, userId: string, provider: string, costCents: number) {
  await withUser(ctx.db, userId, (trx) =>
    trx
      .insertInto('external_api_usage')
      .values({ user_id: userId, provider, calls: 1, cost_cents: String(costCents) })
      .onConflict((oc) => oc.columns(['user_id', 'provider', 'day']).doUpdateSet({ calls: sql`external_api_usage.calls + 1`, cost_cents: sql`external_api_usage.cost_cents + ${costCents}` }))
      .execute(),
  );
}

// ---------------------------------------------------------------------------
// Creating jobs
// ---------------------------------------------------------------------------

async function busyJob(trx: Tx, by: { garmentId?: string; detectionId?: string }) {
  let q = trx.selectFrom('catalog_photo_jobs').select('id').where('status', 'in', [...ACTIVE]);
  if (by.garmentId) q = q.where('garment_id', '=', by.garmentId);
  if (by.detectionId) q = q.where('detection_id', '=', by.detectionId);
  return q.executeTakeFirst();
}

/** Automatic job for a new detection of a photo import. Returns null when nothing should run. */
export async function createForDetection(ctx: AppContext, trx: Tx, userId: string, detectionId: string): Promise<string | null> {
  if (!ctx.cfg.CATALOG_PHOTO_AUTO) return null;
  const det = await trx.selectFrom('import_detections').select(['id', 'image_id', 'cutout_image_id', 'bbox', 'state']).where('id', '=', detectionId).executeTakeFirst();
  if (!det?.cutout_image_id || det.state !== 'pending') return null;
  if (await busyJob(trx, { detectionId })) return null;
  const row = await trx
    .insertInto('catalog_photo_jobs')
    .values({ user_id: userId, detection_id: det.id, source_image_id: det.image_id, cutout_image_id: det.cutout_image_id, bbox: det.bbox ? JSON.stringify(det.bbox) : null, trigger: 'import', mode: 'auto' })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

/** `POST /v1/garments/:id/catalog-photo`: search and/or generate again for an existing garment. */
export async function createForGarment(ctx: AppContext, trx: Tx, userId: string, garmentId: string, opts: { mode?: 'auto' | 'search' | 'generate'; force?: boolean } = {}): Promise<{ id: string; created: boolean }> {
  const g = await trx.selectFrom('garments').select(['id', 'primary_image_id', 'is_demo']).where('id', '=', garmentId).executeTakeFirst();
  if (!g) throw notFound('Prenda');
  const busy = await busyJob(trx, { garmentId });
  if (busy) return { id: busy.id, created: false }; // already being prepared: not queued twice
  // The user's own cutout and the photo it came from (never a generated or store image).
  const cutout = await trx
    .selectFrom('garment_images')
    .select(['id', 'parent_image_id'])
    .where('garment_id', '=', garmentId)
    .where('kind', '=', 'cutout')
    .where('license', '=', 'user_owned')
    .where('generated_by', 'is', null)
    .orderBy(sql`(id = ${g.primary_image_id ?? '00000000-0000-0000-0000-000000000000'})`, 'desc')
    .orderBy('created_at', 'desc')
    .executeTakeFirst();
  const source = cutout?.parent_image_id
    ? { id: cutout.parent_image_id }
    : await trx.selectFrom('garment_images').select('id').where('garment_id', '=', garmentId).where('kind', '=', 'original').orderBy('created_at', 'desc').executeTakeFirst();
  if (!cutout || !source) throw badRequest('Esta prenda no tiene una foto tuya recortada. Añade una foto de la prenda primero.');
  const det = await trx.selectFrom('import_detections').select(['bbox']).where('cutout_image_id', '=', cutout.id).executeTakeFirst();
  const prev = await trx.selectFrom('catalog_photo_jobs').selectAll().where('garment_id', '=', garmentId).where('status', '!=', 'dismissed').orderBy('created_at', 'desc').executeTakeFirst();
  const mode = opts.mode ?? 'auto';
  // A new job only redoes its own step: "generate again" keeps the official photos found before and
  // "search again" keeps the packshot already made.
  const prevSearch = (prev?.search ?? {}) as SearchState;
  const keepSearch = mode === 'generate' && prev;
  const keepGeneration = mode === 'search' && prev;
  const row = await trx
    .insertInto('catalog_photo_jobs')
    .values({
      user_id: userId,
      garment_id: garmentId,
      source_image_id: source.id,
      cutout_image_id: cutout.id,
      bbox: det?.bbox ? JSON.stringify(det.bbox) : null,
      trigger: prev ? 'regenerate' : 'manual',
      mode,
      search: JSON.stringify({ ...(keepSearch ? { providers: prevSearch.providers, recognised: prevSearch.recognised } : {}), input: { force: !!opts.force } }),
      candidates: keepSearch ? JSON.stringify(prev.candidates) : '[]',
      official_match_id: keepSearch ? prev.official_match_id : null,
      official_image_id: keepSearch ? prev.official_image_id : null,
      generated_image_id: keepGeneration ? prev.generated_image_id : null,
      generation: keepGeneration ? JSON.stringify(prev.generation) : '{}',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return { id: row.id, created: true };
}

/** A detection became a garment: the job follows it, and a choice made in the review is applied. */
export async function linkDetectionToGarment(ctx: AppContext, trx: Tx, userId: string, detectionId: string, garmentId: string): Promise<void> {
  const job = await trx.selectFrom('catalog_photo_jobs').selectAll().where('detection_id', '=', detectionId).orderBy('created_at', 'desc').executeTakeFirst();
  if (!job) return;
  await trx.updateTable('catalog_photo_jobs').set({ garment_id: garmentId }).where('id', '=', job.id).execute();
  const images = [job.generated_image_id, job.official_image_id].filter((x): x is string => !!x);
  if (images.length) await trx.updateTable('garment_images').set({ garment_id: garmentId }).where('id', 'in', images).execute();
  const pending = (job.search as { input?: JobInput }).input?.pendingChoice;
  if (pending && (job.status === 'ready' || job.status === 'needs_user')) {
    // Adding the garment must not fail because the store photo could not be downloaded: the choice
    // stays pending on the garment's catalogue photo for the user to retry.
    await choose(ctx, trx, userId, job.id, pending).catch(() => undefined);
  }
}

/** The detection was rejected: nothing more is spent on it. */
export async function dismissForDetection(trx: Tx, detectionId: string): Promise<void> {
  await trx.updateTable('catalog_photo_jobs').set({ status: 'dismissed', finished_at: new Date() }).where('detection_id', '=', detectionId).where('status', 'in', [...ACTIVE, 'ready', 'needs_user']).execute();
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

const checkDto = (c: CatalogCheckResult | null | undefined): CatalogCheckDto | null =>
  c
    ? {
        passed: c.presentation.passed && c.fidelity.passed,
        presentationPassed: c.presentation.passed,
        fidelityPassed: c.fidelity.passed,
        similarity: c.fidelity.similarity,
        symmetry: c.presentation.symmetry,
        neat: c.presentation.neat,
        paletteDeltaE: c.fidelity.palette_emd,
        textMatch: c.fidelity.text_match,
        reasons: [...c.presentation.reasons, ...c.fidelity.reasons],
      }
    : null;

const matchDto = (m: StoredMatch): CatalogMatchDto => ({
  id: m.id,
  provider: m.provider,
  verdict: m.verdict,
  title: m.title,
  brand: m.brand,
  retailer: m.retailer,
  domain: m.domain,
  pageUrl: m.pageUrl,
  imageUrl: m.imageUrl,
  price: m.price,
  similarity: m.similarity,
  evidence: m.evidence,
  doubts: m.doubts,
  usage: m.usage,
  studioLike: m.studioLike,
});

async function imgRef(ctx: AppContext, trx: Tx, userId: string, id: string | null) {
  if (!id) return null;
  const img = await trx.selectFrom('garment_images').selectAll().where('id', '=', id).executeTakeFirst();
  return img ? imageRef(ctx.signer, userId, img) : null;
}

/** A choice made in the review, before the garment exists (applied when it is created). */
const pendingChoice = (row: JobRow) => (row.search as { input?: JobInput }).input?.pendingChoice?.choice ?? null;

export async function jobDto(ctx: AppContext, trx: Tx, userId: string, row: JobRow): Promise<CatalogPhotoDto> {
  const matches = (row.candidates as unknown as StoredMatch[]) ?? [];
  const gen = (row.generation as GenerationState) ?? {};
  const search = (row.search as SearchState) ?? {};
  const official = matches.find((m) => m.id === row.official_match_id) ?? null;
  const attempts = gen.attempts ?? [];
  const best = attempts.find((a) => a.imageId && a.imageId === row.generated_image_id);
  return {
    id: row.id,
    garmentId: row.garment_id,
    detectionId: row.detection_id,
    status: row.status as CatalogPhotoDto['status'],
    stage: (ACTIVE as readonly string[]).includes(row.status) ? ((row.stage as CatalogPhotoDto['stage']) ?? null) : null,
    original: await imgRef(ctx, trx, userId, row.cutout_image_id),
    official: official ? matchDto(official) : null,
    alternatives: matches.filter((m) => m.id !== row.official_match_id).slice(0, 4).map(matchDto),
    generated: await imgRef(ctx, trx, userId, row.generated_image_id),
    generatedCheck: best?.check ?? null,
    attempts: attempts.map(({ codes: _c, imageId: _i, ...a }) => a),
    providers: search.providers ?? [],
    recognised: { brand: search.recognised?.brand ?? null, text: search.recognised?.text ?? null, reference: search.recognised?.references?.[0] ?? null },
    choice: (row.choice ?? pendingChoice(row)) as CatalogPhotoDto['choice'],
    message: row.message,
    error: row.error,
    createdAt: row.created_at.toISOString(),
    finishedAt: row.finished_at?.toISOString() ?? null,
  };
}

export async function summaryDto(ctx: AppContext, trx: Tx, userId: string, row: JobRow): Promise<CatalogPhotoSummaryDto> {
  const matches = (row.candidates as unknown as StoredMatch[]) ?? [];
  // Only a verified official photo is offered as a one-tap choice in the review queue.
  const official = matches.find((m) => m.id === row.official_match_id) ?? null;
  return {
    id: row.id,
    status: row.status as CatalogPhotoSummaryDto['status'],
    stage: (ACTIVE as readonly string[]).includes(row.status) ? ((row.stage as CatalogPhotoSummaryDto['stage']) ?? null) : null,
    official: official && official.usage !== 'reference_only' ? { imageUrl: official.imageUrl, retailer: official.retailer, verdict: official.verdict } : null,
    generated: await imgRef(ctx, trx, userId, row.generated_image_id),
    generatedPassed: (row.generation as GenerationState)?.passed === true,
    choice: (row.choice ?? pendingChoice(row)) as CatalogPhotoSummaryDto['choice'],
    message: row.message,
  };
}

export async function getJob(ctx: AppContext, trx: Tx, userId: string, id: string): Promise<CatalogPhotoDto> {
  const row = await trx.selectFrom('catalog_photo_jobs').selectAll().where('id', '=', id).executeTakeFirst();
  if (!row) throw notFound('Foto de catálogo');
  return jobDto(ctx, trx, userId, row);
}

export async function latestForGarment(ctx: AppContext, trx: Tx, userId: string, garmentId: string): Promise<CatalogPhotoDto | null> {
  const row = await trx.selectFrom('catalog_photo_jobs').selectAll().where('garment_id', '=', garmentId).where('status', '!=', 'dismissed').orderBy('created_at', 'desc').executeTakeFirst();
  return row ? jobDto(ctx, trx, userId, row) : null;
}

export async function summariesForDetections(ctx: AppContext, trx: Tx, userId: string, detectionIds: string[]): Promise<Map<string, CatalogPhotoSummaryDto>> {
  const out = new Map<string, CatalogPhotoSummaryDto>();
  if (!detectionIds.length) return out;
  const rows = await trx.selectFrom('catalog_photo_jobs').selectAll().where('detection_id', 'in', detectionIds).orderBy('created_at', 'desc').execute();
  for (const r of rows) if (r.detection_id && !out.has(r.detection_id)) out.set(r.detection_id, await summaryDto(ctx, trx, userId, r));
  return out;
}

// ---------------------------------------------------------------------------
// Choosing
// ---------------------------------------------------------------------------

async function storeOfficial(ctx: AppContext, trx: Tx, userId: string, garmentId: string | null, m: StoredMatch): Promise<string> {
  const attribution = `Foto oficial de ${m.retailer ?? m.domain ?? 'la tienda'}`;
  if (m.usage === 'link_preview') {
    // Shown by reference from the store (never copied): the row only records the link and its source.
    const id = randomUUID();
    await trx
      .insertInto('garment_images')
      .values({
        id,
        user_id: userId,
        garment_id: garmentId,
        kind: 'product_reference',
        storage_key: `remote:${createHash('sha256').update(m.imageUrl).digest('hex').slice(0, 32)}`,
        mime: 'image/remote',
        sha256: createHash('sha256').update(m.imageUrl).digest('hex'),
        license: 'retailer_link_preview',
        attribution,
        source_url: m.imageUrl,
      })
      .execute();
    return id;
  }
  // Licensed (authorised feed): a copy, and its cutout for flat lays.
  const res = await safeFetch(m.imageUrl, { userAgent: ctx.cfg.LINK_IMPORT_USER_AGENT, timeoutMs: ctx.cfg.LINK_IMPORT_TIMEOUT_MS, maxBytes: 8_000_000, allowedContentTypes: /^image\//, accept: 'image/*', allowPrivate: ctx.cfg.LINK_IMPORT_ALLOW_PRIVATE });
  const normalized = await sharp(res.raw).rotate().resize(2048, 2048, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer({ resolveWithObject: true });
  const thumb = await sharp(normalized.data).resize(480, 480, { fit: 'inside' }).webp({ quality: 82 }).toBuffer();
  const id = randomUUID();
  await ctx.storage.put(`u/${userId}/${id}/official.jpg`, normalized.data, 'image/jpeg');
  await ctx.storage.put(`u/${userId}/${id}/thumb.webp`, thumb, 'image/webp');
  await trx
    .insertInto('garment_images')
    .values({
      id,
      user_id: userId,
      garment_id: garmentId,
      kind: 'product_reference',
      storage_key: `u/${userId}/${id}/official.jpg`,
      thumb_storage_key: `u/${userId}/${id}/thumb.webp`,
      mime: 'image/jpeg',
      width: normalized.info.width,
      height: normalized.info.height,
      bytes: normalized.data.length,
      sha256: createHash('sha256').update(normalized.data).digest('hex'),
      phash: await dHash(normalized.data),
      license: 'retailer_licensed',
      attribution,
      source_url: m.pageUrl ?? m.imageUrl,
    })
    .execute();
  // Its cutout (same licence and attribution) is what flat lays and outfit canvases draw.
  try {
    const item = (await ctx.vision.analyze(normalized.data, 'image/jpeg', 'single', 1, { normalize: false })).items[0];
    if (item?.cutout_png_base64) {
      const cutoutId = await storeCutout(ctx, trx, userId, id, Buffer.from(item.cutout_png_base64, 'base64'));
      await trx.updateTable('garment_images').set({ garment_id: garmentId, license: 'retailer_licensed', attribution, source_url: m.pageUrl ?? m.imageUrl }).where('id', '=', cutoutId).execute();
      return cutoutId;
    }
  } catch {
    /* without the vision service the copy itself is used */
  }
  return id;
}

/** `POST /v1/catalog-photos/:id/choose`: the user's decision updates the garment (photos are kept). */
export async function choose(ctx: AppContext, trx: Tx, userId: string, jobId: string, body: CatalogPhotoChoiceRequest): Promise<CatalogPhotoDto> {
  const job = await trx.selectFrom('catalog_photo_jobs').selectAll().where('id', '=', jobId).executeTakeFirst();
  if (!job) throw notFound('Foto de catálogo');
  if ((ACTIVE as readonly string[]).includes(job.status)) throw badRequest('Todavía estamos preparando la foto de catálogo.');
  const matches = (job.candidates as unknown as StoredMatch[]) ?? [];
  const gen = (job.generation as GenerationState) ?? {};
  let primary: string | null = null;
  let officialImageId = job.official_image_id;
  let officialMatchId = job.official_match_id;
  if (body.choice === 'generated') {
    if (!job.generated_image_id) throw badRequest('No hay foto generada para esta prenda.');
    if (!gen.passed && !body.acceptWarnings) throw badRequest('La foto generada no ha superado todas las comprobaciones. Revisa los motivos y confirma si quieres usarla igualmente.');
    primary = job.generated_image_id;
  } else if (body.choice === 'official') {
    const m = matches.find((x) => x.id === (body.matchId ?? job.official_match_id));
    if (!m) throw badRequest('Esa foto oficial no es una coincidencia de esta prenda.');
    if (m.usage === 'reference_only') throw badRequest('Esta tienda no permite usar su foto: puedes abrir el producto en su web.');
    if (!job.garment_id) {
      // Still in review: remember the choice, applied when the garment is created.
      await trx.updateTable('catalog_photo_jobs').set({ search: JSON.stringify({ ...(job.search as object), input: { ...((job.search as { input?: JobInput }).input ?? {}), pendingChoice: body } }) }).where('id', '=', job.id).execute();
      return getJob(ctx, trx, userId, job.id);
    }
    if (officialMatchId !== m.id || !officialImageId) {
      officialImageId = await storeOfficial(ctx, trx, userId, job.garment_id, m);
      officialMatchId = m.id;
    }
    primary = officialImageId;
    // What the store says about the product fills only what the user had not set.
    const g = await trx.selectFrom('garments').select(['brand', 'model', 'source_url']).where('id', '=', job.garment_id).executeTakeFirst();
    await trx
      .updateTable('garments')
      .set({ brand: g?.brand ?? m.brand ?? (m.retailerId && m.retailer ? m.retailer : null), model: g?.model ?? m.title?.slice(0, 200) ?? null, source_url: g?.source_url ?? m.pageUrl })
      .where('id', '=', job.garment_id)
      .execute();
  } else {
    primary = job.cutout_image_id ?? job.source_image_id;
  }
  if (!job.garment_id) {
    await trx.updateTable('catalog_photo_jobs').set({ search: JSON.stringify({ ...(job.search as object), input: { ...((job.search as { input?: JobInput }).input ?? {}), pendingChoice: body } }) }).where('id', '=', job.id).execute();
    return getJob(ctx, trx, userId, job.id);
  }
  if (primary) {
    await trx.updateTable('garment_images').set({ garment_id: job.garment_id }).where('id', '=', primary).where('garment_id', 'is', null).execute();
    await trx.updateTable('garments').set({ primary_image_id: primary }).where('id', '=', job.garment_id).execute();
  }
  await trx
    .updateTable('catalog_photo_jobs')
    .set({ choice: body.choice, status: 'confirmed', official_image_id: officialImageId, official_match_id: officialMatchId, finished_at: job.finished_at ?? new Date() })
    .where('id', '=', job.id)
    .execute();
  businessEvents.inc({ event: 'catalog_photo_choice', outcome: body.choice });
  return getJob(ctx, trx, userId, job.id);
}

// ---------------------------------------------------------------------------
// Processing
// ---------------------------------------------------------------------------

/**
 * Worker writes. They only apply while the job is still being worked on: a job the user dismissed
 * (detection rejected) or confirmed meanwhile is never overwritten.
 */
async function update(ctx: AppContext, userId: string, id: string, set: Record<string, unknown>): Promise<boolean> {
  // Objects/arrays go to jsonb columns; dates and SQL expressions (`sql\`…\``) pass through.
  const json = (v: unknown) => (v !== null && typeof v === 'object' && !(v instanceof Date) && !('toOperationNode' in v) ? JSON.stringify(v) : v);
  const r = await withUser(ctx.db, userId, (trx) =>
    trx
      .updateTable('catalog_photo_jobs')
      .set(Object.fromEntries(Object.entries(set).map(([k, v]) => [k, json(v)])) as never)
      .where('id', '=', id)
      .where('status', 'in', [...ACTIVE])
      .executeTakeFirst(),
  );
  return Number(r.numUpdatedRows) > 0;
}

async function stillWanted(ctx: AppContext, userId: string, id: string): Promise<boolean> {
  const r = await withUser(ctx.db, userId, (trx) => trx.selectFrom('catalog_photo_jobs').select('status').where('id', '=', id).executeTakeFirst());
  return !!r && r.status !== 'dismissed';
}

interface Material {
  job: JobRow;
  photo: Buffer;
  photoMime: string;
  cutout: Buffer;
  /** The garment's region of the photo (search query «crop», OCR). */
  crop: Buffer;
  generatorInput: Buffer;
  bbox: [number, number, number, number] | null;
  desc: GarmentDescription;
  embedding: number[] | null;
  consents: { external: boolean; generation: boolean };
  multiInPhoto: boolean;
}

async function loadMaterial(ctx: AppContext, userId: string, id: string): Promise<Material | null> {
  return withUser(ctx.db, userId, async (trx) => {
    const job = await trx.selectFrom('catalog_photo_jobs').selectAll().where('id', '=', id).executeTakeFirst();
    if (!job || !job.cutout_image_id) return null;
    const photo = await loadImageBytes(ctx, trx, job.source_image_id);
    const cutoutRow = await trx.selectFrom('garment_images').select(['storage_key']).where('id', '=', job.cutout_image_id).executeTakeFirst();
    const cutout = cutoutRow ? await ctx.storage.get(cutoutRow.storage_key) : null;
    if (!cutout) return null;
    let desc: GarmentDescription;
    let embedding: number[] | null = null;
    if (job.garment_id) {
      const g = await trx.selectFrom('garments').selectAll().where('id', '=', job.garment_id).executeTakeFirstOrThrow();
      const colors = (g.colors as unknown as Array<{ family: string; share: number }>) ?? [];
      desc = { category: g.category, subcategory: g.subcategory, colors, pattern: g.pattern, materials: g.materials, text: null, brand: g.brand };
      const e = await trx.selectFrom('garment_embeddings').select(sql<string>`embedding::text`.as('e')).where('garment_id', '=', g.id).executeTakeFirst();
      embedding = parseVector(e?.e ?? null);
    } else {
      const d = await trx.selectFrom('import_detections').select(['predicted', sql<string>`embedding::text`.as('e')]).where('id', '=', job.detection_id!).executeTakeFirstOrThrow();
      const p = d.predicted as { category?: { value: string }; subcategory?: { value: string }; colors?: Array<{ family: string; share: number }>; pattern?: { value: string }; materials?: { value: string[] } };
      const sub = p.subcategory?.value ?? 'top';
      desc = { category: p.category?.value ?? getSubcategory(sub)?.category ?? 'top', subcategory: sub, colors: p.colors ?? [], pattern: p.pattern?.value ?? null, materials: p.materials?.value ?? [], text: null, brand: null };
      embedding = parseVector(d.e);
    }
    const siblings = await trx.selectFrom('import_detections').select('id').where('image_id', '=', job.source_image_id).execute();
    const bbox = (job.bbox as [number, number, number, number] | null) ?? null;
    return {
      job,
      photo: photo.body,
      photoMime: photo.mime,
      cutout,
      crop: await cropAround(photo.body, bbox),
      // One garment in the photo: the generator sees the whole photo, so a part the background removal
      // missed (IS-Net sometimes drops outstretched sleeves) is not lost. Several garments: the region
      // of this one, with 8 % of context.
      generatorInput: siblings.length > 1 ? await cropAround(photo.body, bbox) : await cropAround(photo.body, null),
      bbox,
      desc,
      embedding,
      consents: { external: await consent(trx, 'visual_search_external'), generation: await consent(trx, 'ai_image_generation') },
      multiInPhoto: siblings.length > 1,
    };
  });
}

/** The garment's region of the photo with 8 % context (what the generator and searches see). */
export async function cropAround(photo: Buffer, bbox: [number, number, number, number] | null, maxSide = 1536): Promise<Buffer> {
  const img = sharp(photo).rotate();
  const meta = await img.metadata();
  const W = (meta.autoOrient?.width ?? meta.width) || 1;
  const H = (meta.autoOrient?.height ?? meta.height) || 1;
  let region = { left: 0, top: 0, width: W, height: H };
  if (bbox) {
    const [x0, y0, x1, y1] = bbox.every((v) => v <= 1.0001) ? [bbox[0] * W, bbox[1] * H, bbox[2] * W, bbox[3] * H] : bbox;
    const pw = (x1 - x0) * 0.08;
    const ph = (y1 - y0) * 0.08;
    const left = Math.max(0, Math.floor(x0 - pw));
    const top = Math.max(0, Math.floor(y0 - ph));
    region = { left, top, width: Math.max(1, Math.min(W, Math.ceil(x1 + pw)) - left), height: Math.max(1, Math.min(H, Math.ceil(y1 + ph)) - top) };
  }
  return sharp(photo).rotate().extract(region).resize(maxSide, maxSide, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer();
}

/**
 * Not enough information to rebuild the garment faithfully: it is cut by the frame on two or more
 * sides (the model would have to invent the missing parts) or the photo of it is tiny.
 */
export function insufficientPhoto(bbox: [number, number, number, number] | null, category: string, cutoutSize: { width: number; height: number }): string | null {
  if (Math.max(cutoutSize.width, cutoutSize.height) < 220) return 'La prenda sale muy pequeña en la foto: haz otra más cerca para reconstruirla sin inventar detalles.';
  if (!bbox || !['top', 'bottom', 'one_piece', 'outerwear'].includes(category)) return null;
  const edge = 0.006;
  const cut = [bbox[0] <= edge, bbox[1] <= edge, bbox[2] >= 1 - edge, bbox[3] >= 1 - edge].filter(Boolean).length;
  return cut >= 2 ? 'La prenda sale cortada por los bordes de la foto: haz otra con la prenda entera para no inventar las partes que no se ven.' : null;
}

/** Worker: one catalogue-photo job end to end. */
export async function processCatalogPhoto(ctx: AppContext, job: CatalogPhotoJob, attempt: AttemptInfo = { attempt: 1, isLastAttempt: true }): Promise<void> {
  // Atomic claim: only one worker takes a queued job (a stalled one is taken again after 20 min).
  const claimed = await withUser(ctx.db, job.userId, (trx) =>
    trx
      .updateTable('catalog_photo_jobs')
      .set({ attempts: sql`attempts + 1`, status: sql`case when mode = 'generate' then 'generating' else 'searching' end`, stage: JSON.stringify({ step: 1, total: 3, label: 'Preparando…' }) })
      .where('id', '=', job.catalogPhotoId)
      .where((eb) => eb.or([eb('status', '=', 'queued'), eb.and([eb('status', 'in', ['searching', 'generating']), eb('updated_at', '<', sql<Date>`now() - interval '20 minutes'`)])]))
      .returning('id')
      .executeTakeFirst(),
  );
  if (!claimed) return;
  try {
    await run(ctx, job.userId, job.catalogPhotoId);
  } catch (e) {
    const retryable = !(e instanceof GenerationError || e instanceof SearchError) || e.retryable;
    if (retryable && !attempt.isLastAttempt) {
      await update(ctx, job.userId, job.catalogPhotoId, { status: 'queued', stage: { step: 0, total: 3, label: 'Reintentando…' } });
      throw e;
    }
    await update(ctx, job.userId, job.catalogPhotoId, { status: 'failed', error: e instanceof Error ? e.message.slice(0, 300) : 'Error preparando la foto de catálogo.', finished_at: new Date() });
    businessEvents.inc({ event: 'catalog_photo', outcome: 'failed' });
  }
}

async function run(ctx: AppContext, userId: string, id: string) {
  const m = await loadMaterial(ctx, userId, id);
  if (!m) {
    await update(ctx, userId, id, { status: 'failed', error: 'La foto de la prenda ya no existe.', finished_at: new Date() });
    return;
  }
  const mode = m.job.mode as 'auto' | 'search' | 'generate';
  const providers: CatalogProviderStateDto[] = [];
  let recognised: Recognised = { brand: null, text: null, references: [] };
  let matches: StoredMatch[] = [];
  if (mode !== 'generate') {
    await update(ctx, userId, id, { status: 'searching', stage: { step: 1, total: 3, label: 'Buscando la foto oficial de la prenda…' } });
    ({ recognised, matches } = await searchOfficial(ctx, userId, m, providers));
  } else {
    recognised = ((m.job.search as SearchState).recognised as Recognised) ?? recognised;
    matches = (m.job.candidates as unknown as StoredMatch[]) ?? [];
    providers.push(...((m.job.search as SearchState).providers ?? []));
  }
  // Regenerating keeps the official photo the user may have confirmed before.
  const official = (mode === 'generate' ? matches.find((x) => x.id === m.job.official_match_id) : undefined) ?? pickOfficial(matches);
  await update(ctx, userId, id, { search: { ...(m.job.search as object), providers, recognised }, candidates: matches, official_match_id: official?.id ?? null });
  if (!(await stillWanted(ctx, userId, id))) return;

  const needGeneration = mode === 'generate' || (mode === 'auto' && !official);
  if (!needGeneration) {
    const message = official
      ? `Hemos encontrado tu prenda en ${official.retailer ?? official.domain ?? 'una tienda'}. Compárala con tu foto y confirma.`
      : matches.length
        ? 'Hay productos parecidos, pero ninguno verificado como el mismo. Revisa las alternativas.'
        : 'No hemos encontrado la foto oficial de esta prenda.';
    await update(ctx, userId, id, { status: 'ready', stage: null, message, finished_at: new Date() });
    businessEvents.inc({ event: 'catalog_photo', outcome: official ? 'official' : 'no_match' });
    return;
  }
  await generate(ctx, userId, m, recognised, matches, official);
}

function pickOfficial(matches: StoredMatch[]): StoredMatch | null {
  const usable = matches.filter((x) => x.verdict === 'exact' && x.usage !== 'reference_only');
  usable.sort((a, b) => Number(b.studioLike) - Number(a.studioLike) || b.similarity - a.similarity);
  return usable[0] ?? null;
}

// --- search -----------------------------------------------------------------

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

async function searchOfficial(ctx: AppContext, userId: string, m: Material, providers: CatalogProviderStateDto[]): Promise<{ recognised: Recognised; matches: StoredMatch[] }> {
  let recognised: Recognised = { brand: null, text: null, references: [] };
  try {
    recognised = recognise((await ctx.vision.ocr(m.crop, 'image/jpeg')).lines);
  } catch {
    /* OCR is a hint only */
  }
  const all: WebCandidate[] = [];
  // 1) Authorised catalogues (licensed images, no external call).
  if (m.embedding) {
    const found = await withUser(ctx.db, userId, async (trx) => {
      const near = await nearestProducts(trx, m.embedding!, 8, m.desc.category);
      if (!near.length) return [];
      const rows = await trx
        .selectFrom('catalog_products as p')
        .innerJoin('retailers as r', 'r.id', 'p.retailer_id')
        .innerJoin('product_images as i', (j) => j.onRef('i.product_id', '=', 'p.id').on('i.license', '=', 'licensed'))
        .select(['p.id', 'p.title', 'p.brand', 'p.product_url', 'r.name as retailer', 'i.url as image_url', 'i.position'])
        .where('p.id', 'in', near.map((n) => n.id))
        .orderBy('i.position')
        .execute();
      return near
        .map((n, i) => {
          const r = rows.find((x) => x.id === n.id);
          return r
            ? ({ provider: 'catalog', query: 'catalog', rank: i + 1, title: r.title, pageUrl: r.product_url, imageUrl: r.image_url, thumbnailUrl: r.image_url, source: r.retailer, brand: r.brand, price: null, exactImage: false, catalogProductId: r.id } satisfies WebCandidate)
            : null;
        })
        .filter((x): x is NonNullable<typeof x> => !!x);
    });
    all.push(...found);
    providers.push({ id: 'catalog', label: 'Catálogos autorizados', status: found.length ? 'ok' : 'no_results', message: found.length ? null : 'Sin productos parecidos en los catálogos conectados.' });
  }
  // 2) Internet (reverse image search), with the user's consent.
  const queries = ctx.cfg.CATALOG_SEARCH_QUERIES.split(',').map((q) => q.trim()).filter((q): q is 'crop' | 'full' => q === 'crop' || q === 'full');
  for (const p of ctx.catalogPhoto.search) {
    if (!p.configured) {
      providers.push({ id: p.id, label: p.label, status: 'not_configured', message: `Falta ${p.requires.join(', ')} en el servidor.` });
      continue;
    }
    if (!m.consents.external) {
      providers.push({ id: p.id, label: p.label, status: 'no_consent', message: 'Activa «Buscar mis prendas en Internet» para usar este buscador.' });
      continue;
    }
    const states: string[] = [];
    for (const q of queries) {
      const image = q === 'crop' ? m.crop : m.photo;
      const key = `${p.id}:${q}:${sha(image)}`;
      const cached = await withUser(ctx.db, userId, (trx) =>
        trx.selectFrom('visual_search_cache').select(['response']).where('key', '=', key).where('created_at', '>', sql<Date>`now() - make_interval(days => ${ctx.cfg.CATALOG_SEARCH_CACHE_DAYS})`).executeTakeFirst(),
      );
      if (cached) {
        all.push(...((cached.response as { candidates?: WebCandidate[] }).candidates ?? []));
        states.push('cached');
        continue;
      }
      const blocked = await withUser(ctx.db, userId, (trx) => allowance(ctx, trx, 'search', p.costCents));
      if (blocked) {
        states.push(`limit:${blocked}`);
        continue;
      }
      try {
        let out;
        try {
          out = await p.search(image, { query: q, text: recognised.brand });
        } finally {
          // Counted even when the answer could not be used: the provider may have billed it.
          await recordUsage(ctx, userId, p.id, p.costCents);
        }
        all.push(...out.candidates);
        await withUser(ctx.db, userId, (trx) =>
          trx
            .insertInto('visual_search_cache')
            .values({ user_id: userId, key, provider: p.id, response: JSON.stringify({ candidates: out.candidates, hints: out.hints }) })
            .onConflict((oc) => oc.columns(['user_id', 'key']).doUpdateSet({ response: JSON.stringify({ candidates: out.candidates, hints: out.hints }), created_at: new Date() }))
            .execute(),
        );
        states.push(out.candidates.length ? 'ok' : 'no_results');
      } catch (e) {
        states.push(`error:${(e as Error).message}`);
      }
    }
    const err = states.find((s) => s.startsWith('error:'));
    const lim = states.find((s) => s.startsWith('limit:'));
    const status: CatalogProviderStateDto['status'] = states.includes('ok') ? 'ok' : states.includes('cached') ? 'cached' : err ? 'error' : lim ? 'limit' : 'no_results';
    providers.push({ id: p.id, label: p.label, status, message: status === 'error' ? err!.slice(6, 200) : status === 'limit' ? lim!.slice(6) : null });
  }
  const merged = mergeCandidates(all, recognised).slice(0, VERIFY_MAX);
  const matches: StoredMatch[] = [];
  for (const c of merged) {
    const verified = await verifyCandidate(ctx, m, c, recognised.text);
    if (verified) matches.push(verified);
  }
  matches.sort((a, b) => Number(b.verdict === 'exact') - Number(a.verdict === 'exact') || b.similarity - a.similarity);
  return { recognised, matches };
}

const fetchOpts = (cfg: Config, maxBytes: number) => ({ userAgent: cfg.LINK_IMPORT_USER_AGENT, timeoutMs: cfg.LINK_IMPORT_TIMEOUT_MS, maxBytes, allowPrivate: cfg.LINK_IMPORT_ALLOW_PRIVATE });

/** Downloads a candidate's photos, reads its store page when allowed and checks it against the garment. */
async function verifyCandidate(ctx: AppContext, m: Material, c: MergedCandidate, recognisedText: string | null): Promise<StoredMatch | null> {
  const images: string[] = [];
  if (c.imageUrl) images.push(c.imageUrl);
  let title = c.title;
  let brand = c.brand;
  // Store page: structured data gives the official photos (often the studio one), brand and colour.
  if (c.pageUrl && c.provider !== 'catalog') {
    try {
      const page = await safeFetch(c.pageUrl, { ...fetchOpts(ctx.cfg, ctx.cfg.LINK_IMPORT_MAX_BYTES), respectRobots: true });
      const x = extractFromHtml(page.body, page.finalUrl);
      if (!x.looksBlocked && x.isProductPage) {
        title = x.title?.value ?? title;
        brand = x.brand?.value ?? brand;
        for (const u of x.images?.value ?? []) if (!images.includes(u)) images.push(u);
      }
    } catch {
      /* many stores block server reads (robots/anti-bot): the search result's photo is used */
    }
  }
  if (!images.length && c.thumbnailUrl) images.push(c.thumbnailUrl);
  let best: { url: string; check: CatalogCheckResult } | null = null;
  for (const url of images.slice(0, 4)) {
    let bytes: Buffer;
    try {
      bytes = (await safeFetch(url, { ...fetchOpts(ctx.cfg, 8_000_000), allowedContentTypes: /^image\//, accept: 'image/*', respectRobots: false })).raw;
    } catch {
      continue;
    }
    let check: CatalogCheckResult;
    try {
      check = await ctx.vision.catalogCheck(m.cutout, bytes, { kind: 'official', category: m.desc.category, subcategory: m.desc.subcategory });
    } catch {
      continue;
    }
    const rank = (k: CatalogCheckResult) => k.fidelity.similarity + (studio(k) ? 0.05 : 0);
    if (!best || rank(check) > rank(best.check)) best = { url, check };
  }
  if (!best) return null;
  const f = best.check.fidelity;
  // The brand the store page declares must match the garment's brand or what its label says.
  const pageBrandMatch = !!brand && ((!!m.desc.brand && brand.toLowerCase().includes(m.desc.brand.toLowerCase())) || textOnLabelMatches(labelWords(recognisedText), `${brand} ${title ?? ''}`));
  const v = judgeMatch(
    { ...c, brandMatch: c.brandMatch || pageBrandMatch },
    { similarity: f.similarity, sameCategory: f.same_category, colorOk: !f.codes.includes('color'), textMatch: f.text_match, studioLike: studio(best.check) },
    { exact: ctx.cfg.OFFICIAL_PHOTO_EXACT_SIMILARITY, possible: ctx.cfg.OFFICIAL_PHOTO_POSSIBLE_SIMILARITY },
  );
  if (v.verdict === 'rejected') return null;
  return {
    id: sha(c.key).slice(0, 16),
    provider: c.provider,
    verdict: v.verdict,
    title,
    brand: brand ?? (c.retailerId ? c.retailerName : null),
    retailer: c.retailerName,
    retailerId: c.retailerId,
    domain: c.domain,
    pageUrl: c.pageUrl,
    imageUrl: best.url,
    price: c.price,
    similarity: Math.round(f.similarity * 1000) / 1000,
    evidence: v.evidence,
    doubts: v.doubts,
    usage: c.provider === 'catalog' ? 'licensed' : ctx.cfg.OFFICIAL_PHOTO_WEB_IMAGES === 'link_preview' ? 'link_preview' : 'reference_only',
    studioLike: studio(best.check),
    ...(c.catalogProductId ? { catalogProductId: c.catalogProductId } : {}),
  };
}

/** A catalogue-like photo: plain light background, the garment alone and whole, nobody wearing it. */
const studio = (k: CatalogCheckResult) => !k.presentation.codes.some((c) => ['background', 'cropped', 'worn', 'multiple'].includes(c));

// --- generation -------------------------------------------------------------

/** Stores a packshot for the garment the job belongs to *now* (the detection may have been accepted meanwhile). */
async function storePackshot(ctx: AppContext, userId: string, jobId: string, m: Material, image: Buffer, model: string): Promise<string> {
  return withUser(ctx.db, userId, async (trx) => {
    const fresh = await trx.selectFrom('catalog_photo_jobs').select('garment_id').where('id', '=', jobId).executeTakeFirst();
    return storeGenerated(ctx, trx, userId, image, 'studio', { model, garmentId: fresh?.garment_id ?? m.job.garment_id, parentImageId: m.job.source_image_id });
  });
}

async function generate(ctx: AppContext, userId: string, m: Material, recognised: Recognised, matches: StoredMatch[], official: StoredMatch | null) {
  const id = m.job.id;
  const finish = async (status: 'ready' | 'needs_user', message: string, generation: GenerationState) => {
    await update(ctx, userId, id, { status, stage: null, message, generation, finished_at: new Date() });
    businessEvents.inc({ event: 'catalog_photo', outcome: status });
  };
  const hasOfficial = !!official || matches.some((x) => x.usage !== 'reference_only');
  if (!m.consents.generation) {
    await finish(hasOfficial ? 'ready' : 'needs_user', `${hasOfficial ? 'Hay fotos de tienda para comparar. ' : ''}Para crear una foto de catálogo con IA, activa «Imágenes generadas con IA» en Privacidad.`, { skipped: 'no_consent' });
    return;
  }
  const meta = await sharp(m.cutout).metadata();
  const insufficient = (m.job.search as { input?: JobInput }).input?.force ? null : insufficientPhoto(m.bbox, m.desc.category, { width: meta.width ?? 0, height: meta.height ?? 0 });
  if (insufficient) {
    await finish('needs_user', insufficient, { skipped: 'insufficient_photo' });
    return;
  }
  const available: PackshotGenerator[] = [];
  for (const g of ctx.catalogPhoto.generators) if (await g.available().catch(() => false)) available.push(g);
  if (!available.length) {
    const missing = ctx.catalogPhoto.generators.filter((g) => !g.configured).flatMap((g) => g.requires);
    await finish(hasOfficial ? 'ready' : 'needs_user', `No hay ningún generador de imágenes disponible en el servidor${missing.length ? ` (faltan ${missing.join(', ')})` : ''}.`, { skipped: 'no_generator' });
    return;
  }
  const desc: GarmentDescription = { ...m.desc, brand: m.desc.brand ?? official?.brand ?? recognised.brand, text: recognised.text && recognised.text.length <= 40 ? recognised.text : null };
  const prevAttempts = ((m.job.generation as GenerationState)?.attempts ?? []).length;
  const attempts: StoredAttempt[] = [];
  let corrections: string[] = [];
  let best: { attempt: StoredAttempt; check: CatalogCheckResult; image: Buffer; model: string; score: number } | null = null;
  let providerIdx = 0;
  let unchecked: { image: Buffer; model: string; n: number; ms: number; provider: PackshotGenerator['id'] } | null = null;
  const total = ctx.cfg.PACKSHOT_MAX_ATTEMPTS;
  for (let n = 1; n <= total && providerIdx < available.length; n++) {
    if (!(await stillWanted(ctx, userId, id))) return;
    // Last attempt goes to the fallback provider when there is one.
    const gen = available[n === total && available.length > providerIdx + 1 ? providerIdx + 1 : providerIdx]!;
    await update(ctx, userId, id, { status: 'generating', stage: { step: 2, total: 3, label: n === 1 ? 'Creando la foto de estudio de tu prenda…' : `Mejorando la foto (intento ${n} de ${total})…` } });
    const blocked = await withUser(ctx.db, userId, (trx) => allowance(ctx, trx, 'generation', gen.estimatedCostCents));
    if (blocked) {
      attempts.push({ n: prevAttempts + n, provider: gen.id, model: gen.model, ms: 0, check: null, error: blocked, codes: [] });
      break;
    }
    const prompt = buildPackshotPrompt(desc, corrections);
    if (m.multiInPhoto) prompt.prompt += ' The photograph shows several items: use ONLY this garment and ignore the others.';
    const t0 = Date.now();
    let out;
    try {
      out = await gen.generate({ photo: m.generatorInput, mime: 'image/jpeg', prompt, seed: Math.floor(Math.random() * 2 ** 31), ...CANVAS });
      await recordUsage(ctx, userId, gen.id, out.costCents);
      await update(ctx, userId, id, { cost_cents: sql`cost_cents + ${out.costCents}` });
    } catch (e) {
      const msg = e instanceof Error ? e.message.slice(0, 300) : 'Error del generador.';
      attempts.push({ n: prevAttempts + n, provider: gen.id, model: gen.model, ms: Date.now() - t0, check: null, error: msg, codes: [] });
      if (!(e instanceof GenerationError) || !e.retryable) providerIdx++; // this provider will not work: next one
      continue;
    }
    await update(ctx, userId, id, { stage: { step: 3, total: 3, label: 'Comprobando que es fiel a tu prenda…' } });
    let check: CatalogCheckResult;
    try {
      check = await ctx.vision.catalogCheck(m.cutout, out.image, { kind: 'generated', category: m.desc.category, subcategory: m.desc.subcategory, ocr: !!recognised.text });
    } catch {
      // The image is kept (it was paid for) but unverified: the user decides, nothing is regenerated.
      unchecked = { image: out.image, model: out.model, n: prevAttempts + n, ms: Date.now() - t0, provider: gen.id };
      break;
    }
    const codes = [...check.presentation.codes, ...check.fidelity.codes];
    const attemptRow: StoredAttempt = { n: prevAttempts + n, provider: gen.id, model: out.model, ms: Date.now() - t0, check: checkDto(check), error: null, codes };
    attempts.push(attemptRow);
    // Fidelity failures weigh more than presentation ones: a pretty photo of another garment is worse.
    const score = (check.fidelity.passed ? 2 : 0) + (check.presentation.passed ? 1 : 0) + check.fidelity.similarity - 0.05 * codes.length;
    if (!best || score > best.score) best = { attempt: attemptRow, check, image: out.image, model: out.model, score };
    if (check.presentation.passed && check.fidelity.passed) break;
    corrections = [...new Set([...corrections, ...codes])];
  }
  const allAttempts = [...((m.job.generation as GenerationState)?.attempts ?? []), ...attempts];
  if (unchecked && !best) {
    const imageId = await storePackshot(ctx, userId, id, m, unchecked.image, unchecked.model);
    const row: StoredAttempt = { n: unchecked.n, provider: unchecked.provider, model: unchecked.model, ms: unchecked.ms, check: null, error: 'No se ha podido comprobar la imagen (servicio de visión no disponible).', codes: [], imageId };
    if (await update(ctx, userId, id, { generated_image_id: imageId }))
      await finish('needs_user', 'Hemos creado la foto, pero no hemos podido comprobar que sea fiel a tu prenda. Revísala tú antes de usarla.', { attempts: [...allAttempts, row], passed: false, model: unchecked.model });
    return;
  }
  if (!best) {
    await finish(hasOfficial ? 'ready' : 'needs_user', `No se ha podido generar la foto: ${attempts.at(-1)?.error ?? 'error del generador'}`, { attempts: allAttempts, passed: false });
    return;
  }
  const passed = best.check.presentation.passed && best.check.fidelity.passed;
  const cutoutPng = best.check.cutout_png_base64 ? Buffer.from(best.check.cutout_png_base64, 'base64') : best.image;
  const imageId = await storePackshot(ctx, userId, id, m, cutoutPng, best.model);
  best.attempt.imageId = imageId;
  const generation: GenerationState = { attempts: allAttempts, passed, model: best.model, promptVersion: buildPackshotPrompt(desc).version };
  if (!(await update(ctx, userId, id, { generated_image_id: imageId }))) return; // dismissed meanwhile
  if (passed) {
    await finish('ready', official ? 'Tienes la foto oficial y una foto de estudio creada con IA: elige la que prefieras.' : 'Hemos creado una foto de estudio de tu prenda. Compárala con tu foto y confirma.', generation);
  } else {
    const reasons = [...best.check.presentation.reasons, ...best.check.fidelity.reasons];
    await finish('needs_user', `Tras ${attempts.length} intento${attempts.length === 1 ? '' : 's'}, la foto generada no es del todo fiel o no está bien colocada: ${reasons.join(' ')} Puedes reintentarlo, hacer otra foto (prenda extendida y con buena luz) o usarla igualmente.`, generation);
  }
}
