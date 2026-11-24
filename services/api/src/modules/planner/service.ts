import { getOccasion, type PlanDto, type PlannerDayDto, type PlanWrite, type SuggestWeekRequest } from '@dressit/shared';
import type { AppContext } from '../../context.ts';
import type { Tx } from '../../db/index.ts';
import { badRequest, notFound } from '../../lib/errors.ts';
import { eventDto } from '../calendar/service.ts';
import { loadOutfitDtos, recommend } from '../outfits/service.ts';

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export async function plannerRange(app: AppContext, trx: Tx, from: string, to: string): Promise<PlannerDayDto[]> {
  const span = Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
  if (span < 0 || span > 62) throw badRequest('El rango del calendario debe ser de 0 a 62 días.');
  const plans = await trx.selectFrom('outfit_plans').selectAll().where('plan_date', '>=', from).where('plan_date', '<=', to).orderBy('plan_date').orderBy('position').execute();
  const events = await trx
    .selectFrom('calendar_events')
    .selectAll()
    .where('starts_at', '>=', new Date(`${from}T00:00:00Z`))
    .where('starts_at', '<', new Date(`${addDays(to, 1)}T00:00:00Z`))
    .orderBy('starts_at')
    .execute();
  const outfits = new Map((await loadOutfitDtos(trx, app.signer, [...new Set(plans.map((p) => p.outfit_id))])).map((o) => [o.id, o]));
  // Conflicts: unavailable garments, same garment planned on consecutive days, worn in the last 2 days.
  const garmentStatus = new Map((await trx.selectFrom('garments').select(['id', 'status']).execute()).map((g) => [g.id, g.status]));
  const worn = await trx.selectFrom('outfit_usage_history').select(['worn_on', 'garment_ids']).where('worn_on', '>=', addDays(from, -2)).where('worn_on', '<=', to).execute();
  const days: PlannerDayDto[] = [];
  for (let i = 0; i <= span; i++) {
    const date = addDays(from, i);
    const dayPlans = plans.filter((p) => p.plan_date === date);
    const planDtos: PlanDto[] = dayPlans
      .filter((p) => outfits.has(p.outfit_id))
      .map((p) => ({
        id: p.id,
        date,
        position: p.position,
        outfit: outfits.get(p.outfit_id)!,
        event: (() => {
          const e = events.find((x) => x.id === p.calendar_event_id);
          return e ? eventDto(e) : null;
        })(),
        note: p.note,
      }));
    const conflicts: PlannerDayDto['conflicts'] = [];
    for (const p of planDtos) {
      for (const item of p.outfit.items) {
        const g = item.garment;
        if (!g) continue;
        const st = garmentStatus.get(g.id);
        if (st && st !== 'available') conflicts.push({ planId: p.id, garmentId: g.id, kind: 'unavailable', message: `${g.name} no está disponible (${st === 'laundry' ? 'en la colada' : st === 'lent' ? 'prestada' : st === 'stored' ? 'guardada' : 'retirada'}).` });
        if (item.slot === 'footwear' || item.slot === 'outer' || item.slot.startsWith('accessory')) continue;
        const prev = addDays(date, -1);
        if (plans.some((o) => o.plan_date === prev && outfits.get(o.outfit_id)?.items.some((it) => it.garment?.id === g.id))) {
          conflicts.push({ planId: p.id, garmentId: g.id, kind: 'planned_twice', message: `${g.name} también está planificada el día anterior.` });
        }
        if (worn.some((w) => w.worn_on < date && w.worn_on >= addDays(date, -2) && w.garment_ids.includes(g.id))) {
          conflicts.push({ planId: p.id, garmentId: g.id, kind: 'worn_recently', message: `Llevaste ${g.name.toLowerCase()} hace muy poco.` });
        }
      }
    }
    days.push({ date, plans: planDtos, events: events.filter((e) => e.starts_at.toISOString().slice(0, 10) === date).map(eventDto), conflicts });
  }
  return days;
}

export async function createPlan(app: AppContext, trx: Tx, userId: string, body: PlanWrite): Promise<PlanDto> {
  const outfit = await trx.selectFrom('outfits').select(['id', 'status']).where('id', '=', body.outfitId).executeTakeFirst();
  if (!outfit) throw notFound('Conjunto');
  if (body.eventId) {
    const ev = await trx.selectFrom('calendar_events').select('id').where('id', '=', body.eventId).executeTakeFirst();
    if (!ev) throw notFound('Evento');
  }
  const pos = body.position ?? Number((await trx.selectFrom('outfit_plans').select((eb) => eb.fn.countAll<number>().as('n')).where('plan_date', '=', body.date).executeTakeFirst())?.n ?? 0);
  const row = await trx
    .insertInto('outfit_plans')
    .values({ user_id: userId, plan_date: body.date, outfit_id: body.outfitId, calendar_event_id: body.eventId ?? null, note: body.note ?? null, position: pos })
    .returningAll()
    .executeTakeFirstOrThrow();
  await trx.updateTable('outfits').set({ is_saved: true }).where('id', '=', body.outfitId).execute();
  const day = (await plannerRange(app, trx, body.date, body.date))[0]!;
  return day.plans.find((p) => p.id === row.id)!;
}

export async function movePlan(app: AppContext, trx: Tx, id: string, body: Partial<PlanWrite>): Promise<PlanDto> {
  const set: Record<string, unknown> = {};
  if (body.date) set.plan_date = body.date;
  if (body.position !== undefined) set.position = body.position;
  if (body.note !== undefined) set.note = body.note;
  if (body.eventId !== undefined) set.calendar_event_id = body.eventId;
  if (body.outfitId) set.outfit_id = body.outfitId;
  const row = await trx.updateTable('outfit_plans').set(set).where('id', '=', id).returningAll().executeTakeFirst();
  if (!row) throw notFound('Plan');
  const day = (await plannerRange(app, trx, row.plan_date, row.plan_date))[0]!;
  return day.plans.find((p) => p.id === id)!;
}

export async function deletePlan(trx: Tx, id: string) {
  const r = await trx.deleteFrom('outfit_plans').where('id', '=', id).returning('id').executeTakeFirst();
  if (!r) throw notFound('Plan');
}

/**
 * Plans a week: one outfit per day using each day's forecast and events, excluding
 * garments already chosen on previous days to avoid repetition.
 */
export async function suggestWeek(app: AppContext, trx: Tx, userId: string, body: SuggestWeekRequest): Promise<PlannerDayDto[]> {
  const days = Math.min(Math.max(body.days, 1), 14);
  const used: string[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(body.from, i);
    const existing = await trx.selectFrom('outfit_plans').select('id').where('plan_date', '=', date).executeTakeFirst();
    if (existing) continue;
    const occasion = body.occasions?.[date];
    if (occasion && !getOccasion(occasion)) throw badRequest(`Ocasión desconocida: ${occasion}`);
    const rec = await recommend(app, trx, userId, { date, occasion, count: 1, exclude: used.slice(-12) });
    const outfit = rec.outfits[0];
    if (!outfit) continue;
    for (const it of outfit.items) if (it.garment && it.slot !== 'footwear' && it.slot !== 'outer' && !it.slot.startsWith('accessory')) used.push(it.garment.id);
    await trx.insertInto('outfit_plans').values({ user_id: userId, plan_date: date, outfit_id: outfit.id, position: 0 }).execute();
    await trx.updateTable('outfits').set({ is_saved: true }).where('id', '=', outfit.id).execute();
  }
  return plannerRange(app, trx, body.from, addDays(body.from, days - 1));
}
