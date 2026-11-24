/** Latency benchmark of outfit generation vs. wardrobe size. Run: pnpm --filter @dressit/stylist-engine bench */
import { getOccasion, SUBCATEGORIES, COLOR_FAMILIES } from '@dressit/shared';
import { generateOutfits } from '../src/generate.ts';
import { emptyModel } from '../src/learning.ts';
import { toEngineGarment } from '../src/normalize.ts';
import { createRng } from '../src/rng.ts';

const rng = createRng(1);
const subs = SUBCATEGORIES.filter((s) => s.category !== 'swimwear');
function wardrobe(n: number) {
  return Array.from({ length: n }, (_, i) => {
    const s = subs[Math.floor(rng() * subs.length)]!;
    const c = COLOR_FAMILIES[Math.floor(rng() * COLOR_FAMILIES.length)]!;
    return toEngineGarment({ id: `g${i}`, name: `${s.label} ${c.label}`, category: s.category, subcategory: s.id, colors: [{ hex: c.hex, share: 1 }] });
  });
}
const ctx = {
  date: '2026-11-24',
  occasion: getOccasion('trabajo')!,
  weather: { apparentMin: 8, apparentMax: 16, tempAtStart: 9, tempAtEnd: 15, precipProbMax: 60, precipSum: 3, windMax: 15, humidityAvg: 70, uvMax: 2, rainFromHour: 16 },
  season: 'otono' as const,
  indoorShare: 0.85,
  adjustments: { formality: 0 as const, warmth: 0 as const, elegance: 0 as const },
  mustInclude: [],
  exclude: new Set<string>(),
  excludeSubcategories: new Set<string>(),
  temperatureSensitivity: 0,
};
const profile = { preferredStyles: [], favoriteColors: [], avoidedColors: [], fitPreferences: {}, priorities: { comfort: 0.34, elegance: 0.33, practicality: 0.33 }, learned: emptyModel() };
console.log('| Prendas | p50 (ms) | p95 (ms) | Candidatos evaluados |\n|---|---|---|---|');
for (const n of [30, 100, 300, 1000, 3000]) {
  const w = wardrobe(n);
  const times: number[] = [];
  let evaluated = 0;
  for (let i = 0; i < 15; i++) {
    const t0 = performance.now();
    const r = generateOutfits(w, ctx, profile, { recentWear: [], rejectedSignatures: new Set() }, { count: 4, seed: i });
    times.push(performance.now() - t0);
    evaluated = r.stats.candidatesEvaluated;
  }
  times.sort((a, b) => a - b);
  console.log(`| ${n} | ${times[7]!.toFixed(1)} | ${times[14]!.toFixed(1)} | ${evaluated} |`);
}
