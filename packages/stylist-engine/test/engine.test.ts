import { describe, expect, it } from 'vitest';
import { applyFeedback, emptyModel } from '../src/learning.ts';
import { generateOutfits, rankAlternatives, evaluateOutfit } from '../src/generate.ts';
import { ensembleClo, requiredClo } from '../src/thermal.ts';
import { colorPairHarmony } from '../src/harmony.ts';
import { findSimilarOwned, evaluateCandidate, productScore, wardrobeGaps } from '../src/shopping.ts';
import { flatLayLayout } from '../src/layout.ts';
import { hexToLab } from '@dressit/shared';
import { ctx, day, g, noHistory, profile, testWardrobe } from './fixtures.ts';
import type { ScoredOutfit } from '../src/types.ts';

const ids = (o: ScoredOutfit) => o.items.map((i) => i.garment.id);
const has = (o: ScoredOutfit, pred: (sub: string, slot: string) => boolean) => o.items.some((i) => pred(i.garment.subcategory, i.slot));

describe('thermal model', () => {
  it('requires more insulation when colder and respects sensitivity', () => {
    expect(requiredClo(0)).toBeGreaterThan(requiredClo(10));
    expect(requiredClo(10)).toBeGreaterThan(requiredClo(25));
    expect(requiredClo(15, 2)).toBeGreaterThan(requiredClo(15, 0));
  });
  it('uses McCullough summation for ensembles', () => {
    expect(ensembleClo([0.08, 0.24, 0.03])).toBeCloseTo(0.835 * 0.35 + 0.161, 5);
  });
});

describe('color harmony', () => {
  it('neutrals pair with anything, saturated clashes score low', () => {
    const navy = { lab: hexToLab('#1f2a44'), family: 'azul_marino' };
    const red = { lab: hexToLab('#c62828'), family: 'rojo' };
    const green = { lab: hexToLab('#2e7d4f'), family: 'verde' };
    const purple = { lab: hexToLab('#6a3d9a'), family: 'morado' };
    expect(colorPairHarmony(navy, red).score).toBeGreaterThan(0.8);
    expect(colorPairHarmony(red, purple).score).toBeLessThan(colorPairHarmony(navy, red).score);
    expect(colorPairHarmony(green, red).kind).toBe('complementaria');
  });
});

