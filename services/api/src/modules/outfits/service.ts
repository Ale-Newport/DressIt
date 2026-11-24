import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import {
  getOccasion,
  type DayWeatherDto,
  type FeedbackRequest,
  type GarmentDto,
  type OccasionDef,
  type OutfitDto,
  type OutfitSlot,
  type RecommendationRequest,
  type RecommendationResponse,
  type StyleId,
  type UsageHistoryDto,
} from '@dressit/shared';
import {
  applyFeedback,
  emptyModel,
  evaluateOutfit,
  flatLayLayout,
  generateOutfits,
  hashString,
  rankAlternatives,
  seasonOf,
  type DayConditions,
  type EngineContext,
  type EngineGarment,
  type EngineHistory,
  type EngineProfile,
  type FeatureVector,
  type LearnedModel,
  type OutfitCandidate,
  type ScoredOutfit,
  type Slot,
} from '@dressit/stylist-engine';
import type { AppContext } from '../../context.ts';
import type { Tx } from '../../db/index.ts';
import { AppError, badRequest, notFound } from '../../lib/errors.ts';
import { engineDuration, businessEvents } from '../../lib/metrics.ts';
import type { UrlSigner } from '../../lib/signing.ts';
import { toConditions } from '../weather/service.ts';
import { garmentSelect, loadEngineWardrobe, logWear } from '../wardrobe/service.ts';
import { toGarmentDto, type GarmentRow } from '../wardrobe/mappers.ts';

export function todayIn(tz: string, offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function hourIn(tz: string): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(new Date()));
}

export async function loadProfile(trx: Tx, userId: string): Promise<{ profile: EngineProfile; prefs: Awaited<ReturnType<typeof loadPrefs>> }> {
  const prefs = await loadPrefs(trx, userId);
  const sp = await trx.selectFrom('style_profiles').selectAll().where('user_id', '=', userId).executeTakeFirst();
  const learned: LearnedModel = sp
    ? {
        ...emptyModel(),
        weights: (sp.ranking_weights as Record<string, number>) ?? {},
        bias: Number((sp.ranking_weights as Record<string, number>)?.__bias ?? 0),
        styleWeights: sp.style_weights as Record<string, number>,
        colorWeights: sp.color_weights as Record<string, number>,
        itemAffinity: sp.item_affinity as Record<string, number>,
        pairAffinity: sp.pair_affinity as Record<string, number>,
        feedbackCount: sp.feedback_count,
      }
    : emptyModel();
  delete (learned.weights as Record<string, number>).__bias;
  const pr = prefs.priorities as { comfort?: number; elegance?: number; practicality?: number };
  return {
    prefs,
    profile: {
      preferredStyles: prefs.preferred_styles as StyleId[],
      favoriteColors: prefs.favorite_colors,
      avoidedColors: prefs.avoided_colors,
      fitPreferences: prefs.fit_preferences as EngineProfile['fitPreferences'],
      priorities: { comfort: pr.comfort ?? 0.34, elegance: pr.elegance ?? 0.33, practicality: pr.practicality ?? 0.33 },
      learned,
    },
  };
}

async function loadPrefs(trx: Tx, userId: string) {
  const p = await trx.selectFrom('user_preferences').selectAll().where('user_id', '=', userId).executeTakeFirst();
  if (p) return p;
  await trx.insertInto('user_preferences').values({ user_id: userId }).onConflict((oc) => oc.doNothing()).execute();
  return trx.selectFrom('user_preferences').selectAll().where('user_id', '=', userId).executeTakeFirstOrThrow();
}

export async function saveLearned(trx: Tx, userId: string, model: LearnedModel) {
  const values = {
    ranking_weights: JSON.stringify({ ...model.weights, __bias: model.bias }),
    style_weights: JSON.stringify(model.styleWeights),
    color_weights: JSON.stringify(model.colorWeights),
    item_affinity: JSON.stringify(model.itemAffinity),
    pair_affinity: JSON.stringify(model.pairAffinity),
    feedback_count: model.feedbackCount,
    updated_at: new Date(),
  };
  await trx
    .insertInto('style_profiles')
    .values({ user_id: userId, ...values })
    .onConflict((oc) => oc.column('user_id').doUpdateSet(values))
    .execute();
}

