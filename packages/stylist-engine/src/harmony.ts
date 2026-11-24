import {
  FIT_VOLUME,
  PATTERN_BUSYNESS,
  deltaE2000,
  getColorFamily,
  getMaterial,
  isNeutralFamily,
  labToLch,
  type Lab,
  type StyleId,
} from '@dressit/shared';
import type { EngineGarment, OutfitCandidate, Slot } from './types.ts';

/** Relative visual area of each slot in an outfit (drives color dominance). */
export const SLOT_AREA: Record<string, number> = {
  one_piece: 1.6,
  outer: 1.3,
  mid: 1.0,
  base: 1.0,
  bottom: 1.0,
  footwear: 0.35,
};
export const slotArea = (slot: Slot): number => SLOT_AREA[slot] ?? 0.2;

export type HarmonyKind = 'neutra' | 'monocromatica' | 'analoga' | 'complementaria' | 'triadica' | 'contraste' | 'choque';

export interface PairHarmony {
  score: number;
  kind: HarmonyKind;
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Fashion color theory uses the painter's RYB wheel (red↔green, blue↔orange,
 * yellow↔purple are complements). Map CIELAB LCh hue angles onto that wheel with
 * anchors measured from canonical sRGB primaries/secondaries.
 */
const RYB_ANCHORS: ReadonlyArray<readonly [number, number]> = [
  [40, 0], // red
  [62, 60], // orange
  [103, 120], // yellow
  [136, 180], // green
  [197, 210], // cyan / teal
  [306, 240], // blue
  [328, 290], // purple / magenta
  [400, 360], // red again (40 + 360)
];

export function rybHue(lchHue: number): number {
  let h = lchHue;
  if (h < 40) h += 360;
  for (let i = 0; i < RYB_ANCHORS.length - 1; i++) {
    const [x0, y0] = RYB_ANCHORS[i]!;
    const [x1, y1] = RYB_ANCHORS[i + 1]!;
    if (h >= x0 && h <= x1) return (y0 + ((h - x0) / (x1 - x0)) * (y1 - y0)) % 360;
  }
  return 0;
}

/** Harmony between two dominant colors. Neutrals (incl. navy, denim, camel) pair with anything. */
export function colorPairHarmony(a: { lab: Lab; family: string }, b: { lab: Lab; family: string }): PairHarmony {
  const na = isNeutralFamily(a.family);
  const nb = isNeutralFamily(b.family);
  const de = deltaE2000(a.lab, b.lab);
  if (na && nb) {
    // Neutral on neutral: fine; near-identical dark neutrals read as a mismatch ("negro con marino").
    const la = a.lab[0];
    const lb = b.lab[0];
    if (la < 30 && lb < 30 && de > 3 && de < 12) return { score: 0.62, kind: 'neutra' };
    return { score: 0.9, kind: 'neutra' };
  }
  if (na || nb) return { score: 0.88, kind: 'neutra' };
  const ca = labToLch(a.lab);
  const cb = labToLch(b.lab);
  const dh = hueDistance(rybHue(ca.h), rybHue(cb.h));
  const muted = Math.min(ca.C, cb.C) < 32;
  if (de < 6) return { score: 0.82, kind: 'monocromatica' };
  if (dh < 25) return { score: 0.84, kind: 'monocromatica' };
  if (dh < 60) return { score: 0.76, kind: 'analoga' };
  if (dh >= 150) return { score: muted ? 0.74 : 0.56, kind: 'complementaria' };
  if (dh >= 105 && dh <= 135) return { score: muted ? 0.62 : 0.5, kind: 'triadica' };
  return { score: muted ? 0.55 : 0.36, kind: 'choque' };
}

function dominant(g: EngineGarment): { lab: Lab; family: string } | null {
  if (g.colors.length === 0) return null;
  return g.colors.reduce((a, b) => (b.share > a.share ? b : a));
}

export interface ColorAssessment {
  score: number;
  kind: HarmonyKind;
  families: string[];
  chromaticFamilies: string[];
}

