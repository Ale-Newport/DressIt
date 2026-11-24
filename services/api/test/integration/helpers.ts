/**
 * Integration-test harness: the real app + real PostgreSQL (dressit_test, RLS enforced)
 * with test doubles ONLY for external dependencies (weather provider, vision service,
 * a local fixture "store"). Test doubles live here, never in src/.
 */
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import sharp from 'sharp';
import pg from 'pg';
import { buildApp } from '../../src/app.ts';
import { loadConfig } from '../../src/config.ts';
import { createDb } from '../../src/db/index.ts';
import { migrate } from '../../src/db/migrate.ts';
import { InlineJobQueue } from '../../src/jobs/queue.ts';
import { unavailable } from '../../src/lib/errors.ts';
import type { VisionAnalysis, VisionClient } from '../../src/modules/vision/client.ts';
import { WeatherService } from '../../src/modules/weather/service.ts';
import { ComfyError, type ImageGenerator } from '../../src/modules/imagegen/generator.ts';
import type { ParsedRegions, TryonService } from '../../src/modules/imagegen/tryon.ts';
import type { CatalogPhotoProviders } from '../../src/modules/catalog-photo/service.ts';
import { GenerationError, type PackshotGenerator } from '../../src/modules/catalog-photo/generate.ts';
import type { SearchProvider, WebCandidate } from '../../src/modules/catalog-photo/search.ts';

export type WeatherScenario = 'cold_rain' | 'hot' | 'mild' | 'down';

export const weatherState: { scenario: WeatherScenario; calls: number } = { scenario: 'mild', calls: 0 };

function forecast(scenario: WeatherScenario) {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const time: string[] = [];
  for (let d = 0; d < 16; d++) for (let h = 0; h < 24; h++) time.push(new Date(start.getTime() + (d * 24 + h) * 3600_000).toISOString().slice(0, 16));
  const t = (h: number) => (scenario === 'cold_rain' ? 3 + Math.max(0, Math.min(h - 8, 5)) : scenario === 'hot' ? 25 + Math.max(0, Math.min(h - 8, 9)) : 12 + Math.max(0, Math.min(h - 8, 7)));
  const hours = time.map((x) => Number(x.slice(11, 13)));
  return {
    timezone: 'UTC',
    hourly: {
      time,
      temperature_2m: hours.map(t),
      apparent_temperature: hours.map((h) => t(h) - (scenario === 'cold_rain' ? 3 : 0)),
      precipitation_probability: hours.map((h) => (scenario === 'cold_rain' && h >= 9 ? 85 : 5)),
      precipitation: hours.map((h) => (scenario === 'cold_rain' && h >= 9 ? 2 : 0)),
      wind_speed_10m: hours.map(() => 10),
      relative_humidity_2m: hours.map(() => (scenario === 'hot' ? 70 : 60)),
      uv_index: hours.map(() => (scenario === 'hot' ? 8 : 2)),
      weather_code: hours.map((h) => (scenario === 'cold_rain' && h >= 9 ? 63 : 1)),
    },
  };
}

export async function fakeWeatherFetch(url: string): Promise<Response> {
  weatherState.calls++;
  if (weatherState.scenario === 'down') throw new Error('network down');
  if (url.includes('geocoding-api')) {
    return new Response(JSON.stringify({ results: [{ name: 'Madrid', admin1: 'Comunidad de Madrid', country: 'España', country_code: 'ES', latitude: 40.4168, longitude: -3.7038 }] }), { status: 200 });
  }
  return new Response(JSON.stringify(forecast(weatherState.scenario)), { status: 200 });
}

export const visionState: { down: boolean; calls: number; subcategory: string | null } = { down: false, calls: 0, subcategory: 'camiseta' };

/** Deterministic stand-in for services/vision (same JSON contract). */
/** The fake vision service's embedding: deterministic per image bytes. */
export function fakeEmbed(buf: Buffer): number[] {
  const h = createHash('sha256').update(buf).digest();
  const v = Array.from({ length: 768 }, (_, i) => (h[i % 32]! - 128) / 128);
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
}

