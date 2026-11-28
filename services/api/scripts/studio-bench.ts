/**
 * Studio-photo bench on the vision service's evaluation photos, single AND multi-garment, comparing
 * the input/prompt strategies and the backends:
 *
 *   node --env-file=../../.env scripts/studio-bench.ts <strategy> <backend> <out-dir> [photo-id …]
 *
 *   strategy  current  the API's packshot before 2026-11-25 (garment region + 8 %, white packshot prompt)
 *             studio   studio photo first from the original (whole photo, or the garment's region with
 *                      generous context when there are several), the target garment named and located,
 *                      light grey background; the cutout is made afterwards from the generated image
 *   backend   comfy (IMAGEGEN_COMFY_URL, workflow packshot-fast) · mlx (IMAGEGEN_MLX_URL, mflux)
 *
 * Every detected garment of every photo is generated once (same seed), then tone-fixed and checked as
 * the API does. Writes <out>/<strategy>-<backend>/<photo>-<n>.jpg (original | generated | cutout) and
 * results.json.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { ComfyGenerator, workflowCanvas } from '../src/modules/imagegen/generator.ts';
import { buildPackshotPrompt, buildStudioPrompt } from '../src/modules/catalog-photo/prompt.ts';
import { cropAround, markGarment, studioInput } from '../src/modules/catalog-photo/service.ts';
import { MlxPackshot } from '../src/modules/catalog-photo/generate.ts';
import { fixDarkGarmentTone } from '../src/modules/catalog-photo/tone.ts';
import { VisionClient } from '../src/modules/vision/client.ts';

const SINGLE = ['ov_polo_shirt_10', 'ov_folded_jeans_05', 'ov_cardigan_03', 'ov_puffer_jacket_01', 'wm_t_shirts_07'];
const MULTI = ['ov_backpack_16', 'ov_denim_jacket_02', 'ov_leather_jacket_04', 'ov_dress_on_hanger_19', 'ov_pleated_skirt_05', 'ov_clothes_on_bed_01'];
const [strategy = 'studio', backend = 'mlx', outRoot = 'studio-bench', ...ids] = process.argv.slice(2);
if (!['current', 'studio'].includes(strategy) || !['comfy', 'mlx'].includes(backend)) throw new Error('usage: studio-bench.ts current|studio comfy|mlx <out> [ids]');
const photos = ids.length ? ids : [...SINGLE, ...MULTI];
const evalDir = join(import.meta.dirname, '../../vision/eval/images');
const manifest = readFileSync(join(evalDir, '../manifest.csv'), 'utf8').split('\n').map((l) => l.split(','));
const modeOf = (id: string) => (manifest.find((r) => r[0] === id)?.[2] === 'multi' ? 'multi' : 'single');
const out = join(outRoot, `${strategy}-${backend}`);
mkdirSync(out, { recursive: true });

const vision = new VisionClient(process.env.VISION_SERVICE_URL || 'http://127.0.0.1:8001', 180_000);
const comfy = new ComfyGenerator({ url: process.env.IMAGEGEN_COMFY_URL || 'http://127.0.0.1:8188', timeoutMs: 30 * 60_000, studioWorkflow: 'packshot-fast', avatarWorkflow: 'avatar' });
const mlx = new MlxPackshot({ url: process.env.IMAGEGEN_MLX_URL || 'http://127.0.0.1:8189', timeoutMs: 30 * 60_000 });
const canvas = backend === 'mlx' ? mlx.canvas : (workflowCanvas('packshot-fast') ?? { width: 832, height: 1040 });
const SEED = Number(process.env.SEED ?? 1234);

const rows: Array<Record<string, unknown>> = [];
for (const id of photos) {
  const photo = await sharp(readFileSync(join(evalDir, `${id}.jpg`))).rotate().jpeg({ quality: 92 }).toBuffer();
  const mode = modeOf(id);
  const ta = Date.now();
  const analysis = await vision.analyze(photo, 'image/jpeg', mode, mode === 'multi' ? 8 : 1, { normalize: false });
  const analyzeMs = Date.now() - ta;
  const items = analysis.items.filter((i) => i.cutout_png_base64 && i.subcategory);
  for (const [n, item] of items.entries()) {
    const cutout = Buffer.from(item.cutout_png_base64!, 'base64');
    const category = item.category?.value ?? 'top';
    const desc = { category, subcategory: item.subcategory!.value, colors: item.colors, pattern: item.pattern?.value ?? null, materials: [], text: null, brand: null };
    const bbox = item.bbox as [number, number, number, number] | null;
    const multi = items.length > 1;
    const input = strategy === 'current' ? (multi ? await cropAround(photo, bbox) : photo) : await studioInput(photo, bbox, multi);
    const name = strategy === 'studio' && process.env.NAMER !== '0' ? await mlx.describe(await markGarment(photo, bbox, multi)) : null;
    const prompt = strategy === 'current' ? buildPackshotPrompt(desc).prompt : buildStudioPrompt(desc, { multi, name }).prompt;
    const t0 = Date.now();
    const reuse = process.env.REUSE ? join(process.env.REUSE, `${id}-${n}.raw.png`) : null;
    const raw = reuse && existsSync(reuse) ? readFileSync(reuse) :
      backend === 'mlx'
        ? (await mlx.generate({ photo: input, mime: 'image/jpeg', prompt: { prompt, negative: '', style: '', version: '' }, seed: SEED, ...canvas })).image
        : await comfy.run('packshot-fast', { INPUT_IMAGE: input }, { PROMPT: prompt, SEED, WIDTH: canvas.width, HEIGHT: canvas.height });
    const genMs = Date.now() - t0;
    writeFileSync(join(out, `${id}-${n}.raw.png`), raw);
    const tone = strategy === 'studio' ? null : await fixDarkGarmentTone(cutout, raw).catch(() => null);
    const image = tone?.image ?? raw;
    const t1 = Date.now();
    const VALID = ['top', 'bottom', 'one_piece', 'outerwear', 'footwear', 'accessory'];
    const expected = name && VALID.includes(name.category) ? name.category : category;
    const target = strategy === 'studio'
      ? { kind: 'studio' as const, category: expected, subcategory: expected === category ? desc.subcategory : null }
      : { kind: 'generated' as const, category, subcategory: desc.subcategory };
    const check = await vision.catalogCheck(cutout, image, target);
    writeFileSync(join(out, `${id}-${n}.ref.png`), cutout);
    // Same image without the colour match (kind=studio), for comparison.
    if (strategy === 'studio' && process.env.COMPARE_COLOUR === '1') {
      const plain = await vision.catalogCheck(cutout, image, { ...target, colourFix: false });
      if (plain.cutout_png_base64) {
        const H = 420;
        const ps = await Promise.all([
          sharp(input).resize({ height: H }).toBuffer(),
          sharp(image).resize({ height: H }).toBuffer(),
          sharp(Buffer.from(plain.cutout_png_base64, 'base64')).resize({ height: H }).flatten({ background: '#5a5a5a' }).toBuffer(),
        ]);
        const ws = await Promise.all(ps.map(async (p) => (await sharp(p).metadata()).width!));
        let xx = 0;
        const cc = ps.map((p, i) => {
          const c = { input: p, left: xx, top: 0 };
          xx += ws[i]! + 6;
          return c;
        });
        await sharp({ create: { width: xx, height: H, channels: 3, background: '#222' } }).composite(cc).jpeg({ quality: 84 }).toFile(join(out, `${id}-${n}.nofix.jpg`));
      }
    }
    const checkMs = Date.now() - t1;
    const cut = check.cutout_png_base64 ? Buffer.from(check.cutout_png_base64, 'base64') : image;
    const H = 420;
    const parts = await Promise.all([
      sharp(input).resize({ height: H }).toBuffer(),
      sharp(image).resize({ height: H }).toBuffer(),
      sharp(cut).resize({ height: H }).flatten({ background: '#5a5a5a' }).toBuffer(),
    ]);
    const widths = await Promise.all(parts.map(async (p) => (await sharp(p).metadata()).width!));
    let x = 0;
    const comp = parts.map((p, i) => {
      const c = { input: p, left: x, top: 0 };
      x += widths[i]! + 6;
      return c;
    });
    await sharp({ create: { width: x, height: H, channels: 3, background: '#222' } }).composite(comp).jpeg({ quality: 84 }).toFile(join(out, `${id}-${n}.jpg`));
    writeFileSync(join(out, `${id}-${n}.png`), image);
    const row = {
      id: `${id}-${n}`,
      subcategory: desc.subcategory,
      name: name?.name ?? null,
      whole: name?.whole ?? null,
      multi,
      analyzeSeconds: +(analyzeMs / 1000).toFixed(1),
      genSeconds: +(genMs / 1000).toFixed(1),
      checkSeconds: +(checkMs / 1000).toFixed(1),
      passed: check.presentation.passed && check.fidelity.passed,
      presentation: check.presentation.passed,
      fidelity: check.fidelity.passed,
      similarity: +check.fidelity.similarity.toFixed(3),
      codes: [...check.presentation.codes, ...check.fidelity.codes],
    };
    rows.push(row);
    console.log(JSON.stringify(row));
  }
}
writeFileSync(join(out, 'results.json'), JSON.stringify({ strategy, backend, canvas, seed: SEED, rows }, null, 2));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
for (const group of [false, true]) {
  const g = rows.filter((r) => r.multi === group);
  console.log(`${strategy}/${backend} ${group ? 'multi ' : 'single'}: ${g.filter((r) => r.passed).length}/${g.length} pass · generation ${mean(g.map((r) => r.genSeconds as number)).toFixed(1)} s mean`);
}
