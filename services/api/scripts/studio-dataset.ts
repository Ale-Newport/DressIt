/**
 * Exports what the studio-photo generator receives for every detection of one import, so models and
 * parameters can be compared offline on exactly the same inputs (services/imagegen/mlx/bench.py):
 *
 *   node --env-file=../../.env scripts/studio-dataset.ts <import-job-id> <out-dir> [photo-id …]
 *
 * The photo ids name the import's photos in upload order (as catalog-e2e-bench.ts uploaded them).
 * Writes <out>/<photo>-<n>/{photo.jpg, input.jpg, cutout.png, prompt.txt, meta.json}.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import sharp from 'sharp';
import { loadConfig } from '../src/config.ts';
import { createStorage } from '../src/lib/storage.ts';
import { buildStudioPrompt, type GarmentDescription } from '../src/modules/catalog-photo/prompt.ts';
import { studioInput } from '../src/modules/catalog-photo/service.ts';

const [jobId, out = 'studio-dataset', ...photoIds] = process.argv.slice(2);
if (!jobId) throw new Error('usage: studio-dataset.ts <import-job-id> <out-dir> [photo-id …]');
const cfg = loadConfig();
const storage = createStorage(cfg);
const admin = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
await admin.connect();
const { rows } = await admin.query<{
  id: string;
  image_id: string;
  bbox: [number, number, number, number] | null;
  predicted: Record<string, { value?: string } & Record<string, unknown>>;
  photo_key: string;
  cutout_key: string | null;
  photo_at: Date;
}>(
  `select d.id, d.image_id, d.bbox, d.predicted, p.storage_key as photo_key, c.storage_key as cutout_key, p.created_at as photo_at
     from import_detections d
     join garment_images p on p.id = d.image_id
     left join garment_images c on c.id = d.cutout_image_id
    where d.job_id = $1
    order by p.created_at, d.created_at, d.id`,
  [jobId],
);
await admin.end();
const images = [...new Set(rows.map((r) => r.image_id))];
let k = 0;
for (const [i, imageId] of images.entries()) {
  const photoId = photoIds[i] ?? `photo${i}`;
  const dets = rows.filter((r) => r.image_id === imageId);
  const photo = await sharp((await storage.get(dets[0]!.photo_key))!).rotate().jpeg({ quality: 92 }).toBuffer();
  for (const [n, d] of dets.entries()) {
    const dir = join(out, `${photoId}-${n}`);
    mkdirSync(dir, { recursive: true });
    const p = d.predicted as unknown as {
      category?: { value: string };
      subcategory?: { value: string };
      colors?: Array<{ family: string; share: number }>;
      pattern?: { value: string };
      vlm?: { name: string; nameEs: string; description: string; visible: string; category: string };
    };
    const desc: GarmentDescription = { category: p.category?.value ?? 'top', subcategory: p.subcategory?.value ?? 'top', colors: p.colors ?? [], pattern: p.pattern?.value ?? null, materials: [], text: null, brand: null };
    const multi = dets.length > 1;
    const vlm = p.vlm ?? null;
    const name = vlm ? { name: vlm.name, category: vlm.category || desc.category } : null;
    const partial = vlm?.visible === 'partial';
    const prompt = buildStudioPrompt(desc, { multi: multi && !!d.bbox, name, description: vlm?.description ?? null, partial }).prompt;
    writeFileSync(join(dir, 'photo.jpg'), photo);
    writeFileSync(join(dir, 'input.jpg'), await studioInput(photo, d.bbox, multi));
    if (d.cutout_key) writeFileSync(join(dir, 'cutout.png'), (await storage.get(d.cutout_key))!);
    writeFileSync(join(dir, 'prompt.txt'), prompt);
    writeFileSync(join(dir, 'meta.json'), JSON.stringify({ detection: d.id, photo: photoId, n, multi, bbox: d.bbox, desc, vlm, partial }, null, 2));
    k++;
  }
}
console.log(`${k} detections from ${images.length} photos → ${out}`);