/** Fake image generator: returns `output` (or fails) and records what it was asked. */
export const imagegenState: { output: Buffer | null; available: boolean; calls: string[]; lastAvatarBoard: Buffer | null } = {
  output: null,
  available: true,
  calls: [],
  lastAvatarBoard: null,
};

/** Mean colour of the non-white pixels of an image (the garments on a white board). */
async function inkColor(img: Buffer): Promise<{ r: number; g: number; b: number }> {
  const { data, info } = await sharp(img).flatten({ background: '#ffffff' }).raw().toBuffer({ resolveWithObject: true });
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i]! > 240 && data[i + 1]! > 240 && data[i + 2]! > 240) continue;
    r += data[i]!;
    g += data[i + 1]!;
    b += data[i + 2]!;
    n++;
  }
  return n ? { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) } : { r: 255, g: 255, b: 255 };
}

/** Paints a horizontal band (fractions of the height) of an image with a colour. */
async function paintBand(img: Buffer, from: number, to: number, color: { r: number; g: number; b: number }): Promise<Buffer> {
  const { width = 300, height = 400 } = await sharp(img).metadata();
  const band = await sharp({ create: { width: Math.round(width * 0.5), height: Math.max(1, Math.round(height * (to - from))), channels: 4, background: { ...color, alpha: 1 } } }).png().toBuffer();
  return sharp(img).composite([{ input: band, left: Math.round(width * 0.25), top: Math.round(height * from) }]).png().toBuffer();
}

const BANDS = { upper: [0.15, 0.5], lower: [0.5, 0.88], shoes: [0.9, 0.98], face: [0.02, 0.12], feet: [0.9, 0.98] } as const;

/**
 * Fake services/tryon: "dresses" a garment by painting its colour where it is worn (tops on the
 * chest band, bottoms on the legs) and parses by reading those bands back — enough to exercise the
 * sequential pipeline, its cache and the colour gate.
 */
export const tryonState: { available: boolean; calls: string[]; masks: boolean[]; composites: string[]; noFeet: boolean; recolor: { r: number; g: number; b: number } | null } = { available: true, calls: [], masks: [], composites: [], noFeet: false, recolor: null };

export function fakeTryon(): TryonService {
  return {
    async health() {
      return tryonState.available;
    },
    async tryon(person, garment, category, opts) {
      tryonState.calls.push(category);
      tryonState.masks.push(!!opts.mask);
      if (!tryonState.available) throw new ComfyError('El probador virtual no responde.', true);
      const color = tryonState.recolor ?? (await inkColor(garment));
      const [from, to] = category === 'bottoms' ? BANDS.lower : category === 'one-pieces' ? [BANDS.upper[0], BANDS.lower[1]] : BANDS.upper;
      return paintBand(person, from, to, color);
    },
    async composite(_base, edited, regions) {
      tryonState.composites.push(regions.join(','));
      return edited;
    },
    async parse(image) {
      const { width = 300, height = 400 } = await sharp(image).metadata();
      const out = {} as ParsedRegions;
      for (const [k, [from, to]] of Object.entries(BANDS) as Array<[keyof ParsedRegions, readonly [number, number]]>) {
        const crop = await sharp(image)
          .extract({ left: Math.round(width * 0.3), top: Math.round(height * from), width: Math.round(width * 0.4), height: Math.max(1, Math.round(height * (to - from)) - 2) })
          .ensureAlpha()
          .png()
          .toBuffer();
        out[k] = { area: k === 'feet' && tryonState.noFeet ? 0 : 0.1, png_base64: crop.toString('base64') };
      }
      return out;
    },
  };
}

