/** Separate worker process for background jobs (production). */
import { loadConfig } from './config.ts';
import { createDb } from './db/index.ts';
import { BullJobQueue } from './jobs/queue.ts';
import { processImageAnalysis } from './modules/imports/photo-pipeline.ts';
import { VisionClient } from './modules/vision/client.ts';
import { WeatherService } from './modules/weather/service.ts';
import { UrlSigner } from './lib/signing.ts';
import { TokenService } from './lib/tokens.ts';
import { createStorage } from './lib/storage.ts';
import { createCatalogProviders } from './modules/catalog/providers.ts';
import type { AppContext } from './context.ts';

const cfg = loadConfig();
const { db } = createDb(cfg.DATABASE_URL, 5);
const queue = new BullJobQueue(cfg.REDIS_URL);
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
};
await queue.startWorker((job, attempt) => processImageAnalysis(ctx, job, attempt));
console.log('Worker de DressIt escuchando la cola image-analysis');
const stop = async () => {
  await queue.close();
  await db.destroy();
  process.exit(0);
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
