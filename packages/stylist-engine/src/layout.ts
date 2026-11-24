import { getSubcategory } from '@dressit/shared';
import type { OutfitCandidate, Slot } from './types.ts';

const round = (v: number) => Math.round(v * 1000) / 1000;

export interface LayoutBox {
  slot: Slot;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
}

/**
 * Flat-lay composition on a 3:4 canvas (normalised coordinates). Pieces are
 * placed by role (upper left → lower right) and scaled by visual weight.
 */
export function flatLayLayout(outfit: OutfitCandidate): LayoutBox[] {
  const has = (s: string) => outfit.items.some((i) => i.slot === s);
  const boxes: LayoutBox[] = [];
  const scaleOf = (slot: Slot) => {
    const g = outfit.items.find((i) => i.slot === slot)?.garment;
    return g ? (getSubcategory(g.subcategory)?.visualScale ?? 1) : 1;
  };
  const place = (slot: Slot, x: number, y: number, w: number, h: number, z: number) => {
    if (!has(slot)) return;
    const s = Math.min(1.15, Math.max(0.8, scaleOf(slot) / (slot === 'one_piece' ? 1.6 : slot === 'outer' ? 1.3 : 1)));
    const cw = Math.min(1, w * s);
    const ch = Math.min(1, h * s);
    const bx = Math.max(0, Math.min(1 - cw, x + (w - cw) / 2));
    const by = Math.max(0, Math.min(1 - ch, y + (h - ch) / 2));
    boxes.push({ slot, x: round(bx), y: round(by), w: round(cw), h: round(ch), z });
  };
  const outer = has('outer');
  const mid = has('mid');
  if (has('one_piece')) {
    place('outer', 0.02, 0.04, 0.42, 0.5, 1);
    place('one_piece', outer ? 0.36 : 0.26, 0.04, 0.46, 0.66, 2);
  } else {
    place('outer', 0.02, 0.03, 0.44, 0.5, 1);
    if (mid && has('base')) {
      place('base', outer ? 0.36 : 0.08, 0.03, 0.36, 0.34, 2);
      place('mid', outer ? 0.56 : 0.48, 0.12, 0.38, 0.36, 3);
    } else {
      place('base', outer ? 0.44 : 0.3, 0.04, 0.4, 0.38, 2);
      place('mid', outer ? 0.44 : 0.3, 0.04, 0.4, 0.38, 2);
    }
    place('bottom', outer ? 0.3 : 0.28, 0.42, 0.38, 0.5, 2);
  }
  place('footwear', 0.66, 0.72, 0.3, 0.22, 4);
  const accessories = outfit.items.filter((i) => i.slot.startsWith('accessory:'));
  accessories.forEach((a, idx) => {
    const y = 0.56 + idx * 0.13;
    boxes.push({ slot: a.slot, x: idx % 2 === 0 ? 0.04 : 0.14, y: Math.min(0.84, y), w: 0.2, h: 0.14, z: 5 + idx });
  });
  return boxes;
}
