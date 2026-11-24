# Integraciones con comercios

Este documento resume **qué vía oficial existe hoy para cada tienda, qué está implementado y qué falta**.
La guía paso a paso para conseguir las aprobaciones y credenciales está en
[conectar-tiendas.md](conectar-tiendas.md). La investigación técnica anterior (robots.txt, fichas de
producto, API de Inditex, eBay) sigue en [research/integraciones-comerciales.md](research/integraciones-comerciales.md)
y las mediciones en [evidence/](evidence/).

> **Nada de esto da catálogo hasta que lleguen las aprobaciones.** Cada adaptador está desactivado
> mientras falten sus credenciales y la app lo dice tal cual en *Perfil → Integraciones*.

## Principios (no negociables)

1. **Solo vías legítimas**: APIs oficiales con acceso autorizado, feeds y APIs de producto de redes de
   afiliación en las que estemos aprobados, proveedores con licencia, y datos que **el propio usuario**
   aporta (enlace, página que está viendo, ticket, captura, etiqueta).
2. **Nada de endpoints privados**, ni evasión de autenticación, CAPTCHAs, medidas anti-bot o
   restricciones contractuales. Ninguna API inventada: cada adaptador se ha escrito contra la
   documentación oficial que se cita.
3. **Procedencia explícita**: cada precio y disponibilidad se guarda con su fuente (`feed` para ficheros
   de afiliación, `api` para APIs de producto, `structured_data` para importación por enlace).
4. **Precios**: nunca se presentan como actuales si superan `PRICE_FRESHNESS_HOURS` (24 h por defecto):
   el móvil muestra «precio no verificado recientemente». Por eso la ingesta debe ejecutarse al menos
   una vez al día.
5. **Imágenes de tienda**: solo se muestran con licencia (`image_policy = licensed`, feeds y APIs de
   afiliación). Las condiciones de Awin solo licencian publicar las imágenes **sin modificación** y para
   promocionar al anunciante: no recortar fondos ni editarlas sin permiso expreso.
6. **La comisión de afiliación nunca entra en el ranking**: el modelo `FeedProduct` no tiene ningún campo
   de comisión y `productScore` no la recibe (hay un test que lo comprueba). Los enlaces de afiliado se
   identifican siempre al usuario («Enlace de afiliado… No influye en el orden de las recomendaciones»).
7. Separación estricta: **prendas que posee** (`garments`) ≠ **productos guardados** (`wishlist_items`,
   `imported_products`) ≠ **productos a la venta** (`catalog_products`, solo de fuentes autorizadas).

## Matriz por tienda (investigación del 2026-11-24)

Marcas de fiabilidad: **[V]** verificado hoy en la página oficial de la red o de la marca; **[S]** fuente
secundaria (agregadores como affi.io, fragmentos de buscador): es una pista, **no** una confirmación;
**[?]** no verificable con fuentes públicas.

«Adaptador» indica si DressIt ya sabe ingerir esa vía en cuanto haya credenciales.

### Tiendas de la matriz original