export function fakeImageGenerator(): ImageGenerator {
  return {
    async info() {
      const on = imagegenState.available;
      return { available: on, studio: on, avatar: on, reason: on ? null : 'El generador de imágenes no está configurado en este servidor.', models: { studio: on ? 'fake-studio' : null, avatar: on ? 'fake-avatar' : null } };
    },
    async avatar(input) {
      imagegenState.calls.push('avatar');
      imagegenState.lastAvatarBoard = input.outfitBoard;
      if (!imagegenState.output) throw new ComfyError('fallo simulado', false);
      return imagegenState.output;
    },
    hasWorkflow() {
      return imagegenState.available;
    },
    workflowModel(name) {
      return imagegenState.available ? `fake-${name}` : null;
    },
    async run(name) {
      imagegenState.calls.push(name);
      if (!imagegenState.output) throw new ComfyError('fallo simulado', false);
      return imagegenState.output;
    },
    async runWorkflow(name, images) {
      imagegenState.calls.push(name);
      if (!imagegenState.output) throw new ComfyError('fallo simulado', false);
      // Shoes/accessories pass: keeps the person and paints the board's colour on the feet.
      if (name === 'tryon-accessories') return paintBand(images.BODY_IMAGE!, ...BANDS.shoes, await inkColor(images.OUTFIT_IMAGE!));
      return imagegenState.output;
    },
  };
}

export function fakeVision(): VisionClient {
  const embed = fakeEmbed;
  // The cut-out garment keeps the photo's (mean) colour, like the real service.
  const cutout = (rgb: { r: number; g: number; b: number }) => sharp({ create: { width: 256, height: 320, channels: 4, background: { ...rgb, alpha: 1 } } }).png().toBuffer();
  return {
    async analyze(image: Buffer, _mime: string, mode: 'single' | 'multi'): Promise<VisionAnalysis> {
      visionState.calls++;
      if (visionState.down) throw unavailable('El servicio de análisis de imágenes no está disponible.');
      const stats = await sharp(image).stats();
      const [r, g, b] = stats.channels.map((c) => Math.round(c.mean));
      const hex = `#${[r, g, b].map((x) => x!.toString(16).padStart(2, '0')).join('')}`;
      const item = (sub: string | null, cat: string | null) => ({
        bbox: [0.1, 0.1, 0.9, 0.9] as [number, number, number, number],
        cutout_png_base64: null as string | null,
        category: cat ? { value: cat, confidence: 0.91 } : null,
        subcategory: sub ? { value: sub, confidence: 0.83, alternatives: [{ value: 'camiseta_manga_larga', confidence: 0.1 }] } : null,
        colors: [{ hex, family: 'azul_marino', share: 1 }],
        pattern: { value: 'liso', confidence: 0.9 },
        materials: null,
        styles: { value: ['casual'], confidence: 0.6 },
        seasons: null,
        fit: null,
        embedding: embed(image),
        embedding_model: 'fake-vision-test-double',
      });
      const items = mode === 'multi' ? [item('camiseta', 'top'), item('vaquero', 'bottom')] : [item(visionState.subcategory, visionState.subcategory ? 'top' : null)];
      for (const it of items) it.cutout_png_base64 = (await cutout({ r: r!, g: g!, b: b! })).toString('base64');
      return { image: { width: 100, height: 100, sha256: 'x', phash: null }, items };
    },
    async segmentPoints(image: Buffer, _mime: string, points: Array<[number, number, 0 | 1]>) {
      visionState.calls++;
      if (visionState.down) throw unavailable('El servicio de análisis de imágenes no está disponible.');
      if (!points.some((p) => p[2] === 1)) throw unavailable('Marca al menos un punto sobre la prenda.');
      const stats = await sharp(image).stats();
      const [r, g, b] = stats.channels.map((c) => Math.round(c.mean));
      const png = await sharp({ create: { width: 50, height: 60, channels: 4, background: { r: r!, g: g!, b: b!, alpha: 1 } } }).png().toBuffer();
      return { cutout_png_base64: png.toString('base64'), bbox: [0.2, 0.2, 0.8, 0.8] as [number, number, number, number], mask_area_ratio: 0.36, colors: [] };
    },
    /** Same as the real comparator's contract: passes when the two cutouts have (nearly) the same mean colour. */
    async compare(reference: Buffer, candidate: Buffer) {
      const mean = async (b: Buffer) => (await sharp(b).stats()).channels.slice(0, 3).map((c) => c.mean);
      const [a, b] = await Promise.all([mean(reference), mean(candidate)]);
      const diff = Math.max(...a.map((x, i) => Math.abs(x - b[i]!)));
      const passed = diff < 12;
      return { shape_iou: 1, mean_delta_e: diff / 2, p90_delta_e: diff / 2, max_cell_delta_e: diff, ssim: passed ? 0.9 : 0.2, cells: 64, passed, reasons: passed ? [] : ['Ha cambiado el color de la prenda.'] };
    },
    /**
     * Catalogue check with the real contract: same garment when the mean colours are close;
     * a generated packshot fails presentation while `catalogState.failPresentation` > 0 and
     * fidelity while `catalogState.failFidelity` > 0.
     */
    async catalogCheck(reference: Buffer, candidate: Buffer, opts: { kind: 'generated' | 'official'; category?: string | null }) {
      catalogState.checks.push(opts.kind);
      const mean = async (b: Buffer) => (await sharp(b).flatten({ background: '#ffffff' }).stats()).channels.slice(0, 3).map((c) => c.mean);
      const [a, b] = await Promise.all([mean(reference), mean(candidate)]);
      const diff = Math.max(...a.map((x, i) => Math.abs(x - b[i]!)));
      const forcedFid = opts.kind === 'generated' && catalogState.failFidelity > 0 ? (catalogState.failFidelity--, true) : false;
      const fidOk = diff < 30 && !forcedFid;
      const presOk = !(opts.kind === 'generated' && catalogState.failPresentation > 0 && catalogState.failPresentation--);
      return {
        presentation: {
          background_l: 99, background_l_std: 0.2, background_chroma: 0.3, margin: 0.05, extent: 0.9,
          symmetry: presOk ? 0.96 : 0.71, tilt: 0.5, components: 1, neat: presOk ? 0.8 : 0.2, worn: 0.05,
          passed: presOk, reasons: presOk ? [] : ['La prenda no está bien colocada: mangas, perneras o laterales no quedan simétricos.'], codes: presOk ? [] : ['asymmetric'],
        },
        fidelity: {
          similarity: fidOk ? 0.95 : 0.4, category: opts.category ?? 'top', subcategory: null, same_category: true, pattern: 'liso', reference_pattern: 'liso',
          palette_emd: fidOk ? 2 : 25, lightness_shift: 0, missing_colors: [], extra_colors: [], texture_chi2: 0.01,
          reference_text: null, candidate_text: null, text_match: null,
          passed: fidOk, reasons: fidOk ? [] : ['Ha cambiado los colores de la prenda.'], codes: fidOk ? [] : ['color'],
        },
        bbox: [0.05, 0.05, 0.95, 0.95],
        cutout_png_base64: (await sharp(candidate).png().toBuffer()).toString('base64'),
      };
    },
    /** The person cut out: the whole photo, opaque (coverage 1). */
    async matte(image: Buffer) {
      const png = await sharp(image).ensureAlpha().png().toBuffer();
      const { width = 0, height = 0 } = await sharp(image).metadata();
      return { png_base64: png.toString('base64'), width, height, coverage: 1 };
    },
    async embedImage(image: Buffer) {
      if (visionState.down) throw unavailable('El servicio de análisis de imágenes no está disponible.');
      return { embedding: embed(image), model: 'fake', dim: 768 };
    },
    async embedText() {
      return { embeddings: [], model: 'fake', dim: 768 };
    },
    async ocr() {
      return { text: catalogState.ocr, lines: catalogState.ocr ? [{ text: catalogState.ocr, confidence: 0.9 }] : [] };
    },
    async health() {
      return { status: 'ok', backend: 'fake' };
    },
  } as unknown as VisionClient;
}

