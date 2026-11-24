import { getOccasion, type GarmentDto, type TripDto, type TripRequest } from '@dressit/shared';
import { generateOutfits, hashString, seasonOf, type EngineContext, type ScoredOutfit } from '@dressit/stylist-engine';
import type { AppContext } from '../../context.ts';
import type { Tx } from '../../db/index.ts';
import { AppError, badRequest, notFound } from '../../lib/errors.ts';
import { toConditions } from '../weather/service.ts';
import { loadHistory, loadOutfitDtos, loadProfile, persistOutfit } from '../outfits/service.ts';
import { garmentSelect, loadEngineWardrobe } from '../wardrobe/service.ts';
import { toGarmentDto, type GarmentRow } from '../wardrobe/mappers.ts';
import { classifyOccasion } from '../calendar/service.ts';

const LUGGAGE_LIMIT: Record<TripRequest['luggage'], number> = { mochila: 9, cabina: 13, mediana: 20, grande: 30 };
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

function activityToOccasion(a: string): string {
  if (getOccasion(a)) return a;
  return classifyOccasion(a) ?? (/(turismo|visitar|ciudad|museo|playa)/i.test(a) ? 'paseo' : 'dia_informal');
}

interface StoredTrip {
  weatherSummary: string | null;
  weatherAvailable: boolean;
  extras: string[];
  warnings: string[];
  days: Array<{ date: string; occasion: string; outfitId: string | null; weather: string | null }>;
}

export async function createTrip(app: AppContext, trx: Tx, userId: string, body: TripRequest): Promise<TripDto> {
  const nDays = Math.round((Date.parse(`${body.endDate}T12:00:00Z`) - Date.parse(`${body.startDate}T12:00:00Z`)) / 86_400_000) + 1;
  if (nDays < 1 || nDays > 30) throw badRequest('El viaje debe durar entre 1 y 30 días.');
  const maxItems = LUGGAGE_LIMIT[body.luggage];
  const { profile, prefs } = await loadProfile(trx, userId);
  const wardrobe = await loadEngineWardrobe(trx, { statuses: ['available', 'laundry'] });
  if (wardrobe.length < 3) throw badRequest('Necesitas al menos unas cuantas prendas en tu armario para planificar un viaje.');
  const history = await loadHistory(trx, body.startDate);
  const activities = body.activities.length ? body.activities.map(activityToOccasion) : ['paseo'];
  const warnings: string[] = [];
  const window = { start: prefs.day_start.slice(0, 5), end: prefs.day_end.slice(0, 5) };

  const candidatesPerDay: Array<{ date: string; occasion: string; weather: string | null; options: ScoredOutfit[]; ctx: EngineContext }> = [];
  let anyWeather = false;
  let rainDays = 0;
  let minT = Number.POSITIVE_INFINITY;
  let maxT = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < nDays; i++) {
    const date = addDays(body.startDate, i);
    const occasionId = i === 0 ? 'viaje' : activities[(i - 1) % activities.length]!;
    let weatherText: string | null = null;
    let conditions = null;
    try {
      const w = await app.weather.day({ lat: body.lat, lon: body.lon, locationName: body.destinationName, date, window });
      conditions = toConditions(w);
      weatherText = `${Math.round(w.tempMin)}–${Math.round(w.tempMax)} °C${w.precipitationProbabilityMax >= 40 ? `, lluvia ${Math.round(w.precipitationProbabilityMax)} %` : ''}`;
      anyWeather = true;
      if (w.precipitationProbabilityMax >= 50) rainDays++;
      minT = Math.min(minT, w.tempMin);
      maxT = Math.max(maxT, w.tempMax);
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
    }
    const occasion = getOccasion(occasionId)!;
    const ctx: EngineContext = {
      date,
      occasion,
      weather: conditions,
      season: seasonOf(date),
      indoorShare: occasion.indoorShare,
      adjustments: { formality: 0, warmth: 0, elegance: 0 },
      mustInclude: [],
      exclude: new Set(),
      excludeSubcategories: new Set(),
      temperatureSensitivity: prefs.temperature_sensitivity,
    };
    const r = generateOutfits(wardrobe, ctx, profile, history, { count: 8, seed: hashString(`${userId}:${date}:trip`), explorationRate: 0, diversityLambda: 0.55 });
    candidatesPerDay.push({ date, occasion: occasionId, weather: weatherText, options: r.outfits, ctx });
  }
  if (!anyWeather) warnings.push('Aún no hay previsión para esas fechas (máximo 16 días vista): las sugerencias usan la estación del año.');

  // Greedy capsule: prefer outfits that reuse already-packed pieces, within the luggage limit.
  const capsule = new Set<string>();
  const chosen: Array<ScoredOutfit | null> = [];
  for (let i = 0; i < candidatesPerDay.length; i++) {
    const day = candidatesPerDay[i]!;
    const prev = chosen[i - 1];
    const prevTop = prev?.items.find((x) => x.slot === 'base' || x.slot === 'one_piece')?.garment.id;
    let best: ScoredOutfit | null = null;
    let bestValue = Number.NEGATIVE_INFINITY;
    for (const o of day.options) {
      const ids = o.items.map((x) => x.garment.id);
      const newItems = ids.filter((id) => !capsule.has(id)).length;
      if (capsule.size + newItems > maxItems) continue;
      const top = o.items.find((x) => x.slot === 'base' || x.slot === 'one_piece')?.garment.id;
      const value = o.score + 0.06 * (ids.length - newItems) - (top && top === prevTop ? 0.2 : 0);
      if (value > bestValue) {
        bestValue = value;
        best = o;
      }
    }
    if (best) for (const it of best.items) capsule.add(it.garment.id);
    else warnings.push(`No cabe un conjunto adecuado para el ${day.date} con el límite de equipaje.`);
    chosen.push(best);
  }

  const trip = await trx
    .insertInto('trips')
    .values({ user_id: userId, destination_name: body.destinationName, lat: Math.round(body.lat * 100) / 100, lon: Math.round(body.lon * 100) / 100, start_date: body.startDate, end_date: body.endDate, activities: body.activities, luggage: body.luggage, max_items: maxItems })
    .returning('id')
    .executeTakeFirstOrThrow();
  const days: StoredTrip['days'] = [];
  for (let i = 0; i < chosen.length; i++) {
    const o = chosen[i];
    const d = candidatesPerDay[i]!;
    let outfitId: string | null = null;
    if (o) {
      outfitId = await persistOutfit(trx, userId, o, d.ctx, 'trip', null, `${body.destinationName} · día ${i + 1}`);
      await trx.insertInto('outfit_plans').values({ user_id: userId, plan_date: d.date, outfit_id: outfitId, trip_id: trip.id, position: 0 }).execute();
    }
    days.push({ date: d.date, occasion: d.occasion, outfitId, weather: d.weather });
  }
  // Packing quantities: base layers worn more than once per 2 days need repeats only if not enough unique ones.
  for (const id of capsule) {
    const uses = chosen.filter((o) => o?.items.some((it) => it.garment.id === id)).length;
    await trx.insertInto('trip_items').values({ trip_id: trip.id, garment_id: id, user_id: userId, quantity: Math.max(1, uses > 0 ? 1 : 1) }).execute();
  }
  const extras = [`Ropa interior y calcetines para ${nDays} día${nDays === 1 ? '' : 's'}`, 'Pijama y neceser'];
  if (rainDays > 0) extras.push(capsule.size && wardrobe.some((g) => capsule.has(g.id) && (g.waterproof || g.accessorySlot === 'umbrella')) ? 'Hay lluvia prevista: ya incluimos protección impermeable' : 'Hay lluvia prevista: lleva paraguas o un chubasquero');
  if (activities.includes('actividad_deportiva') || activities.includes('gimnasio')) extras.push('Ropa y calzado deportivo');
  const stored: StoredTrip = {
    weatherSummary: anyWeather ? `Entre ${Math.round(minT)} y ${Math.round(maxT)} °C${rainDays ? `, ${rainDays} día${rainDays === 1 ? '' : 's'} con lluvia probable` : ''}` : null,
    weatherAvailable: anyWeather,
    extras,
    warnings,
    days,
  };
  await trx.updateTable('trips').set({ result: JSON.stringify(stored) }).where('id', '=', trip.id).execute();
  return getTrip(app, trx, trip.id);
}