| Tienda | Vía oficial hoy | Producto (feed/API) | Adaptador | Qué hace falta |
|---|---|---|---|---|
| Zara | Ninguna abierta. API de Inditex despublicada [V]; «Zara Ambassadors» es solo por invitación para creadores [S] | — | — | Contacto institucional con Inditex (plantilla en la guía) |
| Pull&Bear · Oysho · Zara Home | Ninguna encontrada para España [S] | — | — | Contacto con Inditex |
| Stradivarius | Programa ES de Awin cerrado; abiertos en FR, IT, DE, PT [S] | — | — | Contacto con Inditex |
| Bershka | «Bershka ES» en Tradedoubler [S]. El de EE. UU. marca las apps como «condicionales» [V] | Products API de Tradedoubler [V] | ✅ `tradedoubler` | Alta en Tradedoubler, localizar el programa, confirmar que acepta apps |
| Massimo Dutti | «Massimo Dutti ES» en Rakuten [S] | Product Search API de Rakuten [V] | ✅ `rakuten` | Comprobarlo en el panel de Rakuten y solicitarlo |
| Lefties | **Awin «Lefties ES» (25103), activo** [V]; menciona «catálogo de productos optimizado para afiliados» | Feeds de Awin [V] | ✅ `awin_feed` / `awin_enhanced` | Solicitar el programa en Awin |
| El Corte Inglés · Sfera | Programa de Awin 13075 **inactivo** [V]; solo «Ticketing ECI» (13034), que no es moda | — | — | Esperar reapertura; contacto directo |
| Mango (y Mango Outlet) | **Rakuten Advertising**, red exclusiva según su página oficial de afiliados [V] | Product Search API de Rakuten [V]; que Mango comparta catálogo en ES: [?] | ✅ `rakuten` | Alta en Rakuten, solicitar Mango y preguntar por el catálogo |
| H&M (COS, Arket, & Other Stories) | Nada para España [S]. Arket EU en Rakuten/Partnerize [S]. Su página de contacto dice que **no** considera colaboraciones por esa vía [V] | — | — | Ninguna vía práctica hoy |
| Uniqlo | Programa de Awin 6771 **inactivo** [V] | — | — | — |
| Springfield · Cortefiel · Pedro del Hierro · Women'secret (Tendam) | Un agregador los lista como abiertos en Awin ES [S]; sin ID público ni página de afiliados de la marca | Feeds de Awin si existen | ✅ `awin_*` (falta el ID) | Buscarlos en el directorio de Awin con sesión iniciada |
| Zalando (tienda principal) | Ninguna para España [S]. El «Zalando Partner Program» es para **vendedores**, no afiliados [V] | — | — | — |
| Privé by Zalando | **Awin 15573, activo** [V]. Prohíbe afiliados CSS y webs no españolas; no menciona feed | Feeds de Awin si existen | ✅ `awin_*` | Solicitarlo y confirmar que una app de recomendaciones no cuenta como CSS |
| ASOS | «ASOS Spain» en Rakuten [S]; Awin ES cerrado [S] | Product Search API de Rakuten [V] | ✅ `rakuten` | Comprobarlo en Rakuten |
| Decathlon | **Awin 105405, activo** [V]: 3 %, admite comparadores, prohíbe SEM de marca. El perfil no menciona feed | Feeds de Awin (se ven tras la aprobación) | ✅ `awin_*` (ID ya registrado) | Solicitar el programa |
| Nike | Programa europeo gestionado por Awin (`global-nike@awin.com`) con «automated product feed» [V]; «Nike ES» abierto según agregador, ID no verificado [S] | Feeds de Awin | ✅ `awin_*` (falta el ID) | Escribir a Awin para el ID de Nike ES |
| adidas | **Awin 77008, activo** [V]: cookie 30 días, portales de compra sin CSS | Feeds de Awin (tras aprobación) | ✅ `awin_*` (ID ya registrado) | Solicitar el programa |

### Otras tiendas relevantes en España

