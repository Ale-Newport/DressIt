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
  /** Advertiser/programme id on the affiliate network (only when verified on the network's public page). */
  programId?: string;
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

type AffiliateProvider = 'awin' | 'rakuten' | 'tradedoubler' | 'cj' | 'tradetracker';
/** Env var whose presence enables the adapter (names only; see .env.example). TradeTracker has no adapter. */
const CREDENTIALS_ENV: Record<AffiliateProvider, string | undefined> = {
  awin: 'AWIN_PUBLISHER_ID',
  rakuten: 'RAKUTEN_CLIENT_ID',
  tradedoubler: 'TRADEDOUBLER_PRODUCTS_TOKEN',
  cj: 'CJ_PERSONAL_ACCESS_TOKEN',
  tradetracker: undefined,
};

/**
 * An affiliate programme. `programId` is the network's advertiser id when it was verified on the
 * network's own public page (see docs/comercios.md); unverified programmes say so in `notes`.
 */
const affiliate = (provider: AffiliateProvider, o: { programId?: string; requires: string; notes: string }): IntegrationDef => ({
  kind: 'affiliate_feed',
  provider,
  status: 'pending_authorization',
  imagePolicy: 'licensed',
  capabilities: { catalogSearch: true, prices: true, availability: true, images: true, affiliateLinks: true, visualSearch: true },
  ...(CREDENTIALS_ENV[provider] ? { credentialsEnv: CREDENTIALS_ENV[provider] } : {}),
  ...(o.programId ? { programId: o.programId } : {}),
  requires: o.requires,
  notes: o.notes,
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

const inditex = (id: string, name: string, domain: string, extra: IntegrationDef[] = []): RetailerDef => ({
  id,
  name,
  group: 'Inditex',
  domains: [domain],
  website: `https://www.${domain}/es/`,
  integrations: [blocked('HTTP 403, Akamai'), pageCapture, inditexApi, ...extra],
});

/** Retailers added from the 2026-11-24 affiliate research; server-side link import not measured yet. */
const unmeasured = linkImport('Importación por enlace aún no medida con `retailers:check`; si la tienda bloquea la lectura desde servidor, se usa la captura en dispositivo.');

const tendamAwin = (brand: string) =>
  affiliate('awin', {
    requires: `Localizar «${brand} ES» en el directorio de Awin (con sesión iniciada) y solicitar el programa.`,
    notes: `Un agregador de terceros lista «${brand} ES» como abierto en Awin; no se ha podido verificar en la página oficial de Awin (sin ID público).`,
  });

export const RETAILERS: RetailerDef[] = [
  inditex('zara', 'Zara', 'zara.com'),
  inditex('pullandbear', 'Pull&Bear', 'pullandbear.com'),
  inditex('bershka', 'Bershka', 'bershka.com', [
    affiliate('tradedoubler', {
      requires: 'Localizar «Bershka ES» en Tradedoubler y solicitarlo. El programa equivalente de EE. UU. marca las apps móviles como «condicionales».',
      notes: 'Un agregador de terceros lista «Bershka ES» en Tradedoubler; no verificado en el directorio oficial.',
    }),
  ]),
  inditex('massimodutti', 'Massimo Dutti', 'massimodutti.com', [
    affiliate('rakuten', {
      requires: 'Comprobar en el panel de Rakuten Advertising si «Massimo Dutti ES» admite publishers y solicitarlo.',
      notes: 'Un agregador de terceros lista Massimo Dutti ES en Rakuten Advertising; no verificado.',
    }),
  ]),
  inditex('stradivarius', 'Stradivarius', 'stradivarius.com'),
  inditex('oysho', 'Oysho', 'oysho.com'),
  inditex('lefties', 'Lefties', 'lefties.com', [
    affiliate('awin', {
      programId: '25103',
      requires: 'Cuenta de publisher en Awin aprobada por «Lefties ES» (programa 25103).',
      notes: 'Programa activo en Awin (4 %; 6 % creadores). Menciona un «catálogo de productos optimizado para afiliados». Prohíbe pujar por la marca y ceder enlaces a terceros sin autorización.',
    }),
  ]),
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
    domains: ['mango.com', 'shop.mango.com', 'mangooutlet.com'],
    website: 'https://shop.mango.com/es/es',
    integrations: [
      blocked('HTTP 429, Vercel Security Checkpoint; publica microdatos schema.org en lugar de JSON-LD'),
      pageCapture,
      affiliate('rakuten', {
        requires: 'Aprobación en el programa de Mango en Rakuten Advertising (su página oficial de afiliados remite a Rakuten) y su MID en RAKUTEN_ADVERTISERS.',
        notes: 'Programa exclusivo en Rakuten Advertising. Que Mango exponga su catálogo a publishers en España está por confirmar con Rakuten/Mango.',
      }),
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
    integrations: [linkImport('Responde a la lectura a petición del usuario con JSON-LD Product. Ojo: su og:price:amount es 0.0, se usa el precio del JSON-LD.'), pageCapture, tendamAwin('Springfield')],
  },
  {
    id: 'cortefiel',
    name: 'Cortefiel',
    group: 'Tendam',
    domains: ['cortefiel.com'],
    website: 'https://cortefiel.com/es/es',
    integrations: [linkImport('Responde con JSON-LD Product. Su og:price:amount es 0.0, se usa el precio del JSON-LD.'), pageCapture, tendamAwin('Cortefiel')],
  },
  {
    id: 'pedrodelhierro',
    name: 'Pedro del Hierro',
    group: 'Tendam',
    domains: ['pedrodelhierro.com'],
    website: 'https://cortefiel.com/es/es',
    integrations: [linkImport('pedrodelhierro.com redirige a intl.cortefiel.com; el catálogo español está en cortefiel.com (se resuelve como Cortefiel con marca Pedro del Hierro).'), pageCapture, tendamAwin('Pedro del Hierro')],
  },
  {
    id: 'womensecret',
    name: "Women'secret",
    group: 'Tendam',
    domains: ['womensecret.com'],
    website: 'https://womensecret.com/es/es',
    integrations: [unmeasured, pageCapture, tendamAwin("Women'secret")],
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
    integrations: [
      blocked('sin respuesta desde servidor (timeout)'),
      pageCapture,
      affiliate('rakuten', {
        requires: 'Comprobar en el panel de Rakuten Advertising si «ASOS Spain» acepta publishers y solicitarlo.',
        notes: 'Un agregador de terceros lista «ASOS Spain» en Rakuten Advertising; no verificado. El programa ES de Awin figura cerrado.',
      }),
    ],
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
      affiliate('awin', {
        programId: '105405',
        requires: 'Cuenta de publisher en Awin aprobada por «Decathlon ES» (programa 105405).',
        notes: 'Programa activo en Awin (3 %, cookie de 1 día para generalistas). Admite comparadores; prohíbe SEM de marca. El perfil público no menciona feed: se ve en Create-a-Feed tras la aprobación.',
      }),
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
      affiliate('awin', {
        requires: 'Confirmar con global-nike@awin.com el ID del programa Nike ES en Awin y solicitarlo.',
        notes: 'El programa europeo de Nike lo gestiona Awin y menciona un feed de producto automatizado. Un agregador lista «Nike ES» como abierto; ID no verificado.',
      }),
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
      affiliate('awin', {
        programId: '77008',
        requires: 'Cuenta de publisher en Awin aprobada por «adidas ES» (programa 77008).',
        notes: 'Programa activo en Awin (cookie de 30 días). Acepta portales de compra sin actividad CSS. El perfil no menciona feed: se ve en Create-a-Feed tras la aprobación.',
      }),
    ],
  },
  {
    id: 'zalando_prive',
    name: 'Privé by Zalando',
    group: 'Zalando',
    domains: ['privebyzalando.es', 'zalando-prive.es'],
    website: 'https://www.zalando-prive.es/',
    integrations: [
      affiliate('awin', {
        programId: '15573',
        requires: 'Aprobación en «Privé by Zalando ES» en Awin. Prohíbe afiliados CSS: confirmar con el anunciante que una app de recomendaciones es aceptable.',
        notes: 'Único programa de Zalando España en Awin (cookie de 30 días). No menciona feed de producto.',
      }),
    ],
  },
  {
    id: 'bimbaylola',
    name: 'Bimba y Lola',
    group: null,
    domains: ['bimbaylola.com'],
    website: 'https://www.bimbaylola.com/es_es/',
    integrations: [
      unmeasured,
      pageCapture,
      affiliate('awin', { programId: '129495', requires: 'Aprobación en «Bimbaylola_ES» en Awin (programa 129495).', notes: 'Programa activo en Awin (cookie de 30 días). No menciona feed ni reglas sobre apps.' }),
    ],
  },
  {
    id: 'jdsports',
    name: 'JD Sports',
    group: 'JD Group',
    domains: ['jdsports.es'],
    website: 'https://www.jdsports.es/',
    integrations: [
      unmeasured,
      pageCapture,
      affiliate('awin', { programId: '10121', requires: 'Aprobación en «JD Sports ES» en Awin (programa 10121).', notes: 'Programa activo en Awin (cookie de 30 días). Prohíbe SEM de marca. No menciona feed.' }),
    ],
  },
  {
    id: 'footlocker',
    name: 'Foot Locker',
    group: null,
    domains: ['footlocker.es'],
    website: 'https://www.footlocker.es/',
    integrations: [
      unmeasured,
      pageCapture,
      affiliate('awin', { programId: '23409', requires: 'Aprobación en «Foot Locker ES» en Awin (programa 23409). La actividad CSS requiere aprobación expresa.', notes: 'Programa activo en Awin que anuncia «product feeds available».' }),
    ],
  },
  {
    id: 'sprinter',
    name: 'Sprinter',
    group: null,
    domains: ['sprintersports.com'],
    website: 'https://www.sprintersports.com/',
    integrations: [
      unmeasured,
      pageCapture,
      affiliate('awin', { programId: '27904', requires: 'Aprobación en «Sprinter ES» en Awin (programa 27904).', notes: 'Programa activo en Awin (cookie de 30 días). No acepta cupones, SEM ni retargeting. No menciona feed.' }),
    ],
  },
  {
    id: 'desigual',
    name: 'Desigual',
    group: null,
    domains: ['desigual.com'],
    website: 'https://www.desigual.com/es_ES/',
    integrations: [
      unmeasured,
      pageCapture,
      affiliate('tradetracker', {
        requires: 'Aprobación en «Desigual ES» en TradeTracker (campaña 18521) y confirmar que admite apps. En Tradedoubler (261390) las apps móviles están prohibidas.',
        notes: 'Sin adaptador: la API de TradeTracker es SOAP y no hemos encontrado documentación pública de feeds para publishers.',
      }),
    ],
  },
  {
    id: 'tous',
    name: 'Tous',
    group: null,
    domains: ['tous.com'],
    website: 'https://www.tous.com/es-es/',
    integrations: [
      unmeasured,
      pageCapture,
      affiliate('cj', { requires: 'Localizar «TOUS EU» en CJ Affiliate y solicitarlo; anotar su ID de anunciante en CJ_ADVERTISERS.', notes: 'Un agregador de terceros lista «TOUS EU (ES, PL, PT…)» en CJ; no verificado en CJ.' }),
    ],
  },
  {
    id: 'shein',
    name: 'SHEIN',
    group: null,
    domains: ['shein.com'],
    website: 'https://es.shein.com/',
    integrations: [
      unmeasured,
      pageCapture,
      affiliate('awin', { requires: 'Confirmar en Awin el programa «SHEIN ES» (su perfil público no cargó el 24/11/2026) y solicitarlo.', notes: 'Fuentes secundarias citan un programa SHEIN ES en Awin; no verificado.' }),
    ],
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
