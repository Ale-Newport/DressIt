import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { OutfitDto, RecommendationResponse } from '@dressit/shared';
import { readFeed } from '../../src/modules/catalog/providers.ts';
import { withUser } from '../../src/db/index.ts';
import { runRetention } from '../../src/modules/maintenance/retention.ts';
import { upsertFeedProducts } from '../../src/modules/catalog/service.ts';
import { multipart, registerUser, seedWardrobe, setupApp, startFixtureStore, testImage, visionState, weatherState, type TestApp } from './helpers.ts';

let t: TestApp;
let store: Awaited<ReturnType<typeof startFixtureStore>>;

beforeAll(async () => {
  t = await setupApp();
  store = await startFixtureStore();
});
afterAll(async () => {
  await store?.close();
  await t?.close();
});
beforeEach(async () => {
  weatherState.scenario = 'mild';
  visionState.down = false;
  visionState.subcategory = 'camiseta';
  await t.ctx.db.deleteFrom('weather_snapshots').execute();
});

const ids = (o: OutfitDto) => o.items.map((i) => i.garment?.id).filter(Boolean) as string[];
const subs = (o: OutfitDto) => o.items.map((i) => i.garment?.subcategory);

async function recommend(auth: Record<string, string>, body: Record<string, unknown> = {}): Promise<RecommendationResponse> {
  const r = await t.app.inject({ method: 'POST', url: '/v1/outfits/recommendations', headers: auth, payload: { count: 4, seed: 7, ...body } });
  expect(r.statusCode, r.body).toBe(200);
  return r.json();
}

describe('auth', () => {
  it('registers, refreshes with rotation and detects refresh-token reuse', async () => {
    const u = await registerUser(t);
    const r1 = await t.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: u.tokens.refreshToken } });
    expect(r1.statusCode).toBe(200);
    // Reusing the old (rotated) token revokes the whole family.
    const reuse = await t.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: u.tokens.refreshToken } });
    expect(reuse.statusCode).toBe(401);
    const r2 = await t.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: r1.json().refreshToken } });
    expect(r2.statusCode).toBe(401);
  });
  it('rejects bad credentials without revealing whether the account exists', async () => {
    const u = await registerUser(t);
    const bad = await t.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: u.email, password: 'incorrecta-123' } });
    const none = await t.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'nadie@example.test', password: 'incorrecta-123' } });
    expect(bad.statusCode).toBe(401);
    expect(none.statusCode).toBe(401);
    expect(bad.json().error.message).toBe(none.json().error.message);
  });
  it('requires authentication', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/v1/garments' })).statusCode).toBe(401);
    expect((await t.app.inject({ method: 'GET', url: '/v1/garments', headers: { authorization: 'Bearer nope' } })).statusCode).toBe(401);
  });
});

describe('wardrobe', () => {
  it('a garment added appears in the wardrobe with resolved defaults and provenance', async () => {
    const u = await registerUser(t);
    const created = await t.app.inject({ method: 'POST', url: '/v1/garments', headers: u.auth, payload: { name: 'Gabardina', subcategory: 'gabardina', colors: [{ hex: '#c9b48e' }], tags: ['oficina'] } });
    expect(created.statusCode).toBe(201);
    const g = created.json();
    expect(g).toMatchObject({ category: 'outerwear', waterproof: true, primaryColor: 'beige', status: 'available', tags: ['oficina'] });
    expect(g.attributes.find((a: { attribute: string }) => a.attribute === 'subcategory')).toMatchObject({ source: 'user', confidence: 1 });
    const list = await t.app.inject({ method: 'GET', url: '/v1/garments?q=gabardina', headers: u.auth });
    expect(list.json().items.map((x: { id: string }) => x.id)).toContain(g.id);
    const byTag = await t.app.inject({ method: 'GET', url: '/v1/garments?tag=oficina', headers: u.auth });
    expect(byTag.json().items).toHaveLength(1);
  });
  it('tracks status changes, wear and cost per wear', async () => {
    const u = await registerUser(t);
    const g = (await t.app.inject({ method: 'POST', url: '/v1/garments', headers: u.auth, payload: { subcategory: 'jersey', colors: [{ hex: '#8c8c8c' }], purchasePriceCents: 6000 } })).json();
    await t.app.inject({ method: 'POST', url: `/v1/garments/${g.id}/wear`, headers: u.auth, payload: { date: '2026-11-20' } });
    await t.app.inject({ method: 'POST', url: `/v1/garments/${g.id}/wear`, headers: u.auth, payload: { date: '2026-11-22' } });
    const lent = (await t.app.inject({ method: 'POST', url: `/v1/garments/${g.id}/status`, headers: u.auth, payload: { status: 'lent', lentTo: 'Ana' } })).json();
    expect(lent.status).toBe('lent');
    expect(lent.wearCount).toBe(2);
    expect(lent.costPerWear).toEqual({ cents: 3000, currency: 'EUR' });
    expect(lent.availabilityHistory[0].note).toMatch(/Ana/);
    const stats = (await t.app.inject({ method: 'GET', url: '/v1/wardrobe/stats', headers: u.auth })).json();
    expect(stats.totalGarments).toBe(1);
    expect(stats.byStatus).toEqual([{ key: 'lent', count: 1 }]);
  });
  it('bulk edits and flags over-represented categories', async () => {
    const u = await registerUser(t);
    const created: string[] = [];
    for (let i = 0; i < 3; i++) created.push((await t.app.inject({ method: 'POST', url: '/v1/garments', headers: u.auth, payload: { subcategory: 'camiseta', colors: [{ hex: '#141414' }] } })).json().id);
    const bulk = await t.app.inject({ method: 'POST', url: '/v1/garments/bulk', headers: u.auth, payload: { ids: created, patch: { status: 'stored', addTags: ['verano'] } } });
    expect(bulk.json().updated).toBe(3);
    const stats = (await t.app.inject({ method: 'GET', url: '/v1/wardrobe/stats', headers: u.auth })).json();
    expect(stats.overRepresented[0]).toMatchObject({ subcategory: 'camiseta', count: 3 });
    expect(stats.duplicateGroups.length).toBeGreaterThan(0);
  });
});

