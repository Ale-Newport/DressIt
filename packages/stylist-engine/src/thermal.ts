import type { DayConditions, EngineContext, EngineGarment, OutfitCandidate, ThermalAssessment } from './types.ts';

/**
 * Required clothing insulation (clo) for a light activity level (~1.2–1.6 met:
 * walking/commuting/standing) as a function of apparent temperature.
 *
 * Anchored on ASHRAE 55 typical ensembles (≈0.5 clo summer comfort around
 * 24–26 °C operative, ≈1.0 clo winter indoor at ~20 °C) and extended outdoors
 * following the feels-like heuristic in docs/research/stack-tecnologico.md
 * (0.2–0.4 clo at ≥ 27 °C up to ≈1.65 clo near 0 °C), so it stays consistent
 * with the per-garment ASHRAE/ISO 9920 values in the vocabulary.
 * Values are a pragmatic piecewise-linear fit, documented in docs/recomendaciones.md.
 */
const REQUIRED_CLO_TABLE: ReadonlyArray<readonly [number, number]> = [
  [-10, 2.1],
  [-5, 1.85],
  [0, 1.65],
  [5, 1.4],
  [10, 1.15],
  [14, 0.95],
  [18, 0.75],
  [22, 0.55],
  [26, 0.42],
  [30, 0.32],
  [35, 0.28],
];

/** Indoor air temperature assumed for the indoor share of the day. */
export const INDOOR_TEMPERATURE = 21;

export function requiredClo(apparentTemp: number, sensitivity = 0): number {
  const t = REQUIRED_CLO_TABLE;
  let value: number;
  if (apparentTemp <= t[0]![0]) value = t[0]![1];
  else if (apparentTemp >= t[t.length - 1]![0]) value = t[t.length - 1]![1];
  else {
    value = t[t.length - 1]![1];
    for (let i = 0; i < t.length - 1; i++) {
      const [x0, y0] = t[i]!;
      const [x1, y1] = t[i + 1]!;
      if (apparentTemp >= x0 && apparentTemp <= x1) {
        value = y0 + ((apparentTemp - x0) / (x1 - x0)) * (y1 - y0);
        break;
      }
    }
  }
  // Each sensitivity step ≈ 2 °C of perceived temperature shift.
  return Math.max(0.25, value + sensitivity * 0.12);
}

/** McCullough & Jones summation formula for ensemble insulation (ISO 9920 annex). */
export function ensembleClo(garmentClos: number[]): number {
  if (garmentClos.length === 0) return 0;
  const sum = garmentClos.reduce((a, b) => a + b, 0);
  return 0.835 * sum + 0.161;
}

export function isRemovable(slot: string, outfit: OutfitCandidate): boolean {
  if (slot === 'outer') return true;
  if (slot === 'mid') return outfit.items.some((i) => i.slot === 'base');
  if (slot === 'accessory:neck' || slot === 'accessory:head' || slot === 'accessory:hands') return true;
  return false;
}

/** Apparent temperatures used for the cold and warm ends of the day, including the warmth adjustment. */
export function effectiveRange(weather: DayConditions, ctx: EngineContext): { cold: number; warm: number } {
  const shift = ctx.adjustments.warmth * -3; // "más abrigado" = dress as if 3 °C colder
  return { cold: weather.apparentMin + shift, warm: weather.apparentMax + shift };
}

export function assessThermal(outfit: OutfitCandidate, ctx: EngineContext): ThermalAssessment | null {
  const weather = ctx.weather;
  if (!weather) return null;
  const all = outfit.items.map((i) => i.garment.clo);
  const core = outfit.items.filter((i) => !isRemovable(i.slot, outfit)).map((i) => i.garment.clo);
  const cloAll = ensembleClo(all);
  const cloCore = ensembleClo(core);
  const { cold, warm } = effectiveRange(weather, ctx);
  const outdoor = 1 - ctx.indoorShare;
  const requiredCold = requiredClo(cold, ctx.temperatureSensitivity);
  // Warm end: blend outdoor warm peak and indoor temperature by time share.
  const requiredWarm =
    outdoor * requiredClo(warm, ctx.temperatureSensitivity) +
    (1 - outdoor) * requiredClo(Math.max(INDOOR_TEMPERATURE, warm - 2), ctx.temperatureSensitivity);
  // When mostly indoors, the cold requirement only applies to the commute.
  const coldDeficit = Math.max(0, requiredCold - cloAll);
  const hotExcess = Math.max(0, cloCore - requiredWarm);
  const hasRemovableLayer = outfit.items.some((i) => isRemovable(i.slot, outfit) && i.garment.clo >= 0.15);
  const rainProtected = outfit.items.some(
    (i) => (i.slot === 'outer' && i.garment.waterproof) || i.slot === 'accessory:umbrella',
  );
  const rainExposure = (weather.precipProbMax / 100) * (0.35 + 0.65 * outdoor);
  return { cloAll, cloCore, requiredCold, requiredWarm, coldDeficit, hotExcess, hasRemovableLayer, rainProtected, rainExposure };
}

