import type { Config } from './config.ts';
import type { Database } from './db/index.ts';
import type { Storage } from './lib/storage.ts';
import type { UrlSigner } from './lib/signing.ts';
import type { TokenService } from './lib/tokens.ts';
import type { VisionClient } from './modules/vision/client.ts';
import type { WeatherService } from './modules/weather/service.ts';
import type { JobQueue } from './jobs/queue.ts';
import type { CatalogProviders } from './modules/catalog/providers.ts';
import type { ImageGenerator } from './modules/imagegen/generator.ts';
import type { TryonService } from './modules/imagegen/tryon.ts';
import type { CatalogPhotoProviders } from './modules/catalog-photo/service.ts';

/** Everything a module needs; built once in app.ts and passed explicitly (easy to fake in tests). */
export interface AppContext {
  cfg: Config;
  db: Database;
  storage: Storage;
  signer: UrlSigner;
  tokens: TokenService;
  vision: VisionClient;
  weather: WeatherService;
  queue: JobQueue;
  catalog: CatalogProviders;
  imagegen: ImageGenerator;
  /** null when TRYON_SERVICE_URL is not set. */
  tryon: TryonService | null;
  /** Reverse image search and packshot generators (only the configured ones are used). */
  catalogPhoto: CatalogPhotoProviders;
}
