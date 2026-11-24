/**
 * URL helpers. Implemented with regexes on purpose: React Native's `URL`
 * polyfill historically does not implement `hostname`/`pathname`.
 */

const URL_RE = /^(https?):\/\/([^/?#\s:]+)(?::\d+)?([^?#\s]*)?(\?[^#\s]*)?(#\S*)?$/i;

export interface ParsedUrl {
  protocol: 'http' | 'https';
  host: string;
  path: string;
}

export function parseUrl(raw: string): ParsedUrl | null {
  const m = URL_RE.exec(raw.trim());
  if (!m) return null;
  return { protocol: m[1]!.toLowerCase() as 'http' | 'https', host: m[2]!.toLowerCase(), path: m[3] || '/' };
}

/** Extracts the first http(s) URL from free text (shared text often wraps the link). */
export function extractUrl(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = /https?:\/\/[^\s<>"'”“]+/i.exec(text);
  if (!m) return null;
  return m[0].replace(/[),.;!?]+$/, '');
}

export function isHttpUrl(s: string): boolean {
  return parseUrl(s) !== null;
}

/**
 * Heuristic: does this URL look like a product page from an online store?
 * Used only to decide whether to *offer* pasting it (the clipboard is read only
 * after the user agrees).
 */
const PRODUCT_PATH_HINTS = [/\/p\//i, /\/product/i, /\/producto/i, /\/item/i, /-p\d{5,}/i, /\/dp\//i, /\.html?$/i, /\/articulo/i, /\/prod/i];
const STORE_HOST_HINTS = [/shop/i, /store/i, /tienda/i, /moda/i, /fashion/i];

export function looksLikeStoreUrl(raw: string, knownDomains: string[] = []): boolean {
  const u = parseUrl(raw);
  if (!u) return false;
  const host = u.host.replace(/^www\./, '');
  if (knownDomains.some((d) => host === d.toLowerCase() || host.endsWith(`.${d.toLowerCase()}`))) return true;
  return PRODUCT_PATH_HINTS.some((r) => r.test(u.path)) || STORE_HOST_HINTS.some((r) => r.test(host));
}

export function hostnameOf(raw: string): string {
  return parseUrl(raw)?.host.replace(/^www\./, '') ?? raw;
}
