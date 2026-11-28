import type { AvatarBaseRequest, AvatarBaseResponse, AvatarProfileDto, AvatarProfileRequest, AvatarRenderRequest, GenerationJobDto, GenerationServiceStatusDto, ImageRefDto } from '@dressit/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../client';
import { invalidateWardrobe } from './garments';
import { qk } from '../keys';

const ACTIVE = new Set(['queued', 'running']);
/** Generation takes 1–3 minutes on the server: poll while a job is queued or running. */
const pollWhileActive = (jobs: GenerationJobDto[] | undefined) => (jobs?.some((j) => ACTIVE.has(j.status)) ? 4000 : false);

export function useGenerationStatus() {
  return useQuery({
    queryKey: ['generation', 'status'],
    queryFn: () => api.get<GenerationServiceStatusDto>('/v1/generation/status'),
    staleTime: 60_000,
  });
}

export function useSetPrimaryImage(garmentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (imageId: string) => api.put<void>(`/v1/garments/${garmentId}/primary-image`, { imageId }),
    onSuccess: () => invalidateWardrobe(qc, garmentId),
  });
}

/** Avatar renders for an outfit, newest first. */
export function useAvatarJobs(outfitId: string, enabled = true) {
  return useQuery({
    queryKey: ['generation', 'avatar', outfitId],
    queryFn: () => api.get<GenerationJobDto[]>(`/v1/outfits/${outfitId}/avatar`),
    enabled,
    refetchInterval: (q) => pollWhileActive(q.state.data),
  });
}

export function useCreateAvatarRender(outfitId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AvatarRenderRequest = {}) => api.post<GenerationJobDto>(`/v1/outfits/${outfitId}/avatar`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['generation', 'avatar', outfitId] }),
  });
}

/** The avatar profile; polls while a generated view (three-quarter, side) is being made. */
export function useAvatarProfile() {
  return useQuery({
    queryKey: ['me', 'avatar'],
    queryFn: () => api.get<AvatarProfileDto>('/v1/me/avatar'),
    refetchInterval: (q) => (q.state.data?.bases?.some((b) => b.status === 'generating') ? 4000 : false),
  });
}

/** Saves an avatar image: the frontal one is ready at once; other views are generated. */
export function useCreateAvatarBase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AvatarBaseRequest) => api.post<AvatarBaseResponse>('/v1/me/avatar/bases', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me', 'avatar'] }),
  });
}

// ---------------------------------------------------------------------------
// Garment photos: manual cutout correction
// ---------------------------------------------------------------------------

/** Where a cutout is corrected: a garment in the wardrobe or a detection still in review. */
export type RecutTarget = { garmentId: string } | { jobId: string; detectionId: string };
const recutPath = (t: RecutTarget) => ('garmentId' in t ? `/v1/garments/${t.garmentId}/recut` : `/v1/imports/${t.jobId}/detections/${t.detectionId}/recut`);

/** The original photo the user marks points on. */
export function useRecutSource(target: RecutTarget) {
  return useQuery({ queryKey: ['recut', recutPath(target)], queryFn: () => api.get<ImageRefDto>(recutPath(target)) });
}

/** Points are [x, y, label] in 0–1 of the photo; label 1 = garment, 0 = not garment. */
export function useRecut(target: RecutTarget) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (points: Array<[number, number, 0 | 1]>) => api.post<ImageRefDto>(recutPath(target), { points }),
    onSuccess: () => {
      if ('garmentId' in target) invalidateWardrobe(qc, target.garmentId);
      else qc.invalidateQueries({ queryKey: qk.imports.job(target.jobId) });
    },
  });
}

export function useSaveAvatarProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AvatarProfileRequest) => api.put<AvatarProfileDto>('/v1/me/avatar', body),
    onSuccess: (data) => qc.setQueryData(['me', 'avatar'], data),
  });
}

export function useDeleteAvatarProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.del('/v1/me/avatar'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me', 'avatar'] });
      qc.invalidateQueries({ queryKey: ['generation', 'avatar'] });
    },
  });
}
