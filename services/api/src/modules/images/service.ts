import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { UploadKind } from '@dressit/shared';
import type { AppContext } from '../../context.ts';
import type { Tx } from '../../db/index.ts';
import { badRequest } from '../../lib/errors.ts';

const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp', 'heif', 'avif', 'tiff']);
const MAX_SIDE = 2560;

const KIND_MAP: Record<UploadKind, 'original' | 'receipt' | 'label' | 'screenshot' | 'inspiration' | 'visual_search' | 'self_face' | 'self_body'> = {
  garment_photo: 'original',
  self_face: 'self_face',
  self_body: 'self_body',
  receipt: 'receipt',
  label: 'label',
  screenshot: 'screenshot',
  inspiration: 'inspiration',
  visual_search: 'visual_search',
};

/** 64-bit difference hash (dHash) — robust to resizing/recompression, used for near-duplicate photos. */
export async function dHash(buf: Buffer): Promise<string> {
  const { data } = await sharp(buf).rotate().greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  let bits = '';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += data[y * 9 + x]! > data[y * 9 + x + 1]! ? '1' : '0';
  return bits;
}

export function hamming(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) d++;
  return d + Math.abs(a.length - b.length);
}

export interface StoredImage {
  id: string;
  duplicateOfImageId: string | null;
}

/**
 * Normalises and stores an uploaded image: validates the real format (not the
 * client's mime), applies EXIF orientation and STRIPS all metadata (GPS, device),
 * caps resolution, writes a WebP thumbnail.
 */
export async function storeUpload(ctx: AppContext, trx: Tx, userId: string, raw: Buffer, kind: UploadKind, opts: { parentImageId?: string; garmentId?: string | null } = {}): Promise<StoredImage> {
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>;
  try {
    meta = await sharp(raw).metadata();
  } catch {
    throw badRequest('El archivo no es una imagen válida.');
  }
  if (!meta.format || !ALLOWED_FORMATS.has(meta.format)) throw badRequest('Formato de imagen no admitido (usa JPG, PNG, WebP o HEIC).');
  if ((meta.width ?? 0) * (meta.height ?? 0) > 60_000_000) throw badRequest('La imagen es demasiado grande.');
  const sha256 = createHash('sha256').update(raw).digest('hex');
  const dupe = await trx.selectFrom('garment_images').select('id').where('sha256', '=', sha256).where('kind', '=', KIND_MAP[kind]).executeTakeFirst();
  const hasAlpha = meta.hasAlpha === true && meta.format === 'png';
  const pipeline = sharp(raw).rotate().resize(MAX_SIDE, MAX_SIDE, { fit: 'inside', withoutEnlargement: true });
  const normalized = hasAlpha ? await pipeline.png({ compressionLevel: 8 }).toBuffer({ resolveWithObject: true }) : await pipeline.jpeg({ quality: 88, mozjpeg: true }).toBuffer({ resolveWithObject: true });
  const thumb = await sharp(normalized.data).resize(480, 480, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
  const id = randomUUID();
  const ext = hasAlpha ? 'png' : 'jpg';
  const key = `u/${userId}/${id}/original.${ext}`;
  const thumbKey = `u/${userId}/${id}/thumb.webp`;
  await ctx.storage.put(key, normalized.data, hasAlpha ? 'image/png' : 'image/jpeg');
  await ctx.storage.put(thumbKey, thumb, 'image/webp');
  await trx
    .insertInto('garment_images')
    .values({
      id,
      user_id: userId,
      garment_id: opts.garmentId ?? null,
      kind: KIND_MAP[kind],
      storage_key: key,
      thumb_storage_key: thumbKey,
      mime: hasAlpha ? 'image/png' : 'image/jpeg',
      width: normalized.info.width,
      height: normalized.info.height,
      bytes: normalized.data.length,
      sha256,
      phash: await dHash(normalized.data),
      parent_image_id: opts.parentImageId ?? null,
    })
    .execute();
  return { id, duplicateOfImageId: dupe?.id ?? null };
}

/** Stores a background-removed cutout (RGBA PNG) linked to its original. */
export async function storeCutout(ctx: AppContext, trx: Tx, userId: string, parentImageId: string, png: Buffer): Promise<string> {
  const id = randomUUID();
  const trimmed = await sharp(png).trim({ threshold: 1 }).png({ compressionLevel: 8 }).toBuffer({ resolveWithObject: true }).catch(async () => sharp(png).png().toBuffer({ resolveWithObject: true }));
  const thumb = await sharp(trimmed.data).resize(480, 480, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82, alphaQuality: 90 }).toBuffer();
  const key = `u/${userId}/${id}/cutout.png`;
  const thumbKey = `u/${userId}/${id}/thumb.webp`;
  await ctx.storage.put(key, trimmed.data, 'image/png');
  await ctx.storage.put(thumbKey, thumb, 'image/webp');
  await trx
    .insertInto('garment_images')
    .values({
      id,
      user_id: userId,
      kind: 'cutout',
      storage_key: key,
      thumb_storage_key: thumbKey,
      mime: 'image/png',
      width: trimmed.info.width,
      height: trimmed.info.height,
      bytes: trimmed.data.length,
      sha256: createHash('sha256').update(trimmed.data).digest('hex'),
      phash: await dHash(trimmed.data),
      parent_image_id: parentImageId,
    })
    .execute();
  return id;
}