describe('data isolation between users (RLS)', () => {
  it('never mixes data of different users', async () => {
    const a = await registerUser(t, 'Ana');
    const b = await registerUser(t, 'Bea');
    const ga = (await t.app.inject({ method: 'POST', url: '/v1/garments', headers: a.auth, payload: { subcategory: 'camisa', colors: [{ hex: '#ffffff' }] } })).json();
    expect((await t.app.inject({ method: 'GET', url: `/v1/garments/${ga.id}`, headers: b.auth })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'PATCH', url: `/v1/garments/${ga.id}`, headers: b.auth, payload: { name: 'robada' } })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'DELETE', url: `/v1/garments/${ga.id}`, headers: b.auth })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'GET', url: '/v1/garments', headers: b.auth })).json().items).toHaveLength(0);
    // At the database level: the app role sees nothing without a user context, and only its own rows with one.
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      expect((await client.query('select count(*)::int as n from garments')).rows[0].n).toBe(0);
      await client.query('begin');
      await client.query(`select set_config('app.user_id', $1, true)`, [b.id]);
      expect((await client.query('select count(*)::int as n from garments where id = $1', [ga.id])).rows[0].n).toBe(0);
      await expect(client.query(`insert into garments (user_id, wardrobe_id, name, category, subcategory, formality, warmth_clo, source) select $1, id, 'x', 'top', 'camiseta', 10, 0.1, 'manual' from wardrobes limit 1`, [a.id])).rejects.toThrow(/row-level security/);
      await client.query('rollback');
    } finally {
      await client.end();
    }
  });
  it('rejects tampered signed image URLs', async () => {
    const u = await registerUser(t);
    const up = multipart(await testImage({ r: 200, g: 30, b: 30 }), { kind: 'garment_photo' });
    const img = (await t.app.inject({ method: 'POST', url: '/v1/uploads', headers: { ...u.auth, ...up.headers }, payload: up.payload })).json();
    const g = (await t.app.inject({ method: 'POST', url: '/v1/garments', headers: u.auth, payload: { subcategory: 'camiseta', imageId: img.imageId } })).json();
    const url = new URL(g.image.thumbUrl);
    const ok = await t.app.inject({ method: 'GET', url: url.pathname + url.search });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toBe('image/webp');
    const other = await registerUser(t);
    url.searchParams.set('u', other.id);
    expect((await t.app.inject({ method: 'GET', url: url.pathname + url.search })).statusCode).toBe(401);
  });
});

