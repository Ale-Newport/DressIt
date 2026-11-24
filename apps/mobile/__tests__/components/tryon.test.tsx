/**
 * Virtual try-on and photo tools: progress of a sequential try-on, choosing the avatar image and
 * the method, and the manual cutout correction (taps → normalised points sent to the API).
 */
import type { AvatarProfileDto, GarmentDetailDto, GenerationJobDto, GenerationServiceStatusDto } from '@dressit/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AvatarRenderCard } from '@/components/outfits/AvatarRenderCard';
import { ToastProvider } from '@/components/ui';
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

  it('opens the cutout correction and adds the official photo of a matching product', async () => {
    routes = [
      ['GET', /\/v1\/garments\/g1\/official-photo$/, { matches: [{ productId: 'p1', title: 'Plumífero ligero', retailer: 'Tienda Prueba', imageUrl: 'https://x/p1.jpg', similarity: 0.93, url: null }], message: '' }],
      ['POST', /\/v1\/garments\/g1\/official-photo$/, { ...img('official'), license: 'retailer_licensed', attribution: 'Foto oficial de Tienda Prueba' }],
    ];
    await renderUi(<GarmentPhotoTools garment={detail()} />);
    await fireEvent.press(screen.getByTestId('garment-recut'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/garment/recut', params: { garmentId: 'g1' } });
    expect(await screen.findByText('Tienda Prueba · parecido 93 %')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('official-add-p1'));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ productId: 'p1' }));
  });

  it('explains why there is no official photo, and hides the correction without an original photo', async () => {
    routes = [['GET', /\/v1\/garments\/g1\/official-photo$/, { matches: [], message: 'No hay catálogos de tiendas autorizados conectados.' }]];
    await renderUi(<GarmentPhotoTools garment={detail({ images: [{ ...img('cut'), isCutout: true }] })} />);
    expect(await screen.findByText('No hay catálogos de tiendas autorizados conectados.')).toBeOnTheScreen();
    expect(screen.queryByTestId('garment-recut')).toBeNull();
  });
});
