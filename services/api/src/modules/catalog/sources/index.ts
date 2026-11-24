/**
 * Registry of official catalog sources. Each adapter is disabled until its credentials are set
 * and reports its status honestly per retailer (pending_credentials / configured); `error` and
 * `operational` come from the last ingestion run stored in the database (see routes /v1/retailers).
 */
import type { Config } from '../../../config.ts';
import { awinEnhancedSource, awinFeedSource } from './awin.ts';
import { cjSource } from './cj.ts';
import { defaultHttpDeps, type HttpDeps } from './http.ts';
import { rakutenSource } from './rakuten.ts';
import { tradedoublerSource } from './tradedoubler.ts';
import type { CatalogSource, RetailerSourceStatus, SourceProvider } from './types.ts';

export type { CatalogSource, FeedProduct, IngestJob, Provenance, SourceProvider, SourceStatus } from './types.ts';

export const ADAPTER_PROVIDERS: readonly SourceProvider[] = ['awin', 'rakuten', 'tradedoubler', 'cj'];

/**
 * @param awinRegistry retailerId → Awin advertiser id (verified programme ids from the retailer registry)
 */
export function createCatalogSources(cfg: Config, awinRegistry: Map<string, string>, deps: HttpDeps = defaultHttpDeps): CatalogSource[] {
  return [awinFeedSource(cfg, awinRegistry, deps), awinEnhancedSource(cfg, deps), rakutenSource(cfg, deps), tradedoublerSource(cfg, deps), cjSource(cfg, deps)];
}

/** Combined status of every adapter of one provider for one retailer (best one wins). */
export function providerStatusFor(sources: CatalogSource[], provider: string, retailerId: string, programId: string | null): RetailerSourceStatus | { status: 'unsupported'; detail: string } {
  const mine = sources.filter((s) => s.provider === provider);
  if (!mine.length) return { status: 'unsupported', detail: 'No hay adaptador implementado para esta vía: requiere acuerdo o documentación que todavía no tenemos.' };
  const statuses = mine.map((s) => s.statusFor(retailerId, programId));
  return statuses.find((s) => s.status === 'configured') ?? statuses[0]!;
}
