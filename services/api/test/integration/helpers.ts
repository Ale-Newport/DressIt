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
export function fakeVision(): VisionClient {
  const embed = (buf: Buffer) => {
    const h = createHash('sha256').update(buf).digest();
    const v = Array.from({ length: 768 }, (_, i) => (h[i % 32]! - 128) / 128);
    const n = Math.hypot(...v);
    return v.map((x) => x / n);
  };
  const cutout = () => sharp({ create: { width: 64, height: 80, channels: 4, background: { r: 30, g: 40, b: 70, alpha: 1 } } }).png().toBuffer();
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
      for (const it of items) it.cutout_png_base64 = (await cutout()).toString('base64');
      return { image: { width: 100, height: 100, sha256: 'x', phash: null }, items };
    },
    async embedImage(image: Buffer) {
      if (visionState.down) throw unavailable('El servicio de análisis de imágenes no está disponible.');
      return { embedding: embed(image), model: 'fake', dim: 768 };
    },
    async embedText() {
      return { embeddings: [], model: 'fake', dim: 768 };
    },
    async ocr() {
      return { text: '', lines: [] };
    },
    async health() {
      return { status: 'ok', backend: 'fake' };
    },
  } as unknown as VisionClient;
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
  const server: Server = createServer((req, res) => {
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
  const cfg = loadConfig({ ...process.env, STORAGE_DRIVER: 'local', STORAGE_LOCAL_DIR: storageDir, LINK_IMPORT_ALLOW_PRIVATE: 'true', NODE_ENV: 'test' });
  const { db: weatherDb } = createDb(cfg.DATABASE_URL, 2);
  const queue = new InlineJobQueue(1);
  const built = await buildApp({ cfg, queue, inlineWorker: true, overrides: { weather: new WeatherService(weatherDb, undefined, fakeWeatherFetch as typeof fetch), vision: fakeVision() } });
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
