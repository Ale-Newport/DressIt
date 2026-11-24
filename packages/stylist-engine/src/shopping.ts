import { deltaE2000, getColorFamily, getSubcategory, hexToLab, type Season } from '@dressit/shared';
import { generateOutfits } from './generate.ts';
import { cosine } from './harmony.ts';
import { toEngineGarment } from './normalize.ts';
import type { EngineContext, EngineGarment, EngineHistory, EngineProfile, ScoredOutfit } from './types.ts';

/** Minimum outfit score considered "wearable and good". */
export const GOOD_OUTFIT = 0.62;

export interface CandidateEvaluation {
  newOutfits: number;
  outfits: ScoredOutfit[];
  avgScore: number;
  partners: EngineGarment[];
  baseline: { outfitCount: number; avgScore: number };
}

/**
 * Marginal utility of adding a candidate garment to the wardrobe: how many good,
 * distinct outfits it enables across the user's typical contexts.
 */
export function evaluateCandidate(
  wardrobe: EngineGarment[],
  candidate: EngineGarment,
  contexts: EngineContext[],
  profile: EngineProfile,
  history: EngineHistory,
  opts: { perContext?: number; seed?: number } = {},
): CandidateEvaluation {
  const perContext = opts.perContext ?? 8;
  const seen = new Set<string>();
  const good: ScoredOutfit[] = [];
  let baselineCount = 0;
  let baselineSum = 0;
  const baselineSeen = new Set<string>();
  for (const ctx of contexts) {
    const withCandidate = generateOutfits(
      [...wardrobe, candidate],
      { ...ctx, mustInclude: [candidate.id] },
      profile,
      history,
      { count: perContext, seed: opts.seed ?? 7, explorationRate: 0, diversityLambda: 0.6 },
    );
    for (const o of withCandidate.outfits) {
      if (o.score >= GOOD_OUTFIT && o.items.some((i) => i.garment.id === candidate.id) && !seen.has(o.signature)) {
        seen.add(o.signature);
        good.push(o);
      }
    }
    const base = generateOutfits(wardrobe, ctx, profile, history, { count: perContext, seed: opts.seed ?? 7, explorationRate: 0, diversityLambda: 0.6 });
    for (const o of base.outfits) {
      if (o.score >= GOOD_OUTFIT && !baselineSeen.has(o.signature)) {
        baselineSeen.add(o.signature);
        baselineCount++;
        baselineSum += o.score;
      }
    }
  }
  good.sort((a, b) => b.score - a.score);
  const partnerIds = new Set<string>();
  for (const o of good) for (const i of o.items) if (i.garment.id !== candidate.id && !i.slot.startsWith('accessory')) partnerIds.add(i.garment.id);
  return {
    newOutfits: good.length,
    outfits: good,
    avgScore: good.length ? good.reduce((a, o) => a + o.score, 0) / good.length : 0,
    partners: wardrobe.filter((g) => partnerIds.has(g.id)),
    baseline: { outfitCount: baselineCount, avgScore: baselineCount ? baselineSum / baselineCount : 0 },
  };
}

export interface SimilarOwned {
  garment: EngineGarment;
  similarity: number;
  reason: string;
}

