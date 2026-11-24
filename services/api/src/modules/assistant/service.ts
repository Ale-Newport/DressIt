/**
 * Conversational stylist (Spanish). The default engine is a deterministic intent
 * parser that calls the same structured functions as the app (recommendations,
 * wardrobe, weather, catalog, gaps, trips). It never invents garments, products or
 * personal circumstances: every card comes from a real function call.
 */
import { randomUUID } from 'node:crypto';
import {
  getOccasion,
  getSubcategory,
  type AssistantCard,
  type AssistantMessageResponse,
  type GarmentDto,
  type RecommendationRequest,
} from '@dressit/shared';
import type { AppContext } from '../../context.ts';
import type { Tx } from '../../db/index.ts';
import { AppError } from '../../lib/errors.ts';
import { inferSubcategory } from '../retail/categorize.ts';
import { classifyOccasion } from '../calendar/service.ts';
import { recommend, todayIn } from '../outfits/service.ts';
import { garmentSelect } from '../wardrobe/service.ts';
import { toGarmentDto, type GarmentRow } from '../wardrobe/mappers.ts';
import { searchCatalog } from '../catalog/service.ts';
import { gaps, productToCandidate } from '../shopping/service.ts';
import { createTrip } from '../trips/service.ts';
import { colorFamilyFromText } from '@dressit/shared';

const NUMBERS: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, catorce: 14, quince: 15 };
const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const norm = (s: string) => s.toLowerCase().normalize('NFC');
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const WORD_ALT = Object.keys(NUMBERS).join('|');
const UNIT = '(?:d[ií]as?|noches?|conjuntos?|outfits?|looks?|semanas?|prendas?|propuestas?)';

/** Number attached to a unit ("cuatro días", "5 outfits"); falls back to any number except articles. */
export function parseNumber(text: string): number | null {
  const t = text.toLowerCase();
  const withUnit = new RegExp(`\\b(\\d{1,2}|${WORD_ALT})\\s+${UNIT}`).exec(t);
  if (withUnit) return /^\d/.test(withUnit[1]!) ? Number(withUnit[1]) : NUMBERS[withUnit[1]!]!;
  const m = /\b(\d{1,2})\b/.exec(t);
  if (m) return Number(m[1]);
  for (const [w, n] of Object.entries(NUMBERS)) if (n > 1 && new RegExp(`\\b${w}\\b`).test(t)) return n;
  return null;
}

export function parseDate(text: string, today: string): string | null {
  const t = norm(text);
  if (/pasado mañana/.test(t)) return addDays(today, 2);
  if (/\bmañana\b/.test(t) && !/por la mañana|esta mañana/.test(t)) return addDays(today, 1);
  if (/\bhoy\b|esta tarde|esta noche|esta mañana/.test(t)) return today;
  const dm = /\b(\d{1,2}) de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/.exec(t);
  if (dm) {
    const year = Number(today.slice(0, 4));
    const candidate = `${year}-${String(MONTHS.indexOf(dm[2]!) + 1).padStart(2, '0')}-${dm[1]!.padStart(2, '0')}`;
    return candidate < today ? `${year + 1}${candidate.slice(4)}` : candidate;
  }
  const wd = WEEKDAYS.findIndex((d) => new RegExp(`\\b(el |este |próximo )?${d}\\b`).test(t));
  if (wd >= 0) {
    const cur = new Date(`${today}T12:00:00Z`).getUTCDay();
    const diff = (wd - cur + 7) % 7 || 7;
    return addDays(today, diff);
  }
  return null;
}

const OCCASION_WORDS: Array<[RegExp, string]> = [
  [/trabaj|oficina/, 'trabajo'],
  [/oficina formal|reuni[oó]n importante|cliente/, 'oficina_formal'],
  [/universidad|clase|facultad|campus/, 'universidad'],
  [/entrevista/, 'entrevista'],
  [/cena/, 'cena'],
  [/fiesta|cumplea/, 'fiesta'],
  [/boda/, 'boda'],
  [/gimnasio|\bgym\b/, 'gimnasio'],
  [/correr|deporte|partido|p[aá]del|senderismo/, 'actividad_deportiva'],
  [/paseo|pasear/, 'paseo'],
  [/\bcita\b/, 'cita'],
  [/evento|gala|graduaci/, 'evento_especial'],
  [/viaje|viajar|aeropuerto/, 'viaje'],
  [/informal|tranquil|casa|recados/, 'dia_informal'],
];

export function parseOccasion(text: string): string | null {
  const t = norm(text);
  for (const [re, occ] of OCCASION_WORDS) if (re.test(t)) return occ;
  return classifyOccasion(text);
}

