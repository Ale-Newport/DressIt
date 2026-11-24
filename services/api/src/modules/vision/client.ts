import { timed } from '../../lib/metrics.ts';
import { unavailable } from '../../lib/errors.ts';

export interface VisionField<T> {
  value: T;
  confidence: number;
  alternatives?: Array<{ value: T; confidence: number }>;
}

export interface VisionItem {
  bbox: [number, number, number, number] | null;
  cutout_png_base64: string | null;
  mask_area_ratio?: number;
  category: VisionField<string> | null;
  subcategory: VisionField<string> | null;
  colors: Array<{ hex: string; family: string; share: number }>;
  pattern: VisionField<string> | null;
  materials: VisionField<string[]> | null;
  styles: VisionField<string[]> | null;
  seasons: VisionField<string[]> | null;
  fit: VisionField<string> | null;
  embedding: number[] | null;
  embedding_model: string | null;
  quality?: { blur?: number; brightness?: number; warnings?: string[] };
}

export interface PointSegmentation {
  cutout_png_base64: string;
  bbox: [number, number, number, number];
  mask_area_ratio: number;
  colors: Array<{ hex: string; family: string; share: number }>;
}

export interface DetailFidelity {
  shape_iou: number;
  mean_delta_e: number;
  p90_delta_e: number;
  max_cell_delta_e: number;
  ssim: number;
  cells: number;
  passed: boolean;
  reasons: string[];
}

export interface VisionAnalysis {
  image: { width: number; height: number; sha256: string; phash: string | null; exif_transposed?: boolean };
  items: VisionItem[];
  timings_ms?: Record<string, number>;
  model_versions?: Record<string, string>;
}

export interface VisionHealth {
  status: string;
  backend?: string;
  device?: string;
  models?: Record<string, boolean>;
}

/** HTTP client for services/vision. All failures surface as 503 with a Spanish message. */
export class VisionClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  constructor(baseUrl: string, timeoutMs: number) {
    this.baseUrl = baseUrl;
    this.timeoutMs = timeoutMs;
  }

  private async post<T>(path: string, body: FormData | string, json = false): Promise<T> {
    return timed('vision', async () => {
      let res: Response;
      try {
        res = await fetch(`${this.baseUrl}${path}`, {
          method: 'POST',
          body,
          headers: json ? { 'content-type': 'application/json' } : undefined,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (e) {
        throw unavailable('El servicio de análisis de imágenes no está disponible. Tus fotos se han guardado y se procesarán cuando vuelva.', { cause: (e as Error).message });
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw unavailable(`El análisis de la imagen ha fallado (${res.status}).`, { body: text.slice(0, 500) });
      }
      return (await res.json()) as T;
    });
  }

  /** `normalize: false` keeps the pixels as they are (AI studio photos are already colour-correct). */
  analyze(image: Buffer, mime: string, mode: 'single' | 'multi', maxItems = 8, opts: { normalize?: boolean } = {}): Promise<VisionAnalysis> {
    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array(image)], { type: mime }), 'image');
    fd.append('mode', mode);
    fd.append('max_items', String(maxItems));
    if (opts.normalize === false) fd.append('normalize', 'false');
    return this.post('/v1/analyze', fd);
  }

  /** Salient-subject matte (a person, for avatar backgrounds): RGBA PNG. */
  matte(image: Buffer, mime: string): Promise<{ png_base64: string; width: number; height: number; coverage: number }> {
    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array(image)], { type: mime }), 'image');
    return this.post('/v1/matte', fd);
  }

  /** Manual correction: re-segment from user points (normalised 0–1; label 1 = garment, 0 = not). */
  segmentPoints(image: Buffer, mime: string, points: Array<[number, number, 0 | 1]>, box?: [number, number, number, number] | null): Promise<PointSegmentation> {
    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array(image)], { type: mime }), 'image');
    fd.append('points', JSON.stringify(points));
    if (box) fd.append('box', JSON.stringify(box));
    return this.post('/v1/segment/points', fd);
  }

  /** Detail fidelity of a derived image against a garment's real cutout (both RGBA PNG). */
  compare(reference: Buffer, candidate: Buffer): Promise<DetailFidelity> {
    const fd = new FormData();
    fd.append('reference', new Blob([new Uint8Array(reference)], { type: 'image/png' }), 'reference.png');
    fd.append('candidate', new Blob([new Uint8Array(candidate)], { type: 'image/png' }), 'candidate.png');
    return this.post('/v1/compare', fd);
  }

  /**
   * Whole-image embedding. `segment: true` removes the background first, so a user photo is
   * embedded the same way as garment cutouts from /v1/analyze (use it for visual search);
   * catalog product photos are embedded as-is.
   */
  embedImage(image: Buffer, mime: string, opts: { segment?: boolean } = {}): Promise<{ embedding: number[]; model: string; dim: number }> {
    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array(image)], { type: mime }), 'image');
    fd.append('segment', opts.segment ? 'true' : 'false');
    return this.post('/v1/embed/image', fd);
  }

  embedText(texts: string[]): Promise<{ embeddings: number[][]; model: string; dim: number }> {
    return this.post('/v1/embed/text', JSON.stringify({ texts }), true);
  }

  ocr(image: Buffer, mime: string): Promise<{ text: string; lines: Array<{ text: string; confidence: number }> }> {
    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array(image)], { type: mime }), 'image');
    return this.post('/v1/ocr', fd);
  }

  async health(): Promise<VisionHealth | null> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(3000) });
      return res.ok ? ((await res.json()) as VisionHealth) : null;
    } catch {
      return null;
    }
  }
}
