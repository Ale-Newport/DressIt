/**
 * Runs a generation workflow directly against ComfyUI (no database), to try models and prompts.
 *
 *   node scripts/imagegen-try.ts studio <cutout.png> <out.png> "<description>" [workflow=studio]
 *   node scripts/imagegen-try.ts avatar <face.jpg> <body.jpg> <outfit-board.png> <out.png> "<description>" [workflow=avatar]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { ComfyGenerator } from '../src/modules/imagegen/generator.ts';

const [mode, ...rest] = process.argv.slice(2);
const url = process.env.IMAGEGEN_COMFY_URL || 'http://127.0.0.1:8188';
const t0 = Date.now();
if (mode === 'studio') {
  const [src, out, description = 'prenda', workflow = 'studio'] = rest;
  const gen = new ComfyGenerator({ url, timeoutMs: 30 * 60_000, studioWorkflow: workflow, avatarWorkflow: 'avatar' });
  const onWhite = await sharp(readFileSync(src!)).flatten({ background: '#ffffff' }).extend({ top: 48, bottom: 48, left: 48, right: 48, background: '#ffffff' }).png().toBuffer();
  writeFileSync(out!, await gen.studio({ cutoutPng: onWhite, description, seed: 42 }));
} else if (mode === 'avatar') {
  const [face, body, board, out, description = 'conjunto', workflow = 'avatar'] = rest;
  const gen = new ComfyGenerator({ url, timeoutMs: 30 * 60_000, studioWorkflow: 'studio', avatarWorkflow: workflow });
  writeFileSync(out!, await gen.avatar({ face: readFileSync(face!), body: readFileSync(body!), outfitBoard: readFileSync(board!), description, seed: 42 }));
} else {
  console.error('Uso: imagegen-try.ts studio|avatar …');
  process.exit(1);
}
console.log(`listo en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