const STYLE_WORDS: Array<[RegExp, string]> = [
  [/old money|cl[aá]sic|quiet luxury|lujo silencioso/, 'clasico'],
  [/minimal/, 'minimalista'],
  [/streetwear|urban/, 'streetwear'],
  [/elegante|arreglad/, 'elegante'],
  [/deportiv|sporty|athleisure/, 'deportivo'],
  [/boho|bohemi/, 'bohemio'],
  [/rock/, 'rockero'],
  [/preppy|pijo/, 'preppy'],
  [/vintage|retro/, 'vintage'],
];

const TROUSERS = new Set(['pantalon', 'pantalon_vestir', 'vaquero', 'chino', 'jogger']);

/** Resolve phrases like "mis pantalones negros" or "la chaqueta que compré ayer" to real garments. */
async function resolveGarments(app: AppContext, trx: Tx, text: string, today: string): Promise<GarmentDto[]> {
  const t = norm(text);
  const ref = /\b(?:con|mis|mi|el|la|los|las)\s+([a-záéíóúñ ]{3,40}?)(?=\s+(?:que|para|por|sin|y)\b|[.,?!]|$)/.exec(t);
  const phrase = ref?.[1] ?? t;
  const guess = inferSubcategory(phrase);
  if (!guess) return [];
  const color = colorFamilyFromText(phrase);
  let q = garmentSelect(trx).where('g.status', '!=', 'retired');
  if (guess.subcategory === 'pantalon') q = q.where('g.subcategory', 'in', [...TROUSERS]);
  else q = q.where('g.subcategory', '=', guess.subcategory);
  if (color) q = q.where('g.primary_color', '=', color);
  if (/compr[eé] ayer|de ayer/.test(t)) q = q.where((eb) => eb.or([eb('g.purchase_date', '=', addDays(today, -1)), eb('g.created_at', '>=', new Date(Date.parse(`${addDays(today, -1)}T00:00:00Z`)))]));
  const rows = (await q.orderBy('g.favorite', 'desc').orderBy('g.created_at', 'desc').limit(3).execute()) as GarmentRow[];
  return rows.map((r) => toGarmentDto(r, app.signer));
}

function excludedSubcategories(text: string): string[] {
  const t = norm(text);
  const out: string[] = [];
  const neg = /(?:no quiero (?:llevar|ponerme)|sin)\s+([a-záéíóúñ ]{3,30})/.exec(t);
  if (neg) {
    const phrase = neg[1]!;
    if (/zapatos/.test(phrase)) out.push('zapatos', 'tacones', 'mocasines');
    else if (/tac[oó]n/.test(phrase)) out.push('tacones');
    else if (/corbata/.test(phrase)) out.push('corbata');
    else {
      const g = inferSubcategory(phrase);
      if (g) out.push(g.subcategory);
    }
  }
  return out;
}

interface Turn {
  reply: string;
  cards: AssistantCard[];
  toolCalls: Array<{ name: string; args: Record<string, unknown> }>;
}

