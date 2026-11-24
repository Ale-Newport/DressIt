/**
 * Catalogue photo pipeline end to end (real API + PostgreSQL with RLS). Only the external services are
 * test doubles (helpers.ts): reverse-image search, packshot generator and the vision service.
 */
import pg from 'pg';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runRetention } from '../../src/modules/maintenance/retention.ts';
import { catalogState, multipart, registerUser, setupApp, startFixtureStore, testImage, type TestApp } from './helpers.ts';

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
beforeEach(() => {
  Object.assign(catalogState, { results: [], searches: [], outputs: [], prompts: [], checks: [], failPresentation: 0, failFidelity: 0, ocr: '', generatorAvailable: true });
});

type Auth = Record<string, string>;
const BLUE = { r: 60, g: 90, b: 140 }; // same colour as the fixture store's product photo
const consent = (auth: Auth, kind: string, granted = true) => t.app.inject({ method: 'PUT', url: `/v1/me/consents/${kind}`, headers: auth, payload: { granted } });
const packshot = (rgb = BLUE) => sharp({ create: { width: 448, height: 560, channels: 3, background: rgb } }).png().toBuffer();

async function importPhoto(auth: Auth, color = BLUE) {
  const up = multipart(await testImage(color), { kind: 'garment_photo' });
  const img = (await t.app.inject({ method: 'POST', url: '/v1/uploads', headers: { ...auth, ...up.headers }, payload: up.payload })).json();
  const job = (await t.app.inject({ method: 'POST', url: '/v1/imports/photos', headers: auth, payload: { imageIds: [img.imageId], mode: 'single', source: 'camera' } })).json();
  await t.queue.drain();
  return (await t.app.inject({ method: 'GET', url: `/v1/imports/${job.id}`, headers: auth })).json() as { id: string; detections: Array<{ id: string; catalogPhoto: { id: string; status: string; official: unknown; generated: unknown; generatedPassed: boolean } | null }> };
}

const getJob = async (auth: Auth, id: string) => (await t.app.inject({ method: 'GET', url: `/v1/catalog-photos/${id}`, headers: auth })).json();

async function asAdmin<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: t.adminUrl });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

describe('catalogue photo: configuration', () => {
  it('reports which providers are configured and the missing credentials (no secrets)', async () => {
    const u = await registerUser(t);
    const s = (await t.app.inject({ method: 'GET', url: '/v1/catalog-photos/status', headers: u.auth })).json();
    expect(s.search).toEqual(
      expect.arrayContaining([
        { id: 'catalog', label: 'Catálogos autorizados', configured: true, missing: [] },
        { id: 'serpapi_lens', label: 'Google Lens (SerpApi)', configured: true, missing: [] },
        { id: 'lykdat', label: 'Lykdat', configured: false, missing: ['LYKDAT_API_KEY'] },
      ]),
    );
    expect(s.generation).toEqual([{ id: 'fal', label: 'fal.ai', model: 'fake-packshot', configured: true, available: true, missing: [] }]);
    expect(s.limits).toMatchObject({ searchesPerDay: 40, generationsPerDay: 20, maxAttempts: 3 });
    expect(JSON.stringify(s)).not.toMatch(/key=|Bearer/);
  });
});

