import { getOccasion, type OccasionDef } from '@dressit/shared';
import { emptyModel } from '../src/learning.ts';
import { toEngineGarment, type RawGarment } from '../src/normalize.ts';
import type { DayConditions, EngineContext, EngineGarment, EngineHistory, EngineProfile } from '../src/types.ts';

let n = 0;
export function g(partial: Partial<RawGarment> & Pick<RawGarment, 'subcategory' | 'category'> & { hex: string }): EngineGarment {
  n++;
  const { hex, ...rest } = partial;
  return toEngineGarment({
    id: rest.id ?? `g${n}`,
    name: rest.name ?? `${rest.subcategory} ${hex}`,
    colors: [{ hex, share: 1 }],
    createdAt: '2026-01-01T00:00:00Z',
    ...rest,
  });
}

/** A realistic, gender-neutral test wardrobe (~30 items). */
export function testWardrobe(): EngineGarment[] {
  return [
    g({ id: 'tee-white', name: 'Camiseta blanca', category: 'top', subcategory: 'camiseta', hex: '#f5f5f5', materials: ['algodon'], fit: 'regular' }),
    g({ id: 'tee-black', name: 'Camiseta negra', category: 'top', subcategory: 'camiseta', hex: '#141414', materials: ['algodon'], fit: 'regular' }),
    g({ id: 'tee-graphic', name: 'Camiseta gráfica', category: 'top', subcategory: 'camiseta', hex: '#c62828', pattern: 'grafico', styles: ['streetwear'], fit: 'oversize' }),
    g({ id: 'shirt-white', name: 'Camisa blanca', category: 'top', subcategory: 'camisa', hex: '#f4f4f2', materials: ['algodon'], fit: 'regular' }),
    g({ id: 'shirt-blue', name: 'Camisa celeste', category: 'top', subcategory: 'camisa', hex: '#a9c6e8', materials: ['algodon'], fit: 'ajustado' }),
    g({ id: 'shirt-linen', name: 'Camisa de lino', category: 'top', subcategory: 'camisa_manga_corta', hex: '#ece3d0', materials: ['lino'] }),
    g({ id: 'sweater-navy', name: 'Jersey azul marino', category: 'top', subcategory: 'jersey', hex: '#1f2a44', materials: ['lana'], fit: 'regular' }),
    g({ id: 'sweater-grey', name: 'Jersey gris grueso', category: 'top', subcategory: 'jersey_grueso', hex: '#8c8c8c', materials: ['lana'], fit: 'holgado' }),
    g({ id: 'hoodie', name: 'Sudadera gris', category: 'top', subcategory: 'sudadera', hex: '#9a9a9a', fit: 'oversize' }),
    g({ id: 'tech-tee', name: 'Camiseta técnica', category: 'top', subcategory: 'camiseta_tecnica', hex: '#2f5ea8', materials: ['tecnico'] }),
    g({ id: 'jeans', name: 'Vaquero azul', category: 'bottom', subcategory: 'vaquero', hex: '#4b6584', materials: ['denim'], fit: 'regular' }),
    g({ id: 'jeans-black', name: 'Vaquero negro', category: 'bottom', subcategory: 'vaquero', hex: '#202020', materials: ['denim'], fit: 'ajustado' }),
    g({ id: 'chinos', name: 'Chino beige', category: 'bottom', subcategory: 'chino', hex: '#d6c2a3', materials: ['algodon'], fit: 'regular' }),
    g({ id: 'trousers', name: 'Pantalón de vestir gris', category: 'bottom', subcategory: 'pantalon_vestir', hex: '#5a5a5a', materials: ['lana'], fit: 'regular' }),
    g({ id: 'shorts', name: 'Bermuda beige', category: 'bottom', subcategory: 'bermuda', hex: '#d2c09c', materials: ['algodon'] }),
    g({ id: 'joggers', name: 'Jogger negro', category: 'bottom', subcategory: 'jogger', hex: '#1a1a1a' }),
    g({ id: 'leggings', name: 'Mallas deportivas', category: 'bottom', subcategory: 'leggings', hex: '#151515', materials: ['tecnico'] }),
    g({ id: 'dress', name: 'Vestido negro', category: 'one_piece', subcategory: 'vestido', hex: '#141414', materials: ['viscosa'] }),
    g({ id: 'blazer', name: 'Americana azul marino', category: 'outerwear', subcategory: 'americana', hex: '#22304f', materials: ['lana'] }),
    g({ id: 'trench', name: 'Gabardina beige', category: 'outerwear', subcategory: 'gabardina', hex: '#c9b48e' }),
    g({ id: 'coat', name: 'Abrigo camel', category: 'outerwear', subcategory: 'abrigo', hex: '#c09a6b', materials: ['lana'] }),
    g({ id: 'puffer', name: 'Plumífero negro', category: 'outerwear', subcategory: 'plumifero', hex: '#121212', materials: ['plumon'] }),
    g({ id: 'denim-jacket', name: 'Cazadora vaquera', category: 'outerwear', subcategory: 'cazadora_vaquera', hex: '#5a7898', materials: ['denim'] }),
    g({ id: 'sneakers', name: 'Zapatillas blancas', category: 'footwear', subcategory: 'zapatillas', hex: '#f3f3f3', materials: ['cuero'] }),
    g({ id: 'canvas', name: 'Zapatillas de lona', category: 'footwear', subcategory: 'zapatillas_lona', hex: '#efefef', materials: ['lona'] }),
    g({ id: 'runners', name: 'Zapatillas de running', category: 'footwear', subcategory: 'zapatillas_running', hex: '#3a3a3a', materials: ['tecnico'] }),
    g({ id: 'boots', name: 'Botas negras', category: 'footwear', subcategory: 'botas', hex: '#141414', materials: ['cuero'] }),
    g({ id: 'oxford', name: 'Zapatos negros', category: 'footwear', subcategory: 'zapatos', hex: '#111111', materials: ['cuero'] }),
    g({ id: 'loafers', name: 'Mocasines marrones', category: 'footwear', subcategory: 'mocasines', hex: '#6b4528', materials: ['cuero'] }),
    g({ id: 'sandals', name: 'Sandalias', category: 'footwear', subcategory: 'sandalias', hex: '#8a6a4a', materials: ['cuero'] }),
    g({ id: 'umbrella', name: 'Paraguas', category: 'accessory', subcategory: 'paraguas', hex: '#1a1a1a' }),
    g({ id: 'scarf', name: 'Bufanda gris', category: 'accessory', subcategory: 'bufanda', hex: '#8c8c8c', materials: ['lana'] }),
    g({ id: 'sunglasses', name: 'Gafas de sol', category: 'accessory', subcategory: 'gafas_sol', hex: '#1a1a1a' }),
    g({ id: 'belt', name: 'Cinturón marrón', category: 'accessory', subcategory: 'cinturon', hex: '#6b4528', materials: ['cuero'] }),
  ];
}

