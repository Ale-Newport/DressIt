/**
 * Rakuten Advertising Product Search API (publisher). Docs read 2026-11-24:
 *   https://developers.rakutenadvertising.com/guides/product_search  (content: /locales/en-US/guides/product_search.json)
 *   https://developers.rakutenadvertising.com/guides/access_tokens   (content: /locales/en-US/guides/access_tokens.json)
 *
 *  Token:  POST https://api.linksynergy.com/token
 *          Authorization: Bearer base64(client_id:client_secret)   (the "token-key")
 *          Content-Type: application/x-www-form-urlencoded, body `scope={account-id}`
 *          → { access_token, expires_in: 3600, refresh_token, token_type: 'bearer' }. 100 calls/min.
 *  Search: GET https://api.linksynergy.com/productsearch/1.0?mid={advertiser}&max=100&pagenumber={n}
 *          Authorization: Bearer {access_token}. XML only: <result><TotalMatches/><TotalPages/><PageNumber/>
 *          <item><mid/><merchantname/><linkid/><createdon/><sku/><productname/><category><primary/><secondary/>
 *          </category><price currency=""/><saleprice currency=""/><upccode/><description><short/><long/>
 *          </description><keywords/><linkurl/><imageurl/></item></result>
 *          max ≤ 100; "returns a maximum of 5,000 results"; asking for a page above TotalPages is an error;
 *          "limited to 100 calls / min" (throttle status not documented → generic 429 handling).
 *  Not documented in the response: brand, availability, size, colour, untracked merchant URL. They stay null
 *  and `linkurl` (the tracked "product buy link") is used as both product and affiliate link.
 */
import * as cheerio from 'cheerio';
import { RateLimitedClient, defaultHttpDeps, type HttpDeps } from './http.ts';
import { httpUrl, parseMapping, pricePair, type CatalogSource, type FeedProduct, type IngestJob } from './types.ts';

export const RAKUTEN_MAX_RESULTS = 5000;
const PAGE_SIZE = 100;

export function parseRakutenProductSearch(xml: string): { totalPages: number; pageNumber: number; totalMatches: number; products: FeedProduct[]; error: string | null } {
  const $ = cheerio.load(xml, { xml: true });
  const text = (el: ReturnType<typeof $>, sel: string) => el.find(sel).first().text().trim() || null;
  const err = $('Errors ErrorText, errors errortext, ErrorText').first().text().trim() || $('Error, error').first().text().trim() || null;
  const products: FeedProduct[] = [];
  $('result > item').each((_, node) => {
    const it = $(node);
    const title = text(it, 'productname');
    const link = httpUrl(text(it, 'linkurl'));
    const id = text(it, 'sku') ?? text(it, 'linkid');
    if (!title || !link || !id) return;
    const price = it.find('price').first();
    const sale = it.find('saleprice').first();
    const { priceCents, originalPriceCents } = pricePair(price.text(), sale.text());
    const primary = text(it, 'category > primary');
    const secondary = text(it, 'category > secondary')?.replace(/~~/g, ' > ') ?? null;
    products.push({
      retailerHint: text(it, 'merchantname') ?? text(it, 'mid') ?? '',
      externalId: id,
      title,
      brand: null,
      description: (text(it, 'description > long') ?? text(it, 'description > short'))?.slice(0, 1000) ?? null,
      category: [primary, secondary].filter(Boolean).join(' > ') || null,
      colorName: null,
      material: null,
      productUrl: link,
      affiliateUrl: link,
      imageUrls: [httpUrl(text(it, 'imageurl'))].filter((x): x is string => !!x),
      priceCents,
      originalPriceCents,
      currency: (sale.attr('currency') || price.attr('currency') || 'EUR').toUpperCase(),
      inStock: null,
      sizes: [],
      gtin: (text(it, 'upccode') ?? '').replace(/\D/g, '') || null,
      updatedAt: null,
    });
  });
  const n = (sel: string) => Number.parseInt($(sel).first().text(), 10) || 0;
  return { totalPages: n('result > TotalPages'), pageNumber: n('result > PageNumber'), totalMatches: n('result > TotalMatches'), products, error: products.length ? null : err };
}

export interface RakutenEnv {
  RAKUTEN_CLIENT_ID?: string | undefined;
  RAKUTEN_CLIENT_SECRET?: string | undefined;
  RAKUTEN_ACCOUNT_ID?: string | undefined;
  RAKUTEN_ADVERTISERS?: string | undefined;
}