describe('daily recommendations', () => {
  it('outfits only use garments that are really available', async () => {
    const u = await registerUser(t);
    const w = await seedWardrobe(t, u.auth);
    for (const name of ['Vaquero azul', 'Zapatillas blancas', 'Jersey azul marino']) {
      await t.app.inject({ method: 'POST', url: `/v1/garments/${w[name]}/status`, headers: u.auth, payload: { status: 'laundry' } });
    }
    const unavailable = new Set([w['Vaquero azul'], w['Zapatillas blancas'], w['Jersey azul marino']]);
    for (const occasion of ['universidad', 'trabajo', 'cena']) {
      const rec = await recommend(u.auth, { occasion });
      expect(rec.outfits.length).toBeGreaterThan(0);
      for (const o of rec.outfits) for (const id of ids(o)) expect(unavailable.has(id)).toBe(false);
    }
  });
  it('recommendations change with the weather (whole-day forecast)', async () => {
    const u = await registerUser(t);
    await seedWardrobe(t, u.auth);
    weatherState.scenario = 'cold_rain';
    const cold = await recommend(u.auth, { occasion: 'paseo' });
    await t.ctx.db.deleteFrom('weather_snapshots').execute();
    weatherState.scenario = 'hot';
    const hot = await recommend(u.auth, { occasion: 'paseo' });
    expect(cold.weather!.precipitationProbabilityMax).toBeGreaterThanOrEqual(80);
    for (const o of cold.outfits) {
      expect(o.items.some((i) => i.slot === 'outer')).toBe(true);
      expect(subs(o)).not.toContain('sandalias');
      expect(subs(o)).not.toContain('bermuda');
    }
    for (const o of hot.outfits) expect(subs(o)).not.toContain('abrigo');
    expect(cold.greeting).toMatch(/lluvia/);
    expect(new Set(cold.outfits.map((o) => ids(o).sort().join()))).not.toEqual(new Set(hot.outfits.map((o) => ids(o).sort().join())));
  });
  it('keeps working when the weather provider is down', async () => {
    const u = await registerUser(t);
    await seedWardrobe(t, u.auth);
    weatherState.scenario = 'down';
    const rec = await recommend(u.auth, {});
    expect(rec.weather).toBeNull();
    expect(rec.weatherError).toMatch(/previsión/);
    expect(rec.outfits.length).toBeGreaterThan(0);
  });
  it('adapts to events: an interview is more formal than the gym', async () => {
    const u = await registerUser(t);
    await seedWardrobe(t, u.auth);
    const ev = (await t.app.inject({ method: 'POST', url: '/v1/events', headers: u.auth, payload: { title: 'Entrevista en Acme', startsAt: new Date().toISOString() } })).json();
    expect(ev.occasion).toBe('entrevista');
    const interview = await recommend(u.auth, { eventId: ev.id });
    const casual = await recommend(u.auth, { occasion: 'dia_informal' });
    const avg = (r: RecommendationResponse) => r.outfits.reduce((a, o) => a + o.formality, 0) / r.outfits.length;
    expect(interview.occasion.id).toBe('entrevista');
    expect(avg(interview)).toBeGreaterThan(avg(casual));
  });
  it('swaps a single garment without regenerating the outfit', async () => {
    const u = await registerUser(t);
    await seedWardrobe(t, u.auth);
    const o = (await recommend(u.auth, { occasion: 'trabajo' })).outfits[0]!;
    const alts = (await t.app.inject({ method: 'GET', url: `/v1/outfits/${o.id}/alternatives?slot=bottom`, headers: u.auth })).json();
    expect(alts.alternatives.length).toBeGreaterThan(0);
    const pick = alts.alternatives[0].garment.id;
    const swapped = (await t.app.inject({ method: 'POST', url: `/v1/outfits/${o.id}/swap`, headers: u.auth, payload: { slot: 'bottom', garmentId: pick } })).json();
    expect(swapped.items.find((i: { slot: string }) => i.slot === 'bottom').garment.id).toBe(pick);
    const rest = (x: OutfitDto) => x.items.filter((i) => i.slot !== 'bottom').map((i) => i.garment?.id).sort();
    expect(rest(swapped)).toEqual(rest(o));
    // Unavailable garments cannot be swapped in.
    const g = (await t.app.inject({ method: 'GET', url: '/v1/garments?subcategory=chino', headers: u.auth })).json().items[0];
    await t.app.inject({ method: 'POST', url: `/v1/garments/${g.id}/status`, headers: u.auth, payload: { status: 'laundry' } });
    expect((await t.app.inject({ method: 'POST', url: `/v1/outfits/${o.id}/swap`, headers: u.auth, payload: { slot: 'bottom', garmentId: g.id } })).statusCode).toBe(400);
  });
  it('feedback changes later recommendations and is visible in the style profile', async () => {
    const u = await registerUser(t);
    await seedWardrobe(t, u.auth);
    const first = await recommend(u.auth, { occasion: 'universidad', seed: 11 });
    const top = first.outfits[0]!;
    await t.app.inject({ method: 'POST', url: `/v1/outfits/${top.id}/feedback`, headers: u.auth, payload: { action: 'reject', reasons: ['colores'] } });
    const second = await recommend(u.auth, { occasion: 'universidad', seed: 11 });
    // The rejected combination is never suggested again.
    const sig = ids(top).sort().join();
    expect(second.outfits.map((o) => ids(o).sort().join())).not.toContain(sig);
    const liked = second.outfits[1]!;
    for (let i = 0; i < 3; i++) await t.app.inject({ method: 'POST', url: `/v1/outfits/${liked.id}/feedback`, headers: u.auth, payload: { action: 'rate', rating: 5 } });
    await t.app.inject({ method: 'POST', url: `/v1/outfits/${liked.id}/wear`, headers: u.auth, payload: { date: '2026-11-20' } });
    const profile = (await t.app.inject({ method: 'GET', url: '/v1/me/style-profile', headers: u.auth })).json();
    expect(profile.feedbackCount).toBeGreaterThanOrEqual(5);
    const third = await recommend(u.auth, { occasion: 'universidad', seed: 11 });
    const likedPieces = new Set(ids(liked));
    const overlap = (o: OutfitDto) => ids(o).filter((x) => likedPieces.has(x)).length;
    expect(Math.max(...third.outfits.map(overlap))).toBeGreaterThan(0);
  });
  it('lets users build, save and plan outfits with conflict detection', async () => {
    const u = await registerUser(t);
    const w = await seedWardrobe(t, u.auth);
    const manual = await t.app.inject({ method: 'POST', url: '/v1/outfits', headers: u.auth, payload: { name: 'Mi look', items: [{ slot: 'base', garmentId: w['Camisa celeste'] }, { slot: 'bottom', garmentId: w['Chino beige'] }, { slot: 'footwear', garmentId: w['Mocasines'] }] } });
    expect(manual.statusCode).toBe(201);
    const outfit = manual.json();
    expect(outfit.explanation.length).toBeGreaterThan(0);
    const plan = (await t.app.inject({ method: 'POST', url: '/v1/planner', headers: u.auth, payload: { date: '2026-12-01', outfitId: outfit.id } })).json();
    const moved = (await t.app.inject({ method: 'PATCH', url: `/v1/planner/${plan.id}`, headers: u.auth, payload: { date: '2026-12-02' } })).json();
    expect(moved.date).toBe('2026-12-02');
    await t.app.inject({ method: 'POST', url: `/v1/garments/${w['Chino beige']}/status`, headers: u.auth, payload: { status: 'laundry' } });
    const days = (await t.app.inject({ method: 'GET', url: '/v1/planner?from=2026-12-01&to=2026-12-03', headers: u.auth })).json();
    const d2 = days.find((d: { date: string }) => d.date === '2026-12-02');
    expect(d2.plans).toHaveLength(1);
    expect(d2.conflicts[0]).toMatchObject({ kind: 'unavailable', garmentId: w['Chino beige'] });
  });
});

