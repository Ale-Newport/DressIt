/**
 * Common model for every official catalog source (affiliate feed or product API).
 * Each adapter maps its documented format to FeedProduct; ingestion (catalog/ingest.ts)
 * stores it with provenance (`feed` | `api`), price/availability observations, licensed
 * images and the tracked affiliate link. Commission data is never part of this model, so
 * it cannot leak into ranking (productScore).
 */

export interface FeedProduct {
  retailerHint: string;
  externalId: string;
  title: string;
  brand: string | null;
  description: string | null;
  category: string | null;
  colorName: string | null;
  material: string | null;
  /** Merchant product page. Some APIs only document a tracked link; then it equals affiliateUrl. */
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
  /** Variant grouping key (e.g. Google `item_group_id` + colour). Rows sharing it are merged. */
  groupId?: string | null;
}

export type Provenance = 'feed' | 'api';
export type SourceProvider = 'awin' | 'rakuten' | 'tradedoubler' | 'cj';
export type SourceStatus = 'pending_credentials' | 'configured' | 'error' | 'operational' | 'unsupported';

export interface IngestJob {
  sourceId: string;
  provider: SourceProvider;
  /** Value stored in affiliate_links.network. */
  network: string;
  provenance: Provenance;
  retailerId: string;
  /** Description safe to store/log (never contains secrets). */
  label: string;
  fetch(): Promise<{ products: FeedProduct[]; warnings: string[] }>;
}

export interface RetailerSourceStatus {
  status: Exclude<SourceStatus, 'error' | 'operational'>;
  detail: string;
}

export interface CatalogSource {
  id: string;
  provider: SourceProvider;
  name: string;
  provenance: Provenance;
  /** Official documentation the adapter was written against. */
  docs: string[];
  /** Env vars this adapter reads (names only, never values). */
  env: string[];
  /** Missing credential env vars (empty = credentials present). */
  missing(): string[];
  /** Is this retailer wired to this source (mapping env or registry advertiser id)? */
  statusFor(retailerId: string, registryAdvertiserId: string | null): RetailerSourceStatus;
  jobs(): Promise<IngestJob[]>;
}

/** Parses `retailer=value,retailer=value` mappings (values may contain `=`). */
export function parseMapping(raw: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of (raw ?? '').split(',')) {
    const s = part.trim();
    const i = s.indexOf('=');
    if (i <= 0) continue;
    const k = s.slice(0, i).trim();
    const v = s.slice(i + 1).trim();
    if (k && v) out.set(k, v);
  }
  return out;
}

/** "15.00 GBP", "617.28", 49.9, "49,90 EUR" → cents (positive only). */
export function priceToCents(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number.parseFloat(String(v).trim().replace(/[^\d.,-]/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

export function currencyOf(v: unknown, fallback = 'EUR'): string {
  const m = typeof v === 'string' ? /\b([A-Z]{3})\b/.exec(v) : null;
  return m?.[1] ?? fallback;
}

/** Normalises availability strings from different specs to a boolean (null = unknown). */
export function availabilityToStock(v: unknown): boolean | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (['instock', 'yes', 'true', '1', 'available', 'disponible', 'enstock'].includes(s)) return true;
  if (['outofstock', 'no', 'false', '0', 'soldout', 'agotado', 'discontinued'].includes(s)) return false;
  return null;
}

export const httpUrl = (v: unknown): string | null => (typeof v === 'string' && /^https?:\/\//i.test(v.trim()) ? v.trim() : null);

/** Sale price below the regular price → (sale, regular); otherwise (regular, null). */
export function pricePair(regular: unknown, sale: unknown): { priceCents: number | null; originalPriceCents: number | null } {
  const r = priceToCents(regular);
  const s = priceToCents(sale);
  if (s !== null && r !== null && s < r) return { priceCents: s, originalPriceCents: r };
  return { priceCents: r ?? s, originalPriceCents: null };
}

/**
 * Merges per-size rows (Google-style feeds: one row per variant) into one product per
 * `groupId`, keeping the lowest current price and the union of sizes/images.
 */
export function groupVariants(products: FeedProduct[]): FeedProduct[] {
  const out: FeedProduct[] = [];
  const byGroup = new Map<string, FeedProduct>();
  for (const p of products) {
    if (!p.groupId) {
      out.push(p);
      continue;
    }
    const g = byGroup.get(p.groupId);
    if (!g) {
      const first: FeedProduct = { ...p, externalId: p.groupId, sizes: [...p.sizes], imageUrls: [...p.imageUrls] };
      byGroup.set(p.groupId, first);
      out.push(first);
      continue;
    }
    for (const s of p.sizes) if (!g.sizes.some((x) => x.label === s.label)) g.sizes.push(s);
    for (const u of p.imageUrls) if (!g.imageUrls.includes(u)) g.imageUrls.push(u);
    if (p.priceCents !== null && (g.priceCents === null || p.priceCents < g.priceCents)) {
      g.priceCents = p.priceCents;
      g.originalPriceCents = p.originalPriceCents;
    }
    g.inStock = g.inStock === true || p.inStock === true ? true : g.inStock === false && p.inStock === false ? false : null;
    g.gtin = g.gtin ?? p.gtin;
  }
  return out;
}
