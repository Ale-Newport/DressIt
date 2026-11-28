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
import { ComfyError, workflowCanvas } from '../imagegen/generator.ts';
import type { PackshotPrompt } from './prompt.ts';

export type GeneratorId = 'fashn' | 'fal' | 'comfy' | 'mlx';

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
  /** Output size this generator is tuned for; the service's default canvas otherwise. */
  canvas?: { width: number; height: number };
  available(): Promise<boolean>;
  generate(input: PackshotInput): Promise<PackshotOutput>;
}

/** A garment named by a vision-language model, as a shop would list it. */
export interface GarmentName {
  name: string;
  colour: string;
  /** top|bottom|one_piece|outerwear|footwear|accessory|not_clothing (or a free word the model chose). */
  category: string;
  /** False when the marked region is only a fragment of an item or a jumble of several things. */
  whole: boolean;
}

/** The vision-language model's comparison of the user's photo with a studio photo made of it (/v1/verify). */
export interface StudioVerdict {
  ok: boolean;
  /** What differs, in English ("knee length instead of very short", "laces added"). */
  problems: string[];
  /** How the item must look to correct them, for the next attempt's prompt. */
  fix: string;
}

/**
 * What a catalogue photo of the garment must keep, as the vision-language model saw it in the user's
 * photo (MLX server: services/imagegen/mlx/attrs.py); compared with what it reads on the studio photo.
 */
export interface GarmentAttributes {
  kind: string;
  /** The main colour of each part ("body beige; sleeves blue"). */
  colours: string;
  /** cropped … full, or n/a. */
  length: string;
  /** none | short | elbow | long | n/a. */
  sleeves: string;
  hood: boolean;
  laces: boolean;
  big_graphic_or_text: boolean;
  /** Letters, words or numbers on it (absent in detections made before 2026-11-28: not judged). */
  lettering?: boolean;
  sheer_or_lace: boolean;
  hatband: boolean;
  /** A coat with long tails at the back (a tailcoat). */
  tails: boolean;
  /** A bag with a short handle on top. */
  top_handle: boolean;
  /** Worn or held by someone in the photo (false: laid out, hanging, displayed). */
  worn: boolean;
}

