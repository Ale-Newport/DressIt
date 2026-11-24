/**
 * Domain vocabulary shared by the mobile app, the API, the stylist engine and
 * (mirrored in Python) the vision service. IDs are stable ASCII snake_case;
 * labels are Spanish (es-ES). i18n of labels lives in the mobile app.
 */

// ---------------------------------------------------------------------------
// Categories, layers and subcategories
// ---------------------------------------------------------------------------

export const CATEGORIES = ['top', 'bottom', 'one_piece', 'outerwear', 'footwear', 'accessory', 'swimwear'] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  top: 'Partes de arriba',
  bottom: 'Partes de abajo',
  one_piece: 'Vestidos y monos',
  outerwear: 'Abrigos y chaquetas',
  footwear: 'Calzado',
  accessory: 'Complementos',
  swimwear: 'Baño',
};

/** Physical layer an item occupies in an outfit. */
export const LAYERS = ['base', 'mid', 'outer', 'bottom', 'one_piece', 'footwear', 'accessory', 'swim'] as const;
export type Layer = (typeof LAYERS)[number];

/** Accessory sub-slots: an outfit carries at most one item per slot. */
export const ACCESSORY_SLOTS = ['neck', 'head', 'bag', 'waist', 'eyes', 'wrist', 'jewelry', 'hands', 'umbrella'] as const;
export type AccessorySlot = (typeof ACCESSORY_SLOTS)[number];

export interface SubcategoryDef {
  id: string;
  label: string;
  category: Category;
  layer: Layer;
  accessorySlot?: AccessorySlot;
  /**
   * Typical intrinsic clothing insulation (clo) per ISO 9920 / ASHRAE 55 garment
   * tables (rounded). Ensemble insulation is estimated with McCullough's
   * summation formula in the stylist engine.
   */
  clo: number;
  /** Default formality 0–100 when the image/user does not tell us otherwise. */
  formality: number;
  /** Default style affinities (0–1). */
  styles: Partial<Record<StyleId, number>>;
  /** Comfortable apparent-temperature range in °C for the garment alone (soft bounds). */
  tempRange: readonly [number, number];
  waterproof?: boolean;
  /** 0–1: how well it ventilates in heat/humidity. */
  breathability: number;
  /** Rain sensitivity 0–1 (canvas sneakers, suede…). */
  rainSensitive?: number;
  /** Activity suitability, used for sport occasions. */
  sport?: boolean;
  /** Visual weight used by the flat-lay composer (relative size). */
  visualScale: number;
}

export const STYLES = [
  'casual',
  'formal',
  'deportivo',
  'streetwear',
  'elegante',
  'minimalista',
  'clasico',
  'bohemio',
  'romantico',
  'rockero',
  'preppy',
  'vintage',
  'utilitario',
  'athleisure',
] as const;
export type StyleId = (typeof STYLES)[number];

export const STYLE_LABELS: Record<StyleId, string> = {
  casual: 'Casual',
  formal: 'Formal',
  deportivo: 'Deportivo',
  streetwear: 'Streetwear',
  elegante: 'Elegante',
  minimalista: 'Minimalista',
  clasico: 'Clásico (old money)',
  bohemio: 'Bohemio',
  romantico: 'Romántico',
  rockero: 'Rockero',
  preppy: 'Preppy',
  vintage: 'Vintage',
  utilitario: 'Utilitario',
  athleisure: 'Athleisure',
};

const s = (styles: Partial<Record<StyleId, number>>) => styles;

