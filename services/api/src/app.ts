import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { Config } from './config.ts';
import type { AppContext } from './context.ts';
import { createDb } from './db/index.ts';
import { AppError } from './lib/errors.ts';
import { httpDuration, registry } from './lib/metrics.ts';
import { UrlSigner } from './lib/signing.ts';
import { createStorage } from './lib/storage.ts';
import { TokenService } from './lib/tokens.ts';
import { BullJobQueue, InlineJobQueue, type JobQueue } from './jobs/queue.ts';
import { processImageAnalysis } from './modules/imports/photo-pipeline.ts';
import { VisionClient } from './modules/vision/client.ts';
import { WeatherService } from './modules/weather/service.ts';
import { createCatalogProviders } from './modules/catalog/providers.ts';
import { syncRetailers } from './modules/retail/sync.ts';
import { routes } from './routes.ts';

declare module 'fastify' {
  interface FastifyRequest {
    userId: string;
  }
}

export interface BuildOptions {
  cfg: Config;
  queue?: JobQueue;
  /** Start the job processor inside the API process (dev/tests). */
  inlineWorker?: boolean;
  overrides?: Partial<AppContext>;
}

export async function buildApp(opts: BuildOptions): Promise<{ app: FastifyInstance; ctx: AppContext; close: () => Promise<void> }> {
  const { cfg } = opts;
  const { db, pool } = createDb(cfg.DATABASE_URL);
  const queue = opts.queue ?? (opts.inlineWorker ? new InlineJobQueue() : new BullJobQueue(cfg.REDIS_URL));
  const ctx: AppContext = {
    cfg,
    db,
    storage: createStorage(cfg),
    signer: new UrlSigner(cfg.IMAGE_URL_SECRET, cfg.API_PUBLIC_URL),
    tokens: new TokenService(cfg.JWT_SECRET),
    vision: new VisionClient(cfg.VISION_SERVICE_URL, cfg.VISION_TIMEOUT_MS),
    weather: new WeatherService(db, cfg.OPEN_METEO_API_KEY),
    queue,
    catalog: createCatalogProviders(cfg),
    ...opts.overrides,
  };
  if (opts.inlineWorker) await queue.startWorker((job, attempt) => processImageAnalysis(ctx, job, attempt));
  await syncRetailers(ctx.db);

  const app = Fastify({
    logger: cfg.NODE_ENV === 'test' ? false : { level: cfg.LOG_LEVEL, redact: ['req.headers.authorization', 'req.headers.cookie', 'body.password', 'body.refreshToken'] },
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: true,
    genReqId: () => crypto.randomUUID(),
  });

  await app.register(helmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } });
  await app.register(cors, { origin: cfg.NODE_ENV === 'production' ? false : true });
  // Rate limiting is always on outside the automated test suite (which creates many users per minute).
  if (cfg.NODE_ENV !== 'test') await app.register(rateLimit, { max: 300, timeWindow: '1 minute', keyGenerator: (req) => req.headers.authorization?.slice(-24) ?? req.ip });
  await app.register(multipart, { limits: { fileSize: 15 * 1024 * 1024, files: 1, fields: 10 } });
  await app.register(swagger, {
    openapi: {
      info: { title: 'DressIt API', version: '0.1.0', description: 'API del armario digital, estilista IA y personal shopper. Contrato de tipos: packages/shared/src/api.ts' },
      components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  app.decorateRequest('userId', '');
  app.addHook('onResponse', async (req, reply) => {
    httpDuration.observe({ method: req.method, route: req.routeOptions.url ?? 'unknown', status: String(reply.statusCode) }, reply.elapsedTime / 1000);
  });

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string; validation?: unknown }, req, reply) => {
    if (err instanceof AppError) {
      if (err.statusCode >= 500) req.log.warn({ err, details: err.details }, err.message);
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message, ...(err.details && err.statusCode < 500 ? { details: err.details } : {}) } });
    }
    if (err.statusCode === 429) return reply.status(429).send({ error: { code: 'rate_limited', message: 'Demasiadas peticiones. Espera un momento.' } });
    if (err.code === 'FST_REQ_FILE_TOO_LARGE') return reply.status(413).send({ error: { code: 'file_too_large', message: 'La imagen supera el tamaño máximo (15 MB).' } });
    if (err.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ error: { code: err.code ?? 'bad_request', message: 'Petición no válida.' } });
    req.log.error({ err }, 'Unhandled error');
    return reply.status(500).send({ error: { code: 'internal', message: 'Ha ocurrido un error inesperado. Inténtalo de nuevo.' } });
  });
  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: { code: 'not_found', message: 'Ruta no encontrada.' } }));

  const requireAuth = async (req: FastifyRequest, _reply: FastifyReply) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new AppError(401, 'unauthorized', 'Necesitas iniciar sesión.');
    req.userId = await ctx.tokens.verifyAccess(header.slice(7));
  };

  app.get('/health', async () => ({ status: 'ok', time: new Date().toISOString() }));
  app.get('/ready', async (_req, reply) => {
    const checks: Record<string, string> = {};
    try {
      await pool.query('select 1');
      checks.database = 'ok';
    } catch {
      checks.database = 'error';
    }
    const vision = await ctx.vision.health();
    checks.vision = vision ? `ok (${vision.backend ?? 'desconocido'})` : 'no disponible';
    checks.queue = queue.mode;
    checks.storage = ctx.storage.kind;
    return reply.status(checks.database === 'ok' ? 200 : 503).send({ status: checks.database === 'ok' ? 'ok' : 'degraded', checks });
  });
  app.get('/metrics', async (_req, reply) => reply.type(registry.contentType).send(await registry.metrics()));

  await routes(app, ctx, requireAuth);

  const close = async () => {
    await app.close();
    await queue.close();
    await db.destroy();
  };
  return { app, ctx, close };
}
