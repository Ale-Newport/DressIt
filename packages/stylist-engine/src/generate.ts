import type { AccessorySlot } from '@dressit/shared';
import { explainOutfit } from './explain.ts';
import { colorPairHarmony, cosine, outfitStyleVector, dominantStyle } from './harmony.ts';
import { createRng } from './rng.ts';
import { computeFeatures, effectiveWeights, scoreFeatures, signatureOf, styleMatchOf, daysSinceWorn } from './scoring.ts';
import { garmentWeatherFit } from './thermal.ts';
import type {
  EngineContext,
  EngineGarment,
  EngineHistory,
  EngineProfile,
  GenerateOptions,
  GenerateResult,
  OutfitCandidate,
  ScoredOutfit,
  Slot,
} from './types.ts';

type Pools = {
  base: EngineGarment[];
  mid: EngineGarment[];
  bottom: EngineGarment[];
  one_piece: EngineGarment[];
  outer: EngineGarment[];
  footwear: EngineGarment[];
  accessory: EngineGarment[];
};

/**
 * Hard constraints: things a stylist would never suggest for this context.
 * Everything else is handled softly by the scoring model.
 */
export function isAllowed(g: EngineGarment, ctx: EngineContext): boolean {
  if (ctx.exclude.has(g.id)) return false;
  if (ctx.excludeSubcategories.has(g.subcategory)) return false;
  if (g.layer === 'swim') return false;
  const w = ctx.weather;
  const shift = ctx.adjustments.warmth * -3;
  if (w) {
    const lo = w.apparentMin + shift;
    const hi = w.apparentMax + shift;
    // Shorts, sandals and strappy tops when the warmest moment is cool.
    if (g.tempRange[0] >= 19 && hi < g.tempRange[0] - 6) return false;
    // Heavy winter pieces on hot days.
    if (g.tempRange[1] <= 12 && lo > g.tempRange[1] + 10) return false;
  }
  const [flo, fhi] = ctx.occasion.formality;
  if (g.layer !== 'accessory') {
    if (g.formality < flo - 40) return false;
    if (g.formality > fhi + 55) return false;
  }
  if (ctx.occasion.sport) {
    // For sport, main pieces must be sport-capable (accessories and outerwear are free).
    if ((g.layer === 'base' || g.layer === 'bottom' || g.layer === 'footwear') && !g.sport && (g.styleVector.deportivo ?? 0) < 0.5) return false;
  } else if (g.sport && g.formality <= 10 && ctx.occasion.formality[0] >= 30) {
    return false;
  }
  return true;
}

function unaryScore(g: EngineGarment, ctx: EngineContext, profile: EngineProfile, history: EngineHistory): number {
  const [lo, hi] = ctx.occasion.formality;
  const shift = ctx.adjustments.formality * 18 + ctx.adjustments.elegance * 10;
  const f = g.formality;
  const fd = f < lo + shift ? lo + shift - f : f > hi + shift ? f - hi - shift : 0;
  const formality = Math.exp(-(fd * fd) / (2 * 15 * 15));
  const weather = garmentWeatherFit(g, ctx);
  let style = 0.5;
  const pref: Record<string, number> = {};
  for (const s of ctx.occasion.preferStyles) pref[s] = 1;
  style += 0.3 * cosine(g.styleVector, pref);
  const personalPref: Record<string, number> = {};
  for (const s of profile.preferredStyles) personalPref[s] = 1;
  for (const [s, v] of Object.entries(profile.learned.styleWeights)) personalPref[s] = (personalPref[s] ?? 0) + (v ?? 0);
  style += 0.2 * cosine(g.styleVector, personalPref);
  const affinity = Math.tanh(profile.learned.itemAffinity[g.id] ?? 0);
  const d = daysSinceWorn(g, history, ctx.date);
  const rotation = d <= 1 ? 0.5 : d <= 3 ? 0.8 : 1;
  const avoided = g.colors.some((c) => c.share >= 0.4 && profile.avoidedColors.includes(c.family)) ? 0.6 : 1;
  return formality * (0.4 + 0.6 * weather) * style * rotation * avoided * (1 + 0.25 * affinity);
}

function buildPools(garments: EngineGarment[], ctx: EngineContext): Pools {
  const pools: Pools = { base: [], mid: [], bottom: [], one_piece: [], outer: [], footwear: [], accessory: [] };
  for (const g of garments) {
    if (!isAllowed(g, ctx)) continue;
    switch (g.layer) {
      case 'base':
        pools.base.push(g);
        break;
      case 'mid':
        pools.mid.push(g);
        break;
      case 'bottom':
        pools.bottom.push(g);
        break;
      case 'one_piece':
        pools.one_piece.push(g);
        break;
      case 'outer':
        pools.outer.push(g);
        break;
      case 'footwear':
        pools.footwear.push(g);
        break;
      case 'accessory':
        pools.accessory.push(g);
        break;
      default:
        break;
    }
  }
  return pools;
}

