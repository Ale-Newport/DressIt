import { levelsToWeights, weightsToLevels } from '@/components/profile/PreferenceSections';
import { roundCoord } from '@/api/hooks/me';
import { addDays, monthGrid, startOfWeek } from '@/lib/dates';
import { formatCents, timeAgo } from '@/lib/format';
import { captureFromShareMeta, parseCaptureMessage, toPageCaptureRequest } from '@/lib/pageCapture';
import { extractUrl, hostnameOf, looksLikeStoreUrl } from '@/lib/urls';
import { slotForSubcategory, slotLabel } from '@/lib/vocab';

describe('format', () => {
  const now = new Date('2026-11-24T12:00:00Z').getTime();
  it('timeAgo in Spanish', () => {
    expect(timeAgo('2026-11-24T11:59:40Z', now)).toBe('hace un momento');
    expect(timeAgo('2026-11-24T11:45:00Z', now)).toBe('hace 15 min');
    expect(timeAgo('2026-11-23T12:00:00Z', now)).toBe('hace 1 día');
    expect(timeAgo(null, now)).toBeNull();
  });
  it('formats euros es-ES', () => {
    expect(formatCents(5995)).toMatch(/59,95\s?€/);
  });
});

describe('dates', () => {
  it('weeks start on Monday', () => {
    expect(startOfWeek('2026-11-26')).toBe('2026-11-23');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(monthGrid('2026-11-10')).toHaveLength(42);
    expect(monthGrid('2026-11-10')[0]).toBe('2026-10-26');
  });
});

describe('privacy: location rounding', () => {
  it('rounds to 2 decimals (~1 km)', () => {
    expect(roundCoord(40.416775)).toBe(40.42);
    expect(roundCoord(-3.70379)).toBe(-3.7);
  });
});

describe('urls', () => {
  it('extracts a URL from shared text', () => {
    expect(extractUrl('Mira esto https://www.tienda.es/p/chaqueta-123.html, ¿te gusta?')).toBe('https://www.tienda.es/p/chaqueta-123.html');
    expect(extractUrl('sin enlace')).toBeNull();
  });
  it('detects store-like URLs', () => {
    expect(looksLikeStoreUrl('https://www.tienda.es/p/chaqueta-123.html')).toBe(true);
    expect(looksLikeStoreUrl('https://example.org/', ['example.org'])).toBe(true);
    expect(looksLikeStoreUrl('no es url')).toBe(false);
    expect(hostnameOf('https://www.zara.com/es/')).toBe('zara.com');
  });
});

describe('page capture', () => {
  it('builds a PageCaptureRequest with JSON-LD, meta and microdata', () => {
    const msg = parseCaptureMessage(
      JSON.stringify({
        type: 'dressit:capture',
        url: 'https://shop.example/p/1',
        title: 'Chaqueta',
        jsonLd: ['{"@type":"Product"}'],
        meta: { 'og:title': 'Chaqueta', 'fb:app_id': 'x' },
        microdata: { price: '59.95', priceCurrency: 'EUR', bogus: 'x' },
      }),
    );
    expect(msg?.type).toBe('dressit:capture');
    const req = toPageCaptureRequest(msg as Extract<typeof msg, { type: 'dressit:capture' }> & object, new Date('2026-11-24T00:00:00Z'));
    expect(req).toEqual({
      url: 'https://shop.example/p/1',
      jsonLd: ['{"@type":"Product"}'],
      meta: { 'og:title': 'Chaqueta' },
      microdata: { price: '59.95', priceCurrency: 'EUR' },
      title: 'Chaqueta',
      capturedAt: '2026-11-24T00:00:00.000Z',
    });
  });
  it('ignores unrelated WebView messages', () => {
    expect(parseCaptureMessage('hello')).toBeNull();
    expect(parseCaptureMessage('{"type":"other"}')).toBeNull();
  });
  it('builds a capture from iOS share meta or returns null', () => {
    expect(captureFromShareMeta('https://a.es', { title: 'x' })).toBeNull();
    const req = captureFromShareMeta('https://a.es/p', {
      title: 'Bolso',
      'og:price:amount': '30',
      'dressit:jsonld': JSON.stringify(['{}']),
      'dressit:microdata': JSON.stringify({ name: 'Bolso' }),
      'dressit:url': 'https://a.es/p?x=1',
    });
    expect(req).toMatchObject({ url: 'https://a.es/p?x=1', jsonLd: ['{}'], meta: { 'og:price:amount': '30' }, microdata: { name: 'Bolso' }, title: 'Bolso' });
  });
});

describe('vocabulary helpers', () => {
  it('maps subcategories to outfit slots', () => {
    expect(slotForSubcategory('camiseta')).toBe('base');
    expect(slotForSubcategory('jersey')).toBe('mid');
    expect(slotForSubcategory('bolso')).toBe('accessory:bag');
    expect(slotLabel('accessory:bag')).toBe('Complemento · Bolso');
  });
});

describe('priorities', () => {
  it('normalises levels to weights summing ~1', () => {
    const w = levelsToWeights({ comfort: 3, elegance: 1, practicality: 2 });
    expect(w.comfort + w.elegance + w.practicality).toBeCloseTo(1, 2);
    expect(weightsToLevels(w)).toEqual({ comfort: 3, elegance: 1, practicality: 2 });
  });
});
