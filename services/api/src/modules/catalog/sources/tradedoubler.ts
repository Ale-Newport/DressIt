/**
 * Tradedoubler Products API (publisher). Docs read 2026-11-24: https://dev.tradedoubler.com/products/publisher/
 *
 *   GET https://api.tradedoubler.com/1.0/products.json;fid={feedId};page={n};pageSize={size};limit={size*n+size}?token={token}
 *
 *  - token: 40-hex "PRODUCTS" token from Account > Manage tokens (query parameter).
 *  - Query keys use matrix syntax (`;key=value`). `limit` must be "pageSize*page+pageSize" to paginate.
 *  - "Any search request is limited to a maximum of 1,000 products."  The only paging signal is
 *    productHeader.totalHits; we stop at min(totalHits, 1000) or when a page brings nothing new.
 *  - Response: { productHeader: { totalHits }, products: [{ name, description, productImage: { url },
 *    brand, identifiers: { ean, sku, ... }, size, fields: [{ name, value }], categories: [{ name }],
 *    offers: [{ feedId, productUrl (tracked), sourceProductUrl, sourceProductId, price?, priceHistory:
 *    [{ price: { value, currency }, date }], availability, inStock, modified, id }] }] }
 *  - Errors: 400 missing token, 403 invalid token, PF_xxx codes as HTTP 400. No search rate limit is
 *    documented; we stay polite at one request per second.
 */
import { RateLimitedClient, defaultHttpDeps, type HttpDeps } from './http.ts';
import { availabilityToStock, currencyOf, httpUrl, parseMapping, priceToCents, type CatalogSource, type FeedProduct, type IngestJob } from './types.ts';

export const TRADEDOUBLER_MAX_RESULTS = 1000;
const PAGE_SIZE = 100;

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.map(obj) : []);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null);

function offerPrice(offer: Obj): { cents: number | null; currency: string | null } {
  const p = offer.price;
  if (p !== undefined && p !== null) {
    if (typeof p === 'object') return { cents: priceToCents(obj(p).value), currency: str(obj(p).currency) };
    return { cents: priceToCents(p), currency: null };
  }
  const latest = arr(offer.priceHistory).sort((a, b) => Number(b.date ?? 0) - Number(a.date ?? 0) || String(b.date ?? '').localeCompare(String(a.date ?? '')))[0];
  const price = obj(latest?.price);
  return { cents: priceToCents(price.value), currency: str(price.currency) };
}

function toIso(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return new Date(v).toISOString();
  return str(v);
}

export function mapTradedoublerProduct(product: Obj, feedId?: string): FeedProduct | null {
  const offers = arr(product.offers);
  const offer = offers.find((o) => feedId !== undefined && String(o.feedId) === feedId) ?? offers[0];
  if (!offer) return null;
  const name = str(product.name);
  const tracked = httpUrl(offer.productUrl);
  const source = httpUrl(offer.sourceProductUrl);
  const externalId = str(offer.sourceProductId) ?? str(offer.id) ?? str(product.id);
  if (!name || !externalId || !(tracked || source)) return null;
  const price = offerPrice(offer);
  const stockN = typeof offer.inStock === 'number' ? offer.inStock : typeof product.inStock === 'number' ? product.inStock : null;
  const inStock = availabilityToStock(offer.availability ?? product.availability) ?? (stockN === null ? null : stockN > 0);
  const fields = arr(product.fields);
  const color = str(fields.find((f) => /^colou?r$/i.test(String(f.name ?? '')))?.value);
  const size = str(product.size ?? offer.size);
  const identifiers = obj(product.identifiers);
  return {
    retailerHint: str(offer.programName) ?? '',
    externalId,
    title: name,
    brand: str(product.brand) ?? str(product.manufacturer),
    description: str(product.description)?.slice(0, 1000) ?? null,
    category: str(arr(product.categories)[0]?.name),
    colorName: color,
    material: str(fields.find((f) => /^(material|materials)$/i.test(String(f.name ?? '')))?.value),
    productUrl: (source ?? tracked)!,
    affiliateUrl: tracked,
    imageUrls: [httpUrl(obj(product.productImage).url)].filter((x): x is string => !!x),
    priceCents: price.cents,
    // Price history is not an RRP: showing it as a "previous price" could mislead (Omnibus rules).
    originalPriceCents: null,
    currency: price.currency ?? currencyOf(null),
    inStock,
    sizes: size ? size.split(/[,|;]/).map((s) => s.trim()).filter(Boolean).map((label) => ({ label, available: null })) : [],
    gtin: (str(identifiers.ean) ?? '').replace(/\D/g, '') || null,
    updatedAt: toIso(offer.modified ?? product.modified),
  };
}

