import type { PageCaptureRequest } from '@dressit/shared';

/** schema.org microdata itemprops we read (first element per name). */
export const MICRODATA_PROPS = ['name', 'brand', 'price', 'priceCurrency', 'availability', 'color', 'sku', 'gtin13', 'image', 'size'] as const;

/**
 * Plain-JS snippet (ES5) that fills `target` with microdata values. Shared by the
 * in-app browser capture script and the iOS Safari share-extension preprocessor.
 * For each itemprop: `content` attribute, else `src`/`href`, else trimmed text (≤ 300 chars).
 */
export const MICRODATA_SNIPPET = (target: string) => `
var dressitProps = ${JSON.stringify(MICRODATA_PROPS)};
for (var k = 0; k < dressitProps.length; k++) {
  var el = document.querySelector('[itemprop="' + dressitProps[k] + '"]');
  if (!el) continue;
  var v = el.getAttribute('content') || el.getAttribute('src') || el.getAttribute('href') || (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 300);
  if (v) ${target}[dressitProps[k]] = v;
}`;

/**
 * Script injected into the in-app browser ONLY when the user taps
 * "Capturar este producto". It reads what the page already exposes publicly
 * (JSON-LD, schema.org microdata, og:/product:/twitter: meta, title) and posts it
 * back to the app. It never clicks, scrolls, fills forms, or touches CAPTCHAs or
 * bot challenges: the user browses normally and decides when to capture.
 */
export const CAPTURE_SCRIPT = `
(function () {
  try {
    var blocks = [];
    var nodes = document.querySelectorAll('script[type="application/ld+json"]');
    for (var i = 0; i < nodes.length && blocks.length < 20; i++) {
      var t = nodes[i].textContent || '';
      if (t.length > 0 && t.length <= 200000) blocks.push(t);
    }
    var meta = {};
    var metas = document.querySelectorAll('meta[property], meta[name]');
    for (var j = 0; j < metas.length; j++) {
      var key = metas[j].getAttribute('property') || metas[j].getAttribute('name') || '';
      var content = metas[j].getAttribute('content');
      if (!content) continue;
      if (/^(og:|product:|twitter:)/i.test(key)) meta[key] = content.slice(0, 2000);
    }
    var microdata = {};
    ${MICRODATA_SNIPPET('microdata')}
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'dressit:capture',
      url: document.location.href,
      title: document.title || null,
      jsonLd: blocks,
      meta: meta,
      microdata: microdata
    }));
  } catch (e) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'dressit:capture-error', message: String(e) }));
  }
})();
true;
`;

export type CaptureMessage =
  | {
      type: 'dressit:capture';
      url: string;
      title: string | null;
      jsonLd: string[];
      meta: Record<string, string>;
      microdata?: Record<string, string>;
    }
  | { type: 'dressit:capture-error'; message: string };

export function parseCaptureMessage(data: string): CaptureMessage | null {
  try {
    const msg = JSON.parse(data) as CaptureMessage;
    if (msg && (msg.type === 'dressit:capture' || msg.type === 'dressit:capture-error')) return msg;
  } catch {
    // ignore unrelated messages
  }
  return null;
}

const MAX_BLOCK = 200_000;

function cleanStringMap(input: Record<string, unknown> | undefined, allow?: (key: string) => boolean, max = 2000): Record<string, string> {
  const out: Record<string, string> = {};
  if (!input) return out;
  for (const [k, v] of Object.entries(input)) {
    if (typeof v !== 'string' || !v) continue;
    if (allow && !allow(k)) continue;
    out[k] = v.slice(0, max);
  }
  return out;
}

const isMicrodataKey = (k: string) => (MICRODATA_PROPS as readonly string[]).includes(k);
const isMetaKey = (k: string) => /^(og:|product:|twitter:)/i.test(k);

export function toPageCaptureRequest(msg: Extract<CaptureMessage, { type: 'dressit:capture' }>, now = new Date()): PageCaptureRequest {
  const microdata = cleanStringMap(msg.microdata, isMicrodataKey, 300);
  return {
    url: msg.url,
    jsonLd: msg.jsonLd.filter((b) => typeof b === 'string' && b.length <= MAX_BLOCK).slice(0, 20),
    meta: cleanStringMap(msg.meta, isMetaKey),
    ...(Object.keys(microdata).length ? { microdata } : {}),
    title: msg.title,
    capturedAt: now.toISOString(),
  };
}

/**
 * Builds a capture request from an iOS Safari share (expo-share-intent preprocessor
 * meta: our injected `dressit:jsonld`, `dressit:microdata` and `dressit:url` keys plus
 * the page's <meta> tags). Returns null when the page exposed nothing structured, so
 * the caller falls back to `POST /v1/imports/link`.
 */
export function captureFromShareMeta(url: string, meta: Record<string, unknown> | null | undefined, now = new Date()): PageCaptureRequest | null {
  if (!meta) return null;
  let jsonLd: string[] = [];
  const rawLd = meta['dressit:jsonld'];
  if (typeof rawLd === 'string') {
    try {
      const parsed = JSON.parse(rawLd);
      if (Array.isArray(parsed)) jsonLd = parsed.filter((x): x is string => typeof x === 'string' && x.length <= MAX_BLOCK).slice(0, 20);
    } catch {
      jsonLd = [];
    }
  }
  let microdata: Record<string, string> = {};
  const rawMicro = meta['dressit:microdata'];
  if (typeof rawMicro === 'string') {
    try {
      microdata = cleanStringMap(JSON.parse(rawMicro) as Record<string, unknown>, isMicrodataKey, 300);
    } catch {
      microdata = {};
    }
  }
  const metaPairs = cleanStringMap(meta as Record<string, unknown>, isMetaKey);
  if (jsonLd.length === 0 && Object.keys(metaPairs).length === 0 && Object.keys(microdata).length === 0) return null;
  const pageUrl = typeof meta['dressit:url'] === 'string' ? (meta['dressit:url'] as string) : url;
  return {
    url: pageUrl,
    jsonLd,
    meta: metaPairs,
    ...(Object.keys(microdata).length ? { microdata } : {}),
    title: typeof meta.title === 'string' ? meta.title : null,
    capturedAt: now.toISOString(),
  };
}
