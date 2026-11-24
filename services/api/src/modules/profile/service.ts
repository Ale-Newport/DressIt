import { STYLES, type ConsentDto, type ConsentKind, type PreferencesDto, type StyleId, type StyleProfileDto } from '@dressit/shared';
import { DEFAULT_WEIGHTS, FEATURES } from '@dressit/stylist-engine';
import type { AppContext } from '../../context.ts';
import { withUser, type Tx } from '../../db/index.ts';
import { audit } from '../../lib/audit.ts';
import { badRequest, unauthorized } from '../../lib/errors.ts';
import { deleteUserFiles } from '../images/service.ts';
import { verifyUserPassword } from '../auth/service.ts';

export const CONSENT_VERSION = '2026-11';
const CONSENT_KINDS: ConsentKind[] = ['terms', 'privacy', 'photo_processing', 'location', 'calendar', 'email_import', 'ai_assistant_external', 'analytics', 'marketing'];

export async function getPreferences(trx: Tx, userId: string): Promise<PreferencesDto> {
  let p = await trx.selectFrom('user_preferences').selectAll().where('user_id', '=', userId).executeTakeFirst();
  if (!p) {
    await trx.insertInto('user_preferences').values({ user_id: userId }).execute();
    p = await trx.selectFrom('user_preferences').selectAll().where('user_id', '=', userId).executeTakeFirstOrThrow();
  }
  const pr = p.priorities as Record<string, number>;
  return {
    preferredStyles: p.preferred_styles as StyleId[],
    favoriteColors: p.favorite_colors,
    avoidedColors: p.avoided_colors,
    fitPreferences: p.fit_preferences as PreferencesDto['fitPreferences'],
    sizes: p.sizes as PreferencesDto['sizes'],
    favoriteBrands: p.favorite_brands,
    budget: { minEur: p.budget_min_eur, maxEur: p.budget_max_eur },
    sustainability: { secondHand: p.second_hand, prioritizeSustainable: p.prioritize_sustainable },
    usualContexts: p.usual_contexts,
    priorities: { comfort: pr.comfort ?? 0.34, elegance: pr.elegance ?? 0.33, practicality: pr.practicality ?? 0.33 },
    dayWindow: { start: p.day_start.slice(0, 5), end: p.day_end.slice(0, 5) },
    temperatureSensitivity: p.temperature_sensitivity,
  };
}

export async function updatePreferences(trx: Tx, userId: string, patch: Partial<PreferencesDto>): Promise<PreferencesDto> {
  const set: Record<string, unknown> = {};
  if (patch.preferredStyles) {
    if (patch.preferredStyles.some((s) => !STYLES.includes(s))) throw badRequest('Estilo no válido.');
    set.preferred_styles = [...new Set(patch.preferredStyles)];
  }
  if (patch.favoriteColors) set.favorite_colors = [...new Set(patch.favoriteColors)];
  if (patch.avoidedColors) set.avoided_colors = [...new Set(patch.avoidedColors)];
  if (patch.fitPreferences) set.fit_preferences = JSON.stringify(patch.fitPreferences);
  if (patch.sizes) set.sizes = JSON.stringify(patch.sizes);
  if (patch.favoriteBrands) set.favorite_brands = [...new Set(patch.favoriteBrands.map((b) => b.trim()).filter(Boolean))].slice(0, 30);
  if (patch.budget) {
    set.budget_min_eur = patch.budget.minEur;
    set.budget_max_eur = patch.budget.maxEur;
  }
  if (patch.sustainability) {
    set.second_hand = patch.sustainability.secondHand;
    set.prioritize_sustainable = patch.sustainability.prioritizeSustainable;
  }
  if (patch.usualContexts) set.usual_contexts = [...new Set(patch.usualContexts)];
  if (patch.priorities) {
    const total = patch.priorities.comfort + patch.priorities.elegance + patch.priorities.practicality;
    if (total <= 0) throw badRequest('Las prioridades deben sumar más de 0.');
    set.priorities = JSON.stringify({ comfort: patch.priorities.comfort / total, elegance: patch.priorities.elegance / total, practicality: patch.priorities.practicality / total });
  }
  if (patch.dayWindow) set.day_start = patch.dayWindow.start;
  if (patch.dayWindow) set.day_end = patch.dayWindow.end;
  if (patch.temperatureSensitivity !== undefined) set.temperature_sensitivity = Math.max(-2, Math.min(2, Math.round(patch.temperatureSensitivity)));
  if (Object.keys(set).length) await trx.updateTable('user_preferences').set(set).where('user_id', '=', userId).execute();
  return getPreferences(trx, userId);
}

