import type { AccessorySlot, Category, Fit, Lab, Layer, OccasionDef, Season, StyleId } from '@dressit/shared';

/** A garment as seen by the engine (normalised, defaults resolved). */
export interface EngineGarment {
  id: string;
  name: string;
  category: Category;
  subcategory: string;
  layer: Layer;
  accessorySlot?: AccessorySlot;
  /** Dominant colors; shares sum ≈ 1. */
  colors: Array<{ lab: Lab; family: string; share: number }>;
  pattern: string | null;
  materials: string[];
  /** Style affinity vector (resolved from tags + subcategory defaults), keyed by style id. */
  styleVector: Partial<Record<StyleId, number>>;
  formality: number;
  clo: number;
  waterproof: boolean;
  breathability: number;
  rainSensitivity: number;
  fit: Fit | null;
  seasons: Season[];
  tempRange: readonly [number, number];
  sport: boolean;
  /** Mid layers that can be worn without a base layer (jersey, sudadera…). */
  wearableAlone: boolean;
  favorite: boolean;
  wearCount: number;
  lastWornOn: string | null;
  createdAt: string;
  embedding?: ArrayLike<number> | null;
  /** True for a product being simulated before purchase. */
  isCandidate?: boolean;
  /** Width ÷ height of the garment's (cutout) image, for the flat lay. */
  imageAspect?: number | null;
}

/** Weather over the user's day window (apparent temperature already includes wind chill). */
export interface DayConditions {
  apparentMin: number;
  apparentMax: number;
  tempAtStart: number;
  tempAtEnd: number;
  /** 0–100 */
  precipProbMax: number;
  precipSum: number;
  /** km/h */
  windMax: number;
  humidityAvg: number;
  uvMax: number;
  /** Hour (local, 0–23) when rain probability first reaches 40 %, if any. */
  rainFromHour: number | null;
}

export interface Adjustments {
  formality: -1 | 0 | 1;
  warmth: -1 | 0 | 1;
  elegance: 0 | 1;
}

export interface EngineContext {
  date: string;
  occasion: OccasionDef;
  weather: DayConditions | null;
  season: Season;
  /** Share of the day spent indoors (0–1). */
  indoorShare: number;
  adjustments: Adjustments;
  mustInclude: string[];
  exclude: ReadonlySet<string>;
  excludeSubcategories: ReadonlySet<string>;
  /** −2 (always warm) … +2 (always cold). */
  temperatureSensitivity: number;
}

export const FEATURES = [
  'color',
  'pattern',
  'style',
  'formality',
  'occasionStyle',
  'weather',
  'material',
  'silhouette',
  'personal',
  'affinity',
  'rotation',
  'visual',
] as const;
export type FeatureName = (typeof FEATURES)[number];
export type FeatureVector = Record<FeatureName, number>;

export interface LearnedModel {
  /** Ranking weights per feature (logistic-regression coefficients, ≥ 0.05). */
  weights: Partial<Record<FeatureName, number>>;
  bias: number;
  styleWeights: Partial<Record<StyleId, number>>;
  colorWeights: Record<string, number>;
  itemAffinity: Record<string, number>;
  pairAffinity: Record<string, number>;
  feedbackCount: number;
  /** Mean embedding of garments in liked outfits (optional). */
  likedCentroid?: number[] | null;
}

export interface EngineProfile {
  preferredStyles: StyleId[];
  favoriteColors: string[];
  avoidedColors: string[];
  fitPreferences: { top?: Fit; bottom?: Fit };
  priorities: { comfort: number; elegance: number; practicality: number };
  learned: LearnedModel;
}

export interface WearRecord {
  date: string;
  garmentIds: string[];
}

export interface EngineHistory {
  recentWear: WearRecord[];
  /** Signatures of outfits rejected recently (never re-suggest the identical combination). */
  rejectedSignatures: ReadonlySet<string>;
}

export type Slot = 'base' | 'mid' | 'outer' | 'bottom' | 'one_piece' | 'footwear' | `accessory:${AccessorySlot}`;

export interface OutfitCandidate {
  items: Array<{ slot: Slot; garment: EngineGarment }>;
}

export interface ScoredOutfit extends OutfitCandidate {
  signature: string;
  features: FeatureVector;
  /** Weighted score normalised to 0–1. */
  score: number;
  /** Per-feature contribution w·(f−0.5) — used for explanations. */
  contributions: FeatureVector;
  thermal: ThermalAssessment | null;
  isExploration: boolean;
  explanation: string[];
  weatherNote: string | null;
  formality: number;
  styleMatch: number;
  dominantStyle: StyleId | null;
}

export interface ThermalAssessment {
  cloAll: number;
  cloCore: number;
  requiredCold: number;
  requiredWarm: number;
  coldDeficit: number;
  hotExcess: number;
  hasRemovableLayer: boolean;
  rainProtected: boolean;
  rainExposure: number;
}

export interface GenerateOptions {
  count: number;
  seed: number;
  /** Probability of including one exploration outfit. */
  explorationRate?: number;
  /** MMR trade-off between relevance and diversity (1 = only relevance). */
  diversityLambda?: number;
  /** Outfits scoring below max(minScore, 0.7 × best) are not shown (default 0.45). */
  minScore?: number;
  /** Beam sizes (exposed for benchmarks). */
  beam?: Partial<{ perPool: number; cores: number; finals: number }>;
}

export interface GenerateResult {
  outfits: ScoredOutfit[];
  warnings: string[];
  stats: { candidatesEvaluated: number; poolSizes: Record<string, number>; elapsedMs: number };
}