function topN(pool: EngineGarment[], n: number, scoreOf: (g: EngineGarment) => number, forced: Set<string>): EngineGarment[] {
  const scored = pool.map((g) => ({ g, s: scoreOf(g) + (forced.has(g.id) ? 10 : 0) }));
  scored.sort((a, b) => b.s - a.s || a.g.id.localeCompare(b.g.id));
  return scored.slice(0, n).map((x) => x.g);
}

function dominantColor(g: EngineGarment) {
  return g.colors.length ? g.colors.reduce((a, b) => (b.share > a.share ? b : a)) : null;
}

/** Cheap pairwise compatibility used to prune cores before full scoring. */
function pairCompat(a: EngineGarment, b: EngineGarment): number {
  const ca = dominantColor(a);
  const cb = dominantColor(b);
  const color = ca && cb ? colorPairHarmony(ca, cb).score : 0.7;
  const style = 0.4 + 0.6 * cosine(a.styleVector, b.styleVector);
  const fd = Math.abs(a.formality - b.formality);
  const formality = Math.exp(-(fd * fd) / (2 * 30 * 30));
  return 0.45 * color + 0.3 * style + 0.25 * formality;
}

interface Need {
  outer: 'required' | 'optional' | 'avoid';
  midAllowed: boolean;
}

function layerNeeds(ctx: EngineContext): Need {
  const w = ctx.weather;
  const shift = ctx.adjustments.warmth * -3;
  if (!w) {
    const cold = ctx.season === 'invierno' || ctx.season === 'otono';
    return { outer: cold ? 'required' : ctx.season === 'verano' ? 'avoid' : 'optional', midAllowed: ctx.season !== 'verano' };
  }
  const lo = w.apparentMin + shift;
  const outdoor = 1 - ctx.indoorShare;
  const rain = w.precipProbMax >= 50 && outdoor > 0.15;
  let outer: Need['outer'] = 'optional';
  if (lo < 13 || rain) outer = 'required';
  else if (lo >= 24) outer = 'avoid';
  return { outer, midAllowed: lo < 20 };
}

const MID_NEEDS_BASE = new Set(['cardigan', 'chaleco_punto', 'sobrecamisa']);

function mk(items: Array<[Slot, EngineGarment | null | undefined]>): OutfitCandidate {
  return { items: items.filter((x): x is [Slot, EngineGarment] => !!x[1]).map(([slot, garment]) => ({ slot, garment })) };
}

/** Accessories are added greedily, one per slot, only when they improve the outfit. */
function addAccessories(
  outfit: OutfitCandidate,
  accessories: EngineGarment[],
  evaluate: (o: OutfitCandidate) => number,
  ctx: EngineContext,
): OutfitCandidate {
  let current = outfit;
  let currentScore = evaluate(current);
  const w = ctx.weather;
  const usedSlots = new Set<AccessorySlot>();
  // Weather-driven accessories first.
  const priority = (g: EngineGarment): number => {
    if (!w) return 0;
    if (g.accessorySlot === 'umbrella' && w.precipProbMax >= 50) return 3;
    if (g.accessorySlot === 'eyes' && w.uvMax >= 6) return 2;
    if ((g.accessorySlot === 'neck' || g.accessorySlot === 'hands' || g.subcategory === 'gorro') && w.apparentMin < 8) return 2;
    return 0;
  };
  const ordered = [...accessories].sort((a, b) => priority(b) - priority(a) || a.id.localeCompare(b.id));
  let added = 0;
  for (const acc of ordered) {
    if (added >= 3) break;
    const slot = acc.accessorySlot;
    if (!slot || usedSlots.has(slot)) continue;
    const candidate: OutfitCandidate = { items: [...current.items, { slot: `accessory:${slot}`, garment: acc }] };
    const s = evaluate(candidate) + priority(acc) * 0.01;
    if (s > currentScore + 0.002) {
      current = candidate;
      currentScore = s;
      usedSlots.add(slot);
      added++;
    }
  }
  return current;
}

