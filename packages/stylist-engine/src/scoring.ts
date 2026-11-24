import type { StyleId } from '@dressit/shared';
import {
  colorScore,
  cosine,
  dominantStyle,
  formalityScore,
  materialScore,
  outfitFormality,
  outfitStyleVector,
  patternScore,
  silhouetteScore,
  styleCoherence,
} from './harmony.ts';
import { assessThermal, weatherScore } from './thermal.ts';
import {
  FEATURES,
  type EngineContext,
  type EngineGarment,
  type EngineHistory,
  type EngineProfile,
  type FeatureName,
  type FeatureVector,
  type OutfitCandidate,
  type ThermalAssessment,
} from './types.ts';

/** Default ranking weights before any personal feedback. */
export const DEFAULT_WEIGHTS: FeatureVector = {
  color: 1.4,
  pattern: 0.6,
  style: 1.0,
  formality: 1.2,
  occasionStyle: 0.8,
  weather: 1.6,
  material: 0.5,
  silhouette: 0.5,
  personal: 1.0,
  affinity: 0.8,
  rotation: 0.6,
  visual: 0.3,
};

export const MIN_WEIGHT = 0.05;

export function effectiveWeights(profile: EngineProfile): FeatureVector {
  const w = { ...DEFAULT_WEIGHTS };
  for (const f of FEATURES) {
    const learned = profile.learned.weights[f];
    if (learned !== undefined && Number.isFinite(learned)) w[f] = Math.max(MIN_WEIGHT, learned);
  }
  // Explicit priorities nudge the weights (comfort → weather/rotation, elegance → color/formality/style).
  const p = profile.priorities;
  w.weather *= 0.8 + 0.6 * p.comfort;
  w.color *= 0.85 + 0.45 * p.elegance;
  w.formality *= 0.85 + 0.45 * p.elegance;
  w.material *= 0.85 + 0.45 * p.practicality;
  return w;
}

export function signatureOf(outfit: OutfitCandidate): string {
  return outfit.items
    .map((i) => i.garment.id)
    .sort()
    .join('+');
}

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

/** Days since the garment was last worn before `date` (∞ if never). */
export function daysSinceWorn(g: EngineGarment, history: EngineHistory, date: string): number {
  let last: string | null = g.lastWornOn && g.lastWornOn < date ? g.lastWornOn : null;
  for (const w of history.recentWear) {
    if (w.date < date && w.garmentIds.includes(g.id) && (!last || w.date > last)) last = w.date;
  }
  return last ? daysBetween(last, date) : Number.POSITIVE_INFINITY;
}

function rotationScore(outfit: OutfitCandidate, ctx: EngineContext, history: EngineHistory): number {
  const main = outfit.items.filter((i) => !i.slot.startsWith('accessory') && !i.garment.isCandidate);
  if (main.length === 0) return 0.8;
  const per = main.map(({ garment, slot }) => {
    const d = daysSinceWorn(garment, history, ctx.date);
    // Footwear and outerwear are naturally repeated more often.
    const tolerant = slot === 'footwear' || slot === 'outer';
    if (d <= 1) return tolerant ? 0.6 : 0.15;
    if (d <= 3) return tolerant ? 0.85 : 0.5;
    if (d <= 6) return 0.8;
    return 1;
  });
  let score = per.reduce((a, b) => a + b, 0) / per.length;
  // Exact same core combination worn in the last 14 days.
  const ids = new Set(main.map((i) => i.garment.id));
  for (const w of history.recentWear) {
    const age = daysBetween(w.date, ctx.date);
    if (age > 0 && age <= 14 && w.garmentIds.length > 0 && [...ids].every((id) => w.garmentIds.includes(id))) score *= 0.5;
  }
  return score;
}

function personalScore(outfit: OutfitCandidate, profile: EngineProfile): number {
  const vec = outfitStyleVector(outfit);
  const pref: Partial<Record<StyleId, number>> = {};
  for (const s of profile.preferredStyles) pref[s] = (pref[s] ?? 0) + 1;
  for (const [s, v] of Object.entries(profile.learned.styleWeights) as Array<[StyleId, number]>) pref[s] = (pref[s] ?? 0) + v;
  const hasPref = Object.values(pref).some((v) => (v ?? 0) > 0);
  let score = hasPref ? 0.3 + 0.7 * Math.max(0, cosine(vec, pref)) : 0.6;

  const families = outfit.items.flatMap((i) => i.garment.colors.filter((c) => c.share >= 0.25).map((c) => c.family));
  if (families.some((f) => profile.avoidedColors.includes(f))) score -= 0.35;
  if (families.some((f) => profile.favoriteColors.includes(f))) score += 0.08;
  for (const f of new Set(families)) score += 0.05 * Math.tanh(profile.learned.colorWeights[f] ?? 0);

  const top = outfit.items.find((i) => i.slot === 'base' || i.slot === 'mid');
  const bottom = outfit.items.find((i) => i.slot === 'bottom');
  if (profile.fitPreferences.top && top?.garment.fit) score += top.garment.fit === profile.fitPreferences.top ? 0.04 : -0.03;
  if (profile.fitPreferences.bottom && bottom?.garment.fit) score += bottom.garment.fit === profile.fitPreferences.bottom ? 0.04 : -0.03;
  return Math.max(0, Math.min(1, score));
}

