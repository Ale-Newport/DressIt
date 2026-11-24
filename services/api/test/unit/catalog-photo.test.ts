/**
 * Catalogue photo: provider adapters (request contracts from each provider's public docs, checked
 * 2026-11-24; responses are trimmed examples of the documented shapes, not real results), the packshot
 * prompt and the matching rules.
 */
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { FalPackshot, FashnPackshot, GenerationError } from '../../src/modules/catalog-photo/generate.ts';
import { canonicalPage, judgeMatch, labelWords, mergeCandidates, recognise, textOnLabelMatches } from '../../src/modules/catalog-photo/matching.ts';
import { buildPackshotPrompt, describeGarment } from '../../src/modules/catalog-photo/prompt.ts';
import { CloudVisionWeb, jpegUnder, LykdatSearch, parseCloudVisionWeb, parseLykdat, parseSerpApiLens, SearchError, SerpApiLens, type WebCandidate } from '../../src/modules/catalog-photo/search.ts';
import { insufficientPhoto } from '../../src/modules/catalog-photo/service.ts';

type Call = { url: string; init: RequestInit };
function fakeFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const f = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return { f, calls };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
/** A noisy (hard to compress) photo, bigger than SerpApi's 500 KB upload limit as a JPEG. */
const photo = () => sharp({ create: { width: 1200, height: 1500, channels: 3, background: '#808080', noise: { type: 'gaussian', mean: 128, sigma: 60 } } }).jpeg({ quality: 100 }).toBuffer();

describe('Google Lens via SerpApi', () => {
  it('uploads the photo (≤ 500 KB) and searches by image_id in Spain, in Spanish', async () => {
    const { f, calls } = fakeFetch((url) =>
      url.startsWith('https://serpapi.com/image')
        ? json({ message: 'Image uploaded successfully.', image_id: 'img123' })
        : json({
            search_metadata: { status: 'Success' },
            visual_matches: [
              { position: 1, title: 'Camisa de lino - ZARA España', link: 'https://www.zara.com/es/es/camisa-lino-p01234567.html', source: 'ZARA', price: { value: '29,95 €', extracted_value: 29.95, currency: '€' }, thumbnail: 'https://encrypted-tbn0.gstatic.com/x', image: 'https://static.zara.net/photos/x.jpg', exact_matches: true },
            ],
          }),
    );
    const lens = new SerpApiLens({ apiKey: 'k', country: 'es', hl: 'es', costCents: 2.5, fetcher: f });
    const out = await lens.search(await photo(), { query: 'crop', text: 'Zara' });
    expect(calls[0]!.url).toBe('https://serpapi.com/image');
    const fd = calls[0]!.init.body as FormData;
    expect(fd.get('api_key')).toBe('k');
    expect((fd.get('image') as Blob).size).toBeLessThanOrEqual(500_000);
    const q = new URL(calls[1]!.url).searchParams;
    expect(Object.fromEntries(q)).toMatchObject({ engine: 'google_lens', image_id: 'img123', type: 'all', hl: 'es', country: 'es', q: 'Zara' });
    expect(out.candidates[0]).toMatchObject({ provider: 'serpapi_lens', query: 'crop', title: 'Camisa de lino - ZARA España', imageUrl: 'https://static.zara.net/photos/x.jpg', price: { cents: 2995, currency: 'EUR' }, exactImage: true });
  });
  it('parses exact matches (no image field, price as text) and reports errors honestly', async () => {
    const out = parseSerpApiLens({ exact_matches: [{ position: 1, title: 'Polo', link: 'https://shop.example/p', source: 'Shop', thumbnail: 'https://t', extracted_price: 19.9 }] }, 'full');
    expect(out.candidates[0]).toMatchObject({ exactImage: true, imageUrl: null, thumbnailUrl: 'https://t', price: { cents: 1990 } });
    const { f } = fakeFetch(() => json({ error: 'Invalid API key.' }, 401));
    await expect(new SerpApiLens({ apiKey: 'bad', country: 'es', hl: 'es', costCents: 1, fetcher: f }).search(await photo(), { query: 'crop' })).rejects.toMatchObject({ message: expect.stringMatching(/401: Invalid API key/), retryable: false });
    await expect(new SerpApiLens({ country: 'es', hl: 'es', costCents: 1 }).search(Buffer.alloc(1), { query: 'crop' })).rejects.toBeInstanceOf(SearchError);
  });
  it('shrinks big photos under the upload limit', async () => {
    expect((await jpegUnder(await photo(), 120_000)).length).toBeLessThanOrEqual(120_000);
  });
});

