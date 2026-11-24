import { describe, expect, it } from 'vitest';
import { mapAwinRow, parseCsv } from '../../src/modules/catalog/providers.ts';
import { validEan } from '../../src/modules/imports/service.ts';
import { classifyOccasion } from '../../src/modules/calendar/service.ts';
import { summarizeDay } from '../../src/modules/weather/service.ts';
import { parseDate, parseNumber, parseOccasion } from '../../src/modules/assistant/service.ts';
import { UrlSigner } from '../../src/lib/signing.ts';

describe('CSV / Awin feed mapping', () => {
  it('parses quoted CSV with commas, quotes and BOM', () => {
    const rows = parseCsv('﻿a,b,c\r\n"x, y","he said ""hi""",3\n');
    expect(rows).toEqual([['a', 'b', 'c'], ['x, y', 'he said "hi"', '3']]);
  });
  it('maps documented Awin columns', () => {
    const p = mapAwinRow({ aw_product_id: '123', product_name: 'Camiseta técnica', merchant_deep_link: 'https://shop.example.test/p/123', aw_deep_link: 'https://www.awin1.com/pclick.php?p=123', search_price: '9.99', rrp_price: '14.99', currency: 'EUR', merchant_image_url: 'https://cdn.example.test/123.jpg', in_stock: '1', 'Fashion:size': 'S,M,L', ean: '8436533720011', brand_name: 'Ejemplo', colour: 'Negro' });
    expect(p).toMatchObject({ externalId: '123', priceCents: 999, originalPriceCents: 1499, inStock: true, affiliateUrl: 'https://www.awin1.com/pclick.php?p=123', productUrl: 'https://shop.example.test/p/123' });
    expect(p?.sizes.map((s) => s.label)).toEqual(['S', 'M', 'L']);
  });
});

describe('misc parsers', () => {
  it('validates EAN check digits', () => {
    expect(validEan('4006381333931')).toBe(true);
    expect(validEan('4006381333932')).toBe(false);
    expect(validEan('96385074')).toBe(true);
  });
  it('classifies calendar events into occasions', () => {
    expect(classifyOccasion('Boda de Ana y Luis')).toBe('boda');
    expect(classifyOccasion('Entrevista con RRHH')).toBe('entrevista');
    expect(classifyOccasion('Cena con amigos')).toBe('cena');
    expect(classifyOccasion('Clase de Estadística')).toBe('universidad');
    expect(classifyOccasion('Dentista')).toBeNull();
  });
  it('assistant parses dates, numbers and occasions in Spanish', () => {
    expect(parseDate('¿qué me pongo mañana?', '2026-11-24')).toBe('2026-11-25');
    expect(parseDate('pasado mañana', '2026-11-24')).toBe('2026-11-26');
    expect(parseDate('el viernes', '2026-11-24')).toBe('2026-11-27');
    expect(parseDate('el 3 de diciembre', '2026-11-24')).toBe('2026-12-03');
    expect(parseNumber('un viaje de cuatro días')).toBe(4);
    expect(parseOccasion('para ir a trabajar')).toBe('trabajo');
  });
  it('signs and verifies image URLs', () => {
    const s = new UrlSigner('x'.repeat(40), 'http://api');
    const url = new URL(s.sign('u1', 'img1', 'thumb'));
    const exp = Number(url.searchParams.get('exp'));
    expect(s.verify('u1', 'img1', 'thumb', exp, url.searchParams.get('sig')!)).toBe(true);
    expect(s.verify('u2', 'img1', 'thumb', exp, url.searchParams.get('sig')!)).toBe(false);
    expect(s.verify('u1', 'img1', 'original', exp, url.searchParams.get('sig')!)).toBe(false);
    expect(s.verify('u1', 'img1', 'thumb', exp, url.searchParams.get('sig')!, (exp + 1) * 1000)).toBe(false);
  });
});

describe('weather day profile', () => {
  const hours = Array.from({ length: 24 }, (_, h) => `2026-11-24T${String(h).padStart(2, '0')}:00`);
  const data = {
    timezone: 'Europe/Madrid',
    hourly: {
      time: hours,
      temperature_2m: hours.map((_, h) => 10 + Math.max(0, Math.min(h - 8, 9))),
      apparent_temperature: hours.map((_, h) => 8 + Math.max(0, Math.min(h - 8, 9))),
      precipitation_probability: hours.map((_, h) => (h >= 16 && h <= 19 ? 70 : 5)),
      precipitation: hours.map((_, h) => (h >= 16 && h <= 19 ? 1.2 : 0)),
      wind_speed_10m: hours.map(() => 12),
      relative_humidity_2m: hours.map(() => 70),
      uv_index: hours.map(() => 2),
      weather_code: hours.map((_, h) => (h >= 16 && h <= 19 ? 61 : 2)),
    },
  };
  it('considers the whole day window, not just the current hour', () => {
    const d = summarizeDay(data, { date: '2026-11-24', window: { start: '08:00', end: '19:00' }, locationName: 'Madrid', provider: 'test', fetchedAt: new Date(), stale: false });
    expect(d.tempAtStart).toBe(10);
    expect(d.tempAtEnd).toBe(19);
    expect(d.tempMin).toBe(10);
    expect(d.tempMax).toBe(19);
    expect(d.rainPeriods[0]?.from).toBe('2026-11-24T16:00');
    expect(d.summary).toBe('Hoy hará entre 10 y 19 °C, con lluvia por la tarde.');
  });
});
