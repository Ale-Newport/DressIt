import type {
  AcceptDetectionRequest,
  DetectionDto,
  GarmentDetailDto,
  ImportedProductDto,
  ImportJobDto,
  ImportJobStatus,
  LinkImportRequest,
  LinkToWardrobeRequest,
  PageCaptureRequest,
  PhotoImportRequest,
  ReceiptImportResult,
  ReceiptTextImportRequest,
  WishlistItemDto,
} from '@dressit/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../client';
import { qk } from '../keys';
import { invalidateWardrobe } from './garments';

export const TERMINAL_JOB_STATUSES: ImportJobStatus[] = ['needs_review', 'completed', 'failed', 'cancelled'];

export function isJobRunning(job: ImportJobDto | undefined): boolean {
  return !!job && (job.status === 'queued' || job.status === 'processing');
}

export function useCreatePhotoImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PhotoImportRequest) => api.post<ImportJobDto>('/v1/imports/photos', body),
    onSuccess: (job) => {
      qc.setQueryData(qk.imports.job(job.id), job);
      qc.invalidateQueries({ queryKey: qk.imports.all });
    },
  });
}

/** Polls every 1.5 s while the job is queued/processing. */
export function useImportJob(id: string | undefined) {
  return useQuery({
    queryKey: qk.imports.job(id ?? ''),
    queryFn: () => api.get<ImportJobDto>(`/v1/imports/${id}`),
    enabled: !!id,
    refetchInterval: (q) => (isJobRunning(q.state.data) ? 1500 : false),
    staleTime: 0,
  });
}

export function useImportJobs(status?: ImportJobStatus) {
  return useQuery({
    queryKey: qk.imports.list(status),
    queryFn: () => api.get<ImportJobDto[]>('/v1/imports', status ? { status } : undefined),
    refetchInterval: (q) => (q.state.data?.some(isJobRunning) ? 3000 : false),
  });
}

function patchDetection(job: ImportJobDto | undefined, detection: Partial<DetectionDto> & { id: string }) {
  if (!job) return job;
  return { ...job, detections: job.detections.map((d) => (d.id === detection.id ? { ...d, ...detection } : d)) };
}

export function useAcceptDetection(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ detectionId, ...body }: AcceptDetectionRequest & { detectionId: string }) =>
      api.post<GarmentDetailDto>(`/v1/imports/${jobId}/detections/${detectionId}/accept`, body),
    onSuccess: (garment, vars) => {
      qc.setQueryData<ImportJobDto>(qk.imports.job(jobId), (job) =>
        patchDetection(job, { id: vars.detectionId, state: 'accepted', garmentId: garment.id }),
      );
      qc.invalidateQueries({ queryKey: qk.imports.all });
      invalidateWardrobe(qc);
    },
  });
}

export function useRejectDetection(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (detectionId: string) => api.post<DetectionDto>(`/v1/imports/${jobId}/detections/${detectionId}/reject`),
    onSuccess: (detection) => {
      qc.setQueryData<ImportJobDto>(qk.imports.job(jobId), (job) => patchDetection(job, detection));
      qc.invalidateQueries({ queryKey: qk.imports.all });
      qc.invalidateQueries({ queryKey: qk.home });
    },
  });
}

export function useAcceptAllDetections(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ accepted: number; garmentIds: string[] }>(`/v1/imports/${jobId}/accept-all`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.imports.all });
      invalidateWardrobe(qc);
    },
  });
}

// --- Link import -------------------------------------------------------------

export function useLinkImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: LinkImportRequest) => api.post<ImportedProductDto>('/v1/imports/link', body, { timeoutMs: 45_000 }),
    onSuccess: (p) => qc.setQueryData(qk.imports.product(p.id), p),
  });
}

export function usePageCapture() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PageCaptureRequest) => api.post<ImportedProductDto>('/v1/imports/link/capture', body, { timeoutMs: 45_000 }),
    onSuccess: (p) => qc.setQueryData(qk.imports.product(p.id), p),
  });
}

export function useImportedProduct(id: string | undefined) {
  return useQuery({
    queryKey: qk.imports.product(id ?? ''),
    queryFn: () => api.get<ImportedProductDto>(`/v1/imports/link/${id}`),
    enabled: !!id,
  });
}

export function useLinkToWardrobe(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: LinkToWardrobeRequest) => api.post<GarmentDetailDto>(`/v1/imports/link/${id}/to-wardrobe`, body),
    onSuccess: (g) => {
      qc.setQueryData(qk.garments.detail(g.id), g);
      invalidateWardrobe(qc);
    },
  });
}

export function useLinkToWishlist(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<WishlistItemDto>(`/v1/imports/link/${id}/to-wishlist`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.wishlist }),
  });
}

export function useTextImport() {
  return useMutation({
    mutationFn: (body: ReceiptTextImportRequest) => api.post<ReceiptImportResult>('/v1/imports/text', body, { timeoutMs: 45_000 }),
  });
}
