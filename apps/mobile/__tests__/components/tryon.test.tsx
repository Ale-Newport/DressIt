/**
 * Virtual try-on and photo tools: progress of a sequential try-on, choosing the avatar image and
 * the method, the manual cutout correction (taps → normalised points sent to the API) and the
 * catalogue photo (official photo / AI packshot, compared and chosen by the user).
 */
import type { AvatarProfileDto, CatalogMatchDto, CatalogPhotoDto, CatalogPhotoSummaryDto, GarmentDetailDto, GenerationJobDto, GenerationServiceStatusDto } from '@dressit/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AvatarRenderCard } from '@/components/outfits/AvatarRenderCard';
import { ToastProvider } from '@/components/ui';
import { CatalogPhotoPreview } from '@/components/capture/CatalogPhotoPreview';
import { CatalogPhotoCard } from '@/components/wardrobe/CatalogPhotoCard';
import { GarmentPhotoTools } from '@/components/wardrobe/GarmentPhotoTools';
import { RecutEditor } from '@/components/wardrobe/RecutEditor';
import { progressText, progressValue } from '@/lib/avatar';
import { addPoint, canRecut, MAX_RECUT_POINTS, tapToPoint, type RecutPoint } from '@/lib/recut';
import { ThemeProvider } from '@/theme';

import { garment, outfit } from '../fixtures';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, back: jest.fn() }) }));

const img = (id: string) => ({ id, url: `https://x/${id}.png`, thumbUrl: `https://x/${id}.webp`, width: 600, height: 800, isCutout: false, license: 'user_owned' as const, attribution: null });

let routes: Array<[string, RegExp, unknown]> = [];
const calls: Array<{ method: string; url: string; body: unknown }> = [];
beforeEach(() => {
  calls.length = 0;
  globalThis.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null });
    const hit = routes.find(([m, re]) => m === method && re.test(url));
    if (!hit) return new Response(JSON.stringify({ error: { code: 'not_found', message: `Sin fixture: ${method} ${url}` } }), { status: 404 });
    return new Response(JSON.stringify(hit[2]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
});

async function renderUi(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <ThemeProvider>
        <QueryClientProvider client={client}>
          <ToastProvider>{ui}</ToastProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  );
}

const status: GenerationServiceStatusDto = { available: true, studio: true, avatar: true, tryon: true, reason: null, models: { studio: 'q', avatar: 'q' } };
const profile: AvatarProfileDto = {
  face: img('face'),
  body: img('body'),
  attestedSelf: true,
  attestedAdult: true,
  ready: true,
  updatedAt: '2026-11-24T10:00:00Z',
  bases: [
    { id: 'b1', view: 'frontal', background: 'estudio_gris', status: 'ready', image: img('b1'), generated: false, error: null },
    { id: 'b2', view: 'perfil', background: 'blanco', status: 'ready', image: { ...img('b2'), generatedBy: 'Qwen' }, generated: true, error: null },
  ],
};
const job = (over: Partial<GenerationJobDto>): GenerationJobDto => ({
  id: 'j1',
  kind: 'avatar',
  status: 'running',
  garmentId: null,
  outfitId: 'o1',
  result: null,
  fidelity: null,
  model: 'FASHN VTON v1.5',
  error: null,
  method: 'sequential',
  progress: null,
  createdAt: '2026-11-24T10:00:00Z',
  finishedAt: null,
  ...over,
});

describe('try-on progress text', () => {
  it('says which step is running and how many came from the cache', () => {
    expect(progressText(job({ status: 'queued' }))).toBe('En cola…');
    expect(progressText(job({ progress: { step: 2, total: 4, label: 'Probando: vaquero, azul', reused: 0 } }))).toBe('Paso 2 de 4 · Probando: vaquero, azul');
    expect(progressText(job({ progress: { step: 3, total: 4, label: 'Probando: chaqueta', reused: 2 } }))).toBe('Paso 3 de 4 · Probando: chaqueta · 2 pasos reutilizados');
    expect(progressValue(job({ progress: { step: 1, total: 4, label: '', reused: 0 } }))).toBeCloseTo(0.125);
    expect(progressValue(job({ status: 'queued' }))).toBe(0);
  });
});

