import pg from 'pg';
import { runRetention } from '../../src/modules/maintenance/retention.ts';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fakeEmbed, imagegenState, multipart, registerUser, setupApp, testImage, tryonState, visionState, type TestApp } from './helpers.ts';

let t: TestApp;
beforeAll(async () => {
  t = await setupApp();
});
afterAll(async () => {
  await t?.close();
});
beforeEach(() => {
  visionState.down = false;
  visionState.subcategory = 'camiseta';
  imagegenState.available = true;
  imagegenState.output = null;
  imagegenState.calls = [];
  tryonState.available = true;
  tryonState.calls = [];
  tryonState.masks = [];
  tryonState.composites = [];
  tryonState.recolor = null;
});

type Auth = Record<string, string>;
const consent = (auth: Auth, kind: string, granted = true) => t.app.inject({ method: 'PUT', url: `/v1/me/consents/${kind}`, headers: auth, payload: { granted } });

/** Photo → import → accepted garment(s) with a cutout, like the app does. */
async function digitise(auth: Auth, mode: 'single' | 'multi', color = { r: 30, g: 40, b: 70 }): Promise<Array<{ id: string; colors: Array<{ hex: string }> }>> {
  const up = multipart(await testImage(color), { kind: 'garment_photo' });
  const img = (await t.app.inject({ method: 'POST', url: '/v1/uploads', headers: { ...auth, ...up.headers }, payload: up.payload })).json();
  const job = (await t.app.inject({ method: 'POST', url: '/v1/imports/photos', headers: auth, payload: { imageIds: [img.imageId], mode, source: 'camera' } })).json();
  await t.queue.drain();
  const done = (await t.app.inject({ method: 'GET', url: `/v1/imports/${job.id}`, headers: auth })).json();
  const out = [];
  for (const d of done.detections) out.push((await t.app.inject({ method: 'POST', url: `/v1/imports/${job.id}/detections/${d.id}/accept`, headers: auth, payload: {} })).json());
  return out;
}

/** Make the stored embedding of a garment match an image (the fake vision embeds by bytes). */
async function setEmbedding(garmentId: string, image: Buffer) {
  const admin = new pg.Client({ connectionString: t.adminUrl });
  await admin.connect();
  try {
    await admin.query('update garment_embeddings set embedding = $1::vector where garment_id = $2', [`[${fakeEmbed(image).join(',')}]`, garmentId]);
  } finally {
    await admin.end();
  }
}

/** Counts a user's images of some kinds as the database owner (RLS would hide them otherwise). */
async function countImages(userId: string, kinds: string[]): Promise<number> {
  const admin = new pg.Client({ connectionString: t.adminUrl });
  await admin.connect();
  try {
    return (await admin.query('select count(*)::int as n from garment_images where user_id = $1 and kind = any($2)', [userId, kinds])).rows[0].n;
  } finally {
    await admin.end();
  }
}

const solid = (hex: string) => sharp({ create: { width: 64, height: 80, channels: 3, background: hex } }).png().toBuffer();