export const SUBCATEGORIES = [
  // --- Tops (base layer)
  { id: 'camiseta', label: 'Camiseta', category: 'top', layer: 'base', clo: 0.08, formality: 20, styles: s({ casual: 1, minimalista: 0.6, streetwear: 0.6 }), tempRange: [18, 40], breathability: 0.9, visualScale: 1 },
  { id: 'camiseta_manga_larga', label: 'Camiseta de manga larga', category: 'top', layer: 'base', clo: 0.12, formality: 22, styles: s({ casual: 1, minimalista: 0.6 }), tempRange: [12, 26], breathability: 0.8, visualScale: 1 },
  { id: 'camiseta_tecnica', label: 'Camiseta técnica', category: 'top', layer: 'base', clo: 0.07, formality: 5, styles: s({ deportivo: 1, athleisure: 0.7 }), tempRange: [10, 40], breathability: 1, sport: true, visualScale: 1 },
  { id: 'polo', label: 'Polo', category: 'top', layer: 'base', clo: 0.12, formality: 40, styles: s({ preppy: 1, casual: 0.7, clasico: 0.6 }), tempRange: [17, 34], breathability: 0.8, visualScale: 1 },
  { id: 'camisa', label: 'Camisa', category: 'top', layer: 'base', clo: 0.25, formality: 65, styles: s({ clasico: 0.9, formal: 0.7, elegante: 0.6, preppy: 0.6, minimalista: 0.5 }), tempRange: [12, 28], breathability: 0.7, visualScale: 1 },
  { id: 'camisa_manga_corta', label: 'Camisa de manga corta', category: 'top', layer: 'base', clo: 0.19, formality: 45, styles: s({ casual: 0.8, bohemio: 0.4, clasico: 0.4 }), tempRange: [20, 36], breathability: 0.85, visualScale: 1 },
  { id: 'sobrecamisa', label: 'Sobrecamisa', category: 'top', layer: 'mid', clo: 0.3, formality: 40, styles: s({ utilitario: 1, casual: 0.8, streetwear: 0.4 }), tempRange: [10, 22], breathability: 0.6, visualScale: 1.05 },
  { id: 'blusa', label: 'Blusa', category: 'top', layer: 'base', clo: 0.17, formality: 60, styles: s({ elegante: 0.8, romantico: 0.7, clasico: 0.6 }), tempRange: [15, 32], breathability: 0.8, visualScale: 1 },
  { id: 'top', label: 'Top', category: 'top', layer: 'base', clo: 0.06, formality: 35, styles: s({ casual: 0.7, romantico: 0.4, streetwear: 0.4 }), tempRange: [22, 40], breathability: 0.95, visualScale: 0.85 },
  { id: 'body', label: 'Body', category: 'top', layer: 'base', clo: 0.1, formality: 45, styles: s({ elegante: 0.6, minimalista: 0.6 }), tempRange: [16, 32], breathability: 0.7, visualScale: 0.9 },
  // --- Tops (mid layer)
  { id: 'jersey', label: 'Jersey', category: 'top', layer: 'mid', clo: 0.28, formality: 45, styles: s({ clasico: 0.8, casual: 0.8, minimalista: 0.6, preppy: 0.5 }), tempRange: [4, 18], breathability: 0.5, visualScale: 1.05 },
  { id: 'jersey_grueso', label: 'Jersey grueso', category: 'top', layer: 'mid', clo: 0.36, formality: 35, styles: s({ casual: 0.9, clasico: 0.5 }), tempRange: [-5, 13], breathability: 0.35, visualScale: 1.1 },
  { id: 'sudadera', label: 'Sudadera', category: 'top', layer: 'mid', clo: 0.34, formality: 15, styles: s({ streetwear: 1, casual: 0.9, athleisure: 0.8, deportivo: 0.5 }), tempRange: [6, 19], breathability: 0.45, visualScale: 1.1 },
  { id: 'cardigan', label: 'Cárdigan', category: 'top', layer: 'mid', clo: 0.25, formality: 50, styles: s({ clasico: 0.7, romantico: 0.6, vintage: 0.5, preppy: 0.5 }), tempRange: [8, 20], breathability: 0.55, visualScale: 1.05 },
  { id: 'chaleco_punto', label: 'Chaleco de punto', category: 'top', layer: 'mid', clo: 0.13, formality: 50, styles: s({ preppy: 0.9, vintage: 0.7, clasico: 0.6 }), tempRange: [10, 20], breathability: 0.6, visualScale: 0.95 },
  // --- Bottoms
  { id: 'pantalon', label: 'Pantalón', category: 'bottom', layer: 'bottom', clo: 0.24, formality: 60, styles: s({ clasico: 0.7, minimalista: 0.7, elegante: 0.5, casual: 0.5 }), tempRange: [5, 30], breathability: 0.6, visualScale: 1.2 },
  { id: 'pantalon_vestir', label: 'Pantalón de vestir', category: 'bottom', layer: 'bottom', clo: 0.25, formality: 78, styles: s({ formal: 1, elegante: 0.8, clasico: 0.8 }), tempRange: [5, 28], breathability: 0.6, visualScale: 1.2 },
  { id: 'vaquero', label: 'Vaquero', category: 'bottom', layer: 'bottom', clo: 0.26, formality: 35, styles: s({ casual: 1, streetwear: 0.6, rockero: 0.5, vintage: 0.4, minimalista: 0.4 }), tempRange: [3, 27], breathability: 0.45, visualScale: 1.2 },
  { id: 'chino', label: 'Chino', category: 'bottom', layer: 'bottom', clo: 0.24, formality: 55, styles: s({ preppy: 0.9, clasico: 0.8, casual: 0.7 }), tempRange: [8, 29], breathability: 0.6, visualScale: 1.2 },
  { id: 'pantalon_corto', label: 'Pantalón corto', category: 'bottom', layer: 'bottom', clo: 0.06, formality: 15, styles: s({ casual: 1, deportivo: 0.4 }), tempRange: [21, 42], breathability: 0.95, visualScale: 0.8 },
  { id: 'bermuda', label: 'Bermuda', category: 'bottom', layer: 'bottom', clo: 0.08, formality: 25, styles: s({ casual: 1, preppy: 0.5 }), tempRange: [20, 40], breathability: 0.9, visualScale: 0.85 },
  { id: 'falda', label: 'Falda', category: 'bottom', layer: 'bottom', clo: 0.14, formality: 55, styles: s({ romantico: 0.7, elegante: 0.6, clasico: 0.5 }), tempRange: [14, 34], breathability: 0.8, visualScale: 1 },
  { id: 'falda_larga', label: 'Falda larga', category: 'bottom', layer: 'bottom', clo: 0.18, formality: 55, styles: s({ bohemio: 0.9, romantico: 0.6, elegante: 0.5 }), tempRange: [10, 32], breathability: 0.75, visualScale: 1.2 },
  { id: 'leggings', label: 'Leggings', category: 'bottom', layer: 'bottom', clo: 0.14, formality: 10, styles: s({ deportivo: 0.9, athleisure: 1 }), tempRange: [5, 28], breathability: 0.7, sport: true, visualScale: 1.1 },
  { id: 'jogger', label: 'Jogger', category: 'bottom', layer: 'bottom', clo: 0.25, formality: 10, styles: s({ athleisure: 1, streetwear: 0.8, deportivo: 0.7 }), tempRange: [4, 24], breathability: 0.6, sport: true, visualScale: 1.15 },
  { id: 'pantalon_deportivo_corto', label: 'Pantalón corto deportivo', category: 'bottom', layer: 'bottom', clo: 0.05, formality: 5, styles: s({ deportivo: 1 }), tempRange: [12, 42], breathability: 1, sport: true, visualScale: 0.75 },
  // --- One piece
  { id: 'vestido', label: 'Vestido', category: 'one_piece', layer: 'one_piece', clo: 0.25, formality: 60, styles: s({ elegante: 0.8, romantico: 0.7, minimalista: 0.4 }), tempRange: [16, 34], breathability: 0.8, visualScale: 1.6 },
  { id: 'vestido_punto', label: 'Vestido de punto', category: 'one_piece', layer: 'one_piece', clo: 0.4, formality: 50, styles: s({ minimalista: 0.7, clasico: 0.6, casual: 0.5 }), tempRange: [4, 18], breathability: 0.45, visualScale: 1.6 },
  { id: 'vestido_fiesta', label: 'Vestido de fiesta', category: 'one_piece', layer: 'one_piece', clo: 0.22, formality: 90, styles: s({ elegante: 1, formal: 0.8 }), tempRange: [16, 34], breathability: 0.7, visualScale: 1.7 },
  { id: 'mono', label: 'Mono', category: 'one_piece', layer: 'one_piece', clo: 0.3, formality: 50, styles: s({ utilitario: 0.6, elegante: 0.5, casual: 0.5 }), tempRange: [14, 32], breathability: 0.7, visualScale: 1.6 },
  { id: 'traje_chandal', label: 'Chándal (conjunto)', category: 'one_piece', layer: 'one_piece', clo: 0.55, formality: 5, styles: s({ deportivo: 1, athleisure: 0.8 }), tempRange: [5, 20], breathability: 0.6, sport: true, visualScale: 1.6 },
  // --- Outerwear
  { id: 'americana', label: 'Americana / blazer', category: 'outerwear', layer: 'outer', clo: 0.36, formality: 82, styles: s({ formal: 0.9, elegante: 0.9, clasico: 0.9, minimalista: 0.5 }), tempRange: [10, 24], breathability: 0.5, visualScale: 1.15 },
  { id: 'chaqueta', label: 'Chaqueta', category: 'outerwear', layer: 'outer', clo: 0.38, formality: 45, styles: s({ casual: 0.8, utilitario: 0.5 }), tempRange: [8, 20], breathability: 0.5, visualScale: 1.15 },
  { id: 'cazadora_vaquera', label: 'Cazadora vaquera', category: 'outerwear', layer: 'outer', clo: 0.35, formality: 30, styles: s({ casual: 1, vintage: 0.6, rockero: 0.4 }), tempRange: [12, 23], breathability: 0.45, visualScale: 1.1 },
  { id: 'chaqueta_cuero', label: 'Chaqueta de cuero', category: 'outerwear', layer: 'outer', clo: 0.42, formality: 45, styles: s({ rockero: 1, streetwear: 0.5, casual: 0.5 }), tempRange: [8, 20], breathability: 0.25, rainSensitive: 0.3, visualScale: 1.1 },
  { id: 'bomber', label: 'Bomber', category: 'outerwear', layer: 'outer', clo: 0.4, formality: 30, styles: s({ streetwear: 1, casual: 0.7 }), tempRange: [7, 19], breathability: 0.35, visualScale: 1.15 },
  { id: 'gabardina', label: 'Gabardina', category: 'outerwear', layer: 'outer', clo: 0.55, formality: 72, styles: s({ clasico: 1, elegante: 0.8, minimalista: 0.5 }), tempRange: [7, 19], waterproof: true, breathability: 0.4, visualScale: 1.5 },
  { id: 'abrigo', label: 'Abrigo', category: 'outerwear', layer: 'outer', clo: 0.7, formality: 72, styles: s({ clasico: 0.9, elegante: 0.9, minimalista: 0.6 }), tempRange: [-5, 12], breathability: 0.25, visualScale: 1.5 },
  { id: 'parka', label: 'Parka', category: 'outerwear', layer: 'outer', clo: 0.8, formality: 30, styles: s({ utilitario: 0.9, casual: 0.8 }), tempRange: [-10, 10], waterproof: true, breathability: 0.25, visualScale: 1.45 },
  { id: 'plumifero', label: 'Plumífero', category: 'outerwear', layer: 'outer', clo: 0.9, formality: 25, styles: s({ casual: 0.8, deportivo: 0.4, streetwear: 0.5 }), tempRange: [-15, 8], breathability: 0.2, visualScale: 1.35 },
  { id: 'impermeable', label: 'Chubasquero / impermeable', category: 'outerwear', layer: 'outer', clo: 0.3, formality: 20, styles: s({ utilitario: 0.8, deportivo: 0.6, casual: 0.6 }), tempRange: [5, 22], waterproof: true, breathability: 0.35, visualScale: 1.2 },
  { id: 'chaleco_acolchado', label: 'Chaleco acolchado', category: 'outerwear', layer: 'outer', clo: 0.25, formality: 35, styles: s({ preppy: 0.7, utilitario: 0.6, casual: 0.6 }), tempRange: [6, 17], breathability: 0.45, visualScale: 1 },
  { id: 'chaqueta_deportiva', label: 'Chaqueta deportiva', category: 'outerwear', layer: 'outer', clo: 0.3, formality: 10, styles: s({ deportivo: 1, athleisure: 0.7 }), tempRange: [5, 20], breathability: 0.6, sport: true, visualScale: 1.1 },
  // --- Footwear
  { id: 'zapatillas', label: 'Zapatillas', category: 'footwear', layer: 'footwear', clo: 0.03, formality: 22, styles: s({ casual: 1, streetwear: 0.8, minimalista: 0.5, athleisure: 0.6 }), tempRange: [-2, 34], breathability: 0.6, rainSensitive: 0.4, visualScale: 0.7 },
  { id: 'zapatillas_lona', label: 'Zapatillas de lona', category: 'footwear', layer: 'footwear', clo: 0.02, formality: 18, styles: s({ casual: 1, vintage: 0.5 }), tempRange: [10, 34], breathability: 0.8, rainSensitive: 0.9, visualScale: 0.7 },
  { id: 'zapatillas_running', label: 'Zapatillas deportivas (running/training)', category: 'footwear', layer: 'footwear', clo: 0.03, formality: 5, styles: s({ deportivo: 1, athleisure: 0.8 }), tempRange: [-5, 38], breathability: 0.9, rainSensitive: 0.5, sport: true, visualScale: 0.7 },
  { id: 'botas', label: 'Botas', category: 'footwear', layer: 'footwear', clo: 0.1, formality: 45, styles: s({ casual: 0.6, rockero: 0.6, utilitario: 0.6 }), tempRange: [-15, 16], breathability: 0.3, waterproof: true, visualScale: 0.85 },
  { id: 'botines', label: 'Botines', category: 'footwear', layer: 'footwear', clo: 0.06, formality: 58, styles: s({ clasico: 0.7, elegante: 0.6, rockero: 0.4 }), tempRange: [-5, 20], breathability: 0.35, rainSensitive: 0.3, visualScale: 0.75 },
  { id: 'zapatos', label: 'Zapatos (oxford/derby)', category: 'footwear', layer: 'footwear', clo: 0.04, formality: 85, styles: s({ formal: 1, clasico: 0.9, elegante: 0.8 }), tempRange: [-5, 30], breathability: 0.4, rainSensitive: 0.4, visualScale: 0.7 },
  { id: 'mocasines', label: 'Mocasines', category: 'footwear', layer: 'footwear', clo: 0.03, formality: 70, styles: s({ clasico: 1, preppy: 0.8, elegante: 0.6 }), tempRange: [8, 32], breathability: 0.5, rainSensitive: 0.5, visualScale: 0.7 },
  { id: 'tacones', label: 'Zapatos de tacón', category: 'footwear', layer: 'footwear', clo: 0.02, formality: 85, styles: s({ elegante: 1, formal: 0.8 }), tempRange: [10, 34], breathability: 0.5, rainSensitive: 0.5, visualScale: 0.7 },
  { id: 'bailarinas', label: 'Bailarinas', category: 'footwear', layer: 'footwear', clo: 0.02, formality: 55, styles: s({ romantico: 0.8, clasico: 0.6, minimalista: 0.5 }), tempRange: [12, 32], breathability: 0.6, rainSensitive: 0.6, visualScale: 0.65 },
  { id: 'sandalias', label: 'Sandalias', category: 'footwear', layer: 'footwear', clo: 0.02, formality: 30, styles: s({ casual: 0.8, bohemio: 0.8 }), tempRange: [20, 42], breathability: 1, rainSensitive: 0.9, visualScale: 0.65 },
  { id: 'alpargatas', label: 'Alpargatas', category: 'footwear', layer: 'footwear', clo: 0.02, formality: 30, styles: s({ casual: 0.8, bohemio: 0.6, clasico: 0.4 }), tempRange: [19, 38], breathability: 0.85, rainSensitive: 1, visualScale: 0.65 },
  // --- Accessories
  { id: 'bolso', label: 'Bolso', category: 'accessory', layer: 'accessory', accessorySlot: 'bag', clo: 0, formality: 55, styles: s({ elegante: 0.6, clasico: 0.5 }), tempRange: [-20, 45], breathability: 1, visualScale: 0.6 },
  { id: 'mochila', label: 'Mochila', category: 'accessory', layer: 'accessory', accessorySlot: 'bag', clo: 0, formality: 15, styles: s({ casual: 0.8, streetwear: 0.5, deportivo: 0.5 }), tempRange: [-20, 45], breathability: 1, visualScale: 0.65 },
  { id: 'cinturon', label: 'Cinturón', category: 'accessory', layer: 'accessory', accessorySlot: 'waist', clo: 0, formality: 55, styles: s({ clasico: 0.6 }), tempRange: [-20, 45], breathability: 1, visualScale: 0.45 },
  { id: 'bufanda', label: 'Bufanda', category: 'accessory', layer: 'accessory', accessorySlot: 'neck', clo: 0.05, formality: 45, styles: s({ clasico: 0.5, casual: 0.5 }), tempRange: [-20, 12], breathability: 0.3, visualScale: 0.6 },
  { id: 'panuelo', label: 'Pañuelo', category: 'accessory', layer: 'accessory', accessorySlot: 'neck', clo: 0.01, formality: 60, styles: s({ elegante: 0.7, clasico: 0.6, bohemio: 0.4 }), tempRange: [5, 30], breathability: 0.8, visualScale: 0.45 },
  { id: 'corbata', label: 'Corbata', category: 'accessory', layer: 'accessory', accessorySlot: 'neck', clo: 0, formality: 95, styles: s({ formal: 1, clasico: 0.6 }), tempRange: [-20, 34], breathability: 1, visualScale: 0.45 },
  { id: 'gorro', label: 'Gorro', category: 'accessory', layer: 'accessory', accessorySlot: 'head', clo: 0.03, formality: 20, styles: s({ casual: 0.7, streetwear: 0.5 }), tempRange: [-20, 10], breathability: 0.3, visualScale: 0.45 },
  { id: 'gorra', label: 'Gorra', category: 'accessory', layer: 'accessory', accessorySlot: 'head', clo: 0.01, formality: 10, styles: s({ streetwear: 0.8, deportivo: 0.7, casual: 0.6 }), tempRange: [12, 42], breathability: 0.7, visualScale: 0.45 },
  { id: 'sombrero', label: 'Sombrero', category: 'accessory', layer: 'accessory', accessorySlot: 'head', clo: 0.01, formality: 50, styles: s({ bohemio: 0.8, clasico: 0.5 }), tempRange: [18, 42], breathability: 0.7, visualScale: 0.55 },
  { id: 'gafas_sol', label: 'Gafas de sol', category: 'accessory', layer: 'accessory', accessorySlot: 'eyes', clo: 0, formality: 40, styles: s({ casual: 0.5, elegante: 0.4 }), tempRange: [-20, 45], breathability: 1, visualScale: 0.4 },
  { id: 'reloj', label: 'Reloj', category: 'accessory', layer: 'accessory', accessorySlot: 'wrist', clo: 0, formality: 55, styles: s({ clasico: 0.6, elegante: 0.5 }), tempRange: [-20, 45], breathability: 1, visualScale: 0.35 },
  { id: 'joyeria', label: 'Joyería', category: 'accessory', layer: 'accessory', accessorySlot: 'jewelry', clo: 0, formality: 65, styles: s({ elegante: 0.8, romantico: 0.5 }), tempRange: [-20, 45], breathability: 1, visualScale: 0.35 },
  { id: 'guantes', label: 'Guantes', category: 'accessory', layer: 'accessory', accessorySlot: 'hands', clo: 0.02, formality: 45, styles: s({ clasico: 0.5 }), tempRange: [-20, 8], breathability: 0.3, visualScale: 0.4 },
  { id: 'paraguas', label: 'Paraguas', category: 'accessory', layer: 'accessory', accessorySlot: 'umbrella', clo: 0, formality: 50, styles: s({}), tempRange: [-20, 45], waterproof: true, breathability: 1, visualScale: 0.55 },
  // --- Swimwear (only used for beach/pool plans and trips)
  { id: 'banador', label: 'Bañador', category: 'swimwear', layer: 'swim', clo: 0.02, formality: 5, styles: s({ casual: 1 }), tempRange: [22, 45], breathability: 1, visualScale: 0.8 },
  { id: 'bikini', label: 'Bikini', category: 'swimwear', layer: 'swim', clo: 0.01, formality: 5, styles: s({ casual: 1 }), tempRange: [22, 45], breathability: 1, visualScale: 0.7 },
] as const satisfies readonly SubcategoryDef[];

