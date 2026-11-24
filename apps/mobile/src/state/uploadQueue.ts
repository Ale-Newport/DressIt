import type { ImportJobDto, PhotoImportRequest, UploadKind } from '@dressit/shared';
import { useSyncExternalStore } from 'react';

import { api, errorMessage } from '@/api/client';
import { qk } from '@/api/keys';
import { queryClient } from '@/api/queryClient';
import { uploadImage } from '@/api/upload';

/**
 * Background upload queue for fast batch digitising.
 *
 * Photos are uploaded (3 in parallel) as soon as they are captured/picked, so the
 * user can keep shooting or leave the screen. When a session is submitted, the
 * import job(s) are created as soon as every photo of the session is uploaded.
 */

export type QueueItemStatus = 'queued' | 'uploading' | 'done' | 'error';

export interface QueueItem {
  localId: string;
  sessionId: string;
  uri: string;
  kind: UploadKind;
  status: QueueItemStatus;
  progress: number;
  imageId: string | null;
  duplicateOfImageId: string | null;
  error: string | null;
}

export type SessionStatus = 'collecting' | 'waiting_uploads' | 'submitting' | 'submitted' | 'error';

export interface ImportSession {
  id: string;
  source: PhotoImportRequest['source'];
  mode: PhotoImportRequest['mode'];
  createdAt: number;
  status: SessionStatus;
  jobIds: string[];
  /** Image ids already sent in an import job (retried photos get their own job later). */
  submittedImageIds: string[];
  error: string | null;
}

interface QueueState {
  items: QueueItem[];
  sessions: ImportSession[];
}

const CONCURRENCY = 3;
/** Large batches are split into several jobs so progress and review start sooner. */
const MAX_IMAGES_PER_JOB = 30;

let state: QueueState = { items: [], sessions: [] };
const listeners = new Set<() => void>();
const sessionWaiters = new Map<string, Array<(jobIds: string[]) => void>>();
let active = 0;
let seq = 0;

function emit() {
  for (const l of listeners) l();
}

function setState(next: QueueState) {
  state = next;
  emit();
}

function updateItem(localId: string, patch: Partial<QueueItem>) {
  setState({ ...state, items: state.items.map((i) => (i.localId === localId ? { ...i, ...patch } : i)) });
}

