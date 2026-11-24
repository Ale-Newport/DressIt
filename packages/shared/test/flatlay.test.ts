import { describe, expect, it } from 'vitest';
import { composeFlatLay, flatLayHeightCm, type FlatLayBox, type FlatLayPiece } from '../src/flatlay.ts';

const outfit: FlatLayPiece[] = [
  { key: 'outer', slot: 'outer', category: 'outerwear', subcategory: 'plumifero', aspect: 0.82 },
  { key: 'mid', slot: 'mid', category: 'top', subcategory: 'jersey_grueso', aspect: 1.1 },
  { key: 'base', slot: 'base', category: 'top', subcategory: 'camiseta', aspect: 1.05 },
  { key: 'bottom', slot: 'bottom', category: 'bottom', subcategory: 'vaquero', aspect: 0.45 },
  { key: 'footwear', slot: 'footwear', category: 'footwear', subcategory: 'bailarinas', aspect: 0.8 },
  { key: 'accessory:neck', slot: 'accessory:neck', category: 'accessory', subcategory: 'bufanda', aspect: 0.7 },
  { key: 'accessory:head', slot: 'accessory:head', category: 'accessory', subcategory: 'gorro', aspect: 0.9 },
];

const overlaps = (a: FlatLayBox, b: FlatLayBox) => a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6 && a.y < b.y + b.h - 1e-6 && b.y < a.y + a.h - 1e-6;

describe('composeFlatLay', () => {
  for (const canvasAspect of [0.8, 1, 0.75]) {
    it(`keeps every piece inside a ${canvasAspect} canvas without overlaps`, () => {
      const boxes = composeFlatLay(outfit, { canvasAspect });
      expect(boxes).toHaveLength(outfit.length);
      for (const b of boxes) {
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.y).toBeGreaterThanOrEqual(0);
        expect(b.x + b.w).toBeLessThanOrEqual(1.0005);
        expect(b.y + b.h).toBeLessThanOrEqual(1.0005);
      }
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i]!, boxes[j]!)).toBe(false);
    });
  }

  it('respects the cutout aspect ratio and real-world proportions', () => {
    const boxes = composeFlatLay(outfit, { canvasAspect: 0.8 });
    const by = (k: string) => boxes.find((b) => b.key === k)!;
    for (const p of outfit) {
      const b = by(p.key);
      expect((b.w * 0.8) / b.h).toBeCloseTo(p.aspect!, 1);
    }
    // Jeans are drawn taller than the puffer, the puffer taller than the beanie.
    expect(by('bottom').h).toBeGreaterThan(by('outer').h);
    expect(by('outer').h).toBeGreaterThan(by('accessory:head').h);
    // Outer layer over the jeans in the main column; shoes at the bottom of the side column.
    expect(by('outer').y).toBeLessThan(by('bottom').y);
    expect(by('footwear').x).toBeGreaterThan(by('outer').x);
    expect(Math.max(...boxes.filter((b) => b.x > by('outer').x + by('outer').w).map((b) => b.y))).toBe(by('footwear').y);
  });

  it('places a one-piece in the main column and handles a single piece', () => {
    const boxes = composeFlatLay([
      { key: 'one_piece', slot: 'one_piece', subcategory: 'vestido' },
      { key: 'footwear', slot: 'footwear', subcategory: 'tacones' },
    ]);
    expect(boxes.find((b) => b.key === 'one_piece')!.x).toBeLessThan(boxes.find((b) => b.key === 'footwear')!.x);
    const single = composeFlatLay([{ key: 'base', slot: 'base', subcategory: 'camiseta', aspect: 1 }], { canvasAspect: 1 });
    expect(single[0]!.w).toBeGreaterThan(0.5);
    expect(composeFlatLay([])).toEqual([]);
  });

  it('enlarges tiny accessories for readability but keeps them small', () => {
    expect(flatLayHeightCm({ slot: 'accessory:wrist', subcategory: 'reloj' })).toBeGreaterThan(15);
    expect(flatLayHeightCm({ slot: 'accessory:wrist', subcategory: 'reloj' })).toBeLessThan(flatLayHeightCm({ slot: 'accessory:head', subcategory: 'gorro' }));
    expect(flatLayHeightCm({ slot: 'bottom', subcategory: 'vaquero' })).toBe(104);
  });
});
