/**
 * End-to-end digitisation check against the RUNNING API + REAL vision service:
 * registers a fresh user, uploads 10 labelled photos (openly licensed, see
 * services/vision/eval/manifest.csv), runs a batch import, compares predictions with the
 * hand labels, accepts them (correcting only what the model abstained on), and asks for
 * today's outfits. Writes docs/evidence/digitalizacion-e2e-<date>.md.
 *
 *   node scripts/e2e-digitize.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const B = process.env.API_URL ?? 'http://localhost:3000';
const root = resolve(import.meta.dirname, '../../..');
const manifestPath = resolve(root, 'services/vision/eval/manifest.csv');

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

const lines = readFileSync(manifestPath, 'utf8').trim().split('\n');
const header = parseCsvLine(lines[0]!);
const rows = lines.slice(1).map((l) => Object.fromEntries(parseCsvLine(l).map((v, i) => [header[i]!, v])) as Record<string, string>);
// 10 single-garment photos with distinct expected subcategories, preferring the held-out test split.
const picked: Record<string, string>[] = [];
const seenSubs = new Set<string>();
for (const split of ['test', 'calib', 'dev', '']) {
  for (const r of rows) {
    if (picked.length >= 10) break;
    if (r.mode !== 'single' || (split && r.split !== split)) continue;
    const main = r.subcategory!.split('|')[0]!;
    if (seenSubs.has(main) || picked.includes(r)) continue;
    seenSubs.add(main);
    picked.push(r);
  }
}

const json = async (r: Response) => {
  const body = await r.json();
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(body)}`);
  return body as any; // eslint-disable-line @typescript-eslint/no-explicit-any
};
const email = `e2e-vision-${Date.now()}@example.test`;
const auth = await json(await fetch(`${B}/v1/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'prueba-e2e-segura-1', displayName: 'Prueba E2E', acceptTerms: true }) }));
const H = { authorization: `Bearer ${auth.tokens.accessToken}` };
await json(await fetch(`${B}/v1/me/location`, { method: 'PUT', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Madrid', lat: 40.42, lon: -3.7, countryCode: 'ES' }) }));

const t0 = performance.now();
const imageIds: string[] = [];
for (const r of picked) {
  const fd = new FormData();
  fd.append('kind', 'garment_photo');
  fd.append('file', new Blob([readFileSync(resolve(root, 'services/vision/eval', r.file!))], { type: 'image/jpeg' }), r.file!.split('/').pop());
  imageIds.push((await json(await fetch(`${B}/v1/uploads`, { method: 'POST', headers: H, body: fd }))).imageId);
}
const tUpload = performance.now() - t0;
let job = await json(await fetch(`${B}/v1/imports/photos`, { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ imageIds, mode: 'single', source: 'batch' }) }));
const t1 = performance.now();
while (job.status === 'queued' || job.status === 'processing') {
  await new Promise((r) => setTimeout(r, 1000));
  job = await json(await fetch(`${B}/v1/imports/${job.id}`, { headers: H }));
  if (performance.now() - t1 > 300_000) throw new Error('timeout esperando el análisis');
}
const tAnalysis = performance.now() - t1;
if (job.status === 'failed') throw new Error(`Importación fallida: ${job.error}`);

const table: string[] = [];
let correctCategory = 0;
let correctSub = 0;
let abstained = 0;
let colorOk = 0;
const garmentIds: string[] = [];
for (const [i, r] of picked.entries()) {
  const det = job.detections.find((d: { imageId: string }) => d.imageId === imageIds[i]);
  const p = det?.predicted ?? {};
  const expectedSubs = r.subcategory!.split('|');
  const expectedColors = r.color_family!.split('|');
  const sub = p.subcategory?.value ?? null;
  const catOk = p.category?.value === r.category;
  const subOk = sub !== null && expectedSubs.includes(sub);
  const col = p.colors?.[0]?.family ?? null;
  const cOk = col !== null && expectedColors.includes(col);
  if (catOk) correctCategory++;
  if (sub === null) abstained++;
  else if (subOk) correctSub++;
  if (cOk) colorOk++;
  // Accept: keep the model's answer; only when it abstained, the "user" supplies the type.
  const overrides = sub === null ? { subcategory: expectedSubs[0] } : {};
  const g = await json(await fetch(`${B}/v1/imports/${job.id}/detections/${det.id}/accept`, { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ overrides }) }));
  garmentIds.push(g.id);
  table.push(
    `| ${r.id} | ${r.license} · ${r.author} | ${r.category} / ${expectedSubs.join(' o ')} / ${expectedColors.join(' o ')} | ${p.category?.value ?? '—'} (${p.category ? p.category.confidence.toFixed(2) : '—'}) / ${sub ?? '*abstención*'}${p.subcategory ? ` (${p.subcategory.confidence.toFixed(2)})` : ''} / ${col ?? '—'} | ${catOk ? '✅' : '❌'} ${sub === null ? '➖' : subOk ? '✅' : '❌'} ${cOk ? '✅' : '❌'} | ${det.cutout ? 'sí' : 'no'} | ${(det.warnings ?? []).join('; ') || '—'} |`,
  );
}

const wardrobe = await json(await fetch(`${B}/v1/garments?limit=50`, { headers: H }));
const rec = await json(await fetch(`${B}/v1/outfits/recommendations`, { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ count: 3, occasion: 'dia_informal' }) }));

const date = new Date().toISOString().slice(0, 10);
const md = `# Evidencia: digitalización extremo a extremo con modelos reales (${date})

Generado por \`node services/api/scripts/e2e-digitize.ts\` contra la API en ejecución y el servicio de
visión real (Marqo-FashionSigLIP + Grounding DINO + SAM 2.1 + rembg isnet, en MPS). Flujo completo:
registro → 10 subidas (\`/v1/uploads\`) → importación por lote (\`/v1/imports/photos\`, modo \`single\`)
→ análisis asíncrono → revisión → aceptación → armario → conjuntos del día.

Fotos reales con licencia abierta etiquetadas a mano (\`services/vision/eval/manifest.csv\`), elegidas con
subcategorías distintas y prioridad para el conjunto de test reservado.

- Subida de 10 fotos: ${(tUpload / 1000).toFixed(1)} s · análisis del lote: ${(tAnalysis / 1000).toFixed(1)} s (${(tAnalysis / 10000).toFixed(2)} s/foto)
- Categoría correcta: **${correctCategory}/10**
- Subcategoría: **${correctSub}/${10 - abstained} correctas cuando el modelo responde** (${abstained} abstenciones, que el usuario completa en la revisión)
- Color principal en la familia etiquetada: **${colorOk}/10**
- Prendas en el armario tras la revisión: **${wardrobe.items.length}**, todas con recorte sin fondo: ${wardrobe.items.filter((g: { image: { isCutout: boolean } | null }) => g.image?.isCutout).length}/10

| Foto | Licencia · autor | Esperado (cat / subcat / color) | Predicho (confianza) | Cat · Sub · Color | Recorte | Avisos |
|---|---|---|---|---|---|---|
${table.join('\n')}

## Conjuntos generados con esas prendas (${rec.weather ? rec.weather.summary : 'sin previsión'})

${rec.outfits.map((o: { score: number; items: Array<{ slot: string; garment: { name: string } | null }>; explanation: string[] }, i: number) => `${i + 1}. ${o.items.map((it) => it.garment?.name).join(' + ')} — puntuación ${o.score.toFixed(2)}. ${o.explanation[0] ?? ''}`).join('\n')}
${rec.warnings.length ? `\nAvisos del motor: ${rec.warnings.join(' ')}` : ''}

Créditos de las fotos: ver columna «Licencia · autor»; URLs de origen en el manifiesto.
`;
writeFileSync(resolve(root, `docs/evidence/digitalizacion-e2e-${date}.md`), md);
console.log(md);