export type SubcategoryId = (typeof SUBCATEGORIES)[number]['id'];

const SUB_BY_ID = new Map<string, SubcategoryDef>(SUBCATEGORIES.map((x) => [x.id, x as SubcategoryDef]));

export function getSubcategory(id: string): SubcategoryDef | undefined {
  return SUB_BY_ID.get(id);
}

export function subcategoriesOf(category: Category): SubcategoryDef[] {
  return (SUBCATEGORIES as readonly SubcategoryDef[]).filter((x) => x.category === category);
}

// ---------------------------------------------------------------------------
// Patterns, materials, fits
// ---------------------------------------------------------------------------

export const PATTERNS = [
  { id: 'liso', label: 'Liso', busyness: 0 },
  { id: 'rayas', label: 'Rayas', busyness: 0.45 },
  { id: 'cuadros', label: 'Cuadros', busyness: 0.6 },
  { id: 'pata_de_gallo', label: 'Pata de gallo', busyness: 0.55 },
  { id: 'espiguilla', label: 'Espiguilla', busyness: 0.3 },
  { id: 'lunares', label: 'Lunares', busyness: 0.55 },
  { id: 'floral', label: 'Floral', busyness: 0.75 },
  { id: 'animal', label: 'Animal print', busyness: 0.85 },
  { id: 'geometrico', label: 'Geométrico', busyness: 0.65 },
  { id: 'cachemir', label: 'Cachemir (paisley)', busyness: 0.8 },
  { id: 'camuflaje', label: 'Camuflaje', busyness: 0.75 },
  { id: 'grafico', label: 'Gráfico / logo', busyness: 0.55 },
  { id: 'tie_dye', label: 'Tie-dye', busyness: 0.8 },
  { id: 'abstracto', label: 'Abstracto', busyness: 0.7 },
] as const;
export type PatternId = (typeof PATTERNS)[number]['id'];
export const PATTERN_BUSYNESS: Record<string, number> = Object.fromEntries(PATTERNS.map((p) => [p.id, p.busyness]));