function jaccard(a: ScoredOutfit, b: ScoredOutfit): number {
  const sa = new Set(a.items.filter((i) => !i.slot.startsWith('accessory')).map((i) => i.garment.id));
  const sb = new Set(b.items.filter((i) => !i.slot.startsWith('accessory')).map((i) => i.garment.id));
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  const union = sa.size + sb.size - inter;
  return union ? inter / union : 0;
}

/** Maximal Marginal Relevance selection. */
export function diversify(ranked: ScoredOutfit[], count: number, lambda: number): ScoredOutfit[] {
  const selected: ScoredOutfit[] = [];
  const remaining = [...ranked];
  while (selected.length < count && remaining.length > 0) {
    let bestIdx = 0;
    let best = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < remaining.length; i++) {
      const r = remaining[i]!;
      const maxSim = selected.length ? Math.max(...selected.map((s) => jaccard(r, s))) : 0;
      const mmr = lambda * r.score - (1 - lambda) * maxSim;
      if (mmr > best) {
        best = mmr;
        bestIdx = i;
      }
    }
    const [pick] = remaining.splice(bestIdx, 1);
    // Never return two outfits that share the same top+bottom core.
    if (pick && !selected.some((s) => jaccard(s, pick) >= 0.99)) selected.push(pick);
  }
  return selected;
}

export function evaluateOutfit(
  outfit: OutfitCandidate,
  ctx: EngineContext,
  profile: EngineProfile,
  history: EngineHistory,
): ScoredOutfit {
  const weights = effectiveWeights(profile);
  const comp = computeFeatures(outfit, ctx, profile, history);
  const { score, contributions } = scoreFeatures(comp.features, weights);
  const styleVec = outfitStyleVector(outfit);
  const scored: ScoredOutfit = {
    items: outfit.items,
    signature: signatureOf(outfit),
    features: comp.features,
    score,
    contributions,
    thermal: comp.thermal,
    isExploration: false,
    explanation: [],
    weatherNote: null,
    formality: Math.round(comp.formality),
    styleMatch: styleMatchOf(outfit, profile),
    dominantStyle: dominantStyle(styleVec),
  };
  const ex = explainOutfit(scored, ctx, profile, history, { colorKind: comp.colorKind, chromaticFamilies: comp.chromaticFamilies });
  scored.explanation = ex.reasons;
  scored.weatherNote = ex.weatherNote;
  return scored;
}

/**
 * Generate complete outfits from the user's real, available garments.
 * Deterministic for a given (garments, ctx, profile, history, seed).
 */
