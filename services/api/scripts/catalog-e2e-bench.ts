/**
 * End-to-end bench of the catalogue photo through the running API (import → detection → studio photo
 * → check → retries), on the vision service's evaluation photos:
 *
 *   node scripts/catalog-e2e-bench.ts <api-url> <out-dir> <photo-id> [photo-id …]
 *   node --env-file=../../.env scripts/catalog-e2e-bench.ts inproc <out-dir> <photo-id> …
 *
 * `inproc` runs the API (with its in-process job queue) inside this script on a free port, with the
 * configuration of the environment (e.g. VISION_SERVICE_URL / IMAGEGEN_MLX_URL of a second set of servers).
 * BENCH_EMAIL / BENCH_PASSWORD: an account to (re)use (e.g. to then look at the result in the app);
 * BENCH_ONE_JOB=1: all photos in one import, as a user picking several photos at once (mode multi).
 * Registers a throwaway user with the AI-images consent, imports each photo in the mode its manifest
 * row says (single / multi, as a user would toggle it), waits for every catalogue photo and writes, per
 * detection, <out>/<photo>-<n>.jpg (the photo with the detection's box | that zone enlarged | the catalogue
 * photo on grey: the enlarged zone lets a judge see a small item, e.g. a shirt collar under a sweater)
 * and results.json (names, status, attempts, check codes, seconds).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const [api = 'inproc', out = 'catalog-e2e', ...ids] = process.argv.slice(2);
if (!ids.length) throw new Error('usage: catalog-e2e-bench.ts <api-url>|inproc <out-dir> <photo-id> […]');
let B = api;
let stop: (() => Promise<void>) | null = null;
if (api === 'inproc') {
  const { buildApp } = await import('../src/app.ts');
  const { loadConfig } = await import('../src/config.ts');
  const port = Number(process.env.BENCH_PORT ?? 3011);
  // Signed image URLs point at API_PUBLIC_URL: this process.
  const built = await buildApp({ cfg: loadConfig({ ...process.env, LOG_LEVEL: 'warn', API_PORT: String(port), API_PUBLIC_URL: `http://127.0.0.1:${port}` }), inlineWorker: true });
  B = await built.app.listen({ port, host: '127.0.0.1' });
  stop = built.close;
}
mkdirSync(out, { recursive: true });
const evalDir = join(import.meta.dirname, '../../vision/eval');
const manifest = readFileSync(join(evalDir, 'manifest.csv'), 'utf8').split('\n').map((l) => l.split(','));
const modeOf = (id: string): 'single' | 'multi' => (manifest.find((r) => r[0] === id)?.[2] === 'multi' ? 'multi' : 'single');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => {
  const b = await r.json();
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(b)}`);
  return b;
};
const email = process.env.BENCH_EMAIL ?? `bench-${Date.now()}@example.test`;
const password = process.env.BENCH_PASSWORD ?? 'prueba-bench-segura-1';
const registered = await fetch(`${B}/v1/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, displayName: 'Prueba', acceptTerms: true }) });
let auth = registered.status === 409 ? await json(await fetch(`${B}/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) })) : await json(registered);
console.log(`account: ${email}`);
const H = { authorization: `Bearer ${auth.tokens.accessToken}` };
// Access tokens last minutes and a bench runs for long: renew the session every 5 minutes.
setInterval(async () => {
  try {
    auth = { tokens: await json(await fetch(`${B}/v1/auth/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: auth.tokens.refreshToken }) })) };
    if (auth.tokens.tokens) auth = { tokens: auth.tokens.tokens };
    H.authorization = `Bearer ${auth.tokens.accessToken}`;
  } catch (e) {
    console.error('token refresh failed', e);
  }
}, 5 * 60_000).unref();
await json(await fetch(`${B}/v1/me/consents/ai_image_generation`, { method: 'PUT', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ granted: true }) }));

const t0 = Date.now();
const imports: Array<{ id: string; photo: string; jobId: string; imageId: string }> = [];
const uploaded: Array<{ id: string; imageId: string }> = [];
for (const id of ids) {
  const fd = new FormData();
  fd.append('kind', 'garment_photo');
  fd.append('file', new Blob([readFileSync(join(evalDir, 'images', `${id}.jpg`))], { type: 'image/jpeg' }), `${id}.jpg`);
  uploaded.push({ id, imageId: (await json(await fetch(`${B}/v1/uploads`, { method: 'POST', headers: H, body: fd }))).imageId as string });
}
if (process.env.BENCH_ONE_JOB === '1') {
  const job = await json(await fetch(`${B}/v1/imports/photos`, { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ imageIds: uploaded.map((u) => u.imageId), mode: 'multi', source: 'batch' }) }));
  for (const u of uploaded) imports.push({ id: u.id, photo: u.id, jobId: job.id, imageId: u.imageId });
} else {
  for (const u of uploaded) {
    const job = await json(await fetch(`${B}/v1/imports/photos`, { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ imageIds: [u.imageId], mode: modeOf(u.id), source: 'batch' }) }));
    imports.push({ id: u.id, photo: u.id, jobId: job.id, imageId: u.imageId });
  }
}

const busy = (s?: string) => !s || ['queued', 'searching', 'generating'].includes(s);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let jobs: any[] = [];
for (;;) {
  await new Promise((r) => setTimeout(r, 10_000));
  const byId = new Map<string, unknown>();
  for (const jid of new Set(imports.map((i) => i.jobId))) byId.set(jid, await json(await fetch(`${B}/v1/imports/${jid}`, { headers: H })));
  jobs = imports.map((i) => byId.get(i.jobId));
  const analysing = jobs.filter((j) => j.status === 'queued' || j.status === 'processing').length;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dets: any[] = [...new Map(jobs.flatMap((j) => j.detections ?? []).map((d: { id: string }) => [d.id, d])).values()];
  const pending = dets.filter((d) => d.catalogPhoto && busy(d.catalogPhoto.status)).length;
  console.log(`${Math.round((Date.now() - t0) / 1000)} s: ${analysing} photos analysing, ${dets.length} detections, ${pending} catalogue photos pending`);
  if (!analysing && !pending) break;
  if (Date.now() - t0 > 4 * 3600_000) break;
}

const rows = [];
for (const [k, imp] of imports.entries()) {
  const job = jobs[k];
  const photo = await sharp(readFileSync(join(evalDir, 'images', `${imp.photo}.jpg`))).rotate().toBuffer();
  const meta = await sharp(photo).metadata();
  for (const [n, d] of (job.detections ?? []).filter((x: { imageId: string }) => x.imageId === imp.imageId).entries()) {
    const cp = d.catalogPhoto ? await json(await fetch(`${B}/v1/catalog-photos/${d.catalogPhoto.id}`, { headers: H })) : null;
    const H2 = 420;
    const [x0, y0, x1, y1] = d.bbox ?? [0, 0, 1, 1];
    const W = meta.width!;
    const Hh = meta.height!;
    const sw = Math.max(4, Math.round(Math.max(W, Hh) / 120));
    const rect = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${Hh}"><rect x="${x0 * W}" y="${y0 * Hh}" width="${(x1 - x0) * W}" height="${(y1 - y0) * Hh}" fill="none" stroke="#ff2020" stroke-width="${sw}"/></svg>`);
    const marked = await sharp(photo).composite([{ input: rect }]).png().toBuffer();
    const left = await sharp(marked).resize({ height: H2 }).toBuffer();
    // The box with half its size around it (at least 12 % of the photo), as the detection's close look.
    const mx = Math.max((x1 - x0) * 0.5, 0.12);
    const my = Math.max((y1 - y0) * 0.5, 0.12);
    const zx0 = Math.max(0, x0 - mx), zy0 = Math.max(0, y0 - my), zx1 = Math.min(1, x1 + mx), zy1 = Math.min(1, y1 + my);
    const zoom = await sharp(marked)
      .extract({ left: Math.round(zx0 * W), top: Math.round(zy0 * Hh), width: Math.max(1, Math.round((zx1 - zx0) * W)), height: Math.max(1, Math.round((zy1 - zy0) * Hh)) })
      .resize({ height: H2 })
      .toBuffer();
    let right: Buffer | null = null;
    if (cp?.generated?.url) {
      const img = await fetch(cp.generated.url.startsWith('http') ? cp.generated.url : `${B}${cp.generated.url}`, { headers: H });
      if (img.ok) right = await sharp(Buffer.from(await img.arrayBuffer())).resize({ height: H2 }).flatten({ background: '#5a5a5a' }).toBuffer();
    }
    const parts = right ? [left, zoom, right] : [left, zoom];
    const widths = await Promise.all(parts.map(async (p) => (await sharp(p).metadata()).width!));
    let x = 0;
    const comp = parts.map((p, i) => {
      const c = { input: p, left: x, top: 0 };
      x += widths[i]! + 8;
      return c;
    });
    const file = `${imp.photo}-${n}.jpg`;
    await sharp({ create: { width: Math.max(x, 1), height: H2, channels: 3, background: '#222' } }).composite(comp).jpeg({ quality: 84 }).toFile(join(out, file));
    const last = cp?.attempts?.at(-1);
    const row = {
      file,
      photo: imp.photo,
      mode: modeOf(imp.photo),
      bbox: d.bbox ?? null,
      name: d.predicted?.vlm?.name ?? null,
      nameEs: d.predicted?.vlm?.nameEs ?? null,
      subcategory: d.predicted?.subcategory?.value ?? null,
      visible: d.predicted?.vlm?.visible ?? null,
      status: cp?.status ?? null,
      message: cp?.message ?? null,
      attempts: cp?.attempts?.length ?? 0,
      providers: (cp?.attempts ?? []).map((a: { provider: string; ms: number }) => `${a.provider}:${Math.round(a.ms / 1000)}s`),
      generated: !!right,
      passed: last?.check?.passed ?? null,
      codes: last?.codes ?? [],
    };
    rows.push(row);
    console.log(JSON.stringify(row));
  }
}
writeFileSync(join(out, 'results.json'), JSON.stringify({ api: B, seconds: Math.round((Date.now() - t0) / 1000), rows }, null, 2));
if (stop) await stop();
console.log(`\n${rows.length} detections in ${Math.round((Date.now() - t0) / 1000)} s · ${rows.filter((r) => r.generated).length} with a catalogue photo · ${rows.filter((r) => r.status === 'ready').length} ready`);
