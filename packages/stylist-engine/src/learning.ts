import type { StyleId } from '@dressit/shared';
import { outfitStyleVector } from './harmony.ts';
import { DEFAULT_WEIGHTS, MIN_WEIGHT, pairKey } from './scoring.ts';
import { FEATURES, type FeatureVector, type LearnedModel, type OutfitCandidate } from './types.ts';

export function emptyModel(): LearnedModel {
  return { weights: {}, bias: 0, styleWeights: {}, colorWeights: {}, itemAffinity: {}, pairAffinity: {}, feedbackCount: 0, likedCentroid: null };
}

export type FeedbackSignal =
  | { kind: 'accept' }
  | { kind: 'reject' }
  | { kind: 'save' }
  | { kind: 'wear' }
  | { kind: 'rate'; rating: number }
  | { kind: 'swap'; removedId: string; addedId: string };

const LABEL: Record<string, { y: number; weight: number }> = {
  accept: { y: 1, weight: 1 },
  wear: { y: 1, weight: 1.5 },
  save: { y: 1, weight: 0.8 },
  reject: { y: 0, weight: 1 },
};

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export interface LearningConfig {
  learningRate: number;
  /** L2 pull back towards the default weights (keeps the model stable). */
  l2: number;
  itemRate: number;
  pairRate: number;
  styleRate: number;
  maxPairs: number;
}

export const DEFAULT_LEARNING: LearningConfig = { learningRate: 0.35, l2: 0.02, itemRate: 0.25, pairRate: 0.3, styleRate: 0.08, maxPairs: 600 };

/**
 * Online update of the personal ranking model from one feedback event.
 *
 * - Feature weights: logistic regression on centred features (x − 0.5) by SGD,
 *   so the weights the ranker uses are the coefficients of P(like | outfit).
 * - Item / pair affinities: bounded running scores (−1…1).
 * - Style and color affinities: nudged by the outfit's style vector / colors.
 *
 * Pure function: returns a new model; deterministic.
 */
export function applyFeedback(
  model: LearnedModel,
  outfit: OutfitCandidate,
  features: FeatureVector | null,
  signal: FeedbackSignal,
  cfg: LearningConfig = DEFAULT_LEARNING,
): LearnedModel {
  const next: LearnedModel = {
    weights: { ...model.weights },
    bias: model.bias,
    styleWeights: { ...model.styleWeights },
    colorWeights: { ...model.colorWeights },
    itemAffinity: { ...model.itemAffinity },
    pairAffinity: { ...model.pairAffinity },
    feedbackCount: model.feedbackCount + 1,
    likedCentroid: model.likedCentroid ?? null,
  };

  if (signal.kind === 'swap') {
    next.itemAffinity[signal.removedId] = clamp((next.itemAffinity[signal.removedId] ?? 0) - cfg.itemRate, -1, 1);
    next.itemAffinity[signal.addedId] = clamp((next.itemAffinity[signal.addedId] ?? 0) + cfg.itemRate, -1, 1);
    // Pair affinity between the added item and the rest of the outfit.
    for (const { garment } of outfit.items) {
      if (garment.id === signal.addedId || garment.id === signal.removedId) continue;
      const k = pairKey(signal.addedId, garment.id);
      next.pairAffinity[k] = clamp((next.pairAffinity[k] ?? 0) + cfg.pairRate * 0.5, -1, 1);
    }
    trimPairs(next, cfg.maxPairs);
    return next;
  }

  const { y, weight } = signal.kind === 'rate' ? { y: clamp((signal.rating - 1) / 4, 0, 1), weight: 1 } : LABEL[signal.kind]!;
  const target = (y - 0.5) * 2; // −1 … 1

  if (features) {
    let z = next.bias;
    for (const f of FEATURES) z += (next.weights[f] ?? DEFAULT_WEIGHTS[f]) * (features[f] - 0.5) * 4;
    const p = sigmoid(z);
    const err = y - p;
    for (const f of FEATURES) {
      const w0 = DEFAULT_WEIGHTS[f];
      const w = next.weights[f] ?? w0;
      const grad = err * (features[f] - 0.5) * 4;
      next.weights[f] = Math.max(MIN_WEIGHT, w + cfg.learningRate * weight * grad - cfg.learningRate * cfg.l2 * (w - w0));
    }
    next.bias = next.bias + cfg.learningRate * weight * err * 0.25;
  }

  const ids = outfit.items.map((i) => i.garment.id);
  for (const id of ids) next.itemAffinity[id] = clamp((next.itemAffinity[id] ?? 0) + cfg.itemRate * weight * target * 0.5, -1, 1);
  const core = outfit.items.filter((i) => !i.slot.startsWith('accessory')).map((i) => i.garment.id);
  for (let i = 0; i < core.length; i++) {
    for (let j = i + 1; j < core.length; j++) {
      const k = pairKey(core[i]!, core[j]!);
      next.pairAffinity[k] = clamp((next.pairAffinity[k] ?? 0) + cfg.pairRate * weight * target, -1, 1);
    }
  }
  const vec = outfitStyleVector(outfit);
  const total = Object.values(vec).reduce((a, b) => a + (b ?? 0), 0) || 1;
  for (const [s, v] of Object.entries(vec) as Array<[StyleId, number]>) {
    next.styleWeights[s] = clamp((next.styleWeights[s] ?? 0) + cfg.styleRate * weight * target * (v / total) * 3, -1, 1);
  }
  const fams = new Set(outfit.items.flatMap((i) => i.garment.colors.filter((c) => c.share >= 0.3).map((c) => c.family)));
  for (const fam of fams) next.colorWeights[fam] = clamp((next.colorWeights[fam] ?? 0) + cfg.styleRate * weight * target, -1, 1);
  trimPairs(next, cfg.maxPairs);
  return next;
}

function trimPairs(model: LearnedModel, max: number) {
  const entries = Object.entries(model.pairAffinity);
  if (entries.length <= max) return;
  entries.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  model.pairAffinity = Object.fromEntries(entries.slice(0, max));
}

/** Probability that the user likes an outfit with these features under the current model. */
export function predictLike(model: LearnedModel, features: FeatureVector): number {
  let z = model.bias;
  for (const f of FEATURES) z += (model.weights[f] ?? DEFAULT_WEIGHTS[f]) * (features[f] - 0.5) * 4;
  return sigmoid(z);
}