export interface MaterialDef {
  id: string;
  label: string;
  /** warmth delta added to garment clo multiplier (−0.3…+0.5) */
  warmth: number;
  breathability: number;
  formality: number;
  /** 0 = not sensitive, 1 = ruined by rain */
  rainSensitive: number;
  waterproof?: boolean;
  seasons: readonly Season[];
  sheen?: boolean;
}

export const SEASONS = ['primavera', 'verano', 'otono', 'invierno'] as const;
export type Season = (typeof SEASONS)[number];
export const SEASON_LABELS: Record<Season, string> = {
  primavera: 'Primavera',
  verano: 'Verano',
  otono: 'Otoño',
  invierno: 'Invierno',
};

export const MATERIALS = [
  { id: 'algodon', label: 'Algodón', warmth: 0, breathability: 0.8, formality: 40, rainSensitive: 0.3, seasons: ['primavera', 'verano', 'otono'] },
  { id: 'lino', label: 'Lino', warmth: -0.25, breathability: 1, formality: 50, rainSensitive: 0.3, seasons: ['primavera', 'verano'] },
  { id: 'lana', label: 'Lana', warmth: 0.35, breathability: 0.5, formality: 60, rainSensitive: 0.2, seasons: ['otono', 'invierno'] },
  { id: 'cachemira', label: 'Cachemira', warmth: 0.4, breathability: 0.5, formality: 75, rainSensitive: 0.4, seasons: ['otono', 'invierno'] },
  { id: 'seda', label: 'Seda', warmth: -0.1, breathability: 0.7, formality: 85, rainSensitive: 0.7, seasons: ['primavera', 'verano', 'otono'], sheen: true },
  { id: 'saten', label: 'Satén', warmth: -0.1, breathability: 0.5, formality: 80, rainSensitive: 0.6, seasons: ['primavera', 'verano', 'otono'], sheen: true },
  { id: 'poliester', label: 'Poliéster', warmth: 0, breathability: 0.4, formality: 35, rainSensitive: 0.1, seasons: ['primavera', 'verano', 'otono', 'invierno'] },
  { id: 'viscosa', label: 'Viscosa', warmth: -0.1, breathability: 0.75, formality: 50, rainSensitive: 0.4, seasons: ['primavera', 'verano'] },
  { id: 'denim', label: 'Denim', warmth: 0.05, breathability: 0.45, formality: 30, rainSensitive: 0.3, seasons: ['primavera', 'verano', 'otono', 'invierno'] },
  { id: 'punto', label: 'Punto', warmth: 0.15, breathability: 0.55, formality: 45, rainSensitive: 0.3, seasons: ['otono', 'invierno', 'primavera'] },
  { id: 'pana', label: 'Pana', warmth: 0.2, breathability: 0.45, formality: 45, rainSensitive: 0.3, seasons: ['otono', 'invierno'] },
  { id: 'tweed', label: 'Tweed', warmth: 0.3, breathability: 0.45, formality: 70, rainSensitive: 0.3, seasons: ['otono', 'invierno'] },
  { id: 'cuero', label: 'Cuero / piel', warmth: 0.15, breathability: 0.2, formality: 60, rainSensitive: 0.3, seasons: ['primavera', 'otono', 'invierno'] },
  { id: 'ante', label: 'Ante', warmth: 0.1, breathability: 0.3, formality: 60, rainSensitive: 0.95, seasons: ['primavera', 'otono'] },
  { id: 'lona', label: 'Lona', warmth: 0, breathability: 0.7, formality: 20, rainSensitive: 0.8, seasons: ['primavera', 'verano'] },
  { id: 'tecnico', label: 'Tejido técnico', warmth: 0, breathability: 0.85, formality: 10, rainSensitive: 0, waterproof: true, seasons: ['primavera', 'verano', 'otono', 'invierno'] },
  { id: 'plumon', label: 'Plumón', warmth: 0.5, breathability: 0.2, formality: 25, rainSensitive: 0.4, seasons: ['invierno'] },
  { id: 'nailon', label: 'Nailon', warmth: 0, breathability: 0.3, formality: 25, rainSensitive: 0, waterproof: true, seasons: ['primavera', 'otono', 'invierno'] },
  { id: 'sintetico', label: 'Sintético', warmth: 0, breathability: 0.35, formality: 30, rainSensitive: 0.1, seasons: ['primavera', 'verano', 'otono', 'invierno'] },
  { id: 'terciopelo', label: 'Terciopelo', warmth: 0.15, breathability: 0.4, formality: 80, rainSensitive: 0.7, seasons: ['otono', 'invierno'], sheen: true },
] as const satisfies readonly MaterialDef[];
export type MaterialId = (typeof MATERIALS)[number]['id'];
const MAT_BY_ID = new Map<string, MaterialDef>(MATERIALS.map((m) => [m.id, m as MaterialDef]));
export function getMaterial(id: string): MaterialDef | undefined {
  return MAT_BY_ID.get(id);
}

