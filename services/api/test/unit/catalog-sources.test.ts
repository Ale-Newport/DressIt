/**
 * Official catalog source adapters, tested ONLY with mocked HTTP and synthetic fixtures
 * (test/fixtures/sources, labelled SINTÉTICO). No real network or API is ever called.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.ts';
import { awinEnhancedSource, awinFeedSource, parseAwinEnhancedJsonl, parseAwinFeedList } from '../../src/modules/catalog/sources/awin.ts';
import { cjQuery, cjSource } from '../../src/modules/catalog/sources/cj.ts';
import { RateLimitedClient, parseRetryAfter, redactUrl, type HttpDeps } from '../../src/modules/catalog/sources/http.ts';
import { createCatalogSources, providerStatusFor } from '../../src/modules/catalog/sources/index.ts';
import { parseRakutenProductSearch, rakutenSource } from '../../src/modules/catalog/sources/rakuten.ts';
import { TRADEDOUBLER_MAX_RESULTS, mapTradedoublerProduct, tradedoublerSource } from '../../src/modules/catalog/sources/tradedoubler.ts';
import { parseMapping, type FeedProduct } from '../../src/modules/catalog/sources/types.ts';
import { awinProgrammeIds } from '../../src/modules/catalog/providers.ts';
import { productScore } from '@dressit/stylist-engine';

const fx = (name: string) => readFileSync(resolve(import.meta.dirname, '../fixtures/sources', name), 'utf8');

interface Call {
  url: string;
  init: RequestInit | undefined;
  at: number;
}

/** Mocked HTTP + fake clock: `sleep` advances time instantly and is recorded. */
function mockHttp(handler: (url: string, init: RequestInit | undefined, n: number) => Response | Promise<Response>) {
  let clock = 1_000_000;
  const calls: Call[] = [];
  const sleeps: number[] = [];
  const deps: HttpDeps = {
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init, at: clock });
      return handler(url, init, calls.length);
    }) as typeof fetch,
  };
  return { deps, calls, sleeps };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const header = (init: RequestInit | undefined, name: string) => new Headers(init?.headers).get(name);

describe('polite HTTP client (rate limits)', () => {
  it('spaces requests by the documented minimum interval', async () => {
    const { deps, calls } = mockHttp(() => json({}));
    const c = new RateLimitedClient(deps, { label: 'test', minIntervalMs: 12_000 });
    await c.request('https://api.example.test/a');
    await c.request('https://api.example.test/b');
    await c.request('https://api.example.test/c');
    expect(calls[1]!.at - calls[0]!.at).toBeGreaterThanOrEqual(12_000);
    expect(calls[2]!.at - calls[1]!.at).toBeGreaterThanOrEqual(12_000);
  });
  it('waits for Retry-After on 429 and then retries', async () => {
    const { deps, calls, sleeps } = mockHttp((_u, _i, n) => (n === 1 ? new Response('slow down', { status: 429, headers: { 'retry-after': '7' } }) : json({ ok: true })));
    const c = new RateLimitedClient(deps, { label: 'test', minIntervalMs: 0 });
    const res = await c.request('https://api.example.test/x');
    expect(await res.json()).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
    expect(sleeps).toContain(7000);
  });
  it('gives up (without sleeping for ages) when the server asks to wait too long', async () => {
    const { deps } = mockHttp(() => new Response('', { status: 429, headers: { 'retry-after': '3600' } }));
    const c = new RateLimitedClient(deps, { label: 'Red X', minIntervalMs: 0, maxWaitMs: 60_000 });
    await expect(c.request('https://api.example.test/x')).rejects.toThrow(/Red X: límite de peticiones/);
  });
  it('does not retry client errors and never leaks tokens in messages', async () => {
    const { deps, calls } = mockHttp(() => new Response('{"code":"PF_392"}', { status: 400 }));
    const c = new RateLimitedClient(deps, { label: 'Tradedoubler', minIntervalMs: 0 });
    const err = await c.request('https://api.tradedoubler.com/1.0/products.json;fid=1?token=SECRET123').catch((e: Error) => e);
    expect(calls).toHaveLength(1);
    expect((err as Error).message).toMatch(/HTTP 400/);
    expect((err as Error).message).not.toContain('SECRET123');
  });
  it('retries transient 5xx with backoff', async () => {
    const { deps, calls } = mockHttp((_u, _i, n) => (n < 3 ? new Response('', { status: 503 }) : json({})));
    await new RateLimitedClient(deps, { label: 't', minIntervalMs: 0 }).request('https://api.example.test/');
    expect(calls).toHaveLength(3);
  });
  it('parses Retry-After and redacts secrets in URLs', () => {
    expect(parseRetryAfter('120', 0)).toBe(120_000);
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 0)).toBe(10_000);
    expect(parseRetryAfter(null, 0)).toBeNull();
    expect(redactUrl('https://productdata.awin.com/datafeed/download/apikey/abc123/fid/1/')).toBe('https://productdata.awin.com/datafeed/download/apikey/***/fid/1/');
    expect(redactUrl('https://ui.awin.com/productdata-darwin-download/publisher/1/KEY/1/feedList')).not.toContain('KEY');
    expect(redactUrl('https://x.test/a?token=abc&q=1')).toBe('https://x.test/a?token=***&q=1');
  });
});