export async function getTrip(app: AppContext, trx: Tx, id: string): Promise<TripDto> {
  const t = await trx.selectFrom('trips').selectAll().where('id', '=', id).executeTakeFirst();
  if (!t) throw notFound('Viaje');
  const r = t.result as unknown as StoredTrip;
  const items = await trx.selectFrom('trip_items').selectAll().where('trip_id', '=', id).execute();
  const garments = new Map<string, GarmentDto>();
  if (items.length) for (const g of (await garmentSelect(trx).where('g.id', 'in', items.map((i) => i.garment_id)).execute()) as GarmentRow[]) garments.set(g.id, toGarmentDto(g, app.signer));
  const outfits = new Map((await loadOutfitDtos(trx, app.signer, (r.days ?? []).map((d) => d.outfitId).filter((x): x is string => !!x))).map((o) => [o.id, o]));
  return {
    id: t.id,
    destinationName: t.destination_name,
    startDate: t.start_date,
    endDate: t.end_date,
    activities: t.activities,
    luggage: t.luggage as TripDto['luggage'],
    maxItems: t.max_items,
    weatherSummary: r.weatherSummary ?? null,
    weatherAvailable: r.weatherAvailable ?? false,
    capsule: items.map((i) => garments.get(i.garment_id)).filter((g): g is GarmentDto => !!g),
    packingList: items.filter((i) => garments.has(i.garment_id)).map((i) => ({ garment: garments.get(i.garment_id)!, quantity: i.quantity, packed: i.packed })),
    extras: r.extras ?? [],
    days: (r.days ?? []).map((d) => ({ date: d.date, occasion: d.occasion, outfit: d.outfitId ? (outfits.get(d.outfitId) ?? null) : null, weather: d.weather })),
    warnings: r.warnings ?? [],
    createdAt: t.created_at.toISOString(),
  };
}

export async function listTrips(app: AppContext, trx: Tx): Promise<TripDto[]> {
  const rows = await trx.selectFrom('trips').select('id').orderBy('start_date', 'desc').limit(50).execute();
  return Promise.all(rows.map((r) => getTrip(app, trx, r.id)));
}

export async function setPacked(app: AppContext, trx: Tx, tripId: string, garmentId: string, packed: boolean): Promise<TripDto> {
  const r = await trx.updateTable('trip_items').set({ packed }).where('trip_id', '=', tripId).where('garment_id', '=', garmentId).returning('trip_id').executeTakeFirst();
  if (!r) throw notFound('Prenda del viaje');
  return getTrip(app, trx, tripId);
}

export async function deleteTrip(trx: Tx, id: string) {
  const r = await trx.deleteFrom('trips').where('id', '=', id).returning('id').executeTakeFirst();
  if (!r) throw notFound('Viaje');
}
