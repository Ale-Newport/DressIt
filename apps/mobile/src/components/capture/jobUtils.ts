import type { ImportJobDto } from '@dressit/shared';

import type { BadgeTone } from '@/components/ui';

/** 0–1 progress of an import job (`progress` may arrive as 0–1 or 0–100). */
export function jobProgress(job: ImportJobDto): number {
  if (job.status === 'completed' || job.status === 'needs_review') return 1;
  if (job.total > 0) return Math.min(1, job.processed / job.total);
  return job.progress > 1 ? job.progress / 100 : job.progress;
}

export const JOB_TONE: Record<ImportJobDto['status'], BadgeTone> = {
  queued: 'neutral',
  processing: 'info',
  needs_review: 'accent',
  completed: 'success',
  failed: 'danger',
  cancelled: 'neutral',
};
