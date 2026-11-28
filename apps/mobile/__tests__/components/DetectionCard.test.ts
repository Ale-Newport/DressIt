import type { DetectionDto } from '@dressit/shared';

import { draftFromDetection } from '@/components/capture/DetectionCard';

const detection = (predicted: DetectionDto['predicted']): DetectionDto => ({
  id: 'd1',
  imageId: 'i1',
  cutout: null,
  bbox: null,
  state: 'pending',
  garmentId: null,
  predicted,
  duplicate: null,
  warnings: [],
});

describe('draftFromDetection', () => {
  it('proposes the vision-language model’s name, as Alta does («Sudadera con capucha roja»)', () => {
    const d = detection({
      category: { value: 'top', confidence: 0.9 },
      subcategory: { value: 'sudadera', confidence: 0.9 },
      vlm: { name: 'Red Hooded Sweatshirt', nameEs: 'sudadera con capucha roja', description: 'red hoodie', visible: 'partial' },
    });
    expect(draftFromDetection(d)).toMatchObject({ name: 'Sudadera con capucha roja', category: 'top', subcategory: 'sudadera' });
    // The user's own edit wins.
    expect(draftFromDetection(d, { name: 'Mi sudadera' }).name).toBe('Mi sudadera');
  });
  it('without a model name, no name is proposed (the type label is shown instead)', () => {
    expect(draftFromDetection(detection({ subcategory: { value: 'camiseta', confidence: 0.8 } })).name).toBeUndefined();
  });
});