export function tradedoublerPageUrl(token: string, feedId: string, page: number, pageSize = PAGE_SIZE): string {
  return `https://api.tradedoubler.com/1.0/products.json;fid=${encodeURIComponent(feedId)};page=${page};pageSize=${pageSize};limit=${pageSize * page + pageSize};dateOutputFormat=iso8601?token=${encodeURIComponent(token)}`;
}

/** Downloads every page the API allows (max 1,000 products per search, as documented). */
export async function fetchTradedoublerFeed(client: RateLimitedClient, token: string, feedId: string): Promise<{ products: FeedProduct[]; warnings: string[] }> {
  const seen = new Map<string, FeedProduct>();
  const warnings: string[] = [];
  let total = 0;
  for (let page = 0; page * PAGE_SIZE < TRADEDOUBLER_MAX_RESULTS; page++) {
    const res = await client.request(tradedoublerPageUrl(token, feedId, page), { headers: { Accept: 'application/json' } });
    const body = obj(await res.json());
    total = Number(obj(body.productHeader).totalHits ?? 0);
    const before = seen.size;
    for (const raw of arr(body.products)) {
      const p = mapTradedoublerProduct(raw, feedId);
      if (p) seen.set(p.externalId, p);
    }
    if (seen.size === before || seen.size >= Math.min(total, TRADEDOUBLER_MAX_RESULTS)) break;
  }
  if (total > TRADEDOUBLER_MAX_RESULTS) warnings.push(`El feed ${feedId} tiene ${total} productos y la API de búsqueda solo devuelve ${TRADEDOUBLER_MAX_RESULTS} por consulta; se han ingerido ${seen.size}.`);
  return { products: [...seen.values()], warnings };
}

export interface TradedoublerEnv {
  TRADEDOUBLER_PRODUCTS_TOKEN?: string | undefined;
  TRADEDOUBLER_FEEDS?: string | undefined;
}

export function tradedoublerSource(env: TradedoublerEnv, deps: HttpDeps = defaultHttpDeps): CatalogSource {
  const feeds = parseMapping(env.TRADEDOUBLER_FEEDS);
  const client = new RateLimitedClient(deps, { label: 'Tradedoubler Products API', minIntervalMs: 1_000 });
  const missing = () => (env.TRADEDOUBLER_PRODUCTS_TOKEN ? [] : ['TRADEDOUBLER_PRODUCTS_TOKEN']);
  return {
    id: 'tradedoubler',
    provider: 'tradedoubler',
    name: 'Tradedoubler · Products API',
    provenance: 'api',
    docs: ['https://dev.tradedoubler.com/products/publisher/'],
    env: ['TRADEDOUBLER_PRODUCTS_TOKEN', 'TRADEDOUBLER_FEEDS'],
    missing,
    statusFor(retailerId) {
      if (missing().length) return { status: 'pending_credentials', detail: 'Falta TRADEDOUBLER_PRODUCTS_TOKEN (token «PRODUCTS» de Account > Manage tokens).' };
      if (!feeds.has(retailerId)) return { status: 'pending_credentials', detail: 'Token de Tradedoubler presente; falta el ID de feed de esta tienda en TRADEDOUBLER_FEEDS (tienda=feedId).' };
      return { status: 'configured', detail: `Products API de Tradedoubler configurada (feed ${feeds.get(retailerId)}).` };
    },
    async jobs() {
      if (missing().length) return [];
      return [...feeds].map(([retailerId, feedId]): IngestJob => ({
        sourceId: 'tradedoubler',
        provider: 'tradedoubler',
        network: 'tradedoubler',
        provenance: 'api',
        retailerId,
        label: `tradedoubler:fid=${feedId}`,
        fetch: () => fetchTradedoublerFeed(client, env.TRADEDOUBLER_PRODUCTS_TOKEN!, feedId),
      }));
    },
  };
}