describe('outfit generation', () => {
  const wardrobe = testWardrobe();

  it('only uses garments it was given and never excluded/unavailable ones', () => {
    const excluded = new Set(['jeans', 'sneakers', 'trench']);
    const available = wardrobe.filter((x) => !['tee-white', 'boots'].includes(x.id)); // e.g. en la colada
    const r = generateOutfits(available, ctx('universidad', day({}), { exclude: excluded }), profile(), noHistory, { count: 5, seed: 1 });
    expect(r.outfits.length).toBeGreaterThanOrEqual(3);
    const allowed = new Set(available.map((x) => x.id));
    for (const o of r.outfits) {
      for (const id of ids(o)) {
        expect(allowed.has(id)).toBe(true);
        expect(excluded.has(id)).toBe(false);
      }
    }
  });

  it('produces complete outfits (top+bottom or one-piece, plus footwear)', () => {
    const r = generateOutfits(wardrobe, ctx('trabajo', day({})), profile(), noHistory, { count: 5, seed: 2 });
    for (const o of r.outfits) {
      const slots = o.items.map((i) => i.slot);
      const complete = slots.includes('one_piece') || ((slots.includes('base') || slots.includes('mid')) && slots.includes('bottom'));
      expect(complete).toBe(true);
      expect(slots).toContain('footwear');
      expect(new Set(slots).size).toBe(slots.length);
      expect(o.explanation.length).toBeGreaterThan(0);
    }
  });

  it('is deterministic for the same seed', () => {
    const a = generateOutfits(wardrobe, ctx('universidad', day({})), profile(), noHistory, { count: 4, seed: 42 });
    const b = generateOutfits(wardrobe, ctx('universidad', day({})), profile(), noHistory, { count: 4, seed: 42 });
    expect(a.outfits.map((o) => o.signature)).toEqual(b.outfits.map((o) => o.signature));
  });

  it('changes with the weather: cold+rain vs hot', () => {
    const cold = generateOutfits(wardrobe, ctx('paseo', day({ apparentMin: 3, apparentMax: 9, precipProbMax: 80, rainFromHour: 9 })), profile(), noHistory, { count: 4, seed: 3 });
    const hot = generateOutfits(wardrobe, ctx('paseo', day({ apparentMin: 24, apparentMax: 33, humidityAvg: 70, uvMax: 8 })), profile(), noHistory, { count: 4, seed: 3 });
    for (const o of cold.outfits) {
      expect(o.items.some((i) => i.slot === 'outer')).toBe(true);
      expect(has(o, (s) => s === 'bermuda' || s === 'sandalias' || s === 'zapatillas_lona')).toBe(false);
      // rain protection: waterproof outerwear or umbrella
      expect(o.thermal?.rainProtected).toBe(true);
    }
    for (const o of hot.outfits) {
      expect(has(o, (s) => s === 'abrigo' || s === 'plumifero' || s === 'jersey_grueso')).toBe(false);
    }
    const coldSigs = new Set(cold.outfits.map((o) => o.signature));
    expect(hot.outfits.some((o) => !coldSigs.has(o.signature))).toBe(true);
  });

  it('plans for the whole day: cool morning, warm afternoon → removable layer', () => {
    const r = generateOutfits(wardrobe, ctx('universidad', day({ apparentMin: 9, apparentMax: 19, precipProbMax: 60, rainFromHour: 16 })), profile(), noHistory, { count: 4, seed: 5 });
    expect(r.outfits.length).toBeGreaterThan(0);
    const best = r.outfits[0]!;
    expect(best.thermal?.hasRemovableLayer).toBe(true);
    expect(best.weatherNote).toMatch(/°C/);
  });

  it('respects occasion formality: interview vs gym', () => {
    const interview = generateOutfits(wardrobe, ctx('entrevista', day({ apparentMin: 14, apparentMax: 20 })), profile(), noHistory, { count: 3, seed: 6 });
    for (const o of interview.outfits) {
      expect(o.formality).toBeGreaterThanOrEqual(50);
      expect(has(o, (s) => ['jogger', 'leggings', 'camiseta_tecnica', 'sudadera', 'zapatillas_running'].includes(s))).toBe(false);
    }
    const gym = generateOutfits(wardrobe, ctx('gimnasio', day({ apparentMin: 14, apparentMax: 20 })), profile(), noHistory, { count: 2, seed: 6 });
    for (const o of gym.outfits) {
      const foot = o.items.find((i) => i.slot === 'footwear')!.garment;
      expect(foot.sport).toBe(true);
    }
  });

  it('honours mustInclude and excludeSubcategories ("cena formal sin zapatos")', () => {
    const r = generateOutfits(
      wardrobe,
      ctx('cena', day({ apparentMin: 12, apparentMax: 16 }), { mustInclude: ['jeans-black'], excludeSubcategories: new Set(['zapatos', 'tacones']) }),
      profile(),
      noHistory,
      { count: 3, seed: 7 },
    );
    expect(r.outfits.length).toBeGreaterThan(0);
    for (const o of r.outfits) {
      expect(ids(o)).toContain('jeans-black');
      expect(has(o, (s) => s === 'zapatos')).toBe(false);
    }
  });

  it('avoids repeating items worn yesterday', () => {
    const base = generateOutfits(wardrobe, ctx('universidad', day({})), profile(), noHistory, { count: 1, seed: 8 }).outfits[0]!;
    const history = { recentWear: [{ date: '2026-11-23', garmentIds: ids(base) }], rejectedSignatures: new Set<string>() };
    const next = generateOutfits(wardrobe, ctx('universidad', day({})), profile(), history, { count: 1, seed: 8 }).outfits[0]!;
    expect(next.signature).not.toBe(base.signature);
  });

  it('diversifies results', () => {
    const r = generateOutfits(wardrobe, ctx('dia_informal', day({})), profile(), noHistory, { count: 5, seed: 9 });
    const sigs = new Set(r.outfits.map((o) => o.signature));
    expect(sigs.size).toBe(r.outfits.length);
  });

  it('can swap a single slot keeping the rest', () => {
    const r = generateOutfits(wardrobe, ctx('trabajo', day({})), profile(), noHistory, { count: 1, seed: 10 });
    const o = r.outfits[0]!;
    const alts = rankAlternatives(o, 'bottom', wardrobe, ctx('trabajo', day({})), profile(), noHistory, 5);
    expect(alts.length).toBeGreaterThan(0);
    for (const a of alts) {
      expect(a.garment.layer).toBe('bottom');
      const rest = (x: ScoredOutfit) => x.items.filter((i) => i.slot !== 'bottom').map((i) => i.garment.id).sort();
      expect(rest(a.outfit)).toEqual(rest(o));
    }
  });

  it('reports a helpful warning when the wardrobe cannot produce outfits', () => {
    const r = generateOutfits([wardrobe.find((x) => x.id === 'sneakers')!], ctx('trabajo', day({})), profile(), noHistory, { count: 3, seed: 1 });
    expect(r.outfits).toHaveLength(0);
    expect(r.warnings.join(' ')).toMatch(/No hay/);
  });

  it('scales to a large wardrobe with bounded latency', () => {
    const big = Array.from({ length: 1500 }, (_, i) => {
      const t = wardrobe[i % wardrobe.length]!;
      return { ...t, id: `${t.id}-${i}` };
    });
    const r = generateOutfits(big, ctx('trabajo', day({})), profile(), noHistory, { count: 5, seed: 11 });
    expect(r.outfits.length).toBe(5);
    expect(r.stats.elapsedMs).toBeLessThan(2500);
  });

  it('builds a flat-lay layout inside the canvas', () => {
    const o = generateOutfits(wardrobe, ctx('trabajo', day({ apparentMin: 8, apparentMax: 14 })), profile(), noHistory, { count: 1, seed: 12 }).outfits[0]!;
    const layout = flatLayLayout(o);
    expect(layout.length).toBe(o.items.length);
    for (const b of layout) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(1.05);
      expect(b.y + b.h).toBeLessThanOrEqual(1.05);
    }
  });
});

