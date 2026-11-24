import { render, screen } from '@testing-library/react-native';

import { computeLayout, OutfitCanvas } from '@/components/ui/OutfitCanvas';

import { garment, outfit } from '../fixtures';

describe('OutfitCanvas', () => {
  it('positions items with the server layout (normalised → %)', async () => {
    const o = outfit();
    await render(<OutfitCanvas items={o.items} layout={o.layout} />);
    expect(screen.getByTestId('outfit-canvas-item-base')).toHaveStyle({ left: '10%', top: '5%', width: '40%', height: '40%', zIndex: 2 });
    expect(screen.getByTestId('outfit-canvas-item-bottom')).toHaveStyle({ left: '50%', top: '10%', width: '35%', height: '55%' });
  });

  it('falls back to a client layout for slots without a server box', () => {
    const o = outfit();
    const boxes = computeLayout(o.items, o.layout);
    const shoes = boxes.find((b) => b.slot === 'footwear');
    expect(shoes).toBeDefined();
    expect(shoes!.x).toBeGreaterThan(0);
    expect(shoes!.y).toBeGreaterThan(0.5);
  });

  it('orders boxes by z so upper layers render last', () => {
    const o = outfit();
    const boxes = computeLayout(o.items, o.layout);
    const zs = boxes.map((b) => b.z);
    expect([...zs].sort((a, b) => a - b)).toEqual(zs);
  });

  it('renders a colour silhouette for garments without image', async () => {
    const o = outfit();
    await render(<OutfitCanvas items={o.items} layout={o.layout} />);
    expect(screen.getByTestId('outfit-canvas-item-base-silhouette')).toBeOnTheScreen();
  });

  it('skips empty slots', () => {
    const boxes = computeLayout([{ slot: 'outer', garment: null, candidateProduct: null }, { slot: 'base', garment: garment(), candidateProduct: null }], []);
    expect(boxes.map((b) => b.slot)).toEqual(['base']);
  });

  it('is announced as a single image listing the garments', async () => {
    const o = outfit();
    await render(<OutfitCanvas items={o.items} layout={o.layout} />);
    expect(screen.getByRole('image')).toHaveAccessibleName('Conjunto: Camisa Oxford, Vaquero, Zapatillas');
  });
});
