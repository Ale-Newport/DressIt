/**
 * Awin (publisher side). Three documented, legitimate routes:
 *
 *  1. Legacy "Create-a-Feed" CSV/CSV.GZ download URLs (AWIN_FEED_URLS) — mapAwinRow.
 *  2. Feed list discovery (AWIN_PUBLISHER_ID + AWIN_PRODUCTDATA_API_KEY):
 *     GET https://ui.awin.com/productdata-darwin-download/publisher/{publisherId}/{datafeedsApiKey}/1/feedList
 *     → CSV with "Advertiser ID, Advertiser Name, Primary Region, Membership Status, Datafeed Format,
 *       Feed ID, Feed Name, Language, Vertical, Last Imported, Last Checked, No of products, URL".
 *     Docs: https://help.awin.com/developers/docs/downloading-a-list-of-your-product-feeds.md (read 2026-11-24)
 *  3. Enhanced (Google-format) feed API (AWIN_PUBLISHER_ID + AWIN_API_TOKEN):
 *     GET https://api.awin.com/publishers/{PUBLISHER_ID}/awinfeeds/download/{ADVERTISER_ID}-retail-{LOCALE}.jsonl
 *     Authorization: Bearer <token>. JSON Lines; "if the last line contains an error object, the download is
 *     incomplete". "No more than 5 requests per minute"; no concurrent requests to the same advertiser feed.
 *     Docs: https://help.awin.com/apidocs/retail-publisher-productapidocumentation-1.md and column groups in
 *     https://help.awin.com/developers/docs/enhanced-feeds-publisher-faq.md (read 2026-11-24).
 */
import { gunzipSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import { RateLimitedClient, defaultHttpDeps, redactUrl, type HttpDeps } from './http.ts';
import { availabilityToStock, currencyOf, groupVariants, httpUrl, parseMapping, pricePair, type CatalogSource, type FeedProduct, type IngestJob, type RetailerSourceStatus } from './types.ts';

/** RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF), streaming-friendly enough for feeds. */
export function parseCsv(text: string, delimiter = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const num = (v: string | undefined): number | null => {
  if (!v) return null;
  const n = Number.parseFloat(v.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
};

/**
 * Maps a row of an Awin product feed (legacy "productdata" CSV, Spain) to FeedProduct.
 * Column names per Awin's feed documentation (see docs/research/integraciones-comerciales.md).
 */
export function mapAwinRow(h: Record<string, string>): FeedProduct | null {
  const id = h.aw_product_id || h.merchant_product_id;
  const url = h.merchant_deep_link || h.aw_deep_link;
  if (!id || !h.product_name || !url) return null;
  const sizes = (h['Fashion:size'] || '')
    .split(/[,|;]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((label) => ({ label, available: null }));
  const stock = (h.in_stock ?? '').trim();
  return {
    retailerHint: h.merchant_name || h.merchant_id || '',
    externalId: id,
    title: h.product_name,
    brand: h.brand_name || null,
    description: h.description?.slice(0, 1000) || null,
    category: h.merchant_product_category_path || h.merchant_category || null,
    colorName: h.colour || null,
    material: h['Fashion:material'] || null,
    productUrl: h.merchant_deep_link || url,
    affiliateUrl: h.aw_deep_link || null,
    imageUrls: [h.merchant_image_url, h.large_image, h.alternate_image].filter((x): x is string => !!x && /^https?:\/\//.test(x)),
    priceCents: num(h.search_price) ?? num(h.store_price),
    originalPriceCents: num(h.rrp_price) ?? num(h.product_price_old),
    currency: h.currency || 'EUR',
    inStock: stock === '1' || /^(yes|true|in stock)$/i.test(stock) ? true : stock === '0' || /^(no|false)$/i.test(stock) ? false : null,
    sizes,
    gtin: (h.ean || h.product_GTIN || '').replace(/\D/g, '') || null,
    updatedAt: h.last_updated || null,
  };
}

const REQUIRED_CSV_COLUMNS = [['aw_product_id', 'merchant_product_id'], ['product_name'], ['merchant_deep_link', 'aw_deep_link']];

/** Parses an Awin legacy CSV (optionally gzip) and fails loudly if the documented key columns are missing. */
export function parseAwinCsv(buf: Buffer): FeedProduct[] {
  const text = (buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf).toString('utf8');
  const rows = parseCsv(text);
  const header = (rows.shift() ?? []).map((k) => k.trim());
  const missing = REQUIRED_CSV_COLUMNS.filter((alts) => !alts.some((c) => header.includes(c))).map((alts) => alts.join(' o '));
  if (rows.length && missing.length) throw new Error(`El feed de Awin no incluye las columnas necesarias: ${missing.join(', ')}. Crea el feed en Create-a-Feed con esas columnas.`);
  return rows.map((r) => mapAwinRow(Object.fromEntries(header.map((k, i) => [k, r[i] ?? ''])))).filter((p): p is FeedProduct => p !== null);
}

export async function readFeed(source: string, fetcher: typeof fetch = fetch): Promise<FeedProduct[]> {
  let buf: Buffer;
  if (/^https?:\/\//.test(source)) {
    const res = await fetcher(source, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`Descarga del feed fallida (${res.status}) en ${redactUrl(source)}`);
    buf = Buffer.from(await res.arrayBuffer());
  } else buf = await readFile(source);
  return parseAwinCsv(buf);
}

// --- Feed list -------------------------------------------------------------------------------

export interface AwinFeedListEntry {
  advertiserId: string;
  advertiserName: string;
  region: string;
  membershipStatus: string;
  format: string;
  feedId: string;
  language: string;
  lastImported: string;
  products: number | null;
  url: string;
}

export function parseAwinFeedList(csv: string): AwinFeedListEntry[] {
  const rows = parseCsv(csv);
  const header = (rows.shift() ?? []).map((h) => h.trim().toLowerCase());
  const col = (r: string[], name: string) => (r[header.indexOf(name)] ?? '').trim();
  return rows
    .map((r) => ({
      advertiserId: col(r, 'advertiser id'),
      advertiserName: col(r, 'advertiser name'),
      region: col(r, 'primary region'),
      membershipStatus: col(r, 'membership status'),
      format: col(r, 'datafeed format'),
      feedId: col(r, 'feed id'),
      language: col(r, 'language'),
      lastImported: col(r, 'last imported'),
      products: Number.parseInt(col(r, 'no of products'), 10) || null,
      url: col(r, 'url'),
    }))
    .filter((e) => e.advertiserId && /^https:\/\//.test(e.url));
}

// --- Enhanced (Google format) JSONL ----------------------------------------------------------

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null);

/**
 * Maps one Enhanced-feed record. Awin documents the fields grouped (meta, product_basic,
 * price_and_availability, product_category, product_detailed, product_identifiers) and also shows a
 * flat Google-spec example, so both shapes are accepted.
 */
export function mapAwinEnhanced(line: Obj): FeedProduct | null {
  const meta = obj(line.meta);
  const f: Obj = { ...line, ...obj(line.product_basic), ...obj(line.price_and_availability), ...obj(line.product_category), ...obj(line.product_detailed), ...obj(line.product_identifiers) };
  const id = str(f.id);
  const title = str(f.title);
  const link = httpUrl(f.link);
  const tracked = httpUrl(f.aw_deep_link);
  if (!id || !title || !(link || tracked)) return null;
  const { priceCents, originalPriceCents } = pricePair(f.price, f.sale_price);
  const inStock = availabilityToStock(f.availability);
  const size = str(f.size);
  const color = str(f.color);
  const group = str(f.item_group_id);
  const images = [httpUrl(f.image_link), ...(Array.isArray(f.additional_image_link) ? f.additional_image_link.map(httpUrl) : [])].filter((x): x is string => !!x);
  const productType = Array.isArray(f.product_type) ? f.product_type.join(' > ') : str(f.product_type);
  return {
    retailerHint: str(meta.advertiser_name) ?? str(meta.advertiser_id) ?? '',
    externalId: id,
    title,
    brand: str(f.brand),
    description: str(f.description)?.slice(0, 1000) ?? null,
    category: productType ?? str(f.google_product_category),
    colorName: color,
    material: str(f.material),
    productUrl: (link ?? tracked)!,
    affiliateUrl: tracked,
    imageUrls: images,
    priceCents,
    originalPriceCents,
    currency: currencyOf(f.sale_price ?? f.price),
    inStock,
    sizes: size ? [{ label: size, available: inStock }] : [],
    gtin: (str(f.gtin) ?? '').replace(/\D/g, '') || null,
    updatedAt: null,
    groupId: group ? `${group}${color ? `:${color.toLowerCase()}` : ''}` : null,
  };
}

/** Parses an Enhanced JSONL download; throws if the last line is Awin's error object (incomplete download). */
export function parseAwinEnhancedJsonl(text: string): { products: FeedProduct[]; warnings: string[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const warnings: string[] = [];
  const last = lines.at(-1);
  if (last) {
    let parsed: Obj | null = null;
    try {
      parsed = JSON.parse(last) as Obj;
    } catch {
      throw new Error('Descarga de Awin incompleta: la última línea no es JSON válido');
    }
    if (parsed && 'error' in parsed) throw new Error(`Descarga de Awin incompleta: ${str(parsed.message) ?? 'error'} (${String(parsed.error)})`);
  }
  const products: FeedProduct[] = [];
  let bad = 0;
  for (const l of lines) {
    try {
      const p = mapAwinEnhanced(JSON.parse(l) as Obj);
      if (p) products.push(p);
      else bad++;
    } catch {
      bad++;
    }
  }
  if (bad) warnings.push(`${bad} línea(s) sin los campos mínimos (id, title, link) se ignoraron`);
  return { products: groupVariants(products), warnings };
}

// --- Sources ---------------------------------------------------------------------------------

export interface AwinEnv {
  AWIN_PUBLISHER_ID?: string | undefined;
  AWIN_PRODUCTDATA_API_KEY?: string | undefined;
  AWIN_FEED_URLS?: string | undefined;
  AWIN_API_TOKEN?: string | undefined;
  AWIN_ADVERTISERS?: string | undefined;
  AWIN_FEED_LOCALE?: string | undefined;
}

const FEEDLIST_DOC = 'https://help.awin.com/developers/docs/downloading-a-list-of-your-product-feeds.md';
const ENHANCED_DOC = 'https://help.awin.com/apidocs/retail-publisher-productapidocumentation-1.md';

/** Advertiser id → retailer id, from the registry (verified programme ids) plus AWIN_ADVERTISERS overrides. */
function advertiserIndex(env: AwinEnv, registry: Map<string, string>): Map<string, string> {
  const idx = new Map<string, string>();
  for (const [retailer, adv] of registry) idx.set(adv, retailer);
  for (const [retailer, adv] of parseMapping(env.AWIN_ADVERTISERS)) idx.set(adv, retailer);
  return idx;
}

/** Legacy CSV feeds: explicit AWIN_FEED_URLS and/or automatic discovery through the feed list. */
export function awinFeedSource(env: AwinEnv, registryAdvertisers: Map<string, string>, deps: HttpDeps = defaultHttpDeps): CatalogSource {
  const explicit = parseMapping(env.AWIN_FEED_URLS);
  const canDiscover = () => !!(env.AWIN_PUBLISHER_ID && env.AWIN_PRODUCTDATA_API_KEY);
  const client = new RateLimitedClient(deps, { label: 'Awin (feeds)', minIntervalMs: 3_000 });
  const job = (retailerId: string, url: string, label: string): IngestJob => ({
    sourceId: 'awin_feed',
    provider: 'awin',
    network: 'awin',
    provenance: 'feed',
    retailerId,
    label,
    fetch: async () => {
      if (/^https?:\/\//.test(url)) {
        const res = await client.request(url);
        return { products: parseAwinCsv(Buffer.from(await res.arrayBuffer())), warnings: [] };
      }
      return { products: await readFeed(url), warnings: [] };
    },
  });
  return {
    id: 'awin_feed',
    provider: 'awin',
    name: 'Awin · feeds CSV (Create-a-Feed)',
    provenance: 'feed',
    docs: [FEEDLIST_DOC],
    env: ['AWIN_PUBLISHER_ID', 'AWIN_PRODUCTDATA_API_KEY', 'AWIN_FEED_URLS', 'AWIN_ADVERTISERS'],
    missing: () => (explicit.size || canDiscover() ? (env.AWIN_PUBLISHER_ID ? [] : ['AWIN_PUBLISHER_ID']) : ['AWIN_PUBLISHER_ID', 'AWIN_PRODUCTDATA_API_KEY'].filter((k) => !env[k as keyof AwinEnv])),
    statusFor(retailerId, registryAdvertiserId): RetailerSourceStatus {
      if (explicit.has(retailerId) && env.AWIN_PUBLISHER_ID) return { status: 'configured', detail: 'Feed CSV de Awin configurado en AWIN_FEED_URLS.' };
      const mapped = registryAdvertiserId ?? [...parseMapping(env.AWIN_ADVERTISERS)].find(([r]) => r === retailerId)?.[1] ?? null;
      if (canDiscover() && mapped) return { status: 'configured', detail: `Credenciales de feeds de Awin presentes; se usará el feed del anunciante ${mapped} cuando tu solicitud esté aprobada.` };
      if (canDiscover()) return { status: 'pending_credentials', detail: 'Credenciales de Awin presentes, pero falta el ID de anunciante de esta tienda en AWIN_ADVERTISERS.' };
      return { status: 'pending_credentials', detail: 'Faltan AWIN_PUBLISHER_ID y AWIN_PRODUCTDATA_API_KEY (clave de Create-a-Feed), o una URL en AWIN_FEED_URLS.' };
    },
    async jobs() {
      const jobs: IngestJob[] = [...explicit].map(([retailer, url]) => job(retailer, url, `awin:${redactUrl(url)}`));
      if (!canDiscover()) return jobs;
      const listUrl = `https://ui.awin.com/productdata-darwin-download/publisher/${encodeURIComponent(env.AWIN_PUBLISHER_ID!)}/${encodeURIComponent(env.AWIN_PRODUCTDATA_API_KEY!)}/1/feedList`;
      const res = await client.request(listUrl);
      const idx = advertiserIndex(env, registryAdvertisers);
      for (const e of parseAwinFeedList(await res.text())) {
        const retailer = idx.get(e.advertiserId);
        if (!retailer || explicit.has(retailer)) continue;
        if (!/^(active|joined)$/i.test(e.membershipStatus)) continue;
        if (!/^awin$/i.test(e.format)) continue; // Google-format feeds go through the Enhanced API source
        jobs.push(job(retailer, e.url, `awin:feedList advertiser=${e.advertiserId} feed=${e.feedId} (${e.language || '?'})`));
      }
      return jobs;
    },
  };
}

/** Enhanced (Google-format) feeds via the Awin API, for advertisers listed in AWIN_ADVERTISERS. */
export function awinEnhancedSource(env: AwinEnv, deps: HttpDeps = defaultHttpDeps): CatalogSource {
  const advertisers = parseMapping(env.AWIN_ADVERTISERS);
  const locale = env.AWIN_FEED_LOCALE || 'es_ES';
  // Documented: no more than 5 requests per minute → one request every 12 s.
  const client = new RateLimitedClient(deps, { label: 'Awin (Enhanced feeds API)', minIntervalMs: 12_000, maxRetries: 2 });
  const missing = () => ['AWIN_PUBLISHER_ID', 'AWIN_API_TOKEN'].filter((k) => !env[k as keyof AwinEnv]);
  return {
    id: 'awin_enhanced',
    provider: 'awin',
    name: 'Awin · Enhanced feeds API (JSONL)',
    provenance: 'api',
    docs: [ENHANCED_DOC, 'https://help.awin.com/developers/docs/enhanced-feeds-publisher-faq.md', 'https://help.awin.com/apidocs/api-authentication.md'],
    env: ['AWIN_PUBLISHER_ID', 'AWIN_API_TOKEN', 'AWIN_ADVERTISERS', 'AWIN_FEED_LOCALE'],
    missing,
    statusFor(retailerId): RetailerSourceStatus {
      if (missing().length) return { status: 'pending_credentials', detail: `Faltan ${missing().join(', ')} para la API de feeds de Awin.` };
      if (!advertisers.has(retailerId)) return { status: 'pending_credentials', detail: 'Token de Awin presente; añade esta tienda a AWIN_ADVERTISERS (tienda=ID) cuando te aprueben.' };
      return { status: 'configured', detail: `API de feeds de Awin configurada (anunciante ${advertisers.get(retailerId)}, ${locale}).` };
    },
    async jobs() {
      if (missing().length) return [];
      return [...advertisers].map(([retailerId, advertiserId]): IngestJob => {
        const url = `https://api.awin.com/publishers/${encodeURIComponent(env.AWIN_PUBLISHER_ID!)}/awinfeeds/download/${encodeURIComponent(advertiserId)}-retail-${encodeURIComponent(locale)}.jsonl`;
        return {
          sourceId: 'awin_enhanced',
          provider: 'awin',
          network: 'awin',
          provenance: 'api',
          retailerId,
          label: `awin_enhanced:advertiser=${advertiserId} locale=${locale}`,
          fetch: async () => {
            const res = await client.request(url, { headers: { Authorization: `Bearer ${env.AWIN_API_TOKEN}`, Accept: 'application/x-ndjson, application/json' } });
            return parseAwinEnhancedJsonl(await res.text());
          },
        };
      });
    },
  };
}
