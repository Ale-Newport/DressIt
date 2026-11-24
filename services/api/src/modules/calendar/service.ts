import type { Selectable } from 'kysely';
import type { CalendarEventDto, CalendarEventWrite, DeviceCalendarSyncRequest } from '@dressit/shared';
import { getOccasion } from '@dressit/shared';
import type { Tx } from '../../db/index.ts';
import type { CalendarEvents } from '../../db/types.ts';
import { badRequest, notFound } from '../../lib/errors.ts';

/** Keyword rules (Spanish) mapping an event title to an occasion. Deterministic and explainable. */
const OCCASION_RULES: Array<[RegExp, string]> = [
  [/\bboda\b|\bwedding\b|\bcasamiento\b/i, 'boda'],
  [/entrevista|interview/i, 'entrevista'],
  [/gimnasio|\bgym\b|crossfit|pilates|yoga|spinning|entreno/i, 'gimnasio'],
  [/running|correr|carrera popular|partido|p[aá]del|tenis|f[uú]tbol|senderismo|ruta|bici|escalada/i, 'actividad_deportiva'],
  [/cena|dinner/i, 'cena'],
  [/fiesta|cumplea[nñ]os|party|discoteca|concierto/i, 'fiesta'],
  [/\bcita\b|\bdate\b/i, 'cita'],
  [/vuelo|viaje|aeropuerto|flight|tren a|ave a/i, 'viaje'],
  [/comit[eé]|consejo|cliente|presentaci[oó]n|junta|board/i, 'oficina_formal'],
  [/reuni[oó]n|oficina|trabajo|meeting|daily|standup|1:1/i, 'trabajo'],
  [/clase|universidad|facultad|examen|tutor[ií]a|seminario|campus/i, 'universidad'],
  [/paseo|parque|museo|mercadillo|brunch/i, 'paseo'],
  [/gala|graduaci[oó]n|bautizo|comuni[oó]n|evento|inauguraci[oó]n/i, 'evento_especial'],
];

export function classifyOccasion(title: string): string | null {
  for (const [re, occ] of OCCASION_RULES) if (re.test(title)) return occ;
  return null;
}

export function eventDto(e: Selectable<CalendarEvents>): CalendarEventDto {
  return {
    id: e.id,
    source: e.source as CalendarEventDto['source'],
    title: e.title,
    occasion: e.occasion,
    startsAt: e.starts_at.toISOString(),
    endsAt: e.ends_at?.toISOString() ?? null,
    isOutdoor: e.is_outdoor,
    locationName: e.location_name,
  };
}

export async function listEvents(trx: Tx, from: string, to: string): Promise<CalendarEventDto[]> {
  const rows = await trx
    .selectFrom('calendar_events')
    .selectAll()
    .where('starts_at', '>=', new Date(`${from}T00:00:00Z`))
    .where('starts_at', '<', new Date(Date.parse(`${to}T00:00:00Z`) + 86_400_000))
    .orderBy('starts_at')
    .limit(500)
    .execute();
  return rows.map(eventDto);
}

function validateOccasion(occ: string | null | undefined): string | null {
  if (!occ) return null;
  if (!getOccasion(occ)) throw badRequest(`Ocasión desconocida: ${occ}`);
  return occ;
}

export async function createEvent(trx: Tx, userId: string, body: CalendarEventWrite): Promise<CalendarEventDto> {
  const row = await trx
    .insertInto('calendar_events')
    .values({
      user_id: userId,
      source: 'manual',
      title: body.title.trim(),
      occasion: validateOccasion(body.occasion) ?? classifyOccasion(body.title),
      starts_at: new Date(body.startsAt),
      ends_at: body.endsAt ? new Date(body.endsAt) : null,
      is_outdoor: body.isOutdoor ?? null,
      location_name: body.locationName ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return eventDto(row);
}

export async function updateEvent(trx: Tx, id: string, body: Partial<CalendarEventWrite>): Promise<CalendarEventDto> {
  const set: Record<string, unknown> = {};
  if (body.title !== undefined) set.title = body.title.trim();
  if (body.occasion !== undefined) set.occasion = validateOccasion(body.occasion);
  if (body.startsAt !== undefined) set.starts_at = new Date(body.startsAt);
  if (body.endsAt !== undefined) set.ends_at = body.endsAt ? new Date(body.endsAt) : null;
  if (body.isOutdoor !== undefined) set.is_outdoor = body.isOutdoor;
  if (body.locationName !== undefined) set.location_name = body.locationName;
  const row = await trx.updateTable('calendar_events').set(set).where('id', '=', id).returningAll().executeTakeFirst();
  if (!row) throw notFound('Evento');
  return eventDto(row);
}

export async function deleteEvent(trx: Tx, id: string) {
  const r = await trx.deleteFrom('calendar_events').where('id', '=', id).returning('id').executeTakeFirst();
  if (!r) throw notFound('Evento');
}

/**
 * Device calendar sync (explicit permission on the phone): only id, title, times and
 * location name are received. Events removed on the device within the range are removed here.
 */
export async function syncDevice(trx: Tx, userId: string, body: DeviceCalendarSyncRequest): Promise<{ upserted: number; removed: number }> {
  const consent = await trx.selectFrom('consents').select('granted').where('kind', '=', 'calendar').orderBy('created_at', 'desc').executeTakeFirst();
  if (!consent?.granted) throw badRequest('Activa el consentimiento de calendario en Perfil → Privacidad para sincronizarlo.');
  let upserted = 0;
  for (const e of body.events.slice(0, 500)) {
    const values = {
      title: e.title.slice(0, 200) || 'Evento',
      occasion: classifyOccasion(e.title),
      starts_at: new Date(e.startsAt),
      ends_at: e.endsAt ? new Date(e.endsAt) : null,
      all_day: e.allDay,
      location_name: e.locationName?.slice(0, 200) ?? null,
    };
    await trx
      .insertInto('calendar_events')
      .values({ user_id: userId, source: 'device', external_id: e.externalId, ...values })
      .onConflict((oc) => oc.columns(['user_id', 'source', 'external_id']).where('external_id', 'is not', null).doUpdateSet(values))
      .execute();
    upserted++;
  }
  const ids = body.events.map((e) => e.externalId);
  let q = trx
    .deleteFrom('calendar_events')
    .where('source', '=', 'device')
    .where('starts_at', '>=', new Date(body.rangeStart))
    .where('starts_at', '<=', new Date(body.rangeEnd));
  if (ids.length) q = q.where('external_id', 'not in', ids);
  const removed = await q.returning('id').execute();
  return { upserted, removed: removed.length };
}
