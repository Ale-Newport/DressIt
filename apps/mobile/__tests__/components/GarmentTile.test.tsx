import { fireEvent, render, screen } from '@testing-library/react-native';

import { describeGarment, GarmentTile } from '@/components/ui/GarmentTile';
import { silhouetteShapeFor } from '@/components/ui/GarmentSilhouette';

import { garment } from '../fixtures';

describe('GarmentTile', () => {
  it('renders a silhouette placeholder when the garment has no image', async () => {
    await render(<GarmentTile garment={garment()} />);
    expect(screen.getByTestId('garment-tile-g1-placeholder')).toBeOnTheScreen();
    expect(screen.queryByTestId('garment-tile-g1-image')).toBeNull();
  });

  it('renders the image when available', async () => {
    const g = garment({
      image: { id: 'img1', url: 'https://x/full', thumbUrl: 'https://x/thumb', width: 10, height: 10, isCutout: true, license: 'user_owned', attribution: null },
    });
    await render(<GarmentTile garment={g} />);
    expect(screen.getByTestId('garment-tile-g1-image')).toBeOnTheScreen();
    expect(screen.queryByTestId('garment-tile-g1-placeholder')).toBeNull();
  });

  it('picks a silhouette shape per category', () => {
    expect(silhouetteShapeFor('top', 'camisa')).toBe('shirt');
    expect(silhouetteShapeFor('bottom', 'falda')).toBe('skirt');
    expect(silhouetteShapeFor('footwear', 'botas')).toBe('boot');
    expect(silhouetteShapeFor('one_piece', 'vestido')).toBe('dress');
    expect(silhouetteShapeFor('accessory', 'bolso')).toBe('bag');
  });

  it('is an accessible button with a descriptive label', async () => {
    const onPress = jest.fn();
    await render(<GarmentTile garment={garment({ status: 'laundry', favorite: true })} onPress={onPress} />);
    const tile = screen.getByRole('button');
    expect(tile).toHaveAccessibleName('Camisa Oxford blanco de Marca, en la colada, favorita');
    await fireEvent.press(tile);
    expect(onPress).toHaveBeenCalled();
  });

  it('exposes checked state in selection mode', async () => {
    await render(<GarmentTile garment={garment()} selectionMode selected onPress={() => {}} />);
    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  it('describes demo-less available garments without status', () => {
    expect(describeGarment(garment({ brand: null, primaryColor: null }))).toBe('Camisa Oxford');
  });
});
