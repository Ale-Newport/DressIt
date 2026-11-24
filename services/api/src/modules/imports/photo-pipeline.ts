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
import type { VisionItem } from '../vision/client.ts';

interface JobInput {
  imageIds: string[];
  mode: 'single' | 'multi';
  attachGarmentId?: string;
}

const NEAR_DUP_HAMMING = 6;
const SIMILAR_GARMENT_COSINE = 0.93;

async function findDuplicate(trx: Tx, imageId: string, item: VisionItem): Promise<{ garmentId: string; score: number; kind: 'exact_photo' | 'near_photo' | 'similar_garment' } | null> {
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
      .$if(!!item.category?.value, (q) => q.where('g.category', '=', item.category!.value))
      .orderBy(sql`e.embedding <=> ${toVectorLiteral(item.embedding)}::vector`)
      .limit(1)
      .executeTakeFirst();
    if (sim && sim.cos >= SIMILAR_GARMENT_COSINE) return { garmentId: sim.garment_id, score: Math.round(sim.cos * 1000) / 1000, kind: 'similar_garment' };
  }
  return null;
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
      const analysis = await ctx.vision.analyze(body, mime, input.mode, input.mode === 'multi' ? 8 : 1);
      await withUser(ctx.db, job.userId, async (trx) => {
        // Idempotency: a retried job must not duplicate detections for the same image.
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
          const duplicate = await findDuplicate(trx, imageId, item);
          const warnings = [...(item.quality?.warnings ?? [])];
          if (!item.subcategory) warnings.push('No hemos podido identificar el tipo de prenda con seguridad: indícalo tú.');
          await trx
            .insertInto('import_detections')
            .values({
              user_id: job.userId,
              job_id: job.importJobId,
              image_id: imageId,
              cutout_image_id: cutoutId,
              bbox: item.bbox ? JSON.stringify(item.bbox) : null,
              predicted: JSON.stringify(predictedFrom(item)),
              embedding: item.embedding?.length === 768 ? toVectorLiteral(item.embedding) : null,
              embedding_model: item.embedding_model,
              duplicate: duplicate ? JSON.stringify(duplicate) : null,
              warnings,
            })
            .execute();
          detections++;
        }
        processed++;
        await trx.updateTable('import_jobs').set({ processed }).where('id', '=', job.importJobId).execute();
      });
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