const gauss = (x: number, sigma: number) => Math.exp(-(x * x) / (2 * sigma * sigma));

/**
 * Weather suitability 0–1: thermal comfort across the whole day window,
 * rain protection, heat + humidity breathability and rain-sensitive materials.
 */
export function weatherScore(outfit: OutfitCandidate, ctx: EngineContext, thermal: ThermalAssessment | null): number {
  const weather = ctx.weather;
  if (!weather || !thermal) return seasonFallbackScore(outfit, ctx);
  const cold = gauss(thermal.coldDeficit, 0.22);
  const hot = gauss(thermal.hotExcess, 0.3);
  let score = cold * hot;

  // Large temperature swing: reward a removable layer.
  const swing = weather.apparentMax - weather.apparentMin;
  if (swing >= 6 && weather.apparentMin < 18) score *= thermal.hasRemovableLayer ? 1 : 0.85;

  // Rain.
  if (thermal.rainExposure >= 0.25) {
    const sensitive = Math.max(
      0,
      ...outfit.items.filter((i) => i.slot === 'footwear' || i.slot === 'outer' || i.slot === 'bottom').map((i) => i.garment.rainSensitivity),
    );
    const protection = thermal.rainProtected ? 1 : 0.7;
    const footwearOk = outfit.items.some((i) => i.slot === 'footwear' && (i.garment.waterproof || i.garment.rainSensitivity <= 0.4));
    score *= protection * (1 - 0.45 * sensitive * thermal.rainExposure) * (footwearOk ? 1 : 0.9);
  }

  // Heat + humidity: breathability matters.
  if (weather.apparentMax >= 26) {
    const core = outfit.items.filter((i) => !i.slot.startsWith('accessory'));
    const breath = core.reduce((a, i) => a + i.garment.breathability, 0) / Math.max(1, core.length);
    const humidityFactor = weather.humidityAvg >= 60 ? 1 : 0.6;
    score *= 1 - humidityFactor * 0.35 * (1 - breath);
  }
  return clamp01(score);
}

/** Without forecast: use the season and each garment's comfortable temperature range. */
function seasonFallbackScore(outfit: OutfitCandidate, ctx: EngineContext): number {
  const typical: Record<string, number> = { invierno: 9, primavera: 17, verano: 27, otono: 16 };
  const t = typical[ctx.season] ?? 17;
  const core = outfit.items.filter((i) => !i.slot.startsWith('accessory'));
  const fits = core.map((i) => {
    const [lo, hi] = i.garment.tempRange;
    if (i.slot === 'outer' && t > hi) return 0.5;
    if (t < lo) return gauss(lo - t, 6);
    if (t > hi) return gauss(t - hi, 6);
    return 1;
  });
  return clamp01(fits.reduce((a, b) => a + b, 0) / Math.max(1, fits.length));
}

export function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** Per-garment unary weather suitability (used to prune pools before combinatorics). */
export function garmentWeatherFit(g: EngineGarment, ctx: EngineContext): number {
  const w = ctx.weather;
  const shift = ctx.adjustments.warmth * -3;
  const tLow = w ? w.apparentMin + shift : ({ invierno: 6, primavera: 13, verano: 23, otono: 12 }[ctx.season] ?? 14);
  const tHigh = w ? w.apparentMax + shift : tLow + 8;
  const [lo, hi] = g.tempRange;
  if (g.layer === 'outer') {
    // Outerwear only has to fit the cold end (it can be removed).
    if (tLow > hi + 4) return gauss(tLow - hi - 4, 4);
    if (tLow < lo) return gauss(lo - tLow, 5);
    return 1;
  }
  const mid = (tLow + tHigh) / 2;
  if (mid < lo) return gauss(lo - mid, 5);
  if (mid > hi) return gauss(mid - hi, 5);
  return 1;
}
