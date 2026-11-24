import type { GarmentDto } from '@dressit/shared';

/** Manual outfit rule: a one-piece, or a top (base or mid layer) plus a bottom; footwear is recommended. */
export function validateBuilder(picks: Partial<Record<string, GarmentDto>>): { ok: boolean; error: 'needBase' | 'onePieceConflict' | null; warnFootwear: boolean } {
  const hasOne = !!picks.one_piece;
  const hasTop = !!picks.base || !!picks.mid;
  const hasBottom = !!picks.bottom;
  if (hasOne && hasBottom) return { ok: false, error: 'onePieceConflict', warnFootwear: !picks.footwear };
  if (!hasOne && !(hasTop && hasBottom)) return { ok: false, error: 'needBase', warnFootwear: !picks.footwear };
  return { ok: true, error: null, warnFootwear: !picks.footwear };
}
