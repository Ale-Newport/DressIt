/**
 * Retailer registry: which stores we know, their domains (for link resolution)
 * and the legitimate integration routes available for each one.
 *
 * Status semantics (shown to users in the integrations matrix):
 *  - operational:            verified end-to-end with credentials/permission in this deployment
 *  - partial:                some capabilities verified (e.g. link import works, catalog pending)
 *  - link_only:              only user-initiated link import / page capture
 *  - pending_authorization:  needs an agreement, affiliate approval or API credentials
 *
 * The link-import status is *measured* by `pnpm retailers:check` (see
 * scripts/check-retailers.ts) and stored in retailer_integrations.last_check_*.
 * Research and sources: docs/research/integraciones-comerciales.md
 */
import type { ImagePolicy, IntegrationStatus } from '@dressit/shared';

export interface IntegrationDef {
  kind: 'official_api' | 'affiliate_feed' | 'data_provider' | 'public_catalog' | 'link_import' | 'page_capture' | 'manual';
  provider: string;
  status: IntegrationStatus;
  imagePolicy: ImagePolicy;
  capabilities: Partial<Record<'linkImport' | 'pageCapture' | 'catalogSearch' | 'prices' | 'availability' | 'images' | 'affiliateLinks' | 'visualSearch', boolean>>;
  credentialsEnv?: string;
  requires?: string;
  notes: string;
}

export interface RetailerDef {
  id: string;
  name: string;
  group: string | null;
  domains: string[];
  website: string;
  integrations: IntegrationDef[];
}

const linkImport = (notes = 'Lectura de los datos estructurados (schema.org/OpenGraph) que la tienda publica en la página del producto, solo a petición del usuario y respetando robots.txt.'): IntegrationDef => ({
  kind: 'link_import',
  provider: 'structured_data',
  status: 'link_only',
  imagePolicy: 'none',
  capabilities: { linkImport: true, prices: true, availability: true },
  notes,
});

const pageCapture: IntegrationDef = {
  kind: 'page_capture',
  provider: 'in_app_browser',
  status: 'link_only',
  imagePolicy: 'none',
  capabilities: { pageCapture: true, prices: true, availability: true },
  notes: 'El usuario abre la página en el navegador integrado o comparte desde Safari; la app lee los datos estructurados de la página que el propio usuario está viendo.',
};

const affiliate = (provider: 'awin' | 'rakuten', requires: string, notes: string, credentialsEnv = 'AWIN_PRODUCTDATA_API_KEY'): IntegrationDef => ({
  kind: 'affiliate_feed',
  provider,
  status: 'pending_authorization',
  imagePolicy: 'licensed',
  capabilities: { catalogSearch: true, prices: true, availability: true, images: true, affiliateLinks: true, visualSearch: true },
  credentialsEnv,
  requires,
  notes,
});

const inditexApi: IntegrationDef = {
  kind: 'official_api',
  provider: 'inditex_api_marketplace',
  status: 'pending_authorization',
  imagePolicy: 'licensed',
  capabilities: { catalogSearch: true, prices: true, visualSearch: true },
  credentialsEnv: 'INDITEX_CLIENT_ID',
  requires: 'Acuerdo directo con Inditex. A 24/11/2026 su portal de APIs (developer.inditex.com → /apimktplc/web/) aparece como «unpublished-marketplace» y no hay alta pública.',
  notes: 'No se implementan llamadas: la documentación pública ya no está disponible y solo existen referencias secundarias de hackathons de 2025. No se usa ningún endpoint privado de las webs de las marcas.',
};

const blocked = (detail: string) =>
  linkImport(`La tienda bloquea la lectura desde servidor (${detail}). Vía operativa: el usuario abre la página en el navegador integrado o comparte desde Safari y la app lee los datos de la página que está viendo.`);

const inditex = (id: string, name: string, domain: string): RetailerDef => ({
  id,
  name,
  group: 'Inditex',
  domains: [domain],
  website: `https://www.${domain}/es/`,
  integrations: [blocked('HTTP 403, Akamai'), pageCapture, inditexApi],
});

