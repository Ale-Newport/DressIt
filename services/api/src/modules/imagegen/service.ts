/**
 * Generative renders of the user (avatar) wearing an outfit. Opt-in (consents `ai_image_generation`
 * and `avatar`), run asynchronously on the generation queue and pass a fidelity gate before the
 * user sees them: every garment of the outfit must be found in the render (best embedding match
 * among the detected items), otherwise the render is rejected.
 *
 * Product photos of single garments (official photo or AI packshot) live in ../catalog-photo.
 * Generated images are stored with `generated_by` so the app always labels them as AI-generated.
 */
import { composeFlatLay, type AvatarBackground, type AvatarView, getSubcategory, type AvatarProfileDto, type FidelityDto, type GenerationJobDto, type GenerationServiceStatusDto } from '@dressit/shared';
import { sql } from 'kysely';
import sharp from 'sharp';
import type { AppContext } from '../../context.ts';
import { parseVector, withUser, type Tx } from '../../db/index.ts';
import { badRequest, notFound, unavailable } from '../../lib/errors.ts';
import type { AttemptInfo, GenerationJob } from '../../jobs/queue.ts';
import { deleteUserFiles, storeGenerated } from '../images/service.ts';
import { colorLabel } from './labels.ts';
import { imageRef } from '../wardrobe/mappers.ts';
import { ComfyError } from './generator.ts';
import { checkWorn, createBase, failBase, listBases, runSequential, runViewJob, wornFidelity, type OutfitPiece } from './avatar.ts';
import { buildTryonPrompt, tryonLabel } from './tryon-prompt.ts';
import { localVlm } from '../catalog-photo/service.ts';
import { englishLabel } from '../catalog-photo/prompt.ts';

/** Categories never rendered on a person (swimwear): avatars are always fully clothed. */
const NO_AVATAR_CATEGORIES = new Set(['swimwear']);

export async function generationStatus(ctx: AppContext): Promise<GenerationServiceStatusDto> {
  const mlx = localVlm(ctx);
  const [info, tryon, fast] = await Promise.all([ctx.imagegen.info(), ctx.tryon ? ctx.tryon.health() : Promise.resolve(false), mlx ? mlx.available() : Promise.resolve(false)]);
  // With the try-on service or the fast one-pass editor up, renders work even when ComfyUI is down
  // (`available` stays ComfyUI's: the generated avatar views need it).
  return { ...info, avatar: info.avatar || tryon || fast, tryon, fast, models: { ...info.models, avatar: fast ? FAST_MODEL : info.models.avatar } };
}

const FAST_MODEL = 'FLUX.2 klein 4B (MLX)';

async function consentGranted(trx: Tx, kind: 'ai_image_generation' | 'avatar'): Promise<boolean> {
  const row = await trx.selectFrom('consents').select('granted').where('kind', '=', kind).orderBy('created_at', 'desc').limit(1).executeTakeFirst();
  return row?.granted === true;
}

async function requireConsent(trx: Tx, kind: 'ai_image_generation' | 'avatar') {
  if (!(await consentGranted(trx, kind))) {
    throw badRequest(kind === 'avatar' ? 'Activa el consentimiento «Tu avatar» para usar tus fotos.' : 'Activa el consentimiento «Imágenes generadas con IA» para crear imágenes con IA.');
  }
}