/** How redundant a candidate is with what the user already owns (0 = new, 1 = duplicate). */
export function findSimilarOwned(wardrobe: EngineGarment[], candidate: EngineGarment, limit = 5): SimilarOwned[] {
  const results: SimilarOwned[] = [];
  const cdom = candidate.colors[0];
  const csub = getSubcategory(candidate.subcategory);
  for (const g of wardrobe) {
    if (g.category !== candidate.category) continue;
    const gsub = getSubcategory(g.subcategory);
    const sameSub = g.subcategory === candidate.subcategory;
    const sameLayerFamily = gsub?.layer === csub?.layer;
    if (!sameSub && !sameLayerFamily) continue;
    const gdom = g.colors[0];
    const de = cdom && gdom ? deltaE2000(cdom.lab, gdom.lab) : 30;
    const colorSim = Math.exp(-(de * de) / (2 * 9 * 9));
    const patternSim = (g.pattern ?? 'liso') === (candidate.pattern ?? 'liso') ? 1 : 0.4;
    const styleSim = Math.max(0, cosine(g.styleVector, candidate.styleVector));
    let visual = 0.5;
    if (g.embedding && candidate.embedding && g.embedding.length === candidate.embedding.length) {
      let dot = 0;
      let na = 0;
      let nb = 0;
      for (let k = 0; k < g.embedding.length; k++) {
        dot += g.embedding[k]! * candidate.embedding[k]!;
        na += g.embedding[k]! ** 2;
        nb += candidate.embedding[k]! ** 2;
      }
      visual = na && nb ? Math.max(0, (dot / Math.sqrt(na * nb) - 0.5) / 0.5) : 0.5;
    }
    const similarity = (sameSub ? 0.35 : 0.1) + 0.3 * colorSim + 0.1 * patternSim + 0.1 * styleSim + 0.15 * visual;
    if (similarity < 0.45) continue;
    const colorName = getColorFamily(gdom?.family ?? '')?.label.toLowerCase();
    const reason = sameSub && colorSim > 0.6 ? `Ya tienes ${g.name.toLowerCase()}${colorName ? ` en ${colorName}` : ''}, muy parecido.` : `Similar a ${g.name.toLowerCase()}.`;
    results.push({ garment: g, similarity: Math.min(1, similarity), reason });
  }
  results.sort((a, b) => b.similarity - a.similarity);
  return results.slice(0, limit);
}

export interface ProductSignals {
  newOutfits: number;
  partners: number;
  styleMatch: number;
  redundancy: number;
  priceEur: number | null;
  budget: { min: number | null; max: number | null };
  brand: string | null;
  favoriteBrands: string[];
  sizeAvailable: boolean | null;
  dataQuality: number;
  isStale: boolean;
}

/**
 * Personal shopping score. Affiliate commission is deliberately NOT an input.
 * Returns the score and a breakdown used for explanations and audits.
 */
export function productScore(s: ProductSignals): { score: number; breakdown: Record<string, number> } {
  const compat = Math.min(1, s.newOutfits / 8) * 0.7 + Math.min(1, s.partners / 10) * 0.3;
  let budgetFit = 0.6;
  if (s.priceEur !== null && (s.budget.max !== null || s.budget.min !== null)) {
    const max = s.budget.max ?? Number.POSITIVE_INFINITY;
    const min = s.budget.min ?? 0;
    if (s.priceEur <= max && s.priceEur >= min) budgetFit = 1;
    else if (s.priceEur > max) budgetFit = Math.max(0, 1 - (s.priceEur - max) / max);
    else budgetFit = 0.8;
  }
  const brand = s.brand && s.favoriteBrands.some((b) => b.toLowerCase() === s.brand!.toLowerCase()) ? 1 : 0.5;
  const size = s.sizeAvailable === null ? 0.6 : s.sizeAvailable ? 1 : 0.1;
  const breakdown = {
    compatibilidad: compat,
    estilo: s.styleMatch,
    novedad: 1 - s.redundancy,
    presupuesto: budgetFit,
    marca: brand,
    talla: size,
    calidad_datos: s.dataQuality * (s.isStale ? 0.5 : 1),
  };
  const score =
    0.32 * breakdown.compatibilidad +
    0.2 * breakdown.estilo +
    0.18 * breakdown.novedad +
    0.12 * breakdown.presupuesto +
    0.06 * breakdown.marca +
    0.07 * breakdown.talla +
    0.05 * breakdown.calidad_datos;
  return { score, breakdown };
}

