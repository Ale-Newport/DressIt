/**
 * Measures, for real, whether user-initiated link import works for each retailer:
 * fetches one public product page per store with our honest user-agent (respecting
 * robots.txt, no anti-bot evasion), extracts structured data and records the result in
 * retailer_integrations.last_check_* + docs/evidence/retailers-<date>.md.
 *
 * Usage: pnpm --filter @dressit/api retailers:check
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from '../src/config.ts';
import { createDb } from '../src/db/index.ts';
import { FetchBlockedError, safeFetch } from '../src/lib/safe-fetch.ts';
import { extractFromHtml } from '../src/modules/retail/extract.ts';
import { RETAILERS, TEST_URLS } from '../src/modules/retail/registry.ts';
import { syncRetailers } from '../src/modules/retail/sync.ts';

const cfg = loadConfig();
const { db } = createDb(process.env.DATABASE_ADMIN_URL ?? cfg.DATABASE_URL, 2);
await syncRetailers(db);
const date = new Date().toISOString().slice(0, 10);
const rows: string[] = [];

for (const r of RETAILERS) {
  const url = TEST_URLS[r.id];
  if (!url) continue;
  const started = Date.now();
  let outcome: 'operational' | 'link_only';
  let detail: string;
  try {
    const res = await safeFetch(url, { userAgent: cfg.LINK_IMPORT_USER_AGENT, timeoutMs: 15_000, maxBytes: cfg.LINK_IMPORT_MAX_BYTES, respectRobots: true });
    const p = extractFromHtml(res.body, res.finalUrl);
    const fields = [p.title && 'título', p.price && `precio ${(p.price.value.cents / 100).toFixed(2)} ${p.price.value.currency}`, p.brand && `marca ${p.brand.value}`, p.availability && `disponibilidad ${p.availability.value}`, p.images?.value.length && `${p.images.value.length} imágenes`, p.variants.length && `${p.variants.length} variantes`].filter(Boolean);
    if (p.looksBlocked) {
      outcome = 'link_only';
      detail = `HTTP ${res.status} pero la página es un muro anti-bot`;
    } else if (p.title && p.price) {
      outcome = 'operational';
      detail = `HTTP ${res.status}; datos estructurados (${p.title.source}): ${fields.join(', ')}`;
    } else {
      outcome = 'link_only';
      detail = `HTTP ${res.status}; datos incompletos: ${fields.join(', ') || 'ninguno'}`;
    }
  } catch (e) {
    outcome = 'link_only';
    detail = e instanceof FetchBlockedError ? `${e.reason}${e.status ? ` ${e.status}` : ''}: ${e.message}` : (e as Error).message;
  }
  const ms = Date.now() - started;
  await db
    .updateTable('retailer_integrations')
    .set({ status: outcome, last_checked_at: new Date(), last_check_result: `${outcome === 'operational' ? 'OK' : 'No disponible desde servidor'} — ${detail}` })
    .where('retailer_id', '=', r.id)
    .where('kind', '=', 'link_import')
    .execute();
  const line = `| ${r.name} | ${outcome === 'operational' ? '✅ operativa' : '⛔ solo captura en dispositivo'} | ${detail.replace(/\|/g, '/')} | ${ms} ms | ${url} |`;
  rows.push(line);
  console.log(line);
}

const md = `# Evidencia: importación de enlaces por servidor (${date})

Generado por \`pnpm --filter @dressit/api retailers:check\` (services/api/scripts/check-retailers.ts).
Una petición por tienda a una página pública de producto (mercado español), con el user-agent
\`${cfg.LINK_IMPORT_USER_AGENT}\`, respetando robots.txt y **sin** técnicas de evasión anti-bot.
Cuando la tienda bloquea la lectura desde servidor, la vía operativa es la captura en el
dispositivo del usuario (navegador integrado / compartir desde Safari).

| Tienda | Resultado | Detalle | Tiempo | URL de prueba |
|---|---|---|---|---|
${rows.join('\n')}
`;
const dir = resolve(import.meta.dirname, '../../../docs/evidence');
mkdirSync(dir, { recursive: true });
writeFileSync(resolve(dir, `retailers-${date}.md`), md);
console.log(`\nEvidencia escrita en docs/evidence/retailers-${date}.md`);
await db.destroy();
