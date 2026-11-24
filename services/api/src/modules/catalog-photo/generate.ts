/**
 * Generative packshot providers: they receive the user's photo of the garment (a crop around it) and
 * the instruction from prompt.ts, and return a new product photo. In order of preference
 * (PACKSHOT_PROVIDERS), the first configured and reachable one is used and the next ones are fallbacks:
 *
 * - FASHN Agent Images (https://docs.fashn.ai/api-reference/agent-images): FASHN's fashion agent,
 *   the API route to its Packshot product (ghost mannequin, flat lay, wrinkle and drape fixing).
 *   POST /v1/agent/images (synchronous), images as base64 data URIs. ~1 credit ($0.075) per image
 *   at `balanced` 1k; the credits used are read from the response.
 * - fal.ai queue API with Qwen-Image-Edit-2511 (Apache-2.0 weights): POST queue.fal.run/{model},
 *   poll `status_url`, read `response_url`. $0.03 per megapixel.
 * - ComfyUI (IMAGEGEN_COMFY_URL) with the `packshot` workflow: the same Qwen-Image-Edit-2511 run on
 *   our own hardware (GGUF Q4_K_M + Lightning 4 steps).
 *
 * Generated images are never used without the fidelity and presentation checks of service.ts.
 */
import type { Config } from '../../config.ts';
import type { ImageGenerator } from '../imagegen/generator.ts';
import { ComfyError } from '../imagegen/generator.ts';
import type { PackshotPrompt } from './prompt.ts';

export type GeneratorId = 'fashn' | 'fal' | 'comfy';

export interface PackshotInput {
  /** The user's photo cropped around the garment (JPEG/PNG). */
  photo: Buffer;
  mime: string;
  prompt: PackshotPrompt;
  seed: number;
  width: number;
  height: number;
}

export interface PackshotOutput {
  image: Buffer;
  model: string;
  costCents: number;
}

export interface PackshotGenerator {
  id: GeneratorId;
  label: string;
  /** Shown to the user next to the AI label. */
  model: string;
  requires: string[];
  configured: boolean;
  /** Expected cost of one image, for the budget check before calling. */
  estimatedCostCents: number;
  available(): Promise<boolean>;
  generate(input: PackshotInput): Promise<PackshotOutput>;
}

export class GenerationError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.retryable = retryable;
  }
}

