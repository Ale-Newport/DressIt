/**
 * CJ (Commission Junction) Product Feed GraphQL API, `shoppingProducts` query (publisher side).
 * Docs read 2026-11-24: https://developers.cj.com/graphql/reference/Product%20Feed (schema JSON served by
 * the portal: production-doc-pipeline-assets-store…/docs/api/graphql/public/Product%20Feed.json)
 *
 *   POST https://ads.api.cj.com/query   Authorization: Bearer <personal access token>
 *   shoppingProducts(companyId: ID!, partnerIds: [ID!], partnerStatus: JOINED|NOT_JOINED, offset: Int, limit: Int)
 *     → { totalCount, count, limit, resultList: [Shopping] }
 *   Shopping: id, title, description, brand, link, imageLink, additionalImageLink, price { amount currency },
 *     salePrice { amount currency }, availability (IN_STOCK|OUT_OF_STOCK|PREORDER|BACKORDER), size, color,
 *     gtin, material, itemGroupId, lastUpdated, advertiserName, productType, linkCode(pid: ID!) { clickUrl }
 *   limit: "Default is 1,000. Cannot specify a limit greater than 10,000." Offset pagination only (no
 *   nextPage on shoppingProducts) → at most 10,000 results per advertiser here.
 *   "Call limit: 500 calls per 5 minutes." (throttle status not documented → generic 429 handling)
 */
import { RateLimitedClient, defaultHttpDeps, type HttpDeps } from './http.ts';
import { availabilityToStock, groupVariants, httpUrl, parseMapping, pricePair, type CatalogSource, type FeedProduct, type IngestJob } from './types.ts';

export const CJ_MAX_OFFSET = 10_000;
const PAGE_SIZE = 1000;

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null);
const ID = /^[A-Za-z0-9_-]{1,40}$/;

export function cjQuery(companyId: string, advertiserId: string, pid: string, offset: number, limit = PAGE_SIZE): string {
  if (![companyId, advertiserId, pid].every((v) => ID.test(v))) throw new Error('CJ: los identificadores (CJ_COMPANY_ID, CJ_WEBSITE_ID, CJ_ADVERTISERS) deben ser alfanuméricos');
  return `{ shoppingProducts(companyId: "${companyId}", partnerIds: ["${advertiserId}"], partnerStatus: JOINED, offset: ${offset}, limit: ${limit}) { totalCount count limit resultList { id title description brand link imageLink additionalImageLink price { amount currency } salePrice { amount currency } availability size color material gtin itemGroupId lastUpdated advertiserName productType linkCode(pid: "${pid}") { clickUrl } } } }`;
}

export function mapCjProduct(p: Obj): FeedProduct | null {
  const id = str(p.id);
  const title = str(p.title);
  const link = httpUrl(p.link);
  const click = httpUrl(obj(p.linkCode).clickUrl);
  if (!id || !title || !(link || click)) return null;
  const price = obj(p.price);
  const sale = obj(p.salePrice);
  const { priceCents, originalPriceCents } = pricePair(price.amount, sale.amount);
  const inStock = availabilityToStock(p.availability);
  const size = str(p.size);
  const color = str(p.color);
  const group = str(p.itemGroupId);
  return {
    retailerHint: str(p.advertiserName) ?? '',
    externalId: id,
    title,
    brand: str(p.brand),
    description: str(p.description)?.slice(0, 1000) ?? null,
    category: Array.isArray(p.productType) ? p.productType.filter((x) => typeof x === 'string').join(' > ') || null : null,
    colorName: color,
    material: str(p.material),
    productUrl: (link ?? click)!,
    affiliateUrl: click,
    imageUrls: [httpUrl(p.imageLink), ...(Array.isArray(p.additionalImageLink) ? p.additionalImageLink.map(httpUrl) : [])].filter((x): x is string => !!x),
    priceCents,
    originalPriceCents,
    currency: str(price.currency) ?? str(sale.currency) ?? 'EUR',
    inStock,
    sizes: size ? [{ label: size, available: inStock }] : [],
    gtin: (str(p.gtin) ?? '').replace(/\D/g, '') || null,
    updatedAt: str(p.lastUpdated),
    groupId: group ? `${group}${color ? `:${color.toLowerCase()}` : ''}` : null,
  };
}

