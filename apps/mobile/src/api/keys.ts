import type { CatalogSearchQuery, GarmentListQuery, RecommendationRequest } from '@dressit/shared';

/** Central query-key factory: keeps invalidation consistent across hooks. */
export const qk = {
  me: ['me'] as const,
  preferences: ['me', 'preferences'] as const,
  consents: ['me', 'consents'] as const,
  styleProfile: ['me', 'style-profile'] as const,
  geo: (q: string) => ['geo', q] as const,
  home: ['home'] as const,
  garments: {
    all: ['garments'] as const,
    list: (q: GarmentListQuery) => ['garments', 'list', q] as const,
    detail: (id: string) => ['garments', 'detail', id] as const,
    similar: (id: string) => ['garments', 'similar', id] as const,
  },
  stats: ['wardrobe', 'stats'] as const,
  spaces: ['wardrobe', 'spaces'] as const,
  tags: ['wardrobe', 'tags'] as const,
  imports: {
    all: ['imports'] as const,
    list: (status?: string) => ['imports', 'list', status ?? 'all'] as const,
    job: (id: string) => ['imports', 'job', id] as const,
    product: (id: string) => ['imports', 'product', id] as const,
  },
  weather: (date: string) => ['weather', date] as const,
  recommendations: (req: RecommendationRequest) => ['recommendations', req] as const,
  outfits: {
    all: ['outfits'] as const,
    list: (filter: string) => ['outfits', 'list', filter] as const,
    detail: (id: string) => ['outfits', 'detail', id] as const,
    alternatives: (id: string, slot: string) => ['outfits', 'alternatives', id, slot] as const,
  },
  history: (from?: string, to?: string) => ['history', from ?? '', to ?? ''] as const,
  events: (from?: string, to?: string) => ['events', from ?? '', to ?? ''] as const,
  planner: (from: string, to: string) => ['planner', from, to] as const,
  trips: {
    all: ['trips'] as const,
    detail: (id: string) => ['trips', 'detail', id] as const,
  },
  retailers: ['retailers'] as const,
  catalog: {
    search: (q: CatalogSearchQuery) => ['catalog', 'search', q] as const,
    product: (id: string) => ['catalog', 'product', id] as const,
  },
  shopping: {
    sections: (sections?: string) => ['shopping', 'sections', sections ?? 'all'] as const,
    gaps: ['shopping', 'gaps'] as const,
    simulate: (kind: string, id: string, occasion?: string) => ['shopping', 'simulate', kind, id, occasion ?? ''] as const,
  },
  wishlist: ['wishlist'] as const,
};