describe('AvatarRenderCard', () => {
  it('shows the step-by-step progress of a running try-on', async () => {
    routes = [
      ['GET', /\/v1\/generation\/status$/, status],
      ['GET', /\/v1\/me\/avatar$/, profile],
      ['GET', /\/v1\/outfits\/o1\/avatar$/, [job({ progress: { step: 2, total: 3, label: 'Probando: camisa, blanco', reused: 1 } })]],
    ];
    await renderUi(<AvatarRenderCard outfit={outfit({ id: 'o1' })} />);
    expect(await screen.findByText('Paso 2 de 3 · Probando: camisa, blanco · 1 paso reutilizado')).toBeOnTheScreen();
  });

  it('lets the user pick the avatar image and the method, and sends them', async () => {
    routes = [
      ['GET', /\/v1\/generation\/status$/, status],
      ['GET', /\/v1\/me\/avatar$/, profile],
      ['GET', /\/v1\/outfits\/o1\/avatar$/, []],
      ['POST', /\/v1\/outfits\/o1\/avatar$/, job({ status: 'queued' })],
    ];
    const withPhotos = outfit({ id: 'o1', items: [{ slot: 'base', garment: garment({ id: 'g1', image: { ...img('g1'), isCutout: true } }), candidateProduct: null }] });
    await renderUi(<AvatarRenderCard outfit={withPhotos} />);
    await fireEvent.press(await screen.findByTestId('avatar-render-base-b2'));
    await fireEvent.press(screen.getByTestId('avatar-render-create'));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ method: 'sequential', baseId: 'b2' }));
    // The one-pass method doesn't use a saved base.
    await fireEvent.press(screen.getByTestId('avatar-render-method-joint'));
    expect(screen.queryByTestId('avatar-render-base-b1')).toBeNull();
  });
});

describe('manual cutout correction', () => {
  it('turns taps into normalised points, up to the limit', () => {
    expect(tapToPoint(150, 200, 300, 400, 1)).toEqual([0.5, 0.5, 1]);
    expect(tapToPoint(-1, 10, 300, 400, 1)).toBeNull();
    expect(tapToPoint(10, 10, 0, 0, 1)).toBeNull();
    let pts: RecutPoint[] = [];
    for (let i = 0; i < MAX_RECUT_POINTS + 3; i++) pts = addPoint(pts, [0.1, 0.1, 0]);
    expect(pts).toHaveLength(MAX_RECUT_POINTS);
    expect(canRecut(pts)).toBe(false);
    expect(canRecut([...pts.slice(1), [0.5, 0.5, 1]])).toBe(true);
  });

  it('marks garment / not-garment points on the photo and sends them', async () => {
    routes = [
      ['GET', /\/v1\/garments\/g1\/recut$/, img('orig')],
      ['POST', /\/v1\/garments\/g1\/recut$/, { ...img('new'), isCutout: true }],
    ];
    const onDone = jest.fn();
    await renderUi(<RecutEditor target={{ garmentId: 'g1' }} onDone={onDone} />);
    const photo = await screen.findByTestId('recut-photo');
    await fireEvent(photo, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 400 } } });
    expect(screen.getByTestId('recut-submit')).toBeDisabled();
    await fireEvent.press(photo, { nativeEvent: { locationX: 150, locationY: 200 } });
    await fireEvent.press(screen.getByTestId('recut-mode-0'));
    await fireEvent.press(photo, { nativeEvent: { locationX: 30, locationY: 380 } });
    expect(screen.getByTestId('recut-point-1')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('recut-submit'));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ points: [[0.5, 0.5, 1], [0.1, 0.95, 0]] }));
    await fireEvent.press(await screen.findByTestId('recut-done'));
    expect(onDone).toHaveBeenCalled();
  });
});