describe('photo digitisation', () => {
  it('uploads, analyses, reviews and adds garments; flags duplicates', async () => {
    const u = await registerUser(t);
    const photo = await testImage({ r: 30, g: 40, b: 70 });
    const up = multipart(photo, { kind: 'garment_photo' });
    const img = (await t.app.inject({ method: 'POST', url: '/v1/uploads', headers: { ...u.auth, ...up.headers }, payload: up.payload })).json();
    const job = (await t.app.inject({ method: 'POST', url: '/v1/imports/photos', headers: u.auth, payload: { imageIds: [img.imageId], mode: 'single', source: 'camera' } })).json();
    await t.queue.drain();
    const done = (await t.app.inject({ method: 'GET', url: `/v1/imports/${job.id}`, headers: u.auth })).json();
    expect(done.status).toBe('needs_review');
    expect(done.detections).toHaveLength(1);
    const det = done.detections[0];
    expect(det.predicted.subcategory).toMatchObject({ value: 'camiseta' });
    expect(det.cutout?.isCutout).toBe(true);
    const garment = (await t.app.inject({ method: 'POST', url: `/v1/imports/${job.id}/detections/${det.id}/accept`, headers: u.auth, payload: {} })).json();
    expect(garment).toMatchObject({ subcategory: 'camiseta', source: 'camera' });
    expect(garment.image.isCutout).toBe(true);
    expect(garment.attributes.find((a: { attribute: string }) => a.attribute === 'subcategory')).toMatchObject({ source: 'vision', confidence: 0.83 });
    // Same photo again → exact duplicate flagged both at upload and at detection.
    const up2 = multipart(photo, { kind: 'garment_photo' });
    const img2 = (await t.app.inject({ method: 'POST', url: '/v1/uploads', headers: { ...u.auth, ...up2.headers }, payload: up2.payload })).json();
    expect(img2.duplicateOfImageId).toBe(img.imageId);
    const job2 = (await t.app.inject({ method: 'POST', url: '/v1/imports/photos', headers: u.auth, payload: { imageIds: [img2.imageId], mode: 'single', source: 'gallery' } })).json();
    await t.queue.drain();
    const d2 = (await t.app.inject({ method: 'GET', url: `/v1/imports/${job2.id}`, headers: u.auth })).json().detections[0];
    expect(d2.duplicate).toMatchObject({ garmentId: garment.id, kind: 'exact_photo' });
    // accept-all skips duplicates
    expect((await t.app.inject({ method: 'POST', url: `/v1/imports/${job2.id}/accept-all`, headers: u.auth })).json().accepted).toBe(0);
  });
  it('detects several garments in one photo (batch) and requires the type when the model abstains', async () => {
    const u = await registerUser(t);
    const up = multipart(await testImage({ r: 120, g: 120, b: 120 }), { kind: 'garment_photo' });
    const img = (await t.app.inject({ method: 'POST', url: '/v1/uploads', headers: { ...u.auth, ...up.headers }, payload: up.payload })).json();
    const job = (await t.app.inject({ method: 'POST', url: '/v1/imports/photos', headers: u.auth, payload: { imageIds: [img.imageId], mode: 'multi', source: 'batch' } })).json();
    await t.queue.drain();
    const done = (await t.app.inject({ method: 'GET', url: `/v1/imports/${job.id}`, headers: u.auth })).json();
    expect(done.detections.map((d: { predicted: { subcategory: { value: string } } }) => d.predicted.subcategory.value).sort()).toEqual(['camiseta', 'vaquero']);
    expect((await t.app.inject({ method: 'POST', url: `/v1/imports/${job.id}/accept-all`, headers: u.auth })).json().accepted).toBe(2);

    visionState.subcategory = null; // model abstains: no invented attribute
    const up2 = multipart(await testImage({ r: 10, g: 200, b: 10 }), { kind: 'garment_photo' });
    const img2 = (await t.app.inject({ method: 'POST', url: '/v1/uploads', headers: { ...u.auth, ...up2.headers }, payload: up2.payload })).json();
    const job2 = (await t.app.inject({ method: 'POST', url: '/v1/imports/photos', headers: u.auth, payload: { imageIds: [img2.imageId], mode: 'single', source: 'gallery' } })).json();
    await t.queue.drain();
    const det = (await t.app.inject({ method: 'GET', url: `/v1/imports/${job2.id}`, headers: u.auth })).json().detections[0];
    expect(det.predicted.subcategory).toBeUndefined();
    expect(det.warnings.join(' ')).toMatch(/indícalo/);
    expect((await t.app.inject({ method: 'POST', url: `/v1/imports/${job2.id}/detections/${det.id}/accept`, headers: u.auth, payload: {} })).statusCode).toBe(400);
    const ok = await t.app.inject({ method: 'POST', url: `/v1/imports/${job2.id}/detections/${det.id}/accept`, headers: u.auth, payload: { overrides: { subcategory: 'sudadera' } } });
    expect(ok.json().subcategory).toBe('sudadera');
  });
  it('fails gracefully when the vision service is down and can be retried', async () => {
    const u = await registerUser(t);
    visionState.down = true;
    const up = multipart(await testImage({ r: 1, g: 2, b: 3 }), { kind: 'garment_photo' });
    const img = (await t.app.inject({ method: 'POST', url: '/v1/uploads', headers: { ...u.auth, ...up.headers }, payload: up.payload })).json();
    const job = (await t.app.inject({ method: 'POST', url: '/v1/imports/photos', headers: u.auth, payload: { imageIds: [img.imageId], mode: 'single', source: 'camera' } })).json();
    await t.queue.drain();
    const failed = (await t.app.inject({ method: 'GET', url: `/v1/imports/${job.id}`, headers: u.auth })).json();
    expect(failed.status).toBe('failed');
    expect(failed.error).toMatch(/no está disponible/);
    visionState.down = false;
    await t.app.inject({ method: 'POST', url: `/v1/imports/${job.id}/retry`, headers: u.auth });
    await t.queue.drain();
    expect((await t.app.inject({ method: 'GET', url: `/v1/imports/${job.id}`, headers: u.auth })).json().status).toBe('needs_review');
  });
  it('strips EXIF/GPS metadata and rejects non-images', async () => {
    const u = await registerUser(t);
    const bad = multipart(Buffer.from('not an image'), { kind: 'garment_photo' });
    expect((await t.app.inject({ method: 'POST', url: '/v1/uploads', headers: { ...u.auth, ...bad.headers }, payload: bad.payload })).statusCode).toBe(400);
    const sharp = (await import('sharp')).default;
    const withExif = await sharp(await testImage({ r: 9, g: 9, b: 9 })).withMetadata({ exif: { IFD0: { Make: 'TestPhone' } } }).jpeg().toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();
    const up = multipart(withExif, { kind: 'garment_photo' });
    const img = (await t.app.inject({ method: 'POST', url: '/v1/uploads', headers: { ...u.auth, ...up.headers }, payload: up.payload })).json();
    const row = await withUser(t.ctx.db, u.id, (trx) => trx.selectFrom('garment_images').select('storage_key').where('id', '=', img.imageId).executeTakeFirstOrThrow());
    const stored = readFileSync(resolve(t.storageDir, row.storage_key));
    expect((await sharp(stored).metadata()).exif).toBeUndefined();
  });
});

