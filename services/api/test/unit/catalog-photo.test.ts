/**
 * Catalogue photo: provider adapters (request contracts from each provider's public docs, checked
 * 2026-11-24; responses are trimmed examples of the documented shapes, not real results), the packshot
 * prompt and the matching rules.
 */
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { FalPackshot, FashnPackshot, GenerationError, MlxPackshot } from '../../src/modules/catalog-photo/generate.ts';
import { canonicalPage, judgeMatch, labelWords, mergeCandidates, recognise, textOnLabelMatches } from '../../src/modules/catalog-photo/matching.ts';
import { buildPackshotPrompt, buildStudioPrompt, describeGarment, englishLabel, kindFromName, sameKindOfItem, subcategoryFromName } from '../../src/modules/catalog-photo/prompt.ts';
import { CloudVisionWeb, jpegUnder, LykdatSearch, parseCloudVisionWeb, parseLykdat, parseSerpApiLens, SearchError, SerpApiLens, type WebCandidate } from '../../src/modules/catalog-photo/search.ts';
import { checkTarget, insufficientPhoto, studioInput, unclearDetection } from '../../src/modules/catalog-photo/service.ts';
import { predictedWithVlm } from '../../src/modules/imports/photo-pipeline.ts';
import { acceptedName } from '../../src/modules/imports/service.ts';

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
  it('MLX (local, no ComfyUI): posts the photo and prompt, returns the PNG at no cost', async () => {
    const png = await sharp({ create: { width: 8, height: 10, channels: 3, background: '#ddd' } }).png().toBuffer();
    const { f, calls } = fakeFetch((url) => (url.endsWith('/health') ? json({ ok: true }) : new Response(png, { headers: { 'content-type': 'image/png' } })));
    const gen = new MlxPackshot({ url: 'http://127.0.0.1:8189', timeoutMs: 60_000, fetcher: f });
    expect(await gen.available()).toBe(true);
    const out = await gen.generate(await input());
    const req = JSON.parse(String(calls[1]!.init.body));
    expect(calls[1]!.url).toBe('http://127.0.0.1:8189/v1/edit');
    expect(req).toMatchObject({ seed: 7, width: 896, height: 1120, steps: 4 });
    expect(Buffer.from(req.image, 'base64').subarray(0, 2).toString('hex')).toBe('ffd8');
    expect(out).toMatchObject({ costCents: 0, model: 'FLUX.2 klein 4B (MLX)' });
    expect(out.image.equals(png)).toBe(true);
    const { f: down } = fakeFetch(() => new Response('{"error":"OutOfMemory"}', { status: 500 }));
    await expect(new MlxPackshot({ url: 'http://x', timeoutMs: 1000, fetcher: down }).generate(await input())).rejects.toMatchObject({ retryable: true });
    expect(new MlxPackshot({ timeoutMs: 1 }).configured).toBe(false);
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
    for (const clause of ['flat-lay', 'straighten and symmetrically position the sleeves', 'CRITICAL PRODUCT FIDELITY', 'NOT a simple background removal', 'NOT a photo of a person wearing the garment', 'Do not invent parts that are not visible', 'Show ONLY this t-shirt']) expect(p.prompt).toContain(clause);
    // A top's prompt never names other garments: a small text encoder draws whatever is named.
    expect(p.prompt).not.toMatch(/trouser|skirt|shoes/);
    expect(buildPackshotPrompt({ ...g('vaquero'), category: 'bottom' }).prompt).not.toMatch(/position the sleeves/);
    expect(buildPackshotPrompt(g('polo'), ['extra_garment']).prompt).toMatch(/previous attempt added other clothes/);
    expect(buildPackshotPrompt({ ...g('vaquero'), category: 'bottom' }).prompt).toMatch(/waistband horizontal at the top.*both legs fully extended straight down/);
    expect(buildPackshotPrompt({ ...g('abrigo'), category: 'outerwear' }).prompt).toMatch(/hollow "ghost".*lapels correctly placed and symmetric/);
    // Named things get drawn: a jacket's prompt never says "mannequin" (FLUX.2 klein drew one).
    expect(buildPackshotPrompt({ ...g('abrigo'), category: 'outerwear' }).prompt).not.toMatch(/mannequin/i);
    expect(buildPackshotPrompt({ ...g('vestido'), category: 'one_piece' }).prompt).toMatch(/natural drape and fall/);
    expect(buildPackshotPrompt({ ...g('jersey') }).prompt).toMatch(/keep the exact knit stitch/);
    expect(buildPackshotPrompt({ ...g('camisa') }).prompt).toMatch(/collar correctly folded/);
    expect(buildPackshotPrompt({ ...g('zapatillas'), category: 'footwear' }).prompt).toMatch(/footwear product photo/);
    expect(buildPackshotPrompt({ ...g('bolso'), category: 'accessory' }).prompt).toMatch(/bag product photo/);
  });
  it('keeps the text/logo read on the garment and adds corrections on retries', () => {
    const p = buildPackshotPrompt(g('sudadera', { text: 'VACCINATED', pattern: 'grafico' }), ['asymmetric', 'text', 'color']);
    expect(p.prompt).toContain('The garment shows the text/logo "VACCINATED"');
    expect(p.prompt).toMatch(/previous attempt was not arranged properly/);
    expect(p.prompt).toMatch(/keep the printed text and logos exactly as in the reference \(VACCINATED\)/);
    expect(p.prompt).toMatch(/changed the colours.*\(navy blue and white cotton sweatshirt, with a printed graphic\)/);
    expect(describeGarment({ ...g('polo'), brand: 'Lacoste' })).toBe('Lacoste navy blue and white cotton polo shirt');
    // Lit and shaded sides of one fabric, and specular highlights, are not colours of the garment.
    const measured = (colors: Array<[string, number]>, pattern: string | null = null) => describeGarment({ ...g('plumifero'), category: 'outerwear', materials: [], pattern, colors: colors.map(([family, share]) => ({ family, share })) });
    expect(measured([['azul', 0.58], ['celeste', 0.21], ['blanco', 0.21]])).toBe('blue puffer jacket');
    expect(measured([['antracita', 0.66], ['gris', 0.34]])).toBe('near-black charcoal puffer jacket');
    expect(measured([['azul', 0.58], ['blanco', 0.3]])).toBe('blue and white puffer jacket');
    expect(measured([['rojo', 0.6], ['blanco', 0.2]], 'rayas')).toBe('red and white puffer jacket, striped');
  });
});