type Fetcher = typeof fetch;
const dataUri = (buf: Buffer, mime: string) => `data:${mime};base64,${buf.toString('base64')}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function json(fetcher: Fetcher, url: string, init: RequestInit, label: string, timeoutMs: number): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetcher(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw new GenerationError(`${label} no responde (${(e as Error).name}).`, true);
  }
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) {
    const err = body.error ?? body.detail ?? text.slice(0, 200);
    const msg = typeof err === 'string' ? err : JSON.stringify(err).slice(0, 200);
    throw new GenerationError(`${label} respondió ${res.status}: ${msg}`, res.status === 429 || res.status >= 500);
  }
  return body;
}

async function download(fetcher: Fetcher, url: string, label: string): Promise<Buffer> {
  if (url.startsWith('data:')) return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
  let res: Response;
  try {
    res = await fetcher(url, { signal: AbortSignal.timeout(60_000) });
  } catch {
    throw new GenerationError(`No se ha podido descargar la imagen de ${label}.`, true);
  }
  if (!res.ok) throw new GenerationError(`No se ha podido descargar la imagen de ${label} (${res.status}).`, true);
  return Buffer.from(await res.arrayBuffer());
}

// ---------------------------------------------------------------------------
// FASHN Agent Images
// ---------------------------------------------------------------------------

export class FashnPackshot implements PackshotGenerator {
  readonly id = 'fashn' as const;
  readonly label = 'FASHN';
  readonly model = 'FASHN Agent Images (Packshot)';
  readonly requires = ['FASHN_API_KEY'];
  readonly configured: boolean;
  get estimatedCostCents() {
    return this.opts.centsPerCredit * (this.opts.mode === 'quality' ? 2 : 1) * (this.opts.mode === 'fast' || this.opts.resolution === '1k' ? 1 : 2);
  }
  private readonly opts: { apiKey?: string; mode: 'fast' | 'balanced' | 'quality'; resolution: '1k' | '2k' | '3k' | '4k'; centsPerCredit: number; timeoutMs: number; fetcher?: Fetcher };
  constructor(opts: { apiKey?: string; mode: 'fast' | 'balanced' | 'quality'; resolution: '1k' | '2k' | '3k' | '4k'; centsPerCredit: number; timeoutMs: number; fetcher?: Fetcher }) {
    this.opts = opts;
    this.configured = !!opts.apiKey;
  }
  async available() {
    return this.configured;
  }
  async generate(input: PackshotInput): Promise<PackshotOutput> {
    if (!this.opts.apiKey) throw new GenerationError('FASHN no está configurado (falta FASHN_API_KEY).', false);
    const fetcher = this.opts.fetcher ?? fetch;
    const body = await json(
      fetcher,
      'https://api.fashn.ai/v1/agent/images',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${this.opts.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt: `${input.prompt.prompt} The first image is the reference photograph. Generate exactly one image.`,
          images: [dataUri(input.photo, input.mime)],
          aspect_ratio: '4:5',
          resolution: this.opts.resolution,
          generation_mode: this.opts.mode,
          return_base64: false,
        }),
      },
      'FASHN',
      this.opts.timeoutMs,
    );
    if (body.status === 'failed' || body.error) {
      const e = body.error as { name?: string; message?: string } | null;
      throw new GenerationError(`FASHN no ha generado la imagen: ${e?.message ?? e?.name ?? 'error'}`, e?.name !== 'NoImageGenerated' && e?.name !== 'ImageLoadError');
    }
    const preds = (body.predictions as Array<{ tool?: string; status?: string; results?: string[] }> | undefined) ?? [];
    const result = preds.filter((p) => p.status === 'completed' && p.results?.length).flatMap((p) => p.results ?? []).at(-1);
    if (!result) throw new GenerationError('FASHN no ha devuelto ninguna imagen.', true);
    const credits = Number(body.credits_used ?? 1);
    return { image: await download(fetcher, result, 'FASHN'), model: this.model, costCents: credits * this.opts.centsPerCredit };
  }
}

// ---------------------------------------------------------------------------
// fal.ai — Qwen-Image-Edit-2511
// ---------------------------------------------------------------------------

export class FalPackshot implements PackshotGenerator {
  readonly id = 'fal' as const;
  readonly label = 'fal.ai';
  readonly model: string;
  readonly requires = ['FAL_KEY'];
  readonly configured: boolean;
  get estimatedCostCents() {
    return this.opts.costCents;
  }
  private readonly opts: { apiKey?: string; endpoint: string; costCents: number; timeoutMs: number; fetcher?: Fetcher; pollMs?: number };
  constructor(opts: { apiKey?: string; endpoint: string; costCents: number; timeoutMs: number; fetcher?: Fetcher; pollMs?: number }) {
    this.opts = opts;
    this.configured = !!opts.apiKey;
    this.model = `Qwen-Image-Edit-2511 (fal.ai ${opts.endpoint})`;
  }
  async available() {
    return this.configured;
  }
  async generate(input: PackshotInput): Promise<PackshotOutput> {
    if (!this.opts.apiKey) throw new GenerationError('fal.ai no está configurado (falta FAL_KEY).', false);
    const fetcher = this.opts.fetcher ?? fetch;
    const headers = { authorization: `Key ${this.opts.apiKey}`, 'content-type': 'application/json' };
    const queued = await json(
      fetcher,
      `https://queue.fal.run/${this.opts.endpoint}`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          prompt: input.prompt.prompt,
          negative_prompt: input.prompt.negative,
          image_urls: [dataUri(input.photo, input.mime)],
          image_size: { width: input.width, height: input.height },
          num_inference_steps: 28,
          guidance_scale: 4.5,
          num_images: 1,
          seed: input.seed,
          output_format: 'png',
          enable_safety_checker: true,
        }),
      },
      'fal.ai',
      60_000,
    );
    const statusUrl = String(queued.status_url ?? '');
    const responseUrl = String(queued.response_url ?? '');
    if (!statusUrl || !responseUrl) throw new GenerationError('fal.ai no ha aceptado el trabajo.', true);
    const deadline = Date.now() + this.opts.timeoutMs;
    for (;;) {
      const st = await json(fetcher, statusUrl, { headers }, 'fal.ai', 30_000);
      if (st.status === 'COMPLETED') {
        if (st.error) throw new GenerationError(`fal.ai no ha generado la imagen: ${String(st.error).slice(0, 200)}`, false);
        break;
      }
      if (Date.now() > deadline) {
        await fetcher(String(queued.cancel_url ?? `${responseUrl}/cancel`), { method: 'PUT', headers }).catch(() => undefined);
        throw new GenerationError('fal.ai ha tardado demasiado.', true);
      }
      await sleep(this.opts.pollMs ?? 2000);
    }
    const result = await json(fetcher, responseUrl, { headers }, 'fal.ai', 60_000);
    const url = (result.images as Array<{ url?: string }> | undefined)?.[0]?.url;
    if (!url) throw new GenerationError('fal.ai no ha devuelto ninguna imagen.', true);
    if ((result.has_nsfw_concepts as boolean[] | undefined)?.[0]) throw new GenerationError('fal.ai ha bloqueado la imagen por su filtro de seguridad.', false);
    return { image: await download(fetcher, url, 'fal.ai'), model: this.model, costCents: this.opts.costCents };
  }
}

