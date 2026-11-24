/**
 * Reverse image search providers. Each one sends a garment photo to an external service and returns
 * normalised candidates (a product page, its image, store, price). Credentials stay in the backend
 * (env vars); a provider without them reports `not_configured` and is skipped — nothing is simulated.
 *
 * - Google Lens through SerpApi (https://serpapi.com/google-lens-api). The photo is uploaded first
 *   with SerpApi's Image API (https://serpapi.com/image-api: ≤ 500 KB, returns an `image_id` valid
 *   for 10 minutes), so no public URL of the user's photo is ever needed. `country=es`, `hl=es`.
 * - Google Cloud Vision Web Detection (https://docs.cloud.google.com/vision/docs/detecting-web):
 *   pages with matching images, visually similar images, web entities and best-guess labels.
 * - Lykdat Global Search (https://apidocs.lykdat.com/): fashion products of its indexed stores.
 *
 * The authorised-catalogue search (FashionSigLIP over catalog_products) lives in service.ts: it needs
 * no external call.
 */
import sharp from 'sharp';

export type SearchProviderId = 'serpapi_lens' | 'cloud_vision' | 'lykdat' | 'catalog';

export interface WebCandidate {
  provider: SearchProviderId;
  /** Which photo found it: the garment crop or the whole photo. */
  query: 'crop' | 'full' | 'catalog';
  rank: number;
  title: string | null;
  pageUrl: string | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  /** Store or site name as the provider reports it. */
  source: string | null;
  brand: string | null;
  price: { cents: number; currency: string } | null;
  /** The provider says this page shows the very same image (not just a similar one). */
  exactImage: boolean;
  catalogProductId?: string;
}

export interface SearchOutput {
  candidates: WebCandidate[];
  /** Words the provider recognised (Cloud Vision entities / best guess). */
  hints: string[];
  /** Raw response kept in the cache (trimmed). */
  raw: unknown;
}

export interface SearchProvider {
  id: SearchProviderId;
  label: string;
  /** Env vars needed (shown in GET /v1/catalog-photos/status when missing). */
  requires: string[];
  configured: boolean;
  costCents: number;
  search(image: Buffer, opts: { query: 'crop' | 'full'; text?: string | null }): Promise<SearchOutput>;
}

export class SearchError extends Error {
  readonly retryable: boolean;
  readonly status: number | null;
  constructor(message: string, retryable: boolean, status: number | null = null) {
    super(message);
    this.retryable = retryable;
    this.status = status;
  }
}

type Fetcher = typeof fetch;

