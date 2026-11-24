/**
 * SSRF-safe HTTP fetching for user-supplied URLs (product link import).
 *
 * Defences:
 *  - only http(s) on default ports, no credentials in URLs;
 *  - hostnames like localhost/*.local/*.internal and IP literals in private ranges are rejected;
 *  - DNS is resolved by us and EVERY resolved address must be public unicast; the socket
 *    connects through a custom `lookup`, so the checked IP is the one used (no DNS rebinding);
 *  - redirects are followed manually (max 4) and each hop is re-validated;
 *  - response size cap, total timeout, content-type allow-list, no cookies sent or stored;
 *  - robots.txt is honoured for our user-agent (cached per host).
 */
import { lookup as dnsLookup } from 'node:dns';
import type { LookupAddress } from 'node:dns';
import ipaddr from 'ipaddr.js';
import { Agent, request } from 'undici';

export type FetchBlockReason = 'invalid_url' | 'private_address' | 'robots_disallowed' | 'too_many_redirects' | 'too_large' | 'bad_content_type' | 'http_status' | 'timeout' | 'network';

export class FetchBlockedError extends Error {
  readonly reason: FetchBlockReason;
  readonly status: number | undefined;
  constructor(reason: FetchBlockReason, message: string, status?: number) {
    super(message);
    this.reason = reason;
    this.status = status;
  }
}

export interface SafeFetchOptions {
  userAgent: string;
  timeoutMs: number;
  maxBytes: number;
  allowPrivate?: boolean;
  respectRobots?: boolean;
  accept?: string;
  allowedContentTypes?: RegExp;
}

export interface SafeFetchResult {
  finalUrl: string;
  status: number;
  contentType: string;
  body: string;
  /** Raw bytes (for binary content such as images). */
  raw: Buffer;
  redirects: string[];
}

const BLOCKED_HOST = /(^localhost$)|(\.localhost$)|(\.local$)|(\.internal$)|(\.lan$)|(\.home$)|(^metadata\.google\.internal$)/i;

export function isPublicAddress(ip: string): boolean {
  if (!ipaddr.isValid(ip)) return false;
  let addr = ipaddr.parse(ip);
  if (addr.kind() === 'ipv6' && (addr as ipaddr.IPv6).isIPv4MappedAddress()) addr = (addr as ipaddr.IPv6).toIPv4Address();
  if (addr.range() !== 'unicast') return false;
  // IPv6: only global unicast (2000::/3); rejects NAT64/6to4/teredo-style tunnels to private space.
  if (addr.kind() === 'ipv6') return (addr as ipaddr.IPv6).match(ipaddr.IPv6.parse('2000::'), 3);
  return true;
}

export function validateUrl(raw: string, allowPrivate = false): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new FetchBlockedError('invalid_url', 'El enlace no es una URL válida.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new FetchBlockedError('invalid_url', 'Solo se admiten enlaces http(s).');
  if (url.username || url.password) throw new FetchBlockedError('invalid_url', 'El enlace no puede contener credenciales.');
  if (!allowPrivate) {
    if (url.port && url.port !== '80' && url.port !== '443') throw new FetchBlockedError('invalid_url', 'Puerto no permitido.');
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (BLOCKED_HOST.test(host)) throw new FetchBlockedError('private_address', 'Dirección no permitida.');
    if (ipaddr.isValid(host) && !isPublicAddress(host)) throw new FetchBlockedError('private_address', 'Dirección no permitida.');
  }
  url.hash = '';
  return url;
}

function makeAgent(allowPrivate: boolean): Agent {
  return new Agent({
    connect: {
      lookup(hostname: string, options: object, cb: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void) {
        dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
          if (err) return cb(err, []);
          const list = addresses as LookupAddress[];
          if (!allowPrivate && (list.length === 0 || list.some((a) => !isPublicAddress(a.address)))) {
            const e = new Error(`Dirección privada bloqueada para ${hostname}`) as NodeJS.ErrnoException;
            e.code = 'EPRIVATE';
            return cb(e, []);
          }
          const wantsAll = (options as { all?: boolean }).all;
          if (wantsAll) return cb(null, list);
          const first = list[0]!;
          return cb(null, first.address, first.family);
        });
      },
    },
    headersTimeout: 10_000,
    bodyTimeout: 10_000,
    maxRedirections: 0,
  } as ConstructorParameters<typeof Agent>[0]);
}

const agents = new Map<boolean, Agent>();
const agentFor = (allowPrivate: boolean) => {
  let a = agents.get(allowPrivate);
  if (!a) {
    a = makeAgent(allowPrivate);
    agents.set(allowPrivate, a);
  }
  return a;
};