/** Outfit color harmony 0–1 (area-weighted pairwise harmony + palette discipline). */
export function colorScore(outfit: OutfitCandidate): ColorAssessment {
  const parts = outfit.items
    .map((i) => ({ slot: i.slot, area: slotArea(i.slot), color: dominant(i.garment) }))
    .filter((p): p is { slot: Slot; area: number; color: { lab: Lab; family: string } } => p.color !== null);
  if (parts.length < 2) return { score: 0.7, kind: 'neutra', families: parts.map((p) => p.color.family), chromaticFamilies: [] };

  let weighted = 0;
  let totalW = 0;
  const kindVotes = new Map<HarmonyKind, number>();
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      const w = parts[i]!.area * parts[j]!.area;
      const h = colorPairHarmony(parts[i]!.color, parts[j]!.color);
      weighted += h.score * w;
      totalW += w;
      kindVotes.set(h.kind, (kindVotes.get(h.kind) ?? 0) + w);
    }
  }
  let score = weighted / totalW;
  const families = [...new Set(parts.map((p) => p.color.family))];
  const chromatic = families.filter((f) => !isNeutralFamily(f));
  // Palette discipline: more than two chromatic families reads as busy.
  if (chromatic.length > 2) score -= 0.12 * (chromatic.length - 2);
  // A neutral anchor in at least half of the visual area helps.
  const neutralArea = parts.filter((p) => isNeutralFamily(p.color.family)).reduce((a, p) => a + p.area, 0);
  const totalArea = parts.reduce((a, p) => a + p.area, 0);
  if (neutralArea / totalArea >= 0.5) score += 0.04;
  // Metallic accessories don't count against the palette.
  const metallicOnly = families.every((f) => isNeutralFamily(f) || getColorFamily(f)?.metallic);
  if (metallicOnly && chromatic.length === 0) score = Math.max(score, 0.8);
  let kind: HarmonyKind = 'neutra';
  let best = -1;
  for (const [k, v] of kindVotes) {
    if (k === 'neutra') continue;
    if (v > best) {
      best = v;
      kind = k;
    }
  }
  if (chromatic.length === 0) kind = 'neutra';
  return { score: Math.max(0, Math.min(1, score)), kind, families, chromaticFamilies: chromatic };
}

/** Pattern mixing: one statement pattern is great; two busy ones compete. */
export function patternScore(outfit: OutfitCandidate): number {
  const busy = outfit.items
    .filter((i) => !i.slot.startsWith('accessory') && i.slot !== 'footwear')
    .map((i) => PATTERN_BUSYNESS[i.garment.pattern ?? 'liso'] ?? 0)
    .filter((b) => b > 0)
    .sort((a, b) => b - a);
  if (busy.length === 0) return 0.85;
  if (busy.length === 1) return 0.9;
  const second = busy[1]!;
  // Subtle second pattern (stripes/herringbone) is acceptable.
  return Math.max(0.15, 0.9 - second * 0.9 - (busy.length - 2) * 0.2);
}

export function styleVectorOf(g: EngineGarment): Map<StyleId, number> {
  return new Map(Object.entries(g.styleVector) as Array<[StyleId, number]>);
}

export function cosine(a: Partial<Record<string, number>>, b: Partial<Record<string, number>>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [k, v] of Object.entries(a)) {
    na += (v ?? 0) ** 2;
    const bv = b[k];
    if (bv !== undefined) dot += (v ?? 0) * bv;
  }
  for (const v of Object.values(b)) nb += (v ?? 0) ** 2;
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

/** Area-weighted style vector of the outfit (accessories count less). */
export function outfitStyleVector(outfit: OutfitCandidate): Partial<Record<StyleId, number>> {
  const acc: Partial<Record<StyleId, number>> = {};
  for (const { slot, garment } of outfit.items) {
    const w = slotArea(slot);
    for (const [k, v] of Object.entries(garment.styleVector) as Array<[StyleId, number]>) acc[k] = (acc[k] ?? 0) + v * w;
  }
  return acc;
}

export function dominantStyle(vec: Partial<Record<StyleId, number>>): StyleId | null {
  let best: StyleId | null = null;
  let bv = 0;
  for (const [k, v] of Object.entries(vec) as Array<[StyleId, number]>) {
    if (v > bv) {
      bv = v;
      best = k;
    }
  }
  return best;
}

