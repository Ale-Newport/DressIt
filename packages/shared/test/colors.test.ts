import { describe, expect, it } from 'vitest';
import { colorFamilyFromText, deltaE2000, hexToLab, nearestColorFamily } from '../src/colors.ts';
import { SUBCATEGORIES, getSubcategory, OCCASIONS } from '../src/vocabulary.ts';

describe('CIEDE2000', () => {
  // Reference pairs from Sharma, Wu & Dalal (2005), Table 1.
  const cases: Array<[[number, number, number], [number, number, number], number]> = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
    [[50, 2.8361, -74.02], [50, 0, -82.7485], 3.4412],
    [[50, -1.3802, -84.2814], [50, 0, -82.7485], 1.0],
    [[50, 0, 0], [50, -1, 2], 2.3669],
    [[50, 2.49, -0.001], [50, -2.49, 0.0009], 7.1792],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
    [[22.7233, 20.0904, -46.694], [23.0331, 14.973, -42.5619], 2.0373],
    [[90.9257, -0.5406, -0.9208], [88.6381, -0.8985, -0.7239], 1.5381],
  ];
  it.each(cases)('matches reference %#', (a, b, expected) => {
    expect(deltaE2000(a, b)).toBeCloseTo(expected, 3);
  });
});

describe('color families', () => {
  it('maps pure-ish colors to the expected family', () => {
    expect(nearestColorFamily('#000000').family).toBe('negro');
    expect(nearestColorFamily('#ffffff').family).toBe('blanco');
    expect(nearestColorFamily('#1c2541').family).toBe('azul_marino');
    expect(nearestColorFamily('#d2b48c').family).toBe('beige');
    expect(nearestColorFamily('#b22222').family).toBe('rojo');
  });
  it('parses Spanish retailer color names', () => {
    expect(colorFamilyFromText('Chaqueta azul marino')).toBe('azul_marino');
    expect(colorFamilyFromText('Vaquero azul claro')).toBe('celeste');
    expect(colorFamilyFromText('Jersey verde oliva')).toBe('verde_oliva');
    expect(colorFamilyFromText('Abrigo camel')).toBe('camel');
    expect(colorFamilyFromText('Camisa a rayas')).toBeNull();
  });
  it('Lab of white is ~ (100, 0, 0)', () => {
    const [L, a, b] = hexToLab('#ffffff');
    expect(L).toBeCloseTo(100, 1);
    expect(Math.abs(a)).toBeLessThan(0.5);
    expect(Math.abs(b)).toBeLessThan(0.5);
  });
});

describe('vocabulary integrity', () => {
  it('has unique subcategory ids with sane ranges', () => {
    const ids = new Set<string>();
    for (const sub of SUBCATEGORIES) {
      expect(ids.has(sub.id)).toBe(false);
      ids.add(sub.id);
      expect(sub.formality).toBeGreaterThanOrEqual(0);
      expect(sub.formality).toBeLessThanOrEqual(100);
      expect(sub.clo).toBeGreaterThanOrEqual(0);
      expect(sub.clo).toBeLessThan(1.5);
      expect(sub.tempRange[0]).toBeLessThan(sub.tempRange[1]);
    }
    expect(getSubcategory('abrigo')?.layer).toBe('outer');
  });
  it('occasions have valid formality windows', () => {
    for (const o of OCCASIONS) expect(o.formality[0]).toBeLessThan(o.formality[1]);
  });
});
