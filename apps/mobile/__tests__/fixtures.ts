import type { GarmentDto, OutfitDto, ProductSummaryDto } from '@dressit/shared';

/** Test-only builders (never used by the app). */
export function garment(overrides: Partial<GarmentDto> = {}): GarmentDto {
  return {
    id: 'g1',
    name: 'Camisa Oxford',
    category: 'top',
    subcategory: 'camisa',
    brand: 'Marca',
    colors: [{ hex: '#f6f6f4', family: 'blanco', share: 1 }],
    primaryColor: 'blanco',
    pattern: 'liso',
    materials: ['algodon'],
    styles: ['clasico'],
    seasons: ['primavera'],
    occasions: ['trabajo'],
    formality: 65,
    warmth: 30,
    waterproof: false,
    fit: 'regular',
    size: 'M',
    condition: 'bueno',
    status: 'available',
    favorite: false,
    spaceId: null,
    tags: [],
    image: null,
    source: 'manual',
    sourceUrl: null,
    isDemo: false,
    wearCount: 0,
    lastWornOn: null,
    purchaseDate: null,
    purchasePrice: null,
    costPerWear: null,
    createdAt: '2026-11-01T10:00:00Z',
    updatedAt: '2026-11-01T10:00:00Z',
    ...overrides,
  };
}

export function product(overrides: Partial<ProductSummaryDto> = {}): ProductSummaryDto {
  return {
    id: 'p1',
    kind: 'catalog',
    retailer: { id: 'r1', name: 'Tienda Ejemplo', group: null },
    brand: 'Marca',
    title: 'Chaqueta beige',
    category: 'outerwear',
    subcategory: 'chaqueta',
    colorName: 'Beige',
    colorFamily: 'beige',
    price: { cents: 5995, currency: 'EUR' },
    originalPrice: null,
    discountPercent: null,
    sizes: [],
    availability: 'in_stock',
    image: null,
    productUrl: 'https://tienda.example/p/1',
    verifiedAt: '2026-11-24T08:00:00Z',
    isStale: false,
    isSponsored: false,
    isAffiliate: false,
    ...overrides,
  };
}

export function outfit(overrides: Partial<OutfitDto> = {}): OutfitDto {
  return {
    id: 'o1',
    name: null,
    items: [
      { slot: 'base', garment: garment({ id: 'g-top' }), candidateProduct: null },
      { slot: 'bottom', garment: garment({ id: 'g-bottom', category: 'bottom', subcategory: 'vaquero', name: 'Vaquero', colors: [{ hex: '#4b6584', family: 'denim', share: 1 }] }), candidateProduct: null },
      { slot: 'footwear', garment: garment({ id: 'g-shoes', category: 'footwear', subcategory: 'zapatillas', name: 'Zapatillas' }), candidateProduct: null },
    ],
    occasion: 'trabajo',
    score: 0.82,
    breakdown: { total: 0.82, color: 0.8, style: 0.7, formality: 0.9, weather: 0.75, material: 0.6, silhouette: 0.7, personal: 0.5, rotation: 0.6 },
    explanation: ['Los neutros combinan con todo.'],
    weatherNote: null,
    formality: 55,
    styleMatch: 0.7,
    isExploration: false,
    isSaved: false,
    isFavorite: false,
    status: 'suggested',
    source: 'generated',
    layout: [
      { slot: 'base', x: 0.1, y: 0.05, w: 0.4, h: 0.4, z: 2 },
      { slot: 'bottom', x: 0.5, y: 0.1, w: 0.35, h: 0.55, z: 1 },
    ],
    createdAt: '2026-11-24T08:00:00Z',
    ...overrides,
  };
}
