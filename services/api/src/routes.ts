import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { z } from 'zod';
import { CATEGORIES, CONDITIONS, FITS, GARMENT_STATUSES, SEASONS, SPACE_KINDS, STYLES, getOccasion, type CatalogSourceStatus, type CatalogSourceStatusDto, type HomeResponse, type RetailerIntegrationDto, type ShoppingSection } from '@dressit/shared';
import type { AppContext } from './context.ts';
import { withUser, type Tx } from './db/index.ts';
import { badRequest, notFound, unauthorized } from './lib/errors.ts';
import { hexColor, hhmm, isoDate, parse, uuid } from './lib/validation.ts';
import * as auth from './modules/auth/service.ts';
import * as profile from './modules/profile/service.ts';
import * as wardrobe from './modules/wardrobe/service.ts';
import * as images from './modules/images/service.ts';
import * as imports from './modules/imports/service.ts';
import * as link from './modules/retail/link-import.ts';
import * as outfits from './modules/outfits/service.ts';
import * as calendar from './modules/calendar/service.ts';
import * as planner from './modules/planner/service.ts';
import * as trips from './modules/trips/service.ts';
import * as catalog from './modules/catalog/service.ts';
import * as shopping from './modules/shopping/service.ts';
import * as assistant from './modules/assistant/service.ts';
import * as imagegen from './modules/imagegen/service.ts';
import * as recut from './modules/images/recut.ts';
import * as catalogPhoto from './modules/catalog-photo/service.ts';
import { RETAILERS } from './modules/retail/registry.ts';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const email = z.string().trim().email('correo no válido').max(254);
const password = z.string().min(10, 'la contraseña debe tener al menos 10 caracteres').max(200);
const styleEnum = z.enum(STYLES);
const seasonEnum = z.enum(SEASONS);
const productRef = z.object({ kind: z.enum(['catalog', 'imported']), id: uuid });

const garmentWrite = z
  .object({
    name: z.string().max(120),
    category: z.enum(CATEGORIES),
    subcategory: z.string().max(40),
    brand: z.string().max(80).nullable(),
    model: z.string().max(120).nullable(),
    colors: z.array(z.object({ hex: hexColor, share: z.number().min(0).max(1).optional() })).max(4),
    pattern: z.string().max(30).nullable(),
    materials: z.array(z.string().max(30)).max(5),
    styles: z.array(styleEnum).max(6),
    seasons: z.array(seasonEnum).max(4),
    occasions: z.array(z.string().max(30)).max(10),
    formality: z.number().min(0).max(100),
    warmth: z.number().min(0).max(3),
    waterproof: z.boolean(),
    fit: z.enum(FITS).nullable(),
    size: z.string().max(20).nullable(),
    condition: z.enum(CONDITIONS).nullable(),
    favorite: z.boolean(),
    spaceId: uuid.nullable(),
    tags: z.array(z.string().max(40)).max(20),
    notes: z.string().max(1000).nullable(),
    purchaseDate: isoDate.nullable(),
    purchasePriceCents: z.number().int().min(0).max(10_000_000).nullable(),
    imageId: uuid.nullable(),
  })
  .partial();

