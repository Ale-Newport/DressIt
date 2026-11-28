/**
 * End-to-end evaluation of the catalogue photo against the RUNNING API + REAL vision service +
 * REAL generator (whatever PACKSHOT_PROVIDERS has configured). Registers a fresh user with the AI and
 * visual-search consents, imports one openly licensed photo per condition (services/vision/eval),
 * waits for every catalogue photo and writes, per garment, a before/after sheet:
 *
 *   original photo | background removal only (the previous system) | catalogue photo
 *
 * plus the checks of each attempt, and the same check run on the background-removed cutout (it must
 * fail: removing the background is not a product photo). Output: docs/evidence/foto-catalogo/ and
 * docs/evidence/foto-catalogo-<date>.json.
 *
 *   node --env-file-if-exists=../../.env scripts/catalog-photo-eval.ts [scenario…]
 *   node … scripts/catalog-photo-eval.ts --resume <email>   (follow the imports of a previous run)
 *
 * When the pipeline asks for another photo (garment cut by the frame), the sheet records that and the
 * script also does what the user can do in the app: "Generar de todos modos".
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';

const API = process.env.API_URL ?? 'http://localhost:3000';
const VISION = process.env.VISION_SERVICE_URL ?? 'http://localhost:8001';
const root = resolve(import.meta.dirname, '../../..');
const outDir = resolve(root, 'docs/evidence/foto-catalogo');
const date = new Date().toISOString().slice(0, 10);

interface Scenario {
  id: string;
  label: string;
  file: string;
  mode: 'single' | 'multi';
}

const SCENARIOS: Scenario[] = [
  { id: 'camiseta-arrugada-cama', label: 'Polo arrugado sobre una cama (con logotipo)', file: 'ov_polo_shirt_10.jpg', mode: 'single' },
  { id: 'percha', label: 'Camiseta colgada en una percha', file: 'ov_dress_on_hanger_08.jpg', mode: 'single' },
  { id: 'pantalon-doblado', label: 'Vaquero doblado con cinturón', file: 'ov_folded_jeans_05.jpg', mode: 'single' },
  { id: 'jersey-mangas-recogidas', label: 'Chaqueta de punto con las mangas recogidas', file: 'ov_cardigan_03.jpg', mode: 'single' },
  { id: 'chaqueta-puesta', label: 'Plumífero llevado por una persona', file: 'ov_puffer_jacket_01.jpg', mode: 'single' },
  { id: 'zapatilla-lateral', label: 'Zapatilla fotografiada de lado', file: 'ov_sneakers_shoes_12.jpg', mode: 'single' },
  { id: 'estampada', label: 'Camiseta estampada en una percha de tienda', file: 'wm_t_shirts_07.jpg', mode: 'single' },
  { id: 'varias-prendas', label: 'Varias prendas sobre una cama', file: 'ov_clothes_on_bed_01.jpg', mode: 'multi' },
];

let relogin: (() => Promise<string>) | null = null;

async function api<T>(method: string, path: string, token: string | null, body?: unknown, headers: Record<string, string> = {}, retried = false): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  // Access tokens are short-lived: log in again once and retry.
  if (res.status === 401 && token && relogin && !retried) return api<T>(method, path, await relogin(), body, headers, true);
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : null) as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const download = async (url: string) => Buffer.from(await (await fetch(url)).arrayBuffer());

async function visionCheck(reference: Buffer, candidate: Buffer, category: string, subcategory: string) {
  const fd = new FormData();
  fd.append('reference', new Blob([new Uint8Array(reference)], { type: 'image/png' }), 'r.png');
  fd.append('candidate', new Blob([new Uint8Array(candidate)], { type: 'image/png' }), 'c.png');
  fd.append('kind', 'generated');
  fd.append('category', category);
  fd.append('subcategory', subcategory);
  const res = await fetch(`${VISION}/v1/catalog/check`, { method: 'POST', body: fd });
  const j = (await res.json()) as { presentation: Record<string, unknown>; fidelity: Record<string, unknown> };
  return { presentation: j.presentation, fidelity: j.fidelity };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Word-wraps Spanish text for the sheet captions. */
