/**
 * Background processing of photo imports: vision analysis (detection,
 * background removal, attributes, embeddings) → cutouts + review queue, with
 * duplicate detection against the user's existing wardrobe.
 */
import { sql } from 'kysely';
import type { AppContext } from '../../context.ts';
import { toVectorLiteral, withUser, type Tx } from '../../db/index.ts';
import { AppError } from '../../lib/errors.ts';
import { businessEvents } from '../../lib/metrics.ts';
import type { AttemptInfo, ImageAnalysisJob } from '../../jobs/queue.ts';
import { hamming, loadImageBytes, storeCutout } from '../images/service.ts';
import type { VisionAnalysis, VisionItem } from '../vision/client.ts';
import { getSubcategory } from '@dressit/shared';
import { createForDetection, localVlm } from '../catalog-photo/service.ts';
import type { FoundGarment } from '../catalog-photo/generate.ts';
import { subcategoryFromName } from '../catalog-photo/prompt.ts';

interface JobInput {
  imageIds: string[];
  mode: 'single' | 'multi';
  attachGarmentId?: string;
}

const NEAR_DUP_HAMMING = 6;
const SIMILAR_GARMENT_COSINE = 0.93;

async function findDuplicate(trx: Tx, imageId: string, item: VisionItem, category: string | undefined = item.category?.value): Promise<{ garmentId: string; score: number; kind: 'exact_photo' | 'near_photo' | 'similar_garment' } | null> {
  const img = await trx.selectFrom('garment_images').select(['sha256', 'phash']).where('id', '=', imageId).executeTakeFirstOrThrow();
  const exact = await trx
    .selectFrom('garment_images')
    .select('garment_id')
    .where('sha256', '=', img.sha256)
    .where('id', '!=', imageId)
    .where('garment_id', 'is not', null)
    .executeTakeFirst();
  if (exact?.garment_id) return { garmentId: exact.garment_id, score: 1, kind: 'exact_photo' };
  if (img.phash) {
    const near = await trx
      .selectFrom('garment_images')
      .select(['garment_id', 'phash'])
      .where('garment_id', 'is not', null)
      .where('kind', '=', 'original')
      .where('id', '!=', imageId)
      .where(sql<boolean>`bit_count(phash # ${img.phash}::bit(64)) <= ${NEAR_DUP_HAMMING}`)
      .executeTakeFirst();
    if (near?.garment_id && near.phash) return { garmentId: near.garment_id, score: 1 - hamming(near.phash, img.phash) / 64, kind: 'near_photo' };
  }
  if (item.embedding?.length === 768) {
    const sim = await trx
      .selectFrom('garment_embeddings as e')
      .innerJoin('garments as g', 'g.id', 'e.garment_id')
      .select(['e.garment_id', sql<number>`1 - (e.embedding <=> ${toVectorLiteral(item.embedding)}::vector)`.as('cos')])
      .where('g.status', '!=', 'retired')
      .$if(!!category, (q) => q.where('g.category', '=', category!))
      .orderBy(sql`e.embedding <=> ${toVectorLiteral(item.embedding)}::vector`)
      .limit(1)
      .executeTakeFirst();
    if (sim && sim.cos >= SIMILAR_GARMENT_COSINE) return { garmentId: sim.garment_id, score: Math.round(sim.cos * 1000) / 1000, kind: 'similar_garment' };
  }
  return null;
}

const iou = (a: [number, number, number, number], b: [number, number, number, number]) => {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const inter = ix * iy;
  const union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
  return union > 0 ? inter / union : 0;
};

/**
 * Detection, Alta-style: the local vision-language model lists each garment of the whole photo as ONE
 * item with its box and a description of the complete item.
 * - Several garments (multi): the vision service segments those boxes (and layers them).
 * - One garment (single): the vision service's single-garment pipeline stays, since it removes hangers
 *   and the clothes worn over or under the main one; the model's view of the garment it found there
 *   (best-overlapping box) is attached.
 * Null → the vision service's own detector, without names.
 */
