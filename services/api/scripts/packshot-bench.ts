/**
 * Speed and quality bench of a packshot workflow on the vision service's evaluation photos: for each
 * photo it detects the garment (vision /v1/analyze), generates the catalogue photo with ComfyUI as
 * the API does (same prompt, same input) and runs the same automatic check (/v1/catalog/check).
 *
 *   SEED=1234 node --env-file=../../.env scripts/packshot-bench.ts <workflow> <out-dir> [photo-id …]
 *
 * Dark garments get the same tone fix as in the API (TONE=0 skips it).
 * Writes <out-dir>/<workflow>/<photo>.png, a side-by-side <photo>.jpg and results.json.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { ComfyGenerator, workflowCanvas } from '../src/modules/imagegen/generator.ts';
import { buildPackshotPrompt } from '../src/modules/catalog-photo/prompt.ts';
import { fixDarkGarmentTone } from '../src/modules/catalog-photo/tone.ts';
import { VisionClient } from '../src/modules/vision/client.ts';

const DEFAULT_PHOTOS = ['ov_polo_shirt_10', 'ov_dress_on_hanger_08', 'ov_folded_jeans_05', 'ov_cardigan_03', 'ov_puffer_jacket_01', 'ov_sneakers_shoes_12', 'wm_t_shirts_07'];
const [workflow = 'packshot-fast', outRoot = 'packshot-bench', ...ids] = process.argv.slice(2);
const photos = ids.length ? ids : DEFAULT_PHOTOS;
const evalDir = join(import.meta.dirname, '../../vision/eval/images');
const out = join(outRoot, workflow);
mkdirSync(out, { recursive: true });

const vision = new VisionClient(process.env.VISION_SERVICE_URL || 'http://127.0.0.1:8001', 120_000);
const gen = new ComfyGenerator({ url: process.env.IMAGEGEN_COMFY_URL || 'http://127.0.0.1:8188', timeoutMs: 30 * 60_000, studioWorkflow: workflow, avatarWorkflow: 'avatar' });
const canvas = workflowCanvas(workflow) ?? { width: 896, height: 1120 };

const rows = [];
for (const id of photos) {
  const photo = await sharp(readFileSync(join(evalDir, `${id}.jpg`))).rotate().jpeg({ quality: 92 }).toBuffer();
  const analysis = await vision.analyze(photo, 'image/jpeg', 'single', 1, { normalize: false });
  const item = analysis.items[0];
  if (!item?.cutout_png_base64 || !item.subcategory) {
    rows.push({ id, error: 'no garment detected' });
    continue;
  }
  const cutout = Buffer.from(item.cutout_png_base64, 'base64');
  const category = item.category?.value ?? 'top';
  const desc = { category, subcategory: item.subcategory.value, colors: item.colors, pattern: item.pattern?.value ?? null, materials: [], text: null, brand: null };
  const prompt = buildPackshotPrompt(desc);
  const t0 = Date.now();
  const raw = await gen.run(workflow, { INPUT_IMAGE: photo }, { PROMPT: prompt.prompt, SEED: Number(process.env.SEED ?? 1234), WIDTH: canvas.width, HEIGHT: canvas.height });
  const genMs = Date.now() - t0;
  // As the API does (TONE=0 to see the raw output).
  const tone = process.env.TONE === '0' ? null : await fixDarkGarmentTone(cutout, raw);
  const image = tone?.image ?? raw;
  const t1 = Date.now();
  const check = await vision.catalogCheck(cutout, image, { kind: 'generated', category, subcategory: desc.subcategory });
  const checkMs = Date.now() - t1;
  writeFileSync(join(out, `${id}.png`), image);
  const H = 520;
  const parts = await Promise.all([photo, image].map((b) => sharp(b).resize({ height: H }).toBuffer()));
  const widths = await Promise.all(parts.map(async (p) => (await sharp(p).metadata()).width!));
  await sharp({ create: { width: widths[0]! + widths[1]! + 8, height: H, channels: 3, background: '#888' } })
    .composite([{ input: parts[0]!, left: 0, top: 0 }, { input: parts[1]!, left: widths[0]! + 8, top: 0 }])
    .jpeg({ quality: 85 })
    .toFile(join(out, `${id}.jpg`));
  const row = {
    id,
    subcategory: desc.subcategory,
    genSeconds: +(genMs / 1000).toFixed(1),
    checkSeconds: +(checkMs / 1000).toFixed(1),
    passed: check.presentation.passed && check.fidelity.passed,
    presentation: check.presentation.passed,
    fidelity: check.fidelity.passed,
    similarity: +check.fidelity.similarity.toFixed(3),
    toneGamma: tone ? +tone.gamma.toFixed(2) : null,
    codes: [...check.presentation.codes, ...check.fidelity.codes],
  };
  rows.push(row);
  console.log(JSON.stringify(row));
}
writeFileSync(join(out, 'results.json'), JSON.stringify({ workflow, canvas, rows }, null, 2));
const ok = rows.filter((r) => 'passed' in r);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
console.log(`\n${workflow}: ${ok.filter((r) => r.passed).length}/${ok.length} pass · generation ${mean(ok.map((r) => r.genSeconds)).toFixed(1)} s mean · check ${mean(ok.map((r) => r.checkSeconds)).toFixed(1)} s mean`);
