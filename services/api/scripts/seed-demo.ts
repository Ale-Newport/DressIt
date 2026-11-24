/**
 * Creates a DEMO account with a sample wardrobe so the app can be explored without
 * photographing clothes. Everything created here is flagged is_demo = true and shown
 * in the app with a "DEMO" badge. Garments have no photos (the app renders colour
 * swatches). Never run against production.
 *
 *   pnpm db:seed:demo   → prints the demo credentials
 */
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from '../src/config.ts';
import { buildApp } from '../src/app.ts';
import { InlineJobQueue } from '../src/jobs/queue.ts';
import { withUser } from '../src/db/index.ts';
import { register } from '../src/modules/auth/service.ts';
import { createGarment } from '../src/modules/wardrobe/service.ts';
import { updatePreferences } from '../src/modules/profile/service.ts';

const cfg = loadConfig();
if (cfg.NODE_ENV === 'production') throw new Error('No se permiten datos de demostración en producción.');
const { ctx, close } = await buildApp({ cfg, queue: new InlineJobQueue() });
const email = `demo+${Date.now()}@dressit.local`;
const password = `demo-${randomBytes(6).toString('hex')}`;
const { user } = await register(ctx, { email, password, displayName: 'Cuenta Demo' });

const garments: Array<Parameters<typeof createGarment>[2]> = [
  { name: 'Camiseta blanca (demo)', subcategory: 'camiseta', colors: [{ hex: '#f5f5f5' }], materials: ['algodon'], fit: 'regular' },
  { name: 'Camiseta negra (demo)', subcategory: 'camiseta', colors: [{ hex: '#151515' }], materials: ['algodon'] },
  { name: 'Camisa Oxford celeste (demo)', subcategory: 'camisa', colors: [{ hex: '#a9c6e8' }], materials: ['algodon'] },
  { name: 'Camisa de lino crudo (demo)', subcategory: 'camisa', colors: [{ hex: '#ece3d0' }], materials: ['lino'] },
  { name: 'Jersey azul marino (demo)', subcategory: 'jersey', colors: [{ hex: '#1f2a44' }], materials: ['lana'] },
  { name: 'Jersey gris de ochos (demo)', subcategory: 'jersey_grueso', colors: [{ hex: '#8c8c8c' }], materials: ['lana'], fit: 'holgado' },
  { name: 'Sudadera verde oliva (demo)', subcategory: 'sudadera', colors: [{ hex: '#6b6b30' }], fit: 'oversize' },
  { name: 'Vaquero azul (demo)', subcategory: 'vaquero', colors: [{ hex: '#4b6584' }], materials: ['denim'], fit: 'regular' },
  { name: 'Vaquero negro (demo)', subcategory: 'vaquero', colors: [{ hex: '#202020' }], materials: ['denim'], fit: 'ajustado' },
  { name: 'Chino beige (demo)', subcategory: 'chino', colors: [{ hex: '#d6c2a3' }] },
  { name: 'Pantalón de vestir gris (demo)', subcategory: 'pantalon_vestir', colors: [{ hex: '#5a5a5a' }], materials: ['lana'] },
  { name: 'Falda midi negra (demo)', subcategory: 'falda_larga', colors: [{ hex: '#1a1a1a' }] },
  { name: 'Vestido de punto camel (demo)', subcategory: 'vestido_punto', colors: [{ hex: '#c09a6b' }], materials: ['punto'] },
  { name: 'Americana azul marino (demo)', subcategory: 'americana', colors: [{ hex: '#22304f' }], materials: ['lana'] },
  { name: 'Gabardina beige (demo)', subcategory: 'gabardina', colors: [{ hex: '#c9b48e' }] },
  { name: 'Abrigo negro (demo)', subcategory: 'abrigo', colors: [{ hex: '#1d1d1d' }], materials: ['lana'] },
  { name: 'Cazadora vaquera (demo)', subcategory: 'cazadora_vaquera', colors: [{ hex: '#5a7898' }], materials: ['denim'] },
  { name: 'Zapatillas blancas (demo)', subcategory: 'zapatillas', colors: [{ hex: '#f3f3f3' }], materials: ['cuero'] },
  { name: 'Botines marrones (demo)', subcategory: 'botines', colors: [{ hex: '#6b4528' }], materials: ['ante'] },
  { name: 'Botas negras (demo)', subcategory: 'botas', colors: [{ hex: '#141414' }], materials: ['cuero'] },
  { name: 'Mocasines negros (demo)', subcategory: 'mocasines', colors: [{ hex: '#151515' }], materials: ['cuero'] },
  { name: 'Zapatillas de running (demo)', subcategory: 'zapatillas_running', colors: [{ hex: '#3a3a3a' }], materials: ['tecnico'] },
  { name: 'Camiseta técnica (demo)', subcategory: 'camiseta_tecnica', colors: [{ hex: '#2f5ea8' }], materials: ['tecnico'] },
  { name: 'Mallas deportivas (demo)', subcategory: 'leggings', colors: [{ hex: '#151515' }], materials: ['tecnico'] },
  { name: 'Bolso negro (demo)', subcategory: 'bolso', colors: [{ hex: '#1a1a1a' }], materials: ['cuero'] },
  { name: 'Bufanda gris (demo)', subcategory: 'bufanda', colors: [{ hex: '#8c8c8c' }], materials: ['lana'] },
  { name: 'Paraguas (demo)', subcategory: 'paraguas', colors: [{ hex: '#1a1a1a' }] },
  { name: 'Gafas de sol (demo)', subcategory: 'gafas_sol', colors: [{ hex: '#1a1a1a' }] },
];

await withUser(ctx.db, user.id, async (trx) => {
  for (const g of garments) await createGarment(trx, user.id, g, { source: 'demo', isDemo: true });
  await updatePreferences(trx, user.id, { preferredStyles: ['minimalista', 'clasico'], usualContexts: ['trabajo', 'dia_informal'], favoriteColors: ['azul_marino', 'beige'], budget: { minEur: null, maxEur: 80 } });
  await trx.updateTable('users').set({ location_name: 'Madrid', location_lat: 40.42, location_lon: -3.7, onboarding_completed_at: new Date() }).where('id', '=', user.id).execute();
});
const credFile = resolve(import.meta.dirname, '../../../.demo-credentials.local');
writeFileSync(credFile, `# Cuenta DEMO local (no subir al repositorio)\nemail=${email}\npassword=${password}\n`, { mode: 0o600 });
console.log(`\nCuenta DEMO creada con ${garments.length} prendas marcadas como demo. Credenciales en .demo-credentials.local\n`);
await close();