/** A garment found in a whole photo by the vision-language model (MLX server /v1/garments). */
export interface FoundGarment {
  /** 0–1 of the photo. */
  box: [number, number, number, number];
  name: string;
  nameEs: string;
  /** The complete item as a shop would describe it, hidden parts included. */
  description: string;
  category: string;
  visible: 'whole' | 'partial';
  attributes?: GarmentAttributes | null;
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
  get canvas() {
    return workflowCanvas(this.workflow) ?? undefined;
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

/** The server's attributes, checked field by field (anything malformed is dropped). */
export function attributesOf(v: unknown): GarmentAttributes | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const str = (x: unknown) => (typeof x === 'string' ? x.slice(0, 60) : 'n/a');
  const bool = (x: unknown) => x === true;
  return { kind: str(o.kind), colours: typeof o.colours === 'string' ? o.colours.slice(0, 160) : '', length: str(o.length), sleeves: str(o.sleeves), hood: bool(o.hood), laces: bool(o.laces), big_graphic_or_text: bool(o.big_graphic_or_text), ...(typeof o.lettering === 'boolean' ? { lettering: o.lettering } : {}), sheer_or_lace: bool(o.sheer_or_lace), hatband: bool(o.hatband), tails: bool(o.tails), top_handle: bool(o.top_handle), worn: bool(o.worn) };
}

// ---------------------------------------------------------------------------
// MLX (local, Apple Silicon, no ComfyUI): services/imagegen/mlx/server.py
// ---------------------------------------------------------------------------

/**
 * FLUX.2 klein 4B run natively in MLX (mflux) by a small server that keeps the model loaded and
 * generates one image at a time. Same weights as the ComfyUI `packshot-fast` workflow, without
 * ComfyUI's graph, GGUF dequantisation and MPS overhead.
 */
export class MlxPackshot implements PackshotGenerator {
  readonly id = 'mlx' as const;
  readonly label = 'MLX (este Mac)';
  readonly model = 'FLUX.2 klein 4B (MLX)';
  readonly requires = ['IMAGEGEN_MLX_URL'];
  readonly configured: boolean;
  readonly estimatedCostCents = 0;
  readonly canvas = { width: 832, height: 1040 };
  private readonly opts: { url?: string; timeoutMs: number; steps?: number; fetcher?: Fetcher };
  constructor(opts: { url?: string; timeoutMs: number; steps?: number; fetcher?: Fetcher }) {
    this.opts = opts;
    this.configured = !!opts.url;
  }
  async available() {
    if (!this.opts.url) return false;
    try {
      const res = await (this.opts.fetcher ?? fetch)(`${this.opts.url}/health`, { signal: AbortSignal.timeout(3000) });
      return res.ok;
    } catch {
      return false;
    }
  }
  /**
   * Names the item inside the red rectangle of `marked` with the server's small vision-language model
   * ("Navy Blue Puffer Jacket"). Null when the namer is unavailable: the classifier's labels are used.
   */
  async describe(marked: Buffer): Promise<GarmentName | null> {
    return this.name('/v1/describe', marked);
  }
  /** What a generated studio photo actually shows ("Brown Leather Loafers"), to check it against the garment. */
  async identify(studio: Buffer): Promise<GarmentName | null> {
    return this.name('/v1/identify', studio);
  }
  private async name(path: string, image: Buffer): Promise<GarmentName | null> {
    if (!this.opts.url) return null;
    try {
      const res = await (this.opts.fetcher ?? fetch)(`${this.opts.url}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image: image.toString('base64') }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) return null;
      const d = (await res.json()) as Partial<GarmentName>;
      const name = typeof d.name === 'string' ? d.name.trim().slice(0, 80) : '';
      if (!name) return null;
      return { name, colour: typeof d.colour === 'string' ? d.colour.trim().slice(0, 40) : '', category: typeof d.category === 'string' ? d.category.trim().toLowerCase() : '', whole: d.whole !== false };
    } catch {
      return null;
    }
  }
  /**
   * What the studio photo got wrong against the user's photo (`marked`: the garment in a red rectangle):
   * the model reads the studio photo (length, sleeves, hood, laces, a large print, lace, a hatband) and
   * rules compare it with the garment's attributes from the detection (`original`; read from `marked`
   * when there are none). Null when the server cannot tell.
   */
  async verify(marked: Buffer, studio: Buffer, garment: { name: string; category: string; partial: boolean; lengthUnseen?: boolean; original: GarmentAttributes | null }): Promise<StudioVerdict | null> {
    if (!this.opts.url) return null;
    try {
      const res = await (this.opts.fetcher ?? fetch)(`${this.opts.url}/v1/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ photo: marked.toString('base64'), image: studio.toString('base64'), name: garment.name, category: garment.category, partial: garment.partial, length_unseen: !!garment.lengthUnseen, ...(garment.original ? { original: garment.original } : {}) }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) return null;
      const d = (await res.json()) as Partial<StudioVerdict>;
      if (typeof d.ok !== 'boolean') return null;
      const problems = Array.isArray(d.problems) ? d.problems.filter((p): p is string => typeof p === 'string' && !!p.trim()).map((p) => p.trim().slice(0, 120)).slice(0, 8) : [];
      return { ok: d.ok && !problems.length, problems, fix: typeof d.fix === 'string' ? d.fix.trim().slice(0, 300) : '' };
    } catch {
      return null;
    }
  }
  /**
   * The garment's own cutout cleaned into a studio photo by klein image-to-image (~12 s): it keeps the
   * item's shape, so it cannot become another item, for what the editor cannot redraw (it drew a
   * tailcoat as a suit however it was described).
   */
  async restore(input: { cutout: Buffer; name: string; description: string | null; seed: number }): Promise<PackshotOutput> {
    if (!this.opts.url) throw new GenerationError('El generador local MLX no está configurado (falta IMAGEGEN_MLX_URL).', false);
    let res: Response;
    try {
      res = await (this.opts.fetcher ?? fetch)(`${this.opts.url}/v1/restore`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cutout: input.cutout.toString('base64'), name: input.name, description: input.description ?? '', seed: input.seed }),
        signal: AbortSignal.timeout(this.opts.timeoutMs),
      });
    } catch (e) {
      throw new GenerationError(`El generador local MLX no responde (${(e as Error).name}).`, true);
    }
    if (!res.ok) throw new GenerationError(`El generador local MLX respondió ${res.status}: ${(await res.text()).slice(0, 200)}`, res.status >= 500);
    return { image: Buffer.from(await res.arrayBuffer()), model: `${this.model}, restaurada`, costCents: 0 };
  }
  /**
   * Every garment and accessory in a whole photo, each as ONE item (a tailcoat split in two by a box
   * detector, a pair of shoes), with its box and a description of the complete item. Null when the
   * server is unavailable or answers nothing usable: the vision service's detector is used instead.
   */
  async garments(photo: Buffer): Promise<FoundGarment[] | null> {
    if (!this.opts.url) return null;
    try {
      const res = await (this.opts.fetcher ?? fetch)(`${this.opts.url}/v1/garments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image: photo.toString('base64') }),
        // The server answers one request at a time: a detection (~20-30 s) waits behind the ones and the
        // studio photos (~20-50 s each) already in line, easily past 2 min when several photos are
        // imported at once. Waiting beats the fallback detector, which names nothing.
        signal: AbortSignal.timeout(Math.min(this.opts.timeoutMs, 300_000)),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { items?: Array<Record<string, unknown>> };
      const str = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
      const out: FoundGarment[] = [];
      for (const it of body.items ?? []) {
        const box = it.box;
        if (!Array.isArray(box) || box.length !== 4 || !box.every((v) => typeof v === 'number' && v >= 0 && v <= 1)) continue;
        const name = str(it.name, 80);
        if (!name) continue;
        out.push({
          box: box as [number, number, number, number],
          name,
          nameEs: str(it.name_es, 80) || name,
          description: str(it.description, 400) || name,
          category: str(it.category, 20).toLowerCase(),
          visible: it.visible === 'partial' ? 'partial' : 'whole',
          attributes: attributesOf(it.attributes),
        });
      }
      return out.length ? out : null;
    } catch {
      return null;
    }
  }
  /**
   * The person of `person` wearing the garments of `garments` (1–4 product photos), in one pass of the
   * same editor (multi-reference): face, body, pose and background come from the person's photo.
   */
  async tryon(input: { person: Buffer; garments: Buffer[]; prompt: string; seed: number }): Promise<{ image: Buffer; seconds: number }> {
    if (!this.opts.url) throw new GenerationError('El generador local MLX no está configurado (falta IMAGEGEN_MLX_URL).', false);
    let res: Response;
    try {
      res = await (this.opts.fetcher ?? fetch)(`${this.opts.url}/v1/tryon`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ person: input.person.toString('base64'), garments: input.garments.map((g) => g.toString('base64')), prompt: input.prompt, seed: input.seed, steps: this.opts.steps ?? 4 }),
        signal: AbortSignal.timeout(this.opts.timeoutMs),
      });
    } catch (e) {
      throw new GenerationError(`El generador local MLX no responde (${(e as Error).name}).`, true);
    }
    if (!res.ok) throw new GenerationError(`El generador local MLX respondió ${res.status}: ${(await res.text()).slice(0, 200)}`, res.status >= 500);
    return { image: Buffer.from(await res.arrayBuffer()), seconds: Number(res.headers.get('x-generation-seconds') ?? 0) };
  }
  /** Which garments the person in a try-on render actually wears (one bool per label); null if it cannot tell. */
  async tryonWorn(render: Buffer, labels: string[]): Promise<boolean[] | null> {
    if (!this.opts.url) return null;
    try {
      const res = await (this.opts.fetcher ?? fetch)(`${this.opts.url}/v1/tryon/check`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image: render.toString('base64'), labels }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) return null;
      const d = (await res.json()) as { worn?: unknown };
      return Array.isArray(d.worn) && d.worn.length === labels.length ? d.worn.map((v) => v !== false) : null;
    } catch {
      return null;
    }
  }
  async generate(input: PackshotInput): Promise<PackshotOutput> {
    if (!this.opts.url) throw new GenerationError('El generador local MLX no está configurado (falta IMAGEGEN_MLX_URL).', false);
    let res: Response;
    try {
      res = await (this.opts.fetcher ?? fetch)(`${this.opts.url}/v1/edit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image: input.photo.toString('base64'), prompt: input.prompt.prompt, seed: input.seed, width: input.width, height: input.height, steps: this.opts.steps ?? 4 }),
        signal: AbortSignal.timeout(this.opts.timeoutMs),
      });
    } catch (e) {
      throw new GenerationError(`El generador local MLX no responde (${(e as Error).name}).`, true);
    }
    if (!res.ok) throw new GenerationError(`El generador local MLX respondió ${res.status}: ${(await res.text()).slice(0, 200)}`, res.status >= 500);
    return { image: Buffer.from(await res.arrayBuffer()), model: this.model, costCents: 0 };
  }
}