describe('studio photos of owned garments', () => {
  it('needs its own consent and reports whether the generator is available', async () => {
    const u = await registerUser(t);
    const [g] = await digitise(u.auth, 'single');
    expect((await t.app.inject({ method: 'GET', url: '/v1/generation/status', headers: u.auth })).json()).toMatchObject({ available: true, studio: true, models: { studio: 'fake-studio' } });
    const r = await t.app.inject({ method: 'POST', url: `/v1/garments/${g!.id}/studio`, headers: u.auth });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.message).toMatch(/Imágenes generadas con IA/);
    imagegenState.available = false;
    await consent(u.auth, 'ai_image_generation');
    expect((await t.app.inject({ method: 'POST', url: `/v1/garments/${g!.id}/studio`, headers: u.auth })).statusCode).toBe(503);
  });

  it('keeps a faithful studio photo, labelled as AI-generated, and lets the user use it', async () => {
    const u = await registerUser(t);
    await consent(u.auth, 'ai_image_generation');
    const [g] = await digitise(u.auth, 'single');
    // The generator returns the garment in its own colour; the fake vision then sees the same garment.
    imagegenState.output = await solid(g!.colors[0]!.hex);
    await setEmbedding(g!.id, imagegenState.output);
    const job = (await t.app.inject({ method: 'POST', url: `/v1/garments/${g!.id}/studio`, headers: u.auth })).json();
    expect(job).toMatchObject({ kind: 'studio', garmentId: g!.id, model: 'fake-studio' });
    expect(['queued', 'running']).toContain(job.status); // the in-process queue may already have started it
    await t.queue.drain();
    const done = (await t.app.inject({ method: 'GET', url: `/v1/generations/${job.id}`, headers: u.auth })).json();
    expect(done.status).toBe('done');
    expect(done.fidelity).toMatchObject({ passed: true, similarity: 1 });
    expect(done.result).toMatchObject({ isCutout: true, generatedBy: 'fake-studio' });
    // The garment's photo stays the real one until the user chooses the studio photo.
    expect((await t.app.inject({ method: 'GET', url: `/v1/garments/${g!.id}`, headers: u.auth })).json().image.generatedBy).toBeUndefined();
    expect((await t.app.inject({ method: 'PUT', url: `/v1/garments/${g!.id}/primary-image`, headers: u.auth, payload: { imageId: done.result.id } })).statusCode).toBe(204);
    const after = (await t.app.inject({ method: 'GET', url: `/v1/garments/${g!.id}`, headers: u.auth })).json();
    expect(after.image).toMatchObject({ id: done.result.id, generatedBy: 'fake-studio' });
    expect(after.images.map((i: { id: string }) => i.id)).toContain(done.result.id);
    // The served file is a real PNG.
    const file = await t.app.inject({ method: 'GET', url: done.result.url.replace(/^https?:\/\/[^/]+/, '') });
    expect(file.headers['content-type']).toBe('image/png');
    // …and says in its own metadata that it was AI-generated (EU AI Act art. 50).
    expect((await sharp(file.rawPayload).metadata()).exif?.toString('latin1')).toContain('AI-generated image (fake-studio)');
  });

  it('rejects a studio photo that changed the garment and stores nothing', async () => {
    const u = await registerUser(t);
    await consent(u.auth, 'ai_image_generation');
    const [g] = await digitise(u.auth, 'single');
    imagegenState.output = await solid('#d01818'); // a red garment instead of the navy one
    const job = (await t.app.inject({ method: 'POST', url: `/v1/garments/${g!.id}/studio`, headers: u.auth })).json();
    await t.queue.drain();
    const done = (await t.app.inject({ method: 'GET', url: `/v1/generations/${job.id}`, headers: u.auth })).json();
    expect(done.status).toBe('rejected');
    expect(done.result).toBeNull();
    expect(done.fidelity.passed).toBe(false);
    expect(done.error).toMatch(/no se parece|color/);
    expect(await countImages(u.id, ['studio'])).toBe(0);
  });

  it('marks a generator failure as failed with a Spanish message', async () => {
    const u = await registerUser(t);
    await consent(u.auth, 'ai_image_generation');
    const [g] = await digitise(u.auth, 'single');
    imagegenState.output = null;
    const job = (await t.app.inject({ method: 'POST', url: `/v1/garments/${g!.id}/studio`, headers: u.auth })).json();
    await t.queue.drain();
    expect((await t.app.inject({ method: 'GET', url: `/v1/generations/${job.id}`, headers: u.auth })).json()).toMatchObject({ status: 'failed', error: 'fallo simulado' });
  });
});