export const RETAILERS: RetailerDef[] = [
  inditex('zara', 'Zara', 'zara.com'),
  inditex('pullandbear', 'Pull&Bear', 'pullandbear.com'),
  inditex('bershka', 'Bershka', 'bershka.com'),
  inditex('massimodutti', 'Massimo Dutti', 'massimodutti.com'),
  inditex('stradivarius', 'Stradivarius', 'stradivarius.com'),
  inditex('oysho', 'Oysho', 'oysho.com'),
  inditex('lefties', 'Lefties', 'lefties.com'),
  {
    id: 'elcorteingles',
    name: 'El Corte Inglés',
    group: 'El Corte Inglés',
    domains: ['elcorteingles.es'],
    website: 'https://www.elcorteingles.es/moda/',
    integrations: [blocked('HTTP 403, Akamai'), pageCapture],
  },
  {
    id: 'sfera',
    name: 'Sfera',
    group: 'El Corte Inglés',
    domains: ['sfera.com'],
    website: 'https://www.elcorteingles.es/sfera/',
    integrations: [blocked('sfera.com solo muestra un selector de país; el catálogo está en elcorteingles.es'), pageCapture],
  },
  {
    id: 'mango',
    name: 'Mango',
    group: null,
    domains: ['mango.com', 'shop.mango.com'],
    website: 'https://shop.mango.com/es/es',
    integrations: [
      blocked('HTTP 429, Vercel Security Checkpoint; publica microdatos schema.org en lugar de JSON-LD'),
      pageCapture,
      affiliate('rakuten', 'Aprobación en el programa de Mango en Rakuten Advertising y acceso a su catálogo de productos.', 'Programa de afiliación en Rakuten Advertising; disponibilidad del feed de producto por confirmar.', 'RAKUTEN_TOKEN'),
    ],
  },
  {
    id: 'hm',
    name: 'H&M',
    group: 'H&M Group',
    domains: ['hm.com', 'www2.hm.com'],
    website: 'https://www2.hm.com/es_es/index.html',
    integrations: [blocked('HTTP 403, Akamai'), pageCapture],
  },
  {
    id: 'uniqlo',
    name: 'Uniqlo',
    group: 'Fast Retailing',
    domains: ['uniqlo.com'],
    website: 'https://www.uniqlo.com/es/es/',
    integrations: [blocked('sin respuesta desde servidor (timeout)'), pageCapture],
  },
  {
    id: 'springfield',
    name: 'Springfield',
    group: 'Tendam',
    domains: ['myspringfield.com'],
    website: 'https://myspringfield.com/es/es',
    integrations: [linkImport('Responde a la lectura a petición del usuario con JSON-LD Product. Ojo: su og:price:amount es 0.0, se usa el precio del JSON-LD.'), pageCapture],
  },
  {
    id: 'cortefiel',
    name: 'Cortefiel',
    group: 'Tendam',
    domains: ['cortefiel.com'],
    website: 'https://cortefiel.com/es/es',
    integrations: [linkImport('Responde con JSON-LD Product. Su og:price:amount es 0.0, se usa el precio del JSON-LD.'), pageCapture],
  },
  {
    id: 'pedrodelhierro',
    name: 'Pedro del Hierro',
    group: 'Tendam',
    domains: ['pedrodelhierro.com'],
    website: 'https://cortefiel.com/es/es',
    integrations: [linkImport('pedrodelhierro.com redirige a intl.cortefiel.com; el catálogo español está en cortefiel.com (se resuelve como Cortefiel con marca Pedro del Hierro).'), pageCapture],
  },
  {
    id: 'zalando',
    name: 'Zalando',
    group: null,
    domains: ['zalando.es'],
    website: 'https://www.zalando.es/',
    integrations: [linkImport('Responde con JSON-LD ProductGroup.'), pageCapture],
  },
  {
    id: 'asos',
    name: 'ASOS',
    group: null,
    domains: ['asos.com'],
    website: 'https://www.asos.com/es/',
    integrations: [blocked('sin respuesta desde servidor (timeout)'), pageCapture],
  },
  {
    id: 'decathlon',
    name: 'Decathlon',
    group: null,
    domains: ['decathlon.es'],
    website: 'https://www.decathlon.es/es/',
    integrations: [
      blocked('desafío de Cloudflare'),
      pageCapture,
      affiliate('awin', 'Cuenta de publisher en Awin aprobada por «Decathlon ES» (programa 105405) y clave de Create-a-Feed.', 'Programa activo en Awin (3 %, cookie de 1 día). Feed disponible tras la aprobación.'),
    ],
  },
  {
    id: 'nike',
    name: 'Nike',
    group: null,
    domains: ['nike.com'],
    website: 'https://www.nike.com/es/',
    integrations: [
      linkImport('Responde con JSON-LD ProductGroup con variantes.'),
      pageCapture,
      affiliate('awin', 'Aprobación en el programa europeo de Nike gestionado por Awin (cobertura de España por confirmar).', 'El programa menciona un feed de producto automatizado.'),
    ],
  },
  {
    id: 'adidas',
    name: 'Adidas',
    group: null,
    domains: ['adidas.es', 'adidas.com'],
    website: 'https://www.adidas.es/',
    integrations: [
      blocked('HTTP 403, cortafuegos'),
      pageCapture,
      affiliate('awin', 'Cuenta de publisher en Awin aprobada por «adidas ES» (programa 77008) y clave de Create-a-Feed.', 'Programa activo en Awin (cookie de 30 días).'),
    ],
  },
  {
    id: 'zalando_prive',
    name: 'Privé by Zalando',
    group: 'Zalando',
    domains: ['privebyzalando.es', 'zalando-prive.es'],
    website: 'https://www.zalando-prive.es/',
    integrations: [affiliate('awin', 'Aprobación en el programa «Privé by Zalando ES» en Awin.', 'Único programa de Zalando España encontrado en Awin.')],
  },
];