describe('Google Cloud Vision Web Detection', () => {
  it('sends the photo as base64 with the key in a header (not in the URL)', async () => {
    const { f, calls } = fakeFetch(() =>
      json({
        responses: [
          {
            webDetection: {
              webEntities: [{ entityId: '/m/x', score: 0.9, description: 'Massimo Dutti' }],
              pagesWithMatchingImages: [{ url: 'https://www.massimodutti.com/es/jersey-l0123', pageTitle: '<b>Jersey</b> de lana &amp; cachemira', fullMatchingImages: [{ url: 'https://static.massimodutti.net/x.jpg' }] }],
              visuallySimilarImages: [{ url: 'https://img.example/similar.jpg' }],
              bestGuessLabels: [{ label: 'jersey massimo dutti', languageCode: 'es' }],
            },
          },
        ],
      }),
    );
    const out = await new CloudVisionWeb({ apiKey: 'gk', costCents: 0.35, fetcher: f }).search(await photo(), { query: 'full' });
    expect(calls[0]!.url).toBe('https://vision.googleapis.com/v1/images:annotate');
    expect((calls[0]!.init.headers as Record<string, string>)['x-goog-api-key']).toBe('gk');
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.requests[0].features[0]).toMatchObject({ type: 'WEB_DETECTION', maxResults: 30 });
    expect(body.requests[0].image.content.length).toBeGreaterThan(100);
    expect(out.candidates[0]).toMatchObject({ title: 'Jersey de lana & cachemira', source: 'massimodutti.com', exactImage: true, imageUrl: 'https://static.massimodutti.net/x.jpg' });
    expect(out.candidates[1]).toMatchObject({ pageUrl: null, imageUrl: 'https://img.example/similar.jpg', exactImage: false });
    expect(out.hints).toEqual(['jersey massimo dutti', 'Massimo Dutti']);
  });
  it('surfaces a per-image error', () => {
    expect(() => parseCloudVisionWeb({ responses: [{ error: { message: 'Bad image data.' } }] }, 'crop')).toThrow(/Bad image data/);
  });
});

describe('Lykdat Global Search', () => {
  it('posts the photo as a form with api_key and reads the similar products', async () => {
    const { f, calls } = fakeFetch(() =>
      json({ data: { result_groups: [{ similar_products: [{ id: 'p1', name: 'Slim jeans', brand_name: 'Mango', vendor: 'mango-us', url: 'https://shop.mango.com/x', images: ['https://img/1.jpg'], matching_image: 'https://img/m.jpg', price: '39.99', reduced_price: '29.99', currency: 'USD', score: 0.97 }] }] } }),
    );
    const out = await new LykdatSearch({ apiKey: 'lk', costCents: 1.67, fetcher: f }).search(await photo(), { query: 'crop' });
    expect(calls[0]!.url).toBe('https://cloudapi.lykdat.com/v1/global/search');
    expect((calls[0]!.init.body as FormData).get('api_key')).toBe('lk');
    expect(out.candidates[0]).toMatchObject({ brand: 'Mango', imageUrl: 'https://img/m.jpg', price: { cents: 2999, currency: 'USD' } });
    expect(parseLykdat({}, 'crop').candidates).toEqual([]);
  });
});