async function readLimited(body: AsyncIterable<Buffer | Uint8Array>, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of body) {
    size += chunk.length;
    if (size > maxBytes) throw new FetchBlockedError('too_large', 'La página es demasiado grande.');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function decode(buf: Buffer, contentType: string): string {
  const m = /charset=([^;]+)/i.exec(contentType);
  const charset = (m?.[1] ?? 'utf-8').trim().toLowerCase();
  try {
    return new TextDecoder(charset).decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}

// ---------------------------------------------------------------------------
// robots.txt
// ---------------------------------------------------------------------------

interface RobotsRules {
  rules: Array<{ allow: boolean; path: string }>;
}
const robotsCache = new Map<string, { at: number; rules: RobotsRules | null }>();

export function parseRobots(txt: string, agentToken: string): RobotsRules {
  const groups: Array<{ agents: string[]; rules: Array<{ allow: boolean; path: string }> }> = [];
  let current: { agents: string[]; rules: Array<{ allow: boolean; path: string }> } | null = null;
  let lastWasAgent = false;
  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((key === 'allow' || key === 'disallow') && current) {
      lastWasAgent = false;
      if (key === 'disallow' && value === '') continue;
      current.rules.push({ allow: key === 'allow', path: value });
    } else {
      lastWasAgent = false;
    }
  }
  const token = agentToken.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && token.includes(a)));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes('*'));
  return { rules: chosen.flatMap((g) => g.rules) };
}

function patternToRegex(path: string): RegExp {
  const anchored = path.endsWith('$');
  const body = (anchored ? path.slice(0, -1) : path).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

export function robotsAllows(rules: RobotsRules, pathWithQuery: string): boolean {
  let best: { allow: boolean; len: number } | null = null;
  for (const r of rules.rules) {
    if (patternToRegex(r.path).test(pathWithQuery)) {
      const len = r.path.length;
      if (!best || len > best.len || (len === best.len && r.allow)) best = { allow: r.allow, len };
    }
  }
  return best ? best.allow : true;
}

async function robotsFor(url: URL, opts: SafeFetchOptions): Promise<RobotsRules | null> {
  const key = url.origin;
  const cached = robotsCache.get(key);
  if (cached && Date.now() - cached.at < 12 * 3600_000) return cached.rules;
  let rules: RobotsRules | null = null;
  try {
    const res = await request(`${url.origin}/robots.txt`, {
      method: 'GET',
      dispatcher: agentFor(!!opts.allowPrivate),
      headers: { 'user-agent': opts.userAgent, accept: 'text/plain' },
      signal: AbortSignal.timeout(Math.min(opts.timeoutMs, 5000)),
    });
    if (res.statusCode === 200) {
      const buf = await readLimited(res.body, 500_000);
      rules = parseRobots(buf.toString('utf8'), opts.userAgent.split('/')[0] ?? opts.userAgent);
    } else {
      await res.body.dump();
    }
  } catch {
    rules = null; // unreachable robots.txt → treat as no restrictions (RFC 9309 §2.3.1.3 for 4xx)
  }
  robotsCache.set(key, { at: Date.now(), rules });
  return rules;
}

// ---------------------------------------------------------------------------

export async function safeFetch(rawUrl: string, opts: SafeFetchOptions): Promise<SafeFetchResult> {
  const allowPrivate = !!opts.allowPrivate;
  let url = validateUrl(rawUrl, allowPrivate);
  const redirects: string[] = [];
  const deadline = AbortSignal.timeout(opts.timeoutMs);
  for (let hop = 0; hop <= 4; hop++) {
    if (opts.respectRobots !== false) {
      const rules = await robotsFor(url, opts);
      if (rules && !robotsAllows(rules, url.pathname + url.search)) {
        throw new FetchBlockedError('robots_disallowed', 'La tienda no permite la lectura automática de esta página (robots.txt).');
      }
    }
    let res;
    try {
      res = await request(url, {
        method: 'GET',
        dispatcher: agentFor(allowPrivate),
        headers: {
          'user-agent': opts.userAgent,
          accept: opts.accept ?? 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
          'accept-language': 'es-ES,es;q=0.9',
        },
        signal: deadline,
      });
    } catch (e) {
      const err = e as NodeJS.ErrnoException & { cause?: NodeJS.ErrnoException };
      if (err.code === 'EPRIVATE' || err.cause?.code === 'EPRIVATE' || /privada/.test(err.message)) {
        throw new FetchBlockedError('private_address', 'Dirección no permitida.');
      }
      if (err.name === 'TimeoutError' || err.name === 'AbortError') throw new FetchBlockedError('timeout', 'La tienda tardó demasiado en responder.');
      throw new FetchBlockedError('network', 'No se pudo conectar con la tienda.');
    }
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      await res.body.dump();
      const next = new URL(String(res.headers.location), url);
      url = validateUrl(next.toString(), allowPrivate);
      redirects.push(url.toString());
      continue;
    }
    const contentType = String(res.headers['content-type'] ?? '');
    if (res.statusCode >= 400) {
      await res.body.dump();
      throw new FetchBlockedError('http_status', `La tienda respondió con el estado ${res.statusCode}.`, res.statusCode);
    }
    const allowed = opts.allowedContentTypes ?? /text\/html|application\/xhtml\+xml|application\/(ld\+)?json/i;
    if (!allowed.test(contentType)) {
      await res.body.dump();
      throw new FetchBlockedError('bad_content_type', 'El enlace no apunta a una página web.');
    }
    const buf = await readLimited(res.body, opts.maxBytes);
    const isText = /^text\/|json|xml|html/i.test(contentType);
    return { finalUrl: url.toString(), status: res.statusCode, contentType, body: isText ? decode(buf, contentType) : '', raw: buf, redirects };
  }
  throw new FetchBlockedError('too_many_redirects', 'Demasiadas redirecciones.');
}