describe('store link import', () => {
  it('imports a product page with verified provenance and adds it only after confirmation', async () => {
    const u = await registerUser(t);
    const r = (await t.app.inject({ method: 'POST', url: '/v1/imports/link', headers: u.auth, payload: { url: `${store.base}/es/p/gabardina-123` } })).json();
    expect(r.fetchStatus).toBe('resolved');
    expect(r.title).toEqual({ value: 'Gabardina larga beige', verified: true, source: 'json_ld' });
    expect(r.price).toEqual({ value: { cents: 8995, currency: 'EUR' }, verified: true, source: 'json_ld' });
    expect(r.subcategory).toMatchObject({ value: 'gabardina', verified: false, source: 'inferred' });
    expect(r.colorFamily).toMatchObject({ value: 'beige', verified: false });
    expect(r.sizes.value).toEqual(['M', 'L']);
    expect(r.variants.find((v: { size: string }) => v.size === 'L').available).toBe(false);
    expect(r.images).toEqual([]); // unknown store → no image licence
    expect(r.verifiedAt).not.toBeNull();
    // Nothing in the wardrobe yet.
    expect((await t.app.inject({ method: 'GET', url: '/v1/garments', headers: u.auth })).json().items).toHaveLength(0);
    const wish = await t.app.inject({ method: 'POST', url: `/v1/imports/link/${r.id}/to-wishlist`, headers: u.auth });
    expect(wish.json().product).toMatchObject({ kind: 'imported', title: 'Gabardina larga beige' });
    const g = (await t.app.inject({ method: 'POST', url: `/v1/imports/link/${r.id}/to-wardrobe`, headers: u.auth, payload: { size: 'M', purchaseDate: '2026-11-23' } })).json();
    expect(g).toMatchObject({ subcategory: 'gabardina', source: 'link', size: 'M', purchasePrice: { cents: 8995, currency: 'EUR' }, sourceUrl: `${store.base}/es/p/gabardina-123` });
  });
  it('reports blocked, unavailable, robots-disallowed and non-product pages honestly', async () => {
    const u = await registerUser(t);
    const imp = async (path: string) => (await t.app.inject({ method: 'POST', url: '/v1/imports/link', headers: u.auth, payload: { url: `${store.base}${path}` } })).json();
    const blocked = await imp('/bloqueada');
    expect(blocked.fetchStatus).toBe('blocked');
    expect(blocked.fetchMessage).toMatch(/navegador de la app/);
    expect(blocked.price).toBeNull();
    expect((await imp('/caida')).fetchStatus).toBe('blocked');
    expect((await imp('/privado/x')).fetchMessage).toMatch(/robots\.txt/);
    expect((await imp('/no-producto')).fetchStatus).toBe('not_product');
  });
  it('rejects SSRF attempts outright', async () => {
    const u = await registerUser(t);
    for (const url of ['file:///etc/passwd', 'http://user:x@example.com/', 'gopher://x']) {
      expect((await t.app.inject({ method: 'POST', url: '/v1/imports/link', headers: u.auth, payload: { url } })).statusCode).toBe(400);
    }
  });
  it('accepts on-device page captures (JSON-LD and microdata)', async () => {
    const u = await registerUser(t);
    const r = (
      await t.app.inject({
        method: 'POST',
        url: '/v1/imports/link/capture',
        headers: u.auth,
        payload: { url: 'https://shop.mango.com/es/es/p/mujer/abrigos/abrigo-x/123', jsonLd: [], meta: { 'og:title': 'Abrigo lana' }, microdata: { name: 'Abrigo lana cruzado', price: '119.99', priceCurrency: 'EUR', availability: 'https://schema.org/InStock' }, title: 'Abrigo', capturedAt: new Date().toISOString() },
      })
    ).json();
    expect(r.retailer.id).toBe('mango');
    expect(r.title).toMatchObject({ value: 'Abrigo lana cruzado', source: 'page_capture', verified: true });
    expect(r.price.value.cents).toBe(11999);
    expect(r.subcategory.value).toBe('abrigo');
  });
});