| Tienda | Vía oficial hoy | Adaptador | Notas |
|---|---|---|---|
| Primark | **No vende online en España** [S] (la web oficial devolvió un desafío anti-bot y no se pudo leer) | — | Sin vía de catálogo posible |
| SHEIN | «SHEIN ES» en Awin (119509) según fuentes secundarias [S]; el perfil público dio 404 hoy | ✅ `awin_*` | Confirmar en Awin con sesión |
| Bimba y Lola | **Awin «Bimbaylola_ES» (129495), activo** [V] | ✅ `awin_*` | No menciona feed ni reglas de apps |
| JD Sports | **Awin «JD Sports ES» (10121), activo** [V] | ✅ `awin_*` | Prohíbe SEM de marca |
| Foot Locker | **Awin «Foot Locker ES» (23409), activo** [V]; anuncia **«product feeds available»** | ✅ `awin_*` | La actividad CSS requiere aprobación expresa |
| Sprinter | **Awin «Sprinter ES» (27904), activo** [V] | ✅ `awin_*` | No acepta cupones, SEM ni retargeting |
| Desigual | Tradedoubler 261390: **apps móviles prohibidas** [V]. TradeTracker «Desigual ES» (18521) listado [V]; condiciones solo con sesión | ❌ (TradeTracker es SOAP, sin doc pública de feeds) | Solicitar en TradeTracker y preguntar por apps |
| Tous | «TOUS EU (ES, PL, PT…)» en CJ [S] | ✅ `cj` | Confirmar en CJ |
| The North Face | «The North Face Spain» en CJ [S] | ✅ `cj` (no registrada como tienda aún) | Confirmar en CJ |
| Guess | Awin 10588 «Guess ES / GUESS Europe», 7,5 %, admite comparadores [V]; territorio no explícito | ✅ `awin_*` (no registrada aún) | — |
| Miravia | Awin 37166 solo para influencers y redes sociales [V] | — | No encaja con una app |
| Calzedonia · Intimissimi · Tezenis | Adtraction / Tradedoubler según agregadores [S] | (`tradedoubler` si es TD) | Por confirmar |
| Privalia / Veepee | Programas ES cerrados [S] | — | — |
| About You | Programa ES de Awin cerrado; red actual desconocida [?] | — | — |
| Scalpers · Parfois · Mayoral · Pepe Jeans · Levi's · Tommy Hilfiger · Calvin Klein · Skechers · New Balance · Vans · Timberland · Converse · Ecoalf | Sin programa activo encontrado para España (cerrados o solo subredes) [S] | — | — |
| Vinted | Sin afiliación; su API «Vinted Pro Integrations» es solo para vendedores Pro en lista blanca y sus propios artículos [V] | — | No hay catálogo para terceros |
| Wallapop | «Wallapop Connect API» para vendedores profesionales e integradores [V]; sin búsqueda de catálogo | — | — |
| Amazon (moda) | Amazon Afiliados ES + **Creators API** (sustituye a PA-API 5). Exige **10 ventas cualificadas en 30 días** [V] | ❌ | Posible más adelante |
| eBay (segunda mano) | Browse API: producción solo para partners aprobados vía eBay Partner Network [V] | ❌ | Ver research §6 |

### Proveedores multitienda con licencia

| Proveedor | ¿Existe? | ¿Sirve en España? | Decisión |
|---|---|---|---|
| Kelkoo Group Shopping API | Sí, docs públicas: `api.kelkoogroup.net/publisher/shopping/v2/`, JWT del Publisher Center [V] | País `es`: **no verificado** [?] | Sin adaptador hasta confirmar cobertura ES y condiciones para apps |
| Sovrn Commerce | Product Data API: **enriquece una URL concreta**, no busca catálogo; mercado `eur_es` [V] | Sí para enriquecer [V] | Sin adaptador (no es catálogo) |
| Skimlinks Product Key | Sí [V] | **No**: «US, UK, Germany, France and Australia only» [V] | Descartado |
| impact.com Catalogs API | Sí, docs leídas (Basic auth, `@nextpageuri`, 3.000 peticiones/h) [V] | No encontramos anunciantes de moda ES [S] | Sin adaptador por ahora |
| Partnerize | Solo API de metadatos de feeds [V] | Arket EU [S] | Sin adaptador |
| Webgains | Feeds CSV/XML por programa desde la UI [V]; API no legible sin JS | Sin moda ES encontrada | Sin adaptador |
| Admitad | Docs devolvieron 403 | [?] | — |
| Google Shopping | No hay API de búsqueda de productos de terceros [S] | — | Descartado |

## Adaptadores implementados

Código: `services/api/src/modules/catalog/sources/`. Todos producen el mismo `FeedProduct`
normalizado y pasan por la misma ingesta (`catalog/ingest.ts` + `catalog/service.ts`).