function affinityScore(outfit: OutfitCandidate, profile: EngineProfile): number {
  const ids = outfit.items.map((i) => i.garment.id);
  let item = 0;
  for (const id of ids) item += profile.learned.itemAffinity[id] ?? 0;
  item /= ids.length;
  let pair = 0;
  let n = 0;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      pair += profile.learned.pairAffinity[pairKey(ids[i]!, ids[j]!)] ?? 0;
      n++;
    }
  }
  pair = n ? pair / n : 0;
  return 0.5 + 0.5 * Math.tanh(1.2 * item + 1.8 * pair);
}

function occasionStyleScore(outfit: OutfitCandidate, ctx: EngineContext): number {
  const vec = outfitStyleVector(outfit);
  const total = Object.values(vec).reduce((a, b) => a + (b ?? 0), 0) || 1;
  let prefer = 0;
  let avoid = 0;
  for (const s of ctx.occasion.preferStyles) prefer += vec[s] ?? 0;
  for (const s of ctx.occasion.avoidStyles) avoid += vec[s] ?? 0;
  let score = 0.45 + 0.9 * (prefer / total) - 1.1 * (avoid / total);
  if (ctx.adjustments.elegance) score += 0.25 * (((vec.elegante ?? 0) + (vec.clasico ?? 0)) / total) - 0.1;
  if (ctx.occasion.sport) {
    const main = outfit.items.filter((i) => !i.slot.startsWith('accessory'));
    const sportShare = main.filter((i) => i.garment.sport).length / Math.max(1, main.length);
    score = 0.3 * score + 0.7 * sportShare;
  }
  if (ctx.occasion.avoidColors?.length) {
    const big = outfit.items.filter((i) => ['base', 'mid', 'outer', 'one_piece', 'bottom'].includes(i.slot));
    if (big.some((i) => i.garment.colors.some((c) => c.share >= 0.5 && ctx.occasion.avoidColors!.includes(c.family)))) score -= 0.6;
  }
  return Math.max(0, Math.min(1, score));
}

function visualScore(outfit: OutfitCandidate, profile: EngineProfile): number {
  const centroid = profile.learned.likedCentroid;
  if (!centroid || centroid.length === 0) return 0.5;
  const embs = outfit.items.map((i) => i.garment.embedding).filter((e): e is ArrayLike<number> => !!e && e.length === centroid.length);
  if (embs.length === 0) return 0.5;
  let sim = 0;
  for (const e of embs) {
    let dot = 0;
    let ne = 0;
    let nc = 0;
    for (let k = 0; k < centroid.length; k++) {
      dot += e[k]! * centroid[k]!;
      ne += e[k]! ** 2;
      nc += centroid[k]! ** 2;
    }
    sim += ne && nc ? dot / Math.sqrt(ne * nc) : 0;
  }
  // SigLIP image-image cosine for related garments sits roughly in [0.3, 0.9].
  return Math.max(0, Math.min(1, (sim / embs.length - 0.3) / 0.6));
}

export interface FeatureComputation {
  features: FeatureVector;
  thermal: ThermalAssessment | null;
  colorKind: string;
  chromaticFamilies: string[];
  formality: number;
}

export function computeFeatures(
  outfit: OutfitCandidate,
  ctx: EngineContext,
  profile: EngineProfile,
  history: EngineHistory,
): FeatureComputation {
  const thermal = assessThermal(outfit, ctx);
  const color = colorScore(outfit);
  const shift = ctx.adjustments.formality * 18 + ctx.adjustments.elegance * 10;
  const features: FeatureVector = {
    color: color.score,
    pattern: patternScore(outfit),
    style: styleCoherence(outfit),
    formality: formalityScore(outfit, ctx.occasion.formality, shift),
    occasionStyle: occasionStyleScore(outfit, ctx),
    weather: weatherScore(outfit, ctx, thermal),
    material: materialScore(outfit, ctx.season),
    silhouette: silhouetteScore(outfit),
    personal: personalScore(outfit, profile),
    affinity: affinityScore(outfit, profile),
    rotation: rotationScore(outfit, ctx, history),
    visual: visualScore(outfit, profile),
  };
  return { features, thermal, colorKind: color.kind, chromaticFamilies: color.chromaticFamilies, formality: outfitFormality(outfit) };
}

export function scoreFeatures(features: FeatureVector, weights: FeatureVector): { score: number; contributions: FeatureVector } {
  let s = 0;
  let wsum = 0;
  const contributions = {} as FeatureVector;
  for (const f of FEATURES) {
    const w = weights[f];
    s += w * features[f];
    wsum += w;
    contributions[f] = w * (features[f] - 0.5);
  }
  // Hard-ish gates: a terrible weather or formality fit should sink the outfit regardless of other features.
  let score = s / wsum;
  if (features.weather < 0.25) score *= 0.6 + features.weather;
  if (features.formality < 0.2) score *= 0.7 + features.formality;
  return { score, contributions };
}

export function styleMatchOf(outfit: OutfitCandidate, profile: EngineProfile): number {
  return personalScore(outfit, profile);
}

export { dominantStyle, outfitStyleVector };
export type { FeatureName };
