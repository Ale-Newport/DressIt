/**
 * Writes the studio prompt the API would send for every item of a bench dataset (one folder per item
 * with meta.json, as studio-dataset.ts or the VLM detection bench write them), with the current
 * prompt code, so prompt changes can be tried offline with services/imagegen/mlx/bench.py:
 *
 *   node scripts/studio-prompts.ts <dataset-dir> [prompt-file-name]
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildStudioPrompt, type GarmentDescription } from '../src/modules/catalog-photo/prompt.ts';
import { subcategoryFromName } from '../src/modules/catalog-photo/prompt.ts';
import { getSubcategory } from '@dressit/shared';

const [dir, file = 'prompt.txt'] = process.argv.slice(2);
if (!dir) throw new Error('usage: studio-prompts.ts <dataset-dir> [prompt-file-name]');
let n = 0;
for (const item of readdirSync(dir)) {
  const metaPath = join(dir, item, 'meta.json');
  if (!existsSync(metaPath)) continue;
  const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as {
    multi: boolean;
    bbox: number[] | null;
    desc?: GarmentDescription;
    vlm: { name: string; description: string; visible: string; category: string; attributes?: { length?: string; top_handle?: boolean } | null } | null;
    partial?: boolean;
  };
  const vlm = meta.vlm;
  // As the import does: the type from the model's name when the vocabulary has it.
  const sub = vlm ? subcategoryFromName(vlm.name, vlm.category) : null;
  const def = sub ? getSubcategory(sub) : undefined;
  const desc: GarmentDescription = meta.desc ?? { category: def?.category ?? vlm?.category ?? 'top', subcategory: def?.id ?? 'top', colors: [], pattern: null, materials: [], text: null, brand: null };
  const name = vlm ? { name: vlm.name, category: vlm.category || desc.category } : null;
  const prompt = buildStudioPrompt(desc, { multi: meta.multi && !!meta.bbox, name, description: vlm?.description ?? null, partial: vlm?.visible === 'partial' || !!meta.partial, length: vlm?.attributes?.length ?? null, topHandle: vlm?.attributes?.top_handle ?? null }).prompt;
  writeFileSync(join(dir, item, file), prompt);
  n++;
}
console.log(`${n} prompts → ${dir}/*/${file}`);
