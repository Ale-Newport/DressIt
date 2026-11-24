/**
 * Minimal client for a ComfyUI server's HTTP API (https://github.com/Comfy-Org/ComfyUI), used as an
 * external process: images are uploaded to its input folder, an API-format workflow is queued, the
 * history is polled until the prompt finishes and the output image is downloaded.
 *
 *   POST /upload/image  (multipart: image, type=input, overwrite)  → { name, subfolder, type }
 *   POST /prompt        { prompt, client_id }                       → { prompt_id, node_errors }
 *   GET  /history/:id   → { [id]: { status: { completed, status_str, messages }, outputs: { node: { images: [...] } } } }
 *   GET  /view?filename&subfolder&type=output → bytes
 *   GET  /system_stats  → health
 *   GET  /queue · POST /queue {delete} · POST /interrupt → giving up on a prompt (only ours)
 *
 * ComfyUI is GPL-3.0; DressIt only talks to it over HTTP as a separate program.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export class ComfyError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.retryable = retryable;
  }
}

type Json = Record<string, unknown>;
export type Workflow = Record<string, { class_type: string; inputs: Json; _meta?: Json }>;

const WORKFLOW_DIR = join(dirname(fileURLToPath(import.meta.url)), 'workflows');

/** Loads `workflows/<name>.json` (ComfyUI "Save (API)" format). */
export function loadWorkflow(name: string): Workflow {
  if (!/^[a-z0-9_-]{1,60}$/i.test(name)) throw new Error(`Nombre de workflow no válido: ${name}`);
  return JSON.parse(readFileSync(join(WORKFLOW_DIR, `${name}.json`), 'utf8')) as Workflow;
}

/**
 * Replaces `{{PLACEHOLDER}}` strings anywhere in the workflow. A value that is exactly a
 * placeholder takes the replacement's type (so `"{{SEED}}"` becomes a number).
 */
export function fillWorkflow(workflow: Workflow, values: Record<string, string | number>): Workflow {
  const missing = new Set<string>();
  const visit = (v: unknown): unknown => {
    if (typeof v === 'string') {
      const whole = /^\{\{([A-Z0-9_]+)\}\}$/.exec(v);
      if (whole) {
        if (!(whole[1]! in values)) missing.add(whole[1]!);
        return values[whole[1]!] ?? v;
      }
      return v.replace(/\{\{([A-Z0-9_]+)\}\}/g, (m, k: string) => {
        if (!(k in values)) missing.add(k);
        return k in values ? String(values[k]) : m;
      });
    }
    if (Array.isArray(v)) return v.map(visit);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, visit(x)]));
    return v;
  };
  const out = visit(workflow) as Workflow;
  if (missing.size) throw new Error(`Faltan valores para el workflow: ${[...missing].join(', ')}`);
  return out;
}

export class ComfyClient {
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  constructor(baseUrl: string, fetcher: typeof fetch = fetch) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.fetcher = fetcher;
  }

  private async call(path: string, init?: RequestInit, timeoutMs = 30_000): Promise<Response> {
    let res: Response;
    try {
      res = await this.fetcher(`${this.baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      throw new ComfyError('El generador de imágenes no responde.', true);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new ComfyError(`El generador de imágenes respondió ${res.status}${body ? `: ${body.slice(0, 300)}` : ''}`, res.status >= 500);
    }
    return res;
  }

  async health(): Promise<boolean> {
    try {
      await this.call('/system_stats', undefined, 3000);
      return true;
    } catch {
      return false;
    }
  }

  /** Uploads an input image; returns the name to reference from LoadImage nodes. */
  async uploadImage(data: Buffer, filename: string): Promise<string> {
    const fd = new FormData();
    fd.append('image', new Blob([new Uint8Array(data)]), filename);
    fd.append('type', 'input');
    fd.append('overwrite', 'true');
    const json = (await (await this.call('/upload/image', { method: 'POST', body: fd })).json()) as { name: string; subfolder?: string };
    return json.subfolder ? `${json.subfolder}/${json.name}` : json.name;
  }

  /** Queues a workflow, waits for it and returns the first output image. */
  async run(workflow: Workflow, timeoutMs: number, pollMs = 1000): Promise<Buffer> {
    const clientId = randomUUID();
    const queued = (await (await this.call('/prompt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: workflow, client_id: clientId }) })).json()) as {
      prompt_id?: string;
      node_errors?: Json;
      error?: unknown;
    };
    if (!queued.prompt_id || (queued.node_errors && Object.keys(queued.node_errors).length)) {
      throw new ComfyError(`Workflow rechazado por el generador: ${JSON.stringify(queued.node_errors ?? queued.error ?? {}).slice(0, 300)}`, false);
    }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const hist = (await (await this.call(`/history/${queued.prompt_id}`)).json()) as Record<string, { status?: { completed?: boolean; status_str?: string; messages?: unknown[] }; outputs?: Record<string, { images?: Array<{ filename: string; subfolder: string; type: string }> }> }>;
      const entry = hist[queued.prompt_id];
      if (entry?.status?.status_str === 'error') throw new ComfyError('El generador de imágenes falló al procesar el workflow.', true);
      if (entry?.status?.completed) {
        const image = Object.values(entry.outputs ?? {}).flatMap((o) => o.images ?? []).find((i) => i.type === 'output') ?? Object.values(entry.outputs ?? {}).flatMap((o) => o.images ?? [])[0];
        if (!image) throw new ComfyError('El generador no devolvió ninguna imagen.', false);
        const q = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder, type: image.type });
        return Buffer.from(await (await this.call(`/view?${q}`, undefined, 60_000)).arrayBuffer());
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
    await this.cancel(queued.prompt_id);
    throw new ComfyError('La generación ha tardado demasiado.', true);
  }

  /**
   * Gives up on a prompt: interrupts it only if it is the one executing (`/interrupt` stops whatever
   * runs, possibly someone else's prompt), otherwise removes it from the queue so it does not run
   * later for nothing.
   */
  async cancel(promptId: string): Promise<void> {
    try {
      const q = (await (await this.call('/queue')).json()) as { queue_running?: unknown[][]; queue_pending?: unknown[][] };
      if (q.queue_running?.some((e) => e[1] === promptId)) await this.call('/interrupt', { method: 'POST' });
      else await this.call('/queue', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ delete: [promptId] }) });
    } catch {
      /* best effort */
    }
  }
}
