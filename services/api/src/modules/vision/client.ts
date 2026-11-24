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

  analyze(image: Buffer, mime: string, mode: 'single' | 'multi', maxItems = 8): Promise<VisionAnalysis> {
    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array(image)], { type: mime }), 'image');
    fd.append('mode', mode);
    fd.append('max_items', String(maxItems));
    return this.post('/v1/analyze', fd);
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