export async function loadHistory(trx: Tx, date: string): Promise<EngineHistory> {
  const from = new Date(Date.parse(`${date}T00:00:00Z`) - 21 * 86_400_000).toISOString().slice(0, 10);
  const wear = await trx.selectFrom('outfit_usage_history').select(['worn_on', 'garment_ids']).where('worn_on', '>=', from).where('worn_on', '<=', date).execute();
  const rejected = await trx
    .selectFrom('outfits')
    .select('signature')
    .where('status', '=', 'rejected')
    .where('updated_at', '>=', new Date(Date.now() - 30 * 86_400_000))
    .execute();
  return { recentWear: wear.map((w) => ({ date: w.worn_on, garmentIds: w.garment_ids })), rejectedSignatures: new Set(rejected.map((r) => r.signature)) };
}

export interface BuiltContext {
  engine: EngineContext;
  weather: DayWeatherDto | null;
  weatherError: string | null;
  occasion: OccasionDef;
  profile: EngineProfile;
  history: EngineHistory;
  user: { displayName: string; timezone: string };
  eventId: string | null;
}

interface StoredContext {
  date: string;
  occasion: string;
  weather: DayConditions | null;
  season: string;
  indoorShare: number;
  adjustments: EngineContext['adjustments'];
  temperatureSensitivity: number;
}

export async function buildContext(app: AppContext, trx: Tx, userId: string, req: RecommendationRequest): Promise<BuiltContext> {
  const user = await trx.selectFrom('users').selectAll().where('id', '=', userId).executeTakeFirstOrThrow();
  const { profile, prefs } = await loadProfile(trx, userId);
  const date = req.date ?? todayIn(user.timezone);
  let event: { id: string; occasion: string | null; is_outdoor: boolean | null } | undefined;
  if (req.eventId) {
    event = await trx.selectFrom('calendar_events').select(['id', 'occasion', 'is_outdoor']).where('id', '=', req.eventId).executeTakeFirst();
    if (!event) throw notFound('Evento');
  } else if (!req.occasion) {
    event = await trx
      .selectFrom('calendar_events')
      .select(['id', 'occasion', 'is_outdoor'])
      .where('occasion', 'is not', null)
      .where(sql<boolean>`(starts_at at time zone ${user.timezone})::date = ${date}::date`)
      .orderBy('starts_at')
      .executeTakeFirst();
  }
  const occasionId = req.occasion ?? event?.occasion ?? prefs.usual_contexts[0] ?? 'dia_informal';
  const occasion = getOccasion(occasionId);
  if (!occasion) throw badRequest(`Ocasión desconocida: ${occasionId}`);
  const window = req.dayWindow ?? { start: prefs.day_start.slice(0, 5), end: prefs.day_end.slice(0, 5) };
  let weather: DayWeatherDto | null = null;
  let weatherError: string | null = null;
  if (user.location_lat !== null && user.location_lon !== null) {
    try {
      weather = await app.weather.day({ lat: Number(user.location_lat), lon: Number(user.location_lon), locationName: user.location_name ?? '', date, window });
    } catch (e) {
      weatherError = e instanceof AppError ? e.message : 'No se pudo obtener el tiempo.';
    }
  } else {
    weatherError = 'Configura tu ciudad en el perfil para tener en cuenta el tiempo.';
  }
  const indoorShare = req.indoorShare ?? (event?.is_outdoor === true ? 0.2 : event?.is_outdoor === false ? 0.9 : occasion.indoorShare);
  const engine: EngineContext = {
    date,
    occasion,
    weather: weather ? toConditions(weather) : null,
    season: seasonOf(date),
    indoorShare,
    adjustments: { formality: req.adjustments?.formality ?? 0, warmth: req.adjustments?.warmth ?? 0, elegance: req.adjustments?.elegance ?? 0 },
    mustInclude: req.mustInclude ?? [],
    exclude: new Set(req.exclude ?? []),
    excludeSubcategories: new Set(req.excludeSubcategories ?? []),
    temperatureSensitivity: prefs.temperature_sensitivity,
  };
  return { engine, weather, weatherError, occasion, profile, history: await loadHistory(trx, date), user: { displayName: user.display_name, timezone: user.timezone }, eventId: event?.id ?? null };
}