describe('catalogue photo: official store photo first', () => {
  it('finds the very same product online, verifies it and lets the user use it, keeping their photo', async () => {
    const u = await registerUser(t);
    await consent(u.auth, 'visual_search_external');
    await consent(u.auth, 'ai_image_generation');
    catalogState.ocr = 'Marca de Prueba';
    catalogState.results = [
      // The product page (the store's photo has the garment's colour) …
      { provider: 'serpapi_lens', query: 'crop', rank: 1, title: 'Camiseta Marca de Prueba azul', pageUrl: `${store.base}/es/p/gabardina`, imageUrl: `${store.base}/img/producto.jpg`, thumbnailUrl: null, source: 'Tienda', brand: null, price: { cents: 1995, currency: 'EUR' }, exactImage: false },
      // … and a lookalike of another colour, which must not be proposed.
      { provider: 'serpapi_lens', query: 'crop', rank: 2, title: 'Camiseta roja', pageUrl: `${store.base}/es/p/otra`, imageUrl: `${store.base}/img/roja.jpg`, thumbnailUrl: null, source: 'Otra', brand: null, price: null, exactImage: false },
    ];
    const imp = await importPhoto(u.auth);
    const det = imp.detections[0]!;
    expect(det.catalogPhoto).toMatchObject({ status: 'ready', official: { verdict: 'exact' }, generated: null });
    expect(catalogState.searches.sort()).toEqual(['crop', 'full']); // garment crop and whole photo
    const job = await getJob(u.auth, det.catalogPhoto!.id);
    expect(job.official).toMatchObject({ verdict: 'exact', usage: 'link_preview', price: { cents: 1995, currency: 'EUR' } });
    expect(job.official.evidence.join(' ')).toMatch(/marca/i);
    expect(job.recognised.text).toBe('Marca de Prueba');
    expect(job.alternatives).toHaveLength(0);
    expect(job.providers).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'serpapi_lens', status: 'ok' }), expect.objectContaining({ id: 'lykdat', status: 'not_configured' })]));
    expect(catalogState.prompts).toHaveLength(0); // a verified official photo: nothing generated
    // Chosen during the review → applied when the garment is created.
    expect((await t.app.inject({ method: 'POST', url: `/v1/catalog-photos/${job.id}/choose`, headers: u.auth, payload: { choice: 'official' } })).statusCode).toBe(200);
    const accepted = await t.app.inject({ method: 'POST', url: `/v1/imports/${imp.id}/detections/${det.id}/accept`, headers: u.auth, payload: {} });
    expect(accepted.statusCode, accepted.body).toBeLessThan(300);
    const garment = accepted.json();
    const detail = (await t.app.inject({ method: 'GET', url: `/v1/garments/${garment.id}`, headers: u.auth })).json();
    // Shown by reference from the store (never copied), with its source; the user's cutout is kept.
    expect(detail.image).toMatchObject({ license: 'retailer_link_preview', url: `${store.base}/img/producto.jpg`, attribution: expect.stringMatching(/^Foto oficial de/) });
    expect(detail.images.some((i: { isCutout: boolean; license: string }) => i.isCutout && i.license === 'user_owned')).toBe(true);
    expect(detail.brand).toBe('Marca de Prueba');
    expect((await getJob(u.auth, job.id))).toMatchObject({ status: 'confirmed', choice: 'official', garmentId: garment.id });
  });

  it('never picks a merely similar product: without independent evidence it is only an alternative', async () => {
    const u = await registerUser(t);
    await consent(u.auth, 'visual_search_external');
    catalogState.results = [{ provider: 'serpapi_lens', query: 'crop', rank: 1, title: 'Camiseta azul', pageUrl: `${store.base}/es/p/parecida`, imageUrl: `${store.base}/img/producto.jpg`, thumbnailUrl: null, source: 'Tienda', brand: null, price: null, exactImage: false }];
    const imp = await importPhoto(u.auth);
    const job = await getJob(u.auth, imp.detections[0]!.catalogPhoto!.id);
    expect(job.official).toBeNull();
    expect(imp.detections[0]!.catalogPhoto!.official).toBeNull(); // the review queue never offers it as «Oficial»
    expect(job.alternatives).toEqual([expect.objectContaining({ verdict: 'possible', doubts: expect.arrayContaining([expect.stringMatching(/Solo hay parecido visual/)]) })]);
    // Without the AI consent nothing is generated; the alternatives are there to review and the user
    // is told how to get a studio photo.
    expect(job.status).toBe('ready');
    expect(job.message).toMatch(/Imágenes generadas con IA/);
    expect(catalogState.prompts).toHaveLength(0);
  });

  it('sends no photo outside without the visual-search consent, and caches what providers answered', async () => {
    const u = await registerUser(t);
    const imp = await importPhoto(u.auth);
    expect(catalogState.searches).toHaveLength(0);
    const job = await getJob(u.auth, imp.detections[0]!.catalogPhoto!.id);
    expect(job.providers).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'serpapi_lens', status: 'no_consent' })]));
    await consent(u.auth, 'visual_search_external');
    const garment = (await t.app.inject({ method: 'POST', url: `/v1/imports/${imp.id}/detections/${imp.detections[0]!.id}/accept`, headers: u.auth, payload: {} })).json();
    const again = async () => {
      const r = await t.app.inject({ method: 'POST', url: `/v1/garments/${garment.id}/catalog-photo`, headers: u.auth, payload: { mode: 'search' } });
      expect(r.statusCode, r.body).toBe(202);
      await t.queue.drain();
      return getJob(u.auth, r.json().id);
    };
    await again();
    expect(catalogState.searches).toHaveLength(2);
    const second = await again();
    expect(catalogState.searches).toHaveLength(2); // same photo: answered from the cache, not paid twice
    expect(second.providers).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'serpapi_lens', status: 'cached' })]));
    // Withdrawing the consent forgets the cached answers.
    await consent(u.auth, 'visual_search_external', false);
    expect(await asAdmin(async (c) => (await c.query('select count(*)::int as n from visual_search_cache where user_id = $1', [u.id])).rows[0].n)).toBe(0);
  });

  it('respects the daily search limit', async () => {
    const u = await registerUser(t);
    await consent(u.auth, 'visual_search_external');
    await asAdmin((c) => c.query("insert into external_api_usage (user_id, provider, calls, cost_cents) values ($1, 'serpapi_lens', 40, 100)", [u.id]));
    const imp = await importPhoto(u.auth);
    expect(catalogState.searches).toHaveLength(0);
    const job = await getJob(u.auth, imp.detections[0]!.catalogPhoto!.id);
    expect(job.providers).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'serpapi_lens', status: 'limit', message: expect.stringMatching(/límite diario/) })]));
  });
});

