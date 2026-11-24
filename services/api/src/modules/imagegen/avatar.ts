/**
 * Persistent avatar and multi-garment virtual try-on.
 *
 * Bases. The `frontal` base is the user's own full-body photo, cut out (vision `/v1/matte`) and placed
 * on a studio background — nothing is generated, so identity, body and proportions are exactly
 * theirs. Other views (`tres_cuartos`, `perfil`) are generated once from the frontal base with
 * Qwen-Image-Edit-2511 + the Multiple-Angles LoRA and labelled as AI. Every try-on starts from a
 * stored base: the user never sends photos again.
 *
 * Methods (benchmark in docs/probador-virtual.md):
 * - `sequential` (default): FASHN VTON v1.5 dresses one garment per pass — bottom (or one-piece),
 *   then base and mid layers, then the outer layer — on top of the previous result; shoes and one
 *   accessory are added last with a Qwen edit pass. Each step is cached by (base, garments so far),
 *   so changing one garment only re-runs the steps after it.
 * - `joint`: one Qwen-Image-Edit pass with the outfit composed on a board (4 visible pieces max).
 *
 * Gate: the render is parsed (Sapiens2) and every visible clothing piece must be found where it
 * belongs, look like the real garment (FashionSigLIP) and keep its colour (CIEDE2000).
 */
import { createHash, randomUUID } from 'node:crypto';
import type { AvatarBackground, AvatarBaseDto, AvatarView, FidelityDto } from '@dressit/shared';
import { deltaE2000, rgbToLab } from '@dressit/shared';
import sharp from 'sharp';
import type { AppContext } from '../../context.ts';
import { parseVector, withUser, type Tx } from '../../db/index.ts';
import { badRequest, notFound, unavailable } from '../../lib/errors.ts';
import { dHash } from '../images/service.ts';
import { imageRef } from '../wardrobe/mappers.ts';
import { ComfyError } from './comfy.ts';
import type { ExtraRegion, TryonCategory } from './tryon.ts';

export const BACKGROUNDS: Record<Exclude<AvatarBackground, 'original'>, { top: string; bottom: string }> = {
  estudio_gris: { top: '#efedea', bottom: '#d9d6d1' },
  blanco: { top: '#ffffff', bottom: '#f3f3f3' },
  beige: { top: '#f4ede3', bottom: '#e4d8c7' },
};
const VIEW_PROMPT: Record<Exclude<AvatarView, 'frontal'>, string> = { tres_cuartos: 'front-right quarter view', perfil: 'right side view' };
const VIEW_LABEL: Record<AvatarView, string> = { frontal: 'frontal', tres_cuartos: 'tres cuartos', perfil: 'perfil' };

// ---------------------------------------------------------------------------
// Bases
// ---------------------------------------------------------------------------

type BaseRow = { id: string; view: string; background: string; status: string; image_id: string | null; error: string | null };

export async function listBases(ctx: AppContext, trx: Tx, userId: string): Promise<AvatarBaseDto[]> {
  const rows = (await trx.selectFrom('avatar_bases').select(['id', 'view', 'background', 'status', 'image_id', 'error']).orderBy('created_at').execute()) as BaseRow[];
  const imgs = rows.some((r) => r.image_id) ? await trx.selectFrom('garment_images').selectAll().where('id', 'in', rows.map((r) => r.image_id).filter((x): x is string => !!x)).execute() : [];
  return rows.map((r) => {
    const img = imgs.find((i) => i.id === r.image_id);
    return { id: r.id, view: r.view as AvatarView, background: r.background as AvatarBackground, status: r.status as AvatarBaseDto['status'], image: img ? imageRef(ctx.signer, userId, img) : null, generated: r.view !== 'frontal', error: r.error };
  });
}