describe('packshot generators', () => {
  const prompt = buildPackshotPrompt({ category: 'top', subcategory: 'camiseta', colors: [{ family: 'blanco', share: 1 }], pattern: null, materials: [], text: null, brand: null });
  const input = async () => ({ photo: await sharp({ create: { width: 40, height: 50, channels: 3, background: '#fff' } }).jpeg().toBuffer(), mime: 'image/jpeg', prompt, seed: 7, width: 896, height: 1120 });

  it('FASHN Agent Images: 4:5 packshot from a data URI, cost from the credits used', async () => {
    const png = await sharp({ create: { width: 8, height: 10, channels: 3, background: '#fff' } }).png().toBuffer();
    const { f, calls } = fakeFetch((url) =>
      url === 'https://api.fashn.ai/v1/agent/images'
        ? json({ id: 'r1', status: 'completed', error: null, predictions: [{ id: 'a', tool: 'generate-image', status: 'completed', results: ['https://cdn.fashn.ai/out.png'], credits_used: 1 }], credits_used: 1 })
        : new Response(png),
    );
    const out = await new FashnPackshot({ apiKey: 'fk', mode: 'balanced', resolution: '1k', centsPerCredit: 7.5, timeoutMs: 60_000, fetcher: f }).generate(await input());
    const req = JSON.parse(String(calls[0]!.init.body));
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer fk');
    expect(req).toMatchObject({ aspect_ratio: '4:5', resolution: '1k', generation_mode: 'balanced', return_base64: false });
    expect(req.images[0]).toMatch(/^data:image\/jpeg;base64,/);
    expect(req.prompt).toMatch(/Generate exactly one image\.$/);
    expect(Object.keys(req).sort()).toEqual(['aspect_ratio', 'generation_mode', 'images', 'prompt', 'resolution', 'return_base64']);
    expect(out).toMatchObject({ costCents: 7.5, model: 'FASHN Agent Images (Packshot)' });
    expect(out.image.equals(png)).toBe(true);
  });
  it('FASHN: a failed run is reported (and NoImageGenerated is not retried)', async () => {
    const { f } = fakeFetch(() => json({ id: 'r', status: 'failed', error: { name: 'NoImageGenerated', message: 'no image' }, predictions: [] }));
    await expect(new FashnPackshot({ apiKey: 'k', mode: 'fast', resolution: '1k', centsPerCredit: 7.5, timeoutMs: 1000, fetcher: f }).generate(await input())).rejects.toMatchObject({ retryable: false });
  });
  it('fal.ai queue: submit, poll the status URL, read the result URL', async () => {
    const png = await sharp({ create: { width: 8, height: 10, channels: 3, background: '#fff' } }).png().toBuffer();
    let polls = 0;
    const { f, calls } = fakeFetch((url) => {
      if (url === 'https://queue.fal.run/fal-ai/qwen-image-edit-2511') return json({ request_id: 'q1', status_url: 'https://queue.fal.run/fal-ai/qwen-image-edit-2511/requests/q1/status', response_url: 'https://queue.fal.run/fal-ai/qwen-image-edit-2511/requests/q1', cancel_url: 'https://queue.fal.run/x/cancel' });
      if (url.endsWith('/status')) return json(++polls < 2 ? { status: 'IN_PROGRESS' } : { status: 'COMPLETED' });
      if (url.endsWith('/requests/q1')) return json({ images: [{ url: 'https://v3b.fal.media/files/out.png', width: 896, height: 1120 }], has_nsfw_concepts: [false], seed: 7 });
      return new Response(png);
    });
    const out = await new FalPackshot({ apiKey: 'fal', endpoint: 'fal-ai/qwen-image-edit-2511', costCents: 3.5, timeoutMs: 60_000, fetcher: f, pollMs: 1 }).generate(await input());
    const req = JSON.parse(String(calls[0]!.init.body));
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Key fal');
    expect(req).toMatchObject({ image_size: { width: 896, height: 1120 }, num_images: 1, seed: 7, output_format: 'png', enable_safety_checker: true });
    expect(req.image_urls[0]).toMatch(/^data:image\/jpeg;base64,/);
    expect(out.costCents).toBe(3.5);
    expect(polls).toBe(2);
  });
  it('without credentials they refuse instead of pretending', async () => {
    await expect(new FalPackshot({ endpoint: 'x', costCents: 1, timeoutMs: 1 }).generate(await input())).rejects.toBeInstanceOf(GenerationError);
    expect(new FashnPackshot({ mode: 'fast', resolution: '1k', centsPerCredit: 7.5, timeoutMs: 1 }).configured).toBe(false);
  });
});