/**
 * Style coherence 0–1: mean pairwise cosine between the main pieces.
 * Deliberate "smart casual" mixes (tailoring + denim/sneakers) are softened.
 */
export function styleCoherence(outfit: OutfitCandidate): number {
  const main = outfit.items.filter((i) => !i.slot.startsWith('accessory'));
  if (main.length < 2) return 0.75;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < main.length; i++) {
    for (let j = i + 1; j < main.length; j++) {
      sum += cosine(main[i]!.garment.styleVector, main[j]!.garment.styleVector);
      n++;
    }
  }
  const mean = sum / n;
  // Sport pieces mixed with tailoring are the classic incoherence.
  const hasSport = main.some((i) => (i.garment.styleVector.deportivo ?? 0) >= 0.8 && i.garment.sport);
  const hasTailoring = main.some((i) => (i.garment.styleVector.formal ?? 0) >= 0.8);
  const penalty = hasSport && hasTailoring ? 0.25 : 0;
  return Math.max(0, Math.min(1, 0.35 + 0.75 * mean - penalty));
}

/** Area-weighted mean formality of the outfit (0–100). */
export function outfitFormality(outfit: OutfitCandidate): number {
  let s = 0;
  let w = 0;
  for (const { slot, garment } of outfit.items) {
    const a = slotArea(slot);
    s += garment.formality * a;
    w += a;
  }
  return w ? s / w : 50;
}

export function formalityScore(outfit: OutfitCandidate, window: readonly [number, number], shift: number): number {
  const lo = window[0] + shift;
  const hi = window[1] + shift;
  const f = outfitFormality(outfit);
  const dist = f < lo ? lo - f : f > hi ? f - hi : 0;
  let score = Math.exp(-(dist * dist) / (2 * 12 * 12));
  // Spread: an outfit pulling in opposite directions (gym shorts + oxford shoes).
  const main = outfit.items.filter((i) => !i.slot.startsWith('accessory')).map((i) => i.garment.formality);
  const spread = Math.max(...main) - Math.min(...main);
  if (spread > 55) score *= 1 - Math.min(0.5, (spread - 55) / 60);
  return score;
}

/** Material compatibility: seasonality, sheen vs. technical fabrics, double denim. */
export function materialScore(outfit: OutfitCandidate, season: string): number {
  let score = 0.85;
  const mats = outfit.items.flatMap((i) => i.garment.materials);
  for (const m of mats) {
    const def = getMaterial(m);
    if (def && !def.seasons.includes(season as never)) score -= 0.08;
  }
  const hasSheen = mats.some((m) => getMaterial(m)?.sheen);
  const hasTechnical = mats.some((m) => m === 'tecnico' || m === 'nailon');
  if (hasSheen && hasTechnical) score -= 0.25;
  // Double denim needs contrast between the two washes.
  const denims = outfit.items.filter((i) => i.garment.materials.includes('denim') || i.garment.colors.some((c) => c.family === 'denim'));
  if (denims.length >= 2) {
    const [a, b] = denims;
    const ca = dominant(a!.garment);
    const cb = dominant(b!.garment);
    if (ca && cb && deltaE2000(ca.lab, cb.lab) < 10) score -= 0.3;
  }
  return Math.max(0, Math.min(1, score));
}

/** Proportion balance between upper and lower volume. */
export function silhouetteScore(outfit: OutfitCandidate): number {
  const upper = outfit.items.filter((i) => i.slot === 'base' || i.slot === 'mid' || i.slot === 'outer');
  const lower = outfit.items.find((i) => i.slot === 'bottom');
  if (!lower || upper.length === 0) return 0.75;
  const upFit = upper.map((i) => i.garment.fit).find((f) => f !== null);
  const lowFit = lower.garment.fit;
  if (!upFit || !lowFit) return 0.72;
  const u = FIT_VOLUME[upFit];
  const l = FIT_VOLUME[lowFit];
  if (u >= 0.7 && l >= 0.7) return 0.45; // volume on volume
  if (Math.abs(u - l) >= 0.3) return 0.95; // contrast: oversize + slim or fitted + wide
  return 0.8;
}