describe('catalogue photo: AI packshot when there is no official photo', () => {
  it('re-arranges the garment, retries with corrections until it passes, and the user confirms it', async () => {
    const u = await registerUser(t);
    await consent(u.auth, 'ai_image_generation');
    catalogState.failPresentation = 1; // first attempt: sleeves not symmetric
    catalogState.outputs = [await packshot(), await packshot()];
    const imp = await importPhoto(u.auth);
    const det = imp.detections[0]!;
    expect(det.catalogPhoto).toMatchObject({ status: 'ready', generatedPassed: true });
    const job = await getJob(u.auth, det.catalogPhoto!.id);
    expect(job.attempts).toHaveLength(2);
    expect(job.attempts[0].check).toMatchObject({ passed: false, presentationPassed: false });
    expect(job.attempts[1].check).toMatchObject({ passed: true, similarity: 0.95 });
    // The prompt is the owner's base prompt, specialised for the category, and the retry adds the correction.
    expect(catalogState.prompts[0]).toMatch(/^Transform the uploaded reference photograph into a premium professional e-commerce product photograph of the EXACT SAME garment/);
    expect(catalogState.prompts[0]).toMatch(/both sleeves unfolded and laid out symmetrically/);
    expect(catalogState.prompts[0]).toMatch(/NOT a simple background removal/);
    expect(catalogState.prompts[0]).not.toMatch(/previous attempt/);
    expect(catalogState.prompts[1]).toMatch(/previous attempt was not arranged properly/);
    expect(job.generated).toMatchObject({ generatedBy: 'fake-packshot', isCutout: true });
    const garment = (await t.app.inject({ method: 'POST', url: `/v1/imports/${imp.id}/detections/${det.id}/accept`, headers: u.auth, payload: {} })).json();
    let detail = (await t.app.inject({ method: 'GET', url: `/v1/garments/${garment.id}`, headers: u.auth })).json();
    expect(detail.image.generatedBy).toBeUndefined(); // nothing changes until the user chooses
    expect((await t.app.inject({ method: 'POST', url: `/v1/catalog-photos/${job.id}/choose`, headers: u.auth, payload: { choice: 'generated' } })).json()).toMatchObject({ choice: 'generated', status: 'confirmed' });
    detail = (await t.app.inject({ method: 'GET', url: `/v1/garments/${garment.id}`, headers: u.auth })).json();
    expect(detail.image).toMatchObject({ id: job.generated.id, generatedBy: 'fake-packshot' });
    expect(detail.images.some((i: { isCutout: boolean; generatedBy?: string }) => i.isCutout && !i.generatedBy)).toBe(true); // original kept
    // Cost and usage are recorded per provider.
    const usage = await asAdmin(async (c) => (await c.query("select calls, cost_cents::float as cost from external_api_usage where user_id = $1 and provider = 'fal'", [u.id])).rows[0]);
    expect(usage).toEqual({ calls: 2, cost: 7 });
  });

  it('asks the user when every attempt changes the garment, and only uses it if they accept the warning', async () => {
    const u = await registerUser(t);
    await consent(u.auth, 'ai_image_generation');
    catalogState.failFidelity = 3;
    catalogState.outputs = [await packshot({ r: 200, g: 30, b: 30 }), await packshot({ r: 200, g: 30, b: 30 }), await packshot({ r: 200, g: 30, b: 30 })];
    const imp = await importPhoto(u.auth);
    const det = imp.detections[0]!;
    const job = await getJob(u.auth, det.catalogPhoto!.id);
    expect(job.status).toBe('needs_user');
    expect(job.attempts).toHaveLength(3);
    expect(job.message).toMatch(/Tras 3 intentos.*colores.*hacer otra foto/);
    expect(catalogState.prompts[2]).toMatch(/changed the colours/);
    const garment = (await t.app.inject({ method: 'POST', url: `/v1/imports/${imp.id}/detections/${det.id}/accept`, headers: u.auth, payload: {} })).json();
    const refused = await t.app.inject({ method: 'POST', url: `/v1/catalog-photos/${job.id}/choose`, headers: u.auth, payload: { choice: 'generated' } });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.message).toMatch(/no ha superado/);
    expect((await t.app.inject({ method: 'POST', url: `/v1/catalog-photos/${job.id}/choose`, headers: u.auth, payload: { choice: 'generated', acceptWarnings: true } })).statusCode).toBe(200);
    expect((await t.app.inject({ method: 'GET', url: `/v1/garments/${garment.id}`, headers: u.auth })).json().image.generatedBy).toBe('fake-packshot');
  });

  it('regenerates on request and reports a generator that is down', async () => {
    const u = await registerUser(t);
    await consent(u.auth, 'ai_image_generation');
    catalogState.generatorAvailable = false;
    const imp = await importPhoto(u.auth);
    const job = await getJob(u.auth, imp.detections[0]!.catalogPhoto!.id);
    expect(job).toMatchObject({ status: 'needs_user', message: expect.stringMatching(/No hay ningún generador/) });
    const garment = (await t.app.inject({ method: 'POST', url: `/v1/imports/${imp.id}/detections/${imp.detections[0]!.id}/accept`, headers: u.auth, payload: {} })).json();
    catalogState.generatorAvailable = true;
    catalogState.outputs = [await packshot(), await packshot()];
    const r = await t.app.inject({ method: 'POST', url: `/v1/garments/${garment.id}/catalog-photo`, headers: u.auth, payload: { mode: 'generate' } });
    expect(r.statusCode).toBe(202);
    // A double tap returns the same job and does not queue (nor pay) it twice.
    const twice = await t.app.inject({ method: 'POST', url: `/v1/garments/${garment.id}/catalog-photo`, headers: u.auth, payload: { mode: 'generate' } });
    expect(twice.json().id).toBe(r.json().id);
    await t.queue.drain();
    expect(catalogState.prompts).toHaveLength(1);
    const latest = (await t.app.inject({ method: 'GET', url: `/v1/garments/${garment.id}/catalog-photo`, headers: u.auth })).json();
    expect(latest).toMatchObject({ id: r.json().id, status: 'ready', garmentId: garment.id, generated: { generatedBy: 'fake-packshot' } });
    // Searching again keeps the packshot already made (only that step is redone).
    const s2 = await t.app.inject({ method: 'POST', url: `/v1/garments/${garment.id}/catalog-photo`, headers: u.auth, payload: { mode: 'search' } });
    await t.queue.drain();
    expect(await getJob(u.auth, s2.json().id)).toMatchObject({ status: 'ready', generated: { id: latest.generated.id } });
  });

  it('stops working on a rejected detection and purges what was never used', async () => {
    const u = await registerUser(t);
    const imp = await importPhoto(u.auth);
    const det = imp.detections[0]!;
    expect((await t.app.inject({ method: 'POST', url: `/v1/imports/${imp.id}/detections/${det.id}/reject`, headers: u.auth })).statusCode).toBeLessThan(300);
    expect((await getJob(u.auth, det.catalogPhoto!.id)).status).toBe('dismissed');
    await asAdmin((c) => c.query("update catalog_photo_jobs set finished_at = now() - interval '31 days' where id = $1", [det.catalogPhoto!.id]));
    await asAdmin(async (c) => {
      const report = await runRetention(c, t.ctx.storage);
      expect(report.catalog_photo_jobs).toBeGreaterThanOrEqual(1);
    });
    expect((await t.app.inject({ method: 'GET', url: `/v1/catalog-photos/${det.catalogPhoto!.id}`, headers: u.auth })).statusCode).toBe(404);
  });

  it('keeps every user’s catalogue photos private', async () => {
    const a = await registerUser(t);
    const b = await registerUser(t);
    const imp = await importPhoto(a.auth);
    const id = imp.detections[0]!.catalogPhoto!.id;
    expect((await t.app.inject({ method: 'GET', url: `/v1/catalog-photos/${id}`, headers: b.auth })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'POST', url: `/v1/catalog-photos/${id}/choose`, headers: b.auth, payload: { choice: 'original' } })).statusCode).toBe(404);
  });
});
