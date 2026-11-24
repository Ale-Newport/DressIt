import { ApiError, buildQueryString, createApiClient, NETWORK_ERROR_MESSAGE, toApiError } from '@/api/client';
import { createMemoryTokenStore, type StoredTokens } from '@/api/tokens';

const BASE = 'http://api.test';

function json(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function setup(initial: StoredTokens | null, handler: (url: string, init: RequestInit) => Promise<Response> | Response) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    return handler(url, init ?? {});
  }) as unknown as typeof fetch;
  const store = createMemoryTokenStore(initial);
  const client = createApiClient({ baseUrl: BASE, fetchImpl, tokenStore: store, timeoutMs: 200, now: () => 1_000_000 });
  return { client, calls, store };
}

async function failure(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    return e as ApiError;
  }
  throw new Error('expected the request to fail');
}

const fresh: StoredTokens = { accessToken: 'old-access', refreshToken: 'r1', expiresAt: 10_000_000 };

function authHeader(init: RequestInit): string | undefined {
  return (init.headers as Record<string, string> | undefined)?.Authorization;
}

describe('api client', () => {
  it('sends JSON with bearer token and parses the response', async () => {
    const { client, calls } = setup(fresh, () => json(200, { id: 'u1' }));
    await expect(client.get('/v1/me')).resolves.toEqual({ id: 'u1' });
    expect(calls[0]!.url).toBe(`${BASE}/v1/me`);
    expect(authHeader(calls[0]!.init)).toBe('Bearer old-access');
  });

  it('serialises query params, skipping empty values', () => {
    expect(buildQueryString({ q: 'abrigo negro', status: undefined, favorite: true, ids: ['a', 'b'], empty: '' })).toBe(
      '?q=abrigo%20negro&favorite=true&ids=a%2Cb',
    );
  });

  it('maps the ApiError envelope to ApiError with the Spanish message', async () => {
    const { client } = setup(fresh, () => json(422, { error: { code: 'validation_failed', message: 'La categoría es obligatoria.' } }));
    const err = await failure(client.post('/v1/garments', {}));
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(422);
    expect(err.code).toBe('validation_failed');
    expect(err.message).toBe('La categoría es obligatoria.');
  });

  it('falls back to a generic Spanish message when the body is not an ApiError', () => {
    const e = toApiError(503, '<html>');
    expect(e.code).toBe('http_503');
    expect(e.message).toMatch(/no está disponible/);
  });

  it('maps network failures to a network_error', async () => {
    const { client } = setup(fresh, () => {
      throw new TypeError('Network request failed');
    });
    const err = await failure(client.get('/v1/home'));
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('network_error');
    expect(err.message).toBe(NETWORK_ERROR_MESSAGE);
  });

  it('times out slow requests', async () => {
    const { client } = setup(
      fresh,
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        }),
    );
    const err = await failure(client.get('/v1/home'));
    expect(err.code).toBe('timeout');
  });

  it('returns undefined for 204', async () => {
    const { client } = setup(fresh, () => new Response(null, { status: 204 }));
    await expect(client.del('/v1/garments/1')).resolves.toBeUndefined();
  });

  it('refreshes on 401 and retries the request once', async () => {
    const { client, calls, store } = setup(fresh, (url, init) => {
      if (url.endsWith('/v1/auth/refresh')) return json(200, { accessToken: 'new-access', refreshToken: 'r2', expiresIn: 900 });
      return authHeader(init) === 'Bearer new-access' ? json(200, { ok: true }) : json(401, { error: { code: 'unauthorized', message: 'Token caducado' } });
    });
    await expect(client.get('/v1/home')).resolves.toEqual({ ok: true });
    expect(calls.map((c) => c.url.replace(BASE, ''))).toEqual(['/v1/home', '/v1/auth/refresh', '/v1/home']);
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({ refreshToken: 'r1' });
    expect(await store.get()).toMatchObject({ accessToken: 'new-access', refreshToken: 'r2' });
  });

  it('single-flights concurrent refreshes', async () => {
    let refreshCount = 0;
    const { client } = setup(fresh, async (url, init) => {
      if (url.endsWith('/v1/auth/refresh')) {
        refreshCount += 1;
        await new Promise((r) => setTimeout(r, 20));
        return json(200, { accessToken: 'new-access', refreshToken: 'r2', expiresIn: 900 });
      }
      return authHeader(init) === 'Bearer new-access' ? json(200, { url }) : json(401, { error: { code: 'unauthorized', message: 'x' } });
    });
    const results = await Promise.all([client.get('/v1/a'), client.get('/v1/b'), client.get('/v1/c')]);
    expect(results).toHaveLength(3);
    expect(refreshCount).toBe(1);
  });

  it('refreshes proactively when the access token is about to expire', async () => {
    const expiring: StoredTokens = { accessToken: 'old', refreshToken: 'r1', expiresAt: 1_000_000 + 5_000 };
    const { client, calls } = setup(expiring, (url) =>
      url.endsWith('/v1/auth/refresh') ? json(200, { accessToken: 'new-access', refreshToken: 'r2', expiresIn: 900 }) : json(200, {}),
    );
    await client.get('/v1/home');
    expect(calls[0]!.url).toBe(`${BASE}/v1/auth/refresh`);
    expect(authHeader(calls[1]!.init)).toBe('Bearer new-access');
  });

  it('ends the session when the refresh token is rejected', async () => {
    const { client, store } = setup(fresh, (url) =>
      url.endsWith('/v1/auth/refresh')
        ? json(401, { error: { code: 'invalid_refresh_token', message: 'Sesión caducada' } })
        : json(401, { error: { code: 'unauthorized', message: 'x' } }),
    );
    const events: string[] = [];
    client.onSessionChange((e) => events.push(e));
    const err = await failure(client.get('/v1/home'));
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
    expect(await store.get()).toBeNull();
    expect(events).toEqual(['expired']);
  });

  it('does not send a token for unauthenticated calls', async () => {
    const { client, calls } = setup(fresh, () => json(200, { user: {}, tokens: {} }));
    await client.post('/v1/auth/login', { email: 'a@b.es', password: 'x' }, { auth: false });
    expect(authHeader(calls[0]!.init)).toBeUndefined();
  });

  it('emits started on setSession', async () => {
    const { client, store } = setup(null, () => json(200, {}));
    const events: string[] = [];
    client.onSessionChange((e) => events.push(e));
    await client.setSession({ accessToken: 'a', refreshToken: 'r', expiresIn: 900 });
    expect(events).toEqual(['started']);
    expect((await store.get())?.expiresAt).toBe(1_000_000 + 900_000);
  });
});