describe('learning from feedback', () => {
  const wardrobe = testWardrobe();
  const context = ctx('dia_informal', day({}));

  it('rejections and acceptances change the subsequent ranking', () => {
    let p = profile();
    const first = generateOutfits(wardrobe, context, p, noHistory, { count: 5, seed: 20, explorationRate: 0 });
    const top = first.outfits[0]!;
    const challenger = first.outfits[2]!;
    // User rejects the top outfit twice and accepts / wears the third one.
    for (let i = 0; i < 2; i++) p = { ...p, learned: applyFeedback(p.learned, top, top.features, { kind: 'reject' }) };
    p = { ...p, learned: applyFeedback(p.learned, challenger, challenger.features, { kind: 'accept' }) };
    p = { ...p, learned: applyFeedback(p.learned, challenger, challenger.features, { kind: 'wear' }) };
    const before = { top: evaluateOutfit(top, context, profile(), noHistory).score, ch: evaluateOutfit(challenger, context, profile(), noHistory).score };
    const after = { top: evaluateOutfit(top, context, p, noHistory).score, ch: evaluateOutfit(challenger, context, p, noHistory).score };
    expect(after.top).toBeLessThan(before.top);
    expect(after.ch).toBeGreaterThan(before.ch);
    expect(after.ch).toBeGreaterThan(after.top);
    const second = generateOutfits(wardrobe, context, p, noHistory, { count: 5, seed: 20, explorationRate: 0 });
    expect(second.outfits[0]!.signature).not.toBe(top.signature);
  });

  it('learns style preferences from accepted outfits', () => {
    let p = profile();
    const streetOutfit = evaluateOutfit(
      { items: [{ slot: 'base', garment: wardrobe.find((x) => x.id === 'tee-graphic')! }, { slot: 'bottom', garment: wardrobe.find((x) => x.id === 'joggers')! }, { slot: 'footwear', garment: wardrobe.find((x) => x.id === 'sneakers')! }] },
      context,
      p,
      noHistory,
    );
    for (let i = 0; i < 5; i++) p = { ...p, learned: applyFeedback(p.learned, streetOutfit, streetOutfit.features, { kind: 'accept' }) };
    expect(p.learned.styleWeights.streetwear ?? 0).toBeGreaterThan(0.1);
    expect(p.learned.feedbackCount).toBe(5);
  });

  it('swap feedback moves item affinity', () => {
    const o = generateOutfits(wardrobe, context, profile(), noHistory, { count: 1, seed: 1 }).outfits[0]!;
    const removed = o.items.find((i) => i.slot === 'bottom')!.garment.id;
    const model = applyFeedback(emptyModel(), o, null, { kind: 'swap', removedId: removed, addedId: 'chinos' });
    expect(model.itemAffinity[removed]).toBeLessThan(0);
    expect(model.itemAffinity.chinos).toBeGreaterThan(0);
  });
});