async function detectWithVlm(ctx: AppContext, body: Buffer, mime: string, mode: 'single' | 'multi'): Promise<{ analysis: VisionAnalysis; foundFor: (item: VisionItem) => FoundGarment | undefined } | null> {
  const vlm = ctx.cfg.IMPORT_VLM_DETECTION ? localVlm(ctx) : null;
  if (!vlm) return null;
  const found = await vlm.garments(body);
  if (!found?.length) return null;
  if (mode === 'single') {
    const analysis = await ctx.vision.analyze(body, mime, 'single', 1);
    const box = analysis.items[0]?.bbox;
    if (!box) return null;
    const best = found.map((f) => ({ f, o: iou(f.box, box) })).sort((a, b) => b.o - a.o)[0];
    return { analysis, foundFor: () => (best && best.o >= 0.2 ? best.f : undefined) };
  }
  const analysis = await ctx.vision.analyze(body, mime, 'multi', Math.min(12, found.length), { boxes: found.map((f) => ({ box: f.box, category: f.category })) });
  if (!analysis.items.length) return null;
  return { analysis, foundFor: (item) => (item.box_index != null ? found[item.box_index] : undefined) };
}

/**
 * What the classifier predicted, corrected by the vision-language model's view of the same garment:
 * its name gives the type when the vocabulary has it (the classifier took a plaid skirt for a scarf and
 * a backpack for one too), and the name, description and visibility are kept for the review and the
 * studio photo.
 */
export function predictedWithVlm(item: VisionItem, found: FoundGarment | undefined): ReturnType<typeof predictedFrom> & { vlm?: { name: string; nameEs: string; description: string; visible: 'whole' | 'partial'; category: string; attributes?: FoundGarment['attributes'] } } {
  const p = predictedFrom(item);
  if (!found) return p;
  const sub = subcategoryFromName(found.name, found.category);
  const def = sub ? getSubcategory(sub) : undefined;
  return {
    ...p,
    ...(def ? { subcategory: { value: def.id, confidence: 0.9 }, category: { value: def.category, confidence: 0.9 } } : {}),
    vlm: { name: found.name, nameEs: found.nameEs, description: found.description, visible: found.visible, category: found.category, ...(found.attributes ? { attributes: found.attributes } : {}) },
  };
}

function predictedFrom(item: VisionItem) {
  return {
    ...(item.category ? { category: item.category } : {}),
    ...(item.subcategory ? { subcategory: item.subcategory } : {}),
    ...(item.colors?.length ? { colors: item.colors } : {}),
    ...(item.pattern ? { pattern: item.pattern } : {}),
    ...(item.materials ? { materials: item.materials } : {}),
    ...(item.styles ? { styles: item.styles } : {}),
    ...(item.seasons ? { seasons: item.seasons } : {}),
    ...(item.fit ? { fit: item.fit } : {}),
  };
}