async function storeImage(ctx: AppContext, trx: Tx, userId: string, data: Buffer, kind: 'avatar_base' | 'tryon_step', generatedBy: string | null): Promise<string> {
  const id = randomUUID();
  // Generated images carry the machine-readable AI marking (EU AI Act art. 50); the app labels them too.
  const img = generatedBy ? sharp(data).withExif({ IFD0: { ImageDescription: `AI-generated image (${generatedBy}) - DressIt`, Software: 'DressIt' } }) : sharp(data);
  const out = await img.png({ compressionLevel: 8 }).toBuffer({ resolveWithObject: true });
  const thumb = await sharp(out.data).resize(480, 480, { fit: 'inside' }).webp({ quality: 82 }).toBuffer();
  const key = `u/${userId}/${id}/${kind}.png`;
  const thumbKey = `u/${userId}/${id}/thumb.webp`;
  await ctx.storage.put(key, out.data, 'image/png');
  await ctx.storage.put(thumbKey, thumb, 'image/webp');
  await trx
    .insertInto('garment_images')
    .values({
      id,
      user_id: userId,
      kind,
      storage_key: key,
      thumb_storage_key: thumbKey,
      mime: 'image/png',
      width: out.info.width,
      height: out.info.height,
      bytes: out.data.length,
      sha256: createHash('sha256').update(out.data).digest('hex'),
      phash: await dHash(out.data),
      generated_by: generatedBy,
    })
    .execute();
  return id;
}

/** The user's body photo on a studio background (vertical gradient + soft floor shadow). */
export async function composeOnBackground(cutoutPng: Buffer, background: Exclude<AvatarBackground, 'original'>): Promise<Buffer> {
  const meta = await sharp(cutoutPng).metadata();
  const w = meta.width ?? 768;
  const h = meta.height ?? 1024;
  const { top, bottom } = BACKGROUNDS[background];
  const gradient = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>` +
      `<radialGradient id="s" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#000" stop-opacity="0.18"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient></defs>` +
      `<rect width="100%" height="100%" fill="url(#g)"/><ellipse cx="${w / 2}" cy="${h * 0.965}" rx="${w * 0.28}" ry="${h * 0.025}" fill="url(#s)"/></svg>`,
  );
  return sharp(gradient).composite([{ input: cutoutPng }]).png().toBuffer();
}

async function bodyPhoto(ctx: AppContext, trx: Tx): Promise<{ body: Buffer; mime: string; id: string }> {
  const p = await trx.selectFrom('avatar_profiles').selectAll().executeTakeFirst();
  if (!p?.body_image_id || !p.attested_self || !p.attested_adult) throw badRequest('Primero añade tu foto de cuerpo entero en «Tu avatar».');
  const img = await trx.selectFrom('garment_images').select(['storage_key', 'mime']).where('id', '=', p.body_image_id).executeTakeFirstOrThrow();
  const body = await ctx.storage.get(img.storage_key);
  if (!body) throw notFound('Foto de cuerpo entero');
  return { body, mime: img.mime, id: p.body_image_id };
}