describe('catalog and personal shopper', () => {
  async function ingestFixture() {
    await t.ctx.db.insertInto('retailers').values({ id: 'tienda_prueba', name: 'Tienda de prueba (fixture)', domains: ['example.test'], website_url: 'https://shop.example.test' }).onConflict((oc) => oc.doNothing()).execute();
    const products = await readFeed(resolve(import.meta.dirname, '../fixtures/awin-feed-fixture.csv'));
    return upsertFeedProducts(t.ctx.db, 'tienda_prueba', null, 'awin', products);
  }
  it('explains honestly when no authorised catalog is connected', async () => {
    await t.ctx.db.deleteFrom('catalog_products').execute();
    const u = await registerUser(t);
    await seedWardrobe(t, u.auth);
    const s = (await t.app.inject({ method: 'GET', url: '/v1/shopping/sections?sections=para_ti', headers: u.auth })).json();
    expect(s[0].items).toEqual([]);
    expect(s[0].emptyReason).toMatch(/catálogos comerciales autorizados/);
  });
  it('ingests an authorised feed and ranks products by wardrobe fit, never pushing duplicates', async () => {
    const res = await ingestFixture();
    expect(res.upserted).toBeGreaterThanOrEqual(5);
    const u = await registerUser(t);
    await seedWardrobe(t, u.auth);
    const search = (await t.app.inject({ method: 'GET', url: '/v1/catalog/search?q=chubasquero', headers: u.auth })).json();
    expect(search.items[0]).toMatchObject({ kind: 'catalog', isAffiliate: true, isStale: false, verifiedAt: expect.any(String) });
    const sections = (await t.app.inject({ method: 'GET', url: '/v1/shopping/sections?sections=para_ti', headers: u.auth })).json();
    const items = sections[0].items as Array<{ product: { title: string }; redundancy: number; score: number; newOutfits: number }>;
    expect(items.length).toBeGreaterThan(0);
    const dup = items.find((i) => i.product.title.includes('Vaquero azul básico'));
    const novel = items.find((i) => i.product.title.includes('Gabardina'));
    if (dup && novel) expect(novel.score).toBeGreaterThan(dup.score);
    for (const i of items) if (i.redundancy >= 0.85) expect(i.newOutfits).toBeGreaterThanOrEqual(2);
  });
  it('flags stale prices instead of presenting them as current', async () => {
    await ingestFixture();
    await t.ctx.db.updateTable('catalog_products').set({ last_verified_at: new Date(Date.now() - 72 * 3600_000) }).where('retailer_id', '=', 'tienda_prueba').execute();
    const u = await registerUser(t);
    const items = (await t.app.inject({ method: 'GET', url: '/v1/catalog/search', headers: u.auth })).json().items;
    expect(items.every((p: { isStale: boolean }) => p.isStale)).toBe(true);
  });
  it('simulates a product with the real wardrobe and opens the authentic product link', async () => {
    await ingestFixture();
    const u = await registerUser(t);
    await seedWardrobe(t, u.auth);
    const p = (await t.app.inject({ method: 'GET', url: '/v1/catalog/search?q=gabardina', headers: u.auth })).json().items[0];
    const sim = (await t.app.inject({ method: 'POST', url: '/v1/shopping/simulate', headers: u.auth, payload: { product: { kind: 'catalog', id: p.id } } })).json();
    expect(sim.withProduct.newOutfits).toBeGreaterThan(0);
    for (const o of sim.outfits) expect(o.items.some((i: { candidateProduct: { id: string } | null }) => i.candidateProduct?.id === p.id)).toBe(true);
    expect(sim.utility.explanation).toMatch(/podrías crear/);
    // Not added to the wardrobe by simulating.
    expect((await t.app.inject({ method: 'GET', url: '/v1/garments?subcategory=gabardina', headers: u.auth })).json().items).toHaveLength(0);
    const out = (await t.app.inject({ method: 'POST', url: '/v1/shopping/outbound', headers: u.auth, payload: { product: { kind: 'catalog', id: p.id } } })).json();
    expect(out.url).toMatch(/^https:\/\/www\.awin1\.com\//);
    expect(out.isAffiliate).toBe(true);
    expect(out.disclosure).toMatch(/No influye en el orden/);
  });
  it('visual search returns "similar" (never "exact") results from authorised catalogs', async () => {
    const r = await ingestFixture();
    // Embed products with the (fake) vision service like the ingestion script does.
    for (const p of r.needEmbedding) {
      const e = await t.ctx.vision.embedImage(Buffer.from(p.imageUrl), 'image/jpeg');
      await t.ctx.db.insertInto('product_embeddings').values({ product_id: p.id, model: e.model, image_url: p.imageUrl, embedding: `[${e.embedding.join(',')}]` }).onConflict((oc) => oc.doNothing()).execute();
    }
    const u = await registerUser(t);
    const up = multipart(await testImage({ r: 200, g: 200, b: 200 }), { kind: 'visual_search' });
    const img = (await t.app.inject({ method: 'POST', url: '/v1/uploads', headers: { ...u.auth, ...up.headers }, payload: up.payload })).json();
    const res = (await t.app.inject({ method: 'POST', url: '/v1/shopping/visual-search', headers: u.auth, payload: { imageId: img.imageId } })).json();
    expect(res.searchedProducts).toBeGreaterThan(0);
    for (const x of res.results) expect(x.match).toBe('similar');
  });
});

describe('assistant, trips and privacy', () => {
  it('answers outfit, shopping and trip requests using real functions', async () => {
    const u = await registerUser(t);
    await seedWardrobe(t, u.auth);
    const ask = async (text: string) => (await t.app.inject({ method: 'POST', url: '/v1/assistant/messages', headers: u.auth, payload: { text } })).json();
    const a1 = await ask('¿Qué me pongo mañana para ir a trabajar?');
    expect(a1.toolCalls[0].name).toBe('recommend_outfits');
    expect(a1.toolCalls[0].args.occasion).toBe('trabajo');
    expect(a1.cards[0].type).toBe('outfits');
    const a2 = await ask('Quiero algo elegante con mis pantalones negros');
    expect(a2.cards[0].outfits.every((o: OutfitDto) => o.items.some((i) => i.garment?.name === 'Pantalón negro'))).toBe(true);
    const a3 = await ask('Tengo una cena formal, pero no quiero llevar zapatos');
    expect(a3.toolCalls[0].args.excludeSubcategories).toContain('zapatos');
    const a4 = await ask('Necesito ropa para un viaje de cuatro días a Madrid');
    expect(a4.cards[0].type).toBe('trip');
    expect(a4.cards[0].trip.days).toHaveLength(4);
    expect(a4.cards[0].trip.capsule.length).toBeLessThanOrEqual(a4.cards[0].trip.maxItems);
    const a5 = await ask('¿Qué debería comprar para tener más conjuntos de invierno?');
    expect(['gaps', undefined]).toContain(a5.cards[0]?.type);
  });
  it('exports all personal data and deletes the account permanently', async () => {
    const u = await registerUser(t);
    await seedWardrobe(t, u.auth);
    const exp = await t.app.inject({ method: 'GET', url: '/v1/me/export', headers: u.auth });
    expect(exp.statusCode).toBe(200);
    expect(exp.json().garments).toHaveLength(13);
    expect((await t.app.inject({ method: 'DELETE', url: '/v1/me', headers: u.auth, payload: { password: 'mala' } })).statusCode).toBe(401);
    expect((await t.app.inject({ method: 'DELETE', url: '/v1/me', headers: u.auth, payload: { password: 'contraseña-segura-1' } })).statusCode).toBe(204);
    const admin = new pg.Client({ connectionString: t.adminUrl });
    await admin.connect();
    try {
      expect((await admin.query('select count(*)::int as n from garments where user_id = $1', [u.id])).rows[0].n).toBe(0);
      expect((await admin.query('select count(*)::int as n from users where id = $1', [u.id])).rows[0].n).toBe(0);
    } finally {
      await admin.end();
    }
    expect((await t.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: u.email, password: 'contraseña-segura-1' } })).statusCode).toBe(401);
  });
  it('reports undecided consents without inventing a date, and deletes via the POST alias', async () => {
    const u = await registerUser(t);
    const consents = (await t.app.inject({ method: 'GET', url: '/v1/me/consents', headers: u.auth })).json() as Array<{ kind: string; granted: boolean; updatedAt: string | null }>;
    expect(consents.find((c) => c.kind === 'terms')).toMatchObject({ granted: true, updatedAt: expect.any(String) });
    expect(consents.find((c) => c.kind === 'calendar')).toMatchObject({ granted: false, updatedAt: null });
    expect((await t.app.inject({ method: 'POST', url: '/v1/me/delete', headers: u.auth, payload: { password: 'contraseña-segura-1' } })).statusCode).toBe(204);
    expect((await t.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: u.email, password: 'contraseña-segura-1' } })).statusCode).toBe(401);
  });
  it('exposes an honest retailer integration matrix', async () => {
    const u = await registerUser(t);
    const m = (await t.app.inject({ method: 'GET', url: '/v1/retailers', headers: u.auth })).json();
    const zara = m.find((r: { retailer: { id: string } }) => r.retailer.id === 'zara');
    expect(zara.status).toBe('link_only');
    expect(zara.capabilities.catalogSearch).toBe(false);
    expect(zara.requires).toMatch(/Inditex/);
  });
});