export async function listConsents(trx: Tx): Promise<ConsentDto[]> {
  const rows = await trx.selectFrom('consents').selectAll().orderBy('created_at', 'desc').execute();
  return CONSENT_KINDS.map((kind) => {
    const r = rows.find((x) => x.kind === kind);
    return { kind, granted: r?.granted ?? false, version: r?.version ?? CONSENT_VERSION, updatedAt: r?.created_at.toISOString() ?? null };
  });
}

export async function setConsent(trx: Tx, userId: string, kind: ConsentKind, granted: boolean): Promise<ConsentDto> {
  if (!CONSENT_KINDS.includes(kind)) throw badRequest('Tipo de consentimiento no válido.');
  if ((kind === 'terms' || kind === 'privacy') && !granted) throw badRequest('Para retirar la aceptación de los términos o la política de privacidad, elimina tu cuenta.');
  const row = await trx.insertInto('consents').values({ user_id: userId, kind, granted, version: CONSENT_VERSION }).returningAll().executeTakeFirstOrThrow();
  await audit(trx, userId, granted ? 'consent.granted' : 'consent.revoked', { type: 'consent', id: kind });
  if (kind === 'calendar' && !granted) await trx.deleteFrom('calendar_events').where('source', '=', 'device').execute();
  if (kind === 'location' && !granted) await trx.updateTable('users').set({ location_lat: null, location_lon: null, location_name: null }).where('id', '=', userId).execute();
  return { kind, granted: row.granted, version: row.version, updatedAt: row.created_at.toISOString() };
}

export async function styleProfile(trx: Tx): Promise<StyleProfileDto> {
  const sp = await trx.selectFrom('style_profiles').selectAll().executeTakeFirst();
  const sw = (sp?.style_weights ?? {}) as Record<string, number>;
  const cw = (sp?.color_weights ?? {}) as Record<string, number>;
  const rw = (sp?.ranking_weights ?? {}) as Record<string, number>;
  return {
    feedbackCount: sp?.feedback_count ?? 0,
    topStyles: Object.entries(sw).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([style, weight]) => ({ style: style as StyleId, weight: Math.round(weight * 100) / 100 })),
    topColors: Object.entries(cw).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([family, weight]) => ({ family, weight: Math.round(weight * 100) / 100 })),
    rankingWeights: Object.fromEntries(FEATURES.map((f) => [f, Math.round((rw[f] ?? DEFAULT_WEIGHTS[f]) * 100) / 100])),
    updatedAt: sp?.updated_at.toISOString() ?? null,
  };
}

/** GDPR art. 15/20: everything we hold about the user, machine-readable. */
export async function exportData(trx: Tx, userId: string): Promise<Record<string, unknown>> {
  const tables = [
    'user_preferences', 'style_profiles', 'consents', 'wardrobes', 'wardrobe_spaces', 'garments', 'garment_images', 'garment_attributes', 'garment_availability',
    'tags', 'garment_tags', 'import_sources', 'import_jobs', 'import_detections', 'imported_products', 'outfits', 'outfit_items', 'outfit_ratings',
    'outfit_usage_history', 'calendar_events', 'outfit_plans', 'trips', 'trip_items', 'wishlists', 'wishlist_items', 'purchases',
    'recommendation_events', 'assistant_messages', 'audit_events',
  ] as const;
  const out: Record<string, unknown> = {
    exportedAt: new Date().toISOString(),
    format: 'dressit-export/1',
    notes: 'Las imágenes se referencian por su clave de almacenamiento; los vectores de embeddings se omiten por tamaño.',
    user: await trx.selectFrom('users').selectAll().where('id', '=', userId).executeTakeFirst(),
  };
  for (const t of tables) {
    const rows = await trx.selectFrom(t).selectAll().execute();
    out[t] = t === 'import_detections' ? rows.map((r) => ({ ...r, embedding: undefined })) : rows;
  }
  await audit(trx, userId, 'privacy.export');
  return out;
}

/** GDPR art. 17: permanent deletion of the account, its data and stored files. */
export async function deleteAccount(ctx: AppContext, userId: string, password: string): Promise<void> {
  if (!(await verifyUserPassword(ctx, userId, password))) throw unauthorized('Contraseña incorrecta.');
  const keys = await withUser(ctx.db, userId, async (trx) => {
    const imgs = await trx.selectFrom('garment_images').select(['storage_key', 'thumb_storage_key']).execute();
    await audit(trx, null, 'user.deleted', undefined, { at: new Date().toISOString() });
    await trx.deleteFrom('users').where('id', '=', userId).execute(); // cascades to every personal table
    return imgs.flatMap((i) => [i.storage_key, i.thumb_storage_key]);
  });
  await deleteUserFiles(ctx, keys);
}