describe('garment photo tools', () => {
  const detail = (over: Partial<GarmentDetailDto> = {}) =>
    ({ ...garment({ id: 'g1' }), images: [img('orig')], notes: null, model: null, attributes: [], availabilityHistory: [], wearHistory: [], compatibleCount: null, ...over }) as GarmentDetailDto;

  it('opens the cutout correction, hidden without an original photo', async () => {
    await renderUi(<GarmentPhotoTools garment={detail()} />);
    await fireEvent.press(screen.getByTestId('garment-recut'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/garment/recut', params: { garmentId: 'g1' } });
    await renderUi(<GarmentPhotoTools garment={detail({ images: [{ ...img('cut'), isCutout: true }] })} />);
    expect(screen.queryByTestId('garment-recut')).toBeNull();
  });
});

describe('catalogue photo', () => {
  const detail = (over: Partial<GarmentDetailDto> = {}) =>
    ({ ...garment({ id: 'g1' }), images: [img('orig')], notes: null, model: null, attributes: [], availabilityHistory: [], wearHistory: [], compatibleCount: null, ...over }) as GarmentDetailDto;
  const consents = [
    { kind: 'ai_image_generation', granted: true, version: '1', updatedAt: null },
    { kind: 'visual_search_external', granted: true, version: '1', updatedAt: null },
  ];
  const check = (passed: boolean, reasons: string[] = []) => ({ passed, presentationPassed: passed, fidelityPassed: true, similarity: 0.91, symmetry: 0.95, neat: 0.8, paletteDeltaE: 5, textMatch: null, reasons });
  const match = (over: Partial<CatalogMatchDto> = {}): CatalogMatchDto => ({
    id: 'm1', provider: 'serpapi_lens', verdict: 'exact', title: 'Jersey de punto', brand: 'Marca', retailer: 'Tienda', domain: 'tienda.es', pageUrl: 'https://tienda.es/p', imageUrl: 'https://tienda.es/p.jpg', price: null,
    similarity: 0.93, evidence: ['La marca leída en la prenda coincide.'], doubts: [], usage: 'link_preview', studioLike: true, ...over,
  });
  const job = (over: Partial<CatalogPhotoDto> = {}): CatalogPhotoDto => ({
    id: 'c1', garmentId: 'g1', detectionId: null, status: 'ready', stage: null, original: { ...img('cut'), isCutout: true }, official: null, alternatives: [], generated: null, generatedCheck: null, attempts: [],
    providers: [{ id: 'serpapi_lens', label: 'Google Lens (SerpApi)', status: 'not_configured', message: 'Falta SERPAPI_API_KEY en el servidor.' }],
    recognised: { brand: null, text: null, reference: null }, choice: null, message: null, error: null, createdAt: '2026-11-24T10:00:00Z', finishedAt: '2026-11-24T10:01:00Z', ...over,
  });

  it('shows the progress while it is being prepared', async () => {
    routes = [
      ['GET', /\/v1\/me\/consents$/, consents],
      ['GET', /\/v1\/garments\/g1\/catalog-photo$/, job({ status: 'generating', stage: { step: 2, total: 3, label: 'Creando la foto de estudio de tu prenda…' } })],
    ];
    await renderUi(<CatalogPhotoCard garment={detail()} />);
    expect(await screen.findByText('Creando la foto de estudio de tu prenda…')).toBeOnTheScreen();
    expect(screen.getByText(/Paso 2 de 3/)).toBeOnTheScreen();
  });

  it('compares original, official and generated photos, and uses the one the user picks', async () => {
    routes = [
      ['GET', /\/v1\/me\/consents$/, consents],
      ['GET', /\/v1\/garments\/g1\/catalog-photo$/, job({ official: match(), generated: { ...img('gen'), isCutout: true, generatedBy: 'Qwen' }, generatedCheck: check(true), message: 'Tienes la foto oficial y una foto de estudio creada con IA.' })],
      ['POST', /\/v1\/catalog-photos\/c1\/choose$/, job({ choice: 'official', status: 'confirmed' })],
    ];
    await renderUi(<CatalogPhotoCard garment={detail()} />);
    expect(await screen.findByTestId('catalog-official')).toBeOnTheScreen();
    expect(screen.getByTestId('catalog-generated')).toBeOnTheScreen();
    expect(screen.getByText('✓ La marca leída en la prenda coincide.')).toBeOnTheScreen();
    expect(screen.getByText('La foto se muestra desde la web de la tienda (no se copia).')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('catalog-use-official'));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ choice: 'official' }));
    // Where it searched, including the engines this server has no key for.
    await fireEvent.press(screen.getByTestId('catalog-sources-toggle'));
    expect(screen.getByText(/Google Lens \(SerpApi\): sin configurar en el servidor/)).toBeOnTheScreen();
  });

  it('explains a packshot that did not pass the checks and only uses it if the user insists', async () => {
    routes = [
      ['GET', /\/v1\/me\/consents$/, consents],
      ['GET', /\/v1\/garments\/g1\/catalog-photo$/, job({ status: 'needs_user', generated: { ...img('gen'), isCutout: true, generatedBy: 'Qwen' }, generatedCheck: check(false, ['La prenda no está bien colocada: mangas, perneras o laterales no quedan simétricos.']), message: 'Tras 3 intentos…', alternatives: [match({ id: 'm2', verdict: 'possible', doubts: ['Solo hay parecido visual: ninguna marca, referencia ni otra fuente lo confirma.'] })] })],
      ['POST', /\/v1\/catalog-photos\/c1\/choose$/, job({ choice: 'generated', status: 'confirmed' })],
      ['POST', /\/v1\/garments\/g1\/catalog-photo$/, job({ status: 'queued' })],
    ];
    await renderUi(<CatalogPhotoCard garment={detail()} />);
    expect(await screen.findByText(/no quedan simétricos/)).toBeOnTheScreen();
    expect(screen.queryByTestId('catalog-use-generated')).toBeNull();
    expect(screen.getByText(/Solo hay parecido visual/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('catalog-accept-warnings'));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.url.endsWith('/choose'))?.body).toEqual({ choice: 'generated', acceptWarnings: true }));
    await fireEvent.press(screen.getByTestId('catalog-regenerate'));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.url.endsWith('/catalog-photo'))?.body).toEqual({ mode: 'generate' }));
  });

  it('asks for another photo when the garment is cut by the frame, or generates anyway', async () => {
    routes = [
      ['GET', /\/v1\/me\/consents$/, consents],
      ['GET', /\/v1\/garments\/g1\/catalog-photo$/, job({ status: 'needs_user', message: 'La prenda sale cortada por los bordes de la foto: haz otra con la prenda entera para no inventar las partes que no se ven.' })],
      ['POST', /\/v1\/garments\/g1\/catalog-photo$/, job({ status: 'queued' })],
    ];
    await renderUi(<CatalogPhotoCard garment={detail()} />);
    await fireEvent.press(await screen.findByTestId('catalog-force'));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ mode: 'generate', force: true }));
  });
});