function updateSession(id: string, patch: Partial<ImportSession>) {
  setState({ ...state, sessions: state.sessions.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
}

function newId(prefix: string) {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

function pump() {
  while (active < CONCURRENCY) {
    const next = state.items.find((i) => i.status === 'queued');
    if (!next) break;
    active += 1;
    updateItem(next.localId, { status: 'uploading', progress: 0, error: null });
    uploadImage({
      uri: next.uri,
      kind: next.kind,
      onProgress: (p) => updateItem(next.localId, { progress: p.fraction }),
    })
      .then((res) =>
        updateItem(next.localId, { status: 'done', progress: 1, imageId: res.imageId, duplicateOfImageId: res.duplicateOfImageId }),
      )
      .catch((err) => updateItem(next.localId, { status: 'error', error: errorMessage(err) }))
      .finally(() => {
        active -= 1;
        maybeSubmit(next.sessionId);
        pump();
      });
  }
}

async function maybeSubmit(sessionId: string) {
  const session = state.sessions.find((s) => s.id === sessionId);
  // 'submitted' sessions still accept late photos (e.g. a failed upload retried afterwards).
  if (!session || (session.status !== 'waiting_uploads' && session.status !== 'submitted')) return;
  const items = state.items.filter((i) => i.sessionId === sessionId);
  if (items.some((i) => i.status === 'queued' || i.status === 'uploading')) return;
  const already = new Set(session.submittedImageIds);
  const imageIds = items.filter((i) => i.status === 'done' && i.imageId && !already.has(i.imageId)).map((i) => i.imageId!) as string[];
  if (imageIds.length === 0) {
    if (session.status === 'waiting_uploads') {
      updateSession(sessionId, { status: 'error', error: 'Ninguna foto se ha podido subir. Revisa tu conexión y reinténtalo.' });
    }
    return;
  }
  const wasSubmitted = session.status === 'submitted';
  updateSession(sessionId, { status: 'submitting', error: null });
  try {
    const jobIds: string[] = [];
    for (let i = 0; i < imageIds.length; i += MAX_IMAGES_PER_JOB) {
      const chunk = imageIds.slice(i, i + MAX_IMAGES_PER_JOB);
      const job = await api.post<ImportJobDto>('/v1/imports/photos', {
        imageIds: chunk,
        mode: session.mode,
        source: session.source,
      } satisfies PhotoImportRequest);
      queryClient.setQueryData(qk.imports.job(job.id), job);
      jobIds.push(job.id);
    }
    queryClient.invalidateQueries({ queryKey: qk.imports.all });
    queryClient.invalidateQueries({ queryKey: qk.home });
    const current = state.sessions.find((s) => s.id === sessionId);
    const allJobIds = [...(current?.jobIds ?? []), ...jobIds];
    updateSession(sessionId, {
      status: 'submitted',
      jobIds: allJobIds,
      submittedImageIds: [...(current?.submittedImageIds ?? []), ...imageIds],
    });
    sessionWaiters.get(sessionId)?.forEach((resolve) => resolve(allJobIds));
    sessionWaiters.delete(sessionId);
  } catch (err) {
    updateSession(sessionId, { status: wasSubmitted ? 'submitted' : 'error', error: errorMessage(err) });
  }
}

export const uploadQueue = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getState: () => state,

  createSession(source: ImportSession['source'], mode: ImportSession['mode'] = 'single'): string {
    const id = newId('session');
    setState({
      ...state,
      sessions: [...state.sessions, { id, source, mode, createdAt: Date.now(), status: 'collecting', jobIds: [], submittedImageIds: [], error: null }],
    });
    return id;
  },

  setMode(sessionId: string, mode: ImportSession['mode']) {
    updateSession(sessionId, { mode });
  },

  enqueue(sessionId: string, uris: string[], kind: UploadKind = 'garment_photo'): string[] {
    const created: QueueItem[] = uris.map((uri) => ({
      localId: newId('photo'),
      sessionId,
      uri,
      kind,
      status: 'queued',
      progress: 0,
      imageId: null,
      duplicateOfImageId: null,
      error: null,
    }));
    setState({ ...state, items: [...state.items, ...created] });
    pump();
    return created.map((c) => c.localId);
  },

  retry(localId: string) {
    updateItem(localId, { status: 'queued', error: null, progress: 0 });
    const item = state.items.find((i) => i.localId === localId);
    if (item) {
      const session = state.sessions.find((s) => s.id === item.sessionId);
      if (session?.status === 'error') updateSession(session.id, { status: 'waiting_uploads', error: null });
    }
    pump();
  },

  remove(localId: string) {
    const item = state.items.find((i) => i.localId === localId);
    if (!item || item.status === 'uploading') return;
    setState({ ...state, items: state.items.filter((i) => i.localId !== localId) });
    maybeSubmit(item.sessionId);
  },

  /**
   * Marks the session as finished: the import job is created once every upload
   * settles. Resolves with the created job ids.
   */
  submit(sessionId: string): Promise<string[]> {
    const session = state.sessions.find((s) => s.id === sessionId);
    if (session?.status === 'submitted') return Promise.resolve(session.jobIds);
    const promise = new Promise<string[]>((resolve) => {
      sessionWaiters.set(sessionId, [...(sessionWaiters.get(sessionId) ?? []), resolve]);
    });
    updateSession(sessionId, { status: 'waiting_uploads', error: null });
    maybeSubmit(sessionId);
    return promise;
  },

  /** Drops finished sessions and their items from memory. */
  clearSession(sessionId: string) {
    setState({
      items: state.items.filter((i) => i.sessionId !== sessionId),
      sessions: state.sessions.filter((s) => s.id !== sessionId),
    });
    sessionWaiters.delete(sessionId);
  },
};

export function useUploadQueue(): QueueState {
  return useSyncExternalStore(uploadQueue.subscribe, uploadQueue.getState, uploadQueue.getState);
}

export function useImportSession(sessionId: string | undefined) {
  const s = useUploadQueue();
  const session = s.sessions.find((x) => x.id === sessionId) ?? null;
  const items = s.items.filter((i) => i.sessionId === sessionId);
  return { session, items };
}

/** Aggregate numbers for a global progress indicator. */
export function summarizeQueue(s: QueueState) {
  const pending = s.items.filter((i) => i.status === 'queued' || i.status === 'uploading');
  const failed = s.items.filter((i) => i.status === 'error');
  const progress = pending.length ? pending.reduce((acc, i) => acc + i.progress, 0) / pending.length : 1;
  const submitting = s.sessions.filter((x) => x.status === 'waiting_uploads' || x.status === 'submitting');
  return { pending: pending.length, failed: failed.length, progress, submitting: submitting.length };
}