export function generateOutfits(
  garments: EngineGarment[],
  ctx: EngineContext,
  profile: EngineProfile,
  history: EngineHistory,
  options: GenerateOptions,
): GenerateResult {
  const t0 = performance.now();
  const warnings: string[] = [];
  const perPool = options.beam?.perPool ?? 12;
  const maxCores = options.beam?.cores ?? 40;
  const maxFinals = options.beam?.finals ?? 80;
  const rng = createRng(options.seed);
  const forced = new Set(ctx.mustInclude);
  const pools = buildPools(garments, ctx);
  const weights = effectiveWeights(profile);
  const u = (g: EngineGarment) => unaryScore(g, ctx, profile, history);

  for (const id of forced) {
    if (!garments.some((g) => g.id === id && isAllowed(g, { ...ctx, exclude: new Set(), excludeSubcategories: new Set() }))) {
      const g = garments.find((x) => x.id === id);
      warnings.push(g ? `«${g.name}» no encaja con las condiciones de hoy, pero lo hemos intentado incluir.` : 'Una prenda solicitada no está disponible.');
      if (g && !pools[g.layer as keyof Pools]?.includes(g)) (pools[g.layer as keyof Pools] as EngineGarment[] | undefined)?.push(g);
    }
  }

  const P = {
    base: topN(pools.base, perPool, u, forced),
    mid: topN(pools.mid, Math.ceil(perPool * 0.6), u, forced),
    bottom: topN(pools.bottom, perPool, u, forced),
    one_piece: topN(pools.one_piece, Math.ceil(perPool * 0.6), u, forced),
    outer: topN(pools.outer, Math.ceil(perPool * 0.6), u, forced),
    footwear: topN(pools.footwear, Math.ceil(perPool * 0.5), u, forced),
    accessory: topN(pools.accessory, perPool, u, forced),
  };
  const poolSizes = Object.fromEntries(Object.entries(P).map(([k, v]) => [k, v.length]));

  const need = layerNeeds(ctx);
  if (P.footwear.length === 0) warnings.push('No hay calzado disponible: los conjuntos se muestran sin zapatos.');
  if (need.outer === 'required' && P.outer.length === 0) {
    warnings.push(
      ctx.weather && ctx.weather.precipProbMax >= 50
        ? 'Hoy conviene una prenda exterior impermeable y no tienes ninguna disponible.'
        : 'Hace frío y no tienes prendas de abrigo disponibles.',
    );
  }

  // 1. Cores: base/mid + bottom, or one-piece.
  type Core = { top: EngineGarment; bottom: EngineGarment | null; s: number };
  const cores: Core[] = [];
  const tops = [...P.base, ...P.mid.filter((m) => m.wearableAlone)];
  for (const t of tops) for (const b of P.bottom) cores.push({ top: t, bottom: b, s: pairCompat(t, b) * Math.sqrt(u(t) * u(b)) });
  for (const d of P.one_piece) cores.push({ top: d, bottom: null, s: 0.8 * u(d) });
  cores.sort((a, b) => b.s - a.s || a.top.id.localeCompare(b.top.id));
  const forcedGarments = garments.filter((g) => forced.has(g.id));
  const forcedOf = (layer: string) => forcedGarments.filter((g) => g.layer === layer);
  const keptCores = cores
    .filter((c) => {
      // Forced core pieces must appear in the core (forced mids may sit on top of a base instead).
      for (const g of forcedGarments) {
        if (g.layer === 'base' && c.top.id !== g.id) return false;
        if (g.layer === 'bottom' && c.bottom?.id !== g.id) return false;
        if (g.layer === 'one_piece' && c.top.id !== g.id) return false;
      }
      return true;
    })
    .slice(0, maxCores);
  if (keptCores.length === 0) {
    return {
      outfits: [],
      warnings: [
        ...warnings,
        tops.length === 0 && P.one_piece.length === 0
          ? 'No hay partes de arriba ni vestidos disponibles para esta ocasión.'
          : P.bottom.length === 0 && P.one_piece.length === 0
            ? 'No hay partes de abajo disponibles para esta ocasión.'
            : 'No hemos encontrado combinaciones válidas con las prendas disponibles.',
      ],
      stats: { candidatesEvaluated: 0, poolSizes, elapsedMs: performance.now() - t0 },
    };
  }

  // 2. Expand cores with mid / outer / footwear options and score fully.
  const evalScore = (o: OutfitCandidate) => scoreFeatures(computeFeatures(o, ctx, profile, history).features, weights).score;
  const finals = new Map<string, { o: OutfitCandidate; s: number }>();
  let evaluated = 0;
  const forcedMids = forcedOf('mid');
  const midOptions = (core: Core): Array<EngineGarment | null> => {
    if (core.top.layer === 'mid' || core.bottom === null) return [null];
    const extra = forcedMids.filter((m) => m.id !== core.top.id);
    if (extra.length) return extra;
    if (!need.midAllowed) return [null];
    return [null, ...P.mid.filter((m) => m.id !== core.top.id).slice(0, 4)];
  };
  const forcedOuters = forcedOf('outer');
  const outerOptions: Array<EngineGarment | null> = forcedOuters.length
    ? forcedOuters
    : need.outer === 'required' && P.outer.length > 0
      ? P.outer.slice(0, 5)
      : need.outer === 'avoid'
        ? [null]
        : [null, ...P.outer.slice(0, 4)];
  const forcedFeet = forcedOf('footwear');
  const footOptions: Array<EngineGarment | null> = forcedFeet.length ? forcedFeet : P.footwear.length ? P.footwear.slice(0, 5) : [null];

  for (const core of keptCores) {
    for (const mid of midOptions(core)) {
      for (const outer of outerOptions) {
        for (const foot of footOptions) {
          const isMidTop = core.top.layer === 'mid';
          if (isMidTop && MID_NEEDS_BASE.has(core.top.subcategory)) continue;
          const o = core.bottom
            ? mk([
                [isMidTop ? 'mid' : 'base', core.top],
                ['mid', isMidTop ? null : mid],
                ['bottom', core.bottom],
                ['outer', outer],
                ['footwear', foot],
              ])
            : mk([
                ['one_piece', core.top],
                ['outer', outer],
                ['footwear', foot],
              ]);
          // All forced items must be present.
          if ([...forced].some((id) => !o.items.some((i) => i.garment.id === id) && !P.accessory.some((a) => a.id === id))) continue;
          const sig = signatureOf(o);
          if (finals.has(sig) || history.rejectedSignatures.has(sig)) continue;
          const s = evalScore(o);
          evaluated++;
          finals.set(sig, { o, s });
        }
      }
    }
  }

  // 3. Keep the best, add accessories, final scoring with explanations.
  const best = [...finals.values()].sort((a, b) => b.s - a.s).slice(0, maxFinals);
  const forcedAcc = P.accessory.filter((a) => forced.has(a.id));
  const scored: ScoredOutfit[] = [];
  const seen = new Set<string>();
  for (const { o } of best.slice(0, Math.max(options.count * 6, 24))) {
    let withAcc = addAccessories(o, P.accessory.filter((a) => !forced.has(a.id)), evalScore, ctx);
    for (const fa of forcedAcc) {
      if (!withAcc.items.some((i) => i.garment.id === fa.id) && fa.accessorySlot) {
        withAcc = { items: [...withAcc.items.filter((i) => i.slot !== `accessory:${fa.accessorySlot}`), { slot: `accessory:${fa.accessorySlot}`, garment: fa }] };
      }
    }
    const s = evaluateOutfit(withAcc, ctx, profile, history);
    if (seen.has(s.signature) || history.rejectedSignatures.has(s.signature)) continue;
    seen.add(s.signature);
    scored.push(s);
  }
  scored.sort((a, b) => b.score - a.score || a.signature.localeCompare(b.signature));

  // 4. Diversify; optionally reserve one slot for exploration of a less familiar style.
  const lambda = options.diversityLambda ?? 0.72;
  const explorationRate = options.explorationRate ?? (profile.learned.feedbackCount < 20 ? 0.25 : 0.12);
  let selected = diversify(scored, options.count, lambda);
  if (selected.length >= 3 && rng() < explorationRate) {
    const familiar = new Set([...profile.preferredStyles, ...selected.slice(0, 2).map((s) => s.dominantStyle)]);
    const top = selected[0]!.score;
    const candidate = scored.find(
      (s) => !selected.includes(s) && s.dominantStyle && !familiar.has(s.dominantStyle) && s.score >= top * 0.85,
    );
    if (candidate) {
      candidate.isExploration = true;
      candidate.explanation = [`Para explorar: una propuesta más ${candidate.dominantStyle} de lo habitual en ti.`, ...candidate.explanation];
      selected = [...selected.slice(0, selected.length - 1), candidate];
    }
  }
  // Quality floor: never pad the list with clearly weak combinations.
  const bestScore = selected.reduce((m, o) => Math.max(m, o.score), 0);
  const floor = Math.max(options.minScore ?? 0.45, bestScore * 0.7);
  const dropped = selected.filter((o) => o.score < floor && o !== selected[0]);
  if (dropped.length) selected = selected.filter((o) => !dropped.includes(o));
  if (selected.length < options.count && selected.length > 0) {
    warnings.push(`Solo hemos podido crear ${selected.length} conjunto(s) distintos con las prendas disponibles.`);
  }
  return { outfits: selected, warnings, stats: { candidatesEvaluated: evaluated, poolSizes, elapsedMs: performance.now() - t0 } };
}