const listQuery = z.object({
  q: z.string().max(100).optional(),
  status: z.enum([...GARMENT_STATUSES, 'all']).optional(),
  category: z.enum(CATEGORIES).optional(),
  subcategory: z.string().max(40).optional(),
  color: z.string().max(30).optional(),
  brand: z.string().max(80).optional(),
  style: styleEnum.optional(),
  season: seasonEnum.optional(),
  material: z.string().max(30).optional(),
  occasion: z.string().max(30).optional(),
  favorite: z.coerce.boolean().optional(),
  tag: z.string().max(40).optional(),
  spaceId: uuid.optional(),
  usage: z.enum(['new', 'unused', 'rarely_used', 'most_used']).optional(),
  sort: z.enum(['recent', 'oldest', 'least_worn', 'most_worn', 'cost_per_wear', 'name']).optional(),
  cursor: z.string().max(12).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const recRequest = z.object({
  date: isoDate.optional(),
  occasion: z.string().refine((o) => !!getOccasion(o), 'ocasión desconocida').optional(),
  eventId: uuid.optional(),
  count: z.number().int().min(1).max(8).optional(),
  adjustments: z.object({ formality: z.union([z.literal(-1), z.literal(0), z.literal(1)]).optional(), warmth: z.union([z.literal(-1), z.literal(0), z.literal(1)]).optional(), elegance: z.union([z.literal(0), z.literal(1)]).optional() }).optional(),
  mustInclude: z.array(uuid).max(4).optional(),
  exclude: z.array(uuid).max(200).optional(),
  excludeSubcategories: z.array(z.string().max(40)).max(20).optional(),
  dayWindow: z.object({ start: hhmm, end: hhmm }).optional(),
  indoorShare: z.number().min(0).max(1).optional(),
  seed: z.number().int().min(0).optional(),
});

const slot = z.string().regex(/^(base|mid|outer|bottom|one_piece|footwear|accessory:[a-z]+)$/, 'posición no válida');

// ---------------------------------------------------------------------------

type Handler<T> = (trx: Tx, req: FastifyRequest, reply: FastifyReply) => Promise<T>;

export async function routes(app: FastifyInstance, ctx: AppContext, requireAuth: preHandlerAsyncHookHandler) {
  /** Authenticated, RLS-scoped handler. */
  const user =
    <T>(fn: Handler<T>) =>
    async (req: FastifyRequest, reply: FastifyReply) =>
      withUser(ctx.db, req.userId, (trx) => fn(trx, req, reply));
  const authed = { preHandler: requireAuth };
  const authLimit = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  // --- Auth ------------------------------------------------------------------
  app.post('/v1/auth/register', authLimit, async (req, reply) => {
    const body = parse(z.object({ email, password, displayName: z.string().trim().min(1).max(80), acceptTerms: z.literal(true, { message: 'debes aceptar los términos y la política de privacidad' }) }), req.body);
    reply.status(201);
    return auth.register(ctx, body, req.headers['user-agent']);
  });
  app.post('/v1/auth/login', authLimit, async (req) => auth.login(ctx, parse(z.object({ email, password: z.string().min(1).max(200) }), req.body), req.headers['user-agent']));
  app.post('/v1/auth/refresh', authLimit, async (req) => auth.refresh(ctx, parse(z.object({ refreshToken: z.string().min(20).max(200) }), req.body).refreshToken, req.headers['user-agent']));
  app.post('/v1/auth/logout', async (req, reply) => {
    await auth.logout(ctx, parse(z.object({ refreshToken: z.string().min(20).max(200) }), req.body).refreshToken);
    return reply.status(204).send();
  });

  // --- Me / profile ------------------------------------------------------------
  app.get('/v1/me', authed, user((trx, req) => auth.loadUser(trx, req.userId)));
  app.patch(
    '/v1/me',
    authed,
    user(async (trx, req) => {
      const b = parse(z.object({ displayName: z.string().trim().min(1).max(80).optional(), timezone: z.string().max(60).optional() }), req.body);
      if (b.timezone) {
        try {
          new Intl.DateTimeFormat('es', { timeZone: b.timezone });
        } catch {
          throw badRequest('Zona horaria no válida.');
        }
      }
      await trx.updateTable('users').set({ ...(b.displayName ? { display_name: b.displayName } : {}), ...(b.timezone ? { timezone: b.timezone } : {}) }).where('id', '=', req.userId).execute();
      return auth.loadUser(trx, req.userId);
    }),
  );
  app.put(
    '/v1/me/location',
    authed,
    user(async (trx, req) => {
      const b = parse(z.object({ name: z.string().trim().min(1).max(100), lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180), countryCode: z.string().length(2).default('ES') }), req.body);
      await trx.updateTable('users').set({ location_name: b.name, location_lat: Math.round(b.lat * 100) / 100, location_lon: Math.round(b.lon * 100) / 100, country_code: b.countryCode.toUpperCase() }).where('id', '=', req.userId).execute();
      await trx.insertInto('consents').values({ user_id: req.userId, kind: 'location', granted: true, version: profile.CONSENT_VERSION }).execute();
      return auth.loadUser(trx, req.userId);
    }),
  );
  app.get('/v1/me/preferences', authed, user((trx, req) => profile.getPreferences(trx, req.userId)));
  app.put(
    '/v1/me/preferences',
    authed,
    user((trx, req) =>
      profile.updatePreferences(
        trx,
        req.userId,
        parse(
          z
            .object({
              preferredStyles: z.array(styleEnum).max(8),
              favoriteColors: z.array(z.string().max(30)).max(10),
              avoidedColors: z.array(z.string().max(30)).max(10),
              fitPreferences: z.object({ top: z.enum(FITS).optional(), bottom: z.enum(FITS).optional() }),
              sizes: z.object({ top: z.string().max(10).optional(), bottom: z.string().max(10).optional(), shoes: z.string().max(10).optional(), dress: z.string().max(10).optional() }),
              favoriteBrands: z.array(z.string().max(60)).max(30),
              budget: z.object({ minEur: z.number().int().min(0).max(100000).nullable(), maxEur: z.number().int().min(0).max(100000).nullable() }),
              sustainability: z.object({ secondHand: z.boolean(), prioritizeSustainable: z.boolean() }),
              usualContexts: z.array(z.string().refine((o) => !!getOccasion(o), 'ocasión desconocida')).max(14),
              priorities: z.object({ comfort: z.number().min(0).max(1), elegance: z.number().min(0).max(1), practicality: z.number().min(0).max(1) }),
              dayWindow: z.object({ start: hhmm, end: hhmm }),
              temperatureSensitivity: z.number().int().min(-2).max(2),
            })
            .partial(),
          req.body,
        ),
      ),
    ),
  );
  app.post(
    '/v1/me/onboarding/complete',
    authed,
    user(async (trx, req) => {
      await trx.updateTable('users').set({ onboarding_completed_at: new Date() }).where('id', '=', req.userId).execute();
      return auth.loadUser(trx, req.userId);
    }),
  );
  app.get('/v1/me/consents', authed, user((trx) => profile.listConsents(trx)));
  app.put(
    '/v1/me/consents/:kind',
    authed,
    user(async (trx, req) => {
      const kind = (req.params as { kind: string }).kind;
      const { granted } = parse(z.object({ granted: z.boolean() }), req.body);
      const res = await profile.setConsent(trx, req.userId, kind as never, granted);
      // Withdrawing the avatar consent deletes the user's photos and every render, now.
      if (kind === 'avatar' && !granted) await imagegen.deleteAvatar(ctx, trx);
      return res;
    }),
  );
  app.get('/v1/me/style-profile', authed, user((trx) => profile.styleProfile(trx)));
  app.get(
    '/v1/me/export',
    authed,
    user(async (trx, req, reply) => {
      reply.header('content-disposition', `attachment; filename="dressit-export-${new Date().toISOString().slice(0, 10)}.json"`);
      return profile.exportData(trx, req.userId);
    }),
  );
  const deleteMe = async (req: FastifyRequest, reply: FastifyReply) => {
    await profile.deleteAccount(ctx, req.userId, parse(z.object({ password: z.string().min(1).max(200) }), req.body).password);
    return reply.status(204).send();
  };
  app.delete('/v1/me', { ...authed, ...authLimit }, deleteMe);
  // Same operation for clients/proxies that drop bodies on DELETE.
  app.post('/v1/me/delete', { ...authed, ...authLimit }, deleteMe);

  app.get('/v1/geo/search', authed, async (req) => {
    const { q } = parse(z.object({ q: z.string().trim().min(2, 'escribe al menos 2 letras').max(80) }), req.query);
    return ctx.weather.geocode(q);
  });
  app.get(
    '/v1/weather/day',
    authed,
    user(async (trx, req) => {
      const { date } = parse(z.object({ date: isoDate.optional() }), req.query);
      const u = await trx.selectFrom('users').selectAll().where('id', '=', req.userId).executeTakeFirstOrThrow();
      if (u.location_lat === null || u.location_lon === null) throw badRequest('Configura tu ciudad en el perfil para ver el tiempo.');
      const prefs = await profile.getPreferences(trx, req.userId);
      return ctx.weather.day({ lat: Number(u.location_lat), lon: Number(u.location_lon), locationName: u.location_name ?? '', date: date ?? outfits.todayIn(u.timezone), window: prefs.dayWindow });
    }),
  );

  // --- Home --------------------------------------------------------------------
  app.get(
    '/v1/home',
    authed,
    user(async (trx, req): Promise<HomeResponse> => {
      const u = await trx.selectFrom('users').selectAll().where('id', '=', req.userId).executeTakeFirstOrThrow();
      const today = outfits.todayIn(u.timezone);
      const prefs = await profile.getPreferences(trx, req.userId);
      const events = await calendar.listEvents(trx, today, new Date(Date.parse(`${today}T12:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10));
      const todayEvent = events.find((e) => e.occasion && e.startsAt.slice(0, 10) === today);
      const occId = todayEvent?.occasion ?? prefs.usualContexts[0] ?? 'dia_informal';
      let weather = null;
      let weatherError: string | null = null;
      if (u.location_lat !== null && u.location_lon !== null) {
        try {
          weather = await ctx.weather.day({ lat: Number(u.location_lat), lon: Number(u.location_lon), locationName: u.location_name ?? '', date: today, window: prefs.dayWindow });
        } catch (e) {
          weatherError = (e as Error).message;
        }
      } else weatherError = 'Configura tu ciudad para tener en cuenta el tiempo.';
      const plan = (await planner.plannerRange(ctx, trx, today, today))[0]?.plans[0] ?? null;
      const pending = await trx.selectFrom('import_detections').select((eb) => eb.fn.countAll<number>().as('n')).where('state', '=', 'pending').executeTakeFirst();
      const count = await trx.selectFrom('garments').select((eb) => eb.fn.countAll<number>().as('n')).where('status', '!=', 'retired').executeTakeFirst();
      const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: u.timezone, hour: '2-digit', hour12: false }).format(new Date()));
      return {
        greeting: `${h < 13 ? 'Buenos días' : h < 21 ? 'Buenas tardes' : 'Buenas noches'}, ${u.display_name.split(' ')[0]}.`,
        weather,
        weatherError,
        suggestedOccasion: { id: occId, label: getOccasion(occId)?.label ?? occId, fromEventId: todayEvent?.id ?? null },
        upcomingEvents: events.slice(0, 5),
        todayPlan: plan,
        pendingReviewCount: Number(pending?.n ?? 0),
        garmentCount: Number(count?.n ?? 0),
      };
    }),
  );

  // --- Wardrobe ----------------------------------------------------------------
  app.get('/v1/garments', authed, user((trx, req) => wardrobe.listGarments(trx, ctx.signer, parse(listQuery, req.query))));
  app.post(
    '/v1/garments',
    authed,
    user(async (trx, req, reply) => {
      const body = parse(garmentWrite.required({ subcategory: true }), req.body);
      const id = await wardrobe.createGarment(trx, req.userId, body, { source: 'manual' });
      reply.status(201);
      return wardrobe.getGarmentDetail(trx, ctx.signer, id);
    }),
  );
  app.get('/v1/garments/:id', authed, user((trx, req) => wardrobe.getGarmentDetail(trx, ctx.signer, parse(uuid, (req.params as { id: string }).id))));
  app.patch(
    '/v1/garments/:id',
    authed,
    user(async (trx, req) => {
      const id = parse(uuid, (req.params as { id: string }).id);
      await wardrobe.updateGarment(trx, req.userId, id, parse(garmentWrite, req.body));
      return wardrobe.getGarmentDetail(trx, ctx.signer, id);
    }),
  );
  app.delete(
    '/v1/garments/:id',
    authed,
    user(async (trx, req, reply) => {
      const id = parse(uuid, (req.params as { id: string }).id);
      const imgs = await trx.selectFrom('garment_images').select(['storage_key', 'thumb_storage_key']).where('garment_id', '=', id).execute();
      const r = await trx.deleteFrom('garments').where('id', '=', id).returning('id').executeTakeFirst();
      if (!r) throw notFound('Prenda');
      await images.deleteUserFiles(ctx, imgs.flatMap((i) => [i.storage_key, i.thumb_storage_key]));
      return reply.status(204).send();
    }),
  );
  app.post(
    '/v1/garments/bulk',
    authed,
    user(async (trx, req) => ({
      updated: await wardrobe.bulkUpdate(
        trx,
        req.userId,
        parse(
          z.object({
            ids: z.array(uuid).min(1).max(500),
            patch: z.object({ status: z.enum(GARMENT_STATUSES).optional(), spaceId: uuid.nullable().optional(), favorite: z.boolean().optional(), addTags: z.array(z.string().max(40)).max(10).optional(), removeTags: z.array(z.string().max(40)).max(10).optional(), seasons: z.array(seasonEnum).optional(), styles: z.array(styleEnum).optional() }),
          }),
          req.body,
        ),
      ),
    })),
  );
  app.post(
    '/v1/garments/:id/status',
    authed,
    user(async (trx, req) => {
      const id = parse(uuid, (req.params as { id: string }).id);
      const b = parse(z.object({ status: z.enum(GARMENT_STATUSES), note: z.string().max(200).optional(), lentTo: z.string().max(80).optional() }), req.body);
      await wardrobe.changeStatus(trx, req.userId, id, b.status, b.note, b.lentTo);
      if (b.status !== 'available') await trx.insertInto('recommendation_events').values({ user_id: req.userId, kind: 'unavailable', garment_id: id, context: JSON.stringify({ status: b.status }) }).execute();
      return wardrobe.getGarmentDetail(trx, ctx.signer, id);
    }),
  );
  app.post(
    '/v1/garments/:id/wear',
    authed,
    user(async (trx, req) => {
      const id = parse(uuid, (req.params as { id: string }).id);
      const { date } = parse(z.object({ date: isoDate }), req.body);
      await wardrobe.logWear(trx, req.userId, [id], date, null, null);
      return wardrobe.getGarmentDetail(trx, ctx.signer, id);
    }),
  );
  app.get('/v1/garments/:id/similar', authed, user(async (trx, req) => ({ items: await wardrobe.similarGarments(trx, ctx.signer, parse(uuid, (req.params as { id: string }).id)) })));
  app.get('/v1/wardrobe/stats', authed, user((trx) => wardrobe.wardrobeStats(trx, ctx.signer)));

  app.get(
    '/v1/spaces',
    authed,
    user(async (trx) => {
      const rows = await trx
        .selectFrom('wardrobe_spaces as s')
        .select(['s.id', 's.name', 's.kind', 's.position', (eb) => eb.selectFrom('garments as g').select((e) => e.fn.countAll<number>().as('n')).whereRef('g.space_id', '=', 's.id').as('garment_count')])
        .orderBy('s.position')
        .execute();
      return rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind, position: r.position, garmentCount: Number(r.garment_count ?? 0) }));
    }),
  );
  app.post(
    '/v1/spaces',
    authed,
    user(async (trx, req, reply) => {
      const b = parse(z.object({ name: z.string().trim().min(1).max(60), kind: z.enum(SPACE_KINDS).default('armario') }), req.body);
      const wid = await wardrobe.getDefaultWardrobeId(trx, req.userId);
      const pos = Number((await trx.selectFrom('wardrobe_spaces').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirst())?.n ?? 0);
      const r = await trx.insertInto('wardrobe_spaces').values({ user_id: req.userId, wardrobe_id: wid, name: b.name, kind: b.kind, position: pos }).returningAll().executeTakeFirstOrThrow();
      reply.status(201);
      return { id: r.id, name: r.name, kind: r.kind, position: r.position, garmentCount: 0 };
    }),
  );
  app.patch(
    '/v1/spaces/:id',
    authed,
    user(async (trx, req) => {
      const b = parse(z.object({ name: z.string().trim().min(1).max(60).optional(), kind: z.enum(SPACE_KINDS).optional(), position: z.number().int().min(0).optional() }), req.body);
      const r = await trx.updateTable('wardrobe_spaces').set(b).where('id', '=', parse(uuid, (req.params as { id: string }).id)).returningAll().executeTakeFirst();
      if (!r) throw notFound('Espacio');
      const n = await trx.selectFrom('garments').select((eb) => eb.fn.countAll<number>().as('n')).where('space_id', '=', r.id).executeTakeFirst();
      return { id: r.id, name: r.name, kind: r.kind, position: r.position, garmentCount: Number(n?.n ?? 0) };
    }),
  );
  app.delete(
    '/v1/spaces/:id',
    authed,
    user(async (trx, req, reply) => {
      const r = await trx.deleteFrom('wardrobe_spaces').where('id', '=', parse(uuid, (req.params as { id: string }).id)).returning('id').executeTakeFirst();
      if (!r) throw notFound('Espacio');
      return reply.status(204).send();
    }),
  );
  app.get(
    '/v1/tags',
    authed,
    user(async (trx) => {
      const rows = await trx
        .selectFrom('tags as t')
        .select(['t.id', 't.name', (eb) => eb.selectFrom('garment_tags as gt').select((e) => e.fn.countAll<number>().as('n')).whereRef('gt.tag_id', '=', 't.id').as('count')])
        .orderBy('t.name')
        .execute();
      return rows.map((r) => ({ id: r.id, name: r.name, count: Number(r.count ?? 0) }));
    }),
  );


  // --- Catalogue photo: official store photo (reverse image search) or AI packshot ---------
  app.get('/v1/catalog-photos/status', authed, async () => catalogPhoto.catalogPhotoStatus(ctx));
  app.get('/v1/catalog-photos/:id', authed, user((trx, req) => catalogPhoto.getJob(ctx, trx, req.userId, parse(uuid, (req.params as { id: string }).id))));
  app.post(
    '/v1/catalog-photos/:id/choose',
    authed,
    user((trx, req) =>
      catalogPhoto.choose(
        ctx,
        trx,
        req.userId,
        parse(uuid, (req.params as { id: string }).id),
        parse(z.object({ choice: z.enum(['official', 'generated', 'original']), matchId: z.string().max(64).optional(), acceptWarnings: z.boolean().optional() }), req.body),
      ),
    ),
  );
  app.post('/v1/garments/:id/catalog-photo', { ...authed, config: { rateLimit: { max: 30, timeWindow: '1 hour' } } }, async (req, reply) => {
    const garmentId = parse(uuid, (req.params as { id: string }).id);
    const body = parse(z.object({ mode: z.enum(['auto', 'search', 'generate']).optional(), force: z.boolean().optional() }), req.body ?? {});
    const { id, created } = await withUser(ctx.db, req.userId, (trx) => catalogPhoto.createForGarment(ctx, trx, req.userId, garmentId, body));
    if (created) await ctx.queue.enqueueCatalogPhoto({ catalogPhotoId: id, userId: req.userId }); // after commit
    reply.status(202);
    return withUser(ctx.db, req.userId, (trx) => catalogPhoto.getJob(ctx, trx, req.userId, id));
  });
  app.get('/v1/garments/:id/catalog-photo', authed, user((trx, req) => catalogPhoto.latestForGarment(ctx, trx, req.userId, parse(uuid, (req.params as { id: string }).id))));

  // --- Generated images: avatar ------------------------------------------------------
  app.get('/v1/generation/status', authed, async () => imagegen.generationStatus(ctx));
  app.get('/v1/generations/:id', authed, user((trx, req) => imagegen.getJob(ctx, trx, req.userId, parse(uuid, (req.params as { id: string }).id))));
  app.put(
    '/v1/garments/:id/primary-image',
    authed,
    user(async (trx, req, reply) => {
      await imagegen.setPrimaryImage(trx, parse(uuid, (req.params as { id: string }).id), parse(z.object({ imageId: uuid }), req.body).imageId);
      reply.status(204);
    }),
  );
  app.post('/v1/outfits/:id/avatar', { ...authed, config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (req, reply) => {
    const outfitId = parse(uuid, (req.params as { id: string }).id);
    const opts = parse(z.object({ baseId: uuid.optional(), method: z.enum(['sequential', 'joint']).optional() }), req.body ?? {});
    const id = await withUser(ctx.db, req.userId, (trx) => imagegen.createAvatarJob(ctx, trx, req.userId, outfitId, opts));
    await ctx.queue.enqueueGeneration({ generationId: id, userId: req.userId });
    reply.status(202);
    return withUser(ctx.db, req.userId, (trx) => imagegen.getJob(ctx, trx, req.userId, id));
  });
  app.get('/v1/outfits/:id/avatar', authed, user((trx, req) => imagegen.listJobs(ctx, trx, req.userId, { outfitId: parse(uuid, (req.params as { id: string }).id) })));
  app.post('/v1/me/avatar/bases', { ...authed, config: { rateLimit: { max: 30, timeWindow: '1 hour' } } }, async (req, reply) => {
    const body = parse(z.object({ view: z.enum(['frontal', 'tres_cuartos', 'perfil']), background: z.enum(['estudio_gris', 'blanco', 'beige', 'original']) }), req.body);
    const { baseId, jobId } = await withUser(ctx.db, req.userId, (trx) => imagegen.createAvatarBase(ctx, trx, req.userId, body.view, body.background));
    if (jobId) await ctx.queue.enqueueGeneration({ generationId: jobId, userId: req.userId }); // after commit
    reply.status(jobId ? 202 : 201);
    return withUser(ctx.db, req.userId, async (trx) => {
      const profile = await imagegen.getAvatar(ctx, trx, req.userId);
      return { base: profile.bases.find((b) => b.id === baseId)!, job: jobId ? await imagegen.getJob(ctx, trx, req.userId, jobId) : null };
    });
  });
  app.get('/v1/me/avatar', authed, user((trx, req) => imagegen.getAvatar(ctx, trx, req.userId)));
  app.put(
    '/v1/me/avatar',
    authed,
    user((trx, req) =>
      imagegen.setAvatar(ctx, trx, req.userId, parse(z.object({ faceImageId: uuid.nullish(), bodyImageId: uuid.nullish(), attestedSelf: z.boolean(), attestedAdult: z.boolean() }), req.body)),
    ),
  );
  app.delete(
    '/v1/me/avatar',
    authed,
    user(async (trx, _req, reply) => {
      await imagegen.deleteAvatar(ctx, trx);
      reply.status(204);
    }),
  );

  // --- Uploads & images ----------------------------------------------------------
  app.post(
    '/v1/uploads',
    { ...authed, config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    user(async (trx, req, reply) => {
      const file = await req.file();
      if (!file) throw badRequest('Falta el archivo (campo «file»).');
      const buf = await file.toBuffer();
      const kindField = (file.fields.kind as { value?: string } | undefined)?.value ?? 'garment_photo';
      const kind = parse(z.enum(['garment_photo', 'receipt', 'label', 'screenshot', 'inspiration', 'visual_search', 'self_face', 'self_body']), kindField);
      if (kind === 'self_face' || kind === 'self_body') {
        const c = await trx.selectFrom('consents').select('granted').where('kind', '=', 'avatar').orderBy('created_at', 'desc').limit(1).executeTakeFirst();
        if (!c?.granted) throw badRequest('Activa el consentimiento «Tu avatar» antes de subir tus fotos.');
      }
      const stored = await images.storeUpload(ctx, trx, req.userId, buf, kind);
      reply.status(201);
      return { imageId: stored.id, duplicateOfImageId: stored.duplicateOfImageId };
    }),
  );
  app.get('/v1/images/:id', async (req, reply) => {
    const id = parse(uuid, (req.params as { id: string }).id);
    const q = parse(z.object({ v: z.enum(['original', 'cutout', 'thumb']), u: uuid, exp: z.coerce.number(), sig: z.string().max(100) }), req.query);
    if (!ctx.signer.verify(q.u, id, q.v, q.exp, q.sig)) throw unauthorized('Enlace de imagen caducado o no válido.');
    const img = await withUser(ctx.db, q.u, (trx) => images.readImage(ctx, trx, id, q.v));
    if (!img) throw notFound('Imagen');
    return reply.header('cache-control', 'private, max-age=3600').type(img.mime).send(img.body);
  });

  // --- Imports -------------------------------------------------------------------
  app.post(
    '/v1/imports/photos',
    authed,
    async (req, reply) => {
      const body = parse(z.object({ imageIds: z.array(uuid).min(1).max(50), mode: z.enum(['single', 'multi']), source: z.enum(['camera', 'gallery', 'batch']) }), req.body);
      const jobId = await withUser(ctx.db, req.userId, (trx) => imports.createPhotoImport(ctx, trx, req.userId, body));
      await ctx.queue.enqueueImageAnalysis({ importJobId: jobId, userId: req.userId }); // after commit
      reply.status(202);
      return withUser(ctx.db, req.userId, async (trx) => imports.jobDto(ctx, trx, req.userId, await imports.getJob(trx, jobId)));
    },
  );
  app.get(
    '/v1/imports',
    authed,
    user(async (trx, req) => {
      const { status } = parse(z.object({ status: z.enum(['queued', 'processing', 'needs_review', 'completed', 'failed', 'cancelled']).optional() }), req.query);
      let q = trx.selectFrom('import_jobs').selectAll().where('kind', '=', 'image_analysis').orderBy('created_at', 'desc').limit(50);
      if (status) q = q.where('status', '=', status);
      return Promise.all((await q.execute()).map((j) => imports.jobDto(ctx, trx, req.userId, j)));
    }),
  );
  app.get('/v1/imports/:jobId', authed, user(async (trx, req) => imports.jobDto(ctx, trx, req.userId, await imports.getJob(trx, parse(uuid, (req.params as { jobId: string }).jobId)))));
  app.post('/v1/imports/:jobId/retry', authed, async (req, reply) => {
    const jobId = parse(uuid, (req.params as { jobId: string }).jobId);
    await withUser(ctx.db, req.userId, async (trx) => {
      const job = await imports.getJob(trx, jobId);
      if (job.status !== 'failed') throw badRequest('Solo se pueden reintentar importaciones fallidas.');
      await trx.updateTable('import_jobs').set({ status: 'queued', error: null, attempts: 0 }).where('id', '=', jobId).execute();
    });
    await ctx.queue.enqueueImageAnalysis({ importJobId: jobId, userId: req.userId });
    reply.status(202);
    return withUser(ctx.db, req.userId, async (trx) => imports.jobDto(ctx, trx, req.userId, await imports.getJob(trx, jobId)));
  });
  app.post(
    '/v1/imports/:jobId/detections/:detectionId/accept',
    authed,
    user(async (trx, req) => {
      const p = req.params as { jobId: string; detectionId: string };
      const body = parse(z.object({ overrides: garmentWrite.optional() }), req.body ?? {});
      const id = await imports.acceptDetection(ctx, trx, req.userId, parse(uuid, p.jobId), parse(uuid, p.detectionId), body.overrides ?? {});
      return wardrobe.getGarmentDetail(trx, ctx.signer, id);
    }),
  );
  const recutBody = z.object({ points: z.array(z.tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.union([z.literal(0), z.literal(1)])])).min(1).max(20) });
  app.post(
    '/v1/imports/:jobId/detections/:detectionId/recut',
    { ...authed, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    user((trx, req) => {
      const p = req.params as { jobId: string; detectionId: string };
      return recut.recutDetection(ctx, trx, req.userId, parse(uuid, p.jobId), parse(uuid, p.detectionId), parse(recutBody, req.body).points as recut.RecutPoint[]);
    }),
  );
  app.get(
    '/v1/imports/:jobId/detections/:detectionId/recut',
    authed,
    user((trx, req) => {
      const p = req.params as { jobId: string; detectionId: string };
      return recut.detectionRecutSource(ctx, trx, req.userId, parse(uuid, p.jobId), parse(uuid, p.detectionId));
    }),
  );
  app.get('/v1/garments/:id/recut', authed, user((trx, req) => recut.garmentRecutSource(ctx, trx, req.userId, parse(uuid, (req.params as { id: string }).id))));
  app.post(
    '/v1/garments/:id/recut',
    { ...authed, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    user((trx, req) => recut.recutGarment(ctx, trx, req.userId, parse(uuid, (req.params as { id: string }).id), parse(recutBody, req.body).points as recut.RecutPoint[])),
  );
  app.post(
    '/v1/imports/:jobId/detections/:detectionId/reject',
    authed,
    user(async (trx, req) => {
      const p = req.params as { jobId: string; detectionId: string };
      await imports.rejectDetection(trx, parse(uuid, p.jobId), parse(uuid, p.detectionId));
      const job = await imports.jobDto(ctx, trx, req.userId, await imports.getJob(trx, p.jobId));
      return job.detections.find((d) => d.id === p.detectionId)!;
    }),
  );
  app.post('/v1/imports/:jobId/accept-all', authed, user((trx, req) => imports.acceptAll(ctx, trx, req.userId, parse(uuid, (req.params as { jobId: string }).jobId))));

  app.post('/v1/imports/link', { ...authed, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, user((trx, req) => link.importLink(ctx, trx, req.userId, parse(z.object({ url: z.string().trim().min(8).max(2000) }), req.body).url)));
  app.post(
    '/v1/imports/link/capture',
    authed,
    user((trx, req) =>
      link.importCapture(
        ctx,
        trx,
        req.userId,
        parse(
          z.object({
            url: z.string().trim().min(8).max(2000),
            jsonLd: z.array(z.string().max(200_000)).max(20),
            meta: z.record(z.string().max(200), z.string().max(4000)),
            microdata: z.record(z.string().max(60), z.string().max(4000)).optional(),
            title: z.string().max(500).nullable(),
            capturedAt: z.string().max(40),
          }),
          req.body,
        ),
      ),
    ),
  );
  app.get('/v1/imports/link/:id', authed, user(async (trx, req) => link.importedToDto(trx, await link.getImported(trx, parse(uuid, (req.params as { id: string }).id)))));
  const linkToWardrobe = z.object({ size: z.string().max(20).nullable().optional(), colorName: z.string().max(60).nullable().optional(), imageId: uuid.nullable().optional(), purchaseDate: isoDate.nullable().optional(), purchasePriceCents: z.number().int().min(0).nullable().optional(), overrides: garmentWrite.optional() });
  app.post(
    '/v1/imports/link/:id/to-wardrobe',
    authed,
    user(async (trx, req, reply) => {
      const id = await link.importedToWardrobe(ctx, trx, req.userId, parse(uuid, (req.params as { id: string }).id), parse(linkToWardrobe, req.body ?? {}) as never);
      reply.status(201);
      return wardrobe.getGarmentDetail(trx, ctx.signer, id);
    }),
  );
  app.post('/v1/imports/link/:id/to-wishlist', authed, user((trx, req) => shopping.addToWishlist(ctx, trx, req.userId, { kind: 'imported', id: parse(uuid, (req.params as { id: string }).id) })));
  app.post(
    '/v1/imports/text',
    authed,
    user((trx, req) => imports.parseReceiptText(ctx, trx, parse(z.object({ text: z.string().max(50_000).default(''), imageId: uuid.nullable().optional(), source: z.enum(['receipt', 'screenshot', 'email', 'label', 'retailer_export']) }), req.body) as never)),
  );

  // --- Outfits -------------------------------------------------------------------
  app.post('/v1/outfits/recommendations', authed, user((trx, req) => outfits.recommend(ctx, trx, req.userId, parse(recRequest, req.body ?? {}))));
  app.get('/v1/outfits', authed, user((trx, req) => outfits.listOutfits(ctx, trx, parse(z.object({ filter: z.enum(['saved', 'favorites', 'all']).default('saved') }), req.query).filter)));
  app.post(
    '/v1/outfits',
    authed,
    user(async (trx, req, reply) => {
      reply.status(201);
      return outfits.createManual(ctx, trx, req.userId, parse(z.object({ name: z.string().max(80).optional(), occasion: z.string().refine((o) => !!getOccasion(o)).optional(), items: z.array(z.object({ slot, garmentId: uuid })).min(1).max(10) }), req.body));
    }),
  );
  app.get(
    '/v1/outfits/:id',
    authed,
    user(async (trx, req) => {
      const [o] = await outfits.loadOutfitDtos(trx, ctx.signer, [parse(uuid, (req.params as { id: string }).id)]);
      if (!o) throw notFound('Conjunto');
      return o;
    }),
  );
  app.delete(
    '/v1/outfits/:id',
    authed,
    user(async (trx, req, reply) => {
      const r = await trx.deleteFrom('outfits').where('id', '=', parse(uuid, (req.params as { id: string }).id)).returning('id').executeTakeFirst();
      if (!r) throw notFound('Conjunto');
      return reply.status(204).send();
    }),
  );
  app.get('/v1/outfits/:id/alternatives', authed, user((trx, req) => outfits.alternatives(ctx, trx, req.userId, parse(uuid, (req.params as { id: string }).id), parse(z.object({ slot }), req.query).slot)));
  app.post(
    '/v1/outfits/:id/swap',
    authed,
    user((trx, req) => {
      const b = parse(z.object({ slot, garmentId: uuid.nullable() }), req.body);
      return outfits.swap(ctx, trx, req.userId, parse(uuid, (req.params as { id: string }).id), b.slot, b.garmentId);
    }),
  );
  app.post(
    '/v1/outfits/:id/feedback',
    authed,
    user((trx, req) =>
      outfits.feedback(ctx, trx, req.userId, parse(uuid, (req.params as { id: string }).id), parse(z.object({ action: z.enum(['accept', 'reject', 'save', 'unsave', 'favorite', 'unfavorite', 'rate']), rating: z.number().int().min(1).max(5).optional(), reasons: z.array(z.enum(['colores', 'formalidad', 'abrigo', 'estilo', 'comodidad', 'repetido', 'otro'])).max(7).optional() }), req.body)),
    ),
  );
  app.post('/v1/outfits/:id/wear', authed, user((trx, req) => outfits.wear(ctx, trx, req.userId, parse(uuid, (req.params as { id: string }).id), parse(z.object({ date: isoDate }), req.body).date)));
  app.get(
    '/v1/history',
    authed,
    user((trx, req) => {
      const q = parse(z.object({ from: isoDate.optional(), to: isoDate.optional() }), req.query);
      const to = q.to ?? new Date().toISOString().slice(0, 10);
      const from = q.from ?? new Date(Date.parse(`${to}T12:00:00Z`) - 90 * 86_400_000).toISOString().slice(0, 10);
      return outfits.history(ctx, trx, from, to);
    }),
  );

  // --- Calendar, planner, trips ------------------------------------------------------
  const eventWrite = z.object({ title: z.string().trim().min(1).max(200), occasion: z.string().max(30).nullable().optional(), startsAt: z.string().datetime({ offset: true }), endsAt: z.string().datetime({ offset: true }).nullable().optional(), isOutdoor: z.boolean().nullable().optional(), locationName: z.string().max(200).nullable().optional() });
  app.get('/v1/events', authed, user((trx, req) => {
    const q = parse(z.object({ from: isoDate, to: isoDate }), req.query);
    return calendar.listEvents(trx, q.from, q.to);
  }));
  app.post('/v1/events', authed, user(async (trx, req, reply) => {
    reply.status(201);
    return calendar.createEvent(trx, req.userId, parse(eventWrite, req.body) as never);
  }));
  app.patch('/v1/events/:id', authed, user((trx, req) => calendar.updateEvent(trx, parse(uuid, (req.params as { id: string }).id), parse(eventWrite.partial(), req.body) as never)));
  app.delete('/v1/events/:id', authed, user(async (trx, req, reply) => {
    await calendar.deleteEvent(trx, parse(uuid, (req.params as { id: string }).id));
    return reply.status(204).send();
  }));
  app.post(
    '/v1/events/sync-device',
    authed,
    user((trx, req) =>
      calendar.syncDevice(
        trx,
        req.userId,
        parse(
          z.object({
            events: z.array(z.object({ externalId: z.string().min(1).max(200), title: z.string().max(300), startsAt: z.string().datetime({ offset: true }), endsAt: z.string().datetime({ offset: true }).nullable(), allDay: z.boolean(), locationName: z.string().max(300).nullable() })).max(500),
            rangeStart: z.string().datetime({ offset: true }),
            rangeEnd: z.string().datetime({ offset: true }),
          }),
          req.body,
        ),
      ),
    ),
  );
  app.get('/v1/planner', authed, user((trx, req) => {
    const q = parse(z.object({ from: isoDate, to: isoDate }), req.query);
    return planner.plannerRange(ctx, trx, q.from, q.to);
  }));
  const planWrite = z.object({ date: isoDate, outfitId: uuid, eventId: uuid.nullable().optional(), note: z.string().max(300).nullable().optional(), position: z.number().int().min(0).optional() });
  app.post('/v1/planner', authed, user(async (trx, req, reply) => {
    reply.status(201);
    return planner.createPlan(ctx, trx, req.userId, parse(planWrite, req.body) as never);
  }));
  app.patch('/v1/planner/:id', authed, user((trx, req) => planner.movePlan(ctx, trx, parse(uuid, (req.params as { id: string }).id), parse(planWrite.partial(), req.body) as never)));
  app.delete('/v1/planner/:id', authed, user(async (trx, req, reply) => {
    await planner.deletePlan(trx, parse(uuid, (req.params as { id: string }).id));
    return reply.status(204).send();
  }));
  app.post('/v1/planner/suggest-week', authed, user((trx, req) => planner.suggestWeek(ctx, trx, req.userId, parse(z.object({ from: isoDate, days: z.number().int().min(1).max(14), occasions: z.record(isoDate, z.string()).optional() }), req.body))));
  app.get('/v1/trips', authed, user((trx) => trips.listTrips(ctx, trx)));
  app.post('/v1/trips', authed, user(async (trx, req, reply) => {
    reply.status(201);
    return trips.createTrip(
      ctx,
      trx,
      req.userId,
      parse(z.object({ destinationName: z.string().trim().min(1).max(100), lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180), startDate: isoDate, endDate: isoDate, activities: z.array(z.string().max(60)).max(10), luggage: z.enum(['mochila', 'cabina', 'mediana', 'grande']) }), req.body),
    );
  }));
  app.get('/v1/trips/:id', authed, user((trx, req) => trips.getTrip(ctx, trx, parse(uuid, (req.params as { id: string }).id))));
  app.delete('/v1/trips/:id', authed, user(async (trx, req, reply) => {
    await trips.deleteTrip(trx, parse(uuid, (req.params as { id: string }).id));
    return reply.status(204).send();
  }));
  app.patch('/v1/trips/:id/packing/:garmentId', authed, user((trx, req) => {
    const p = req.params as { id: string; garmentId: string };
    return trips.setPacked(ctx, trx, parse(uuid, p.id), parse(uuid, p.garmentId), parse(z.object({ packed: z.boolean() }), req.body).packed);
  }));

  // --- Retail, catalog, shopping ---------------------------------------------------
  app.get('/v1/retailers', authed, async (): Promise<RetailerIntegrationDto[]> => {
    const rows = await ctx.db.selectFrom('retailer_integrations').selectAll().execute();
    // Latest ingestion run per integration: `error` / `operational` come from real runs, never from config alone.
    const runs = await ctx.db
      .selectFrom('catalog_sync_runs')
      .select(['integration_id', 'status', 'error', 'started_at', 'finished_at'])
      .distinctOn('integration_id')
      .where('integration_id', 'is not', null)
      .orderBy('integration_id')
      .orderBy('started_at', 'desc')
      .execute();
    const lastRun = new Map(runs.map((r) => [r.integration_id!, r]));
    const SOURCE_LABEL: Record<CatalogSourceStatus, string> = { pending_credentials: 'pendiente de credenciales', configured: 'configurado, pendiente de la primera ingesta', operational: 'operativo', error: 'error en la última ingesta', unsupported: 'sin adaptador' };
    return RETAILERS.map((r) => {
      const ints = rows.filter((i) => i.retailer_id === r.id);
      const caps = Object.assign({}, ...ints.filter((i) => i.status === 'operational' || i.kind === 'page_capture' || i.kind === 'link_import').map((i) => i.capabilities as object)) as Record<string, boolean>;
      const catalogOk = ints.some((i) => ['affiliate_feed', 'official_api', 'data_provider'].includes(i.kind) && i.status === 'operational');
      const linkOk = ints.some((i) => i.kind === 'link_import' && i.status === 'operational');
      const pending = ints.filter((i) => i.status === 'pending_authorization');
      // Overall status: catalog integration live > server link import verified > on-device capture only > nothing yet.
      const hasUserImport = ints.some((i) => i.kind === 'link_import' || i.kind === 'page_capture');
      const status = catalogOk ? 'operational' : linkOk ? 'partial' : hasUserImport ? 'link_only' : 'pending_authorization';
      const linkRow = ints.find((i) => i.kind === 'link_import');
      const catalogSources: CatalogSourceStatusDto[] = ints
        .filter((i) => ['affiliate_feed', 'official_api', 'data_provider'].includes(i.kind))
        .map((i) => {
          const def = r.integrations.find((d) => d.kind === i.kind && d.provider === i.provider);
          const run = lastRun.get(i.id);
          const lastSyncAt = (run?.finished_at ?? run?.started_at)?.toISOString() ?? null;
          const base = { provider: i.provider, credentialsEnv: i.credentials_env, lastSyncAt };
          if (run?.status === 'failed') return { ...base, status: 'error' as const, detail: `Error en la última ingesta: ${run.error ?? 'desconocido'}` };
          if (i.status === 'operational') return { ...base, status: 'operational' as const, detail: i.last_check_result ?? 'Ingesta correcta' };
          const cfgStatus = ctx.catalog.statusFor(i.provider, r.id, def?.programId ?? null);
          return { ...base, status: cfgStatus.status as CatalogSourceStatus, detail: cfgStatus.detail };
        });
      const sourceNotes = catalogSources.map((c) => `Catálogo ${c.provider}: ${SOURCE_LABEL[c.status]}.`);
      return {
        retailer: { id: r.id, name: r.name, group: r.group },
        domains: r.domains,
        status,
        capabilities: { linkImport: !!caps.linkImport, pageCapture: !!caps.pageCapture, catalogSearch: catalogOk, prices: !!caps.prices, availability: !!caps.availability, images: catalogOk && !!caps.images, affiliateLinks: catalogOk && !!caps.affiliateLinks, visualSearch: catalogOk },
        imagePolicy: (catalogOk ? 'licensed' : (linkRow?.image_policy ?? 'none')) as RetailerIntegrationDto['imagePolicy'],
        provider: ints.map((i) => i.provider).join(', '),
        notes: [...ints.map((i) => i.notes), ...sourceNotes].filter(Boolean).join(' '),
        requires: pending.map((p) => p.requires).filter(Boolean).join(' ') || null,
        lastCheckedAt: linkRow?.last_checked_at?.toISOString() ?? null,
        lastCheckResult: linkRow?.last_check_result ?? null,
        catalogSources,
      };
    });
  });
  app.get('/v1/catalog/search', authed, async (req) =>
    catalog.searchCatalog(
      ctx.db,
      parse(
        z.object({
          q: z.string().max(100).optional(),
          retailer: z.string().max(40).optional(),
          brand: z.string().max(60).optional(),
          category: z.enum(CATEGORIES).optional(),
          subcategory: z.string().max(40).optional(),
          color: z.string().max(30).optional(),
          style: styleEnum.optional(),
          size: z.string().max(10).optional(),
          minPrice: z.coerce.number().min(0).optional(),
          maxPrice: z.coerce.number().min(0).optional(),
          inStock: z.coerce.boolean().optional(),
          sort: z.enum(['relevance', 'price_asc', 'price_desc', 'newest', 'discount']).optional(),
          cursor: z.string().max(12).optional(),
          limit: z.coerce.number().int().min(1).max(100).optional(),
        }),
        req.query,
      ),
      ctx.cfg.PRICE_FRESHNESS_HOURS,
    ),
  );
  app.get('/v1/catalog/products/:id', authed, async (req) => catalog.getCatalogProduct(ctx.db, parse(uuid, (req.params as { id: string }).id), ctx.cfg.PRICE_FRESHNESS_HOURS));
  const SECTIONS = ['para_ti', 'completa_armario', 'combina_favoritos', 'novedades', 'versatiles', 'ofertas_marcas', 'bajo_presupuesto'] as const;
  app.get('/v1/shopping/sections', authed, user((trx, req) => {
    const { sections } = parse(z.object({ sections: z.string().max(200).optional() }), req.query);
    const wanted = (sections ? sections.split(',') : [...SECTIONS]).filter((s): s is ShoppingSection => (SECTIONS as readonly string[]).includes(s));
    return shopping.sections(ctx, trx, req.userId, wanted);
  }));
  app.get('/v1/shopping/gaps', authed, user((trx, req) => shopping.gaps(ctx, trx, req.userId)));
  app.post('/v1/shopping/simulate', authed, user((trx, req) => shopping.simulate(ctx, trx, req.userId, parse(z.object({ product: productRef, occasion: z.string().max(30).optional(), limit: z.number().int().min(1).max(10).optional() }), req.body))));
  app.post('/v1/shopping/visual-search', authed, user((trx, req) => shopping.visualSearch(ctx, trx, parse(z.object({ imageId: uuid, category: z.enum(CATEGORIES).optional(), limit: z.number().int().min(1).max(50).optional() }), req.body))));
  app.post('/v1/shopping/outbound', authed, user((trx, req) => {
    const b = parse(z.object({ product: productRef, context: z.string().max(40).optional() }), req.body);
    return shopping.outbound(ctx, trx, req.userId, b.product, b.context);
  }));
  app.get('/v1/wishlist', authed, user((trx) => shopping.listWishlist(ctx, trx)));
  app.post('/v1/wishlist', authed, user(async (trx, req, reply) => {
    const b = parse(z.object({ product: productRef, note: z.string().max(300).optional() }), req.body);
    reply.status(201);
    return shopping.addToWishlist(ctx, trx, req.userId, b.product, b.note);
  }));
  app.delete('/v1/wishlist/:id', authed, user(async (trx, req, reply) => {
    await shopping.removeFromWishlist(trx, parse(uuid, (req.params as { id: string }).id));
    return reply.status(204).send();
  }));
  app.post('/v1/wishlist/:id/owned', authed, user(async (trx, req, reply) => {
    const id = await shopping.wishlistOwned(ctx, trx, req.userId, parse(uuid, (req.params as { id: string }).id), parse(linkToWardrobe, req.body ?? {}) as never);
    reply.status(201);
    return wardrobe.getGarmentDetail(trx, ctx.signer, id);
  }));

  // --- Assistant -------------------------------------------------------------------
  const deviceIntent = z.object({
    kind: z.enum(['outfit', 'trip', 'shopping', 'gaps', 'weather', 'count', 'other']),
    when: z.enum(['hoy', 'manana', 'pasado_manana', 'dia_semana', 'fecha', 'sin_fecha']),
    weekday: z.enum(['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo']).nullish(),
    dayOfMonth: z.number().int().min(0).max(31).nullish(),
    occasion: z.string().max(40).nullish(),
    formality: z.number().min(-1).max(1).optional(),
    warmth: z.number().min(-1).max(1).optional(),
    destination: z.string().max(80).nullish(),
    days: z.number().int().min(0).max(60).nullish(),
    subcategory: z.string().max(40).nullish(),
    color: z.string().max(40).nullish(),
    maxPrice: z.number().min(0).max(100_000).nullish(),
    garmentPhrase: z.string().max(120).nullish(),
    exclude: z.array(z.string().max(40)).max(10).optional(),
    model: z.string().max(80).optional(),
  });
  app.post('/v1/assistant/messages', { ...authed, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, user((trx, req) => assistant.converse(ctx, trx, req.userId, parse(z.object({ conversationId: uuid.optional(), text: z.string().trim().min(1).max(1000), deviceIntent: deviceIntent.optional() }), req.body))));

}