/** Creates (or returns) a base. Frontal bases are built now; other views are queued as a generation job. */
export async function createBase(ctx: AppContext, trx: Tx, userId: string, view: AvatarView, background: AvatarBackground): Promise<{ baseId: string; jobId: string | null }> {
  const existing = await trx.selectFrom('avatar_bases').select(['id', 'status']).where('view', '=', view).where('background', '=', background).executeTakeFirst();
  if (existing && existing.status !== 'failed') return { baseId: existing.id, jobId: null };
  if (view === 'frontal') {
    const { body, mime } = await bodyPhoto(ctx, trx);
    let png: Buffer;
    if (background === 'original') png = await sharp(body).png().toBuffer();
    else {
      const matte = await ctx.vision.matte(body, mime);
      if (matte.coverage < 0.05) throw badRequest('No se distingue a la persona en tu foto de cuerpo entero. Prueba con otra foto.');
      png = await composeOnBackground(Buffer.from(matte.png_base64, 'base64'), background);
    }
    const imageId = await storeImage(ctx, trx, userId, png, 'avatar_base', null);
    if (existing) {
      await trx.updateTable('avatar_bases').set({ status: 'ready', image_id: imageId, error: null }).where('id', '=', existing.id).execute();
      return { baseId: existing.id, jobId: null };
    }
    const row = await trx.insertInto('avatar_bases').values({ user_id: userId, view, background, status: 'ready', image_id: imageId }).returning('id').executeTakeFirstOrThrow();
    return { baseId: row.id, jobId: null };
  }
  if (!ctx.imagegen.hasWorkflow('avatar-view') || !(await ctx.imagegen.info()).available) throw unavailable('El generador de vistas del avatar no está disponible ahora mismo.');
  const frontal = await createBase(ctx, trx, userId, 'frontal', background);
  const baseId =
    existing?.id ??
    (await trx.insertInto('avatar_bases').values({ user_id: userId, view, background, status: 'generating' }).returning('id').executeTakeFirstOrThrow()).id;
  await trx.updateTable('avatar_bases').set({ status: 'generating', error: null }).where('id', '=', baseId).execute();
  const job = await trx
    .insertInto('generation_jobs')
    .values({ user_id: userId, kind: 'avatar_view', avatar_base_id: baseId, model: 'Qwen-Image-Edit-2511 + Multiple-Angles LoRA', input: JSON.stringify({ fromBaseId: frontal.baseId, view }) })
    .returning('id')
    .executeTakeFirstOrThrow();
  return { baseId, jobId: job.id };
}

export async function runViewJob(ctx: AppContext, userId: string, row: { id: string; avatar_base_id: string | null; input: unknown }, seed: number): Promise<{ imageId: string }> {
  const input = row.input as { fromBaseId: string; view: Exclude<AvatarView, 'frontal'> };
  const src = await withUser(ctx.db, userId, async (trx) => {
    const b = await trx.selectFrom('avatar_bases').select('image_id').where('id', '=', input.fromBaseId).executeTakeFirst();
    return b?.image_id ? trx.selectFrom('garment_images').select('storage_key').where('id', '=', b.image_id).executeTakeFirst() : null;
  });
  const body = src ? await ctx.storage.get(src.storage_key) : null;
  if (!body) throw new ComfyError('No se encuentra la imagen frontal del avatar.', false);
  const out = await ctx.imagegen.runWorkflow('avatar-view', { BODY_IMAGE: body }, VIEW_PROMPT[input.view], seed);
  return withUser(ctx.db, userId, async (trx) => {
    const imageId = await storeImage(ctx, trx, userId, out, 'avatar_base', 'Qwen-Image-Edit-2511 + Multiple-Angles LoRA');
    await trx.updateTable('avatar_bases').set({ status: 'ready', image_id: imageId, error: null }).where('id', '=', row.avatar_base_id!).execute();
    return { imageId };
  });
}

export async function failBase(ctx: AppContext, userId: string, baseId: string | null, error: string) {
  if (!baseId) return;
  await withUser(ctx.db, userId, (trx) => trx.updateTable('avatar_bases').set({ status: 'failed', error }).where('id', '=', baseId).execute());
}

// ---------------------------------------------------------------------------
// Sequential try-on
// ---------------------------------------------------------------------------

export interface OutfitPiece {
  slot: string;
  garmentId: string;
  cutoutImageId: string;
  cutoutKey: string;
  label: string;
  category: string;
}

const CLOTHING_ORDER: Record<string, number> = { bottom: 0, one_piece: 0, base: 1, mid: 2, outer: 3 };
const FASHN_CATEGORY: Record<string, TryonCategory> = { bottom: 'bottoms', one_piece: 'one-pieces', base: 'tops', mid: 'tops', outer: 'tops' };

/** Where each extra goes: the region the extras pass may change, and the words for the prompt. */
export const EXTRA_PLACEMENT: Record<string, { region: ExtraRegion; where: string }> = {
  footwear: { region: 'feet', where: 'on the feet' },
  'accessory:head': { region: 'head', where: 'on the head' },
  'accessory:neck': { region: 'neck', where: 'around the neck' },
};