// ---------------------------------------------------------------------------
// Fidelity
// ---------------------------------------------------------------------------

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** Are all the outfit's garments visible in the avatar render? Mean of each garment's best match. */
export function avatarFidelity(detected: number[][], garments: number[][], minSimilarity: number): FidelityDto {
  if (!garments.length) return { similarity: 0, colorDeltaE: 0, passed: false, reason: 'El conjunto no tiene prendas con imagen.' };
  const best = garments.map((g) => Math.max(0, ...detected.map((d) => cosine(d, g))));
  const similarity = best.reduce((a, b) => a + b, 0) / best.length;
  const missing = best.filter((s) => s < minSimilarity * 0.7).length;
  const reason = !detected.length
    ? 'No se distinguen prendas en la imagen generada.'
    : similarity < minSimilarity
      ? 'La imagen generada no refleja bien las prendas del conjunto.'
      : missing
        ? `Falta ${missing === 1 ? 'una prenda' : `${missing} prendas`} del conjunto en la imagen generada.`
        : null;
  return { similarity: round3(similarity), colorDeltaE: 0, passed: reason === null, reason };
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

type JobRow = Awaited<ReturnType<typeof getJobRow>>;

async function getJobRow(trx: Tx, id: string) {
  const row = await trx.selectFrom('generation_jobs').selectAll().where('id', '=', id).executeTakeFirst();
  if (!row) throw notFound('Generación');
  return row;
}

export async function jobDto(ctx: AppContext, trx: Tx, userId: string, row: JobRow): Promise<GenerationJobDto> {
  const img = row.result_image_id ? await trx.selectFrom('garment_images').selectAll().where('id', '=', row.result_image_id).executeTakeFirst() : null;
  return {
    id: row.id,
    kind: row.kind as GenerationJobDto['kind'],
    status: row.status as GenerationJobDto['status'],
    garmentId: row.garment_id,
    outfitId: row.outfit_id,
    result: img ? imageRef(ctx.signer, userId, img) : null,
    fidelity: (row.fidelity as FidelityDto | null) ?? null,
    model: row.model,
    error: row.error,
    method: (row.method as GenerationJobDto['method']) ?? null,
    progress: row.status === 'running' || row.status === 'queued' ? ((row.progress as GenerationJobDto['progress']) ?? null) : null,
    createdAt: row.created_at.toISOString(),
    finishedAt: row.finished_at?.toISOString() ?? null,
  };
}

export async function getJob(ctx: AppContext, trx: Tx, userId: string, id: string): Promise<GenerationJobDto> {
  return jobDto(ctx, trx, userId, await getJobRow(trx, id));
}

export async function listJobs(ctx: AppContext, trx: Tx, userId: string, filter: { garmentId?: string; outfitId?: string }): Promise<GenerationJobDto[]> {
  let q = trx.selectFrom('generation_jobs').selectAll().orderBy('created_at', 'desc').limit(20);
  if (filter.garmentId) q = q.where('garment_id', '=', filter.garmentId);
  if (filter.outfitId) q = q.where('outfit_id', '=', filter.outfitId);
  return Promise.all((await q.execute()).map((r) => jobDto(ctx, trx, userId, r)));
}

/** The garment's real cutout (never a previous studio photo: always generate from the real thing). */
async function garmentCutout(trx: Tx, garmentId: string) {
  const g = await trx.selectFrom('garments').selectAll().where('id', '=', garmentId).executeTakeFirst();
  if (!g) throw notFound('Prenda');
  const primary = g.primary_image_id ? await trx.selectFrom('garment_images').selectAll().where('id', '=', g.primary_image_id).executeTakeFirst() : null;
  // Its picture when that is a cut-out (its own cutout or a studio photo, which is stored cut out); else
  // its latest cutout. A garment whose picture is a studio photo may have no cutout linked to it: it was
  // left out of the outfit (a skirt went missing from every try-on).
  const cutout =
    primary?.kind === 'cutout' || primary?.kind === 'studio'
      ? primary
      : await trx.selectFrom('garment_images').selectAll().where('garment_id', '=', garmentId).where('kind', '=', 'cutout').orderBy('created_at', 'desc').limit(1).executeTakeFirst();
  return { garment: g, cutout: cutout ?? null };
}


export async function createAvatarJob(ctx: AppContext, trx: Tx, userId: string, outfitId: string, opts: { baseId?: string; method?: 'fast' | 'sequential' | 'joint' } = {}): Promise<string> {
  await requireConsent(trx, 'ai_image_generation');
  await requireConsent(trx, 'avatar');
  const profile = await trx.selectFrom('avatar_profiles').selectAll().executeTakeFirst();
  if (!profile?.body_image_id || !profile.attested_self || !profile.attested_adult) {
    throw badRequest('Primero añade tu foto de cuerpo entero en «Tu avatar».');
  }
  const items = await outfitGarments(trx, outfitId);
  if (!items.length) throw badRequest('Este conjunto no tiene prendas con foto.');
  if (items.some((i) => NO_AVATAR_CATEGORIES.has(i.garment.category))) throw badRequest('Los avatares no se generan con ropa de baño.');
  const status = await generationStatus(ctx);
  // The configured method when it is up; otherwise the fast one, the try-on service, or one pass.
  const preferred = ctx.cfg.AVATAR_METHOD;
  const up = (m: 'fast' | 'sequential' | 'joint') => (m === 'fast' ? !!status.fast : m === 'sequential' ? !!status.tryon : true);
  const method = opts.method ?? (up(preferred) ? preferred : status.fast ? 'fast' : status.tryon ? 'sequential' : 'joint');
  if (method === 'fast' && !status.fast) throw unavailable('El probador rápido no está disponible ahora mismo.');
  if (method === 'sequential' && !status.tryon) throw unavailable('El probador virtual no está disponible ahora mismo. Prueba el método de una sola pasada.');
  if (method === 'joint') {
    if (!profile.face_image_id) throw badRequest('El método de una sola pasada necesita también tu foto de cara.');
    if (!(await ctx.imagegen.info()).avatar) throw unavailable('El generador de imágenes no está disponible ahora mismo.');
  }
  if (method !== 'joint' && !items.some((i) => ['base', 'mid', 'outer', 'bottom', 'one_piece'].includes(i.slot))) {
    throw badRequest('El probador necesita al menos una prenda de arriba, de abajo o un vestido.');
  }
  // The avatar image to dress: the one chosen, or the frontal studio base (built now if missing).
  let baseId = opts.baseId ?? null;
  if (method !== 'joint') {
    if (baseId) {
      const b = await trx.selectFrom('avatar_bases').select(['status']).where('id', '=', baseId).executeTakeFirst();
      if (!b) throw notFound('Imagen del avatar');
      if (b.status !== 'ready') throw badRequest('Esa imagen del avatar todavía no está lista.');
    } else baseId = (await createBase(ctx, trx, userId, 'frontal', 'estudio_gris')).baseId;
  }
  const busy = await trx.selectFrom('generation_jobs').select('id').where('outfit_id', '=', outfitId).where('status', 'in', ['queued', 'running']).executeTakeFirst();
  if (busy) return busy.id;
  const model =
    method === 'fast'
      ? FAST_MODEL
      : method === 'sequential'
        ? `FASHN VTON v1.5${status.avatar && ctx.imagegen.hasWorkflow('tryon-accessories') ? ' + Qwen-Image-Edit-2511' : ''}`
        : (ctx.imagegen.workflowModel(ctx.cfg.IMAGEGEN_AVATAR_WORKFLOW) ?? 'Qwen-Image-Edit-2511');
  const row = await trx
    .insertInto('generation_jobs')
    .values({ user_id: userId, kind: 'avatar', outfit_id: outfitId, model, method, avatar_base_id: baseId, input: JSON.stringify({ garmentIds: items.map((i) => i.garment.id) }) })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

/** `POST /v1/me/avatar/bases`: frontal bases are ready at once; other views return a generation job. */
export async function createAvatarBase(ctx: AppContext, trx: Tx, userId: string, view: AvatarView, background: AvatarBackground) {
  await requireConsent(trx, 'avatar');
  if (view !== 'frontal') await requireConsent(trx, 'ai_image_generation');
  return createBase(ctx, trx, userId, view, background);
}

/**
 * What the avatar actually shows: the outermost upper layer, the bottom (or the one-piece), the
 * shoes and at most one accessory (hat first) — at most 4 pieces. Image models drop or merge
 * pieces when given more, and inner layers are hidden under a jacket anyway (they go in the text).
 */
export function visibleForAvatar<T extends { slot: string }>(items: T[]): { shown: T[]; layered: T[] } {
  const by = (s: string) => items.find((i) => i.slot === s);
  const upper = ['outer', 'mid', 'base'].map(by).filter((i): i is T => !!i);
  const accessory = ['accessory:head', 'accessory:neck', 'accessory:bag'].map(by).find((i): i is T => !!i);
  const shown = [upper[0], by('one_piece') ?? by('bottom'), by('footwear'), accessory].filter((i): i is T => !!i).slice(0, 4);
  return { shown, layered: upper.slice(1) };
}

async function outfitGarments(trx: Tx, outfitId: string) {
  const outfit = await trx.selectFrom('outfits').select('id').where('id', '=', outfitId).executeTakeFirst();
  if (!outfit) throw notFound('Conjunto');
  const rows = await trx.selectFrom('outfit_items').select(['slot', 'garment_id']).where('outfit_id', '=', outfitId).where('garment_id', 'is not', null).execute();
  const out: Array<{ slot: string; garment: Awaited<ReturnType<typeof garmentCutout>>['garment']; cutout: NonNullable<Awaited<ReturnType<typeof garmentCutout>>['cutout']> }> = [];
  for (const r of rows) {
    const { garment, cutout } = await garmentCutout(trx, r.garment_id!);
    if (cutout) out.push({ slot: r.slot, garment, cutout });
  }
  return out;
}

const describe = (g: { subcategory: string; primary_color: string | null; name: string }) =>
  [getSubcategory(g.subcategory)?.label.toLowerCase() ?? g.name, g.primary_color ? colorLabel(g.primary_color) : null].filter(Boolean).join(', ');

/** Flat lay of the outfit's cutouts on white (input board for the avatar model). */
async function outfitBoard(ctx: AppContext, items: Awaited<ReturnType<typeof outfitGarments>>): Promise<Buffer> {
  const W = 1024;
  const H = 1280;
  const boxes = composeFlatLay(
    items.map((i) => ({ key: i.slot, slot: i.slot, category: i.garment.category, subcategory: i.garment.subcategory, aspect: i.cutout.width && i.cutout.height ? i.cutout.width / i.cutout.height : null })),
    { canvasAspect: W / H },
  );
  const layers = await Promise.all(
    boxes.map(async (b) => {
      const it = items.find((i) => i.slot === b.key)!;
      const body = await ctx.storage.get(it.cutout.storage_key);
      if (!body) return null;
      const input = await sharp(body).resize(Math.max(1, Math.round(b.w * W)), Math.max(1, Math.round(b.h * H)), { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
      return { input, left: Math.round(b.x * W), top: Math.round(b.y * H) };
    }),
  );
  return sharp({ create: { width: W, height: H, channels: 3, background: '#ffffff' } }).composite(layers.filter((l): l is NonNullable<typeof l> => !!l)).png().toBuffer();
}

async function finish(ctx: AppContext, userId: string, id: string, set: { status: 'done' | 'failed' | 'rejected'; error?: string | null; fidelity?: FidelityDto | null; result_image_id?: string | null }) {
  await withUser(ctx.db, userId, (trx) =>
    trx
      .updateTable('generation_jobs')
      .set({ status: set.status, error: set.error ?? null, fidelity: set.fidelity ? JSON.stringify(set.fidelity) : null, result_image_id: set.result_image_id ?? null, finished_at: new Date() })
      .where('id', '=', id)
      .execute(),
  );
}

/** Worker: runs one generation job end to end. */
export async function processGeneration(ctx: AppContext, job: GenerationJob, attempt: AttemptInfo = { attempt: 1, isLastAttempt: true }): Promise<void> {
  const row = await withUser(ctx.db, job.userId, async (trx) => {
    const r = await trx.selectFrom('generation_jobs').selectAll().where('id', '=', job.generationId).executeTakeFirst();
    if (!r || r.status === 'done' || r.status === 'rejected') return null;
    await trx.updateTable('generation_jobs').set({ status: 'running', started_at: new Date(), attempts: r.attempts + 1 }).where('id', '=', r.id).execute();
    return r;
  });
  if (!row) return;
  const seed = Math.floor(Math.random() * 2 ** 31);
  try {
    if (row.kind === 'avatar_view') {
      const { imageId } = await runViewJob(ctx, job.userId, row, seed);
      await finish(ctx, job.userId, row.id, { status: 'done', result_image_id: imageId });
    } else if (row.method === 'fast') await runAvatarFast(ctx, job.userId, row, seed);
    else if (row.method === 'sequential') await runAvatarSequential(ctx, job.userId, row);
    else await runAvatar(ctx, job.userId, row, seed);
  } catch (e) {
    const retryable = e instanceof ComfyError ? e.retryable : true;
    if (retryable && !attempt.isLastAttempt) {
      await withUser(ctx.db, job.userId, (trx) => trx.updateTable('generation_jobs').set({ status: 'queued' }).where('id', '=', row.id).execute());
      throw e;
    }
    const error = e instanceof ComfyError ? e.message : 'No se ha podido generar la imagen. Inténtalo más tarde.';
    if (row.kind === 'avatar_view') await failBase(ctx, job.userId, row.avatar_base_id, error);
    await finish(ctx, job.userId, row.id, { status: 'failed', error });
  }
}

async function runAvatar(ctx: AppContext, userId: string, row: NonNullable<JobRow>, seed: number) {
  const data = await withUser(ctx.db, userId, async (trx) => {
    const profile = await trx.selectFrom('avatar_profiles').selectAll().executeTakeFirst();
    if (!profile?.face_image_id || !profile.body_image_id) return null;
    const imgs = await trx.selectFrom('garment_images').select(['id', 'storage_key']).where('id', 'in', [profile.face_image_id, profile.body_image_id]).execute();
    const items = await outfitGarments(trx, row.outfit_id!);
    const embs = await trx.selectFrom('garment_embeddings').select(['garment_id', sqlEmbedding]).where('garment_id', 'in', items.length ? items.map((i) => i.garment.id) : ['00000000-0000-0000-0000-000000000000']).execute();
    return { profile, imgs, items, embs };
  });
  if (!data) throw new ComfyError('Faltan tus fotos para el avatar.', false);
  const face = await ctx.storage.get(data.imgs.find((i) => i.id === data.profile.face_image_id)!.storage_key);
  const body = await ctx.storage.get(data.imgs.find((i) => i.id === data.profile.body_image_id)!.storage_key);
  if (!face || !body) throw new ComfyError('No se encuentran tus fotos para el avatar.', false);
  // Only the visible pieces, in the board and in the text: mentioning inner layers made the model
  // draw them on top (a cardigan instead of the puffer over it).
  const { shown } = visibleForAvatar(data.items);
  const board = await outfitBoard(ctx, shown);
  const description = shown.map((i) => describe(i.garment)).join('; ');
  const render = await ctx.imagegen.avatar({ face, body, outfitBoard: board, description, seed });
  const analysis = await ctx.vision.analyze(render, 'image/png', 'multi', 8);
  const shownIds = new Set(shown.map((i) => i.garment.id));
  const garmentEmbeddings = data.embs.filter((e) => shownIds.has(e.garment_id)).map((e) => parseVector(e.embedding_text)).filter((v): v is number[] => !!v);
  const fidelity = avatarFidelity(
    analysis.items.map((i) => i.embedding ?? []).filter((v) => v.length),
    garmentEmbeddings,
    ctx.cfg.IMAGEGEN_AVATAR_MIN_SIMILARITY,
  );
  if (!fidelity.passed) {
    await finish(ctx, userId, row.id, { status: 'rejected', error: fidelity.reason, fidelity });
    return;
  }
  const imageId = await withUser(ctx.db, userId, (trx) => storeGenerated(ctx, trx, userId, render, 'avatar_render', { model: row.model ?? 'desconocido' }));
  await finish(ctx, userId, row.id, { status: 'done', fidelity, result_image_id: imageId });
}

/**
 * The pieces a one-pass render shows, at most 4 (the editor mixes up more): the outer layer, the bottom
 * or one-piece, the shoes, then an inner layer (it shows under an open jacket) or one accessory.
 */
export function piecesForFastRender<T extends { slot: string }>(items: T[]): T[] {
  const { shown, layered } = visibleForAvatar(items);
  const out = [...shown];
  if (out.length < 4 && layered[0]) out.splice(1, 0, layered[0]);
  return out.slice(0, 4);
}

/**
 * Fast try-on: FLUX.2 klein in the local MLX server dresses the user's avatar photo with each garment's
 * own picture (its studio or catalogue photo when it has one), in one pass of ~15–25 s. The face, body,
 * pose and background are those of the photo; then the same gate as the other methods.
 */
async function runAvatarFast(ctx: AppContext, userId: string, row: NonNullable<JobRow>, seed: number) {
  const mlx = localVlm(ctx);
  if (!mlx) throw new ComfyError('El probador rápido no está configurado.', false);
  const data = await withUser(ctx.db, userId, async (trx) => {
    const base = row.avatar_base_id ? await trx.selectFrom('avatar_bases').select(['image_id']).where('id', '=', row.avatar_base_id).executeTakeFirst() : null;
    const img = base?.image_id ? await trx.selectFrom('garment_images').select(['id', 'storage_key']).where('id', '=', base.image_id).executeTakeFirst() : null;
    const items = await outfitGarments(trx, row.outfit_id!);
    const pieces = piecesForFastRender(items);
    const ids = pieces.length ? pieces.map((p) => p.garment.id) : ['00000000-0000-0000-0000-000000000000'];
    const primaries = await trx.selectFrom('garment_images').select(['id', 'garment_id', 'kind', 'storage_key']).where('id', 'in', pieces.map((p) => p.garment.primary_image_id).filter((v): v is string => !!v).concat(['00000000-0000-0000-0000-000000000000'])).execute();
    // The garment as the vision-language model named it at import ("red hooded sweatshirt"), in English.
    const named = await trx
      .selectFrom('import_detections')
      .select(['garment_id', sql<string | null>`predicted->'vlm'->>'name'`.as('name'), sql<string | null>`predicted->'vlm'->'attributes'->>'length'`.as('length')])
      .where('garment_id', 'in', ids)
      .execute();
    const embs = await trx.selectFrom('garment_embeddings').select(['garment_id', sqlEmbedding]).where('garment_id', 'in', ids).execute();
    return { img, pieces, primaries, named, embs };
  });
  if (!data.img) throw new ComfyError('La imagen de tu avatar ya no existe. Vuelve a crearla en «Tu avatar».', false);
  const person = await ctx.storage.get(data.img.storage_key);
  if (!person) throw new ComfyError('No se encuentra la imagen de tu avatar.', false);
  const garments: Buffer[] = [];
  const labels: string[] = [];
  for (const p of data.pieces) {
    // Its studio or catalogue photo when that is its picture (cleaner, complete), else its cutout.
    const primary = data.primaries.find((i) => i.id === p.garment.primary_image_id && (i.kind === 'studio' || i.kind === 'cutout'));
    const body = await ctx.storage.get((primary ?? p.cutout).storage_key);
    if (!body) continue;
    garments.push(await sharp(body).flatten({ background: '#ececec' }).png().toBuffer());
    const vlm = data.named.find((n) => n.garment_id === p.garment.id && n.name);
    const label = (vlm?.name ?? englishLabel(p.garment.subcategory, p.garment.primary_color)).toLowerCase();
    labels.push(tryonLabel(label, vlm?.length, p.garment.category));
  }
  if (!garments.length) throw new ComfyError('Las prendas de este conjunto no tienen foto.', false);
  // klein sometimes leaves one garment out (keeps the person's leggings instead of the skirt): the
  // vision-language model checks each one is worn, and one more pass with another seed fixes it.
  let render: Buffer | null = null;
  let missing = Infinity;
  for (let n = 0; n < 2 && missing > 0; n++) {
    const { image } = await mlx.tryon({ person, garments, prompt: buildTryonPrompt(labels), seed: seed + n * 7919 });
    const worn = await mlx.tryonWorn(image, labels);
    const left = worn ? worn.filter((w) => !w).length : 0;
    if (left < missing) {
      render = image;
      missing = left;
    }
  }
  if (!render) throw new ComfyError('No se ha podido generar la imagen.', true);
  const analysis = await ctx.vision.analyze(render, 'image/png', 'multi', 8);
  const shownIds = new Set(data.pieces.map((p) => p.garment.id));
  const garmentEmbeddings = data.embs.filter((e) => shownIds.has(e.garment_id)).map((e) => parseVector(e.embedding_text)).filter((v): v is number[] => !!v);
  const fidelity = avatarFidelity(
    analysis.items.map((i) => i.embedding ?? []).filter((v) => v.length),
    garmentEmbeddings,
    ctx.cfg.IMAGEGEN_AVATAR_MIN_SIMILARITY,
  );
  if (!fidelity.passed) {
    await finish(ctx, userId, row.id, { status: 'rejected', error: fidelity.reason, fidelity });
    return;
  }
  const imageId = await withUser(ctx.db, userId, (trx) => storeGenerated(ctx, trx, userId, render, 'avatar_render', { model: row.model ?? FAST_MODEL }));
  await finish(ctx, userId, row.id, { status: 'done', fidelity, result_image_id: imageId });
}

/** Sequential try-on from a saved avatar base: one garment per pass, cached per step, then the gate. */
async function runAvatarSequential(ctx: AppContext, userId: string, row: NonNullable<JobRow>) {
  const data = await withUser(ctx.db, userId, async (trx) => {
    const base = row.avatar_base_id ? await trx.selectFrom('avatar_bases').select(['image_id']).where('id', '=', row.avatar_base_id).executeTakeFirst() : null;
    const img = base?.image_id ? await trx.selectFrom('garment_images').select(['id', 'storage_key']).where('id', '=', base.image_id).executeTakeFirst() : null;
    return { img, items: await outfitGarments(trx, row.outfit_id!) };
  });
  if (!data.img) throw new ComfyError('La imagen de tu avatar ya no existe. Vuelve a crearla en «Tu avatar».', false);
  const baseData = await ctx.storage.get(data.img.storage_key);
  if (!baseData) throw new ComfyError('No se encuentra la imagen de tu avatar.', false);
  const pieces: OutfitPiece[] = data.items.map((i) => ({
    slot: i.slot,
    garmentId: i.garment.id,
    cutoutImageId: i.cutout.id,
    cutoutKey: i.cutout.storage_key,
    label: describe(i.garment),
    category: i.garment.category,
  }));
  // Without the generator, shoes and accessories are left out (the render says so in the fidelity reason).
  const withExtras = ctx.imagegen.hasWorkflow('tryon-accessories') && (await ctx.imagegen.info()).available;
  const usable = withExtras ? pieces : pieces.filter((p) => !(p.slot === 'footwear' || p.slot.startsWith('accessory')));
  const result = await runSequential(ctx, userId, row.id, { imageId: data.img.id, data: baseData }, usable);
  const { checks } = await checkWorn(ctx, userId, result.data, result.tried);
  const notes = [...result.notes];
  if (usable.some((p) => p.slot === 'accessory:bag')) notes.push('Los bolsos no se prueban: compáralo con tu conjunto.');
  const fidelity = { ...wornFidelity(checks, { minSimilarity: ctx.cfg.TRYON_MIN_SIMILARITY, maxDeltaE: ctx.cfg.TRYON_MAX_DELTA_E }), ...(notes.length ? { notes } : {}) };
  if (!fidelity.passed) {
    await finish(ctx, userId, row.id, { status: 'rejected', error: fidelity.reason, fidelity });
    return;
  }
  const imageId = await withUser(ctx.db, userId, (trx) => storeGenerated(ctx, trx, userId, result.data, 'avatar_render', { model: row.model ?? 'FASHN VTON v1.5' }));
  await finish(ctx, userId, row.id, { status: 'done', fidelity, result_image_id: imageId });
}

const sqlEmbedding = sql<string | null>`embedding::text`.as('embedding_text');

// ---------------------------------------------------------------------------
// Studio photo as the garment's picture
// ---------------------------------------------------------------------------

/** Uses one of the garment's own pictures (its cutout, a studio photo or its photo) as the main one. */
export async function setPrimaryImage(trx: Tx, garmentId: string, imageId: string): Promise<void> {
  const img = await trx.selectFrom('garment_images').select(['id', 'kind', 'garment_id', 'parent_image_id']).where('id', '=', imageId).executeTakeFirst();
  const g = await trx.selectFrom('garments').select(['id']).where('id', '=', garmentId).executeTakeFirst();
  if (!g || !img) throw notFound('Imagen');
  const owned = img.garment_id === garmentId || (img.kind === 'cutout' && img.parent_image_id !== null);
  if (!owned || !['cutout', 'studio', 'original', 'product_reference'].includes(img.kind)) throw badRequest('Esa imagen no es de esta prenda.');
  await trx.updateTable('garments').set({ primary_image_id: imageId }).where('id', '=', garmentId).execute();
}

// ---------------------------------------------------------------------------
// Avatar profile (the user's own photos)
// ---------------------------------------------------------------------------

export async function getAvatar(ctx: AppContext, trx: Tx, userId: string): Promise<AvatarProfileDto> {
  const p = await trx.selectFrom('avatar_profiles').selectAll().executeTakeFirst();
  const imgs = p ? await trx.selectFrom('garment_images').selectAll().where('id', 'in', [p.face_image_id, p.body_image_id].filter((x): x is string => !!x).concat('00000000-0000-0000-0000-000000000000')).execute() : [];
  const ref = (id: string | null | undefined) => {
    const img = imgs.find((i) => i.id === id);
    return img ? imageRef(ctx.signer, userId, img) : null;
  };
  const face = ref(p?.face_image_id);
  const body = ref(p?.body_image_id);
  return {
    face,
    body,
    attestedSelf: p?.attested_self ?? false,
    attestedAdult: p?.attested_adult ?? false,
    ready: !!(face && body && p?.attested_self && p?.attested_adult),
    updatedAt: p?.updated_at.toISOString() ?? null,
    bases: await listBases(ctx, trx, userId),
  };
}

export async function setAvatar(
  ctx: AppContext,
  trx: Tx,
  userId: string,
  body: { faceImageId?: string | null; bodyImageId?: string | null; attestedSelf: boolean; attestedAdult: boolean },
): Promise<AvatarProfileDto> {
  await requireConsent(trx, 'avatar');
  if (!body.attestedSelf || !body.attestedAdult) throw badRequest('Confirma que las fotos son tuyas y que eres mayor de edad.');
  const check = async (id: string | null | undefined, kind: 'self_face' | 'self_body') => {
    if (!id) return;
    const img = await trx.selectFrom('garment_images').select('kind').where('id', '=', id).executeTakeFirst();
    if (img?.kind !== kind) throw badRequest(kind === 'self_face' ? 'La foto de cara no es válida.' : 'La foto de cuerpo entero no es válida.');
  };
  await check(body.faceImageId, 'self_face');
  await check(body.bodyImageId, 'self_body');
  const current = await trx.selectFrom('avatar_profiles').selectAll().executeTakeFirst();
  const next = {
    face_image_id: body.faceImageId === undefined ? (current?.face_image_id ?? null) : body.faceImageId,
    body_image_id: body.bodyImageId === undefined ? (current?.body_image_id ?? null) : body.bodyImageId,
    attested_self: body.attestedSelf,
    attested_adult: body.attestedAdult,
    updated_at: new Date(),
  };
  await trx.insertInto('avatar_profiles').values({ user_id: userId, ...next }).onConflict((oc) => oc.column('user_id').doUpdateSet(next)).execute();
  // Replaced photos are deleted, not kept.
  const replaced = [current?.face_image_id, current?.body_image_id].filter((id): id is string => !!id && id !== next.face_image_id && id !== next.body_image_id);
  if (replaced.length) await deleteImages(ctx, trx, replaced);
  // A new body photo makes the saved avatar images and cached try-on steps stale.
  if (current?.body_image_id && current.body_image_id !== next.body_image_id) await deleteBases(ctx, trx);
  return getAvatar(ctx, trx, userId);
}

async function deleteImages(ctx: AppContext, trx: Tx, ids: string[]) {
  if (!ids.length) return;
  const rows = await trx.selectFrom('garment_images').select(['storage_key', 'thumb_storage_key']).where('id', 'in', ids).execute();
  await trx.deleteFrom('garment_images').where('id', 'in', ids).execute();
  await deleteUserFiles(ctx, rows.flatMap((r) => [r.storage_key, r.thumb_storage_key]));
}

async function deleteBases(ctx: AppContext, trx: Tx) {
  const ids = (await trx.selectFrom('garment_images').select('id').where('kind', 'in', ['avatar_base', 'tryon_step']).execute()).map((r) => r.id);
  await trx.deleteFrom('generation_jobs').where('kind', '=', 'avatar_view').execute();
  await trx.deleteFrom('tryon_cache').execute();
  await trx.deleteFrom('avatar_bases').execute();
  await deleteImages(ctx, trx, ids);
}

/** Deletes the user's photos and every avatar render (also when the `avatar` consent is withdrawn). */
export async function deleteAvatar(ctx: AppContext, trx: Tx): Promise<void> {
  const ids = (await trx.selectFrom('garment_images').select('id').where('kind', 'in', ['self_face', 'self_body', 'avatar_render', 'avatar_base', 'tryon_step']).execute()).map((r) => r.id);
  await trx.deleteFrom('generation_jobs').where('kind', 'in', ['avatar', 'avatar_view']).execute();
  await trx.deleteFrom('tryon_cache').execute();
  await trx.deleteFrom('avatar_bases').execute();
  await trx.deleteFrom('avatar_profiles').execute();
  await deleteImages(ctx, trx, ids);
}