export function createPackshotGenerators(cfg: Config, imagegen: ImageGenerator, fetcher?: Fetcher): PackshotGenerator[] {
  const all: Record<GeneratorId, PackshotGenerator> = {
    fashn: new FashnPackshot({ apiKey: cfg.FASHN_API_KEY, mode: cfg.FASHN_GENERATION_MODE, resolution: cfg.FASHN_RESOLUTION, centsPerCredit: cfg.FASHN_CENTS_PER_CREDIT, timeoutMs: cfg.PACKSHOT_TIMEOUT_MS, fetcher }),
    fal: new FalPackshot({ apiKey: cfg.FAL_KEY, endpoint: cfg.FAL_PACKSHOT_MODEL, costCents: cfg.FAL_COST_CENTS, timeoutMs: cfg.PACKSHOT_TIMEOUT_MS, fetcher }),
    comfy: new ComfyPackshot(imagegen, cfg.IMAGEGEN_PACKSHOT_WORKFLOW, !!cfg.IMAGEGEN_COMFY_URL),
    mlx: new MlxPackshot({ url: cfg.IMAGEGEN_MLX_URL, timeoutMs: cfg.PACKSHOT_TIMEOUT_MS, fetcher }),
  };
  const order = cfg.PACKSHOT_PROVIDERS.split(',')
    .map((s) => s.trim())
    .filter((s): s is GeneratorId => s in all);
  return [...new Set(order)].map((id) => all[id]);
}