/**
 * Fake reverse-image search and packshot generator (the real ones call paid external APIs): the
 * search returns `catalogState.results`, the generator returns `catalogState.outputs` in order.
 */
export const catalogState: {
  results: WebCandidate[];
  searches: string[];
  outputs: Buffer[];
  prompts: string[];
  checks: string[];
  failPresentation: number;
  failFidelity: number;
  ocr: string;
  generatorAvailable: boolean;
} = { results: [], searches: [], outputs: [], prompts: [], checks: [], failPresentation: 0, failFidelity: 0, ocr: '', generatorAvailable: true };

export function fakeCatalogPhoto(): CatalogPhotoProviders {
  const lens: SearchProvider = {
    id: 'serpapi_lens',
    label: 'Google Lens (SerpApi)',
    requires: ['SERPAPI_API_KEY'],
    configured: true,
    costCents: 2.5,
    async search(_image, o) {
      catalogState.searches.push(o.query);
      return { candidates: catalogState.results.map((c) => ({ ...c, query: o.query })), hints: [], raw: {} };
    },
  };
  const lykdat: SearchProvider = {
    id: 'lykdat',
    label: 'Lykdat',
    requires: ['LYKDAT_API_KEY'],
    configured: false,
    costCents: 1.67,
    async search() {
      throw new Error('no configurado: no debe llamarse');
    },
  };
  const gen: PackshotGenerator = {
    id: 'fal',
    label: 'fal.ai',
    model: 'fake-packshot',
    requires: ['FAL_KEY'],
    configured: true,
    estimatedCostCents: 3.5,
    async available() {
      return catalogState.generatorAvailable;
    },
    async generate(input) {
      catalogState.prompts.push(input.prompt.prompt);
      const image = catalogState.outputs.shift();
      if (!image) throw new GenerationError('fallo simulado', false);
      return { image, model: 'fake-packshot', costCents: 3.5 };
    },
  };
  return { search: [lens, lykdat], generators: [gen] };
}

