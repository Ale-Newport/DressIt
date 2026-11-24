/**
 * Commercial catalog providers. Each official source (affiliate feed or product API) is an adapter
 * in ./sources/ mapping its documented format to the same FeedProduct model. Only providers with
 * credentials configured are enabled; nothing here calls private retailer endpoints.
 */
import type { Config } from '../../config.ts';
import { RETAILERS } from '../retail/registry.ts';
import { createCatalogSources, providerStatusFor, type CatalogSource } from './sources/index.ts';
import type { HttpDeps } from './sources/http.ts';

export type { FeedProduct } from './sources/types.ts';
export { mapAwinRow, parseCsv, readFeed } from './sources/awin.ts';

export interface ProviderStatus {
  provider: string;
  configured: boolean;
  detail: string;
}

export interface CatalogProviders {
  statuses(): ProviderStatus[];
  awinFeeds: string[];
  sources: CatalogSource[];
  /** Config-derived status of a provider for one retailer (DB-derived `error`/`operational` are layered on top by the caller). */
  statusFor(provider: string, retailerId: string, programId: string | null): { status: string; detail: string };
}

/** retailerId → Awin advertiser (programme) id, from the verified ids in the retailer registry. */
export function awinProgrammeIds(): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of RETAILERS) for (const i of r.integrations) if (i.provider === 'awin' && i.programId) m.set(r.id, i.programId);
  return m;
}

export function createCatalogProviders(cfg: Config, deps?: HttpDeps): CatalogProviders {
  const feeds = (cfg.AWIN_FEED_URLS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const sources = createCatalogSources(cfg, awinProgrammeIds(), deps);
  return {
    awinFeeds: feeds,
    sources,
    statusFor: (provider, retailerId, programId) => providerStatusFor(sources, provider, retailerId, programId),
    statuses: () => [
      ...sources.map((s) => ({ provider: s.id, configured: s.missing().length === 0, detail: s.missing().length ? `Faltan: ${s.missing().join(', ')}` : `${s.name}: credenciales presentes` })),
      { provider: 'ebay_browse', configured: !!(cfg.EBAY_CLIENT_ID && cfg.EBAY_CLIENT_SECRET), detail: 'Requiere licencia de producción de las Buy APIs (eBay Partner Network); adaptador no implementado' },
      { provider: 'inditex_api_marketplace', configured: !!(cfg.INDITEX_CLIENT_ID && cfg.INDITEX_CLIENT_SECRET), detail: 'Portal no publicado; requiere acuerdo con Inditex' },
    ],
  };
}
