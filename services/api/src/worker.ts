/** Separate worker process for background jobs (production). */
import { loadConfig } from './config.ts';
import { createDb } from './db/index.ts';
import { BullJobQueue } from './jobs/queue.ts';
import { processImageAnalysis } from './modules/imports/photo-pipeline.ts';
import { createImageGenerator } from './modules/imagegen/generator.ts';
import { TryonClient } from './modules/imagegen/tryon.ts';
import { processGeneration } from './modules/imagegen/service.ts';
import { createCatalogPhotoProviders, processCatalogPhoto } from './modules/catalog-photo/service.ts';
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
const imagegen = createImageGenerator(cfg);
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
  imagegen,
  tryon: cfg.TRYON_SERVICE_URL ? new TryonClient(cfg.TRYON_SERVICE_URL, cfg.TRYON_TIMEOUT_MS) : null,
  catalogPhoto: createCatalogPhotoProviders(cfg, imagegen),
};
await queue.startWorker((job, attempt) => processImageAnalysis(ctx, job, attempt));
await queue.startGenerationWorker((job, attempt) => processGeneration(ctx, job, attempt));
await queue.startCatalogPhotoWorker((job, attempt) => processCatalogPhoto(ctx, job, attempt), cfg.CATALOG_PHOTO_CONCURRENCY);
console.log('Worker de DressIt escuchando las colas image-analysis, image-generation y catalog-photo');
const stop = async () => {
  await queue.close();
  await db.destroy();
  process.exit(0);
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