function wrap(text: string, width = 50, maxLines = 3): string[] {
  const out: string[] = [];
  let line = '';
  for (const w of text.split(/\s+/)) {
    if ((line + ' ' + w).trim().length > width) {
      out.push(line);
      line = w;
    } else line = (line + ' ' + w).trim();
  }
  if (line) out.push(line);
  return out.length > maxLines ? [...out.slice(0, maxLines - 1), `${out[maxLines - 1]}…`] : out;
}

async function panel(img: Buffer, title: string, lines: string[], tone: 'ok' | 'bad' | 'neutral', W = 420, H = 520): Promise<Buffer> {
  const inner = await sharp(img).flatten({ background: '#ffffff' }).resize(W - 24, H - 24, { fit: 'contain', background: '#ffffff' }).png().toBuffer();
  const color = tone === 'ok' ? '#1d7a3a' : tone === 'bad' ? '#b3261e' : '#333333';
  const text = `<svg width="${W}" height="140" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#ffffff"/>
    <text x="12" y="26" font-family="Helvetica, Arial" font-size="19" font-weight="700" fill="${color}">${esc(title)}</text>
    ${lines.slice(0, 4).map((l, i) => `<text x="12" y="${52 + i * 21}" font-family="Helvetica, Arial" font-size="15" fill="#444">${esc(l)}</text>`).join('')}</svg>`;
  return sharp({ create: { width: W, height: H + 140, channels: 3, background: '#ffffff' } })
    .composite([
      { input: inner, left: 12, top: 12 },
      { input: Buffer.from(text), left: 0, top: H },
    ])
    .png()
    .toBuffer();
}

async function sheet(panels: Buffer[], heading: string): Promise<Buffer> {
  const W = 420 * panels.length + 16 * (panels.length + 1);
  const head = `<svg width="${W}" height="50" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#f4f1ec"/><text x="16" y="33" font-family="Helvetica, Arial" font-size="22" font-weight="700" fill="#222">${esc(heading)}</text></svg>`;
  return sharp({ create: { width: W, height: 50 + 660 + 16, channels: 3, background: '#f4f1ec' } })
    .composite([{ input: Buffer.from(head), left: 0, top: 0 }, ...panels.map((p, i) => ({ input: p, left: 16 + i * 436, top: 58 }))])
    .jpeg({ quality: 86 })
    .toBuffer();
}

