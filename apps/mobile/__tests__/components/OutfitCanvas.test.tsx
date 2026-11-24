import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { computeLayout, OutfitCanvas } from '@/components/ui/OutfitCanvas';

import { garment, outfit } from '../fixtures';

describe('OutfitCanvas', () => {
  it('composes a flat lay inside the canvas without overlaps', () => {
    const o = outfit();
    for (const aspect of [4 / 5, 1]) {
      const boxes = computeLayout(o.items, aspect);
      expect(boxes.map((b) => b.slot).sort()).toEqual(['base', 'bottom', 'footwear']);
      for (const b of boxes) {
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.y).toBeGreaterThanOrEqual(0);
        expect(b.x + b.w).toBeLessThanOrEqual(1.001);
        expect(b.y + b.h).toBeLessThanOrEqual(1.001);
      }
    }
  });

  it('puts the top over the bottom and the shoes in the side column', () => {
    const boxes = computeLayout(outfit().items);
    const by = (s: string) => boxes.find((b) => b.slot === s)!;
    expect(by('base').y).toBeLessThan(by('bottom').y);
    expect(by('footwear').x).toBeGreaterThan(by('bottom').x + by('bottom').w);
  });

  it('uses the real photo proportions when the API reports them', () => {
    const o = outfit();
    const items = o.items.map((it) => (it.slot === 'bottom' && it.garment ? { ...it, garment: { ...it.garment, image: { id: 'i1', url: 'u', thumbUrl: 't', width: 300, height: 900, isCutout: true, license: 'user_owned' as const, attribution: null } } } : it));
    const jeans = computeLayout(items, 1).find((b) => b.slot === 'bottom')!;
    expect(jeans.w / jeans.h).toBeCloseTo(1 / 3, 2);
  });

  it('renders positioned items as percentages', async () => {
    const o = outfit();
    await render(<OutfitCanvas items={o.items} />);
    const style = StyleSheet.flatten(screen.getByTestId('outfit-canvas-item-bottom').props.style);
    expect(String(style.left)).toMatch(/%$/);
    expect(String(style.height)).toMatch(/%$/);
  });

  it('renders a colour silhouette for garments without image', async () => {
    const o = outfit();
    await render(<OutfitCanvas items={o.items} />);
    expect(screen.getByTestId('outfit-canvas-item-base-silhouette')).toBeOnTheScreen();
  });

  it('skips empty slots', () => {
    const boxes = computeLayout([{ slot: 'outer', garment: null, candidateProduct: null }, { slot: 'base', garment: garment(), candidateProduct: null }]);
    expect(boxes.map((b) => b.slot)).toEqual(['base']);
  });

  it('is announced as a single image listing the garments', async () => {
    const o = outfit();
    await render(<OutfitCanvas items={o.items} />);
    expect(screen.getByRole('image')).toHaveAccessibleName('Conjunto: Camisa Oxford, Vaquero, Zapatillas');
  });
});