/**
 * Dressing plan: clothes inner → outer, then shoes + one accessory (hat, else scarf) in one last
 * pass. Bags are not tried on: the pass is pasted back only inside small body regions, and a bag
 * would need the whole arm and torso (the user sees it in the outfit next to the render).
 */
export function sequentialPlan<T extends { slot: string }>(pieces: T[]): { clothes: T[]; extras: T[] } {
  const clothes = pieces.filter((p) => p.slot in CLOTHING_ORDER).sort((a, b) => CLOTHING_ORDER[a.slot]! - CLOTHING_ORDER[b.slot]!);
  const shoes = pieces.filter((p) => p.slot === 'footwear').slice(0, 1);
  const accessory = ['accessory:head', 'accessory:neck'].map((s) => pieces.find((p) => p.slot === s)).find((p): p is T => !!p);
  return { clothes, extras: [...shoes, ...(accessory ? [accessory] : [])] };
}

/** Whether a step replaces the clothes in its region (true) or dresses over earlier layers (false). */
export function maskFor(before: Array<{ slot: string }>, slot: string): boolean {
  const upper = (s: string) => s === 'base' || s === 'mid' || s === 'outer' || s === 'one_piece';
  if (slot === 'bottom' || slot === 'one_piece') return true;
  return !before.some((b) => upper(b.slot));
}

export function stepKey(baseImageId: string, done: Array<{ garmentId: string; cutoutImageId: string; slot: string }>, engine: string): string {
  return createHash('sha256')
    .update(JSON.stringify([baseImageId, engine, done.map((d) => [d.garmentId, d.cutoutImageId, d.slot])]))
    .digest('hex');
}

const seedFor = (key: string) => parseInt(key.slice(0, 8), 16) % 2_147_483_647;

async function setProgress(ctx: AppContext, userId: string, jobId: string, progress: { step: number; total: number; label: string; reused: number }) {
  await withUser(ctx.db, userId, (trx) => trx.updateTable('generation_jobs').set({ progress: JSON.stringify(progress) }).where('id', '=', jobId).execute());
}

async function cached(ctx: AppContext, userId: string, key: string): Promise<{ imageId: string; data: Buffer } | null> {
  return withUser(ctx.db, userId, async (trx) => {
    const c = await trx.selectFrom('tryon_cache as c').innerJoin('garment_images as i', 'i.id', 'c.image_id').select(['c.image_id', 'i.storage_key']).where('c.key', '=', key).executeTakeFirst();
    if (!c) return null;
    const data = await ctx.storage.get(c.storage_key);
    return data ? { imageId: c.image_id, data } : null;
  });
}

async function remember(ctx: AppContext, userId: string, key: string, data: Buffer, model: string): Promise<string> {
  return withUser(ctx.db, userId, async (trx) => {
    const imageId = await storeImage(ctx, trx, userId, data, 'tryon_step', model);
    await trx.insertInto('tryon_cache').values({ user_id: userId, key, image_id: imageId }).onConflict((oc) => oc.columns(['user_id', 'key']).doUpdateSet({ image_id: imageId, created_at: new Date() })).execute();
    return imageId;
  });
}

/** Composes shoes/accessory cutouts on a white board for the last (Qwen) pass. */
async function extrasBoard(ctx: AppContext, extras: OutfitPiece[]): Promise<Buffer> {
  const W = 1024;
  const H = 1024;
  const cw = W / extras.length;
  const layers = await Promise.all(
    extras.map(async (p, i) => {
      const body = await ctx.storage.get(p.cutoutKey);
      if (!body) return null;
      const input = await sharp(body).resize(Math.round(cw - 60), H - 120, { fit: 'inside' }).png().toBuffer();
      const m = await sharp(input).metadata();
      return { input, left: Math.round(i * cw + (cw - (m.width ?? 0)) / 2), top: Math.round((H - (m.height ?? 0)) / 2) };
    }),
  );
  return sharp({ create: { width: W, height: H, channels: 3, background: '#ffffff' } }).composite(layers.filter((l): l is NonNullable<typeof l> => !!l)).png().toBuffer();
}

