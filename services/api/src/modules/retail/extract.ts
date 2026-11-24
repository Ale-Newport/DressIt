/**
 * Extracts product data published by the retailer itself in the page:
 * schema.org JSON-LD (Product / ProductGroup / Offer / AggregateOffer), microdata
 * and OpenGraph/product meta tags. Nothing is guessed here: every field carries the
 * source it was read from. Inference (category, color family) happens later and is
 * flagged as such.
 */
import * as cheerio from 'cheerio';
import type { FieldSource } from '@dressit/shared';

export interface Sourced<T> {
  value: T;
  source: FieldSource;
}

export interface ExtractedVariant {
  id: string | null;
  color: string | null;
  size: string | null;
  sku: string | null;
  gtin: string | null;
  available: boolean | null;
  url: string | null;
}

export interface ExtractedProduct {
  title: Sourced<string> | null;
  brand: Sourced<string> | null;
  description: Sourced<string> | null;
  color: Sourced<string> | null;
  sku: Sourced<string> | null;
  gtin: Sourced<string> | null;
  price: Sourced<{ cents: number; currency: string }> | null;
  originalPrice: Sourced<{ cents: number; currency: string }> | null;
  availability: Sourced<'in_stock' | 'out_of_stock' | 'preorder' | 'unknown'> | null;
  sizes: Sourced<string[]> | null;
  variants: ExtractedVariant[];
  images: Sourced<string[]> | null;
  canonicalUrl: string | null;
  category: Sourced<string> | null;
  material: Sourced<string> | null;
  /** True when at least one schema.org Product was found. */
  hasProductSchema: boolean;
  /** Signals that the page is a bot/anti-automation wall rather than a product page. */
  looksBlocked: boolean;
  /** Product schema, a price, or og:type=product were found (a bare <title> is not enough). */
  isProductPage: boolean;
}

type Json = Record<string, unknown>;