export async function processImageAnalysis(ctx: AppContext, job: ImageAnalysisJob, attempt: AttemptInfo = { attempt: 1, isLastAttempt: true }): Promise<void> {
  const loaded = await withUser(ctx.db, job.userId, async (trx) => {
    const row = await trx.selectFrom('import_jobs').selectAll().where('id', '=', job.importJobId).executeTakeFirst();
    if (!row) return null;
    if (row.status === 'completed' || row.status === 'cancelled' || row.status === 'needs_review') return 'done' as const;
    await trx.updateTable('import_jobs').set({ status: 'processing', attempts: row.attempts + 1 }).where('id', '=', row.id).execute();
    return { input: row.input as unknown as JobInput, attempts: row.attempts + 1 };
  });
  if (loaded === null) {
    if (attempt.isLastAttempt) return;
    throw new Error('Import job not visible yet'); // committed later → retried
  }
  if (loaded === 'done') return;
  const { input } = loaded;
  let processed = 0;
  let detections = 0;
  try {
    for (const imageId of input.imageIds) {
      const { body, mime } = await withUser(ctx.db, job.userId, (trx) => loadImageBytes(ctx, trx, imageId));
      const viaVlm = input.attachGarmentId ? null : await detectWithVlm(ctx, body, mime, input.mode).catch(() => null);
      const analysis = viaVlm?.analysis ?? (await ctx.vision.analyze(body, mime, input.mode, input.mode === 'multi' ? 8 : 1));
      const imageCatalogJobs = await withUser(ctx.db, job.userId, async (trx) => {
        const created: string[] = [];
        // Idempotency: a retried job must not duplicate detections (nor their catalogue photos) for the same image.
        await trx
          .deleteFrom('catalog_photo_jobs')
          .where('detection_id', 'in', (eb) => eb.selectFrom('import_detections').select('id').where('job_id', '=', job.importJobId).where('image_id', '=', imageId))
          .execute();
        await trx.deleteFrom('import_detections').where('job_id', '=', job.importJobId).where('image_id', '=', imageId).execute();
        for (const item of analysis.items) {
          const cutoutId = item.cutout_png_base64 ? await storeCutout(ctx, trx, job.userId, imageId, Buffer.from(item.cutout_png_base64, 'base64')) : null;
          if (input.attachGarmentId) {
            await trx.updateTable('garments').set({ primary_image_id: cutoutId ?? imageId }).where('id', '=', input.attachGarmentId).execute();
            if (cutoutId) await trx.updateTable('garment_images').set({ garment_id: input.attachGarmentId }).where('id', '=', cutoutId).execute();
            if (item.embedding?.length === 768) {
              await trx
                .insertInto('garment_embeddings')
                .values({ garment_id: input.attachGarmentId, user_id: job.userId, image_id: cutoutId ?? imageId, model: item.embedding_model ?? 'unknown', embedding: toVectorLiteral(item.embedding) })
                .onConflict((oc) => oc.column('garment_id').doUpdateSet({ embedding: toVectorLiteral(item.embedding!), model: item.embedding_model ?? 'unknown', image_id: cutoutId ?? imageId }))
                .execute();
            }
            break; // single garment
          }
          const found = viaVlm?.foundFor(item);
          const predicted = predictedWithVlm(item, found);
          // Compared with garments of the type the model gave (the classifier's can be wrong).
          const duplicate = await findDuplicate(trx, imageId, item, predicted.category?.value);
          // The classifier's doubts do not apply to a type the vision-language model gave.
          const warnings = (item.quality?.warnings ?? []).filter((w) => !(found && predicted.subcategory && (w.startsWith('No se reconoce ninguna prenda') || w.startsWith('Clasificación poco segura'))));
          if (!predicted.subcategory) warnings.push('No hemos podido identificar el tipo de prenda con seguridad: indícalo tú.');
          const inserted = await trx
            .insertInto('import_detections')
            .values({
              user_id: job.userId,
              job_id: job.importJobId,
              image_id: imageId,
              cutout_image_id: cutoutId,
              bbox: item.bbox ? JSON.stringify(item.bbox) : null,
              predicted: JSON.stringify(predicted),
              embedding: item.embedding?.length === 768 ? toVectorLiteral(item.embedding) : null,
              embedding_model: item.embedding_model,
              duplicate: duplicate ? JSON.stringify(duplicate) : null,
              warnings,
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          detections++;
          // Catalogue photo (official photo search, then AI packshot), prepared while the user reviews.
          const catalogJob = await createForDetection(ctx, trx, job.userId, inserted.id);
          if (catalogJob) created.push(catalogJob);
        }
        processed++;
        await trx.updateTable('import_jobs').set({ processed }).where('id', '=', job.importJobId).execute();
        return created;
      });
      for (const id of imageCatalogJobs) await ctx.queue.enqueueCatalogPhoto({ catalogPhotoId: id, userId: job.userId }); // after commit
    }
    await withUser(ctx.db, job.userId, (trx) =>
      trx
        .updateTable('import_jobs')
        .set({
          status: input.attachGarmentId ? 'completed' : detections > 0 ? 'needs_review' : 'completed',
          error: !input.attachGarmentId && detections === 0 ? 'No hemos detectado ninguna prenda en las fotos.' : null,
          completed_at: input.attachGarmentId || detections === 0 ? new Date() : null,
        })
        .where('id', '=', job.importJobId)
        .execute(),
    );
    businessEvents.inc({ event: 'photo_import', outcome: detections ? 'ok' : 'empty' });
  } catch (e) {
    // Transient dependency failures (503) are retried by the queue; anything else, or the last attempt, fails the job.
    const final = attempt.isLastAttempt || !(e instanceof AppError && e.statusCode === 503);
    await withUser(ctx.db, job.userId, (trx) =>
      trx
        .updateTable('import_jobs')
        .set({ status: final ? 'failed' : 'queued', error: e instanceof AppError ? e.message : 'Error procesando las fotos.' })
        .where('id', '=', job.importJobId)
        .execute(),
    );
    businessEvents.inc({ event: 'photo_import', outcome: final ? 'failed' : 'retry' });
    if (!final) throw e;
  }
}