/** Runs the sequential method from a base image; returns the final image id and how many steps came from the cache. */
export async function runSequential(
  ctx: AppContext,
  userId: string,
  jobId: string,
  base: { imageId: string; data: Buffer },
  pieces: OutfitPiece[],
): Promise<{ imageId: string; data: Buffer; reused: number; total: number }> {
  if (!ctx.tryon) throw new ComfyError('El probador virtual no está configurado.', false);
  const { clothes, extras } = sequentialPlan(pieces);
  const total = clothes.length + (extras.length ? 1 : 0);
  let current = base;
  let reused = 0;
  const done: OutfitPiece[] = [];
  for (const [i, piece] of clothes.entries()) {
    done.push(piece);
    const key = stepKey(base.imageId, done, `fashn-vton-1.5:${ctx.cfg.TRYON_STEPS}:mask-v1`);
    const hit = await cached(ctx, userId, key);
    await setProgress(ctx, userId, jobId, { step: i + 1, total, label: `${hit ? 'Reutilizando' : 'Probando'}: ${piece.label}`, reused });
    if (hit) {
      reused++;
      current = hit;
      continue;
    }
    const garment = await ctx.storage.get(piece.cutoutKey);
    if (!garment) throw new ComfyError(`No se encuentra la foto de ${piece.label}.`, false);
    // The first garment of each region replaces what the photo shows there (a bulky jacket must go);
    // later layers (cardigan, jacket) are dressed over the previous result.
    const mask = maskFor(done.slice(0, -1), piece.slot);
    const out = await ctx.tryon.tryon(current.data, garment, FASHN_CATEGORY[piece.slot]!, { steps: ctx.cfg.TRYON_STEPS, seed: seedFor(key), mask });
    current = { imageId: await remember(ctx, userId, key, out, 'fashn-vton-1.5'), data: out };
  }
  if (extras.length) {
    const key = stepKey(base.imageId, [...done, ...extras], 'qwen-accessories:v2');
    const hit = await cached(ctx, userId, key);
    await setProgress(ctx, userId, jobId, { step: total, total, label: `${hit ? 'Reutilizando' : 'Añadiendo'}: ${extras.map((e) => e.label).join(' y ')}`, reused });
    if (hit) {
      reused++;
      current = hit;
    } else {
      if (!ctx.imagegen.hasWorkflow('tryon-accessories')) throw new ComfyError('Falta el paso de calzado y complementos en el generador.', false);
      const board = await extrasBoard(ctx, extras);
      const description = extras.map((e) => `${e.label}, ${EXTRA_PLACEMENT[e.slot]!.where}`).join('; ');
      const edited = await ctx.imagegen.runWorkflow('tryon-accessories', { BODY_IMAGE: current.data, OUTFIT_IMAGE: board }, description, seedFor(key));
      // Keep the edit only on the feet / head / neck: anything else the generator changed is discarded.
      const out = await ctx.tryon.composite(current.data, edited, [...new Set(extras.map((e) => EXTRA_PLACEMENT[e.slot]!.region))]);
      current = { imageId: await remember(ctx, userId, key, out, 'Qwen-Image-Edit-2511'), data: out };
    }
  }
  return { ...current, reused, total };
}

// ---------------------------------------------------------------------------
// Fidelity gate on the worn garments
// ---------------------------------------------------------------------------

const REGION_FOR: Record<string, 'upper' | 'lower' | 'shoes'> = { outer: 'upper', mid: 'upper', base: 'upper', one_piece: 'upper', bottom: 'lower', footwear: 'shoes' };

/** Mean CIELAB colour of an RGBA crop (opaque pixels). */
export async function meanLab(png: Buffer): Promise<readonly [number, number, number] | null> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i + 3]! < 128) continue;
    r += data[i]!;
    g += data[i + 1]!;
    b += data[i + 2]!;
    n++;
  }
  return n ? rgbToLab([r / n, g / n, b / n]) : null;
}

export interface WornCheck {
  label: string;
  slot: string;
  found: boolean;
  similarity: number | null;
  deltaE: number | null;
}

