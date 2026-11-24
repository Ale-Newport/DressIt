import type { ApiError as ApiErrorBody, AuthTokens } from '@dressit/shared';

import { API_TIMEOUT_MS, resolveApiBaseUrl } from './config';
import { createSecureTokenStore, type StoredTokens, type TokenStore, toStoredTokens } from './tokens';

/**
 * Typed fetch wrapper for the DressIt API.
 *
 * - JSON in/out, `ApiError` envelope mapped to {@link ApiError} (message is Spanish and safe to show).
 * - Timeouts via AbortController.
 * - Bearer auth; on 401 the access token is refreshed (single-flight: concurrent
 *   401s share one `/v1/auth/refresh` call) and the request is retried once.
 * - Proactive refresh when the access token is about to expire.
 */

export type QueryValue = string | number | boolean | null | undefined | ReadonlyArray<string | number>;
export type Query = Record<string, QueryValue>;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: Query | object;
  body?: unknown;
  /** Send the bearer token (default true). */
  auth?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
  get isNetwork() {
    return this.code === 'network_error';
  }
  get isTimeout() {
    return this.code === 'timeout';
  }
  get isUnauthorized() {
    return this.status === 401;
  }
}

export const NETWORK_ERROR_MESSAGE = 'No hemos podido conectar con DressIt. Comprueba tu conexión e inténtalo de nuevo.';
export const TIMEOUT_MESSAGE = 'El servidor está tardando demasiado en responder. Inténtalo de nuevo en unos segundos.';
export const SESSION_EXPIRED_MESSAGE = 'Tu sesión ha caducado. Vuelve a iniciar sesión.';

const STATUS_MESSAGES: Record<number, string> = {
  400: 'La solicitud no es válida.',
  401: SESSION_EXPIRED_MESSAGE,
  403: 'No tienes permiso para hacer esto.',
  404: 'No hemos encontrado lo que buscabas.',
  409: 'Hay un conflicto con el estado actual. Actualiza e inténtalo de nuevo.',
  413: 'El archivo es demasiado grande.',
  415: 'Formato de archivo no admitido.',
  422: 'Revisa los datos: hay algún campo no válido.',
  429: 'Demasiadas solicitudes seguidas. Espera un momento.',
  503: 'El servicio no está disponible ahora mismo. Inténtalo más tarde.',
};

export function messageForStatus(status: number): string {
  return STATUS_MESSAGES[status] ?? (status >= 500 ? 'Algo ha fallado en el servidor. Inténtalo de nuevo.' : 'Ha ocurrido un error inesperado.');
}

function isApiErrorBody(v: unknown): v is ApiErrorBody {
  if (!v || typeof v !== 'object') return false;
  const e = (v as { error?: unknown }).error;
  return !!e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string';
}

/** Build an {@link ApiError} from a non-2xx response body (already parsed or raw text). */
export function toApiError(status: number, body: unknown): ApiError {
  if (isApiErrorBody(body)) {
    const { code, message, details } = body.error;
    return new ApiError(status, code || `http_${status}`, message || messageForStatus(status), details);
  }
  return new ApiError(status, `http_${status}`, messageForStatus(status));
}

/** Normalise anything thrown to an ApiError (for UI). */
export function asApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (err instanceof Error && err.name === 'AbortError') return new ApiError(0, 'timeout', TIMEOUT_MESSAGE);
  return new ApiError(0, 'network_error', NETWORK_ERROR_MESSAGE);
}

export function errorMessage(err: unknown): string {
  return asApiError(err).message;
}