async function call(fetcher: Fetcher, url: string, init: RequestInit, label: string, timeoutMs = 45_000): Promise<unknown> {
  let res: Response;
  try {
    res = await fetcher(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw new SearchError(`${label} no responde (${(e as Error).name}).`, true);
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  const err = body && typeof body === 'object' && 'error' in body ? (body as { error: unknown }).error : null;
  if (!res.ok) {
    const msg = typeof err === 'string' ? err : err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : text.slice(0, 200);
    throw new SearchError(`${label} respondió ${res.status}: ${msg}`, res.status === 429 || res.status >= 500, res.status);
  }
  return body;
}

/** JPEG of at most `maxBytes` (SerpApi uploads are capped at 500 KB). */
export async function jpegUnder(image: Buffer, maxBytes: number, maxSide = 1600): Promise<Buffer> {
  let side = maxSide;
  for (let q = 88; ; q -= 8) {
    const out = await sharp(image).rotate().flatten({ background: '#ffffff' }).resize(side, side, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: Math.max(q, 50), mozjpeg: true }).toBuffer();
    if (out.length <= maxBytes) return out;
    if (q <= 56) side = Math.round(side * 0.75);
    if (side < 320) return out;
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const hostOf = (u: string | undefined): string | null => {
  try {
    return u ? new URL(u).hostname.replace(/^www\./, '') : null;
  } catch {
    return null;
  }
};

function money(value: unknown, currency: unknown): { cents: number; currency: string } | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.replace(',', '.').replace(/[^\d.]/g, '')) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  const cur = typeof currency === 'string' ? ({ '€': 'EUR', $: 'USD', '£': 'GBP' } as Record<string, string>)[currency] ?? currency.toUpperCase().slice(0, 3) : 'EUR';
  return { cents: Math.round(n * 100), currency: cur };
}

// ---------------------------------------------------------------------------
// Google Lens via SerpApi
// ---------------------------------------------------------------------------

export function parseSerpApiLens(body: unknown, query: 'crop' | 'full'): SearchOutput {
  const b = (body ?? {}) as { visual_matches?: Array<Record<string, unknown>>; exact_matches?: Array<Record<string, unknown>>; error?: string };
  const out: WebCandidate[] = [];
  for (const m of b.visual_matches ?? []) {
    const price = m.price as { extracted_value?: number; currency?: string } | undefined;
    out.push({
      provider: 'serpapi_lens',
      query,
      rank: Number(m.position ?? out.length + 1),
      title: str(m.title),
      pageUrl: str(m.link),
      imageUrl: str(m.image),
      thumbnailUrl: str(m.thumbnail),
      source: str(m.source),
      brand: null,
      price: price ? money(price.extracted_value, price.currency) : null,
      exactImage: m.exact_matches === true,
    });
  }
  for (const m of b.exact_matches ?? []) {
    out.push({
      provider: 'serpapi_lens',
      query,
      rank: Number(m.position ?? out.length + 1),
      title: str(m.title),
      pageUrl: str(m.link),
      imageUrl: null,
      thumbnailUrl: str(m.thumbnail),
      source: str(m.source),
      brand: null,
      price: money(m.extracted_price, null),
      exactImage: true,
    });
  }
  return { candidates: out, hints: [], raw: { visual_matches: (b.visual_matches ?? []).slice(0, 30), exact_matches: (b.exact_matches ?? []).slice(0, 10) } };
}

export class SerpApiLens implements SearchProvider {
  readonly id = 'serpapi_lens' as const;
  readonly label = 'Google Lens (SerpApi)';
  readonly requires = ['SERPAPI_API_KEY'];
  readonly configured: boolean;
  readonly costCents: number;
  private readonly opts: { apiKey?: string; country: string; hl: string; costCents: number; fetcher?: Fetcher };
  constructor(opts: { apiKey?: string; country: string; hl: string; costCents: number; fetcher?: Fetcher }) {
    this.opts = opts;
    this.configured = !!opts.apiKey;
    this.costCents = opts.costCents;
  }

  async search(image: Buffer, o: { query: 'crop' | 'full'; text?: string | null }): Promise<SearchOutput> {
    if (!this.opts.apiKey) throw new SearchError('Google Lens no está configurado (falta SERPAPI_API_KEY).', false);
    const fetcher = this.opts.fetcher ?? fetch;
    const fd = new FormData();
    fd.append('api_key', this.opts.apiKey);
    fd.append('image', new Blob([new Uint8Array(await jpegUnder(image, 490_000))], { type: 'image/jpeg' }), 'garment.jpg');
    const up = (await call(fetcher, 'https://serpapi.com/image', { method: 'POST', body: fd }, 'SerpApi (subida)')) as { image_id?: string; error?: string };
    if (!up?.image_id) throw new SearchError(`SerpApi no aceptó la foto: ${up?.error ?? 'sin image_id'}`, false);
    const q = new URLSearchParams({ engine: 'google_lens', image_id: up.image_id, type: 'all', hl: this.opts.hl, country: this.opts.country, api_key: this.opts.apiKey });
    if (o.text) q.set('q', o.text.slice(0, 120));
    const body = (await call(fetcher, `https://serpapi.com/search.json?${q}`, { method: 'GET' }, 'Google Lens (SerpApi)')) as { search_metadata?: { status?: string }; error?: string };
    if (body?.search_metadata?.status === 'Error') throw new SearchError(`Google Lens: ${body.error ?? 'error'}`, true);
    return parseSerpApiLens(body, o.query);
  }
}

// ---------------------------------------------------------------------------
// Google Cloud Vision — Web Detection
// ---------------------------------------------------------------------------

export function parseCloudVisionWeb(body: unknown, query: 'crop' | 'full'): SearchOutput {
  const resp = ((body ?? {}) as { responses?: Array<{ webDetection?: Record<string, unknown>; error?: { message?: string } }> }).responses?.[0];
  if (resp?.error) throw new SearchError(`Cloud Vision: ${resp.error.message ?? 'error'}`, false);
  const wd = (resp?.webDetection ?? {}) as {
    pagesWithMatchingImages?: Array<{ url?: string; pageTitle?: string; fullMatchingImages?: Array<{ url?: string }>; partialMatchingImages?: Array<{ url?: string }> }>;
    visuallySimilarImages?: Array<{ url?: string }>;
    webEntities?: Array<{ description?: string; score?: number }>;
    bestGuessLabels?: Array<{ label?: string }>;
  };
  const out: WebCandidate[] = [];
  const stripTags = (s: string | undefined) => (s ? s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim() : null);
  for (const p of wd.pagesWithMatchingImages ?? []) {
    const full = p.fullMatchingImages?.[0]?.url;
    out.push({
      provider: 'cloud_vision',
      query,
      rank: out.length + 1,
      title: stripTags(p.pageTitle),
      pageUrl: str(p.url),
      imageUrl: str(full ?? p.partialMatchingImages?.[0]?.url),
      thumbnailUrl: null,
      source: hostOf(p.url),
      brand: null,
      price: null,
      exactImage: !!full,
    });
  }
  for (const s of wd.visuallySimilarImages ?? []) {
    out.push({ provider: 'cloud_vision', query, rank: out.length + 1, title: null, pageUrl: null, imageUrl: str(s.url), thumbnailUrl: null, source: null, brand: null, price: null, exactImage: false });
  }
  const hints = [...(wd.bestGuessLabels ?? []).map((l) => l.label), ...(wd.webEntities ?? []).filter((e) => (e.score ?? 0) >= 0.4).map((e) => e.description)].filter((x): x is string => !!x);
  return { candidates: out, hints, raw: { webDetection: wd } };
}

export class CloudVisionWeb implements SearchProvider {
  readonly id = 'cloud_vision' as const;
  readonly label = 'Google Cloud Vision (Web Detection)';
  readonly requires = ['GOOGLE_CLOUD_VISION_API_KEY'];
  readonly configured: boolean;
  readonly costCents: number;
  private readonly opts: { apiKey?: string; costCents: number; fetcher?: Fetcher };
  constructor(opts: { apiKey?: string; costCents: number; fetcher?: Fetcher }) {
    this.opts = opts;
    this.configured = !!opts.apiKey;
    this.costCents = opts.costCents;
  }

  async search(image: Buffer, o: { query: 'crop' | 'full' }): Promise<SearchOutput> {
    if (!this.opts.apiKey) throw new SearchError('Cloud Vision no está configurado (falta GOOGLE_CLOUD_VISION_API_KEY).', false);
    const jpeg = await jpegUnder(image, 4_000_000, 1600);
    const body = await call(
      this.opts.fetcher ?? fetch,
      'https://vision.googleapis.com/v1/images:annotate',
      {
        method: 'POST',
        headers: { 'x-goog-api-key': this.opts.apiKey, 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ requests: [{ image: { content: jpeg.toString('base64') }, features: [{ type: 'WEB_DETECTION', maxResults: 30, model: 'builtin/latest' }] }] }),
      },
      'Google Cloud Vision',
    );
    return parseCloudVisionWeb(body, o.query);
  }
}

