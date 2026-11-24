/**
 * Runs a generation workflow directly against ComfyUI (no database), to try models and prompts.
 *
 *   node scripts/imagegen-try.ts packshot <photo-crop.jpg> <out.png> <subcategory> [colour family]
 *   node scripts/imagegen-try.ts avatar <face.jpg> <body.jpg> <outfit-board.png> <out.png> "<description>" [workflow=avatar]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { getSubcategory } from '@dressit/shared';
import { ComfyGenerator } from '../src/modules/imagegen/generator.ts';
import { buildPackshotPrompt } from '../src/modules/catalog-photo/prompt.ts';

const [mode, ...rest] = process.argv.slice(2);
const url = process.env.IMAGEGEN_COMFY_URL || 'http://127.0.0.1:8188';
const t0 = Date.now();
if (mode === 'packshot') {
  const [src, out, subcategory = 'camiseta', family] = rest;
  const gen = new ComfyGenerator({ url, timeoutMs: 30 * 60_000, studioWorkflow: 'packshot', avatarWorkflow: 'avatar' });
  const category = getSubcategory(subcategory!)?.category ?? 'top';
  const prompt = buildPackshotPrompt({ category, subcategory: subcategory!, colors: family ? [{ family, share: 1 }] : [], pattern: null, materials: [], text: null, brand: null });
  const photo = await sharp(readFileSync(src!)).rotate().jpeg({ quality: 92 }).toBuffer();
  writeFileSync(out!, await gen.run('packshot', { INPUT_IMAGE: photo }, { PROMPT: prompt.prompt, SEED: 42, WIDTH: 896, HEIGHT: 1120 }));
} else if (mode === 'avatar') {
  const [face, body, board, out, description = 'conjunto', workflow = 'avatar'] = rest;
  const gen = new ComfyGenerator({ url, timeoutMs: 30 * 60_000, studioWorkflow: 'studio', avatarWorkflow: workflow });
  writeFileSync(out!, await gen.avatar({ face: readFileSync(face!), body: readFileSync(body!), outfitBoard: readFileSync(board!), description, seed: 42 }));
} else {
  console.error('Uso: imagegen-try.ts packshot|avatar …');
  process.exit(1);
}
console.log(`listo en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
