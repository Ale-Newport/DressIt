/**
 * Pure logic of the official-photo search: what was read on the garment (brand, reference codes),
 * merging the candidates of every provider and query, which ones are worth verifying, and the
 * verdict once the vision service has compared each candidate photo with the user's garment.
 *
 * "Visually similar" is not "the same product": an exact verdict needs the photo check (same type,
 * same colours, very close appearance) AND independent evidence of identity — the brand or a
 * reference code read on the garment, the very same image found online, or several providers /
 * queries agreeing on the same product page. Anything less is a "possible" match for the user to
 * confirm, never chosen automatically.
 */
import { RETAILERS, retailerForHost } from '../retail/registry.ts';
import type { WebCandidate } from './search.ts';

/** Brands commonly found on Spanish wardrobes beyond the store registry (lower-case). */
const EXTRA_BRANDS = [
  'levi', "levi's", 'nike', 'adidas', 'puma', 'reebok', 'new balance', 'vans', 'converse', 'tommy hilfiger', 'calvin klein', 'lacoste',
  'ralph lauren', 'polo ralph lauren', 'gap', 'benetton', 'desigual', 'pepe jeans', 'el ganso', 'scalpers', 'springfield', 'cortefiel',
  'pedro del hierro', 'sfera', 'primark', 'decathlon', 'quechua', 'kiabi', 'shein', 'asos', 'cos', 'arket', '& other stories', 'weekday',
  'monki', 'massimo dutti', 'oysho', 'lefties', 'uterqüe', 'zara', 'bershka', 'stradivarius', 'pull&bear', 'pull and bear', 'mango',
  'h&m', 'uniqlo', 'fruit of the loom', 'gildan', 'champion', 'the north face', 'patagonia', 'columbia', 'carhartt', 'dickies', 'diesel',
  'guess', 'michael kors', 'boss', 'hugo boss', 'armani', 'superdry', 'jack & jones', 'only', 'vero moda', 'tiffosi', 'salsa', 'mustang',
  'wrangler', 'lee', 'timberland', 'dr. martens', 'clarks', 'camper', 'geox', 'skechers', 'asics', 'under armour', 'fila', 'kappa',
];

export interface Recognised {
  brand: string | null;
  text: string | null;
  /** Product reference codes read on labels (Inditex style 1234/567/800, EAN-13). */
  references: string[];
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9&' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function knownBrands(): string[] {
  const names = RETAILERS.map((r) => r.name.toLowerCase());
  return [...new Set([...names, ...EXTRA_BRANDS])].sort((a, b) => b.length - a.length);
}

/** Brand and reference codes in OCR text of the garment (labels, printed logos). */
export function recognise(lines: Array<{ text: string; confidence: number }>): Recognised {
  const good = lines.filter((l) => l.confidence >= 0.35 && l.text.trim().length >= 2);
  const text = good.map((l) => l.text.trim()).join(' ').slice(0, 200) || null;
  if (!text) return { brand: null, text: null, references: [] };
  const n = ` ${norm(text)} `;
  const brand = knownBrands().find((b) => n.includes(` ${norm(b)} `)) ?? null;
  const refs = new Set<string>();
  for (const m of text.matchAll(/\b(\d{4})[/.\s](\d{3})[/.\s](\d{3})\b/g)) refs.add(`${m[1]}/${m[2]}/${m[3]}`);
  for (const m of text.matchAll(/\b(\d{13})\b/g)) refs.add(m[1]!);
  return { brand: brand ? titleCase(brand) : null, text, references: [...refs] };
}

const titleCase = (s: string) => s.replace(/(^|[\s&])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase());

const STOP = new Set(['made', 'with', 'size', 'talla', 'cotton', 'algodon', 'polyester', 'poliester', 'wash', 'lavar', 'hecho', 'fabricado', 'composicion', 'composition', 'spain', 'espana', 'china', 'india', 'turkey', 'turquia', 'bangladesh', 'morocco', 'marruecos', 'portugal']);

/** Distinctive words read on the garment's label or print (≥ 4 letters, not care/size vocabulary). */
export function labelWords(text: string | null): string[] {
  if (!text) return [];
  return [...new Set(norm(text).split(' ').filter((w) => w.length >= 4 && /[a-z]/.test(w) && !STOP.has(w)))].slice(0, 12);
}

/** Text read on the label also appears in the product's title, brand or store (e.g. an unlisted brand). */
export function textOnLabelMatches(words: string[], haystack: string): boolean {
  if (!words.length) return false;
  const hay = ` ${norm(haystack)} `;
  const hits = words.filter((w) => hay.includes(` ${w} `)).length;
  // Two distinctive words at least: a single printed word ("CALIFORNIA") is too common to identify a product.
  return hits >= 2;
}

