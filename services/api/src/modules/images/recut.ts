/**
 * Manual cutout correction. The user marks points on the original photo ("garment" / "not
 * garment"); the vision service re-segments it (SAM 2.1, point prompts). The new cutout is stored
 * next to the previous ones — nothing is deleted — so the user can always go back.
 */
import type { ImageRefDto } from '@dressit/shared';
import type { AppContext } from '../../context.ts';
import type { Tx } from '../../db/index.ts';
import { badRequest, notFound } from '../../lib/errors.ts';
import { imageRef } from '../wardrobe/mappers.ts';
import { loadImageBytes, storeCutout } from './service.ts';

export type RecutPoint = [number, number, 0 | 1];

async function recutFrom(ctx: AppContext, trx: Tx, userId: string, originalId: string, points: RecutPoint[], box: [number, number, number, number] | null) {
  const { body, mime } = await loadImageBytes(ctx, trx, originalId);
  const seg = await ctx.vision.segmentPoints(body, mime, points, box);
  const id = await storeCutout(ctx, trx, userId, originalId, Buffer.from(seg.cutout_png_base64, 'base64'));
  return { id, seg };
}

/** Follows parent links (studio photo → cutout → original) up to the user's original photo. */
async function originalOf(trx: Tx, imageId: string | null): Promise<string | null> {
  for (let id = imageId, hops = 0; id && hops < 4; hops++) {
    const img = await trx.selectFrom('garment_images').select(['id', 'kind', 'parent_image_id']).where('id', '=', id).executeTakeFirst();
    if (!img) return null;
    if (img.kind === 'original') return img.id;
    id = img.parent_image_id;
  }
  return null;
}

async function garmentOriginal(trx: Tx, garmentId: string): Promise<string> {
  const g = await trx.selectFrom('garments').select(['id', 'primary_image_id']).where('id', '=', garmentId).executeTakeFirst();
  if (!g) throw notFound('Prenda');
  const originalId =
    (await originalOf(trx, g.primary_image_id)) ??
    (await trx.selectFrom('garment_images').select('id').where('garment_id', '=', garmentId).where('kind', '=', 'original').orderBy('created_at').limit(1).executeTakeFirst())?.id;
  if (!originalId) throw badRequest('Esta prenda no tiene foto original que recortar.');
  return originalId;
}

async function detectionRow(trx: Tx, jobId: string, detectionId: string) {
  const d = await trx.selectFrom('import_detections').select(['id', 'image_id', 'state', 'bbox']).where('id', '=', detectionId).where('job_id', '=', jobId).executeTakeFirst();
  if (!d) throw notFound('Detección');
  return d;
}

async function refOf(ctx: AppContext, trx: Tx, userId: string, id: string): Promise<ImageRefDto> {
  return imageRef(ctx.signer, userId, await trx.selectFrom('garment_images').selectAll().where('id', '=', id).executeTakeFirstOrThrow());
}

/** The original photo the user marks points on (`GET …/recut`). */
export async function garmentRecutSource(ctx: AppContext, trx: Tx, userId: string, garmentId: string): Promise<ImageRefDto> {
  return refOf(ctx, trx, userId, await garmentOriginal(trx, garmentId));
}

export async function detectionRecutSource(ctx: AppContext, trx: Tx, userId: string, jobId: string, detectionId: string): Promise<ImageRefDto> {
  return refOf(ctx, trx, userId, (await detectionRow(trx, jobId, detectionId)).image_id);
}

/** New cutout for an owned garment; it becomes the garment's picture (older ones stay in its gallery). */
export async function recutGarment(ctx: AppContext, trx: Tx, userId: string, garmentId: string, points: RecutPoint[]): Promise<ImageRefDto> {
  const originalId = await garmentOriginal(trx, garmentId);
  const { id } = await recutFrom(ctx, trx, userId, originalId, points, null);
  await trx.updateTable('garment_images').set({ garment_id: garmentId }).where('id', '=', id).execute();
  await trx.updateTable('garments').set({ primary_image_id: id }).where('id', '=', garmentId).execute();
  return refOf(ctx, trx, userId, id);
}

/** New cutout for a detection still in review (replaces the detection's cutout; the old file stays). */
export async function recutDetection(ctx: AppContext, trx: Tx, userId: string, jobId: string, detectionId: string, points: RecutPoint[]): Promise<ImageRefDto> {
  const d = await detectionRow(trx, jobId, detectionId);
  if (d.state !== 'pending') throw badRequest('Esta detección ya está revisada.');
  const { id, seg } = await recutFrom(ctx, trx, userId, d.image_id, points, null);
  await trx.updateTable('import_detections').set({ cutout_image_id: id, bbox: JSON.stringify(seg.bbox) }).where('id', '=', d.id).execute();
  return refOf(ctx, trx, userId, id);
}