describe('studio prompt (studio photo first, cutout afterwards)', () => {
  const g = (subcategory: string, extra = {}) => ({ category: 'top', subcategory, colors: [{ family: 'rojo', share: 0.9 }], pattern: null, materials: ['algodon'], text: null, brand: null, ...extra });
  it('names the garment, asks for a plain light grey studio background and keeps the garment as it is', () => {
    const p = buildStudioPrompt(g('sudadera'));
    expect(p.prompt).toMatch(/^Professional e-commerce studio product photo of the exact red cotton sweatshirt from the reference photo\./);
    expect(p.prompt).toContain('plain, seamless, evenly lit very light grey (almost white) studio background, no cast shadow');
    expect(p.prompt).toMatch(/Keep exactly the same colours/);
    expect(p.prompt).not.toMatch(/white background|mannequin|trouser/i);
    expect(p.prompt).not.toMatch(/centre of the reference/);
  });
  it('with several garments in the photo, picks the one in the centre and ignores the rest', () => {
    expect(buildStudioPrompt(g('camiseta'), { multi: true }).prompt).toMatch(/Use only the t-shirt in the centre of the reference photo; ignore every other item/);
  });
  it('retries add corrections, rewritten for the grey background', () => {
    const p = buildStudioPrompt(g('camiseta'), { corrections: ['background', 'extra_garment', 'cropped'] });
    expect(p.prompt).toMatch(/plain light grey studio background only/);
    expect(p.prompt).toMatch(/alone on the light grey background/);
    expect(p.prompt).not.toMatch(/white (background|margin)/);
  });
  it('uses the vision-language model’s name over the classifier’s label and colours', () => {
    // The classifier measured a flash-lit black polo as charcoal/grey, and klein drew it grey.
    const polo = { ...g('polo'), colors: [{ family: 'antracita', share: 0.53 }, { family: 'gris', share: 0.47 }] };
    expect(buildStudioPrompt(polo).prompt).toMatch(/near-black charcoal cotton polo shirt/);
    const p = buildStudioPrompt(polo, { name: { name: 'Black Polo Shirt', category: 'top' } });
    expect(p.prompt).toMatch(/^Professional e-commerce studio product photo of the exact black polo shirt from the reference photo\./);
    expect(p.prompt).not.toMatch(/charcoal/);
    expect(p.prompt).toMatch(/collar correctly folded/);
    // A backpack the classifier took for a scarf is presented as a bag.
    expect(buildStudioPrompt({ ...g('bufanda'), category: 'accessory' }, { multi: true, name: { name: 'Dark Green Backpack', category: 'accessory' } }).prompt).toMatch(/Use only the dark green backpack in the centre.*Professional bag product photo/s);
  });
  it('picks the presentation from the name', () => {
    expect(kindFromName('denim mid-rise shorts', 'bottom', 'trousers')).toBe('shorts');
    expect(kindFromName('plaid tartan mini skirt', 'bottom', 'accessory')).toBe('skirt');
    expect(kindFromName('mistletoe graphic t-shirt', 'top', 'shirt')).toBe('top');
    expect(kindFromName('black polo shirt', 'top', 'top')).toBe('shirt');
    expect(kindFromName('navy blue puffer jacket', 'outerwear', 'top')).toBe('jacket');
    expect(kindFromName('chunky knit cardigan', 'outerwear', 'top')).toBe('knit');
    expect(kindFromName('blue shirt dress', 'one_piece', 'shirt')).toBe('dress');
    expect(kindFromName('tan felt cowboy hat', 'accessory', 'top')).toBe('accessory');
    expect(kindFromName('mystery item', 'footwear', 'top')).toBe('shoes');
    expect(kindFromName('mystery item', 'hosiery', 'top')).toBe('top');
    // Tights and socks are laid flat and empty (klein drew navy tights as a bodysuit with sleeves).
    expect(kindFromName('navy blue tights', 'bottom', 'trousers')).toBe('hosiery');
    expect(kindFromName('white knee high socks', 'accessory', 'accessory')).toBe('hosiery');
    expect(buildStudioPrompt(g('leggings'), { name: { name: 'Navy Blue Tights', category: 'bottom' } }).prompt).toMatch(/Hosiery flat lay.*no body, top or sleeves/);
    // Hyphens join words, and a dress shirt is a shirt (review findings, 2026-11-25).
    expect(kindFromName('white dress shirt', 'top', 'top')).toBe('shirt');
    expect(kindFromName('tie-dye t-shirt', 'top', 'top')).toBe('top');
    expect(kindFromName('tie-front blouse', 'top', 'top')).toBe('shirt');
    expect(kindFromName('cap-sleeve top', 'top', 'top')).toBe('top');
    expect(kindFromName('boot-cut jeans', 'bottom', 'trousers')).toBe('trousers');
    expect(kindFromName('knitted brown button up cardigan', 'outerwear', 'top')).toBe('knit');
  });
  it('the check expects the type only when the namer and the classifier agree on it', () => {
    const cfg = { cfg: { CATALOG_STUDIO_PROMPT: 'studio' } } as Parameters<typeof checkTarget>[0];
    const m = { desc: { ...g('cardigan'), category: 'top' } } as Parameters<typeof checkTarget>[1];
    expect(checkTarget(cfg, m, { name: 'Brown Cardigan', colour: 'brown', category: 'top', whole: true })).toEqual({ kind: 'studio', category: 'top', subcategory: 'cardigan' });
    expect(checkTarget(cfg, m, { name: 'Brown Cardigan', colour: 'brown', category: 'outerwear', whole: true })).toEqual({ kind: 'studio', category: null, subcategory: null });
    expect(checkTarget(cfg, m, null)).toEqual({ kind: 'studio', category: 'top', subcategory: 'cardigan' });
    expect(checkTarget({ cfg: { CATALOG_STUDIO_PROMPT: 'packshot' } } as Parameters<typeof checkTarget>[0], m, null).kind).toBe('generated');
  });
  it('only something that is not clothing is refused; a garment seen in part is completed', () => {
    expect(unclearDetection({ name: 'Tan Cargo Shorts', colour: 'tan', category: 'bottom', whole: true })).toBeNull();
    expect(unclearDetection({ name: 'Red Hoodie', colour: 'red', category: 'top', whole: false })).toBeNull();
    expect(unclearDetection({ name: 'Wooden Chair', colour: 'brown', category: 'not_clothing', whole: true })).toMatch(/no parece una prenda/);
  });
  it('a partly visible garment is rebuilt whole from the description of the complete item', () => {
    const name = { name: 'Red Hooded Sweatshirt', category: 'top' };
    const description = 'red cotton pullover hoodie with a dark grey lined hood, drawstrings, kangaroo pocket and ribbed cuffs.';
    const p = buildStudioPrompt(g('sudadera'), { name, description, partial: true }).prompt;
    expect(p).toMatch(/^Professional e-commerce studio product photo of the exact red hooded sweatshirt from the reference photo: red cotton pullover hoodie with a dark grey lined hood, drawstrings, kangaroo pocket and ribbed cuffs\./);
    expect(p).toMatch(/show the COMPLETE item, every hidden part as described above/);
    expect(buildStudioPrompt(g('sudadera'), { name, description }).prompt).toMatch(/Hidden parts plain and consistent/);
    // Without a name the description is not used (the classifier's label and colours are).
    expect(buildStudioPrompt(g('sudadera'), { description }).prompt).not.toMatch(/kangaroo/);
  });
  it('a shoe described without laces is said to have none; one with laces is not', () => {
    const shoe = { ...g('tacones'), category: 'footwear' };
    const pumps = buildStudioPrompt(shoe, { name: { name: 'White Pointed Pumps', category: 'footwear' }, description: 'white leather slip-on pumps with a mid heel' }).prompt;
    expect(pumps).toContain('No laces and no eyelets.');
    // The kind instruction itself no longer asks for "laces tidy" (klein then put laces on pumps and loafers).
    expect(pumps).not.toMatch(/laces tidy/);
    const sneakers = buildStudioPrompt({ ...shoe, subcategory: 'zapatillas' }, { name: { name: 'Red High-Top Sneakers', category: 'footwear' }, description: 'red suede high-tops with white laces' }).prompt;
    expect(sneakers).not.toMatch(/No laces/);
    expect(buildStudioPrompt(g('camiseta')).prompt).not.toMatch(/No laces|  /);
    // Worn shoes came out with the legs and tights inside, and a pair with one buckle.
    expect(pumps).toContain('the two shoes identical mirror images with the same details. Empty shoes with nothing inside them: no feet, legs, socks or tights.');
  });
  it('a chain bag gets no top handle; gloves are wrist-length unless named long', () => {
    const bag = { ...g('bolso'), category: 'accessory' };
    const name = { name: 'Quilted White Leather Shoulder Bag', category: 'accessory' };
    const chain = buildStudioPrompt(bag, { name, topHandle: false }).prompt;
    expect(chain).toContain('any chain or shoulder strap it has laid in a loose curve in front of and around the bag, not raised above it; there is no handle on top of the bag,');
    expect(chain).not.toMatch(/\{HANDLES\}|arranged neatly above/);
    // A bag with a handle, or one the detection said nothing about, keeps its handles above it.
    expect(buildStudioPrompt(bag, { name: { name: 'Black Leather Tote', category: 'accessory' }, topHandle: true }).prompt).toContain('handles or strap arranged neatly above the bag');
    expect(buildStudioPrompt(bag).prompt).toContain('handles or strap arranged neatly above the bag');
    // A clutch held in the hand (the detection said "top handle") came out as a big tote with handles.
    const clutchName = { name: 'Floral Clutch Bag', category: 'accessory' };
    const clutch = buildStudioPrompt(bag, { name: clutchName, topHandle: true, description: 'A small floral clutch. The bag has a short handle and is made of soft fabric.' }).prompt;
    expect(clutch).toContain('of the exact floral clutch bag from the reference photo: A small floral clutch.');
    expect(clutch).toContain('a small flat clutch with no handles, no strap and no chain,');
    expect(clutch).not.toMatch(/short handle/);
    const chained = buildStudioPrompt(bag, { name: clutchName, description: 'A gold clutch with a detachable chain strap.' }).prompt;
    expect(chained).toContain('a small flat clutch with no handles, its strap or chain laid in a loose curve in front of it,');
    const gloves = { ...g('guantes'), category: 'accessory' };
    expect(buildStudioPrompt(gloves, { name: { name: 'White Gloves', category: 'accessory' } }).prompt).toContain('Short gloves ending at the wrist, the pair side by side.');
    expect(buildStudioPrompt(gloves, { name: { name: 'Black Opera Gloves', category: 'accessory' } }).prompt).not.toMatch(/Short gloves/);
    expect(chain).not.toMatch(/Short gloves/);
  });
  it('shorts are shown on an invisible body, the hem where the detection saw it', () => {
    const shorts = { ...g('pantalon_corto'), category: 'bottom' };
    const name = { name: 'Blue Denim Shorts', category: 'bottom' };
    const p = buildStudioPrompt(shorts, { name, length: 'upper-thigh' }).prompt;
    expect(p).toMatch(/Hollow 3D front view, as if worn by an invisible body: waistband at the waist, both legs open and symmetric, the hem at the very top of the thighs, just below the crotch; empty inside, no legs/);
    expect(buildStudioPrompt(shorts, { name }).prompt).toMatch(/both legs open and symmetric; empty inside/);
    expect(buildStudioPrompt(shorts, { name, length: 'n/a' }).prompt).not.toMatch(/\{LENGTH\}|hem at/);
    expect(buildPackshotPrompt(shorts).prompt).not.toMatch(/\{LENGTH\}/);
  });
  it('what the verifier saw wrong comes right after the item, as the look it must have', () => {
    const name = { name: 'Blue Denim Shorts', category: 'bottom' };
    const p = buildStudioPrompt({ ...g('pantalon_corto'), category: 'bottom' }, { name, fixes: ['very short denim shorts ending at the top of the thigh.', ' ', 'very short denim shorts ending at the top of the thigh'] }).prompt;
    expect(p).toMatch(/^Professional e-commerce studio product photo of the exact blue denim shorts from the reference photo\. It must be exactly like this: very short denim shorts ending at the top of the thigh\. Hollow 3D/);
    expect(p.match(/It must be exactly like this/g)).toHaveLength(1);
  });
  it('the generator sees the whole photo, or the garment with 20 % context when there are several', async () => {
    const photo = await sharp({ create: { width: 1000, height: 800, channels: 3, background: '#888' } }).jpeg().toBuffer();
    expect((await sharp(await studioInput(photo, [0.1, 0.1, 0.3, 0.6], false)).metadata()).width).toBe(1000);
    const m = await sharp(await studioInput(photo, [0.2, 0.2, 0.4, 0.6], true)).metadata();
    expect([m.width, m.height]).toEqual([280, 448]); // 200×320 px box + 20 % each side
  });
});

