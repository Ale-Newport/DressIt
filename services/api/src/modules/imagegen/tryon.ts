/**
 * Client for services/tryon: FASHN VTON v1.5 (one garment per pass) and Sapiens2 parsing of the
 * worn clothes (for the fidelity gate).
 */
import { ComfyError } from './comfy.ts';

export type TryonCategory = 'tops' | 'bottoms' | 'one-pieces';
export interface ParsedRegion {
  area: number;
  png_base64: string | null;
}
/** `feet`: feet, socks or shoes — whether the photo shows the feet at all. */
export type ParsedRegions = Record<'upper' | 'lower' | 'shoes' | 'face' | 'feet', ParsedRegion>;

export interface TryonService {
  health(): Promise<boolean>;
  /** `mask`: replace what the person wears there (first garment of a region) instead of dressing over it. */
  tryon(person: Buffer, garment: Buffer, category: TryonCategory, opts: { steps: number; seed: number; mask?: boolean }): Promise<Buffer>;
  parse(image: Buffer): Promise<ParsedRegions>;
  /** `base` with `edited` pasted only inside those body regions (the rest stays pixel-identical). */
  composite(base: Buffer, edited: Buffer, regions: ExtraRegion[]): Promise<Buffer>;
}

export type ExtraRegion = 'feet' | 'head' | 'neck';

export class TryonClient implements TryonService {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  constructor(baseUrl: string, timeoutMs: number) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
  }

  private async post(path: string, fd: FormData): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, { method: 'POST', body: fd, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch {
      throw new ComfyError('El probador virtual no responde.', true);
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      throw new ComfyError(body?.error?.message ?? `El probador virtual respondió ${res.status}.`, res.status >= 500);
    }
    return res;
  }

  async composite(base: Buffer, edited: Buffer, regions: ExtraRegion[]): Promise<Buffer> {
    const fd = new FormData();
    fd.append('base', new Blob([new Uint8Array(base)], { type: 'image/png' }), 'base.png');
    fd.append('edited', new Blob([new Uint8Array(edited)], { type: 'image/png' }), 'edited.png');
    fd.append('regions', regions.join(','));
    return Buffer.from(await (await this.post('/v1/composite', fd)).arrayBuffer());
  }

  async health(): Promise<boolean> {
    try {
      const r = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(3000) });
      const j = (await r.json()) as { models?: Record<string, boolean> };
      return r.ok && !!j.models?.['fashn-vton-1.5'] && !!j.models?.dwpose;
    } catch {
      return false;
    }
  }

  async tryon(person: Buffer, garment: Buffer, category: TryonCategory, opts: { steps: number; seed: number; mask?: boolean }): Promise<Buffer> {
    const fd = new FormData();
    fd.append('person', new Blob([new Uint8Array(person)], { type: 'image/png' }), 'person.png');
    fd.append('garment', new Blob([new Uint8Array(garment)], { type: 'image/png' }), 'garment.png');
    fd.append('category', category);
    fd.append('steps', String(opts.steps));
    fd.append('seed', String(opts.seed));
    fd.append('mask', opts.mask ? 'true' : 'false');
    return Buffer.from(await (await this.post('/v1/tryon', fd)).arrayBuffer());
  }

  async parse(image: Buffer): Promise<ParsedRegions> {
    const fd = new FormData();
    fd.append('image', new Blob([new Uint8Array(image)], { type: 'image/png' }), 'image.png');
    return (await (await this.post('/v1/parse', fd)).json()) as ParsedRegions;
  }
}
