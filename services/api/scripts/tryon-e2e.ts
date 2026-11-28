/**
 * End-to-end try-on through the running API, as the app does it: sets the account's avatar from a
 * full-body photo, accepts garments from its latest import (by name), builds outfits with them and asks
 * for "Verme con este conjunto" (method fast by default). Writes <out>/<outfit>.jpg (photo | garments |
 * result) and results.json.
 *
 *   node scripts/tryon-e2e.ts <api-url> <out-dir> <body-photo> '<outfits JSON>'
 *     outfits JSON: [{"name": "casual", "items": [["base", "mistletoe"], ["bottom", "jeans"], ["footwear", "sneakers"]]}]
 *     (each item: [slot, a word of the garment's name at import])
 *   env: BENCH_EMAIL, BENCH_PASSWORD (the account), TRYON_METHOD (fast).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const [B = 'http://localhost:3000', out = 'tryon-e2e', bodyPath, outfitsJson = '[]'] = process.argv.slice(2);
if (!bodyPath) throw new Error('usage: tryon-e2e.ts <api-url> <out-dir> <body-photo> <outfits JSON>');
const outfits = JSON.parse(outfitsJson) as Array<{ name: string; items: Array<[string, string]> }>;
mkdirSync(out, { recursive: true });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => {
  const b = await r.json();
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(b)}`);
  return b;
};
const auth = await json(await fetch(`${B}/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: process.env.BENCH_EMAIL, password: process.env.BENCH_PASSWORD }) }));
const H = { authorization: `Bearer ${auth.tokens.accessToken}` };
const JH = { ...H, 'content-type': 'application/json' };
for (const kind of ['avatar', 'ai_image_generation']) await json(await fetch(`${B}/v1/me/consents/${kind}`, { method: 'PUT', headers: JH, body: JSON.stringify({ granted: true }) }));

const upload = async (kind: string, data: Buffer, name: string) => {
  const fd = new FormData();
  fd.append('kind', kind);
  fd.append('file', new Blob([new Uint8Array(data)], { type: 'image/jpeg' }), name);
  return (await json(await fetch(`${B}/v1/uploads`, { method: 'POST', headers: H, body: fd }))).imageId as string;
};
const body = await sharp(readFileSync(bodyPath)).rotate().jpeg({ quality: 92 }).toBuffer();
const bodyImageId = await upload('self_body', body, 'body.jpg');
await json(await fetch(`${B}/v1/me/avatar`, { method: 'PUT', headers: JH, body: JSON.stringify({ bodyImageId, attestedSelf: true, attestedAdult: true }) }));

// The latest import's detections; accept the ones the outfits name (once each).
const jobs = await json(await fetch(`${B}/v1/imports?limit=5`, { headers: H }));
const list = Array.isArray(jobs) ? jobs : (jobs.items ?? jobs.jobs ?? []);
const job = await json(await fetch(`${B}/v1/imports/${list[0].id}`, { headers: H }));
const garmentFor = new Map<string, string>();
async function garment(word: string): Promise<string> {
  if (garmentFor.has(word)) return garmentFor.get(word)!;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = job.detections.find((x: any) => `${x.predicted?.vlm?.name ?? ''} ${x.predicted?.vlm?.nameEs ?? ''}`.toLowerCase().includes(word.toLowerCase()));
  if (!d) throw new Error(`no detection named like "${word}"`);
  if (d.garmentId) {
    garmentFor.set(word, d.garmentId);
    return d.garmentId as string;
  }
  // As in the review: the studio photo chosen as its picture when there is one, then accepted.
  if (d.catalogPhoto?.id && d.catalogPhoto.status === 'ready') {
    await fetch(`${B}/v1/catalog-photos/${d.catalogPhoto.id}/choose`, { method: 'POST', headers: JH, body: JSON.stringify({ choice: 'generated', acceptWarnings: true }) });
  }
  const r = await json(await fetch(`${B}/v1/imports/${job.id}/detections/${d.id}/accept`, { method: 'POST', headers: JH, body: JSON.stringify({}) }));
  const id = (r.garment?.id ?? r.garmentId ?? r.id) as string;
  garmentFor.set(word, id);
  return id;
}

const rows = [];
for (const o of outfits) {
  const items = [];
  for (const [slot, word] of o.items) items.push({ slot, garmentId: await garment(word) });
  const outfit = await json(await fetch(`${B}/v1/outfits`, { method: 'POST', headers: JH, body: JSON.stringify({ items }) }));
  const t0 = Date.now();
  const started = await json(await fetch(`${B}/v1/outfits/${outfit.id}/avatar`, { method: 'POST', headers: JH, body: JSON.stringify({ method: process.env.TRYON_METHOD ?? 'fast' }) }));
  let gen = started;
  while (['queued', 'running'].includes(gen.status)) {
    await new Promise((r) => setTimeout(r, 3000));
    gen = await json(await fetch(`${B}/v1/generations/${started.id}`, { headers: H }));
  }
  const seconds = Math.round((Date.now() - t0) / 1000);
  // The composite for judging: their photo | the garments' pictures | the result.
  const HT = 640;
  const tiles: Buffer[] = [await sharp(body).resize({ height: HT }).toBuffer()];
  const full = await json(await fetch(`${B}/v1/outfits/${outfit.id}`, { headers: H }));
  const pics: Buffer[] = [];
  for (const it of full.items ?? []) {
    const url = it.garment?.image?.url;
    if (!url) continue;
    const img = await fetch(url.startsWith('http') ? url : `${B}${url}`, { headers: H });
    if (img.ok) pics.push(await sharp(Buffer.from(await img.arrayBuffer())).flatten({ background: '#ececec' }).resize({ height: Math.floor(HT / Math.max(1, (full.items ?? []).length)) - 6 }).toBuffer());
  }
  if (pics.length) {
    const w = Math.max(...(await Promise.all(pics.map(async (p) => (await sharp(p).metadata()).width!))));
    let y = 0;
    const comp = [];
    for (const p of pics) {
      comp.push({ input: p, left: 0, top: y });
      y += (await sharp(p).metadata()).height! + 6;
    }
    tiles.push(await sharp({ create: { width: w, height: HT, channels: 3, background: '#222' } }).composite(comp).png().toBuffer());
  }
  if (gen.result?.url) {
    const img = await fetch(gen.result.url.startsWith('http') ? gen.result.url : `${B}${gen.result.url}`, { headers: H });
    if (img.ok) tiles.push(await sharp(Buffer.from(await img.arrayBuffer())).resize({ height: HT }).toBuffer());
  }
  const widths = await Promise.all(tiles.map(async (t) => (await sharp(t).metadata()).width!));
  let x = 0;
  const comp = tiles.map((t, i) => {
    const c = { input: t, left: x, top: 0 };
    x += widths[i]! + 10;
    return c;
  });
  await sharp({ create: { width: x, height: HT, channels: 3, background: '#222' } }).composite(comp).jpeg({ quality: 88 }).toFile(join(out, `${o.name}.jpg`));
  const row = { outfit: o.name, id: outfit.id, status: gen.status, method: gen.method, error: gen.error ?? null, fidelity: gen.fidelity ?? null, seconds };
  rows.push(row);
  console.log(JSON.stringify(row));
}
writeFileSync(join(out, 'results.json'), JSON.stringify(rows, null, 2));