export function canonicalPage(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|gclid|fbclid|srsltid|ref|v1)/i.test(k)) u.searchParams.delete(k);
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/$/, '')}${u.search}`;
  } catch {
    return null;
  }
}

export interface MergedCandidate extends WebCandidate {
  key: string;
  domain: string | null;
  retailerId: string | null;
  retailerName: string | null;
  /** Distinct provider+query pairs that found this product. */
  sources: string[];
  /** Distinct providers that found it (agreement between engines is evidence; one engine twice is not). */
  providers: string[];
  brandMatch: boolean;
  referenceMatch: boolean;
  score: number;
}

/**
 * Merges the candidates of every provider and query by product page (or image), and ranks them:
 * provider rank, known/Spanish store, exact image, agreement between sources, brand read on the
 * garment. Spanish stores of the registry are preferred, but any store can be proposed.
 */
export function mergeCandidates(all: WebCandidate[], recognised: Recognised): MergedCandidate[] {
  const byKey = new Map<string, MergedCandidate>();
  const brand = recognised.brand ? norm(recognised.brand) : null;
  const words = labelWords(recognised.text);
  for (const c of all) {
    const page = canonicalPage(c.pageUrl);
    const key = c.catalogProductId ? `catalog:${c.catalogProductId}` : (page ?? (c.imageUrl ? `img:${c.imageUrl}` : null));
    if (!key) continue;
    let domain: string | null = null;
    try {
      domain = c.pageUrl ? new URL(c.pageUrl).hostname.replace(/^www\./, '') : null;
    } catch {
      domain = null;
    }
    const retailer = domain ? retailerForHost(domain) : null;
    const src = `${c.provider}:${c.query}`;
    const haystack = norm([c.title, c.source, c.brand, domain].filter(Boolean).join(' '));
    const brandMatch = (!!brand && (` ${haystack} `.includes(` ${brand} `) || (!!retailer && norm(retailer.name) === brand))) || textOnLabelMatches(words, haystack);
    const referenceMatch = recognised.references.some((r) => (c.title ?? '').includes(r) || (c.pageUrl ?? '').includes(r.replace(/\//g, '')));
    const prev = byKey.get(key);
    if (prev) {
      if (!prev.sources.includes(src)) prev.sources.push(src);
      if (!prev.providers.includes(c.provider)) prev.providers.push(c.provider);
      prev.imageUrl ??= c.imageUrl;
      prev.thumbnailUrl ??= c.thumbnailUrl;
      prev.title ??= c.title;
      prev.price ??= c.price;
      prev.brand ??= c.brand;
      prev.exactImage ||= c.exactImage;
      prev.brandMatch ||= brandMatch;
      prev.referenceMatch ||= referenceMatch;
      prev.rank = Math.min(prev.rank, c.rank);
      continue;
    }
    byKey.set(key, { ...c, key, domain, retailerId: retailer?.id ?? null, retailerName: retailer?.name ?? c.source, sources: [src], providers: [c.provider], brandMatch, referenceMatch, score: 0 });
  }
  const merged = [...byKey.values()];
  for (const m of merged) {
    m.score =
      1 / (1 + 0.15 * (m.rank - 1)) +
      (m.provider === 'catalog' ? 0.6 : 0) +
      (m.retailerId ? 0.35 : 0) +
      (m.domain?.endsWith('.es') || m.pageUrl?.includes('/es/') ? 0.15 : 0) +
      (m.exactImage ? 0.4 : 0) +
      0.15 * (m.sources.length - 1) +
      0.3 * (m.providers.length - 1) +
      (m.brandMatch ? 0.5 : 0) +
      (m.referenceMatch ? 0.8 : 0) +
      (m.imageUrl ? 0.1 : -0.3);
  }
  return merged.sort((a, b) => b.score - a.score);
}

export interface PhotoCheck {
  similarity: number;
  sameCategory: boolean;
  colorOk: boolean;
  textMatch: number | null;
  studioLike: boolean;
}

export interface Verdict {
  verdict: 'exact' | 'possible' | 'rejected';
  evidence: string[];
  doubts: string[];
}

/** Exact only with a close photo AND independent identity evidence; otherwise possible or rejected. */
export function judgeMatch(m: Pick<MergedCandidate, 'provider' | 'exactImage' | 'brandMatch' | 'referenceMatch' | 'providers'>, check: PhotoCheck, limits: { exact: number; possible: number }): Verdict {
  const evidence: string[] = [];
  const doubts: string[] = [];
  if (m.referenceMatch) evidence.push('La referencia de la etiqueta coincide.');
  if (m.brandMatch) evidence.push('La marca leída en la prenda coincide.');
  if (m.exactImage) evidence.push('La misma imagen aparece en la página de la tienda.');
  if (m.providers.length >= 2) evidence.push(`Lo encuentran ${m.providers.length} buscadores distintos.`);
  if (m.provider === 'catalog') evidence.push('Está en un catálogo autorizado conectado.');
  if (check.textMatch !== null && check.textMatch >= 0.5) evidence.push('El texto o logotipo de la prenda coincide.');
  if (!check.sameCategory) return { verdict: 'rejected', evidence, doubts: ['Es otro tipo de prenda.'] };
  if (check.similarity < limits.possible) return { verdict: 'rejected', evidence, doubts: ['No se parece lo suficiente.'] };
  if (!check.colorOk) doubts.push('El color no coincide del todo (puede ser otra variante).');
  if (check.similarity < limits.exact) doubts.push('Se parece, pero no lo bastante para asegurar que es el mismo modelo.');
  if (check.textMatch !== null && check.textMatch < 0.5) doubts.push('El texto o logotipo no coincide.');
  const independent = m.referenceMatch || m.brandMatch || m.exactImage || m.providers.length >= 2 || (m.provider === 'catalog' && check.similarity >= limits.exact + 0.04);
  if (!independent) doubts.push('Solo hay parecido visual: ninguna marca, referencia ni otra fuente lo confirma.');
  return { verdict: doubts.length ? 'possible' : 'exact', evidence, doubts };
}