// ---------------------------------------------------------------------------
// Lykdat Global Search
// ---------------------------------------------------------------------------

export function parseLykdat(body: unknown, query: 'crop' | 'full'): SearchOutput {
  const groups = ((body ?? {}) as { data?: { result_groups?: Array<{ similar_products?: Array<Record<string, unknown>> }> } }).data?.result_groups ?? [];
  const out: WebCandidate[] = [];
  for (const g of groups) {
    for (const p of g.similar_products ?? []) {
      const images = Array.isArray(p.images) ? (p.images as unknown[]).map(str).filter((x): x is string => !!x) : [];
      out.push({
        provider: 'lykdat',
        query,
        rank: out.length + 1,
        title: str(p.name),
        pageUrl: str(p.url),
        imageUrl: str(p.matching_image) ?? images[0] ?? null,
        thumbnailUrl: images[0] ?? null,
        source: str(p.vendor),
        brand: str(p.brand_name),
        price: money(p.reduced_price ?? p.price, p.currency),
        exactImage: false,
      });
    }
  }
  return { candidates: out, hints: [], raw: { result_groups: groups.slice(0, 3) } };
}

export class LykdatSearch implements SearchProvider {
  readonly id = 'lykdat' as const;
  readonly label = 'Lykdat';
  readonly requires = ['LYKDAT_API_KEY'];
  readonly configured: boolean;
  readonly costCents: number;
  private readonly opts: { apiKey?: string; costCents: number; fetcher?: Fetcher };
  constructor(opts: { apiKey?: string; costCents: number; fetcher?: Fetcher }) {
    this.opts = opts;
    this.configured = !!opts.apiKey;
    this.costCents = opts.costCents;
  }

  async search(image: Buffer, o: { query: 'crop' | 'full' }): Promise<SearchOutput> {
    if (!this.opts.apiKey) throw new SearchError('Lykdat no está configurado (falta LYKDAT_API_KEY).', false);
    const fd = new FormData();
    fd.append('api_key', this.opts.apiKey);
    fd.append('image', new Blob([new Uint8Array(await jpegUnder(image, 3_000_000, 1600))], { type: 'image/jpeg' }), 'garment.jpg');
    return parseLykdat(await call(this.opts.fetcher ?? fetch, 'https://cloudapi.lykdat.com/v1/global/search', { method: 'POST', body: fd }, 'Lykdat'), o.query);
  }
}
