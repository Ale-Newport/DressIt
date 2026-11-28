import type { CatalogPhotoChoiceRequest, CatalogPhotoDto, CatalogPhotoRequest, CatalogPhotoServiceStatusDto } from '@dressit/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../client';
import { invalidateWardrobe } from './garments';
import { qk } from '../keys';

const ACTIVE = new Set(['queued', 'searching', 'generating']);
/** Search takes seconds; a generated packshot 10 s – 3 min: poll while it is being prepared. */
const poll = (job: CatalogPhotoDto | null | undefined) => (job && ACTIVE.has(job.status) ? 4000 : false);

/** Which search engines and generators this server has configured (no secrets). */
export function useCatalogPhotoStatus() {
  return useQuery({ queryKey: ['catalog-photo', 'status'], queryFn: () => api.get<CatalogPhotoServiceStatusDto>('/v1/catalog-photos/status'), staleTime: 5 * 60_000 });
}

/** The garment's latest catalogue photo job (null when none was ever made). */
export function useGarmentCatalogPhoto(garmentId: string, enabled = true) {
  return useQuery({
    queryKey: ['catalog-photo', 'garment', garmentId],
    queryFn: () => api.get<CatalogPhotoDto | null>(`/v1/garments/${garmentId}/catalog-photo`),
    enabled,
    refetchInterval: (q) => poll(q.state.data),
  });
}

export function useCatalogPhoto(id: string | null | undefined) {
  return useQuery({
    queryKey: ['catalog-photo', id],
    queryFn: () => api.get<CatalogPhotoDto>(`/v1/catalog-photos/${id}`),
    enabled: !!id,
    refetchInterval: (q) => poll(q.state.data),
  });
}

/** Search the official photo and/or generate the packshot again. */
export function useStartCatalogPhoto(garmentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CatalogPhotoRequest = {}) => api.post<CatalogPhotoDto>(`/v1/garments/${garmentId}/catalog-photo`, body),
    onSuccess: (data) => qc.setQueryData(['catalog-photo', 'garment', garmentId], data),
  });
}

/** The user's decision: official photo, AI packshot or their own photo (always kept). */
export function useChooseCatalogPhoto(opts: { garmentId?: string | null; importJobId?: string } = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: CatalogPhotoChoiceRequest & { id: string }) => api.post<CatalogPhotoDto>(`/v1/catalog-photos/${id}/choose`, body),
    onSuccess: (data) => {
      qc.setQueryData(['catalog-photo', data.id], data);
      if (opts.garmentId) {
        qc.setQueryData(['catalog-photo', 'garment', opts.garmentId], data);
        invalidateWardrobe(qc, opts.garmentId);
      }
      if (opts.importJobId) qc.invalidateQueries({ queryKey: qk.imports.job(opts.importJobId) });
    },
  });
}