export function day(p: Partial<DayConditions>): DayConditions {
  return {
    apparentMin: 12,
    apparentMax: 19,
    tempAtStart: 12,
    tempAtEnd: 18,
    precipProbMax: 0,
    precipSum: 0,
    windMax: 10,
    humidityAvg: 60,
    uvMax: 3,
    rainFromHour: null,
    ...p,
  };
}

export function ctx(occasionId: string, weather: DayConditions | null, extra: Partial<EngineContext> = {}): EngineContext {
  return {
    date: '2026-11-24',
    occasion: getOccasion(occasionId) as OccasionDef,
    weather,
    season: 'otono',
    indoorShare: getOccasion(occasionId)!.indoorShare,
    adjustments: { formality: 0, warmth: 0, elegance: 0 },
    mustInclude: [],
    exclude: new Set(),
    excludeSubcategories: new Set(),
    temperatureSensitivity: 0,
    ...extra,
  };
}

export function profile(p: Partial<EngineProfile> = {}): EngineProfile {
  return {
    preferredStyles: [],
    favoriteColors: [],
    avoidedColors: [],
    fitPreferences: {},
    priorities: { comfort: 0.34, elegance: 0.33, practicality: 0.33 },
    learned: emptyModel(),
    ...p,
  };
}

export const noHistory: EngineHistory = { recentWear: [], rejectedSignatures: new Set() };