function storedContext(c: EngineContext): StoredContext {
  return { date: c.date, occasion: c.occasion.id, weather: c.weather, season: c.season, indoorShare: c.indoorShare, adjustments: c.adjustments, temperatureSensitivity: c.temperatureSensitivity };
}

function restoreContext(s: StoredContext): EngineContext {
  return {
    date: s.date,
    occasion: getOccasion(s.occasion) ?? getOccasion('dia_informal')!,
    weather: s.weather,
    season: s.season as EngineContext['season'],
    indoorShare: s.indoorShare,
    adjustments: s.adjustments,
    mustInclude: [],
    exclude: new Set(),
    excludeSubcategories: new Set(),
    temperatureSensitivity: s.temperatureSensitivity ?? 0,
  };
}

async function persistOutfit(trx: Tx, userId: string, o: ScoredOutfit, c: EngineContext, source: OutfitDto['source'], requestId: string | null, name: string | null = null): Promise<string> {
  const layout = flatLayLayout(o);
  const row = await trx
    .insertInto('outfits')
    .values({
      user_id: userId,
      name,
      source,
      status: source === 'manual' ? 'saved' : 'suggested',
      is_saved: source === 'manual',
      occasion: c.occasion.id,
      signature: o.signature,
      score: Math.round(o.score * 10000) / 10000,
      breakdown: JSON.stringify({ ...o.features, __formality: o.formality, __styleMatch: o.styleMatch }),
      features: JSON.stringify(o.features),
      explanation: JSON.stringify(o.explanation),
      weather_note: o.weatherNote,
      context: JSON.stringify(storedContext(c)),
      layout: JSON.stringify(layout),
      is_exploration: o.isExploration,
      request_id: requestId,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await trx
    .insertInto('outfit_items')
    .values(
      o.items.map((i, idx) => ({
        user_id: userId,
        outfit_id: row.id,
        slot: i.slot,
        position: idx,
        garment_id: i.garment.isCandidate ? null : i.garment.id,
        catalog_product_id: i.garment.isCandidate && i.garment.id.startsWith('catalog:') ? i.garment.id.slice(8) : null,
        imported_product_id: i.garment.isCandidate && i.garment.id.startsWith('imported:') ? i.garment.id.slice(9) : null,
      })),
    )
    .execute();
  return row.id;
}

export async function loadOutfitDtos(trx: Tx, signer: UrlSigner, ids: string[], candidateProducts: Map<string, OutfitDto['items'][number]['candidateProduct']> = new Map()): Promise<OutfitDto[]> {
  if (!ids.length) return [];
  const outfits = await trx.selectFrom('outfits').selectAll().where('id', 'in', ids).execute();
  const items = await trx.selectFrom('outfit_items').selectAll().where('outfit_id', 'in', ids).orderBy('position').execute();
  const garmentIds = [...new Set(items.map((i) => i.garment_id).filter((x): x is string => !!x))];
  const garments = new Map<string, GarmentDto>();
  if (garmentIds.length) {
    const rows = (await garmentSelect(trx).where('g.id', 'in', garmentIds).execute()) as GarmentRow[];
    for (const r of rows) garments.set(r.id, toGarmentDto(r, signer));
  }
  const byId = new Map(outfits.map((o) => [o.id, o]));
  return ids
    .map((id) => byId.get(id))
    .filter((o): o is NonNullable<typeof o> => !!o)
    .map((o) => {
      const f = o.breakdown as Record<string, number>;
      return {
        id: o.id,
        name: o.name,
        items: items
          .filter((i) => i.outfit_id === o.id)
          .map((i) => ({
            slot: i.slot as OutfitSlot,
            garment: i.garment_id ? (garments.get(i.garment_id) ?? null) : null,
            candidateProduct: i.catalog_product_id ? (candidateProducts.get(`catalog:${i.catalog_product_id}`) ?? null) : i.imported_product_id ? (candidateProducts.get(`imported:${i.imported_product_id}`) ?? null) : null,
          })),
        occasion: o.occasion,
        score: Number(o.score),
        breakdown: {
          total: Number(o.score),
          color: f.color ?? 0,
          style: f.style ?? 0,
          formality: f.formality ?? 0,
          weather: f.weather ?? 0,
          material: f.material ?? 0,
          silhouette: f.silhouette ?? 0,
          personal: f.personal ?? 0,
          rotation: f.rotation ?? 0,
        },
        explanation: o.explanation as string[],
        weatherNote: o.weather_note,
        formality: f.__formality ?? estimateFormality(items.filter((i) => i.outfit_id === o.id).map((i) => (i.garment_id ? garments.get(i.garment_id)?.formality : undefined))),
        styleMatch: f.__styleMatch ?? f.personal ?? 0,
        isExploration: o.is_exploration,
        isSaved: o.is_saved,
        isFavorite: o.is_favorite,
        status: o.status as OutfitDto['status'],
        source: o.source as OutfitDto['source'],
        layout: o.layout as OutfitDto['layout'],
        createdAt: o.created_at.toISOString(),
      };
    });
}

function estimateFormality(values: Array<number | undefined>): number {
  const v = values.filter((x): x is number => typeof x === 'number');
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : 0;
}

function greeting(name: string, tz: string, weather: DayWeatherDto | null, occasion: OccasionDef, date: string, today: string): string {
  const h = hourIn(tz);
  const hello = h < 13 ? 'Buenos días' : h < 21 ? 'Buenas tardes' : 'Buenas noches';
  const first = name.split(' ')[0];
  const day = date === today ? 'Hoy' : date === todayIn(tz, 1) ? 'Mañana' : `El ${new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`))}`;
  const w = weather ? ` ${weather.summary.replace(/^Hoy/, day)}` : '';
  return `${hello}, ${first}.${w} Para ${occasion.label.toLowerCase()} te recomiendo estos conjuntos.`;
}

export async function recommend(app: AppContext, trx: Tx, userId: string, req: RecommendationRequest): Promise<RecommendationResponse> {
  const built = await buildContext(app, trx, userId, req);
  const wardrobe = await loadEngineWardrobe(trx, { statuses: ['available'], withEmbeddings: false });
  const count = Math.min(Math.max(req.count ?? 4, 1), 8);
  const seed = req.seed ?? hashString(`${userId}:${built.engine.date}:${built.occasion.id}:${JSON.stringify(req.adjustments ?? {})}:${Date.now() >> 16}`);
  const end = engineDuration.startTimer({ operation: 'generate' });
  const result = generateOutfits(wardrobe, built.engine, built.profile, built.history, { count, seed });
  end();
  const requestId = randomUUID();
  const ids: string[] = [];
  for (const o of result.outfits) ids.push(await persistOutfit(trx, userId, o, built.engine, 'generated', requestId));
  if (ids.length) {
    await trx
      .insertInto('recommendation_events')
      .values(ids.map((id, rank) => ({ user_id: userId, kind: 'impression', request_id: requestId, outfit_id: id, context: JSON.stringify({ rank, occasion: built.occasion.id, date: built.engine.date, seed, adjustments: req.adjustments ?? null }) })))
      .execute();
  }
  businessEvents.inc({ event: 'recommendation', outcome: ids.length ? 'ok' : 'empty' });
  const warnings = [...result.warnings];
  if (wardrobe.length === 0) warnings.unshift('Tu armario está vacío o no tiene prendas disponibles. Añade prendas para recibir conjuntos.');
  return {
    requestId,
    greeting: greeting(built.user.displayName, built.user.timezone, built.weather, built.occasion, built.engine.date, todayIn(built.user.timezone)),
    weather: built.weather,
    weatherError: built.weatherError,
    occasion: { id: built.occasion.id, label: built.occasion.label },
    outfits: await loadOutfitDtos(trx, app.signer, ids),
    warnings,
  };
}

async function loadOutfitCandidate(trx: Tx, outfitId: string): Promise<{ row: { id: string; context: StoredContext; features: FeatureVector; signature: string; status: string }; candidate: OutfitCandidate; all: EngineGarment[] }> {
  const row = await trx.selectFrom('outfits').select(['id', 'context', 'features', 'signature', 'status']).where('id', '=', outfitId).executeTakeFirst();
  if (!row) throw notFound('Conjunto');
  const items = await trx.selectFrom('outfit_items').selectAll().where('outfit_id', '=', outfitId).orderBy('position').execute();
  if (items.some((i) => !i.garment_id)) throw badRequest('Este conjunto incluye un producto simulado; no se puede modificar así.');
  const all = await loadEngineWardrobe(trx, { statuses: ['available', 'laundry', 'lent', 'stored', 'retired'] });
  const byId = new Map(all.map((g) => [g.id, g]));
  const candidate: OutfitCandidate = {
    items: items.map((i) => {
      const g = byId.get(i.garment_id!);
      if (!g) throw notFound('Prenda del conjunto');
      return { slot: i.slot as Slot, garment: g };
    }),
  };
  return { row: { ...row, context: row.context as unknown as StoredContext, features: row.features as unknown as FeatureVector }, candidate, all };
}

export async function alternatives(app: AppContext, trx: Tx, userId: string, outfitId: string, slot: string) {
  const { row, candidate, all } = await loadOutfitCandidate(trx, outfitId);
  const c = restoreContext(row.context);
  const { profile } = await loadProfile(trx, userId);
  const history = await loadHistory(trx, c.date);
  const available = all.filter((g) => g.wearCount >= 0 && g.id) as EngineGarment[];
  const statusRows = await trx.selectFrom('garments').select(['id', 'status']).execute();
  const status = new Map(statusRows.map((r) => [r.id, r.status]));
  const pool = available.filter((g) => status.get(g.id) === 'available');
  const ranked = rankAlternatives(candidate, slot as Slot, pool, c, profile, history, 10);
  const ids = ranked.map((r) => r.garment.id);
  const rows = ids.length ? ((await garmentSelect(trx).where('g.id', 'in', ids).execute()) as GarmentRow[]) : [];
  const dtos = new Map(rows.map((r) => [r.id, toGarmentDto(r, app.signer)]));
  const currentId = candidate.items.find((i) => i.slot === slot)?.garment.id;
  const current = currentId ? ((await garmentSelect(trx).where('g.id', '=', currentId).executeTakeFirst()) as GarmentRow | undefined) : undefined;
  return {
    slot: slot as OutfitSlot,
    current: current ? toGarmentDto(current, app.signer) : null,
    alternatives: ranked.map((r) => ({
      garment: dtos.get(r.garment.id)!,
      score: Math.round(r.outfit.score * 1000) / 1000,
      delta: Math.round(r.delta * 1000) / 1000,
      reason: r.delta >= 0 ? (r.outfit.explanation[0] ?? 'Encaja bien con el resto del conjunto.') : 'Alternativa válida, algo menos armoniosa.',
    })),
  };
}

export async function swap(app: AppContext, trx: Tx, userId: string, outfitId: string, slot: string, garmentId: string | null): Promise<OutfitDto> {
  const { row, candidate, all } = await loadOutfitCandidate(trx, outfitId);
  const c = restoreContext(row.context);
  const current = candidate.items.find((i) => i.slot === slot);
  let items = candidate.items;
  if (garmentId === null) {
    if (!['outer', 'mid'].includes(slot) && !slot.startsWith('accessory:')) throw badRequest('Solo se pueden quitar capas o complementos.');
    items = items.filter((i) => i.slot !== slot);
  } else {
    const g = all.find((x) => x.id === garmentId);
    if (!g) throw notFound('Prenda');
    const st = await trx.selectFrom('garments').select('status').where('id', '=', garmentId).executeTakeFirstOrThrow();
    if (st.status !== 'available') throw badRequest('Esa prenda no está disponible ahora mismo.');
    const layerOk = slot.startsWith('accessory:') ? g.layer === 'accessory' && `accessory:${g.accessorySlot}` === slot : slot === 'base' ? g.layer === 'base' || (g.layer === 'mid' && g.wearableAlone) : g.layer === slot;
    if (!layerOk) throw badRequest('Esa prenda no encaja en esa posición del conjunto.');
    items = current ? items.map((i) => (i.slot === slot ? { slot: slot as Slot, garment: g } : i)) : [...items, { slot: slot as Slot, garment: g }];
  }
  const { profile } = await loadProfile(trx, userId);
  const history = await loadHistory(trx, c.date);
  const scored = evaluateOutfit({ items }, c, profile, history);
  await trx.deleteFrom('outfit_items').where('outfit_id', '=', outfitId).execute();
  await trx
    .insertInto('outfit_items')
    .values(scored.items.map((i, idx) => ({ user_id: userId, outfit_id: outfitId, slot: i.slot, position: idx, garment_id: i.garment.id })))
    .execute();
  await trx
    .updateTable('outfits')
    .set({ signature: scored.signature, score: Math.round(scored.score * 10000) / 10000, breakdown: JSON.stringify({ ...scored.features, __formality: scored.formality, __styleMatch: scored.styleMatch }), features: JSON.stringify(scored.features), explanation: JSON.stringify(scored.explanation), weather_note: scored.weatherNote, layout: JSON.stringify(flatLayLayout(scored)) })
    .where('id', '=', outfitId)
    .execute();
  if (current && garmentId) {
    const model = applyFeedback(profile.learned, scored, null, { kind: 'swap', removedId: current.garment.id, addedId: garmentId });
    await saveLearned(trx, userId, model);
  }
  await trx.insertInto('recommendation_events').values({ user_id: userId, kind: 'swap', outfit_id: outfitId, garment_id: garmentId, context: JSON.stringify({ slot, removed: current?.garment.id ?? null }) }).execute();
  return (await loadOutfitDtos(trx, app.signer, [outfitId]))[0]!;
}

export async function feedback(app: AppContext, trx: Tx, userId: string, outfitId: string, body: FeedbackRequest): Promise<OutfitDto> {
  const { row, candidate } = await loadOutfitCandidate(trx, outfitId);
  const { profile } = await loadProfile(trx, userId);
  const set: Record<string, unknown> = {};
  let signal: Parameters<typeof applyFeedback>[3] | null = null;
  switch (body.action) {
    case 'accept':
      set.status = 'accepted';
      set.is_saved = true;
      signal = { kind: 'accept' };
      break;
    case 'reject':
      set.status = 'rejected';
      signal = { kind: 'reject' };
      break;
    case 'save':
      set.is_saved = true;
      if (row.status === 'suggested') set.status = 'saved';
      signal = { kind: 'save' };
      break;
    case 'unsave':
      set.is_saved = false;
      set.is_favorite = false;
      break;
    case 'favorite':
      set.is_favorite = true;
      set.is_saved = true;
      signal = { kind: 'save' };
      break;
    case 'unfavorite':
      set.is_favorite = false;
      break;
    case 'rate':
      if (!body.rating || body.rating < 1 || body.rating > 5) throw badRequest('La valoración debe estar entre 1 y 5.');
      await trx.insertInto('outfit_ratings').values({ user_id: userId, outfit_id: outfitId, rating: body.rating, reasons: body.reasons ?? [] }).execute();
      signal = { kind: 'rate', rating: body.rating };
      break;
  }
  if (Object.keys(set).length) await trx.updateTable('outfits').set(set).where('id', '=', outfitId).execute();
  if (signal) {
    const model = applyFeedback(profile.learned, candidate, row.features, signal);
    await saveLearned(trx, userId, model);
  }
  const kind = body.action === 'favorite' ? 'favorite' : body.action === 'unfavorite' || body.action === 'unsave' ? 'unsave' : body.action;
  await trx.insertInto('recommendation_events').values({ user_id: userId, kind, outfit_id: outfitId, features: JSON.stringify(row.features), context: JSON.stringify({ reasons: body.reasons ?? [], rating: body.rating ?? null }) }).execute();
  businessEvents.inc({ event: `outfit_${body.action}`, outcome: 'ok' });
  return (await loadOutfitDtos(trx, app.signer, [outfitId]))[0]!;
}

export async function wear(app: AppContext, trx: Tx, userId: string, outfitId: string, date: string): Promise<OutfitDto> {
  const { row, candidate } = await loadOutfitCandidate(trx, outfitId);
  const occasion = (row.context as StoredContext).occasion ?? null;
  await logWear(trx, userId, candidate.items.map((i) => i.garment.id), date, outfitId, occasion);
  await trx.updateTable('outfits').set({ status: 'worn', is_saved: true }).where('id', '=', outfitId).execute();
  const { profile } = await loadProfile(trx, userId);
  await saveLearned(trx, userId, applyFeedback(profile.learned, candidate, row.features, { kind: 'wear' }));
  await trx.insertInto('recommendation_events').values({ user_id: userId, kind: 'wear', outfit_id: outfitId, features: JSON.stringify(row.features), context: JSON.stringify({ date }) }).execute();
  return (await loadOutfitDtos(trx, app.signer, [outfitId]))[0]!;
}

export async function createManual(app: AppContext, trx: Tx, userId: string, body: { name?: string; occasion?: string; items: Array<{ slot: string; garmentId: string }> }): Promise<OutfitDto> {
  if (!body.items.length) throw badRequest('Añade al menos una prenda.');
  const slots = body.items.map((i) => i.slot);
  if (new Set(slots).size !== slots.length) throw badRequest('Cada posición del conjunto solo puede tener una prenda.');
  const all = await loadEngineWardrobe(trx, { statuses: ['available', 'laundry', 'lent', 'stored'] });
  const byId = new Map(all.map((g) => [g.id, g]));
  const items = body.items.map((i) => {
    const g = byId.get(i.garmentId);
    if (!g) throw notFound('Prenda');
    return { slot: i.slot as Slot, garment: g };
  });
  const built = await buildContext(app, trx, userId, { occasion: body.occasion });
  const scored = evaluateOutfit({ items }, built.engine, built.profile, built.history);
  const id = await persistOutfit(trx, userId, scored, built.engine, 'manual', null, body.name?.trim() || null);
  return (await loadOutfitDtos(trx, app.signer, [id]))[0]!;
}

export async function listOutfits(app: AppContext, trx: Tx, filter: 'saved' | 'favorites' | 'all'): Promise<OutfitDto[]> {
  let q = trx.selectFrom('outfits').select('id').orderBy('updated_at', 'desc').limit(200);
  if (filter === 'saved') q = q.where('is_saved', '=', true);
  else if (filter === 'favorites') q = q.where('is_favorite', '=', true);
  else q = q.where('status', '!=', 'rejected').where('source', '!=', 'simulation');
  const ids = (await q.execute()).map((r) => r.id);
  return loadOutfitDtos(trx, app.signer, ids);
}

export async function history(app: AppContext, trx: Tx, from: string, to: string): Promise<UsageHistoryDto[]> {
  const rows = await trx.selectFrom('outfit_usage_history').selectAll().where('worn_on', '>=', from).where('worn_on', '<=', to).orderBy('worn_on', 'desc').limit(400).execute();
  const outfitIds = [...new Set(rows.map((r) => r.outfit_id).filter((x): x is string => !!x))];
  const outfits = new Map((await loadOutfitDtos(trx, app.signer, outfitIds)).map((o) => [o.id, o]));
  const garmentIds = [...new Set(rows.flatMap((r) => r.garment_ids))];
  const garments = new Map<string, GarmentDto>();
  if (garmentIds.length) for (const r of (await garmentSelect(trx).where('g.id', 'in', garmentIds).execute()) as GarmentRow[]) garments.set(r.id, toGarmentDto(r, app.signer));
  return rows.map((r) => ({ id: r.id, wornOn: r.worn_on, outfit: r.outfit_id ? (outfits.get(r.outfit_id) ?? null) : null, garments: r.garment_ids.map((id) => garments.get(id)).filter((g): g is GarmentDto => !!g), occasion: r.occasion }));
}

export { persistOutfit, restoreContext, storedContext };
export type { StoredContext };