// ---------------------------------------------------------------------------
// ComfyUI (local / self-hosted)
// ---------------------------------------------------------------------------

export class ComfyPackshot implements PackshotGenerator {
  readonly id = 'comfy' as const;
  readonly label = 'ComfyUI (servidor propio)';
  readonly requires = ['IMAGEGEN_COMFY_URL'];
  readonly configured: boolean;
  readonly estimatedCostCents = 0;
  private readonly imagegen: ImageGenerator;
  private readonly workflow: string;
  constructor(imagegen: ImageGenerator, workflow: string, configured: boolean) {
    this.imagegen = imagegen;
    this.workflow = workflow;
    this.configured = configured;
  }
  get model(): string {
    return this.imagegen.workflowModel(this.workflow) ?? 'Qwen-Image-Edit-2511';
  }
  async available() {
    return this.configured && this.imagegen.hasWorkflow(this.workflow) && (await this.imagegen.info()).available;
  }
  async generate(input: PackshotInput): Promise<PackshotOutput> {
    try {
      const image = await this.imagegen.run(this.workflow, { INPUT_IMAGE: input.photo }, { PROMPT: input.prompt.prompt, SEED: input.seed, WIDTH: input.width, HEIGHT: input.height });
      return { image, model: this.model, costCents: 0 };
    } catch (e) {
      if (e instanceof ComfyError) throw new GenerationError(e.message, e.retryable);
      throw e;
    }
  }
}

export function createPackshotGenerators(cfg: Config, imagegen: ImageGenerator, fetcher?: Fetcher): PackshotGenerator[] {
  const all: Record<GeneratorId, PackshotGenerator> = {
    fashn: new FashnPackshot({ apiKey: cfg.FASHN_API_KEY, mode: cfg.FASHN_GENERATION_MODE, resolution: cfg.FASHN_RESOLUTION, centsPerCredit: cfg.FASHN_CENTS_PER_CREDIT, timeoutMs: cfg.PACKSHOT_TIMEOUT_MS, fetcher }),
    fal: new FalPackshot({ apiKey: cfg.FAL_KEY, endpoint: cfg.FAL_PACKSHOT_MODEL, costCents: cfg.FAL_COST_CENTS, timeoutMs: cfg.PACKSHOT_TIMEOUT_MS, fetcher }),
    comfy: new ComfyPackshot(imagegen, cfg.IMAGEGEN_PACKSHOT_WORKFLOW, !!cfg.IMAGEGEN_COMFY_URL),
  };
  const order = cfg.PACKSHOT_PROVIDERS.split(',')
    .map((s) => s.trim())
    .filter((s): s is GeneratorId => s in all);
  return [...new Set(order)].map((id) => all[id]);
}
