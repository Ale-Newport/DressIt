import type { UploadKind, UploadResponse } from '@dressit/shared';
import { File, UploadType } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { api, type ApiClient, ApiError, NETWORK_ERROR_MESSAGE, toApiError } from './client';
import { UPLOAD_TIMEOUT_MS } from './config';

export interface UploadProgress {
  sent: number;
  total: number;
  /** 0–1 */
  fraction: number;
}

export interface UploadImageOptions {
  uri: string;
  kind: UploadKind;
  mimeType?: string;
  onProgress?: (p: UploadProgress) => void;
  signal?: AbortSignal;
  /** Resize/compress before upload (default true). */
  optimize?: boolean;
  client?: ApiClient;
}

/** Longest side per upload kind: labels/receipts keep more detail for OCR. */
const MAX_SIDE: Record<UploadKind, number> = {
  garment_photo: 2048,
  inspiration: 1600,
  visual_search: 1280,
  screenshot: 2400,
  receipt: 2400,
  label: 2400,
};

/**
 * Downscale + re-encode as JPEG on-device. Typical phone photos (4–12 MB) become
 * ~300–700 KB, which keeps batch digitising fast on mobile networks. Also strips EXIF
 * (incl. GPS) because the image is re-encoded from pixels.
 */
export async function prepareImage(uri: string, kind: UploadKind): Promise<{ uri: string; mimeType: string }> {
  try {
    const ctx = ImageManipulator.manipulate(uri);
    const img = await ctx.renderAsync();
    const max = MAX_SIDE[kind];
    const { width, height } = img;
    let final = img;
    if (Math.max(width, height) > max) {
      const ctx2 = ImageManipulator.manipulate(uri);
      ctx2.resize(width >= height ? { width: max } : { height: max });
      final = await ctx2.renderAsync();
    }
    const saved = await final.saveAsync({ compress: 0.82, format: SaveFormat.JPEG });
    return { uri: saved.uri, mimeType: 'image/jpeg' };
  } catch {
    // If manipulation fails (unsupported format), upload the original.
    return { uri, mimeType: guessMime(uri) };
  }
}

function guessMime(uri: string): string {
  const lower = uri.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.heic') || lower.endsWith('.heif')) return 'image/heic';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

/**
 * Native upload counters are Int64: on iOS they arrive as BigInt despite the `number` typings,
 * and mixing BigInt with number throws in Hermes. Normalise before any arithmetic.
 */
export function toUploadProgress(bytesSent: number | bigint, totalBytes: number | bigint): UploadProgress {
  const sent = Number(bytesSent);
  const reported = Number(totalBytes);
  const total = reported > 0 ? reported : 1;
  return { sent, total, fraction: Math.min(1, sent / total) };
}

/**
 * `POST /v1/uploads` (multipart: `file` + `kind`). Uses expo-file-system's native
 * upload task for real progress events; retries once after a token refresh on 401.
 */
export async function uploadImage(opts: UploadImageOptions): Promise<UploadResponse> {
  const client = opts.client ?? api;
  const prepared = opts.optimize === false ? { uri: opts.uri, mimeType: opts.mimeType ?? guessMime(opts.uri) } : await prepareImage(opts.uri, opts.kind);
  const url = `${client.baseUrl()}/v1/uploads`;

  const attempt = async (token: string | null) => {
    const file = new File(prepared.uri);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
    const onAbort = () => controller.abort();
    opts.signal?.addEventListener('abort', onAbort);
    try {
      return await file.upload(url, {
        httpMethod: 'POST',
        uploadType: UploadType.MULTIPART,
        fieldName: 'file',
        mimeType: prepared.mimeType,
        parameters: { kind: opts.kind },
        headers: token ? { Authorization: `Bearer ${token}`, Accept: 'application/json' } : { Accept: 'application/json' },
        signal: controller.signal,
        onProgress: (p) => opts.onProgress?.(toUploadProgress(p.bytesSent, p.totalBytes)),
      });
    } catch (err) {
      if (err instanceof ApiError) throw err;
      if (controller.signal.aborted && !opts.signal?.aborted) {
        throw new ApiError(0, 'timeout', 'La subida está tardando demasiado. Comprueba tu conexión.');
      }
      throw new ApiError(0, 'network_error', NETWORK_ERROR_MESSAGE);
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
    }
  };

  let token = await client.getAccessToken();
  let result = await attempt(token);
  if (result.status === 401) {
    token = await client.refresh();
    if (!token) throw new ApiError(401, 'session_expired', 'Tu sesión ha caducado. Vuelve a iniciar sesión.');
    result = await attempt(token);
  }
  const body = parse(result.body);
  if (result.status < 200 || result.status >= 300) throw toApiError(result.status, body);
  opts.onProgress?.({ sent: 1, total: 1, fraction: 1 });
  return body as UploadResponse;
}

function parse(text: string): unknown {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}