export async function rakutenAccessToken(client: RateLimitedClient, env: RakutenEnv): Promise<string> {
  const tokenKey = Buffer.from(`${env.RAKUTEN_CLIENT_ID}:${env.RAKUTEN_CLIENT_SECRET}`).toString('base64');
  const res = await client.request('https://api.linksynergy.com/token', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenKey}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ scope: env.RAKUTEN_ACCOUNT_ID! }).toString(),
  });
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error('Rakuten: la respuesta del endpoint /token no contiene access_token');
  return json.access_token;
}

export async function fetchRakutenAdvertiser(client: RateLimitedClient, accessToken: string, mid: string): Promise<{ products: FeedProduct[]; warnings: string[] }> {
  const products = new Map<string, FeedProduct>();
  const warnings: string[] = [];
  let totalPages = 1;
  let totalMatches = 0;
  const maxPages = RAKUTEN_MAX_RESULTS / PAGE_SIZE;
  for (let page = 1; page <= Math.min(totalPages, maxPages); page++) {
    const url = `https://api.linksynergy.com/productsearch/1.0?mid=${encodeURIComponent(mid)}&max=${PAGE_SIZE}&pagenumber=${page}`;
    const res = await client.request(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/xml' } });
    const parsed = parseRakutenProductSearch(await res.text());
    if (parsed.error && !parsed.products.length) throw new Error(`Rakuten Product Search: ${parsed.error}`);
    totalPages = parsed.totalPages || page;
    totalMatches = parsed.totalMatches;
    for (const p of parsed.products) products.set(p.externalId, p);
    if (!parsed.products.length) break;
  }
  if (totalPages > maxPages || totalMatches > RAKUTEN_MAX_RESULTS) warnings.push(`El anunciante ${mid} tiene más productos de los que la API devuelve (${RAKUTEN_MAX_RESULTS} como máximo); se han ingerido ${products.size}.`);
  warnings.push('Rakuten Product Search no documenta marca, disponibilidad ni tallas: se muestran como desconocidas.');
  return { products: [...products.values()], warnings };
}

export function rakutenSource(env: RakutenEnv, deps: HttpDeps = defaultHttpDeps): CatalogSource {
  const advertisers = parseMapping(env.RAKUTEN_ADVERTISERS);
  // Documented: 100 calls/min for both /token and /productsearch → one call every 600 ms.
  const client = new RateLimitedClient(deps, { label: 'Rakuten Product Search API', minIntervalMs: 600 });
  const missing = () => ['RAKUTEN_CLIENT_ID', 'RAKUTEN_CLIENT_SECRET', 'RAKUTEN_ACCOUNT_ID'].filter((k) => !env[k as keyof RakutenEnv]);
  let token: Promise<string> | null = null;
  return {
    id: 'rakuten',
    provider: 'rakuten',
    name: 'Rakuten Advertising · Product Search API',
    provenance: 'api',
    docs: ['https://developers.rakutenadvertising.com/guides/product_search', 'https://developers.rakutenadvertising.com/guides/access_tokens'],
    env: ['RAKUTEN_CLIENT_ID', 'RAKUTEN_CLIENT_SECRET', 'RAKUTEN_ACCOUNT_ID', 'RAKUTEN_ADVERTISERS'],
    missing,
    statusFor(retailerId) {
      if (missing().length) return { status: 'pending_credentials', detail: `Faltan ${missing().join(', ')} (aplicación en el portal de desarrolladores de Rakuten Advertising).` };
      if (!advertisers.has(retailerId)) return { status: 'pending_credentials', detail: 'Credenciales de Rakuten presentes; falta el MID del anunciante en RAKUTEN_ADVERTISERS (tienda=MID).' };
      return { status: 'configured', detail: `Product Search API de Rakuten configurada (MID ${advertisers.get(retailerId)}).` };
    },
    async jobs() {
      if (missing().length) return [];
      return [...advertisers].map(([retailerId, mid]): IngestJob => ({
        sourceId: 'rakuten',
        provider: 'rakuten',
        network: 'rakuten',
        provenance: 'api',
        retailerId,
        label: `rakuten:mid=${mid}`,
        fetch: async () => {
          token ??= rakutenAccessToken(client, env);
          return fetchRakutenAdvertiser(client, await token, mid);
        },
      }));
    },
  };
}