export async function handleMessage(app: AppContext, trx: Tx, userId: string, text: string): Promise<Turn> {
  const t = norm(text.trim());
  const user = await trx.selectFrom('users').select(['timezone', 'location_lat']).where('id', '=', userId).executeTakeFirstOrThrow();
  const today = todayIn(user.timezone);
  const toolCalls: Turn['toolCalls'] = [];

  // 1. Trip planning
  if (/viaje|viajar|maleta|equipaje/.test(t) && /d[ií]as?|semana|fin de semana/.test(t)) {
    const days = /fin de semana/.test(t) ? 3 : /semana/.test(t) && !/d[ií]as?/.test(t) ? 7 : (parseNumber(t) ?? 3);
    const dest = /\b(?:a|en|para)\s+([A-ZÁÉÍÓÚÑ][\p{L}\s-]{2,40}?)(?=[.,?!]|$|\s+(?:del|desde|en|el|la|con|por)\b)/u.exec(text.trim())?.[1]?.trim();
    if (!dest) return { reply: '¿A qué ciudad vas? Dímelo para consultar la previsión, por ejemplo: «viaje de cuatro días a Madrid».', cards: [], toolCalls };
    const start = parseDate(t, today) ?? addDays(today, 1);
    toolCalls.push({ name: 'geocode', args: { q: dest } });
    let place;
    try {
      place = (await app.weather.geocode(dest))[0];
    } catch (e) {
      return { reply: e instanceof AppError ? e.message : 'No he podido localizar el destino.', cards: [], toolCalls };
    }
    if (!place) return { reply: `No encuentro «${dest}». ¿Puedes escribir el nombre de la ciudad de otra forma?`, cards: [], toolCalls };
    const activities = [...new Set(OCCASION_WORDS.filter(([re]) => re.test(t)).map(([, o]) => o).filter((o) => o !== 'viaje'))];
    const args = { destinationName: place.name, lat: place.lat, lon: place.lon, startDate: start, endDate: addDays(start, Math.min(days, 30) - 1), activities: activities.length ? activities : ['paseo'], luggage: days <= 3 ? 'cabina' : days <= 7 ? 'mediana' : 'grande' } as const;
    toolCalls.push({ name: 'create_trip', args: { ...args } });
    const trip = await createTrip(app, trx, userId, { ...args, activities: [...args.activities] });
    return {
      reply: `He preparado una maleta de ${trip.capsule.length} prendas para ${days} día${days === 1 ? '' : 's'} en ${trip.destinationName}${trip.weatherSummary ? ` (${trip.weatherSummary.charAt(0).toLowerCase()}${trip.weatherSummary.slice(1)})` : ''}, con un conjunto para cada día.`,
      cards: [{ type: 'trip', trip }],
      toolCalls,
    };
  }

  // 2. Shopping: product search in authorised catalogs
  if (/encuentra|busca|b[uú]scame|quiero comprar|d[oó]nde comprar/.test(t)) {
    const guess = inferSubcategory(t);
    const color = colorFamilyFromText(t);
    const max = /(?:menos de|m[aá]ximo|hasta)\s*(\d{1,4})\s*(?:€|euros)/.exec(t);
    const query = { subcategory: guess?.subcategory, color: color ?? undefined, maxPrice: max ? Number(max[1]) : undefined, inStock: true, limit: 30 };
    toolCalls.push({ name: 'search_catalog', args: query });
    const res = await searchCatalog(trx, query, app.cfg.PRICE_FRESHNESS_HOURS);
    if (!res.items.length) {
      const total = await trx.selectFrom('catalog_products').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirst();
      return {
        reply: Number(total?.n ?? 0) === 0 ? 'Todavía no hay catálogos de tiendas autorizados conectados, así que no puedo buscar productos reales. Puedes pegar el enlace de un producto que te guste y te digo cómo combina con tu ropa.' : 'No he encontrado productos que cumplan esos criterios en los catálogos conectados.',
        cards: [{ type: 'products', products: [], emptyReason: 'Sin resultados en catálogos autorizados.' }],
        toolCalls,
      };
    }
    const ranked = res.items.filter((p) => productToCandidate(p).garment).slice(0, 8);
    return { reply: `He encontrado ${res.items.length} producto${res.items.length === 1 ? '' : 's'} en catálogos autorizados${max ? ` por menos de ${max[1]} €` : ''}. Pulsa «Ver cómo combinarlo» para simularlo con tu armario.`, cards: [{ type: 'products', products: ranked, emptyReason: null }], toolCalls };
  }

  // 3. What to buy / wardrobe gaps
  if (/(qu[eé] (deber[ií]a|me falta|necesito) comprar|qu[eé] me falta|completar mi armario|m[aá]s conjuntos)/.test(t)) {
    toolCalls.push({ name: 'wardrobe_gaps', args: {} });
    const g = await gaps(app, trx, userId);
    if (!g.length) return { reply: 'Necesito conocer más prendas de tu armario para analizar qué te falta. Añade al menos unas cuantas.', cards: [], toolCalls };
    return { reply: `${g[0]!.reason} Te dejo las piezas que más conjuntos nuevos te darían.`, cards: [{ type: 'gaps', gaps: g }], toolCalls };
  }

  // 4. Weather
  if (/tiempo|llover|lluvia|temperatura|fr[ií]o|calor/.test(t) && !/qu[eé] me pongo|outfit|conjunto|ropa/.test(t)) {
    const date = parseDate(t, today) ?? today;
    if (user.location_lat === null) return { reply: 'Configura tu ciudad en el perfil y te digo el tiempo.', cards: [], toolCalls };
    toolCalls.push({ name: 'weather', args: { date } });
    const rec = await recommend(app, trx, userId, { date, count: 1 });
    if (!rec.weather) return { reply: rec.weatherError ?? 'No tengo previsión ahora mismo.', cards: [], toolCalls };
    return { reply: rec.weather.summary.replace(/^Hoy/, date === today ? 'Hoy' : date === addDays(today, 1) ? 'Mañana' : 'Ese día'), cards: [{ type: 'weather', weather: rec.weather }], toolCalls };
  }

  // 5. Outfits (default intent)
  // Any clothing request or a plan/occasion mention ("tengo una cena formal…") is an outfit request.
  const isOutfitIntent = /qu[eé] me pongo|outfit|conjunto|look|vestir|ponerme|llevar|combin|algo (m[aá]s )?(elegante|formal|informal|c[oó]modo|abrigado)|ens[eé][nñ]ame/.test(t) || parseOccasion(t) !== null;
  if (isOutfitIntent) {
    const date = parseDate(t, today) ?? today;
    const occasion = parseOccasion(t) ?? undefined;
    const style = STYLE_WORDS.find(([re]) => re.test(t))?.[1];
    const garments = /\bcon (mi|mis|el|la|los|las)\b/.test(t) ? await resolveGarments(app, trx, t, today) : [];
    if (/\bcon (mi|mis|el|la|los|las)\b/.test(t) && !garments.length) {
      return { reply: 'No encuentro esa prenda en tu armario. ¿Puedes describirla de otra forma o añadirla primero?', cards: [], toolCalls: [{ name: 'find_garments', args: { text: t } }] };
    }
    const count = Math.min(Math.max(/ens[eé][nñ]ame|dame|prop[oó]n/.test(t) ? (parseNumber(t) ?? 3) : 3, 1), 6);
    const req: RecommendationRequest = {
      date,
      ...(occasion ? { occasion } : {}),
      count,
      adjustments: {
        formality: /m[aá]s formal|formal/.test(t) && !/informal/.test(t) ? 1 : /informal|c[oó]modo|relajad/.test(t) ? -1 : 0,
        warmth: /abrigad|calent/.test(t) ? 1 : /fresc|ligero/.test(t) ? -1 : 0,
        elegance: /elegante|arreglad/.test(t) || style === 'clasico' || style === 'elegante' ? 1 : 0,
      },
      mustInclude: garments.slice(0, 1).map((g) => g.id),
      excludeSubcategories: excludedSubcategories(t),
    };
    toolCalls.push({ name: 'recommend_outfits', args: { ...req } });
    const rec = await recommend(app, trx, userId, req);
    if (!rec.outfits.length) return { reply: rec.warnings[0] ?? 'No he podido crear conjuntos con las prendas disponibles.', cards: [], toolCalls };
    const occLabel = getOccasion(rec.occasion.id)?.label.toLowerCase() ?? '';
    const anchor = garments[0] ? ` con tu ${garments[0].name.toLowerCase()}` : '';
    const styleNote = style === 'clasico' ? ' Para un estilo «old money» priorizo tonos neutros, tejidos nobles y cortes clásicos de tu armario antes que comprar nada.' : '';
    return {
      reply: `${rec.weather ? `${rec.weather.summary.replace(/^Hoy/, date === today ? 'Hoy' : date === addDays(today, 1) ? 'Mañana' : 'Ese día')} ` : ''}Te propongo ${rec.outfits.length} conjunto${rec.outfits.length === 1 ? '' : 's'}${anchor} para ${occLabel}.${styleNote}`,
      cards: [{ type: 'outfits', outfits: rec.outfits }, ...(garments.length ? [{ type: 'garments' as const, garments }] : [])],
      toolCalls,
    };
  }

  // 6. Garment lookup ("¿cuántas camisas tengo?")
  const sub = inferSubcategory(t);
  if (sub && /tengo|mis|cu[aá]nt/.test(t)) {
    const rows = (await garmentSelect(trx).where('g.subcategory', '=', sub.subcategory).where('g.status', '!=', 'retired').limit(30).execute()) as GarmentRow[];
    toolCalls.push({ name: 'list_garments', args: { subcategory: sub.subcategory } });
    return { reply: `Tienes ${rows.length} prenda${rows.length === 1 ? '' : 's'} del tipo «${getSubcategory(sub.subcategory)?.label.toLowerCase()}».`, cards: rows.length ? [{ type: 'garments', garments: rows.map((r) => toGarmentDto(r, app.signer)) }] : [], toolCalls };
  }

  return {
    reply: 'Puedo ayudarte a elegir qué ponerte, planificar un viaje, buscar ropa que combine con tu armario o decirte qué te falta. Prueba con: «¿Qué me pongo mañana para ir a trabajar?» o «Necesito ropa para un viaje de cuatro días a Madrid».',
    cards: [],
    toolCalls,
  };
}

export async function converse(app: AppContext, trx: Tx, userId: string, body: { conversationId?: string; text: string }): Promise<AssistantMessageResponse> {
  const conversationId = body.conversationId ?? randomUUID();
  const text = body.text.slice(0, 1000);
  await trx.insertInto('assistant_messages').values({ user_id: userId, conversation_id: conversationId, role: 'user', content: text }).execute();
  const turn = await handleMessage(app, trx, userId, text);
  await trx.insertInto('assistant_messages').values({ user_id: userId, conversation_id: conversationId, role: 'assistant', content: turn.reply, tool_calls: JSON.stringify(turn.toolCalls) }).execute();
  return { conversationId, reply: turn.reply, cards: turn.cards, toolCalls: turn.toolCalls, engine: 'rules' };
}
