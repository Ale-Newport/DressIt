/**
 * Data-retention rules (GDPR storage limitation). Runs as the dressit_maintenance role,
 * which has explicit RLS policies for purging expired rows of every user.
 *
 *  - assistant conversations: 30 days
 *  - suggested/rejected outfits never saved or planned: 30 days (simulations: 7 days)
 *  - completed/failed import jobs: 90 days (images of accepted garments are kept)
 *  - photos never turned into garments: 30 days (visual-search photos: 7 days)
 *  - recommendation events: 365 days
 *  - expired sessions: 7 days after expiry
 */
import type pg from 'pg';
import type { Storage } from '../../lib/storage.ts';

export async function runRetention(client: pg.Client, storage: Storage): Promise<Record<string, number>> {
  const report: Record<string, number> = {};
  const run = async (name: string, sql: string) => {
    const r = await client.query(sql);
    report[name] = r.rowCount ?? 0;
    return r;
  };
  let orphanFiles: Array<{ storage_key: string; thumb_storage_key: string | null }> = [];
  await client.query('begin');
  try {
    await client.query('set local role dressit_maintenance');
    await run('assistant_messages', `delete from assistant_messages where created_at < now() - interval '30 days'`);
    await run('outfits_simulation', `delete from outfits where source = 'simulation' and created_at < now() - interval '7 days'`);
    await run(
      'outfits_unsaved',
      `delete from outfits o where o.status in ('suggested', 'rejected') and not o.is_saved and o.updated_at < now() - interval '30 days'
         and not exists (select 1 from outfit_plans p where p.outfit_id = o.id)`,
    );
    await run('import_jobs', `delete from import_jobs where status in ('completed', 'failed', 'cancelled') and updated_at < now() - interval '90 days'`);
    const orphans = await run(
      'orphan_images',
      `delete from garment_images gi where gi.garment_id is null
         and ((gi.kind = 'visual_search' and gi.created_at < now() - interval '7 days')
           or (gi.kind in ('original', 'cutout', 'receipt', 'label', 'screenshot') and gi.created_at < now() - interval '30 days'
               and not exists (select 1 from import_detections d where (d.image_id = gi.id or d.cutout_image_id = gi.id) and d.state = 'pending')))
       returning storage_key, thumb_storage_key`,
    );
    orphanFiles = orphans.rows as typeof orphanFiles;
    await run('recommendation_events', `delete from recommendation_events where created_at < now() - interval '365 days'`);
    await run('auth_sessions', `delete from auth_sessions where expires_at < now() - interval '7 days'`);
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  }
  for (const row of orphanFiles) {
    await storage.delete(row.storage_key).catch(() => undefined);
    if (row.thumb_storage_key) await storage.delete(row.thumb_storage_key).catch(() => undefined);
  }
  return report;
}
