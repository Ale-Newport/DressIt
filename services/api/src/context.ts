import type { Config } from './config.ts';
import type { Database } from './db/index.ts';
import type { Storage } from './lib/storage.ts';
import type { UrlSigner } from './lib/signing.ts';
import type { TokenService } from './lib/tokens.ts';
import type { VisionClient } from './modules/vision/client.ts';
import type { WeatherService } from './modules/weather/service.ts';
import type { JobQueue } from './jobs/queue.ts';
import type { CatalogProviders } from './modules/catalog/providers.ts';

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
}
