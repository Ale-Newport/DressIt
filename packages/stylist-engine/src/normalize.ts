import {
  getMaterial,
  getSubcategory,
  hexToLab,
  nearestColorFamily,
  type Category,
  type Fit,
  type Season,
  type StyleId,
} from '@dressit/shared';
import type { EngineGarment } from './types.ts';

export interface RawGarment {
  id: string;
  name: string;
  category: Category;
  subcategory: string;
  colors: Array<{ hex: string; share?: number; family?: string }>;
  pattern?: string | null;
  materials?: string[];
  styles?: StyleId[];
  formality?: number | null;
  warmth?: number | null;
  waterproof?: boolean | null;
  fit?: Fit | null;
  seasons?: Season[];
  favorite?: boolean;
  wearCount?: number;
  lastWornOn?: string | null;
  createdAt?: string;
  embedding?: ArrayLike<number> | null;
  isCandidate?: boolean;
  /** Width ÷ height of the garment image (flat lay). */
  imageAspect?: number | null;
}

const WEARABLE_ALONE = new Set(['jersey', 'jersey_grueso', 'sudadera']);

/** Resolve defaults from the vocabulary and turn a stored garment into an engine garment. */
export function toEngineGarment(raw: RawGarment): EngineGarment {
  const sub = getSubcategory(raw.subcategory);
  const materials = raw.materials ?? [];
  const mats = materials.map((m) => getMaterial(m)).filter((m) => m !== undefined);
  const warmthDelta = mats.length ? mats.reduce((a, m) => a + m.warmth, 0) / mats.length : 0;
  const baseClo = sub?.clo ?? 0.2;
  const clo = raw.warmth ?? Math.max(0, baseClo * (1 + warmthDelta));
  const baseRange = sub?.tempRange ?? [5, 30];
  // Warmer materials shift the comfortable range down (≈ 8 °C per +1 warmth).
  const shift = -warmthDelta * 8;
  const tempRange: readonly [number, number] = [baseRange[0] + shift, baseRange[1] + shift];
  const breathability = Math.min(sub?.breathability ?? 0.6, mats.length ? mats.reduce((a, m) => a + m.breathability, 0) / mats.length + 0.15 : 1);
  const rainSensitivity = Math.max(sub?.rainSensitive ?? 0, ...mats.map((m) => m.rainSensitive * (sub?.layer === 'footwear' || sub?.layer === 'outer' ? 1 : 0.4)));
  const waterproof = raw.waterproof ?? ((sub?.waterproof ?? false) || mats.some((m) => m.waterproof));

  const styleVector: Partial<Record<StyleId, number>> = {};
  for (const [k, v] of Object.entries(sub?.styles ?? {}) as Array<[StyleId, number]>) styleVector[k] = v * 0.5;
  for (const s of raw.styles ?? []) styleVector[s] = Math.min(1, (styleVector[s] ?? 0) + 0.8);

  const colors = (raw.colors.length ? raw.colors : [{ hex: '#8c8c8c', share: 1 }]).map((c, _i, arr) => {
    const lab = hexToLab(c.hex);
    return { lab, family: c.family ?? nearestColorFamily(lab).family, share: c.share ?? 1 / arr.length };
  });

  return {
    id: raw.id,
    name: raw.name,
    category: raw.category,
    subcategory: raw.subcategory,
    layer: sub?.layer ?? (raw.category === 'bottom' ? 'bottom' : raw.category === 'footwear' ? 'footwear' : raw.category === 'outerwear' ? 'outer' : raw.category === 'one_piece' ? 'one_piece' : raw.category === 'accessory' ? 'accessory' : 'base'),
    ...(sub?.accessorySlot ? { accessorySlot: sub.accessorySlot } : {}),
    colors,
    pattern: raw.pattern ?? null,
    materials,
    styleVector,
    formality: raw.formality ?? sub?.formality ?? 40,
    clo,
    waterproof,
    breathability,
    rainSensitivity,
    fit: raw.fit ?? null,
    seasons: raw.seasons ?? [],
    tempRange,
    sport: sub?.sport ?? false,
    wearableAlone: WEARABLE_ALONE.has(raw.subcategory),
    favorite: raw.favorite ?? false,
    wearCount: raw.wearCount ?? 0,
    lastWornOn: raw.lastWornOn ?? null,
    createdAt: raw.createdAt ?? new Date(0).toISOString(),
    embedding: raw.embedding ?? null,
    ...(raw.isCandidate ? { isCandidate: true } : {}),
    ...(raw.imageAspect ? { imageAspect: raw.imageAspect } : {}),
  };
}