describe('Awin', () => {
  it('reads the documented feed list and only ingests joined, Awin-format, mapped advertisers', async () => {
    const list = parseAwinFeedList(fx('awin-feedlist.csv'));
    expect(list).toHaveLength(4);
    expect(list[0]).toMatchObject({ advertiserId: '105405', membershipStatus: 'active', format: 'Awin', feedId: '9001' });
    const { deps, calls } = mockHttp(() => new Response(fx('awin-feedlist.csv')));
    const src = awinFeedSource({ AWIN_PUBLISHER_ID: '1', AWIN_PRODUCTDATA_API_KEY: 'FEEDKEY' }, new Map([['decathlon', '105405'], ['adidas', '77008'], ['bimbaylola', '129495']]), deps);
    const jobs = await src.jobs();
    expect(calls[0]!.url).toBe('https://ui.awin.com/productdata-darwin-download/publisher/1/FEEDKEY/1/feedList');
    expect(jobs.map((j) => j.retailerId)).toEqual(['decathlon']); // adidas not joined, Bimba = Google format, 424242 unmapped
    expect(jobs[0]!.label).not.toContain('FIXTUREKEY');
    expect(jobs[0]!.provenance).toBe('feed');
  });
  it('downloads a discovered CSV feed and maps it with the legacy Awin columns', async () => {
    const csv = readFileSync(resolve(import.meta.dirname, '../fixtures/awin-feed-fixture.csv'));
    const { deps } = mockHttp((url) => (url.includes('feedList') ? new Response(fx('awin-feedlist.csv')) : new Response(csv)));
    const src = awinFeedSource({ AWIN_PUBLISHER_ID: '1', AWIN_PRODUCTDATA_API_KEY: 'K' }, new Map([['decathlon', '105405']]), deps);
    const [job] = await src.jobs();
    const { products } = await job!.fetch();
    expect(products).toHaveLength(6);
    expect(products[0]!.affiliateUrl).toMatch(/^https:\/\/www\.awin1\.com\//);
  });
  it('fails loudly when a CSV feed lacks the key columns', async () => {
    const { deps } = mockHttp(() => new Response('foo,bar\n1,2\n'));
    const src = awinFeedSource({ AWIN_FEED_URLS: 'decathlon=https://productdata.awin.com/datafeed/download/apikey/K/fid/1/' }, new Map(), deps);
    const [job] = await src.jobs();
    await expect(job!.fetch()).rejects.toThrow(/columnas necesarias/);
  });
  it('maps Enhanced (Google-format) JSONL, grouped and flat, merging sizes of the same item group', () => {
    const { products, warnings } = parseAwinEnhancedJsonl(fx('awin-enhanced.jsonl'));
    expect(products).toHaveLength(2);
    const hoodie = products[0]!;
    expect(hoodie).toMatchObject({ externalId: 'AE-1:gris', title: 'Sudadera técnica gris (fixture)', brand: 'Marca Fixture', priceCents: 2999, originalPriceCents: 3999, currency: 'EUR', inStock: true, colorName: 'Gris', category: 'Hombre > Sudaderas', gtin: '4006381333931' });
    expect(hoodie.affiliateUrl).toMatch(/^https:\/\/www\.awin1\.com\/cread\.php/);
    expect(hoodie.productUrl).toMatch(/^https:\/\/shop\.example\.test\//);
    expect(hoodie.sizes).toEqual([{ label: 'S', available: true }, { label: 'M', available: false }]);
    expect(hoodie.imageUrls).toEqual(['https://cdn.example.test/ae-1.jpg', 'https://cdn.example.test/ae-1-b.jpg']);
    expect(products[1]).toMatchObject({ externalId: 'AE-2', priceCents: 2499, originalPriceCents: null, affiliateUrl: null });
    expect(warnings[0]).toMatch(/1 línea/);
  });
  it('treats an error object on the last JSONL line as an incomplete download (documented)', () => {
    const text = `${fx('awin-enhanced.jsonl').trim()}\n{"error": 500, "message": "Internal server error"}\n`;
    expect(() => parseAwinEnhancedJsonl(text)).toThrow(/incompleta.*Internal server error/);
  });
  it('calls the Enhanced endpoint with Bearer auth, es_ES locale and ≤5 requests/minute', async () => {
    const { deps, calls } = mockHttp(() => new Response(fx('awin-enhanced.jsonl')));
    const src = awinEnhancedSource({ AWIN_PUBLISHER_ID: '555', AWIN_API_TOKEN: 'TOK', AWIN_ADVERTISERS: 'decathlon=105405,adidas=77008' }, deps);
    const jobs = await src.jobs();
    expect(jobs.map((j) => [j.retailerId, j.provenance])).toEqual([['decathlon', 'api'], ['adidas', 'api']]);
    for (const j of jobs) await j.fetch();
    expect(calls[0]!.url).toBe('https://api.awin.com/publishers/555/awinfeeds/download/105405-retail-es_ES.jsonl');
    expect(header(calls[0]!.init, 'authorization')).toBe('Bearer TOK');
    expect(calls[1]!.at - calls[0]!.at).toBeGreaterThanOrEqual(12_000);
    expect(jobs[0]!.label).not.toContain('TOK');
  });
});

describe('Tradedoubler Products API', () => {
  it('maps the documented JSON (offers, priceHistory, identifiers, custom colour field)', () => {
    const body = JSON.parse(fx('tradedoubler-page-0.json'));
    const p = mapTradedoublerProduct(body.products[0], '777')!;
    expect(p).toMatchObject({ externalId: 'TD-1', title: 'Vestido midi estampado (fixture)', brand: 'Marca Fixture', priceCents: 4995, originalPriceCents: null, currency: 'EUR', inStock: true, colorName: 'Azul', gtin: '8412345678905', productUrl: 'https://shop.example.test/p/td-1', category: 'Mujer > Vestidos' });
    expect(p.affiliateUrl).toMatch(/^https:\/\/pdt\.tradedoubler\.com\/click/);
    expect(p.sizes.map((s) => s.label)).toEqual(['S', 'M', 'L']);
    const bag = mapTradedoublerProduct(body.products[1], '777')!;
    expect(bag).toMatchObject({ priceCents: 8900, inStock: false });
    expect(bag.productUrl).toBe(bag.affiliateUrl); // no sourceProductUrl → tracked link is the only documented URL
  });
  it('paginates with ;page;pageSize;limit until totalHits and sends the token as a query parameter', async () => {
    const { deps, calls } = mockHttp((url) => new Response(url.includes(';page=0;') ? fx('tradedoubler-page-0.json') : fx('tradedoubler-page-1.json')));
    const src = tradedoublerSource({ TRADEDOUBLER_PRODUCTS_TOKEN: 'abcdef0123', TRADEDOUBLER_FEEDS: 'desigual=777' }, deps);
    const [job] = await src.jobs();
    const { products, warnings } = await job!.fetch();
    expect(products.map((p) => p.externalId)).toEqual(['TD-1', 'TD-2', 'TD-3']);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toBe('https://api.tradedoubler.com/1.0/products.json;fid=777;page=0;pageSize=100;limit=100;dateOutputFormat=iso8601?token=abcdef0123');
    expect(calls[1]!.url).toContain(';page=1;pageSize=100;limit=200;');
    expect(calls[1]!.at - calls[0]!.at).toBeGreaterThanOrEqual(1000);
    expect(warnings).toEqual([]);
    expect(job!.label).not.toContain('abcdef0123');
  });
  it('stops at the documented 1,000-product search cap and says so', async () => {
    const page = (p: number) => ({ productHeader: { totalHits: 2500 }, products: Array.from({ length: 100 }, (_, i) => ({ name: `Producto ${p}-${i} (fixture)`, offers: [{ feedId: 1, sourceProductId: `P${p}-${i}`, productUrl: `https://pdt.tradedoubler.com/click?p${p}i${i}`, price: { value: '10', currency: 'EUR' } }] })) });
    const { deps, calls } = mockHttp((url) => json(page(Number(/;page=(\d+)/.exec(url)![1]))));
    const [job] = await tradedoublerSource({ TRADEDOUBLER_PRODUCTS_TOKEN: 't', TRADEDOUBLER_FEEDS: 'x=1' }, deps).jobs();
    const { products, warnings } = await job!.fetch();
    expect(products).toHaveLength(TRADEDOUBLER_MAX_RESULTS);
    expect(calls).toHaveLength(10);
    expect(warnings[0]).toMatch(/2500 productos/);
  });
});

describe('Rakuten Advertising Product Search API', () => {
  it('parses the documented XML', () => {
    const r = parseRakutenProductSearch(fx('rakuten-page-1.xml'));
    expect(r).toMatchObject({ totalPages: 2, pageNumber: 1, totalMatches: 3, error: null });
    expect(r.products[0]).toMatchObject({ externalId: 'RK-1', title: 'Abrigo de lana camel (fixture)', priceCents: 11999, originalPriceCents: 14999, currency: 'EUR', category: 'Mujer > Abrigos > Abrigo largo', gtin: '4006381333931', brand: null, inStock: null, imageUrls: ['https://cdn.example.test/rk-1.jpg'] });
    expect(r.products[0]!.affiliateUrl).toBe('https://click.linksynergy.example.test/link?id=fixture&offerid=1&murl=https%3A%2F%2Fshop.example.test%2Fp%2Frk-1');
    expect(r.products[1]).toMatchObject({ priceCents: 3999, originalPriceCents: null });
  });
  it('gets a token (Bearer base64(client:secret), scope=account) and walks every page at ≤100 calls/min', async () => {
    const { deps, calls } = mockHttp((url) => {
      if (url.endsWith('/token')) return json({ access_token: 'ACCESS', expires_in: 3600, refresh_token: 'R', token_type: 'bearer' });
      return new Response(url.includes('pagenumber=1') ? fx('rakuten-page-1.xml') : fx('rakuten-page-2.xml'), { headers: { 'content-type': 'application/xml' } });
    });
    const src = rakutenSource({ RAKUTEN_CLIENT_ID: 'cid', RAKUTEN_CLIENT_SECRET: 'sec', RAKUTEN_ACCOUNT_ID: '3456', RAKUTEN_ADVERTISERS: 'mango=99001' }, deps);
    const [job] = await src.jobs();
    const { products } = await job!.fetch();
    expect(products.map((p) => p.externalId)).toEqual(['RK-1', 'RK-2', 'RK-3']);
    expect(calls).toHaveLength(3);
    expect(calls[0]!.init?.method).toBe('POST');
    expect(header(calls[0]!.init, 'authorization')).toBe(`Bearer ${Buffer.from('cid:sec').toString('base64')}`);
    expect(String(calls[0]!.init?.body)).toBe('scope=3456');
    expect(calls[1]!.url).toBe('https://api.linksynergy.com/productsearch/1.0?mid=99001&max=100&pagenumber=1');
    expect(header(calls[1]!.init, 'authorization')).toBe('Bearer ACCESS');
    expect(calls[2]!.url).toContain('pagenumber=2');
    expect(calls[2]!.at - calls[1]!.at).toBeGreaterThanOrEqual(600);
  });
});

describe('CJ Product Feed GraphQL API', () => {
  it('builds the shoppingProducts query and refuses non-alphanumeric ids (no query injection)', () => {
    const q = cjQuery('123', '456', '789', 1000);
    expect(q).toContain('shoppingProducts(companyId: "123", partnerIds: ["456"], partnerStatus: JOINED, offset: 1000, limit: 1000)');
    expect(q).toContain('linkCode(pid: "789") { clickUrl }');
    expect(() => cjQuery('1") { x }', '4', '7', 0)).toThrow(/alfanuméricos/);
  });
  it('paginates by offset until totalCount, maps fields and merges variants', async () => {
    const { deps, calls } = mockHttp((_url, init) => new Response(String(init?.body).includes('offset: 0,') ? fx('cj-page-1.json') : fx('cj-page-2.json')));
    const src = cjSource({ CJ_PERSONAL_ACCESS_TOKEN: 'PAT', CJ_COMPANY_ID: '111', CJ_WEBSITE_ID: '222', CJ_ADVERTISERS: 'tous=333' }, deps);
    const [job] = await src.jobs();
    const { products } = await job!.fetch();
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toBe('https://ads.api.cj.com/query');
    expect(header(calls[0]!.init, 'authorization')).toBe('Bearer PAT');
    expect(String(calls[1]!.init?.body)).toContain('offset: 2,');
    expect(calls[1]!.at - calls[0]!.at).toBeGreaterThanOrEqual(600);
    expect(products).toHaveLength(2);
    expect(products[0]).toMatchObject({ externalId: 'CJ-1-38', priceCents: 5900, inStock: true, colorName: 'Dorado', material: 'Plata', category: 'Joyería > Pendientes', updatedAt: '2026-11-23T08:00:00Z' });
    expect(products[0]!.affiliateUrl).toMatch(/anrdoezrs/);
    expect(products[1]).toMatchObject({ externalId: 'CJ-2:verde', priceCents: 9000, originalPriceCents: 12000, inStock: true });
    expect(products[1]!.sizes).toEqual([{ label: 'S', available: false }, { label: 'M', available: true }]);
  });
  it('surfaces GraphQL errors', async () => {
    const { deps } = mockHttp(() => json({ errors: [{ message: 'Not authorized' }] }));
    const [job] = await cjSource({ CJ_PERSONAL_ACCESS_TOKEN: 'P', CJ_COMPANY_ID: '1', CJ_WEBSITE_ID: '2', CJ_ADVERTISERS: 'tous=3' }, deps).jobs();
    await expect(job!.fetch()).rejects.toThrow(/CJ GraphQL: Not authorized/);
  });
});

describe('honest source status', () => {
  const baseEnv = { DATABASE_URL: 'postgres://x', JWT_SECRET: 'x'.repeat(40), IMAGE_URL_SECRET: 'y'.repeat(40) };
  it('every adapter is disabled (pending_credentials) without credentials and makes no calls', async () => {
    const { deps, calls } = mockHttp(() => json({}));
    const sources = createCatalogSources(loadConfig(baseEnv), awinProgrammeIds(), deps);
    expect(sources.map((s) => s.id)).toEqual(['awin_feed', 'awin_enhanced', 'rakuten', 'tradedoubler', 'cj']);
    for (const s of sources) {
      expect(s.missing().length).toBeGreaterThan(0);
      expect(await s.jobs()).toEqual([]);
      expect(s.docs.every((d) => d.startsWith('https://'))).toBe(true);
    }
    expect(calls).toHaveLength(0);
    expect(providerStatusFor(sources, 'awin', 'decathlon', '105405').status).toBe('pending_credentials');
    expect(providerStatusFor(sources, 'tradetracker', 'desigual', null).status).toBe('unsupported');
  });
  it('credentials without the store id stay pending; with it the store is configured', () => {
    const cfg = loadConfig({ ...baseEnv, RAKUTEN_CLIENT_ID: 'a', RAKUTEN_CLIENT_SECRET: 'b', RAKUTEN_ACCOUNT_ID: 'c', RAKUTEN_ADVERTISERS: 'mango=1', AWIN_PUBLISHER_ID: '1', AWIN_PRODUCTDATA_API_KEY: 'k' });
    const sources = createCatalogSources(cfg, awinProgrammeIds());
    expect(providerStatusFor(sources, 'rakuten', 'mango', null).status).toBe('configured');
    expect(providerStatusFor(sources, 'rakuten', 'asos', null)).toMatchObject({ status: 'pending_credentials', detail: expect.stringMatching(/RAKUTEN_ADVERTISERS/) });
    // Awin discovery: registry programme ids (verified) are enough to map the store.
    expect(providerStatusFor(sources, 'awin', 'decathlon', '105405').status).toBe('configured');
    expect(providerStatusFor(sources, 'awin', 'nike', null).status).toBe('pending_credentials');
  });
  it('registry Awin programme ids are the verified ones', () => {
    const ids = awinProgrammeIds();
    expect(Object.fromEntries(ids)).toMatchObject({ decathlon: '105405', adidas: '77008', zalando_prive: '15573', lefties: '25103', bimbaylola: '129495', jdsports: '10121', footlocker: '23409', sprinter: '27904' });
  });
  it('parses tienda=ID mappings', () => {
    expect([...parseMapping(' mango=123 , asos = 9 ,bad, =x,url=https://a.test/?x=1')]).toEqual([['mango', '123'], ['asos', '9'], ['url', 'https://a.test/?x=1']]);
  });
});

describe('affiliate commission never reaches ranking', () => {
  it('the FeedProduct model carries no commission field and productScore takes no commission input', () => {
    const keys: Array<keyof FeedProduct> = ['retailerHint', 'externalId', 'title', 'brand', 'description', 'category', 'colorName', 'material', 'productUrl', 'affiliateUrl', 'imageUrls', 'priceCents', 'originalPriceCents', 'currency', 'inStock', 'sizes', 'gtin', 'updatedAt', 'groupId'];
    expect(keys.some((k) => /commission|comision|cpa|epc/i.test(k))).toBe(false);
    expect(productScore.toString()).not.toMatch(/commission|comisi[oó]n/i);
  });
});