describe('catalogue photo in the review queue', () => {
  const summary = (over: Partial<CatalogPhotoSummaryDto> = {}): CatalogPhotoSummaryDto => ({
    id: 'c9', status: 'ready', stage: null, official: { imageUrl: 'https://tienda.es/p.jpg', retailer: 'Tienda', verdict: 'exact' }, generated: { ...img('gen'), isCutout: true, generatedBy: 'Qwen' }, generatedPassed: true, choice: null, message: 'Foto de catálogo lista', ...over,
  });

  it('shows the progress while the official photo is searched', async () => {
    await renderUi(<CatalogPhotoPreview summary={summary({ status: 'searching', stage: { step: 1, total: 3, label: 'Buscando la foto oficial de la prenda…' }, official: null, generated: null })} importJobId="j1" detectionId="d1" />);
    expect(screen.getByText('Buscando la foto oficial de la prenda…')).toBeOnTheScreen();
  });

  it('lets the user pick the official or the AI photo before adding the garment', async () => {
    routes = [['POST', /\/v1\/catalog-photos\/c9\/choose$/, { id: 'c9' }]];
    await renderUi(<CatalogPhotoPreview summary={summary()} importJobId="j1" detectionId="d1" />);
    expect(screen.getByTestId('detection-d1-catalog-official')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('detection-d1-catalog-generated'));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ choice: 'generated' }));
  });

  it('never offers a packshot that failed the checks as a one-tap choice', async () => {
    await renderUi(<CatalogPhotoPreview summary={summary({ status: 'needs_user', official: null, generatedPassed: false, message: 'Tras 3 intentos…' })} importJobId="j1" detectionId="d1" />);
    expect(screen.queryByTestId('detection-d1-catalog-generated')).toBeNull();
    expect(screen.getByText('Tras 3 intentos…')).toBeOnTheScreen();
  });
});