const asArray = <T>(v: T | T[] | undefined | null): T[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const str = (v: unknown): string | null => {
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number') return String(v);
  if (v && typeof v === 'object' && 'name' in v) return str((v as Json).name);
  if (v && typeof v === 'object' && '@value' in v) return str((v as Json)['@value']);
  return null;
};
const typeOf = (n: Json): string[] => asArray(n['@type'] as string | string[]).map((t) => String(t).replace(/^https?:\/\/schema\.org\//, ''));

export function parsePrice(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v * 100);
  if (typeof v !== 'string') return null;
  let s = v.replace(/[^\d.,-]/g, '');
  if (!s) return null;
  // "1.299,95" (es) vs "1,299.95" (en) vs "29,95" vs "29.95"
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Number.parseFloat(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

function mapAvailability(v: unknown): 'in_stock' | 'out_of_stock' | 'preorder' | 'unknown' {
  const s = (str(v) ?? '').toLowerCase();
  if (/instock|in_stock|in stock|limitedavailability|onlineonly|instoreonly/.test(s)) return 'in_stock';
  if (/outofstock|out_of_stock|out of stock|soldout|discontinued/.test(s)) return 'out_of_stock';
  if (/preorder|presale|backorder/.test(s)) return 'preorder';
  return 'unknown';
}

function imagesOf(v: unknown, base: string): string[] {
  const out: string[] = [];
  for (const item of asArray(v as unknown)) {
    const u = typeof item === 'string' ? item : item && typeof item === 'object' ? str((item as Json).url ?? (item as Json).contentUrl) : null;
    if (!u) continue;
    try {
      const abs = new URL(u, base);
      if (abs.protocol === 'https:' || abs.protocol === 'http:') out.push(abs.toString());
    } catch {
      /* ignore */
    }
  }
  return [...new Set(out)].slice(0, 8);
}

/** A JSON-LD body wrapped in a legacy HTML comment; HTML also ends comments with `--!>`. */
const COMMENT_WRAPPED = /^<!--([\s\S]*?)--!?>$/;

/**
 * Prepare a JSON-LD script body for `JSON.parse`: unwrap a legacy `<!-- … -->` comment and drop
 * trailing commas. Not a sanitiser: the result is only parsed as JSON, never rendered.
 */
export function cleanJsonLd(raw: string): string {
  let body = raw.trim();
  const wrapped = COMMENT_WRAPPED.exec(body);
  if (wrapped) body = (wrapped[1] ?? '').trim();
  return body.replace(/,\s*([}\]])/g, '$1');
}

/** Flatten JSON-LD blocks (arrays, @graph) into nodes. */
export function jsonLdNodes(blocks: string[]): Json[] {
  const nodes: Json[] = [];
  const visit = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(visit);
    if (!v || typeof v !== 'object') return;
    const o = v as Json;
    if (o['@graph']) visit(o['@graph']);
    nodes.push(o);
  };
  for (const raw of blocks) {
    try {
      visit(JSON.parse(cleanJsonLd(raw)));
    } catch {
      /* invalid block: skip */
    }
  }
  return nodes;
}

interface OfferInfo {
  price: number | null;
  currency: string | null;
  original: number | null;
  availability: ReturnType<typeof mapAvailability>;
  sku: string | null;
  size: string | null;
  color: string | null;
  gtin: string | null;
  url: string | null;
}

function offersOf(node: Json): OfferInfo[] {
  const out: OfferInfo[] = [];
  for (const o of asArray(node.offers as Json | Json[])) {
    if (!o || typeof o !== 'object') continue;
    const types = typeOf(o);
    if (types.includes('AggregateOffer')) {
      const inner = asArray(o.offers as Json | Json[]);
      if (inner.length) {
        out.push(...offersOf({ offers: inner }));
        continue;
      }
      out.push({
        price: parsePrice(o.lowPrice ?? o.price),
        currency: str(o.priceCurrency),
        original: parsePrice(o.highPrice),
        availability: mapAvailability(o.availability),
        sku: null,
        size: null,
        color: null,
        gtin: null,
        url: str(o.url),
      });
      continue;
    }
    let original: number | null = null;
    for (const ps of asArray(o.priceSpecification as Json | Json[])) {
      if (!ps || typeof ps !== 'object') continue;
      const pt = (str(ps.priceType) ?? '').toLowerCase();
      if (/strikethrough|listprice|msrp/.test(pt)) original = parsePrice(ps.price);
    }
    const itemOffered = (o.itemOffered as Json | undefined) ?? {};
    out.push({
      price: parsePrice(o.price ?? (o.priceSpecification as Json | undefined)?.price),
      currency: str(o.priceCurrency ?? (o.priceSpecification as Json | undefined)?.priceCurrency),
      original,
      availability: mapAvailability(o.availability),
      sku: str(o.sku ?? itemOffered.sku),
      size: str(itemOffered.size),
      color: str(itemOffered.color),
      gtin: str(o.gtin13 ?? o.gtin ?? o.gtin14 ?? o.gtin12 ?? o.gtin8),
      url: str(o.url),
    });
  }
  return out;
}

const metaContent = ($: cheerio.CheerioAPI, keys: string[]): string | null => {
  for (const k of keys) {
    const v = $(`meta[property="${k}"]`).attr('content') ?? $(`meta[name="${k}"]`).attr('content') ?? $(`meta[itemprop="${k}"]`).attr('content');
    if (v && v.trim()) return v.trim();
  }
  return null;
};

const BLOCK_MARKERS = /captcha|access denied|are you a robot|verify you are human|request unsuccessful|pardon our interruption|px-captcha|_incapsula_|cf-chl|attention required|bot detection/i;

export function extractFromStructured(
  input: { jsonLd: string[]; meta: Record<string, string>; microdata?: Record<string, string>; title: string | null; baseUrl: string; canonical?: string | null; bodyText?: string },
  metaSource: FieldSource = 'open_graph',
  ldSource: FieldSource = 'json_ld',
  microSource: FieldSource = 'microdata',
): ExtractedProduct {
  const nodes = jsonLdNodes(input.jsonLd);
  const products = nodes.filter((n) => typeOf(n).some((t) => t === 'Product' || t === 'ProductGroup' || t === 'IndividualProduct'));
  // Prefer ProductGroup (has variants) then Product with offers.
  const main = products.find((p) => typeOf(p).includes('ProductGroup')) ?? products.find((p) => p.offers) ?? products[0];
  const res: ExtractedProduct = {
    title: null,
    brand: null,
    description: null,
    color: null,
    sku: null,
    gtin: null,
    price: null,
    originalPrice: null,
    availability: null,
    sizes: null,
    variants: [],
    images: null,
    canonicalUrl: input.canonical ?? null,
    category: null,
    material: null,
    hasProductSchema: products.length > 0,
    looksBlocked: false,
    isProductPage: false,
  };
  const ld = <T>(value: T | null): Sourced<T> | null => (value === null || value === undefined || (Array.isArray(value) && value.length === 0) ? null : { value, source: ldSource });
  const mt = <T>(value: T | null): Sourced<T> | null => (value === null || value === undefined ? null : { value, source: metaSource });

  if (main) {
    res.title = ld(str(main.name));
    res.brand = ld(str(main.brand) ?? str(main.manufacturer));
    res.description = ld(str(main.description)?.slice(0, 1000) ?? null);
    res.color = ld(str(main.color));
    res.sku = ld(str(main.sku) ?? str(main.productID) ?? str(main.mpn));
    res.gtin = ld(str(main.gtin13 ?? main.gtin ?? main.gtin14 ?? main.gtin12 ?? main.gtin8));
    res.category = ld(str(main.category));
    res.material = ld(str(main.material));
    res.images = ld(imagesOf(main.image, input.baseUrl));
    if (!res.canonicalUrl) res.canonicalUrl = str(main.url);

    const variantNodes = [
      ...asArray(main.hasVariant as Json | Json[]),
      ...products.filter((p) => p !== main && (str(p.inProductGroupWithID) || typeOf(p).includes('Product'))),
    ].filter((v): v is Json => !!v && typeof v === 'object');
    const offers: OfferInfo[] = [...offersOf(main)];
    for (const v of variantNodes) {
      const vo = offersOf(v);
      const first = vo[0];
      res.variants.push({
        id: str(v.sku) ?? str(v.productID) ?? str(v['@id']),
        color: str(v.color) ?? first?.color ?? null,
        size: str(v.size) ?? first?.size ?? null,
        sku: str(v.sku) ?? first?.sku ?? null,
        gtin: str(v.gtin13 ?? v.gtin ?? v.gtin14) ?? first?.gtin ?? null,
        available: first ? first.availability === 'in_stock' : null,
        url: str(v.url) ?? first?.url ?? null,
      });
      offers.push(...vo);
    }
    // Offer-level variants (sizes) when there is no hasVariant.
    if (res.variants.length === 0) {
      for (const o of offers) {
        if (o.size || o.sku) res.variants.push({ id: o.sku, color: o.color, size: o.size, sku: o.sku, gtin: o.gtin, available: o.availability === 'in_stock', url: o.url });
      }
    }
    const priced = offers.filter((o) => o.price !== null && o.price > 0);
    if (priced.length) {
      const min = priced.reduce((a, b) => (b.price! < a.price! ? b : a));
      const currency = min.currency ?? 'EUR';
      res.price = ld({ cents: min.price!, currency });
      const orig = priced.map((o) => o.original).filter((x): x is number => x !== null && x > min.price!);
      if (orig.length) res.originalPrice = ld({ cents: Math.max(...orig), currency });
      const avail = offers.map((o) => o.availability);
      res.availability = ld(avail.includes('in_stock') ? 'in_stock' : avail.includes('preorder') ? 'preorder' : avail.every((a) => a === 'out_of_stock') ? 'out_of_stock' : 'unknown');
    }
    const sizes = [...new Set(res.variants.map((v) => v.size).filter((s): s is string => !!s))];
    res.sizes = ld(sizes);
  }

  // schema.org microdata (e.g. Mango) — only fills gaps left by JSON-LD.
  const md = input.microdata ?? {};
  const mi = <T>(value: T | null): Sourced<T> | null => (value === null || value === undefined || value === '' ? null : { value, source: microSource });
  if (Object.keys(md).length) {
    if (!res.title) res.title = mi(md.name?.trim() || null);
    if (!res.brand) res.brand = mi(md.brand?.trim() || null);
    if (!res.color) res.color = mi(md.color?.trim() || null);
    if (!res.sku) res.sku = mi(md.sku?.trim() || null);
    if (!res.gtin) res.gtin = mi(md.gtin13?.trim() || null);
    if (!res.price) {
      const cents = parsePrice(md.price);
      if (cents !== null && cents > 0) res.price = mi({ cents, currency: md.priceCurrency?.trim() || 'EUR' });
    }
    if (!res.availability && md.availability) res.availability = mi(mapAvailability(md.availability));
    if (!res.images && md.image) res.images = mi(imagesOf(md.image, input.baseUrl));
    if (md.name || md.price) res.hasProductSchema = true;
  }

  // OpenGraph / product meta fallbacks (only fill gaps).
  const m = input.meta;
  const get = (...keys: string[]) => {
    for (const k of keys) if (m[k]) return m[k]!.trim();
    return null;
  };
  if (!res.title) res.title = mt(get('og:title', 'twitter:title') ?? input.title);
  if (!res.brand) res.brand = mt(get('product:brand', 'og:brand', 'brand'));
  if (!res.description) res.description = mt(get('og:description', 'description')?.slice(0, 1000) ?? null);
  if (!res.color) res.color = mt(get('product:color'));
  if (!res.price) {
    // Some stores publish og:price:amount = 0.0 placeholders: never accept a zero price.
    const amount = parsePrice(get('product:price:amount', 'og:price:amount', 'product:sale_price:amount'));
    if (amount !== null && amount > 0) res.price = mt({ cents: amount, currency: get('product:price:currency', 'og:price:currency') ?? 'EUR' });
  }
  if (!res.originalPrice && res.price) {
    const orig = parsePrice(get('product:original_price:amount'));
    if (orig !== null && orig > res.price.value.cents) res.originalPrice = mt({ cents: orig, currency: res.price.value.currency });
  }
  if (!res.availability) {
    const a = get('product:availability', 'og:availability');
    if (a) res.availability = mt(mapAvailability(a));
  }
  if (!res.images) {
    const img = get('og:image:secure_url', 'og:image', 'twitter:image');
    if (img) res.images = mt(imagesOf(img, input.baseUrl));
  }
  if (!res.canonicalUrl) res.canonicalUrl = get('og:url');
  res.isProductPage = res.hasProductSchema || res.price !== null || /product/i.test(m['og:type'] ?? '');
  res.looksBlocked = !res.hasProductSchema && !res.price && BLOCK_MARKERS.test(`${input.title ?? ''} ${input.bodyText?.slice(0, 4000) ?? ''}`);
  return res;
}

/** Parse a full HTML document fetched from the retailer. */
export function extractFromHtml(html: string, baseUrl: string): ExtractedProduct {
  const $ = cheerio.load(html);
  const jsonLd = $('script[type="application/ld+json"]')
    .toArray()
    .map((el) => $(el).text())
    .slice(0, 20);
  const meta: Record<string, string> = {};
  $('meta').each((_, el) => {
    const k = $(el).attr('property') ?? $(el).attr('name') ?? $(el).attr('itemprop');
    const v = $(el).attr('content');
    if (k && v && !(k in meta)) meta[k] = v;
  });
  // schema.org microdata on any element.
  const microdata: Record<string, string> = {};
  for (const prop of ['name', 'brand', 'price', 'priceCurrency', 'availability', 'color', 'sku', 'gtin13', 'image', 'size']) {
    const el = $(`[itemprop="${prop}"]`).first();
    if (!el.length) continue;
    const v = el.attr('content') ?? el.attr('src') ?? el.attr('href') ?? el.text().trim().slice(0, 300);
    if (v) microdata[prop] = v;
  }
  const canonical = $('link[rel="canonical"]').attr('href') ?? null;
  const title = $('title').first().text().trim() || null;
  const bodyText = $('body').text().replace(/\s+/g, ' ');
  return extractFromStructured({ jsonLd, meta, microdata, title, baseUrl, canonical: canonical ? new URL(canonical, baseUrl).toString() : null, bodyText });
}
