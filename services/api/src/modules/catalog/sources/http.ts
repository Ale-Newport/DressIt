/**
 * Polite HTTP client for official catalog APIs: enforces the documented rate limit of each
 * network (minimum interval between calls), honours `429 Too Many Requests` + `Retry-After`,
 * retries transient 5xx with backoff and NEVER puts secrets in error messages.
 *
 * Everything time- or network-related is injectable so tests run with mocked HTTP and a fake clock.
 */

export interface HttpDeps {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

export const defaultHttpDeps: HttpDeps = {
  fetch: (input, init) => fetch(input, init),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => Date.now(),
};

export class SourceHttpError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null) {
    super(message);
    this.status = status;
  }
}

/** Removes credentials from a URL before it is logged or stored (query tokens, Awin /apikey/ paths). */
export function redactUrl(url: string): string {
  return url
    .replace(/\/apikey\/[^/?#]+/gi, '/apikey/***')
    .replace(/([?&;](?:token|access_token|apikey|api_key|key)=)[^&;#]+/gi, '$1***')
    .replace(/(productdata-darwin-download\/publisher\/[^/]+\/)[^/]+/i, '$1***');
}

/** Parses Retry-After (delta-seconds or HTTP-date). Returns milliseconds or null. */
export function parseRetryAfter(value: string | null, now: number): number | null {
  if (!value) return null;
  const secs = Number(value.trim());
  if (Number.isFinite(secs) && secs >= 0) return Math.round(secs * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

export interface RateLimitedClientOptions {
  /** Human label used in error messages (never includes secrets). */
  label: string;
  /** Minimum milliseconds between two requests (derived from the network's documented limit). */
  minIntervalMs: number;
  maxRetries?: number;
  timeoutMs?: number;
  /** Give up instead of sleeping longer than this when the server asks us to wait. */
  maxWaitMs?: number;
}

export class RateLimitedClient {
  private last = Number.NEGATIVE_INFINITY;
  private readonly deps: HttpDeps;
  private readonly opts: Required<RateLimitedClientOptions>;
  requests = 0;

  constructor(deps: HttpDeps, opts: RateLimitedClientOptions) {
    this.deps = deps;
    this.opts = { maxRetries: 3, timeoutMs: 120_000, maxWaitMs: 15 * 60_000, ...opts };
  }

  private async throttle(): Promise<void> {
    const wait = this.last + this.opts.minIntervalMs - this.deps.now();
    if (wait > 0) await this.deps.sleep(wait);
    this.last = this.deps.now();
  }

  /** Performs the request; resolves only with a 2xx response. */
  async request(url: string, init: RequestInit = {}): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      await this.throttle();
      this.requests++;
      let res: Response;
      try {
        res = await this.deps.fetch(url, { ...init, signal: AbortSignal.timeout(this.opts.timeoutMs) });
      } catch (err) {
        if (attempt < this.opts.maxRetries) {
          await this.deps.sleep(1000 * 2 ** attempt);
          continue;
        }
        throw new SourceHttpError(`${this.opts.label}: error de red (${(err as Error).name}) en ${redactUrl(url)}`, null);
      }
      if (res.ok) return res;
      const retryable = res.status === 429 || res.status === 503 || res.status === 502 || res.status === 504 || res.status === 500;
      if (retryable && attempt < this.opts.maxRetries) {
        const asked = parseRetryAfter(res.headers.get('retry-after'), this.deps.now());
        const wait = asked ?? (res.status === 429 ? 60_000 : 1000 * 2 ** attempt);
        if (wait > this.opts.maxWaitMs) throw new SourceHttpError(`${this.opts.label}: límite de peticiones alcanzado; el servidor pide esperar ${Math.round(wait / 1000)} s`, res.status);
        await res.body?.cancel().catch(() => undefined);
        await this.deps.sleep(wait);
        continue;
      }
      const body = (await res.text().catch(() => '')).slice(0, 300).replace(/\s+/g, ' ');
      throw new SourceHttpError(`${this.opts.label}: HTTP ${res.status} en ${redactUrl(url)}${body ? ` — ${body}` : ''}`, res.status);
    }
  }
}
