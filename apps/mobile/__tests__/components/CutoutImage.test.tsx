import { render, screen } from '@testing-library/react-native';

import { CutoutImage } from '@/components/ui/CutoutImage';

const img = { id: 'i1', url: 'https://x/full.png', thumbUrl: 'https://x/thumb.webp', isCutout: true };

describe('CutoutImage', () => {
  it('labels AI-generated pictures visibly (EU AI Act art. 50)', async () => {
    await render(<CutoutImage image={{ ...img, generatedBy: 'Qwen-Image-Edit-2511' }} testID="pic" />);
    expect(screen.getByLabelText('Imagen generada con IA')).toBeOnTheScreen();
    expect(screen.getByText('Generada con IA')).toBeOnTheScreen();
  });

  it('shows no label on the user’s own photos', async () => {
    await render(<CutoutImage image={img} testID="pic" />);
    expect(screen.queryByText('Generada con IA')).toBeNull();
  });

  it('can hide the label where the screen already says it (comparisons)', async () => {
    await render(<CutoutImage image={{ ...img, generatedBy: 'x' }} aiLabel={false} />);
    expect(screen.queryByText('Generada con IA')).toBeNull();
  });
});