const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${Math.round(v * 100)} %`);

async function main() {
  const args = process.argv.slice(2);
  const resumeAt = args.indexOf('--resume');
  const resumeEmail = resumeAt >= 0 ? args[resumeAt + 1] : null;
  const only = args.filter((a, i) => !a.startsWith('--') && (resumeAt < 0 || i !== resumeAt + 1));
  const scenarios = only.length ? SCENARIOS.filter((s) => only.includes(s.id)) : SCENARIOS;
  mkdirSync(outDir, { recursive: true });
  const email = resumeEmail ?? `eval-catalogo-${Date.now()}@example.test`;
  const reg = resumeEmail
    ? await api<{ tokens: { accessToken: string } }>('POST', '/v1/auth/login', null, { email, password: 'evaluacion-catalogo-1' })
    : await api<{ tokens: { accessToken: string } }>('POST', '/v1/auth/register', null, { email, password: 'evaluacion-catalogo-1', displayName: 'Evaluación', acceptTerms: true });
  console.log(`Usuario de evaluación: ${email}`);
  let token = reg.tokens.accessToken;
  relogin = async () => {
    token = (await api<{ tokens: { accessToken: string } }>('POST', '/v1/auth/login', null, { email, password: 'evaluacion-catalogo-1' })).tokens.accessToken;
    return token;
  };
  if (!resumeEmail) for (const kind of ['photo_processing', 'ai_image_generation', 'visual_search_external']) await api('PUT', `/v1/me/consents/${kind}`, token, { granted: true });
  const status = await api<unknown>('GET', '/v1/catalog-photos/status', token);
  console.log('Estado de proveedores:', JSON.stringify(status));
  const started = Date.now();
  const imports: Array<{ s: Scenario; jobId: string; photo: Buffer }> = [];
  if (resumeEmail) {
    // The previous run created one import per scenario, in order.
    const jobs = (await api<Array<{ id: string; createdAt: string }>>('GET', '/v1/imports', token)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const [i, s] of SCENARIOS.entries()) if (jobs[i] && scenarios.includes(s)) imports.push({ s, jobId: jobs[i]!.id, photo: readFileSync(resolve(root, 'services/vision/eval/images', s.file)) });
  }
  for (const s of resumeEmail ? [] : scenarios) {
    const photo = readFileSync(resolve(root, 'services/vision/eval/images', s.file));
    const fd = new FormData();
    fd.append('kind', 'garment_photo');
    fd.append('file', new Blob([new Uint8Array(photo)], { type: 'image/jpeg' }), s.file);
    const up = await api<{ imageId: string }>('POST', '/v1/uploads', token, fd);
    const job = await api<{ id: string }>('POST', '/v1/imports/photos', token, { imageIds: [up.imageId], mode: s.mode, source: 'camera' });
    imports.push({ s, jobId: job.id, photo });
    console.log(`→ ${s.id}: importación ${job.id}`);
  }
  const results: unknown[] = [];
  const deadline = Date.now() + 6 * 3600_000;
  for (const { s, jobId, photo } of imports) {
    let imp: { status: string; detections: Array<{ id: string; predicted: { category?: { value: string }; subcategory?: { value: string } }; catalogPhoto: { id: string; status: string } | null }> };
    for (;;) {
      imp = await api('GET', `/v1/imports/${jobId}`, token);
      const active = imp.detections.some((d) => d.catalogPhoto && ['queued', 'searching', 'generating'].includes(d.catalogPhoto.status));
      if (!['queued', 'processing'].includes(imp.status) && !active) break;
      if (Date.now() > deadline) throw new Error('Tiempo agotado');
      await sleep(15_000);
    }
    for (const [k, d] of imp.detections.entries()) {
      if (!d.catalogPhoto) continue;
      let asked: string | null = null;
      let catalogId = d.catalogPhoto.id;
      const first = await api<{ status: string; message: string | null; attempts: unknown[] }>('GET', `/v1/catalog-photos/${catalogId}`, token);
      if (first.status === 'needs_user' && !first.attempts.length && /(cortada|pequeña)/.test(first.message ?? '')) {
        // What the user can do in the app: "Generar de todos modos".
        asked = first.message;
        const garmentId = await api<{ id: string }>('POST', `/v1/imports/${jobId}/detections/${d.id}/accept`, token, {})
          .then((g) => g.id)
          .catch(async () => (await api<{ detections: Array<{ id: string; garmentId: string | null }> }>('GET', `/v1/imports/${jobId}`, token)).detections.find((x) => x.id === d.id)?.garmentId ?? null);
        if (!garmentId) {
          // Not identified (no type): the user would have to say what it is first.
          console.log(`· ${s.id}: detección ${k + 1} sin tipo identificado; no se fuerza`);
        } else {
          // Resuming: reuse the forced generation already made for this garment.
          const prev = await api<{ id: string; attempts: unknown[] } | null>('GET', `/v1/garments/${garmentId}/catalog-photo`, token);
          catalogId = prev && prev.id !== catalogId && prev.attempts.length ? prev.id : (await api<{ id: string }>('POST', `/v1/garments/${garmentId}/catalog-photo`, token, { mode: 'generate', force: true })).id;
        }
        for (;;) {
          const st = await api<{ status: string }>('GET', `/v1/catalog-photos/${catalogId}`, token);
          if (!['queued', 'searching', 'generating'].includes(st.status)) break;
          if (Date.now() > deadline) throw new Error('Tiempo agotado');
          await sleep(15_000);
        }
      }
      const forced = catalogId !== d.catalogPhoto.id;
      const job = await api<{
        id: string;
        status: string;
        message: string | null;
        original: { url: string } | null;
        generated: { url: string; generatedBy?: string } | null;
        generatedCheck: { passed: boolean; similarity: number; symmetry: number | null; neat: number; paletteDeltaE: number; reasons: string[] } | null;
        attempts: Array<{ n: number; provider: string; model: string; ms: number; check: { passed: boolean; reasons: string[]; similarity: number; symmetry: number | null; neat: number; paletteDeltaE: number } | null; error: string | null }>;
        providers: unknown;
        official: unknown;
        alternatives: unknown[];
      }>('GET', `/v1/catalog-photos/${catalogId}`, token);
      const cutout = job.original ? await download(job.original.url) : null;
      const generated = job.generated ? await download(job.generated.url) : null;
      const category = d.predicted.category?.value ?? 'top';
      const sub = d.predicted.subcategory?.value ?? '';
      // Control: the previous system's output (background removed) must not pass as a product photo.
      const control = cutout ? await visionCheck(cutout, await sharp(cutout).flatten({ background: '#ffffff' }).extend({ top: 40, bottom: 40, left: 40, right: 40, background: '#ffffff' }).png().toBuffer(), category, sub) : null;
      const name = `${s.id}${imp.detections.length > 1 ? `-${k + 1}` : ''}`;
      const last = job.attempts.at(-1);
      const panels = [
        await panel(photo, 'Foto original', [...wrap(s.label, 50, 2), `Detectado: ${sub || category}`, ...(asked ? wrap(`El sistema pidió otra foto: ${asked}`, 50, 2) : [])], 'neutral'),
        cutout
          ? await panel(cutout, 'Solo fondo eliminado (sistema anterior)', control?.presentation.passed ? ['Pasaría como foto de producto'] : ['El control lo rechaza:', ...wrap(((control?.presentation.reasons as string[]) ?? []).join(' '), 50, 3)], control?.presentation.passed ? 'bad' : 'neutral')
          : await panel(photo, 'Sin recorte', [], 'neutral'),
        generated
          ? await panel(generated, `Foto de catálogo IA ${job.generatedCheck?.passed ? '✓' : '✗'}`, [
              `${job.attempts.length} intento(s) · ${last ? Math.round(last.ms / 1000) : 0} s el último`,
              `Simetría ${pct(job.generatedCheck?.symmetry)} · ordenada ${pct(job.generatedCheck?.neat)}`,
              `Parecido ${pct(job.generatedCheck?.similarity)} · ΔE paleta ${job.generatedCheck?.paletteDeltaE.toFixed(1) ?? '—'}`,
              ...wrap((job.generatedCheck?.reasons ?? []).join(' '), 50, 1).filter(Boolean),
            ], job.generatedCheck?.passed ? 'ok' : 'bad')
          : await panel(photo, 'Sin foto generada', wrap(job.message ?? '', 50, 4), 'bad'),
      ];
      writeFileSync(resolve(outDir, `${name}.jpg`), await sheet(panels, `${s.label} — ${job.status}`));
      results.push({ scenario: s.id, label: s.label, file: s.file, detection: k + 1, category, subcategory: sub, askedForAnotherPhoto: asked, forced, status: job.status, message: job.message, model: job.generated?.generatedBy ?? null, attempts: job.attempts, finalCheck: job.generatedCheck, control, providers: job.providers, official: job.official, alternatives: job.alternatives.length });
      console.log(`✓ ${name}: ${job.status} (${job.attempts.length} intentos) ${job.generatedCheck?.passed ? 'APTA' : ''}`);
    }
  }
  const suffix = only.length ? `-${only.join('-')}` : '';
  writeFileSync(resolve(root, `docs/evidence/foto-catalogo-${date}${suffix}.json`), JSON.stringify({ date, api: API, minutes: Math.round((Date.now() - started) / 60000), status, results }, null, 2));
  console.log(`Listo en ${Math.round((Date.now() - started) / 60000)} min`);
}

await main();
