# Integraciones con comercios

Este documento resume **qué funciona hoy, qué está pendiente y por qué** en la conexión con tiendas
reales. La investigación completa, con fuentes y marcas de fiabilidad, está en
[research/integraciones-comerciales.md](research/integraciones-comerciales.md). Las mediciones
reales en [evidence/](evidence/).

## Principios (no negociables)

1. **Solo vías legítimas**: APIs oficiales con acceso autorizado, feeds de redes de afiliación aprobadas,
   proveedores con licencia, y datos que **el propio usuario** aporta (enlace, página que está viendo,
   ticket, captura, etiqueta).
2. **Nada de endpoints privados**, ni evasión de autenticación, CAPTCHAs, medidas anti-bot o
   restricciones contractuales. El importador se identifica con un user-agent honesto, respeta
   `robots.txt` y hace **una** petición por acción del usuario.
3. **Procedencia explícita**: cada dato lleva su fuente (`json_ld`, `microdata`, `open_graph`,
   `page_capture`, `feed`, `api`, `inferred`, `user`) y solo se marca como *verificado* si se leyó de la
   tienda en `verifiedAt`. Lo deducido (categoría, familia de color, materiales) se marca como inferido.
4. **Precios**: nunca se presentan como actuales si superan `PRICE_FRESHNESS_HOURS` (24 h por defecto):
   el móvil muestra «precio no verificado recientemente».
5. **Imágenes de tienda**: solo se muestran con licencia (`image_policy = licensed`, p. ej. feeds de
   afiliación). En importación por enlace la política por defecto es `none`: se pide al usuario su propia
   foto. Activar `link_preview` (mostrar la imagen enlazada, sin re-alojarla) es una decisión legal que
   se toma por tienda en `retailer_integrations.image_policy`.
6. **La comisión de afiliación nunca entra en el ranking** (`productScore` no la recibe) y los enlaces de
   afiliado se identifican siempre al usuario.
7. Separación estricta: **prendas que posee** (`garments`) ≠ **productos guardados** (`wishlist_items`,
   `imported_products`, privados del usuario) ≠ **productos a la venta** (`catalog_products`, global y
   solo de fuentes autorizadas).

## Matriz de integración (medida el 2026-11-24)

«Enlace (servidor)» es el resultado real de `pnpm --filter @dressit/api retailers:check`
([evidencia](evidence/retailers-2026-11-24.md)). «Captura en dispositivo» = el usuario abre la ficha en
el navegador integrado o comparte desde Safari y la app lee los datos estructurados de la página que
está viendo.

| Tienda | Enlace (servidor) | Captura en dispositivo | Catálogo / feed | Estado en la app |
|---|---|---|---|---|
| Zara | ⛔ 403 | ✅ JSON-LD | API de Inditex: portal no publicado | **Solo importación de enlaces** |
| Pull&Bear | ⛔ 403 | ✅ JSON-LD | Inditex (ídem) | **Solo importación de enlaces** |
| Bershka | ⛔ 403 | ✅ JSON-LD | Inditex (ídem) | **Solo importación de enlaces** |
| Massimo Dutti | ⛔ 403 | ✅ JSON-LD | Inditex (ídem) | **Solo importación de enlaces** |
| Stradivarius | ⛔ 403 | ✅ JSON-LD | Inditex (ídem) | **Solo importación de enlaces** |
| Oysho | ⛔ 403 | ✅ JSON-LD | Inditex (ídem) | **Solo importación de enlaces** |
| Lefties | ⛔ 403 | ✅ JSON-LD | Inditex (ídem) | **Solo importación de enlaces** |
| El Corte Inglés | ⛔ 403 | ✅ JSON-LD | Awin ES inactivo | **Solo importación de enlaces** |
| Sfera | ⛔ (catálogo en ECI) | ✅ JSON-LD | — | **Solo importación de enlaces** |
| Mango | ⛔ 429 | ✅ microdatos | Rakuten Advertising | **Solo enlaces** · feed **pendiente de autorización** |
| H&M | ⛔ 403 | ✅ JSON-LD | — | **Solo importación de enlaces** |
| Uniqlo | ⛔ conexión rechazada | ✅ JSON-LD | Awin inactivo | **Solo importación de enlaces** |
| Springfield | ✅ 200 JSON-LD | ✅ | — | **Parcialmente operativa** |
| Cortefiel | ✅ 200 JSON-LD | ✅ | — | **Parcialmente operativa** |
| Pedro del Hierro | ✅ 200 (vía cortefiel.com) | ✅ | — | **Parcialmente operativa** |
| Zalando | ⛔ 403 (hoy; la investigación vio 200) | ✅ JSON-LD | Solo «Privé by Zalando» en Awin | **Solo enlaces** · Privé **pendiente de autorización** |
| ASOS | ⛔ conexión rechazada | ✅ JSON-LD | — | **Solo importación de enlaces** |
| Decathlon | ⛔ 403 (Cloudflare) | ✅ JSON-LD | **Awin ES 105405 activo** | **Solo enlaces** · feed **pendiente de autorización** |
| Nike | ✅ 200 JSON-LD | ✅ | Awin (programa UE) | **Parcialmente operativa** · feed **pendiente de autorización** |
| Adidas | ⛔ 403 | ✅ JSON-LD | **Awin ES 77008 activo** | **Solo enlaces** · feed **pendiente de autorización** |