| Fuente (`--source`) | Red | Procedencia | Documentación oficial usada (leída el 2026-11-24) | Límite respetado |
|---|---|---|---|---|
| `awin_feed` | Awin | `feed` | Feed list: https://help.awin.com/developers/docs/downloading-a-list-of-your-product-feeds.md · columnas CSV legacy (ver research §5.2) | 1 descarga cada 3 s |
| `awin_enhanced` | Awin | `api` | https://help.awin.com/apidocs/retail-publisher-productapidocumentation-1.md · https://help.awin.com/developers/docs/enhanced-feeds-publisher-faq.md · https://help.awin.com/apidocs/api-authentication.md | ≤ 5 peticiones/min (doc.), sin concurrencia; última línea con `error` = descarga incompleta |
| `rakuten` | Rakuten Advertising | `api` | https://developers.rakutenadvertising.com/guides/product_search · https://developers.rakutenadvertising.com/guides/access_tokens | 100 llamadas/min (doc.); máx. 5.000 resultados |
| `tradedoubler` | Tradedoubler | `api` | https://dev.tradedoubler.com/products/publisher/ | Máx. 1.000 productos por búsqueda (doc.); 1 petición/s |
| `cj` | CJ | `api` | https://developers.cj.com/graphql/reference/Product%20Feed | 500 llamadas / 5 min (doc.); offset hasta 10.000 |

Comportamiento común:

- **Desactivado sin credenciales**: `jobs()` no hace ninguna llamada si falta una variable; el estado es
  `pending_credentials` con la variable concreta que falta.
- **Estados honestos** en `GET /v1/retailers` → campo `catalogSources[]` (y una frase en `notes`, que es lo
  que muestra hoy *Perfil → Integraciones*):
  `pending_credentials` (faltan credenciales o el ID de la tienda en la red), `configured` (todo listo, sin
  ingesta todavía), `operational` (la última ingesta fue bien), `error` (la última ingesta falló; se
  muestra el error sin secretos), `unsupported` (vía sin adaptador, p. ej. Inditex o TradeTracker).
- **429 / `Retry-After`** respetados, reintentos con espera para 5xx, nunca para 4xx; los tokens se
  eliminan de cualquier mensaje o etiqueta guardada (`redactUrl`).
- **Descarga vacía ≠ catálogo vacío**: si una fuente no devuelve productos válidos la ingesta falla y **no
  desactiva nada**. Si devuelve productos, se desactivan solo los de *esa* integración que ya no aparecen.
- Variantes por talla (formato Google: una fila por talla) se agrupan por `item_group_id` + color.
- Lo que la red no documenta se deja como desconocido: Rakuten no da marca, disponibilidad ni tallas;
  Tradedoubler no da precio de referencia (el historial de precios **no** se muestra como «antes», para no
  inducir a error).
- Tests: `services/api/test/unit/catalog-sources.test.ts` (HTTP simulado, reloj falso, fixtures
  **sintéticos** en `services/api/test/fixtures/sources/`) y el bloque «official catalog sources» de
  `test/integration/api.test.ts`. Ningún test llama a una API real.

Comandos:

```bash
pnpm --filter @dressit/api catalog:ingest -- --status            # qué fuentes tienen credenciales
pnpm --filter @dressit/api catalog:ingest                        # ingiere todas las configuradas
pnpm --filter @dressit/api catalog:ingest -- --source rakuten     # solo una fuente
pnpm --filter @dressit/api catalog:ingest -- --retailer decathlon --feed <url-o-ruta-csv>   # feed CSV suelto
```

## Interfaz común de capacidades

| Capacidad | Importación por enlace | Captura en dispositivo | Feed / API de afiliación |
|---|---|---|---|
| Buscar productos | — | — | ✅ (catálogo local) |
| Detalles / tallas | ✅ JSON-LD | ✅ | ✅ (según lo que documente la red) |
| Precio y disponibilidad | ✅ (en el momento) | ✅ | ✅ (por ingesta, con procedencia) |
| Imágenes autorizadas | según `image_policy` | según `image_policy` | ✅ licencia del programa |
| Enlace de compra | URL canónica | URL canónica | enlace de afiliado (identificado) |
| Estado | `retailers:check` | — | `catalog_sync_runs` + `catalogSources` |

## Guía: añadir una tienda o una red nueva