/** Rank replacements for one slot, keeping the rest of the outfit fixed. */
export function rankAlternatives(
  outfit: OutfitCandidate,
  slot: Slot,
  garments: EngineGarment[],
  ctx: EngineContext,
  profile: EngineProfile,
  history: EngineHistory,
  limit = 8,
): Array<{ garment: EngineGarment; outfit: ScoredOutfit; delta: number }> {
  const current = evaluateOutfit(outfit, ctx, profile, history);
  const currentItem = outfit.items.find((i) => i.slot === slot)?.garment;
  const layerForSlot = slot.startsWith('accessory:') ? 'accessory' : slot;
  const options = garments.filter((g) => {
    if (g.id === currentItem?.id) return false;
    if (outfit.items.some((i) => i.garment.id === g.id)) return false;
    if (!isAllowed(g, { ...ctx, exclude: ctx.exclude })) return false;
    if (layerForSlot === 'accessory') return g.layer === 'accessory' && `accessory:${g.accessorySlot}` === slot;
    if (slot === 'base') return g.layer === 'base' || (g.layer === 'mid' && g.wearableAlone && !outfit.items.some((i) => i.slot === 'mid'));
    return g.layer === layerForSlot;
  });
  const results = options.map((g) => {
    const items = outfit.items.map((i) => (i.slot === slot ? { slot, garment: g } : i));
    if (!currentItem) items.push({ slot, garment: g });
    const scored = evaluateOutfit({ items }, ctx, profile, history);
    return { garment: g, outfit: scored, delta: scored.score - current.score };
  });
  results.sort((a, b) => b.outfit.score - a.outfit.score || a.garment.id.localeCompare(b.garment.id));
  return results.slice(0, limit);
}