/** Local fixture "store" serving synthetic product pages (not copied from any retailer). */
export async function startFixtureStore(): Promise<{ base: string; close: () => Promise<void> }> {
  const productJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: 'Gabardina larga beige',
    brand: { '@type': 'Brand', name: 'Marca de Prueba' },
    color: 'Beige',
    sku: 'GAB-001',
    image: 'https://cdn.example.test/gab.jpg',
    offers: [
      { '@type': 'Offer', price: '89.95', priceCurrency: 'EUR', availability: 'https://schema.org/InStock', itemOffered: { size: 'M' } },
      { '@type': 'Offer', price: '89.95', priceCurrency: 'EUR', availability: 'https://schema.org/OutOfStock', itemOffered: { size: 'L' } },
    ],
  };
  const productPhoto = await sharp({ create: { width: 300, height: 400, channels: 3, background: '#3c5a8c' } }).jpeg().toBuffer();
  const server: Server = createServer((req, res) => {
    if (req.url === '/img/producto.jpg') return res.writeHead(200, { 'content-type': 'image/jpeg' }).end(productPhoto);
    if (req.url === '/robots.txt') return res.writeHead(200, { 'content-type': 'text/plain' }).end('User-agent: *\nDisallow: /privado/\n');
    if (req.url?.startsWith('/es/p/gabardina')) {
      return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<html><head><title>Gabardina</title><script type="application/ld+json">${JSON.stringify(productJsonLd)}</script></head><body>Producto</body></html>`);
    }
    if (req.url?.startsWith('/privado/')) return res.writeHead(200, { 'content-type': 'text/html' }).end('<html></html>');
    if (req.url === '/bloqueada') return res.writeHead(403, { 'content-type': 'text/html' }).end('<html><title>Access Denied</title></html>');
    if (req.url === '/caida') return res.writeHead(503, { 'content-type': 'text/html' }).end('down');
    if (req.url === '/no-producto') return res.writeHead(200, { 'content-type': 'text/html' }).end('<html><title>Inicio</title><body>Bienvenida</body></html>');
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, close: () => new Promise<void>((r) => server.close(() => r())) };
}

export async function setupApp() {
  const adminUrl = process.env.DATABASE_ADMIN_URL;
  if (!adminUrl || !/dressit_test/.test(adminUrl)) throw new Error('Los tests de integración requieren DATABASE_TEST_ADMIN_URL apuntando a dressit_test');
  await migrate(adminUrl, () => undefined);
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  // Clean slate (test database only).
  await admin.query(`truncate users, retailers, catalog_products, weather_snapshots, catalog_sync_runs cascade`);
  await admin.end();
  const storageDir = mkdtempSync(join(tmpdir(), 'dressit-test-'));
  const cfg = loadConfig({ ...process.env, STORAGE_DRIVER: 'local', STORAGE_LOCAL_DIR: storageDir, LINK_IMPORT_ALLOW_PRIVATE: 'true', NODE_ENV: 'test', TRYON_MIN_SIMILARITY: '-1' });
  const { db: weatherDb } = createDb(cfg.DATABASE_URL, 2);
  const queue = new InlineJobQueue(1);
  const built = await buildApp({ cfg, queue, inlineWorker: true, overrides: { weather: new WeatherService(weatherDb, undefined, fakeWeatherFetch as typeof fetch), vision: fakeVision(), imagegen: fakeImageGenerator(), tryon: fakeTryon(), catalogPhoto: fakeCatalogPhoto() } });
  const { app } = built;
  const close = async () => {
    await built.close();
    await weatherDb.destroy();
    rmSync(storageDir, { recursive: true, force: true });
  };
  return { ...built, app, queue, storageDir, close, adminUrl };
}

export type TestApp = Awaited<ReturnType<typeof setupApp>>;

let counter = 0;
export async function registerUser(t: TestApp, name = 'Usuaria') {
  counter++;
  const email = `test${Date.now()}${counter}@example.test`;
  const res = await t.app.inject({ method: 'POST', url: '/v1/auth/register', payload: { email, password: 'contraseña-segura-1', displayName: name, acceptTerms: true } });
  if (res.statusCode !== 201) throw new Error(res.body);
  const body = res.json();
  const auth = { authorization: `Bearer ${body.tokens.accessToken}` };
  await t.app.inject({ method: 'PUT', url: '/v1/me/location', headers: auth, payload: { name: 'Madrid', lat: 40.4168, lon: -3.7038, countryCode: 'ES' } });
  return { id: body.user.id as string, email, auth, tokens: body.tokens as { accessToken: string; refreshToken: string } };
}

export const WARDROBE = [
  { name: 'Camiseta blanca', subcategory: 'camiseta', colors: [{ hex: '#f5f5f5' }], materials: ['algodon'] },
  { name: 'Camisa celeste', subcategory: 'camisa', colors: [{ hex: '#a9c6e8' }] },
  { name: 'Jersey azul marino', subcategory: 'jersey', colors: [{ hex: '#1f2a44' }], materials: ['lana'] },
  { name: 'Vaquero azul', subcategory: 'vaquero', colors: [{ hex: '#4b6584' }], materials: ['denim'] },
  { name: 'Chino beige', subcategory: 'chino', colors: [{ hex: '#d6c2a3' }] },
  { name: 'Bermuda beige', subcategory: 'bermuda', colors: [{ hex: '#d2c09c' }] },
  { name: 'Pantalón negro', subcategory: 'pantalon_vestir', colors: [{ hex: '#1c1c1c' }] },
  { name: 'Abrigo camel', subcategory: 'abrigo', colors: [{ hex: '#c09a6b' }], materials: ['lana'] },
  { name: 'Chubasquero marino', subcategory: 'impermeable', colors: [{ hex: '#1f2a44' }] },
  { name: 'Zapatillas blancas', subcategory: 'zapatillas', colors: [{ hex: '#f3f3f3' }], materials: ['cuero'] },
  { name: 'Botas negras', subcategory: 'botas', colors: [{ hex: '#141414' }], materials: ['cuero'] },
  { name: 'Sandalias', subcategory: 'sandalias', colors: [{ hex: '#8a6a4a' }] },
  { name: 'Mocasines', subcategory: 'mocasines', colors: [{ hex: '#6b4528' }] },
];

export async function seedWardrobe(t: TestApp, auth: Record<string, string>) {
  const ids: Record<string, string> = {};
  for (const g of WARDROBE) {
    const r = await t.app.inject({ method: 'POST', url: '/v1/garments', headers: auth, payload: g });
    if (r.statusCode !== 201) throw new Error(r.body);
    ids[g.name] = r.json().id;
  }
  return ids;
}

export async function testImage(color: { r: number; g: number; b: number }, format: 'png' | 'jpeg' = 'jpeg'): Promise<Buffer> {
  const img = sharp({ create: { width: 320, height: 400, channels: 3, background: color } });
  return format === 'png' ? img.png().toBuffer() : img.jpeg().toBuffer();
}

export function multipart(file: Buffer, fields: Record<string, string>, filename = 'foto.jpg', mime = 'image/jpeg') {
  const boundary = `----dressit${Date.now()}`;
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`), file, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}