1. Añade la tienda a `RETAILERS` en `services/api/src/modules/retail/registry.ts` con su integración
   `affiliate('<red>', { programId, requires, notes })`. Pon `programId` **solo** si lo has verificado en la
   página pública de la red; si no, dilo en `notes`.
2. Si la red ya tiene adaptador, basta con el mapeo `tienda=ID` en la variable de entorno de la red.
3. Si la red es nueva: lee su documentación oficial, crea `catalog/sources/<red>.ts` que devuelva
   `FeedProduct`, respeta sus límites con `RateLimitedClient`, añade fixtures **sintéticos** etiquetados y
   tests con HTTP simulado, regístrala en `sources/index.ts`, y documenta sus variables en `.env.example`.
4. Revisa las condiciones del programa (apps, CSS, imágenes) antes de activarlo.

## Importación de compras anteriores

- **Tickets, facturas, capturas y etiquetas**: `POST /v1/imports/text` extrae tienda, pedido, fecha,
  líneas con referencia, EAN (con dígito de control), talla y precio, y enlaces de producto.
- **Correos de confirmación**: el usuario los comparte o pega (sin acceso a su buzón).
- **EAN**: se buscan en las variantes de catálogos autorizados; si no hay coincidencia se pide foto.
- Nunca se piden contraseñas de tiendas ni se automatizan cuentas privadas.

## Fuentes de esta actualización (consultadas el 2026-11-24)

Programas verificados [V]:
https://ui.awin.com/merchant-profile/105405 ·
https://ui.awin.com/merchant-profile/77008 ·
https://ui.awin.com/merchant-profile/25103 ·
https://ui.awin.com/merchant-profile/129495 ·
https://ui.awin.com/merchant-profile/10121 ·
https://ui.awin.com/merchant-profile/23409 ·
https://ui.awin.com/merchant-profile/27904 ·
https://ui.awin.com/merchant-profile/15573 ·
https://ui.awin.com/merchant-profile/10588 ·
https://ui.awin.com/merchant-profile/37166 ·
https://ui.awin.com/merchant-profile/13075 (inactivo, 404) ·
https://ui.awin.com/merchant-profile/6771 (inactivo, 404) ·
https://directory.tradedoubler.com/en/programs/261390-Desigual-ES ·
https://directory.tradedoubler.com/en/programs/358628-Bershka-US ·
https://www.tradetracker.com/es/campaigns/moda-y-joyas-22/desigual-es-18521/ ·
https://shop.mango.com/es/es/affiliate (verificada en la investigación anterior del mismo día; hoy devolvió 429) ·
https://www.nike.com/fi/help/a/nike-affiliate-programme ·
https://partner.zalando.com/university/article/zalando-partner-program-markets ·
https://affiliate-program.amazon.com/creatorsapi/docs/en-us/introduction ·
https://affiliate-program.amazon.com/creatorsapi/docs/en-us/frequently-asked-questions ·
https://pro-docs.svc.vinted.com · https://developers.wallapop.com/ ·
https://www.inditex.com/itxcomweb/es/en/info/contact-us · https://hmgroup.com/about-us/contact-us/ ·
https://www.mangofashiongroup.com/en/contact

Documentación técnica [V]: la de la tabla de adaptadores, más
https://docs.kelkoogroup.com/for-publishers.md · https://developer.sovrn.com/reference/prod-data-api ·
https://developers.skimlinks.com/openapi/products-api.yaml ·
https://integrations.impact.com/partner-api-reference/reference/catalogs/catalogs.md ·
https://api-docs.partnerize.com/partner/ · https://knowledgehub.webgains.com/home/product-feeds-for-publishers ·
https://ws.tradetracker.com/soap/affiliate?wsdl

Secundarias [S] (pistas, no confirmaciones): páginas de https://affi.io/m/ (zara-, bershka, massimo-dutti,
mango, springfield, cortefiel, pedro-del-hierro-es, womensecret-es, asos, nike, shein, tous,
the-north-face, privalia, veepee, calzedonia, uniqlo, el-corte-ingles…), https://www.affilitizer.com,
https://www.modaes.com y https://fashionunited.es (Primark sin venta online en España).
