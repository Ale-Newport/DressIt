import { composeFlatLay } from '@dressit/shared';
import type { OutfitCandidate, Slot } from './types.ts';

export interface LayoutBox {
  slot: Slot;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
}

/**
 * Stored flat-lay composition (normalised coordinates on a 4:5 canvas, the app's default).
 * Delegates to the shared composer, which the app also runs live with the real canvas size.
 */
export function flatLayLayout(outfit: OutfitCandidate, canvasAspect = 0.8): LayoutBox[] {
  const boxes = composeFlatLay(
    outfit.items.map((i) => ({
      key: i.slot,
      slot: i.slot,
      category: i.garment.category,
      subcategory: i.garment.subcategory,
      aspect: i.garment.imageAspect ?? null,
    })),
    { canvasAspect },
  );
  return boxes.map(({ key, x, y, w, h, z }) => ({ slot: key as Slot, x, y, w, h, z }));
}