describe('avatar: the user wearing an outfit', () => {
  async function avatarReady(auth: Auth) {
    const face = multipart(await testImage({ r: 200, g: 170, b: 150 }), { kind: 'self_face' });
    const body = multipart(await testImage({ r: 180, g: 160, b: 140 }), { kind: 'self_body' });
    const f = (await t.app.inject({ method: 'POST', url: '/v1/uploads', headers: { ...auth, ...face.headers }, payload: face.payload })).json();
    const b = (await t.app.inject({ method: 'POST', url: '/v1/uploads', headers: { ...auth, ...body.headers }, payload: body.payload })).json();
    return { faceImageId: f.imageId as string, bodyImageId: b.imageId as string };
  }

  it('only accepts the user’s photos with the avatar consent and both attestations', async () => {
    const u = await registerUser(t);
    const face = multipart(await testImage({ r: 200, g: 170, b: 150 }), { kind: 'self_face' });
    expect((await t.app.inject({ method: 'POST', url: '/v1/uploads', headers: { ...u.auth, ...face.headers }, payload: face.payload })).statusCode).toBe(400);
    await consent(u.auth, 'avatar');
    const ids = await avatarReady(u.auth);
    expect((await t.app.inject({ method: 'PUT', url: '/v1/me/avatar', headers: u.auth, payload: { ...ids, attestedSelf: true, attestedAdult: false } })).statusCode).toBe(400);
    // A garment photo can't pose as a face photo.
    const swapped = { faceImageId: ids.bodyImageId, bodyImageId: ids.faceImageId };
    expect((await t.app.inject({ method: 'PUT', url: '/v1/me/avatar', headers: u.auth, payload: { ...swapped, attestedSelf: true, attestedAdult: true } })).statusCode).toBe(400);
    const ok = (await t.app.inject({ method: 'PUT', url: '/v1/me/avatar', headers: u.auth, payload: { ...ids, attestedSelf: true, attestedAdult: true } })).json();
    expect(ok).toMatchObject({ ready: true, attestedSelf: true, attestedAdult: true });
    expect(ok.face.url).toMatch(/\/v1\/images\//);
  });

  it('renders an outfit, checks every garment is in it, and deletes everything when consent is withdrawn', async () => {
    const u = await registerUser(t);
    await consent(u.auth, 'avatar');
    await consent(u.auth, 'ai_image_generation');
    const ids = await avatarReady(u.auth);
    await t.app.inject({ method: 'PUT', url: '/v1/me/avatar', headers: u.auth, payload: { ...ids, attestedSelf: true, attestedAdult: true } });
    const [top, bottom] = await digitise(u.auth, 'multi', { r: 120, g: 120, b: 120 });
    const outfit = (await t.app.inject({ method: 'POST', url: '/v1/outfits', headers: u.auth, payload: { items: [{ slot: 'base', garmentId: top!.id }, { slot: 'bottom', garmentId: bottom!.id }] } })).json();

    // A render that doesn't show the garments is rejected.
    imagegenState.output = await testImage({ r: 90, g: 10, b: 10 }, 'png');
    const bad = (await t.app.inject({ method: 'POST', url: `/v1/outfits/${outfit.id}/avatar`, headers: u.auth, payload: { method: 'joint' } })).json();
    expect(bad.method).toBe('joint');
    await t.queue.drain();
    expect((await t.app.inject({ method: 'GET', url: `/v1/generations/${bad.id}`, headers: u.auth })).json()).toMatchObject({ status: 'rejected', result: null });
    expect(imagegenState.lastAvatarBoard).not.toBeNull(); // the garments were sent as one flat-lay board

    // A render where both garments are recognised is kept and labelled.
    imagegenState.output = await testImage({ r: 60, g: 60, b: 60 }, 'png');
    await setEmbedding(top!.id, imagegenState.output);
    await setEmbedding(bottom!.id, imagegenState.output);
    const good = (await t.app.inject({ method: 'POST', url: `/v1/outfits/${outfit.id}/avatar`, headers: u.auth, payload: { method: 'joint' } })).json();
    await t.queue.drain();
    const done = (await t.app.inject({ method: 'GET', url: `/v1/generations/${good.id}`, headers: u.auth })).json();
    expect(done).toMatchObject({ status: 'done', fidelity: { passed: true } });
    expect(done.result).toMatchObject({ isCutout: false, generatedBy: 'fake-avatar' });
    expect((await t.app.inject({ method: 'GET', url: `/v1/outfits/${outfit.id}/avatar`, headers: u.auth })).json()).toHaveLength(2);

    // Withdrawing consent deletes the photos and the renders.
    await consent(u.auth, 'avatar', false);
    expect((await t.app.inject({ method: 'GET', url: '/v1/me/avatar', headers: u.auth })).json()).toMatchObject({ face: null, body: null, ready: false });
    expect((await t.app.inject({ method: 'GET', url: `/v1/outfits/${outfit.id}/avatar`, headers: u.auth })).json()).toHaveLength(0);
    expect(await countImages(u.id, ['self_face', 'self_body', 'avatar_render'])).toBe(0);
  });

  it('requires the avatar to be set up, and never renders swimwear', async () => {
    const u = await registerUser(t);
    await consent(u.auth, 'avatar');
    await consent(u.auth, 'ai_image_generation');
    const [g] = await digitise(u.auth, 'single');
    const ids = await avatarReady(u.auth);
    const outfit = (await t.app.inject({ method: 'POST', url: '/v1/outfits', headers: u.auth, payload: { items: [{ slot: 'base', garmentId: g!.id }] } })).json();
    const r = await t.app.inject({ method: 'POST', url: `/v1/outfits/${outfit.id}/avatar`, headers: u.auth });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.message).toMatch(/Tu avatar/);
    await t.app.inject({ method: 'PUT', url: '/v1/me/avatar', headers: u.auth, payload: { ...ids, attestedSelf: true, attestedAdult: true } });
    // The same garment recorded as a bikini is refused.
    await t.app.inject({ method: 'PATCH', url: `/v1/garments/${g!.id}`, headers: u.auth, payload: { category: 'swimwear', subcategory: 'bikini' } });
    const swim = await t.app.inject({ method: 'POST', url: `/v1/outfits/${outfit.id}/avatar`, headers: u.auth });
    expect(swim.statusCode).toBe(400);
    expect(swim.json().error.message).toMatch(/ropa de baño/);
  });
});