export async function fetchCjAdvertiser(client: RateLimitedClient, token: string, companyId: string, pid: string, advertiserId: string): Promise<{ products: FeedProduct[]; warnings: string[] }> {
  const products: FeedProduct[] = [];
  const warnings: string[] = [];
  let total = 0;
  for (let offset = 0; offset < CJ_MAX_OFFSET; ) {
    const limit = Math.min(PAGE_SIZE, CJ_MAX_OFFSET - offset);
    const res = await client.request('https://ads.api.cj.com/query', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: cjQuery(companyId, advertiserId, pid, offset, limit) }),
    });
    const body = obj(await res.json());
    if (Array.isArray(body.errors) && body.errors.length) throw new Error(`CJ GraphQL: ${body.errors.map((e) => str(obj(e).message) ?? 'error').join('; ').slice(0, 300)}`);
    const sp = obj(obj(body.data).shoppingProducts);
    total = Number(sp.totalCount ?? 0);
    const list = Array.isArray(sp.resultList) ? sp.resultList.map(obj) : [];
    for (const raw of list) {
      const p = mapCjProduct(raw);
      if (p) products.push(p);
    }
    const count = Number(sp.count ?? list.length);
    if (!count) break;
    offset += count;
    if (offset >= total) break;
  }
  if (total > CJ_MAX_OFFSET) warnings.push(`El anunciante ${advertiserId} tiene ${total} productos; la consulta shoppingProducts pagina por offset hasta ${CJ_MAX_OFFSET}.`);
  return { products: groupVariants(products), warnings };
}

export interface CjEnv {
  CJ_PERSONAL_ACCESS_TOKEN?: string | undefined;
  CJ_COMPANY_ID?: string | undefined;
  CJ_WEBSITE_ID?: string | undefined;
  CJ_ADVERTISERS?: string | undefined;
}

export function cjSource(env: CjEnv, deps: HttpDeps = defaultHttpDeps): CatalogSource {
  const advertisers = parseMapping(env.CJ_ADVERTISERS);
  // Documented: 500 calls per 5 minutes → one call every 600 ms.
  const client = new RateLimitedClient(deps, { label: 'CJ Product Feed API', minIntervalMs: 600 });
  const missing = () => ['CJ_PERSONAL_ACCESS_TOKEN', 'CJ_COMPANY_ID', 'CJ_WEBSITE_ID'].filter((k) => !env[k as keyof CjEnv]);
  return {
    id: 'cj',
    provider: 'cj',
    name: 'CJ · Product Feed GraphQL API',
    provenance: 'api',
    docs: ['https://developers.cj.com/graphql/reference/Product%20Feed'],
    env: ['CJ_PERSONAL_ACCESS_TOKEN', 'CJ_COMPANY_ID', 'CJ_WEBSITE_ID', 'CJ_ADVERTISERS'],
    missing,
    statusFor(retailerId) {
      if (missing().length) return { status: 'pending_credentials', detail: `Faltan ${missing().join(', ')} (token personal de CJ, ID de empresa y PID de tu web).` };
      if (!advertisers.has(retailerId)) return { status: 'pending_credentials', detail: 'Credenciales de CJ presentes; falta el ID del anunciante en CJ_ADVERTISERS (tienda=ID).' };
      return { status: 'configured', detail: `API de productos de CJ configurada (anunciante ${advertisers.get(retailerId)}).` };
    },
    async jobs() {
      if (missing().length) return [];
      return [...advertisers].map(([retailerId, advertiserId]): IngestJob => ({
        sourceId: 'cj',
        provider: 'cj',
        network: 'cj',
        provenance: 'api',
        retailerId,
        label: `cj:advertiser=${advertiserId}`,
        fetch: () => fetchCjAdvertiser(client, env.CJ_PERSONAL_ACCESS_TOKEN!, env.CJ_COMPANY_ID!, env.CJ_WEBSITE_ID!, advertiserId),
      }));
    },
  };
}
