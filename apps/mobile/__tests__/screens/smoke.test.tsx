/**
 * Screen smoke tests: render the main tab screens against responses recorded
 * from the real local API (`__tests__/api-fixtures`, anonymised) and check that
 * real data — not error states — is shown. Network is mocked at `fetch`.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ToastProvider } from '@/components/ui';
import { ThemeProvider } from '@/theme';

import gaps from '../api-fixtures/gaps.json';
import garments from '../api-fixtures/garments.json';
import home from '../api-fixtures/home.json';
import me from '../api-fixtures/me.json';
import outfitsSaved from '../api-fixtures/outfits-saved.json';
import recommendations from '../api-fixtures/recommendations.json';
import retailers from '../api-fixtures/retailers.json';
import sections from '../api-fixtures/sections.json';
import spaces from '../api-fixtures/spaces.json';
import stats from '../api-fixtures/stats.json';
import tags from '../api-fixtures/tags.json';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true, setParams: jest.fn(), dismiss: jest.fn() };

jest.mock('expo-router', () => {
  const Stack = () => null;
  Stack.Screen = () => null;
  return {
    useRouter: () => mockRouter,
    router: mockRouter,
    useLocalSearchParams: () => ({}),
    useNavigation: () => ({ setOptions: jest.fn() }),
    Stack,
  };
});

jest.mock('@shopify/flash-list', () => {
  const { FlatList } = require('react-native');
  return { FlashList: FlatList };
});

const ROUTES: Array<[RegExp, unknown]> = [
  [/\/v1\/me$/, me],
  [/\/v1\/home$/, home],
  [/\/v1\/outfits\/recommendations$/, recommendations],
  [/\/v1\/outfits\?/, outfitsSaved],
  [/\/v1\/garments(\?|$)/, garments],
  [/\/v1\/wardrobe\/stats$/, stats],
  [/\/v1\/shopping\/sections/, sections],
  [/\/v1\/shopping\/gaps$/, gaps],
  [/\/v1\/spaces$/, spaces],
  [/\/v1\/tags$/, tags],
  [/\/v1\/retailers$/, retailers],
  [/\/v1\/imports/, []],
];

const requested: string[] = [];

beforeAll(() => {
  globalThis.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);
    const hit = ROUTES.find(([re]) => re.test(url));
    if (!hit) return new Response(JSON.stringify({ error: { code: 'not_found', message: `Sin fixture: ${url}` } }), { status: 404 });
    return new Response(JSON.stringify(hit[1]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
});

async function renderScreen(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>
      <ThemeProvider>
        <QueryClientProvider client={client}>
          <ToastProvider>{ui}</ToastProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  );
}

describe('main screens render real API data', () => {
  it('Inicio shows the greeting, weather and the recommended outfits', async () => {
    const Home = require('@/app/(app)/(tabs)/index').default;
    await renderScreen(<Home />);
    await waitFor(() => expect(screen.getByTestId('home-outfit-0')).toBeOnTheScreen(), { timeout: 5000 });
    expect(screen.queryByTestId('error-state')).toBeNull();
    expect(screen.getByTestId('weather-credit')).toBeOnTheScreen();
    expect(requested.some((u) => u.includes('/v1/outfits/recommendations'))).toBe(true);
  });

  it('Armario lists the garments', async () => {
    const Armario = require('@/app/(app)/(tabs)/armario').default;
    await renderScreen(<Armario />);
    const first = (garments as { items: Array<{ id: string }> }).items[0]!;
    await waitFor(() => expect(screen.getByTestId(`garment-tile-${first.id}`)).toBeOnTheScreen(), { timeout: 5000 });
    expect(screen.queryByTestId('error-state')).toBeNull();
  });

  it('Descubrir explains honestly that no catalogue is configured', async () => {
    const Descubrir = require('@/app/(app)/(tabs)/descubrir').default;
    await renderScreen(<Descubrir />);
    const reason = (sections as Array<{ emptyReason: string | null }>)[0]!.emptyReason!;
    await waitFor(() => expect(screen.getAllByText(reason, { exact: false }).length).toBeGreaterThan(0), { timeout: 5000 });
    expect(screen.queryByTestId('error-state')).toBeNull();
  });

  it('Perfil shows the account', async () => {
    const Perfil = require('@/app/(app)/(tabs)/perfil').default;
    await renderScreen(<Perfil />);
    await waitFor(() => expect(screen.getByText((me as { displayName: string }).displayName)).toBeOnTheScreen(), { timeout: 5000 });
    expect(screen.getByTestId('perfil-logout')).toBeOnTheScreen();
  });

  it('Estadísticas renders the wardrobe stats', async () => {
    const Stats = require('@/app/(app)/wardrobe/stats').default;
    await renderScreen(<Stats />);
    await waitFor(() => expect(screen.queryByTestId('skeleton')).toBeNull(), { timeout: 5000 });
    expect(screen.queryByTestId('error-state')).toBeNull();
  });
});