export const FITS = ['ajustado', 'regular', 'holgado', 'oversize'] as const;
export type Fit = (typeof FITS)[number];
export const FIT_LABELS: Record<Fit, string> = {
  ajustado: 'Ajustado',
  regular: 'Regular',
  holgado: 'Holgado',
  oversize: 'Oversize',
};
/** Volume 0 (slim) … 1 (oversize); used for proportion balance. */
export const FIT_VOLUME: Record<Fit, number> = { ajustado: 0.1, regular: 0.4, holgado: 0.7, oversize: 1 };

export const CONDITIONS = ['nuevo', 'como_nuevo', 'bueno', 'usado', 'desgastado'] as const;
export type Condition = (typeof CONDITIONS)[number];

// ---------------------------------------------------------------------------
// Availability status and sources
// ---------------------------------------------------------------------------

export const GARMENT_STATUSES = ['available', 'laundry', 'lent', 'stored', 'retired'] as const;
export type GarmentStatus = (typeof GARMENT_STATUSES)[number];
export const GARMENT_STATUS_LABELS: Record<GarmentStatus, string> = {
  available: 'Disponible',
  laundry: 'En la colada',
  lent: 'Prestada',
  stored: 'Guardada',
  retired: 'Retirada',
};

export const GARMENT_SOURCES = ['camera', 'gallery', 'batch', 'link', 'share', 'receipt', 'screenshot', 'label', 'manual', 'demo'] as const;
export type GarmentSource = (typeof GARMENT_SOURCES)[number];