describe('shopping', () => {
  const wardrobe = testWardrobe();
  const contexts = [ctx('universidad', day({})), ctx('trabajo', day({ apparentMin: 8, apparentMax: 14 }))];

  it('flags a near-duplicate of an owned garment as redundant', () => {
    const dup = g({ id: 'cand-dup', name: 'Camiseta blanca básica', category: 'top', subcategory: 'camiseta', hex: '#f7f7f7', isCandidate: true });
    const novel = g({ id: 'cand-new', name: 'Chaqueta verde oliva', category: 'outerwear', subcategory: 'chaqueta', hex: '#6b6b30', isCandidate: true });
    const simDup = findSimilarOwned(wardrobe, dup)[0];
    const simNew = findSimilarOwned(wardrobe, novel)[0];
    expect(simDup?.garment.id).toBe('tee-white');
    expect(simDup!.similarity).toBeGreaterThan(0.75);
    expect(simNew?.similarity ?? 0).toBeLessThan(simDup!.similarity);
  });

  it('does not rank buying a duplicate above a useful new piece', () => {
    const dup = g({ id: 'cand-dup2', name: 'Vaquero azul', category: 'bottom', subcategory: 'vaquero', hex: '#4c6686', materials: ['denim'], isCandidate: true });
    const useful = g({ id: 'cand-useful', name: 'Chubasquero azul marino', category: 'outerwear', subcategory: 'impermeable', hex: '#1f2a44', isCandidate: true });
    const score = (c: typeof dup) => {
      const ev = evaluateCandidate(wardrobe, c, contexts, profile(), { recentWear: [], rejectedSignatures: new Set() });
      const red = findSimilarOwned(wardrobe, c)[0]?.similarity ?? 0;
      return productScore({ newOutfits: ev.newOutfits, partners: ev.partners.length, styleMatch: 0.6, redundancy: red, priceEur: 40, budget: { min: null, max: 80 }, brand: null, favoriteBrands: [], sizeAvailable: true, dataQuality: 1, isStale: false }).score;
    };
    expect(score(useful)).toBeGreaterThan(score(dup));
  });

  it('estimates how many new outfits a purchase enables', () => {
    const cand = g({ id: 'cand-jacket', name: 'Chaqueta beige', category: 'outerwear', subcategory: 'chaqueta', hex: '#cdb894', isCandidate: true });
    const ev = evaluateCandidate(wardrobe, cand, contexts, profile(), { recentWear: [], rejectedSignatures: new Set() });
    expect(ev.newOutfits).toBeGreaterThan(0);
    expect(ev.outfits.every((o) => o.items.some((i) => i.garment.id === 'cand-jacket'))).toBe(true);
    expect(ev.partners.length).toBeGreaterThan(0);
  });

  it('gap analysis suggests pieces the wardrobe lacks, not duplicates', () => {
    const gaps = wardrobeGaps(wardrobe, contexts, profile(), { recentWear: [], rejectedSignatures: new Set() }, { limit: 6 });
    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps.some((x) => x.key === 'camiseta:blanco')).toBe(false); // already owned
    for (const gap of gaps) expect(gap.reason).toMatch(/podrías crear \d+ conjunto/);
  });

  it('never uses affiliate commission in the score', () => {
    const base = { newOutfits: 5, partners: 6, styleMatch: 0.7, redundancy: 0.2, priceEur: 50, budget: { min: null, max: 80 }, brand: 'X', favoriteBrands: [], sizeAvailable: true, dataQuality: 1, isStale: false };
    const s = productScore(base);
    expect(Object.keys(s.breakdown)).not.toContain('comision');
  });
});