/** Test product URLs (Spanish market) used by `pnpm retailers:check`. Source: docs/research/integraciones-comerciales.md */
export const TEST_URLS: Record<string, string> = {
  zara: 'https://www.zara.com/es/es/cazadora-regular-fit-con-lana-p04517500.html',
  pullandbear: 'https://www.pullandbear.com/es/chaqueta-doble-faz-l07720321',
  bershka: 'https://www.bershka.com/es/cazadora-acolchada-capucha-c0p226931225.html',
  massimodutti: 'https://www.massimodutti.com/es/botin-plano-chelsea-piso-track-l11126650',
  stradivarius: 'https://www.stradivarius.com/es/cazadora-oversize-efecto-piel-l08460705',
  oysho: 'https://www.oysho.com/es/camiseta-seamless-base-layers-l30216842',
  lefties: 'https://www.lefties.com/es/hombre/ropa/pantalones/pantal%C3%B3n-jogger-tailoring-c1030267575p753740600.html',
  elcorteingles: 'https://www.elcorteingles.es/moda-hombre/A59419370-negro-pr-abrigo-tecnico-de-hombre-color-negro-cuello-desmontable/',
  mango: 'https://shop.mango.com/es/es/p/mujer/abrigos/abrigos/abrigo-lana-cruzado-botones/47041448/56/00',
  hm: 'https://www2.hm.com/es_es/productpage.1348073008.html',
  uniqlo: 'https://www.uniqlo.com/es/es/products/E422987-000/00',
  springfield: 'https://myspringfield.com/es/es/hombre/cazadoras/chaqueta-softshell-capucha/0954304.html',
  cortefiel: 'https://cortefiel.com/es/es/mujer/abrigos/gabardina-satinada-capucha-desmontable/6614836.html',
  pedrodelhierro: 'https://cortefiel.com/es/es/hombre/camisas/camisa-cuadro-melange/1844322.html',
  zalando: 'https://www.zalando.es/jack-and-jones-jjgalaxy-puffer-chaqueta-de-invierno-sky-captain-ja222t28r-k11.html',
  asos: 'https://www.asos.com/es/asos-design/asos-design-sudadera-con-capucha-con-detalle-de-nudo-y-cintura-ajustada-en-gris-antracita/prd/212100190',
  decathlon: 'https://www.decathlon.es/es/p/camiseta-running-transpirable-mujer-kiprun-skincare-negro/100155/c382m8548024',
  nike: 'https://www.nike.com/es/t/24-7-impossiblysoft-plush-chaqueta-therma-fit-hombre-Hd8aZX3i',
  adidas: 'https://www.adidas.es/sudadera-trefoil-essentials-crew/KS8921.html',
};

export function retailerForHost(hostname: string): RetailerDef | null {
  const host = hostname.toLowerCase().replace(/^www\d?\./, '');
  for (const r of RETAILERS) {
    for (const d of r.domains) {
      const dom = d.replace(/^www\d?\./, '');
      if (host === dom || host.endsWith(`.${dom}`)) return r;
    }
  }
  return null;
}
