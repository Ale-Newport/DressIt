/**
 * Regenerates the cutouts of garments already in the wardrobe with the current vision service
 * (e.g. after improving background removal). For each garment whose picture is a cutout of an
 * uploaded photo, the original is analysed again — cropped to the detection's box when it came
 * from a multi-garment photo — and the new cutout replaces the old one. Attributes the user sees
 * (type, colours…) are NOT changed; only the picture and its embedding.
 *
 *   pnpm --filter @dressit/api cutouts:refresh [--dry-run] [--user <uuid>] [--keep-old]
 */
import pg from 'pg';
import sharp from 'sharp';
import { loadConfig } from '../src/config.ts';
import type { AppContext } from '../src/context.ts';
import { createDb, withUser } from '../src/db/index.ts';
import { createStorage } from '../src/lib/storage.ts';
import { deleteUserFiles, loadImageBytes, storeCutout } from '../src/modules/images/service.ts';
import { VisionClient } from '../src/modules/vision/client.ts';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const keepOld = args.includes('--keep-old');
const onlyUser = args.includes('--user') ? args[args.indexOf('--user') + 1] : null;

const cfg = loadConfig();
const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) throw new Error('Falta DATABASE_ADMIN_URL');
const { db } = createDb(cfg.DATABASE_URL, 2);
const vision = new VisionClient(cfg.VISION_SERVICE_URL, cfg.VISION_TIMEOUT_MS);
const ctx = { cfg, db, storage: createStorage(cfg), vision } as unknown as AppContext;

const toVector = (v: number[]) => `[${v.join(',')}]`;

/** Crop the original to a normalised box plus 8 % margin (multi-garment photos). */
async function cropTo(body: Buffer, bbox: [number, number, number, number]): Promise<Buffer> {
  const img = sharp(body).rotate();
  const { width = 0, height = 0 } = await img.metadata();
  const [x0, y0, x1, y1] = bbox;
  const pad = 0.08 * Math.max(x1 - x0, y1 - y0);
  const left = Math.max(0, Math.floor((x0 - pad) * width));
  const top = Math.max(0, Math.floor((y0 - pad) * height));
  const right = Math.min(width, Math.ceil((x1 + pad) * width));
  const bottom = Math.min(height, Math.ceil((y1 + pad) * height));
  return img.extract({ left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) }).jpeg({ quality: 92 }).toBuffer();
}

const admin = new pg.Client({ connectionString: adminUrl });
await admin.connect();
let refreshed = 0;
let skipped = 0;
try {
  const { rows } = await admin.query<{ user_id: string; garment_id: string; cutout_id: string; original_id: string; bbox: [number, number, number, number] | null }>(
    `select g.user_id, g.id as garment_id, ci.id as cutout_id, ci.parent_image_id as original_id,
            (select d.bbox from import_detections d where d.cutout_image_id = ci.id
               and (select count(*) from import_detections o where o.job_id = d.job_id and o.image_id = d.image_id) > 1
             limit 1) as bbox
       from garments g
       join garment_images ci on ci.id = g.primary_image_id and ci.kind = 'cutout' and ci.parent_image_id is not null
      where g.status <> 'retired' ${onlyUser ? 'and g.user_id = $1' : ''}
      order by g.user_id, g.created_at`,
    onlyUser ? [onlyUser] : [],
  );
  console.log(`${rows.length} prendas con recorte${dryRun ? ' (simulación: no se guarda nada)' : ''}`);
  for (const r of rows) {
    try {
      const { body, mime } = await withUser(db, r.user_id, (trx) => loadImageBytes(ctx, trx, r.original_id));
      const multi = !!r.bbox;
      const input = multi ? await cropTo(body, r.bbox!) : body;
      const analysis = await vision.analyze(input, multi ? 'image/jpeg' : mime, 'single', 1);
      const item = analysis.items[0];
      if (!item?.cutout_png_base64) {
        skipped++;
        console.log(`  · ${r.garment_id}: sin recorte nuevo, se mantiene el actual`);
        continue;
      }
      if (dryRun) {
        console.log(`  · ${r.garment_id}: se regeneraría (${multi ? 'recortada a su caja' : 'foto completa'})`);
        continue;
      }
      await withUser(db, r.user_id, async (trx) => {
        const cutoutId = await storeCutout(ctx, trx, r.user_id, r.original_id, Buffer.from(item.cutout_png_base64!, 'base64'));
        await trx.updateTable('garment_images').set({ garment_id: r.garment_id }).where('id', '=', cutoutId).execute();
        await trx.updateTable('garments').set({ primary_image_id: cutoutId }).where('id', '=', r.garment_id).execute();
        await trx.updateTable('import_detections').set({ cutout_image_id: cutoutId }).where('cutout_image_id', '=', r.cutout_id).execute();
        if (item.embedding?.length === 768) {
          await trx
            .updateTable('garment_embeddings')
            .set({ embedding: toVector(item.embedding), model: item.embedding_model ?? 'unknown', image_id: cutoutId })
            .where('garment_id', '=', r.garment_id)
            .execute();
        }
        if (!keepOld) {
          const old = await trx.selectFrom('garment_images').select(['storage_key', 'thumb_storage_key']).where('id', '=', r.cutout_id).executeTakeFirst();
          await trx.deleteFrom('garment_images').where('id', '=', r.cutout_id).execute();
          if (old) await deleteUserFiles(ctx, [old.storage_key, old.thumb_storage_key]);
        }
      });
      refreshed++;
      console.log(`  ✓ ${r.garment_id}`);
    } catch (e) {
      skipped++;
      console.log(`  ✗ ${r.garment_id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
} finally {
  await admin.end();
  await db.destroy();
}
console.log(`Regeneradas: ${refreshed}. Sin cambios: ${skipped}.`);
