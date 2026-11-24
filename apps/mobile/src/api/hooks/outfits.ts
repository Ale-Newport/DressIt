import type {
  AlternativesResponse,
  FeedbackRequest,
  ManualOutfitRequest,
  OutfitDto,
  OutfitSlot,
  RecommendationRequest,
  RecommendationResponse,
  SwapRequest,
  UsageHistoryDto,
} from '@dressit/shared';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../client';
import { qk } from '../keys';

/** Recommendations are a POST but semantically a read: cached per request (offline-friendly). */
export function useRecommendations(req: RecommendationRequest, enabled = true) {
  return useQuery({
    queryKey: qk.recommendations(req),
    queryFn: () => api.post<RecommendationResponse>('/v1/outfits/recommendations', req, { timeoutMs: 45_000 }),
    enabled,
    staleTime: 10 * 60_000,
    placeholderData: (prev) => prev,
  });
}

/** Imperative variant (regenerate, assistant, trips…). */
export function useRequestRecommendations() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: RecommendationRequest) =>
      api.post<RecommendationResponse>('/v1/outfits/recommendations', req, { timeoutMs: 45_000 }),
    onSuccess: (res, req) => qc.setQueryData(qk.recommendations(req), res),
  });
}

export type OutfitFilter = 'saved' | 'favorites' | 'all';

export function useOutfits(filter: OutfitFilter) {
  return useQuery({ queryKey: qk.outfits.list(filter), queryFn: () => api.get<OutfitDto[]>('/v1/outfits', { filter }) });
}

export function useOutfit(id: string | undefined) {
  return useQuery({
    queryKey: qk.outfits.detail(id ?? ''),
    queryFn: () => api.get<OutfitDto>(`/v1/outfits/${id}`),
    enabled: !!id,
  });
}

/** Replace an outfit everywhere it is cached (detail, lists, recommendation responses). */
export function syncOutfit(qc: QueryClient, outfit: OutfitDto, previousId?: string) {
  const oldId = previousId ?? outfit.id;
  qc.setQueryData(qk.outfits.detail(outfit.id), outfit);
  qc.setQueriesData<RecommendationResponse>({ queryKey: ['recommendations'] }, (res) =>
    res ? { ...res, outfits: res.outfits.map((o) => (o.id === oldId ? outfit : o)) } : res,
  );
  qc.setQueriesData<OutfitDto[]>({ queryKey: ['outfits', 'list'] }, (list) =>
    list ? list.map((o) => (o.id === oldId ? outfit : o)) : list,
  );
}

export function useCreateOutfit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ManualOutfitRequest) => api.post<OutfitDto>('/v1/outfits', body),
    onSuccess: (o) => {
      qc.setQueryData(qk.outfits.detail(o.id), o);
      qc.invalidateQueries({ queryKey: qk.outfits.all });
    },
  });
}

export function useDeleteOutfit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<void>(`/v1/outfits/${id}`),
    onSuccess: (_v, id) => {
      qc.removeQueries({ queryKey: qk.outfits.detail(id) });
      qc.invalidateQueries({ queryKey: qk.outfits.all });
      qc.invalidateQueries({ queryKey: ['planner'] });
    },
  });
}

export function useAlternatives(outfitId: string | undefined, slot: OutfitSlot | undefined) {
  return useQuery({
    queryKey: qk.outfits.alternatives(outfitId ?? '', slot ?? ''),
    queryFn: () => api.get<AlternativesResponse>(`/v1/outfits/${outfitId}/alternatives`, { slot }),
    enabled: !!outfitId && !!slot,
  });
}

export function useSwapOutfitItem(outfitId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SwapRequest) => api.post<OutfitDto>(`/v1/outfits/${outfitId}/swap`, body),
    onSuccess: (o) => {
      syncOutfit(qc, o, outfitId);
      qc.invalidateQueries({ queryKey: ['outfits', 'alternatives', outfitId] });
    },
  });
}

export function useOutfitFeedback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: FeedbackRequest & { id: string }) => api.post<OutfitDto>(`/v1/outfits/${id}/feedback`, body),
    onSuccess: (o, vars) => {
      syncOutfit(qc, o, vars.id);
      qc.invalidateQueries({ queryKey: ['outfits', 'list'] });
      qc.invalidateQueries({ queryKey: qk.styleProfile });
    },
  });
}

export function useWearOutfit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, date }: { id: string; date: string }) => api.post<OutfitDto>(`/v1/outfits/${id}/wear`, { date }),
    onSuccess: (o, vars) => {
      syncOutfit(qc, o, vars.id);
      qc.invalidateQueries({ queryKey: ['history'] });
      qc.invalidateQueries({ queryKey: qk.garments.all });
      qc.invalidateQueries({ queryKey: qk.stats });
      qc.invalidateQueries({ queryKey: qk.home });
    },
  });
}

export function useHistory(from?: string, to?: string) {
  return useQuery({
    queryKey: qk.history(from, to),
    queryFn: () => api.get<UsageHistoryDto[]>('/v1/history', { from, to }),
  });
}