describe('persistent avatar and sequential try-on', () => {
  async function setUp() {
    const u = await registerUser(t);
    await consent(u.auth, 'avatar');
    await consent(u.auth, 'ai_image_generation');
    const up = async (kind: string, color: { r: number; g: number; b: number }) => {
      const m = multipart(await testImage(color), { kind });
      return (await t.app.inject({ method: 'POST', url: '/v1/uploads', headers: { ...u.auth, ...m.headers }, payload: m.payload })).json().imageId as string;
    };
    const faceImageId = await up('self_face', { r: 200, g: 170, b: 150 });
    const bodyImageId = await up('self_body', { r: 235, g: 230, b: 225 });
    await t.app.inject({ method: 'PUT', url: '/v1/me/avatar', headers: u.auth, payload: { faceImageId, bodyImageId, attestedSelf: true, attestedAdult: true } });
    return { u, up };
  }
  const job = async (auth: Auth, id: string) => (await t.app.inject({ method: 'GET', url: `/v1/generations/${id}`, headers: auth })).json();
  const render = async (auth: Auth, outfitId: string, payload: object = {}) => {
    const r = await t.app.inject({ method: 'POST', url: `/v1/outfits/${outfitId}/avatar`, headers: auth, payload });
    expect(r.statusCode).toBe(202);
    await t.queue.drain();
    return job(auth, r.json().id);
  };
  async function outfit(auth: Auth, items: Array<[string, string]>) {
    return (await t.app.inject({ method: 'POST', url: '/v1/outfits', headers: auth, payload: { items: items.map(([slot, garmentId]) => ({ slot, garmentId })) } })).json().id as string;
  }
  async function shoes(auth: Auth, color: { r: number; g: number; b: number }) {
    const [g] = await digitise(auth, 'single', color);
    await t.app.inject({ method: 'PATCH', url: `/v1/garments/${g!.id}`, headers: auth, payload: { category: 'footwear', subcategory: 'zapatillas' } });
    return g!.id;
  }

  it('saves avatar images: the real photo on a studio background, and generated views labelled as AI', async () => {
    const { u } = await setUp();
    const frontal = await t.app.inject({ method: 'POST', url: '/v1/me/avatar/bases', headers: u.auth, payload: { view: 'frontal', background: 'blanco' } });
    expect(frontal.statusCode).toBe(201);
    expect(frontal.json()).toMatchObject({ base: { view: 'frontal', background: 'blanco', status: 'ready', generated: false }, job: null });
    expect(frontal.json().base.image.generatedBy).toBeUndefined();
    // Asking again reuses it.
    expect((await t.app.inject({ method: 'POST', url: '/v1/me/avatar/bases', headers: u.auth, payload: { view: 'frontal', background: 'blanco' } })).json().base.id).toBe(frontal.json().base.id);

    imagegenState.output = await testImage({ r: 230, g: 225, b: 220 }, 'png');
    const side = await t.app.inject({ method: 'POST', url: '/v1/me/avatar/bases', headers: u.auth, payload: { view: 'perfil', background: 'blanco' } });
    expect(side.statusCode).toBe(202);
    expect(side.json()).toMatchObject({ base: { view: 'perfil', status: 'generating', generated: true }, job: { kind: 'avatar_view' } });
    await t.queue.drain();
    expect(imagegenState.calls).toContain('avatar-view');
    const profile = (await t.app.inject({ method: 'GET', url: '/v1/me/avatar', headers: u.auth })).json();
    expect(profile.bases).toHaveLength(2);
    expect(profile.bases.find((b: { view: string }) => b.view === 'perfil')).toMatchObject({ status: 'ready', generated: true });

    // A failed view is reported on the base.
    imagegenState.output = null;
    await t.app.inject({ method: 'POST', url: '/v1/me/avatar/bases', headers: u.auth, payload: { view: 'tres_cuartos', background: 'blanco' } });
    await t.queue.drain();
    const failed = (await t.app.inject({ method: 'GET', url: '/v1/me/avatar', headers: u.auth })).json().bases.find((b: { view: string }) => b.view === 'tres_cuartos');
    expect(failed).toMatchObject({ status: 'failed', error: 'fallo simulado' });

    // A new body photo makes them stale: they are deleted.
    const m = multipart(await testImage({ r: 220, g: 215, b: 210 }), { kind: 'self_body' });
    const newBody = (await t.app.inject({ method: 'POST', url: '/v1/uploads', headers: { ...u.auth, ...m.headers }, payload: m.payload })).json().imageId;
    const after = (await t.app.inject({ method: 'PUT', url: '/v1/me/avatar', headers: u.auth, payload: { bodyImageId: newBody, attestedSelf: true, attestedAdult: true } })).json();
    expect(after.bases).toHaveLength(0);
    expect(await countImages(u.id, ['avatar_base'])).toBe(0);
  });

  it('dresses the avatar one garment at a time (bottom, top, then shoes) and reuses the steps it already did', async () => {
    const { u } = await setUp();
    imagegenState.output = await testImage({ r: 1, g: 1, b: 1 }, 'png'); // the generator is up (shoes pass)
    const [top, bottom] = await digitise(u.auth, 'multi', { r: 30, g: 40, b: 70 });
    const [top2] = await digitise(u.auth, 'multi', { r: 120, g: 30, b: 30 });
    const sneakers = await shoes(u.auth, { r: 20, g: 120, b: 60 });
    const look = await outfit(u.auth, [['base', top!.id], ['bottom', bottom!.id], ['footwear', sneakers]]);

    const done = await render(u.auth, look);
    expect(done).toMatchObject({ status: 'done', method: 'sequential', fidelity: { passed: true }, progress: null });
    expect(tryonState.calls).toEqual(['bottoms', 'tops']);
    expect(tryonState.masks).toEqual([true, true]); // each replaces what the photo shows in its region
    expect(imagegenState.calls).toEqual(['tryon-accessories']);
    expect(tryonState.composites).toEqual(['feet']); // the shoes pass is kept only on the feet
    expect(done.result.generatedBy).toMatch(/FASHN VTON v1.5/);
    // Started from the saved frontal base (created on the fly), and the steps are cached.
    expect((await t.app.inject({ method: 'GET', url: '/v1/me/avatar', headers: u.auth })).json().bases).toMatchObject([{ view: 'frontal', background: 'estudio_gris', status: 'ready' }]);
    expect(await countImages(u.id, ['tryon_step'])).toBe(3);

    // Changing only the top re-runs the top and the shoes, never the bottom.
    tryonState.calls = [];
    imagegenState.calls = [];
    const look2 = await outfit(u.auth, [['base', top2!.id], ['bottom', bottom!.id], ['footwear', sneakers]]);
    expect(await render(u.auth, look2)).toMatchObject({ status: 'done', fidelity: { passed: true } });
    expect(tryonState.calls).toEqual(['tops']);
    expect(imagegenState.calls).toEqual(['tryon-accessories']);

    // The same outfit again comes entirely from the cache.
    tryonState.calls = [];
    imagegenState.calls = [];
    expect(await render(u.auth, look2)).toMatchObject({ status: 'done' });
    expect(tryonState.calls).toEqual([]);
    expect(imagegenState.calls).toEqual([]);
  });

  it('rejects a try-on that changed a garment’s colour, and fails clearly when the service is down', async () => {
    const { u } = await setUp();
    const [top, bottom] = await digitise(u.auth, 'multi', { r: 30, g: 40, b: 70 });
    const look = await outfit(u.auth, [['base', top!.id], ['bottom', bottom!.id]]);
    tryonState.recolor = { r: 230, g: 200, b: 20 }; // yellow instead of navy
    const bad = await render(u.auth, look);
    expect(bad).toMatchObject({ status: 'rejected', result: null, fidelity: { passed: false } });
    expect(bad.error).toMatch(/no reproduce bien/);
    expect(await countImages(u.id, ['avatar_render'])).toBe(0);

    tryonState.available = false;
    const r = await t.app.inject({ method: 'POST', url: `/v1/outfits/${look}/avatar`, headers: u.auth, payload: { method: 'sequential' } });
    expect(r.statusCode).toBe(503);
    expect(r.json().error.message).toMatch(/probador virtual/);
  });

  it('purges cached try-on steps after 30 days but keeps the render the user got', async () => {
    const { u } = await setUp();
    const [top, bottom] = await digitise(u.auth, 'multi', { r: 30, g: 40, b: 70 });
    const look = await outfit(u.auth, [['base', top!.id], ['bottom', bottom!.id]]);
    expect((await render(u.auth, look)).status).toBe('done');
    expect(await countImages(u.id, ['tryon_step'])).toBe(2);
    const admin = new pg.Client({ connectionString: t.adminUrl });
    await admin.connect();
    try {
      await admin.query(`update tryon_cache set created_at = now() - interval '31 days' where user_id = $1`, [u.id]);
      expect((await runRetention(admin, t.ctx.storage)).tryon_steps).toBeGreaterThanOrEqual(2);
    } finally {
      await admin.end();
    }
    expect(await countImages(u.id, ['tryon_step'])).toBe(0);
    expect(await countImages(u.id, ['avatar_render', 'avatar_base'])).toBe(2);
    // The next try-on of the same outfit recomputes the steps.
    tryonState.calls = [];
    expect((await render(u.auth, look)).status).toBe('done');
    expect(tryonState.calls).toEqual(['bottoms', 'tops']);
  });

  it('deletes the saved avatar images and cached steps when the avatar consent is withdrawn', async () => {
    const { u } = await setUp();
    const [top, bottom] = await digitise(u.auth, 'multi', { r: 30, g: 40, b: 70 });
    expect((await render(u.auth, await outfit(u.auth, [['base', top!.id], ['bottom', bottom!.id]]))).status).toBe('done');
    expect(await countImages(u.id, ['avatar_base', 'tryon_step', 'avatar_render'])).toBe(4);
    await consent(u.auth, 'avatar', false);
    expect(await countImages(u.id, ['avatar_base', 'tryon_step', 'avatar_render', 'self_body', 'self_face'])).toBe(0);
  });
});