/** Versatile archetypes used for gap analysis ("Completa tu armario"). */
export const ARCHETYPES: Array<{ subcategory: string; color: string; hex: string; label: string; seasons: Season[] }> = [
  { subcategory: 'camiseta', color: 'blanco', hex: '#f6f6f4', label: 'Camiseta blanca', seasons: ['primavera', 'verano', 'otono'] },
  { subcategory: 'camiseta', color: 'negro', hex: '#1a1a1a', label: 'Camiseta negra', seasons: ['primavera', 'verano', 'otono'] },
  { subcategory: 'camisa', color: 'blanco', hex: '#f4f4f2', label: 'Camisa blanca', seasons: ['primavera', 'verano', 'otono', 'invierno'] },
  { subcategory: 'camisa', color: 'celeste', hex: '#a9c6e8', label: 'Camisa celeste', seasons: ['primavera', 'verano', 'otono', 'invierno'] },
  { subcategory: 'jersey', color: 'gris', hex: '#8c8c8c', label: 'Jersey gris', seasons: ['otono', 'invierno'] },
  { subcategory: 'jersey', color: 'azul_marino', hex: '#1f2a44', label: 'Jersey azul marino', seasons: ['otono', 'invierno'] },
  { subcategory: 'jersey', color: 'crudo', hex: '#ece3d0', label: 'Jersey crudo', seasons: ['otono', 'invierno'] },
  { subcategory: 'vaquero', color: 'denim', hex: '#4b6584', label: 'Vaquero azul', seasons: ['primavera', 'otono', 'invierno'] },
  { subcategory: 'chino', color: 'beige', hex: '#d6c2a3', label: 'Chino beige', seasons: ['primavera', 'verano', 'otono'] },
  { subcategory: 'pantalon_vestir', color: 'negro', hex: '#1c1c1c', label: 'Pantalón de vestir negro', seasons: ['primavera', 'otono', 'invierno'] },
  { subcategory: 'pantalon', color: 'gris', hex: '#7d7d7d', label: 'Pantalón gris', seasons: ['primavera', 'otono', 'invierno'] },
  { subcategory: 'falda', color: 'negro', hex: '#1a1a1a', label: 'Falda negra', seasons: ['primavera', 'otono', 'invierno'] },
  { subcategory: 'vestido', color: 'negro', hex: '#1a1a1a', label: 'Vestido negro', seasons: ['primavera', 'verano', 'otono'] },
  { subcategory: 'americana', color: 'azul_marino', hex: '#22304f', label: 'Americana azul marino', seasons: ['primavera', 'otono', 'invierno'] },
  { subcategory: 'chaqueta', color: 'beige', hex: '#cdb894', label: 'Chaqueta beige', seasons: ['primavera', 'otono'] },
  { subcategory: 'gabardina', color: 'beige', hex: '#c9b48e', label: 'Gabardina beige', seasons: ['primavera', 'otono'] },
  { subcategory: 'abrigo', color: 'camel', hex: '#c09a6b', label: 'Abrigo camel', seasons: ['invierno'] },
  { subcategory: 'abrigo', color: 'negro', hex: '#1d1d1d', label: 'Abrigo negro', seasons: ['invierno'] },
  { subcategory: 'cazadora_vaquera', color: 'denim', hex: '#5a7898', label: 'Cazadora vaquera', seasons: ['primavera', 'otono'] },
  { subcategory: 'impermeable', color: 'azul_marino', hex: '#1f2a44', label: 'Chubasquero azul marino', seasons: ['primavera', 'otono', 'invierno'] },
  { subcategory: 'zapatillas', color: 'blanco', hex: '#f5f5f5', label: 'Zapatillas blancas', seasons: ['primavera', 'verano', 'otono', 'invierno'] },
  { subcategory: 'botines', color: 'marron', hex: '#6b4528', label: 'Botines marrones', seasons: ['otono', 'invierno'] },
  { subcategory: 'mocasines', color: 'negro', hex: '#1a1a1a', label: 'Mocasines negros', seasons: ['primavera', 'verano', 'otono'] },
  { subcategory: 'botas', color: 'negro', hex: '#1a1a1a', label: 'Botas negras', seasons: ['otono', 'invierno'] },
  { subcategory: 'bolso', color: 'negro', hex: '#1a1a1a', label: 'Bolso negro', seasons: ['primavera', 'verano', 'otono', 'invierno'] },
  { subcategory: 'cinturon', color: 'marron', hex: '#6b4528', label: 'Cinturón marrón', seasons: ['primavera', 'verano', 'otono', 'invierno'] },
  { subcategory: 'bufanda', color: 'gris', hex: '#8c8c8c', label: 'Bufanda gris', seasons: ['invierno'] },
];

