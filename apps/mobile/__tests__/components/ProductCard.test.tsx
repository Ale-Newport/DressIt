import { render, screen } from '@testing-library/react-native';

import { priceFreshness, ProductCard } from '@/components/ui/ProductCard';

import { product } from '../fixtures';

const NOW = new Date('2026-11-24T11:00:00Z').getTime();

describe('ProductCard', () => {
  it('always shows the store and the price', async () => {
    await render(<ProductCard product={product()} now={NOW} />);
    expect(screen.getByTestId('product-card-store')).toHaveTextContent(/Tienda Ejemplo/);
    expect(screen.getByTestId('product-card-price')).toHaveTextContent(/59,95/);
  });

  it('shows "verificado hace X" for fresh verified prices', async () => {
    await render(<ProductCard product={product()} now={NOW} />);
    expect(screen.getByTestId('product-card-verified')).toHaveTextContent('verificado hace 3 h');
    expect(screen.queryByTestId('product-card-unverified')).toBeNull();
  });

  it('never presents stale data as current', async () => {
    await render(<ProductCard product={product({ isStale: true, verifiedAt: '2026-11-10T11:00:00Z' })} now={NOW} />);
    expect(screen.queryByTestId('product-card-verified')).toBeNull();
    expect(screen.getByTestId('product-card-unverified')).toHaveTextContent(/precio no verificado/);
    expect(screen.getByTestId('product-card-unverified')).toHaveTextContent(/hace 14 días/);
  });

  it('shows "precio no verificado" when it was never verified', async () => {
    await render(<ProductCard product={product({ verifiedAt: null })} now={NOW} />);
    expect(screen.getByTestId('product-card-unverified')).toHaveTextContent('precio no verificado');
  });

  it('flags sponsored and affiliate products', async () => {
    await render(<ProductCard product={product({ isSponsored: true, isAffiliate: true })} now={NOW} />);
    expect(screen.getByTestId('product-card-sponsored')).toBeOnTheScreen();
    expect(screen.getByTestId('product-card-affiliate')).toBeOnTheScreen();
  });

  it('does not show sponsored/affiliate badges for organic results', async () => {
    await render(<ProductCard product={product()} now={NOW} />);
    expect(screen.queryByTestId('product-card-sponsored')).toBeNull();
    expect(screen.queryByTestId('product-card-affiliate')).toBeNull();
  });

  it('exposes an accessible summary including freshness and disclosure', async () => {
    const onPress = jest.fn();
    await render(<ProductCard product={product({ isSponsored: true })} onPress={onPress} now={NOW} />);
    const card = screen.getByRole('button');
    expect(card).toHaveAccessibleName(/Chaqueta beige.*Tienda Ejemplo.*verificado hace 3 h.*Patrocinado/);
  });

  it('priceFreshness handles missing timestamps', () => {
    expect(priceFreshness({ verifiedAt: null, isStale: false }, NOW)).toEqual({ verified: false, label: 'precio no verificado' });
  });
});
