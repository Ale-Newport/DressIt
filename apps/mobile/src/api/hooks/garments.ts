import type {
  BulkGarmentUpdate,
  GarmentDetailDto,
  GarmentDto,
  GarmentListQuery,
  GarmentWriteDto,
  Paginated,
  SpaceDto,
  SpaceKind,
  StatusChangeRequest,
  WardrobeStatsDto,
  WearRequest,
} from '@dressit/shared';
import { type QueryClient, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../client';
import { qk } from '../keys';

/** Anything that changes the wardrobe also changes stats, home and recommendations. */
export function invalidateWardrobe(qc: QueryClient, garmentId?: string) {
  qc.invalidateQueries({ queryKey: qk.garments.all });
  qc.invalidateQueries({ queryKey: qk.stats });
  qc.invalidateQueries({ queryKey: qk.spaces });
  qc.invalidateQueries({ queryKey: qk.tags });
  qc.invalidateQueries({ queryKey: qk.home });
  qc.invalidateQueries({ queryKey: ['recommendations'] });
  qc.invalidateQueries({ queryKey: ['shopping'] });
  if (garmentId) qc.invalidateQueries({ queryKey: qk.garments.detail(garmentId) });
}

export function useGarments(query: GarmentListQuery, enabled = true) {
  return useInfiniteQuery({
    queryKey: qk.garments.list(query),
    queryFn: ({ pageParam, signal }) =>
      api.get<Paginated<GarmentDto>>('/v1/garments', { ...query, limit: query.limit ?? 40, cursor: pageParam ?? undefined }, { signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
  });
}

export function useGarment(id: string | undefined) {
  return useQuery({
    queryKey: qk.garments.detail(id ?? ''),
    queryFn: () => api.get<GarmentDetailDto>(`/v1/garments/${id}`),
    enabled: !!id,
  });
}

export function useCreateGarment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: GarmentWriteDto) => api.post<GarmentDetailDto>('/v1/garments', body),
    onSuccess: (g) => {
      qc.setQueryData(qk.garments.detail(g.id), g);
      invalidateWardrobe(qc);
    },
  });
}

export function useUpdateGarment(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: GarmentWriteDto) => api.patch<GarmentDetailDto>(`/v1/garments/${id}`, body),
    onSuccess: (g) => {
      qc.setQueryData(qk.garments.detail(id), g);
      invalidateWardrobe(qc);
    },
  });
}

export function useDeleteGarment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<void>(`/v1/garments/${id}`),
    onSuccess: (_v, id) => {
      qc.removeQueries({ queryKey: qk.garments.detail(id) });
      invalidateWardrobe(qc);
    },
  });
}

export function useBulkUpdateGarments() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: BulkGarmentUpdate) => api.post<{ updated: number }>('/v1/garments/bulk', body),
    onSuccess: () => invalidateWardrobe(qc),
  });
}

export function useChangeGarmentStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: StatusChangeRequest & { id: string }) =>
      api.post<GarmentDetailDto>(`/v1/garments/${id}/status`, body),
    onSuccess: (g) => {
      qc.setQueryData(qk.garments.detail(g.id), g);
      invalidateWardrobe(qc);
      qc.invalidateQueries({ queryKey: ['planner'] });
    },
  });
}

export function useWearGarment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, date }: WearRequest & { id: string }) => api.post<GarmentDetailDto>(`/v1/garments/${id}/wear`, { date }),
    onSuccess: (g) => {
      qc.setQueryData(qk.garments.detail(g.id), g);
      invalidateWardrobe(qc);
      qc.invalidateQueries({ queryKey: ['history'] });
    },
  });
}

export interface SimilarGarment {
  garment: GarmentDto;
  score: number;
  reason: string;
}

export function useSimilarGarments(id: string | undefined) {
  return useQuery({
    queryKey: qk.garments.similar(id ?? ''),
    queryFn: () => api.get<{ items: SimilarGarment[] }>(`/v1/garments/${id}/similar`),
    enabled: !!id,
    select: (d) => d.items,
  });
}

export function useWardrobeStats() {
  return useQuery({ queryKey: qk.stats, queryFn: () => api.get<WardrobeStatsDto>('/v1/wardrobe/stats') });
}

export function useSpaces() {
  return useQuery({ queryKey: qk.spaces, queryFn: () => api.get<SpaceDto[]>('/v1/spaces') });
}

export function useCreateSpace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; kind: SpaceKind }) => api.post<SpaceDto>('/v1/spaces', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.spaces }),
  });
}

export function useUpdateSpace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; kind?: SpaceKind; position?: number }) =>
      api.patch<SpaceDto>(`/v1/spaces/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.spaces }),
  });
}

export function useDeleteSpace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<void>(`/v1/spaces/${id}`),
    onSuccess: () => invalidateWardrobe(qc),
  });
}

export interface TagDto {
  id: string;
  name: string;
  count: number;
}

export function useTags() {
  return useQuery({ queryKey: qk.tags, queryFn: () => api.get<TagDto[]>('/v1/tags') });
}