/** Decision from the per-garment checks (thresholds calibrated in docs/probador-virtual.md). */
export function wornFidelity(checks: WornCheck[], limits: { minSimilarity: number; maxDeltaE: number }): FidelityDto {
  const measured = checks.filter((c) => c.found && c.similarity !== null);
  const missing = checks.filter((c) => !c.found);
  const off = measured.filter((c) => (c.deltaE ?? 0) > limits.maxDeltaE || (c.similarity ?? 1) < limits.minSimilarity);
  const similarity = measured.length ? measured.reduce((a, c) => a + c.similarity!, 0) / measured.length : 0;
  const colorDeltaE = measured.length ? measured.reduce((a, c) => a + (c.deltaE ?? 0), 0) / measured.length : 0;
  const reason = missing.length
    ? `No se ve ${missing.map((m) => m.label).join(' ni ')} en la imagen generada.`
    : off.length
      ? `La imagen generada no reproduce bien ${off.map((m) => m.label).join(' ni ')}.`
      : null;
  return { similarity: Math.round(similarity * 1000) / 1000, colorDeltaE: Math.round(colorDeltaE * 100) / 100, passed: reason === null, reason };
}

/** Parses the render and checks every visible clothing piece and the shoes. */
export async function checkWorn(ctx: AppContext, userId: string, render: Buffer, pieces: OutfitPiece[]): Promise<{ checks: WornCheck[]; identityArea: number }> {
  if (!ctx.tryon) return { checks: [], identityArea: 0 };
  const regions = await ctx.tryon.parse(render);
  const { clothes, extras } = sequentialPlan(pieces);
  // What is visible: the outermost upper layer, the bottom/one-piece, and the shoes.
  const uppers = clothes.filter((c) => ['base', 'mid', 'outer'].includes(c.slot));
  const visible = [uppers.at(-1), clothes.find((c) => c.slot === 'bottom' || c.slot === 'one_piece'), extras.find((e) => e.slot === 'footwear')].filter((p): p is OutfitPiece => !!p);
  const embeddings = await withUser(ctx.db, userId, (trx) =>
    trx.selectFrom('garment_embeddings').select(['garment_id', (eb) => eb.cast<string>('embedding', 'text').as('e')]).where('garment_id', 'in', visible.length ? visible.map((v) => v.garmentId) : ['00000000-0000-0000-0000-000000000000']).execute(),
  );
  const checks: WornCheck[] = [];
  for (const piece of visible) {
    const region = regions[REGION_FOR[piece.slot]!];
    if (!region?.png_base64 || region.area < 0.004) {
      checks.push({ label: piece.label, slot: piece.slot, found: false, similarity: null, deltaE: null });
      continue;
    }
    const crop = Buffer.from(region.png_base64, 'base64');
    const onWhite = await sharp(crop).flatten({ background: '#ffffff' }).png().toBuffer();
    const { embedding } = await ctx.vision.embedImage(onWhite, 'image/png', { segment: false });
    const ref = parseVector(embeddings.find((e) => e.garment_id === piece.garmentId)?.e ?? null);
    const lab = await meanLab(crop);
    // Reference colour: the real garment's own cutout (more precise than its colour family).
    const cutout = await ctx.storage.get(piece.cutoutKey);
    const refLab = cutout ? await meanLab(cutout) : null;
    let dot = 0;
    let na = 0;
    let nb = 0;
    if (ref) for (let i = 0; i < Math.min(ref.length, embedding.length); i++) (dot += ref[i]! * embedding[i]!), (na += ref[i]! ** 2), (nb += embedding[i]! ** 2);
    checks.push({
      label: piece.label,
      slot: piece.slot,
      found: true,
      similarity: ref && na && nb ? Math.round((dot / Math.sqrt(na * nb)) * 1000) / 1000 : null,
      deltaE: lab && refLab ? Math.round(deltaE2000(lab, refLab) * 100) / 100 : null,
    });
  }
  return { checks, identityArea: regions.face?.area ?? 0 };
}