Ninguna tienda está **operativa** (catálogo completo) porque ninguna ofrece hoy un catálogo con alta
autoservicio; las vías existentes requieren aprobación. La app lo muestra tal cual en
*Perfil → Integraciones* (`GET /v1/retailers`), y la sección Descubrir explica que no hay catálogo
autorizado conectado en lugar de inventar productos.

> **Nota legal pendiente**: la captura en dispositivo lee datos públicos de la página que el usuario está
> viendo, a petición suya, sin automatizar la navegación. Antes del lanzamiento comercial conviene una
> revisión jurídica de las condiciones de uso de cada web (véase la sección de riesgos de la
> investigación).

## Cómo pasar una tienda a «operativa»

| Vía | Qué se necesita | Configuración | Comando |
|---|---|---|---|
| Awin (Decathlon ES, adidas ES, Nike, Privé, JD Sports ES…) | Cuenta de publisher aprobada + aprobación de cada anunciante + clave de *Create-a-Feed* | `AWIN_PUBLISHER_ID`, `AWIN_PRODUCTDATA_API_KEY`, `AWIN_FEED_URLS=decathlon=<url-del-feed>,adidas=<url>` | `pnpm --filter @dressit/api catalog:ingest` |
| Rakuten (Mango) | Aprobación en el programa + acceso al catálogo | Adaptador de feed (mismo pipeline; mapear columnas en `catalog/providers.ts`) | ídem |
| Inditex | Acuerdo directo (el portal no está publicado) | `INDITEX_CLIENT_ID/SECRET` reservados; adaptador a implementar con la documentación oficial que proporcionen | — |
| eBay (segunda mano) | Licencia de producción de las Buy APIs vía eBay Partner Network | `EBAY_CLIENT_ID/SECRET`, `EBAY_EPN_CAMPAIGN_ID` | (adaptador pendiente) |

La ingesta (`scripts/ingest-feed.ts`): descarga el feed autorizado, normaliza (categoría, color,
materiales inferidos y marcados), guarda historial de precios y disponibilidad, imágenes con licencia,
enlaces de afiliado, desactiva productos que desaparecen del feed y calcula embeddings visuales con el
servicio de visión para la búsqueda por imagen. Tras una ingesta correcta la integración pasa a
`operational` y la tienda aparece como **Operativa**.

## Interfaz común de adaptadores

Cada proveedor implementa las mismas capacidades, declaradas en `retailer_integrations.capabilities`:

| Capacidad | Importación por enlace | Captura en dispositivo | Feed de afiliación | API oficial |
|---|---|---|---|---|
| Buscar productos | — | — | ✅ (catálogo local) | ✅ |
| Resolver enlaces | ✅ | ✅ | ✅ (por `product_url`) | ✅ |
| Detalles / variantes / tallas | ✅ JSON-LD | ✅ | ✅ | ✅ |
| Precio y disponibilidad | ✅ (en el momento) | ✅ | ✅ (por ingesta) | ✅ |
| Imágenes autorizadas | según `image_policy` | según `image_policy` | ✅ licencia del feed | ✅ |
| Enlace de compra | URL canónica | URL canónica | enlace de afiliado | ✅ |
| Estado de la integración | medido por `retailers:check` | — | `catalog_sync_runs` | — |

Código: `services/api/src/modules/retail/` (registro, extracción, importación) y
`services/api/src/modules/catalog/` (feeds, catálogo).

## Guía: añadir una tienda nueva

1. Añade la tienda a `RETAILERS` en `services/api/src/modules/retail/registry.ts` (id, nombre, grupo,
   dominios, web) con sus integraciones y una URL de producto pública en `TEST_URLS`.
2. Ejecuta `pnpm --filter @dressit/api retailers:check`: mide la importación por enlace y actualiza el
   estado y la evidencia. Si la página publica datos en un formato no cubierto, amplía
   `retail/extract.ts` con un test en `test/unit/extract.test.ts` (con un fixture sintético, nunca HTML
   copiado de la tienda).
3. Si hay feed de afiliación autorizado, añade el mapeo de columnas en `catalog/providers.ts` (test en
   `test/unit/parsers.test.ts`) y configúralo en `AWIN_FEED_URLS` o equivalente.
4. Revisa la política de imágenes y las condiciones del programa (p. ej. algunos prohíben apps móviles).

## Importación de compras anteriores

- **Tickets, facturas, capturas y etiquetas**: el texto se reconoce (OCR en el servicio de visión o en
  el dispositivo) y `POST /v1/imports/text` extrae tienda, número de pedido, fecha, líneas con
  referencia, EAN (validando el dígito de control), talla y precio, y enlaces de producto de tiendas
  conocidas para importarlos.
- **Correos de confirmación**: el usuario los comparte o pega (sin acceso a su buzón). La conexión OAuth
  a un buzón (p. ej. Gmail con alcance restringido) exige verificación de Google y consentimiento
  explícito: queda en el roadmap.
- **EAN**: se buscan en las variantes de catálogos autorizados; si no hay coincidencia se informa y se
  pide foto.
- Nunca se piden contraseñas de tiendas ni se automatizan cuentas privadas.