describe('packshot prompt', () => {
  const g = (subcategory: string, extra = {}) => ({ category: 'top', subcategory, colors: [{ family: 'azul_marino', share: 0.8 }, { family: 'blanco', share: 0.2 }], pattern: null, materials: ['algodon'], text: null, brand: null, ...extra });
  it('starts from the owner’s base prompt and specialises it per category', () => {
    const p = buildPackshotPrompt(g('camiseta'));
    expect(p.prompt).toMatch(/^Transform the uploaded reference photograph into a premium professional e-commerce product photograph of the EXACT SAME garment: navy blue and white cotton t-shirt\./);
    for (const clause of ['flat-lay', 'straighten and symmetrically position sleeves', 'CRITICAL PRODUCT FIDELITY', 'NOT a simple background removal', 'NOT a photo of a person wearing the garment', 'Do not invent parts that are not visible', 'Show ONLY this one garment']) expect(p.prompt).toContain(clause);
    expect(buildPackshotPrompt(g('polo'), ['extra_garment']).prompt).toMatch(/previous attempt added other clothes/);
    expect(buildPackshotPrompt({ ...g('vaquero'), category: 'bottom' }).prompt).toMatch(/waistband horizontal at the top.*both legs fully extended straight down/);
    expect(buildPackshotPrompt({ ...g('abrigo'), category: 'outerwear' }).prompt).toMatch(/ghost-mannequin.*lapels correctly placed and symmetric/);
    expect(buildPackshotPrompt({ ...g('vestido'), category: 'one_piece' }).prompt).toMatch(/natural drape and fall/);
    expect(buildPackshotPrompt({ ...g('jersey') }).prompt).toMatch(/keep the exact knit stitch/);
    expect(buildPackshotPrompt({ ...g('camisa') }).prompt).toMatch(/collar correctly folded/);
    expect(buildPackshotPrompt({ ...g('zapatillas'), category: 'footwear' }).prompt).toMatch(/footwear product photo/);
    expect(buildPackshotPrompt({ ...g('bolso'), category: 'accessory' }).prompt).toMatch(/handbag product photo/);
  });
  it('keeps the text/logo read on the garment and adds corrections on retries', () => {
    const p = buildPackshotPrompt(g('sudadera', { text: 'VACCINATED', pattern: 'grafico' }), ['asymmetric', 'text', 'color']);
    expect(p.prompt).toContain('The garment shows the text/logo "VACCINATED"');
    expect(p.prompt).toMatch(/previous attempt was not arranged properly/);
    expect(p.prompt).toMatch(/keep the printed text and logos exactly as in the reference \(VACCINATED\)/);
    expect(p.prompt).toMatch(/changed the colours.*\(navy blue and white cotton sweatshirt, with a printed graphic\)/);
    expect(describeGarment({ ...g('polo'), brand: 'Lacoste' })).toBe('Lacoste navy blue and white cotton polo shirt');
  });
});

