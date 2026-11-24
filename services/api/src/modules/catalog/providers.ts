/**
 * Commercial catalog providers. Each adapter exposes the same capabilities
 * (search, product details, variants, prices, availability, authorised images,
 * purchase links, integration status). Only providers with valid credentials or an
 * authorised feed are enabled; nothing here calls private retailer endpoints.
 */
import { gunzipSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import type { Config } from '../../config.ts';

export interface ProviderStatus {
  provider: string;
  configured: boolean;
  detail: string;
}

export interface FeedProduct {
  retailerHint: string;
  externalId: string;
  title: string;
  brand: string | null;
  description: string | null;
  category: string | null;
  colorName: string | null;
  material: string | null;
  productUrl: string;
  affiliateUrl: string | null;
  imageUrls: string[];
  priceCents: number | null;
  originalPriceCents: number | null;
  currency: string;
  inStock: boolean | null;
  sizes: Array<{ label: string; available: boolean | null }>;
  gtin: string | null;
  updatedAt: string | null;
}

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

export async function readFeed(source: string, fetcher: typeof fetch = fetch): Promise<FeedProduct[]> {
  let buf: Buffer;
  if (/^https?:\/\//.test(source)) {
    const res = await fetcher(source, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`Descarga del feed fallida (${res.status})`);
    buf = Buffer.from(await res.arrayBuffer());
  } else buf = await readFile(source);
  const text = (buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf).toString('utf8');
  const rows = parseCsv(text);
  const header = rows.shift() ?? [];
  return rows.map((r) => mapAwinRow(Object.fromEntries(header.map((k, i) => [k.trim(), r[i] ?? ''])))).filter((p): p is FeedProduct => p !== null);
}

export interface CatalogProviders {
  statuses(): ProviderStatus[];
  awinFeeds: string[];
}

export function createCatalogProviders(cfg: Config): CatalogProviders {
  const feeds = (cfg.AWIN_FEED_URLS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return {
    awinFeeds: feeds,
    statuses: () => [
      { provider: 'awin', configured: feeds.length > 0 && !!cfg.AWIN_PUBLISHER_ID, detail: feeds.length ? `${feeds.length} feed(s) configurado(s)` : 'Sin feeds autorizados (AWIN_FEED_URLS vacío)' },
      { provider: 'ebay_browse', configured: !!(cfg.EBAY_CLIENT_ID && cfg.EBAY_CLIENT_SECRET), detail: 'Requiere licencia de producción de las Buy APIs (eBay Partner Network)' },
      { provider: 'inditex_api_marketplace', configured: !!(cfg.INDITEX_CLIENT_ID && cfg.INDITEX_CLIENT_SECRET), detail: 'Portal no publicado; requiere acuerdo con Inditex' },
    ],
  };
}