/** Subcategories we only suggest if the user already wears that kind of garment (no assumptions about the user). */
const OPT_IN_SUBCATEGORIES: Record<string, string[]> = {
  falda: ['falda', 'falda_larga', 'vestido', 'vestido_punto', 'vestido_fiesta'],
  vestido: ['falda', 'falda_larga', 'vestido', 'vestido_punto', 'vestido_fiesta'],
  tacones: ['tacones'],
  bolso: ['bolso'],
  americana: ['americana', 'pantalon_vestir', 'camisa'],
  pantalon_vestir: ['pantalon_vestir', 'americana', 'camisa'],
};

export interface WardrobeGap {
  key: string;
  label: string;
  subcategory: string;
  colorFamily: string;
  newOutfits: number;
  partners: number;
  reason: string;
  candidate: EngineGarment;
}

export function wardrobeGaps(
  wardrobe: EngineGarment[],
  contexts: EngineContext[],
  profile: EngineProfile,
  history: EngineHistory,
  opts: { limit?: number; season?: Season } = {},
): WardrobeGap[] {
  const ownedSubs = new Set(wardrobe.map((g) => g.subcategory));
  const gaps: WardrobeGap[] = [];
  for (const a of ARCHETYPES) {
    const optIn = OPT_IN_SUBCATEGORIES[a.subcategory];
    if (optIn && !optIn.some((s) => ownedSubs.has(s))) continue;
    if (opts.season && !a.seasons.includes(opts.season)) continue;
    const sub = getSubcategory(a.subcategory);
    if (!sub) continue;
    const candidate = toEngineGarment({
      id: `hipotetico:${a.subcategory}:${a.color}`,
      name: a.label,
      category: sub.category,
      subcategory: a.subcategory,
      colors: [{ hex: a.hex, share: 1, family: a.color }],
      pattern: 'liso',
      isCandidate: true,
    });
    const similar = findSimilarOwned(wardrobe, candidate, 1);
    if (similar[0] && similar[0].similarity >= 0.7) continue;
    const ev = evaluateCandidate(wardrobe, candidate, contexts, profile, history, { perContext: 6 });
    if (ev.newOutfits === 0) continue;
    gaps.push({
      key: `${a.subcategory}:${a.color}`,
      label: a.label,
      subcategory: a.subcategory,
      colorFamily: a.color,
      newOutfits: ev.newOutfits,
      partners: ev.partners.length,
      reason: `Con ${a.label.toLowerCase().replace(/^(\p{L}+)/u, (m) => (m.endsWith('a') ? `una ${m}` : `un ${m}`))} podrías crear ${ev.newOutfits} conjunto${ev.newOutfits === 1 ? '' : 's'} nuevo${ev.newOutfits === 1 ? '' : 's'} con ${ev.partners.length} prenda${ev.partners.length === 1 ? '' : 's'} que ya tienes.`,
      candidate,
    });
  }
  gaps.sort((x, y) => y.newOutfits - x.newOutfits || y.partners - x.partners);
  return gaps.slice(0, opts.limit ?? 6);
}

/** Garments with few good partners ("prendas huérfanas"). */
export function lowVersatility(wardrobe: EngineGarment[], threshold = 0.66): Array<{ garment: EngineGarment; partners: number }> {
  return wardrobe
    .filter((g) => g.layer !== 'accessory')
    .map((g) => {
      let partners = 0;
      for (const o of wardrobe) {
        if (o.id === g.id || o.layer === g.layer || o.layer === 'accessory') continue;
        const a = g.colors[0];
        const b = o.colors[0];
        const de = a && b ? deltaE2000(a.lab, b.lab) : 20;
        const styleSim = cosine(g.styleVector, o.styleVector);
        const formalityGap = Math.abs(g.formality - o.formality);
        const compat = 0.4 * styleSim + 0.3 * (formalityGap < 35 ? 1 : 0.3) + 0.3 * (de > 5 ? 1 : 0.7);
        if (compat >= threshold) partners++;
      }
      return { garment: g, partners };
    })
    .sort((a, b) => a.partners - b.partners);
}

export { hexToLab };