describe('matching: identifying the product, not a lookalike', () => {
  const cand = (over: Partial<WebCandidate>): WebCandidate => ({ provider: 'serpapi_lens', query: 'crop', rank: 1, title: null, pageUrl: null, imageUrl: 'https://img/x.jpg', thumbnailUrl: null, source: null, brand: null, price: null, exactImage: false, ...over });
  it('reads brand and reference codes on labels', () => {
    expect(recognise([{ text: 'MASSIMO DUTTI', confidence: 0.9 }, { text: 'REF 5432/301/800', confidence: 0.8 }, { text: '??', confidence: 0.1 }])).toEqual({ brand: 'Massimo Dutti', text: 'MASSIMO DUTTI REF 5432/301/800', references: ['5432/301/800'] });
    expect(recognise([{ text: 'Pull&Bear', confidence: 0.7 }]).brand).toBe('Pull&Bear');
    expect(labelWords('Made in Portugal 100% cotton OBEY Propaganda')).toEqual(['obey', 'propaganda']);
    expect(textOnLabelMatches(['obey', 'propaganda'], 'OBEY Propaganda tee black')).toBe(true);
    expect(textOnLabelMatches(['obey', 'propaganda'], 'Generic black tee')).toBe(false);
    expect(textOnLabelMatches(['california'], 'California surf tee')).toBe(false); // one common word identifies nothing
  });
  it('merges the same product page found by several queries and providers, and prefers known Spanish stores', () => {
    const merged = mergeCandidates(
      [
        cand({ pageUrl: 'https://www.zara.com/es/es/camisa-p0123.html?v1=99&utm_source=x', query: 'crop', rank: 3 }),
        cand({ pageUrl: 'https://www.zara.com/es/es/camisa-p0123.html', query: 'full', rank: 2 }),
        cand({ provider: 'cloud_vision', pageUrl: 'https://zara.com/es/es/camisa-p0123.html' }),
        cand({ pageUrl: 'https://random-blog.example/post', rank: 1 }),
      ],
      { brand: 'Zara', text: 'ZARA', references: [] },
    );
    expect(merged[0]).toMatchObject({ retailerId: 'zara', providers: ['serpapi_lens', 'cloud_vision'], brandMatch: true });
    expect(merged[0]!.sources).toHaveLength(3);
    expect(merged).toHaveLength(2);
    expect(canonicalPage('https://www.zara.com/es/a.html?utm_medium=x#top')).toBe('zara.com/es/a.html');
  });
  it('needs a close photo AND independent evidence for an exact match', () => {
    const limits = { exact: 0.86, possible: 0.78 };
    const ok = { similarity: 0.93, sameCategory: true, colorOk: true, textMatch: null, studioLike: true };
    const base = { provider: 'serpapi_lens' as const, exactImage: false, brandMatch: false, referenceMatch: false, providers: ['serpapi_lens'] };
    expect(judgeMatch(base, ok, limits)).toMatchObject({ verdict: 'possible', doubts: [expect.stringMatching(/Solo hay parecido visual/)] });
    expect(judgeMatch({ ...base, brandMatch: true }, ok, limits)).toMatchObject({ verdict: 'exact', evidence: [expect.stringMatching(/marca/)] });
    expect(judgeMatch({ ...base, providers: ['serpapi_lens', 'cloud_vision'] }, ok, limits).verdict).toBe('exact');
    expect(judgeMatch({ ...base, referenceMatch: true }, { ...ok, colorOk: false }, limits)).toMatchObject({ verdict: 'possible', doubts: [expect.stringMatching(/otra variante/)] });
    expect(judgeMatch({ ...base, brandMatch: true }, { ...ok, similarity: 0.8 }, limits).verdict).toBe('possible');
    expect(judgeMatch({ ...base, brandMatch: true }, { ...ok, similarity: 0.6 }, limits).verdict).toBe('rejected');
    expect(judgeMatch({ ...base, brandMatch: true }, { ...ok, sameCategory: false }, limits).verdict).toBe('rejected');
  });
});

describe('enough information to rebuild the garment', () => {
  it('asks for another photo when the garment is cut by the frame or tiny', () => {
    expect(insufficientPhoto([0, 0.1, 1, 0.9], 'top', { width: 800, height: 900 })).toMatch(/cortada por los bordes/);
    expect(insufficientPhoto([0.2, 0, 0.8, 1], 'bottom', { width: 800, height: 900 })).toMatch(/cortada/);
    expect(insufficientPhoto([0.06, 0.03, 1, 0.9], 'top', { width: 800, height: 900 })).toBeNull(); // one side only
    expect(insufficientPhoto([0, 0, 1, 1], 'footwear', { width: 800, height: 900 })).toBeNull();
    expect(insufficientPhoto(null, 'top', { width: 120, height: 150 })).toMatch(/muy pequeña/);
  });
});