describe('English labels for image models', () => {
  it('come from the app type and colour', () => {
    expect(englishLabel('sudadera', 'rojo')).toBe('red sweatshirt');
    expect(englishLabel('vaquero', null)).toBe('jeans');
  });
});

describe('garments seen by the vision-language model (Alta-style detection)', () => {
  it('maps a shop-style name to the app vocabulary, most specific first', () => {
    const cases: Array<[string, string | null]> = [
      ['Red Hooded Sweatshirt', 'sudadera'],
      ['Olive Green Tailcoat', 'americana'],
      ['Navy Blue Puffer Jacket', 'plumifero'],
      ['Black Puffer Vest', 'chaleco_acolchado'],
      ['Light Wash Denim Jacket', 'cazadora_vaquera'],
      ['Tan Cargo Shorts', 'pantalon_corto'],
      ['Boot-Cut Jeans', 'vaquero'],
      ['Plaid Mini Skirt', 'falda'],
      ['Black Pointed Toe Heels', 'tacones'],
      ['Red High-Top Sneakers', 'zapatillas_lona'],
      ['Black Top Hat', 'sombrero'],
      ['Plaid Trucker Baseball Cap', 'gorra'],
      ['Tie-Dye T-Shirt', 'camiseta'],
      ['White Dress Shirt', 'camisa'],
      ['Quilted Shoulder Bag', 'bolso'],
      ['White Knee High Socks', null],
      ['Red Hooded Jacket', 'sudadera'],
    ];
    for (const [name, sub] of cases) expect([name, subcategoryFromName(name)]).toEqual([name, sub]);
    // With the model's category: a type of that category; failing that, any.
    expect(subcategoryFromName('Red Nike Blazer High', 'footwear', { strict: true })).toBeNull();
    expect(subcategoryFromName('Red Hooded Jacket', 'top')).toBe('sudadera');
    expect(subcategoryFromName('Grey Wool Coat', 'top')).toBe('abrigo');
  });
  it('tells when a studio photo shows another kind of item than the garment', () => {
    expect(sameKindOfItem('black pointed toe heels', 'Brown Leather Loafers')).toBe(false);
    expect(sameKindOfItem('denim shorts', 'Dark Wash Jeans')).toBe(false);
    expect(sameKindOfItem('plaid mini skirt', 'Plaid Flannel Pants')).toBe(false);
    expect(sameKindOfItem('green tailcoat', 'Green Long Overcoat')).toBe(false);
    expect(sameKindOfItem('blue sleeveless dress', 'Blue Jumpsuit')).toBe(false);
    // Same kind, worded differently.
    expect(sameKindOfItem('red hoodie', 'Red Hooded Sweatshirt')).toBe(true);
    expect(sameKindOfItem('denim jacket', 'Light Wash Jacket')).toBe(true);
    expect(sameKindOfItem('beige trench coat', 'Beige Coat')).toBe(true);
    // Unknown to the vocabulary: no verdict.
    expect(sameKindOfItem('white toe socks', 'White Socks')).toBeNull();
    expect(sameKindOfItem('white knee socks', 'White Ribbed Crew Neck Sweater')).toBe(false);
    expect(sameKindOfItem('navy blue tights', 'Navy Opaque Tights')).toBeNull();
    // A set drawn for one piece: trousers drawn with the waistcoat that covered them, tights as a bodysuit.
    expect(sameKindOfItem('black trousers', 'Black Two-Piece Suit')).toBe(false);
    expect(sameKindOfItem('navy blue tights', 'Navy Blue Bodysuit')).toBe(false);
    expect(sameKindOfItem('grey tracksuit', 'Grey Tracksuit Set')).toBe(true);
    // A hoodie drawn without its hood; a sweatshirt named either way stays fine.
    expect(sameKindOfItem('red hooded sweatshirt', 'Red Crew Neck Sweatshirt')).toBe(false);
    expect(sameKindOfItem('red hooded sweatshirt', 'Red Hoodie')).toBe(true);
    expect(sameKindOfItem('red sweatshirt', 'Red Hoodie')).toBe(true);
  });
  it('the review proposes the model’s name and type, overriding a wrong classifier label', () => {
    const item = { bbox: null, cutout_png_base64: null, category: { value: 'accessory', confidence: 0.6 }, subcategory: { value: 'bufanda', confidence: 0.5 }, colors: [], pattern: null, materials: null, styles: null, seasons: null, fit: null, embedding: null, embedding_model: null };
    const found = { box: [0.3, 0.4, 0.6, 0.6] as [number, number, number, number], name: 'Plaid Mini Skirt', nameEs: 'Falda mini de cuadros', description: 'navy and red tartan pleated mini skirt', category: 'bottom', visible: 'whole' as const };
    expect(predictedWithVlm(item, found)).toMatchObject({
      category: { value: 'bottom', confidence: 0.9 },
      subcategory: { value: 'falda', confidence: 0.9 },
      vlm: { name: 'Plaid Mini Skirt', nameEs: 'Falda mini de cuadros', visible: 'whole' },
    });
    // A name the vocabulary does not know keeps the classifier's type.
    expect(predictedWithVlm(item, { ...found, name: 'White Toe Socks' })).toMatchObject({ subcategory: { value: 'bufanda' }, vlm: { name: 'White Toe Socks' } });
    expect(predictedWithVlm(item, undefined)).not.toHaveProperty('vlm');
  });
  it('the accepted garment keeps the model’s name unless the user corrected the type', () => {
    const p = { subcategory: { value: 'bufanda', confidence: 0.9 }, vlm: { name: 'Plaid Scarf', nameEs: 'bufanda de cuadros', description: '', visible: 'whole' as const } };
    expect(acceptedName(p, {})).toBe('Bufanda de cuadros');
    expect(acceptedName(p, { name: 'Mi bufanda' })).toBe('Mi bufanda');
    // Retyped as a skirt: the proposed name (as the review card showed it) is dropped; the user's own stays.
    expect(acceptedName(p, { subcategory: 'falda', name: 'Bufanda de cuadros' })).toBeUndefined();
    expect(acceptedName(p, { subcategory: 'falda' })).toBeUndefined();
    expect(acceptedName(p, { subcategory: 'falda', name: 'Falda escocesa' })).toBe('Falda escocesa');
    expect(acceptedName({ subcategory: { value: 'falda', confidence: 0.8 } }, {})).toBeUndefined();
  });
  it('MLX server: garments in a photo (clean boxes only) and what a studio photo shows', async () => {
    const { f, calls } = fakeFetch((url) =>
      url.endsWith('/v1/garments')
        ? json({ items: [{ box: [0.03, 0, 0.9, 1], name: 'red hoodie', name_es: 'Sudadera roja', description: 'red pullover hoodie', category: 'top', visible: 'partial', attributes: { kind: 'hoodie', length: 'hip', sleeves: 'long', hood: true, laces: 'no' } }, { box: [0, 0, 2, 1], name: 'bad box' }, { box: [0.1, 0.1, 0.2, 0.2], name: '' }] })
        : json({ name: 'Brown Leather Loafers', colour: 'brown', category: 'footwear', whole: true }),
    );
    const mlx = new MlxPackshot({ url: 'http://x', timeoutMs: 1000, fetcher: f });
    const photo = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } }).jpeg().toBuffer();
    expect(await mlx.garments(photo)).toEqual([
      {
        box: [0.03, 0, 0.9, 1],
        name: 'red hoodie',
        nameEs: 'Sudadera roja',
        description: 'red pullover hoodie',
        category: 'top',
        visible: 'partial',
        // What its studio photo must keep, checked field by field (a non-boolean flag is false).
        attributes: { kind: 'hoodie', colours: '', length: 'hip', sleeves: 'long', hood: true, laces: false, big_graphic_or_text: false, sheer_or_lace: false, hatband: false, tails: false, top_handle: false, worn: false },
      },
    ]);
    expect(await mlx.identify(photo)).toMatchObject({ name: 'Brown Leather Loafers', category: 'footwear' });
    expect(calls.map((c) => c.url)).toEqual(['http://x/v1/garments', 'http://x/v1/identify']);
    const { f: down } = fakeFetch(() => new Response('x', { status: 500 }));
    expect(await new MlxPackshot({ url: 'http://x', timeoutMs: 1000, fetcher: down }).garments(photo)).toBeNull();
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