export function buildQueryString(query?: Query | object): string {
  if (!query) return '';
  const parts: string[] = [];
  for (const [key, raw] of Object.entries(query as Query)) {
    if (raw === undefined || raw === null || raw === '') continue;
    const value = Array.isArray(raw) ? raw.join(',') : String(raw);
    if (value === '') continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

export interface ApiClientOptions {
  baseUrl?: string | (() => string);
  fetchImpl?: typeof fetch;
  tokenStore?: TokenStore;
  timeoutMs?: number;
  /** Refresh proactively when the token expires within this window. */
  refreshSkewMs?: number;
  now?: () => number;
}

export type SessionEvent = 'started' | 'expired' | 'logout';
type SessionListener = (event: SessionEvent) => void;

export interface ApiClient {
  readonly baseUrl: () => string;
  request<T>(path: string, options?: RequestOptions): Promise<T>;
  get<T>(path: string, query?: Query | object, options?: Omit<RequestOptions, 'method' | 'query'>): Promise<T>;
  post<T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T>;
  put<T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T>;
  patch<T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T>;
  del<T = void>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T>;
  /** Returns a valid access token (refreshing if needed) or null when signed out. */
  getAccessToken(): Promise<string | null>;
  /** Forces a refresh (single-flight). Resolves to the new access token or null. */
  refresh(): Promise<string | null>;
  setSession(tokens: AuthTokens): Promise<void>;
  clearSession(reason?: 'expired' | 'logout'): Promise<void>;
  getStoredTokens(): Promise<StoredTokens | null>;
  /** Fires on login/register ('started'), refresh failure ('expired') and logout. */
  onSessionChange(listener: SessionListener): () => void;
}

export function createApiClient(opts: ApiClientOptions = {}): ApiClient {
  const fetchImpl = opts.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const store = opts.tokenStore ?? createSecureTokenStore();
  const timeoutMs = opts.timeoutMs ?? API_TIMEOUT_MS;
  const skew = opts.refreshSkewMs ?? 30_000;
  const now = opts.now ?? Date.now;
  const listeners = new Set<SessionListener>();
  let resolvedBase: string | null = null;
  const baseUrl = () => {
    if (typeof opts.baseUrl === 'function') return opts.baseUrl();
    if (typeof opts.baseUrl === 'string') return opts.baseUrl;
    resolvedBase ??= resolveApiBaseUrl();
    return resolvedBase;
  };

  let refreshInFlight: Promise<string | null> | null = null;

  async function clearSession(reason: 'expired' | 'logout' = 'logout') {
    await store.set(null);
    for (const l of listeners) l(reason);
  }

  async function rawFetch(url: string, init: RequestInit, ms: number, external?: AbortSignal): Promise<Response> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, ms);
    const onExternalAbort = () => controller.abort();
    external?.addEventListener('abort', onExternalAbort);
    try {
      return await fetchImpl(url, { ...init, signal: controller.signal });
    } catch (err) {
      if (timedOut) throw new ApiError(0, 'timeout', TIMEOUT_MESSAGE);
      if (external?.aborted) throw err; // propagate cancellation (react-query ignores it)
      throw new ApiError(0, 'network_error', NETWORK_ERROR_MESSAGE, err instanceof Error ? err.message : undefined);
    } finally {
      clearTimeout(timer);
      external?.removeEventListener('abort', onExternalAbort);
    }
  }

  function refresh(): Promise<string | null> {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
      const current = await store.get();
      if (!current?.refreshToken) return null;
      let res: Response;
      try {
        res = await rawFetch(
          `${baseUrl()}/v1/auth/refresh`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ refreshToken: current.refreshToken }),
          },
          timeoutMs,
        );
      } catch (err) {
        // Network problem: keep the session (offline reads keep working), surface the error.
        throw err;
      }
      if (!res.ok) {
        if (res.status === 400 || res.status === 401 || res.status === 403) {
          await clearSession('expired');
          return null;
        }
        throw toApiError(res.status, await safeJson(res));
      }
      const tokens = (await res.json()) as AuthTokens;
      await store.set(toStoredTokens(tokens, now()));
      return tokens.accessToken;
    })().finally(() => {
      refreshInFlight = null;
    });
    return refreshInFlight;
  }

  async function getAccessToken(): Promise<string | null> {
    if (refreshInFlight) return refreshInFlight;
    const t = await store.get();
    if (!t) return null;
    if (t.expiresAt - skew <= now()) {
      try {
        return await refresh();
      } catch {
        // Fall back to the (maybe expired) token; the server decides.
        return t.accessToken;
      }
    }
    return t.accessToken;
  }

  async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', query, body, auth = true, signal, headers } = options;
    const url = `${baseUrl()}${path}${buildQueryString(query)}`;
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData;

    const send = async (token: string | null) => {
      const h: Record<string, string> = { Accept: 'application/json', 'Accept-Language': 'es-ES', ...headers };
      if (body !== undefined && !isForm) h['Content-Type'] = 'application/json';
      if (token) h.Authorization = `Bearer ${token}`;
      return rawFetch(
        url,
        { method, headers: h, body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body) },
        options.timeoutMs ?? timeoutMs,
        signal,
      );
    };

    let token = auth ? await getAccessToken() : null;
    let res = await send(token);

    if (res.status === 401 && auth && token) {
      token = await refresh();
      if (!token) throw new ApiError(401, 'session_expired', SESSION_EXPIRED_MESSAGE);
      res = await send(token);
      if (res.status === 401) {
        await clearSession('expired');
        throw toApiError(401, await safeJson(res));
      }
    }

    if (!res.ok) throw toApiError(res.status, await safeJson(res));
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ApiError(res.status, 'invalid_response', 'La respuesta del servidor no es válida.');
    }
  }

  return {
    baseUrl,
    request,
    get: (path, query, o) => request(path, { ...o, method: 'GET', query }),
    post: (path, body, o) => request(path, { ...o, method: 'POST', body }),
    put: (path, body, o) => request(path, { ...o, method: 'PUT', body }),
    patch: (path, body, o) => request(path, { ...o, method: 'PATCH', body }),
    del: (path, body, o) => request(path, { ...o, method: 'DELETE', body }),
    getAccessToken,
    refresh,
    async setSession(tokens) {
      await store.set(toStoredTokens(tokens, now()));
      for (const l of listeners) l('started');
    },
    clearSession,
    getStoredTokens: () => store.get(),
    onSessionChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

/** App-wide client instance. */
export const api = createApiClient();