/**
 * Stores an AI-generated image (studio photo: transparent PNG trimmed to the garment; avatar
 * render: JPEG). `generated_by` records the model so the app can label it as generated.
 */
export async function storeGenerated(
  ctx: AppContext,
  trx: Tx,
  userId: string,
  image: Buffer,
  kind: 'studio' | 'avatar_render',
  opts: { model: string; garmentId?: string | null; parentImageId?: string | null },
): Promise<string> {
  const id = randomUUID();
  const transparent = kind === 'studio';
  // Machine-readable "AI-generated" marking in the file itself (EU AI Act art. 50); the app also labels it visibly.
  const exif = { IFD0: { ImageDescription: `AI-generated image (${opts.model}) - DressIt`, Software: 'DressIt' } };
  const out = transparent
    ? await sharp(image).trim({ threshold: 1 }).withExif(exif).png({ compressionLevel: 8 }).toBuffer({ resolveWithObject: true }).catch(async () => sharp(image).withExif(exif).png().toBuffer({ resolveWithObject: true }))
    : await sharp(image).withExif(exif).jpeg({ quality: 90, mozjpeg: true }).toBuffer({ resolveWithObject: true });
  const thumb = await sharp(out.data).resize(480, 480, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82, alphaQuality: 90 }).toBuffer();
  const key = `u/${userId}/${id}/${kind}.${transparent ? 'png' : 'jpg'}`;
  const thumbKey = `u/${userId}/${id}/thumb.webp`;
  await ctx.storage.put(key, out.data, transparent ? 'image/png' : 'image/jpeg');
  await ctx.storage.put(thumbKey, thumb, 'image/webp');
  await trx
    .insertInto('garment_images')
    .values({
      id,
      user_id: userId,
      garment_id: opts.garmentId ?? null,
      kind,
      storage_key: key,
      thumb_storage_key: thumbKey,
      mime: transparent ? 'image/png' : 'image/jpeg',
      width: out.info.width,
      height: out.info.height,
      bytes: out.data.length,
      sha256: createHash('sha256').update(out.data).digest('hex'),
      phash: await dHash(out.data),
      parent_image_id: opts.parentImageId ?? null,
      generated_by: opts.model,
    })
    .execute();
  return id;
}

export async function readImage(ctx: AppContext, trx: Tx, imageId: string, variant: string): Promise<{ body: Buffer; mime: string } | null> {
  const img = await trx.selectFrom('garment_images').selectAll().where('id', '=', imageId).executeTakeFirst();
  if (!img) return null;
  if (variant === 'thumb' && img.thumb_storage_key) {
    const body = await ctx.storage.get(img.thumb_storage_key);
    return body ? { body, mime: 'image/webp' } : null;
  }
  if (variant === 'cutout' && img.kind !== 'cutout') {
    const cut = await trx.selectFrom('garment_images').select(['storage_key', 'mime']).where('parent_image_id', '=', imageId).where('kind', '=', 'cutout').executeTakeFirst();
    if (cut) {
      const body = await ctx.storage.get(cut.storage_key);
      if (body) return { body, mime: cut.mime };
    }
  }
  const body = await ctx.storage.get(img.storage_key);
  return body ? { body, mime: img.mime } : null;
}

export async function loadImageBytes(ctx: AppContext, trx: Tx, imageId: string): Promise<{ body: Buffer; mime: string }> {
  const r = await readImage(ctx, trx, imageId, 'original');
  if (!r) throw badRequest('Imagen no encontrada.');
  return r;
}

export async function deleteUserFiles(ctx: AppContext, keys: Array<string | null>): Promise<void> {
  for (const k of keys) if (k) await ctx.storage.delete(k).catch(() => undefined);
}
