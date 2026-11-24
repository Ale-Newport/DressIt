import type { Database } from '../../db/index.ts';
import { RETAILERS } from './registry.ts';

/** Upsert the retailer registry into the DB (keeps measured check results). */
export async function syncRetailers(db: Database): Promise<void> {
  for (const r of RETAILERS) {
    await db
      .insertInto('retailers')
      .values({ id: r.id, name: r.name, group_name: r.group, domains: r.domains, website_url: r.website })
      .onConflict((oc) => oc.column('id').doUpdateSet({ name: r.name, group_name: r.group, domains: r.domains, website_url: r.website }))
      .execute();
    for (const i of r.integrations) {
      const values = {
        image_policy: i.imagePolicy,
        capabilities: JSON.stringify(i.capabilities),
        credentials_env: i.credentialsEnv ?? null,
        requires: i.requires ?? null,
        notes: i.notes,
        updated_at: new Date(),
      };
      await db
        .insertInto('retailer_integrations')
        .values({ retailer_id: r.id, kind: i.kind, provider: i.provider, status: i.status, ...values })
        .onConflict((oc) => oc.columns(['retailer_id', 'kind', 'provider']).doUpdateSet(values))
        .execute();
    }
  }
}
