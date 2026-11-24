import type {
  CatalogSearchQuery,
  GarmentDetailDto,
  LinkToWardrobeRequest,
  OutboundLinkResponse,
  Paginated,
  ProductSummaryDto,
  RetailerIntegrationDto,
  ShoppingSection,
  ShoppingSectionDto,
  SimulationRequest,
  SimulationResponse,
  VisualSearchRequest,
  VisualSearchResponse,
  WardrobeGapDto,
  WishlistItemDto,
} from '@dressit/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../client';
import { qk } from '../keys';
import { invalidateWardrobe } from './garments';

export type ProductRef = { kind: 'catalog' | 'imported'; id: string };

export function useRetailers() {
  return useQuery({ queryKey: qk.retailers, queryFn: () => api.get<RetailerIntegrationDto[]>('/v1/retailers'), staleTime: 30 * 60_000 });
}

export function useCatalogSearch(query: CatalogSearchQuery, enabled = true) {
  return useInfiniteQuery({
    queryKey: qk.catalog.search(query),
    queryFn: ({ pageParam, signal }) =>
      api.get<Paginated<ProductSummaryDto>>('/v1/catalog/search', { ...query, limit: query.limit ?? 30, cursor: pageParam ?? undefined }, { signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
  });
}

export function useCatalogProduct(id: string | undefined) {
  return useQuery({
    queryKey: qk.catalog.product(id ?? ''),
    queryFn: () => api.get<ProductSummaryDto>(`/v1/catalog/products/${id}`),
    enabled: !!id,
  });
}

export function useShoppingSections(sections?: ShoppingSection[]) {
  const s = sections?.join(',');
  return useQuery({
    queryKey: qk.shopping.sections(s),
    queryFn: () => api.get<ShoppingSectionDto[]>('/v1/shopping/sections', s ? { sections: s } : undefined),
    staleTime: 10 * 60_000,
  });
}

export function useWardrobeGaps() {
  return useQuery({ queryKey: qk.shopping.gaps, queryFn: () => api.get<WardrobeGapDto[]>('/v1/shopping/gaps'), staleTime: 10 * 60_000 });
}

export function useSimulation(req: SimulationRequest | null) {
  return useQuery({
    queryKey: qk.shopping.simulate(req?.product.kind ?? '', req?.product.id ?? '', req?.occasion),
    queryFn: () => api.post<SimulationResponse>('/v1/shopping/simulate', req, { timeoutMs: 45_000 }),
    enabled: !!req,
    staleTime: 10 * 60_000,
  });
}

export function useVisualSearch() {
  return useMutation({
    mutationFn: (body: VisualSearchRequest) => api.post<VisualSearchResponse>('/v1/shopping/visual-search', body, { timeoutMs: 45_000 }),
  });
}

/** Resolves the outbound (possibly affiliate) link. Caller shows disclosure then opens it. */
export function useOutboundLink() {
  return useMutation({
    mutationFn: (body: { product: ProductRef; context?: string }) => api.post<OutboundLinkResponse>('/v1/shopping/outbound', body),
  });
}

export function useWishlist() {
  return useQuery({ queryKey: qk.wishlist, queryFn: () => api.get<WishlistItemDto[]>('/v1/wishlist') });
}

export function useAddToWishlist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { product: ProductRef; note?: string }) => api.post<WishlistItemDto>('/v1/wishlist', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.wishlist }),
  });
}

export function useRemoveFromWishlist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<void>(`/v1/wishlist/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: qk.wishlist });
      const prev = qc.getQueryData<WishlistItemDto[]>(qk.wishlist);
      if (prev) qc.setQueryData(qk.wishlist, prev.filter((w) => w.id !== id));
      return { prev };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.wishlist, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.wishlist }),
  });
}

/** "Ya lo tengo": only after the user confirmed they own it. */
export function useWishlistOwned() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: LinkToWardrobeRequest & { id: string }) => api.post<GarmentDetailDto>(`/v1/wishlist/${id}/owned`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.wishlist });
      invalidateWardrobe(qc);
    },
  });
}

export function findWishlistItem(list: WishlistItemDto[] | undefined, ref: ProductRef): WishlistItemDto | undefined {
  return list?.find((w) => w.product.id === ref.id && w.product.kind === ref.kind);
}