describe('data retention', () => {
  it('purges expired personal data but keeps saved and planned outfits', async () => {
    const u = await registerUser(t);
    await seedWardrobe(t, u.auth);
    const rec = await recommend(u.auth, {});
    const [stale, saved, planned] = rec.outfits;
    await t.app.inject({ method: 'POST', url: `/v1/outfits/${saved!.id}/feedback`, headers: u.auth, payload: { action: 'save' } });
    await t.app.inject({ method: 'POST', url: '/v1/planner', headers: u.auth, payload: { date: '2026-12-05', outfitId: planned!.id } });
    await t.app.inject({ method: 'POST', url: '/v1/assistant/messages', headers: u.auth, payload: { text: 'hola' } });
    const admin = new pg.Client({ connectionString: t.adminUrl });
    await admin.connect();
    try {
      // Age the rows as the table owner (in the user's RLS context; the updated_at trigger is paused).
      await admin.query(`alter table outfits disable trigger outfits_updated`);
      await admin.query(`select set_config('app.user_id', $1, false)`, [u.id]);
      await admin.query(`update outfits set updated_at = now() - interval '40 days' where user_id = $1`, [u.id]);
      await admin.query(`update assistant_messages set created_at = now() - interval '40 days' where user_id = $1`, [u.id]);
      await admin.query(`alter table outfits enable trigger outfits_updated`);
      await admin.query(`select set_config('app.user_id', '', false)`);
      const report = await runRetention(admin, t.ctx.storage);
      expect(report.assistant_messages).toBeGreaterThanOrEqual(2);
      expect(report.outfits_unsaved).toBeGreaterThanOrEqual(1);
    } finally {
      await admin.end();
    }
    expect((await t.app.inject({ method: 'GET', url: `/v1/outfits/${stale!.id}`, headers: u.auth })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'GET', url: `/v1/outfits/${saved!.id}`, headers: u.auth })).statusCode).toBe(200);
    expect((await t.app.inject({ method: 'GET', url: `/v1/outfits/${planned!.id}`, headers: u.auth })).statusCode).toBe(200);
  });
});