export const SPACE_KINDS = ['armario', 'cajon', 'zapatero', 'almacenaje', 'maleta', 'otro'] as const;
export type SpaceKind = (typeof SPACE_KINDS)[number];

// ---------------------------------------------------------------------------
// Occasions / plans
// ---------------------------------------------------------------------------

export interface OccasionDef {
  id: string;
  label: string;
  /** Target formality window 0–100. */
  formality: readonly [number, number];
  /** Styles that fit naturally (bonus) and styles to avoid (penalty). */
  preferStyles: readonly StyleId[];
  avoidStyles: readonly StyleId[];
  /** Expected share of time indoors (0–1). */
  indoorShare: number;
  /** Requires sport-capable garments. */
  sport?: boolean;
  /** Free-form stylist hints shown in explanations. */
  tip?: string;
  /** Color families to avoid (e.g. white at weddings for guests). */
  avoidColors?: readonly string[];
}

export const OCCASIONS = [
  { id: 'dia_informal', label: 'Día informal', formality: [0, 50], preferStyles: ['casual', 'minimalista', 'streetwear'], avoidStyles: ['formal'], indoorShare: 0.5 },
  { id: 'universidad', label: 'Universidad', formality: [10, 55], preferStyles: ['casual', 'streetwear', 'minimalista', 'preppy'], avoidStyles: ['formal'], indoorShare: 0.7 },
  { id: 'trabajo', label: 'Trabajo', formality: [35, 75], preferStyles: ['minimalista', 'clasico', 'casual', 'elegante'], avoidStyles: ['deportivo'], indoorShare: 0.85 },
  { id: 'oficina_formal', label: 'Oficina formal', formality: [65, 100], preferStyles: ['formal', 'elegante', 'clasico'], avoidStyles: ['deportivo', 'streetwear', 'athleisure'], indoorShare: 0.9 },
  { id: 'entrevista', label: 'Entrevista', formality: [60, 95], preferStyles: ['clasico', 'minimalista', 'formal', 'elegante'], avoidStyles: ['deportivo', 'streetwear', 'rockero', 'athleisure'], indoorShare: 0.85, tip: 'Colores sobrios y prendas sin desgaste transmiten seguridad.' },
  { id: 'cena', label: 'Cena', formality: [40, 80], preferStyles: ['elegante', 'minimalista', 'clasico', 'romantico'], avoidStyles: ['deportivo'], indoorShare: 0.8 },
  { id: 'fiesta', label: 'Fiesta', formality: [35, 90], preferStyles: ['elegante', 'rockero', 'streetwear', 'romantico'], avoidStyles: ['deportivo', 'utilitario'], indoorShare: 0.85 },
  { id: 'boda', label: 'Boda', formality: [75, 100], preferStyles: ['elegante', 'formal', 'clasico', 'romantico'], avoidStyles: ['deportivo', 'streetwear', 'casual', 'athleisure', 'utilitario'], indoorShare: 0.6, avoidColors: ['blanco', 'crudo'], tip: 'Como invitado, evita el blanco y el crudo.' },
  { id: 'viaje', label: 'Viaje', formality: [5, 55], preferStyles: ['casual', 'minimalista', 'athleisure'], avoidStyles: [], indoorShare: 0.6, tip: 'Prioriza comodidad y capas fáciles de quitar.' },
  { id: 'gimnasio', label: 'Gimnasio', formality: [0, 20], preferStyles: ['deportivo', 'athleisure'], avoidStyles: ['formal', 'elegante', 'clasico'], indoorShare: 0.9, sport: true },
  { id: 'actividad_deportiva', label: 'Actividad deportiva', formality: [0, 20], preferStyles: ['deportivo', 'athleisure'], avoidStyles: ['formal', 'elegante', 'clasico'], indoorShare: 0.1, sport: true },
  { id: 'paseo', label: 'Paseo', formality: [5, 50], preferStyles: ['casual', 'minimalista', 'bohemio'], avoidStyles: ['formal'], indoorShare: 0.2, tip: 'Calzado cómodo para caminar.' },
  { id: 'cita', label: 'Cita', formality: [35, 80], preferStyles: ['elegante', 'romantico', 'minimalista', 'clasico'], avoidStyles: ['deportivo'], indoorShare: 0.7 },
  { id: 'evento_especial', label: 'Evento especial', formality: [55, 100], preferStyles: ['elegante', 'formal', 'clasico'], avoidStyles: ['deportivo', 'athleisure'], indoorShare: 0.7 },
] as const satisfies readonly OccasionDef[];
export type OccasionId = (typeof OCCASIONS)[number]['id'];
const OCC_BY_ID = new Map<string, OccasionDef>(OCCASIONS.map((o) => [o.id, o as OccasionDef]));
export function getOccasion(id: string): OccasionDef | undefined {
  return OCC_BY_ID.get(id);
}

// ---------------------------------------------------------------------------
// Retail integration status (shown in the integrations matrix)
// ---------------------------------------------------------------------------

export const INTEGRATION_STATUSES = ['operational', 'partial', 'link_only', 'pending_authorization', 'disabled'] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];
export const INTEGRATION_STATUS_LABELS: Record<IntegrationStatus, string> = {
  operational: 'Operativa',
  partial: 'Parcialmente operativa',
  link_only: 'Solo importación de enlaces',
  pending_authorization: 'Pendiente de autorización',
  disabled: 'Desactivada',
};

export const IMAGE_POLICIES = ['licensed', 'link_preview', 'none'] as const;
export type ImagePolicy = (typeof IMAGE_POLICIES)[number];
