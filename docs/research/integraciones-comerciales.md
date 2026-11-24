# Integraciones comerciales: vías legítimas de acceso a datos de producto (mercado español)

- **Fecha de la investigación:** 2026-11-24
- **Alcance:** 21 retailers (7 marcas Inditex, El Corte Inglés, Sfera, Mango, H&M, Uniqlo, Springfield, Cortefiel, Pedro del Hierro, Zalando, ASOS, Decathlon, Nike, adidas) + Awin + eBay Browse API + otras fuentes.
- **Actualización (mismo día):** la investigación de programas de afiliación por tienda, APIs de producto de las redes y proveedores multitienda, con la matriz vigente y los adaptadores implementados, está en [../comercios.md](../comercios.md); la guía de altas en [../conectar-tiendas.md](../conectar-tiendas.md).
- **Reglas seguidas:** solo documentación pública, páginas públicas de programas, `robots.txt`, sitemaps declarados en `robots.txt` y una ficha de producto ordinaria por retailer. No se usaron endpoints privados ni credenciales, no se resolvieron CAPTCHAs y no se intentó esquivar ningún muro antibots. Cuando el servidor devolvía 403 o un challenge, se ha anotado tal cual.

## Leyenda de fiabilidad

| Marca | Significado |
|---|---|
| **[V]** | Verificado directamente hoy (2026-11-24): página, documento o respuesta HTTP observada por mí. |
| **[S]** | Fuente secundaria: prensa, directorios de terceros, repositorios públicos de terceros, resúmenes de buscador. No confirmado en la fuente oficial. |
| **[?]** | Desconocido o no verificable con fuentes públicas. |

**Cómo se comprobó cada ficha de producto:**
1. **Servidor:** `curl` con un User-Agent genérico y honesto (`Mozilla/5.0 (compatible; generic-fetch/1.0)`), una petición por URL. Esto simula un importador server-side.
2. **Navegador:** navegador integrado (Chromium) navegando la página como un usuario normal, sin automatizar CAPTCHAs (no apareció ninguno). Después se leyeron con JavaScript los `<script type="application/ld+json">` y las etiquetas `og:*` del DOM ya renderizado.

---

## 1. Resumen ejecutivo

1. **Ningún retailer de la lista ofrece hoy una API pública de catálogo con alta autoservicio.** La única API de producto de un retailer documentada en algún momento es la de **Inditex** (Product Search y Visual Search en `developer.inditex.com`). Hoy el portal responde como *marketplace no publicado* [V] y solo se conoce por código de hackathons de 2025 [S]. No se puede contar con ella.
2. **La vía legítima realista para tener catálogo son las redes de afiliación.** En **Awin (ES)** hay programas activos de **adidas ES** y **Decathlon ES** [V], además de multimarca deportivos (JD Sports ES, Sprinter ES, Esdemarca ES, BSTN ES) [V]. **Mango** usa **Rakuten Advertising** [V]. **Nike** gestiona su programa de la UE con Awin, aunque la cobertura de España no está confirmada [V/S]. **El Corte Inglés ES** tiene su programa general de Awin **inactivo**; solo sigue activo *Ticketing El Corte Inglés ES* [V]. Para Inditex, H&M, Uniqlo, Tendam, Sfera, ASOS y Zalando (tienda principal) **no se encontró ningún programa de afiliación activo en España** con fuentes fiables.
3. **La importación de enlaces desde servidor solo funciona hoy en 5 de 21 retailers:** Springfield, Cortefiel, Pedro del Hierro (servido desde cortefiel.com), Zalando y Nike. Los cinco devuelven HTTP 200 con JSON-LD `Product`/`ProductGroup` completo [V]. El resto devuelve 403 (Akamai: Inditex, El Corte Inglés, H&M; WAF de adidas), 429 (checkpoint de Vercel en Mango), un challenge de Cloudflare (Decathlon) o agota el tiempo de conexión (Uniqlo, ASOS) [V].
4. **En navegador, todas las fichas exponen datos estructurados** [V]. Mango usa microdatos `itemprop` en lugar de JSON-LD. El resto usa JSON-LD `Product` o `ProductGroup` con precio en EUR. Para los retailers bloqueados en servidor, la importación tendría que leer la página **en el dispositivo del usuario** (webview o extensión para compartir) o caer en una entrada manual. Hay que validar esta opción en lo legal (ver Riesgos).
5. **eBay (EBAY_ES)** es una fuente legítima, pero **no es rápida**. El sandbox es autoservicio, pero producción de las Buy APIs exige una licencia adicional, una solicitud a eBay Partner Network, revisión y contrato [V]. Además, `search_by_image` **no está disponible en EBAY_ES** (solo US, DE, UK y AU) [V].
6. **Google no ofrece ninguna API de búsqueda de Shopping para terceros.** La Custom Search JSON API está cerrada a clientes nuevos y deja de funcionar el 2027-01-01 [S].

---

## 2. Matriz resumen

Estados propuestos:
- **Operativa**: catálogo o feed oficial accesible hoy sin aprobación previa. *Ningún retailer está en este estado.*
- **Parcialmente operativa**: la importación de enlaces funciona hoy desde servidor con datos estructurados, pero no hay catálogo oficial.
- **Solo importación de enlaces**: sin API ni feed accesibles. La importación depende de leer la página en el dispositivo del usuario o de la entrada manual, porque el servidor está bloqueado.
- **Pendiente de autorización**: existe una vía oficial (red de afiliación o API) que depende de que nos aprueben.

| Retailer | API oficial | Afiliación / red (ES) | Feed | robots.txt (UA `*`, ficha de producto) | JSON-LD observado (navegador) · acceso servidor | URL de prueba (ES) | Estado propuesto |
|---|---|---|---|---|---|---|---|
| Zara | API Inditex: portal no publicado [V]; existió en 2025 [S] | No hay programa abierto [S] | No [S] | Permitida (`/es/es/...-pNNN.html`) [V] | `ProductGroup` (20 variantes, EUR) · **403 Akamai** [V] | https://www.zara.com/es/es/cazadora-regular-fit-con-lana-p04517500.html | Solo importación de enlaces |
| Pull&Bear | Idem Inditex | No encontrada [?] | No [?] | Permitida `/es/` (bloquea `/es/en/`, `/es/ca/`) [V] | `Product` (29,99 EUR) · **403** [V] | https://www.pullandbear.com/es/chaqueta-doble-faz-l07720321 | Solo importación de enlaces |
| Bershka | Idem Inditex | No encontrada [?] | No [?] | Permitida (bloquea `/es/en/`) [V] | `Product` (59,99 EUR) · **403** [V] | https://www.bershka.com/es/cazadora-acolchada-capucha-c0p226931225.html | Solo importación de enlaces |
| Massimo Dutti | Idem Inditex | No encontrada [?] | No [?] | Muy permisivo [V] | `ProductGroup` (149 EUR) · **403** [V] | https://www.massimodutti.com/es/botin-plano-chelsea-piso-track-l11126650 | Solo importación de enlaces |
| Stradivarius | Idem Inditex | Un directorio de terceros cita un programa [S], sin confirmar | No [?] | Permitida [V] | `Product` (33,59 EUR) · **403** [V] | https://www.stradivarius.com/es/cazadora-oversize-efecto-piel-l08460705 | Solo importación de enlaces |
| Oysho | Idem Inditex | No encontrada [?] | No [?] | Permitida [V] | `Product` (19,99 EUR) · **403** [V] | https://www.oysho.com/es/camiseta-seamless-base-layers-l30216842 | Solo importación de enlaces |
| Lefties | Idem Inditex | No encontrada [?] | No [?] | Permitida [V] | `Product` (19,99 EUR) · **403** [V] | https://www.lefties.com/es/hombre/ropa/pantalones/pantal%C3%B3n-jogger-tailoring-c1030267575p753740600.html | Solo importación de enlaces |
| El Corte Inglés | No (solo API de marketplace para vendedores) [S] | Awin "El Corte Ingles ES" (13075): **cuenta inactiva** [V]; solo Ticketing ECI ES (13034) activo [V] | No (moda) [V] | Permitida; bloquea Amazonbot, Bytespider, etc. [V] | `ProductGroup` (5 variantes) · **403** [V] | https://www.elcorteingles.es/moda-hombre/A59419370-negro-pr-abrigo-tecnico-de-hombre-color-negro-cuello-desmontable/ | Solo importación de enlaces |
| Sfera | No [?] | Ninguna propia; se vende en elcorteingles.es [V] | No [?] | sfera.com no tiene robots.txt (404, selector de país); en España aplica el de ECI [V] | `ProductGroup` (39,99 EUR, marca Sfera) · **403** [V] | https://www.elcorteingles.es/moda-mujer/A202025114-vestido-print-flores/ | Solo importación de enlaces |
| Mango | No [?] | **Rakuten Advertising** (página oficial de afiliados) [V] | Rakuten ofrece Product Catalog por SFTP [S]; disponibilidad para Mango [?] | Permite `/p/`; `Disallow: /*.html`, `Crawl-delay: 0.2` [V] | **Sin JSON-LD**; microdatos `itemprop` (price 79.99, EUR) + OG [V] · **429 Vercel Security Checkpoint** [V] | https://shop.mango.com/es/es/p/mujer/abrigos/abrigos/abrigo-lana-cruzado-botones/47041448/56/00 | Pendiente de autorización |
| H&M | No (no hay portal público) [S] | Sin programa ES confirmado; no aparece en el directorio de Awin ES [V] | No [?] | Permitida (`/es_es/productpage.*.html`) [V] | `ProductGroup` (20 variantes, 19,99 EUR) · **403** [V] | https://www2.hm.com/es_es/productpage.1348073008.html | Solo importación de enlaces |
| Uniqlo | No [?] | Awin "Uniqlo" (6771): perfil **no activo** [V]; nada para ES | No [?] | Permitida (`/es/es/products/...`) [V] | `ProductGroup` (5 variantes) · **timeout/000** [V] | https://www.uniqlo.com/es/es/products/E422987-000/00 | Solo importación de enlaces |
| Springfield | No [?] | Solo en un directorio de terceros [S]; nada en Awin [V] | No [?] | Permitida (reglas SFCC) [V] | `Product` (39,99 EUR) · **200 OK con JSON-LD** [V] | https://myspringfield.com/es/es/hombre/cazadoras/chaqueta-softshell-capucha/0954304.html | Parcialmente operativa |
| Cortefiel | No [?] | No encontrada [V/?] | No [?] | Permitida [V] | `Product` (69,99 EUR) · **200 OK** [V] | https://cortefiel.com/es/es/mujer/abrigos/gabardina-satinada-capucha-desmontable/6614836.html | Parcialmente operativa |
| Pedro del Hierro | No [?] | No encontrada [?] | No [?] | pedrodelhierro.com redirige a intl.cortefiel.com; el catálogo ES está en cortefiel.com (robots de Cortefiel) [V] | `Product` (brand "Pedro del Hierro", 44,95 EUR) · **200 OK** [V] | https://cortefiel.com/es/es/hombre/camisas/camisa-cuadro-melange/1844322.html | Parcialmente operativa |
| Zalando | No para terceros (zDirect es para partners/vendedores) [S] | Solo "Privé by Zalando ES" en Awin (15573) [V]; zalando.es principal no encontrado | No (tienda principal) [?] | Permite fichas `.html`; bloquea `/api/*` y otros [V] | `ProductGroup` (6 variantes, 39,99 EUR) · **200 OK** [V] | https://www.zalando.es/jack-and-jones-jjgalaxy-puffer-chaqueta-de-invierno-sky-captain-ja222t28r-k11.html | Parcialmente operativa |
| ASOS | No [?] | Sin programa ES confirmado (directorios citan Rakuten) [S]; no aparece en Awin ES [V] | [?] | Permitida (`/prd/`) [V] | `ProductGroup` (4 variantes, 39,99 EUR) · **timeout/000** [V] | https://www.asos.com/es/asos-design/asos-design-sudadera-con-capucha-con-detalle-de-nudo-y-cintura-ajustada-en-gris-antracita/prd/212100190 | Solo importación de enlaces |
| Decathlon | No para catálogo ES (portal de developers no responde) [V/S] | **Awin "Decathlon ES" (105405), activo**, 3 %, admite comparadores [V] | Posible vía Create-a-Feed; no visible sin login [?] | Permitida `/es/p/`; bloquea `/api/*`; `ClaudeBot` con `Crawl-delay: 5` [V] | `ProductGroup` + `Product` · **403 challenge de Cloudflare** [V] | https://www.decathlon.es/es/p/camiseta-running-transpirable-mujer-kiprun-skincare-negro/100155/c382m8548024 | Pendiente de autorización |
| Nike | No [S] | Programa UE vía Awin (la página FI enlaza a global-nike@awin.com) [V]; cobertura ES no confirmada; un directorio da Nike ES por cerrado [S] | La página FI menciona "automated product feed" [V] | Permite `/es/t/` (bloquea `*/p/`) [V] | `ProductGroup` con variantes (127,99 EUR) · **200 OK** [V] | https://www.nike.com/es/t/24-7-impossiblysoft-plush-chaqueta-therma-fit-hombre-Hd8aZX3i | Parcialmente operativa (catálogo: pendiente de autorización) |
| adidas | No (portal de developers retirado) [S] | **Awin "adidas ES" (77008), activo**, cookie de 30 días [V] | Posible vía Create-a-Feed; no visible sin login [?] | Permite fichas `/slug/ID.html`; bloquea `/api/*`, `/search?*` y algunos slugs de categoría [V] | `ProductGroup` (10 variantes) · **403 WAF** [V] | https://www.adidas.es/sudadera-trefoil-essentials-crew/KS8921.html | Pendiente de autorización |
| eBay (EBAY_ES) | **Browse API** (producción requiere licencia y aprobación) [V] | eBay Partner Network (ebay.es participa) [V] | Feed API (Buy) con licencia [V] | n/a | n/a | n/a | Pendiente de autorización |

---

## 3. Inditex: "Inditex Open Platform" y developer.inditex.com

### 3.1 Qué hay hoy [V]
- `https://developer.inditex.com/` responde **302** a `https://developer.inditex.com/apimktplc/web/` ("apimktplc" = API marketplace). Es una SPA (Angular/Swagger/Monaco) servida tras Akamai.
- Al cargar, la SPA hace `POST /apimktplc/api/apimktplbk/public/marketplaces/resolve`. Esa llamada devuelve **404** y la app redirige a `/apimktplc/web/unpublished-marketplace`, que muestra "AN ERROR OCCURRED / SOMETHING WENT WRONG". Lo observé en el navegador el 2026-11-24 y se repitió al recargar.
- Las URLs de documentación que citan los proyectos de 2025 **redirigen hoy a la misma página de error**: `.../products/pubapimkt/protocols/REST/apis/visual-search/overview` y `.../apimktplc/web/legal`. No hay copias en Wayback Machine (la API `archive.org/wayback/available` devuelve `archived_snapshots: {}`).
- `https://opensource.inditex.com/en/` y `https://github.com/InditexTech` (47 repos) solo contienen software open source (Weave.js, Kumoss, Cerbia, operadores de Kubernetes, servidores MCP...). **Ninguna API de catálogo.**
- "Inditex Open Platform (IOP)" es, según la prensa, la **plataforma tecnológica interna** del grupo, no un programa para terceros [S] (Modaes; post de InditexTech en Medium).

### 3.2 Qué existió en 2025, según código de terceros [S]
Proyectos de **HackUDC 2025** (febrero de 2025), **HackUPC 2025** (mayo de 2025) y un taller "boost-2025" enlazan a la documentación anterior y la usan:

| Aspecto | Lo que muestran los repositorios públicos (no verificado en documentación oficial) |
|---|---|
| APIs | **Product Search** y **Visual Search** ("Inditex Tech APIs", producto `pubapimkt`) |
| Autenticación | OAuth 2.0 **client credentials** con HTTP Basic (client_id:client_secret). Token endpoint: `https://auth.inditex.com:443/openam/oauth2/itxid/itxidmp/access_token` (también aparece una variante `.../itxidmp/sandbox/access_token`). Scope: `technology.catalog.read`. El cliente usa el campo `id_token` de la respuesta como `Bearer`; `expires_in` era de 3600 s en un ejemplo. |
| Product Search | `GET https://api.inditex.com/searchpmpa/products?query=<texto>&brand=<marca>&page=<n>&perPage=<n>` |
| Visual Search | `GET https://api.inditex.com/pubvsearch/products?image=<URL pública de imagen>&page=<n>&perPage=<n>` (la imagen se pasa como URL, no como binario) |
| Respuesta | Array de productos con `id`, `name`, `price.currency`, `price.value.current`, `price.value.original`, `link`, `brand`. **No está confirmado que incluya imágenes.** Varios clientes descargaban la página del producto para obtenerlas. |
| Marcas | Se mencionan zara, pull&bear y massimo dutti como valores de `brand`; otros proyectos citan "Zara, Massimo Dutti, etc." **Lista completa y mercados: [?]** |
| Alta | Las credenciales se repartían a los participantes de los hackathons. **No hay evidencia pública de alta autoservicio** para terceros comerciales. [?] |
| Rate limits | [?] (no documentados en fuentes accesibles) |
| Términos de uso | Existían en `https://developer.inditex.com/apimktplc/web/legal`, hoy inaccesible. **Contenido [?].** |

### 3.3 Conclusión sobre Inditex
- **No hay hoy una API de Inditex utilizable por DressIt.** El portal está despublicado y los términos no se pueden consultar. Tampoco consta que existiera una vía comercial de alta.
- **Aviso:** algunos repositorios públicos de hackathon contienen client_id y client_secret en claro. **Usarlos no es legítimo**: son credenciales emitidas a terceros, con términos desconocidos. No deben usarse ni copiarse.
- Siguiente paso posible: contacto institucional con Inditex (no hay canal público para la API; `oso@inditex.com` es la oficina de open source y no tiene relación con la API). Hasta entonces, Inditex queda en **solo importación de enlaces** y, por los 403 de Akamai, la página tendría que leerse **en el dispositivo del usuario**.

---

## 4. Detalle por retailer

> Notas sobre robots.txt: solo se resumen las reglas del grupo `User-agent: *` que afectan a una petición de una sola ficha de producto. En Inditex, ECI, Mango, H&M y adidas **el propio robots.txt devuelve 403 a clientes que no son navegador**, así que se leyó desde el navegador.

### 4.1 Zara
- **API:** ver §3. **Afiliación:** sin programa abierto. Hay un "Zara Ambassador Program" por invitación (acuerdo con ITX UK Ltd) [S].
- **robots.txt [V]:** un solo grupo `*` con 79 reglas. Bloquea `/*/shop/`, `/share/`, `*/availability`, `*?ref=`, `*?color=`, `/?*`, tiendas de prueba (`/xa/`...), etc. Las fichas `/es/es/<slug>-p<8 dígitos>.html` no están bloqueadas. Sitemap: `https://www.zara.com/sitemaps/sitemap-index.xml.gz`.
- **Ficha [V]:** JSON-LD `ProductGroup` (marca ZARA, 20 variantes, 149 EUR, imagen en static.zara.net) + `og:type=product`. Servidor: **403 Access Denied (Akamai)**.

### 4.2 Pull&Bear · Bershka · Massimo Dutti · Stradivarius · Oysho · Lefties
- **robots.txt [V]:**
  - **Pull&Bear:** fichas `/es/<slug>-lNNNNNNNN` permitidas. Bloquea `/es/en/*`, `/es/ca/*`, `/partnerships*` y bloquea por completo a 27 agentes nombrados (HTTrack, libwww, "Fetch", MJ12bot...).
  - **Bershka:** bloquea `/es/en/`, `/*?query=*`, `/webapp/wcs/stores/*/ProductPage*` y fichas de algunos países (`/az/*-c0*p*.html`...), pero no las de España.
  - **Massimo Dutti:** muy permisivo (`*itxSeo=*`, tiendas de prueba y páginas `webapp`). `proximic` tiene prohibido `/itxrest`.
  - **Stradivarius:** bloquea `/webapp/wcs/stores/servlet/product*` y `/ww/es/`.
  - **Oysho:** bloquea `/webapp/wcs/stores/*/ProductPage`.
  - **Lefties:** bloquea `/*/payment.html`.
  - Todos publican sitemaps de producto por país (`.../sitemap-products-XX-es-0.xml.gz`).
- **Fichas [V]:** P&B, Bershka, Stradivarius, Oysho y Lefties exponen JSON-LD `Product` con `offers.price` y `priceCurrency=EUR`. Massimo Dutti expone `ProductGroup`. Todas tienen OG (`og:type=website`). **Servidor: 403 en todas.**
- **Afiliación:** no se encontró ningún programa activo en España [?]. Un directorio de terceros cita uno de Stradivarius sin más detalle [S].

### 4.3 El Corte Inglés
- **API:** no hay API pública de catálogo. Existe la API del marketplace para vendedores [S].
- **Afiliación [V]:** el perfil de Awin `merchant-profile/13075` ("El Corte Ingles ES") muestra "The account you are trying to view is not active". El directorio de Awin ES solo devuelve "Ticketing El Corte Inglés ES (P)" (13034). Tradedoubler tiene "Viajes El Corte Inglés" (260156) [S], fuera de moda. Las condiciones del programa general que aparecen en buscadores (sin cashback, sin viajes ni supermercado, validación a 60 días) son de cuando estaba activo [S].
- **robots.txt [V]:** las fichas `/moda-*/A<id>-.../` están permitidas. Bloquea búsqueda, carrito, checkout, filtros (`*brand::*`...) y por completo a MJ12bot, DotBot, BLEXBot, Amazonbot y Bytespider.
- **Ficha [V]:** JSON-LD `ProductGroup` + `MerchantReturnPolicy` + `BreadcrumbList`, OG con imagen `dam.elcorteingles.es`. Servidor: **403**.

### 4.4 Sfera
- `https://www.sfera.com/` es un **selector de país** y su `robots.txt` devuelve 404 [V]. En España la marca se vende dentro de elcorteingles.es (`/sfera/moda/` redirige a `/marcas/sfera/`) [V]. Datos estructurados, robots y bloqueo de servidor son los de ECI. JSON-LD con `brand: "Sfera"` [V].
- Afiliación: no existe ninguna propia [?]. El programa general de ECI en Awin está inactivo [V].

### 4.5 Mango
- **Afiliación [V]:** `https://shop.mango.com/es/es/affiliate` dice que el programa forma parte de su "red exclusiva en Rakuten". El botón "APLICAR" lleva al alta de publishers de **Rakuten Advertising**. Busca medios y blogs de moda con tráfico relevante y creadores afines a la marca.
- **Feed:** Rakuten Advertising tiene un programa "Product Catalog" que se descarga por SFTP en XML o texto delimitado por `|` [S]. **Que Mango ofrezca catálogo a publishers en ES: [?]**.
- **robots.txt [V]:** `Disallow: /*.html` (URLs antiguas), `/*/search*`, filtros (`size=`, `min=`...), `/*fashion-assistant` y `Crawl-delay: 0.2`. Las fichas `/es/es/p/...` están permitidas. Sitemap índice: `https://shop.mango.com/sitemap.xml`.
- **Ficha [V]:** **sin JSON-LD**. Usa microdatos schema.org (`itemprop`: `mpn`, `name`, `image`, `offers`, `price=79.99`, `priceCurrency=EUR`) + OG (title, image, description; `og:type=article`). Servidor: **429 "Vercel Security Checkpoint"**.

### 4.6 H&M
- **API:** no hay portal de developers público [S]. **Afiliación:** directorios citan Awin, CJ, Rakuten o Admitad según la región [S]. En el directorio de Awin ES **no aparece** [V]. Para España: [?].
- **robots.txt [V]:** `/es_es/productpage.<id>.html` permitido. Bloquea `/*.product-article-`, `*/resell/productpage/`, `*/search-results.html*`. Bloquea por completo a Baiduspider, Yeti, Daumoa y PetalBot.
- **Ficha [V]:** JSON-LD `ProductGroup` (20 variantes, 19,99 EUR) + OG. Servidor: **403**.

### 4.7 Uniqlo
- **Afiliación:** el perfil de Awin 6771 ("Uniqlo Affiliate Programme") **no está activo** [V]. Sin programa ES conocido [?].
- **robots.txt [V]:** fichas `/es/es/products/<id>/<n>` permitidas. Bloquea parámetros de filtro, `/*/*/products/*/products-in-image` y `/*/*/cart`.
- **Ficha [V]:** JSON-LD `ProductGroup` + `MerchantReturnPolicy`. Servidor: **sin respuesta (timeout, código 000)**.

### 4.8 Springfield · Cortefiel · Pedro del Hierro (Tendam)
- **API:** no [?]. **Afiliación:** no aparecen en el directorio de Awin ES [V]. Solo un agregador lista "myspringfield affiliate program" sin fuente oficial [S].
- **robots.txt [V]:** plantilla de Salesforce Commerce Cloud. Bloquea `/on/demandware*` (salvo estáticos y sitemaps), cuenta, carrito, búsqueda y parámetros de filtro. Las fichas `.../<id>.html` están permitidas. Declara sitemaps por país (`es_ES`) con productos e imágenes.
- **Pedro del Hierro [V]:** `pedrodelhierro.com` redirige (302) a `intl.cortefiel.com/?c=..` tanto desde `curl` como desde el navegador. El catálogo español de PdH está **dentro de cortefiel.com** (`/es/es/marcas/pedro-del-hierro/...`) y el JSON-LD declara `brand: "Pedro del Hierro"`.
- **Fichas [V]:** **HTTP 200 desde servidor**, con JSON-LD `Product` (name, brand, sku, image, `offers.price`, `priceCurrency=EUR`, `availability=InStock`), `link rel=canonical` y OG `og:type=product`. **Ojo:** `og:price:amount` viene como `0.0` (erróneo). Hay que leer el precio del JSON-LD.

### 4.9 Zalando
- **API:** las APIs de Zalando (zDirect, `developers.merchants.zalando.com`) son para partners que venden en Zalando, no para leer catálogo [S]. **Afiliación:** en Awin ES solo aparece **"Privé by Zalando ES" (15573)** [V]. No se encontró un programa para zalando.es principal [?].
- **robots.txt [V]:** sin línea `Sitemap`. Bloquea `/api/*` (salvo `/api/navigation` y `/api/graphql/`), `/*&*&*&*`, `/cart/*`, `/wardrobe/*`, `/myaccount/*`, `/reco-catalog/`, `/assistant`. Las fichas `<slug>-<sku>.html` están permitidas.
- **Ficha [V]:** **HTTP 200 desde servidor** con JSON-LD `ProductGroup` (6 variantes, `offers` por talla, 39,99 EUR, imágenes `img01.ztat.net`) y OG `zalando_sharing:product`.

### 4.10 ASOS
- **Afiliación:** directorios de terceros citan Rakuten para ASOS Spain [S] y, en el pasado, Awin (UK, por invitación) [S]. No aparece en el directorio de Awin ES [V]. Estado en España: [?].
- **robots.txt [V]:** permisivo (`*/web/pages/*`, `*/shared-board/*`, `*/Prod/*`, `*scrollTo=`). Declara sitemaps ES (`/es/product-sitemap-index-ES.xml`).
- **Ficha [V]:** JSON-LD `ProductGroup` (4 variantes, 39,99 EUR) + OG `og:type=product`. Los productos antiguos pueden traer la imagen "missing". Servidor: **timeout (000)**.

### 4.11 Decathlon
- **Afiliación [V]:** Awin **"Decathlon ES" (105405)**. Comisión estándar del 3 %; cookie de 1 día (generalistas) o 7 días (especialistas en deporte); validación a 30 días. Admite **comparadores de precios**, contenido editorial, cashback y ofertas. No comisiona marketplace, servicios, segunda vida ni productos personalizables. Prohíbe "modificar o distorsionar" los elementos gráficos de la marca.
- **Feed:** el perfil público no lo dice [?]. Se ve en Create-a-Feed una vez dado de alta.
- **API:** `developers.decathlon.com` no responde (DNS o conexión) [V]. Fuentes de terceros mencionan una API de catálogo con clave [S].
- **robots.txt [V]:** `/es/p/...` permitido. Bloquea `/api/*`, `/*/checkout/`, `*/search?Ntt=*` y combinaciones de filtros. `ClaudeBot` tiene `Crawl-delay: 5`. Sitemaps de producto: `/decathlon-products-index.xml` y `/marketplace-products-index.xml`.
- **Ficha [V]:** JSON-LD `ProductGroup` + `Product` + `BreadcrumbList`. Sin etiquetas OG detectadas. Servidor: **403 "Just a moment..." (Cloudflare)**.

### 4.12 Nike
- **Afiliación [V/S]:** la página de ayuda de la UE (`nike.com/fi/help/a/nike-affiliate-programme`) describe el programa: hasta un 11 % de comisión, cookie de 30 días y "automated product feed". Su botón "Apply Now" es `mailto:global-nike@awin.com`, así que la red es Awin [V]. La ayuda equivalente en `/es/` no contiene el artículo [V]. No aparece "Nike ES" en el directorio de Awin ES [V], y un directorio de terceros da Nike ES por cerrado [S]. **Para España: [?].**
- **robots.txt [V]:** "just crawl it". Bloquea `*/p/`, `*/checkout/`, `*/member/...`. Las fichas `/es/t/<slug>-<id>` están permitidas. Sitemap ES de fichas: `https://www.nike.com/sitemap-v2-pdp-es-es.xml`.
- **Ficha [V]:** **HTTP 200 desde servidor**, JSON-LD `ProductGroup` con `hasVariant[]`, cada variante con `offers.price` (127,99 EUR) e imagen. OG `og:locale=es_ES`.

### 4.13 adidas
- **Afiliación [V]:** Awin **"adidas ES" (77008)**, cookie de 30 días. Busca creadores, blogs, plataformas de moda y lifestyle, portales de compra (sin CSS), cashback y medios editoriales.
- **API:** el portal `developer.adidas.com` está retirado [S].
- **robots.txt [V]:** las fichas `/<slug>/<ID>.html` están permitidas. Bloquea `/api/*` (varias rutas), `/search?*`, `/on/demandware.store/...`, `/*|*` y algunas categorías (`/*zapatillas_running*`, `/*botas_de_futbol*`...). Bloquea por completo a Baiduspider.
- **Ficha [V]:** JSON-LD `ProductGroup` (10 variantes) + `OnlineStore` + OG. Servidor: **403 (página de failover del WAF)**.

---

## 5. Awin

### 5.1 Alta como publisher
- **Formulario para España [V]:** `https://ui.awin.com/publisher-signup/es/awin/`. La URL figura en las *Condiciones generales de los afiliados* de Awin AG (versión de agosto de 2025, en español).
- **Depósito [V]:** las condiciones en español exigen un "pequeño depósito (el 'Depósito de suscripción')", que se devuelve con el primer abono de comisiones (cláusula 7.1). **Importe:** 1 EUR/GBP/USD según una página de ayuda reciente [S]; la página de cumplimiento de 2019 hablaba de 5 £ [V, posiblemente desactualizada].
- **Revisión [V, página de 2019]:** revisión manual con verificación de identidad. Hay que describir los espacios promocionales (URLs y redes) y cómo se promociona. Objetivo de respuesta: 24 h laborables.
- **Después del alta:** hay que solicitar cada programa de anunciante. Con *soft membership* se pueden descargar feeds de anunciantes con auto-join antes de estar aceptado, y las ventas cuentan [V, FAQ de publishers].
- **Apps:** cada programa decide qué tipos de partner y espacios acepta. Ejemplo: Desigual ES en Tradedoubler prohíbe expresamente "mobile apps". Hay que revisarlo programa a programa antes de presentar DressIt como app.

### 5.2 Descarga de feeds

**a) Lista de feeds (recomendado por Awin) [V]**
```
https://ui.awin.com/productdata-darwin-download/publisher/{publisherId}/{datafeedsApiKey}/1/feedList
```
- `datafeedsApiKey` es la **clave de feeds**. Se obtiene creando un feed en *Toolbox > Create-a-Feed* y copiando lo que va tras `apikey/` en el enlace. **No es la clave de la Publisher API.**
- El CSV trae una fila por feed con: `Advertiser ID, Advertiser Name, Primary Region, Membership Status, Datafeed Format (Awin|Google), Feed ID, Feed Name, Language, Vertical, Last Imported, Last Checked, No of products, URL`. El campo URL empieza por `https://productdata.awin.com/datafeed/download/apikey/…`.
- Awin recomienda un cron con espera aleatoria de 10 s a 2 min, descargar la lista, comparar `Last Imported` y bajar el feed solo si ha cambiado.

**b) Feed "Legacy" (formato Awin) vía Create-a-Feed**
- Patrón generado por la UI. Awin solo lo muestra truncado [V]; la forma completa sale de ejemplos públicos [S]:
```
https://productdata.awin.com/datafeed/download/apikey/{FEED_KEY}/language/{es}/fid/{feedId[,feedId...]}/rid/0/hasEnhancedFeeds/0/columns/{col1,col2,...}/format/csv/delimiter/%2C/compression/gzip/adultcontent/1/
```
- Autenticación: la clave de feeds va en la ruta. Formatos [V]: **CSV** (UTF-8, comillas dobles si hace falta) y **CSV for Excel** (UTF-8 con BOM). Delimitador y compresión a elegir; los ejemplos usan `%2C` y `gzip`. XML con DTD 1.4/1.5 en documentación antigua [S].
- **Columnas de descarga para publishers.** Las que solo existen para publishers están [V] en el PDF oficial de columnas; la lista completa procede de URLs públicas de ejemplo [S]:
  - Identificación: `aw_product_id`, `merchant_product_id`, `data_feed_id`, `merchant_id`, `merchant_name`, `ean`, `product_GTIN`, `mpn`, `upc`, `isbn`, `model_number`, `parent_product_id`
  - Enlaces: `aw_deep_link` (enlace trackeado, solo publisher), `merchant_deep_link`, `basket_link`
  - Texto: `product_name`, `description`, `product_short_description`, `specifications`, `keywords`, `promotional_text`, `brand_name`, `brand_id`, `colour`, `condition`, `product_type`, `language`
  - Categoría: `merchant_category`, `merchant_product_category_path`, `merchant_product_second_category`, `merchant_product_third_category`, `category_name`, `category_id` (las dos últimas solo en UK, US, CA e IE)
  - Precio: `search_price`, `store_price`, `display_price`, `rrp_price`, `product_price_old`, `saving`, `savings_percent`, `base_price`, `base_price_amount`, `base_price_text`, `currency`, `delivery_cost`
  - Imágenes: `merchant_image_url`, `large_image`, `alternate_image`, `alternate_image_two`, `alternate_image_three`, `alternate_image_four`, `merchant_thumb_url`, `aw_image_url` y `aw_thumb_url` (caché de Awin de 200×200 y 70×70, **solo UK, IE, CA y US**: en España hay que usar `merchant_image_url`)
  - Stock: `in_stock`, `stock_quantity`, `stock_status`, `size_stock_status`, `size_stock_amount`, `is_for_sale`, `pre_order`, `web_offer`, `valid_from`, `valid_to`, `last_updated`
  - Vertical moda: `Fashion:suitable_for`, `Fashion:size`, `Fashion:material`, `Fashion:pattern`, `Fashion:swatch`, `Fashion:category`
- Columna vacía significa que el anunciante no aporta ese dato [V].

**c) Feed "Enhanced" (formato Google) vía API [V]**
```
GET https://api.awin.com/publishers/{PUBLISHER_ID}/awinfeeds/download/{ADVERTISER_ID}-retail-{LOCALE}.jsonl
Authorization: Bearer <token de la API de Awin>
```
- `VERTICAL` solo admite `retail`. `LOCALE` acepta combinaciones del tipo `es_ES`.
- Respuesta en JSON Lines. **Hay que revisar la última línea**: si es un objeto `error`, la descarga quedó incompleta.
- Límites: **como máximo 5 peticiones por minuto** y ninguna concurrente sobre el mismo feed de anunciante.
- Campos de la especificación de Google: `id`, `title`, `description`, `link`, `image_link`, `additional_image_link`, `price`, `sale_price`, `availability`, `brand`, `gtin`, `mpn`, `color`, `size`, `material`, `gender`, `age_group`, `item_group_id`, `google_product_category`, `product_type`...

### 5.3 Términos sobre imágenes y precios [V salvo indicación]
- **Licencia (cl. 10.1 de las condiciones ES y UK de Awin AG):** licencia revocable, no exclusiva y limitada a la participación en el programa para "publicar los Materiales del Anunciante, **sin modificación**", en los espacios promocionales y para promocionar al anunciante según el programa. Los "Materiales del Anunciante" incluyen expresamente **imágenes y datos**.
  - Consecuencia: recortar fondos, generar try-on o editar las fotos con IA **no está cubierto** sin permiso del anunciante.
- **Reproducción fiel (cl. 9.2.11):** los materiales "se reproducirán fielmente y con precisión".
- **Uso de datos (cl. 10.7):** la información y los datos obtenidos de la red solo pueden usarse para los fines del acuerdo. Hay riesgo si se usan los feeds para entrenar modelos o para funciones ajenas a promocionar al anunciante.
- **Frescura:** las condiciones estándar **no fijan un plazo concreto** [V, según lo revisado de las cl. 9 y 10]. La práctica recomendada por Awin es vigilar `Last Imported` y bajar el feed cuando cambie. Los anunciantes suelen actualizar varias veces al día [S]. Cada programa puede añadir reglas, y la normativa de consumo exige no mostrar precios engañosos. **Recomendación:** refresco al menos diario y mostrar "precio a fecha/hora X; confirma en la tienda".
- **Imágenes:** usar `merchant_image_url` (CDN del anunciante). El servicio de caché y redimensionado de Awin (`aw_image_url`) no está disponible en España.

---

## 6. eBay Browse API (EBAY_ES) y eBay Partner Network

### 6.1 Acceso [V]
- **Autoservicio:** cuenta de eBay + cuenta del eBay Developers Program, con *keyset* inmediato. **Sandbox:** las Buy APIs están abiertas a cualquier developer (salvo checkout).
- **Producción:** la tabla de límites marca las Buy APIs, Browse incluida, con "\* Buy APIs require an additional license". La guía de requisitos dice que muchas Buy APIs son *Limited Release* y que su uso en producción "is intended for eBay partners only". El proceso:
  1. Alta en **eBay Partner Network (EPN)**.
  2. Formulario *Buy API Application*, con mocks y flujos de datos.
  3. Respuesta de EPN en un plazo de hasta 10 días hábiles.
  4. Ticket a Developer Support para revisión de cumplimiento.
  5. **Contratos firmados**, y entonces se habilita producción. La aprobación **no está garantizada**.
- **Límite por defecto:** Browse API, 5.000 llamadas/día. Se puede ampliar con el *Application Growth Check*.

### 6.2 Endpoints [V]
- `GET https://api.ebay.com/buy/browse/v1/item_summary/search`
  - Parámetros: `q`, `category_ids`, `filter`, `aspect_filter`, `epid`, `gtin`, `charity_ids`, `fieldgroups`, `limit`, `offset`, `sort`. Máximo 10.000 ítems por búsqueda.
- `POST https://api.ebay.com/buy/browse/v1/item_summary/search_by_image`
  - Cuerpo: `{ "image": "<Base64>" }`, con los mismos filtros.
  - **Solo en los marketplaces US, DE, UK y AU. NO en EBAY_ES** (nota de "Buy API Support by Marketplace").
- `GET /buy/browse/v1/item/{item_id}`, `get_items_by_item_group` y otros.
- **Cabeceras:**
  - `Authorization: Bearer <application token>`: grant *client credentials* con scope `https://api.ebay.com/oauth/api_scope`.
  - `X-EBAY-C-MARKETPLACE-ID: EBAY_ES`.
  - `X-EBAY-C-ENDUSERCTX`: contexto de afiliado EPN.
  - `Accept-Language`.
- EBAY_ES admite los recursos `item_summary` e `item` de Browse [V].
- **Afiliación:** para cobrar comisión hay que redirigir al comprador con `itemAffiliateWebUrl`. El acuerdo de EPN incluye **España (www.ebay.es)** como sitio participante [V].

### 6.3 Reglas de visualización [V]
- **API License Agreement:** la información de un anuncio mostrada no puede tener **más de 6 horas de antigüedad** respecto a ebay.es, y el resto de contenido de eBay no más de 24 h. Si no es así, hay que indicar en la app cuánto más antigua es.
- La misma licencia prohíbe usar el contenido de eBay para sugerir o modelar precios de artículos listados en eBay.
- Para flujos con checkout, eBay exige mostrar imágenes de eBay (`image.imageUrl`), título, precio, envío por separado, vendedor y condición (indicar si no es nuevo).
- **EPN:** el material promocional que entrega EPN no se puede modificar sin aprobación (por ejemplo, quitar marcas de agua a imágenes).

### 6.4 Valoración
- **Es legítima, pero no es rápida:** el sandbox es inmediato, mientras que producción depende de la aprobación de EPN, de una revisión y de un contrato. Hay que contar con semanas y la aprobación no está garantizada.
- **Encaje con DressIt:** limitado. El inventario de moda de ebay.es es sobre todo de vendedores particulares y profesionales, y de segunda mano. No hay búsqueda visual en ES, y la regla de 6 h obliga a refrescar con frecuencia (con 5.000 llamadas/día por defecto).

---

## 7. Otras fuentes legítimas para España

| Fuente | Qué es | Estado o verificación |
|---|---|---|
| **Awin ES: otros anunciantes de moda y deporte** | JD Sports ES (10121), Sprinter ES (27904), Esdemarca ES (28901), BSTN ES (104977), Antony Morato ES (43637), Bimbaylola_ES (129495), Fiorella Rubino ES (125052), Hardloop ES (129867), Bergfreunde ES (125904), Privé by Zalando ES (15573) | Aparecen en el directorio público de Awin ES [V]. Que tengan feed: [?] (solo visible con login) |
| **Tradedoubler Products API** | REST `GET http(s)://api.tradedoubler.com/1.0/products[.json|.xml]{claves}?token={token}`. Token "PRODUCTS" de la cuenta de publisher. Campos `productImage`, `price`, `productUrl` (trackeado) y `sourceProductUrl`. Máximo 1.000 productos por búsqueda; feeds "Unlimited" con 3 descargas por versión cada 24 h | Documentación oficial [V, vía WebFetch]. Anunciante ES de moda verificado: **Desigual ES (261390)**, 7,7 %, cookie de 1 día, **"mobile apps" prohibidas** [V] |
| **Rakuten Advertising** | Red de Mango. Product Catalog por SFTP en XML o texto `|` | [S]; requiere aprobación por anunciante |
| **CJ, Admitad, Webgains** | Redes con feeds o APIs de producto | No verificado para anunciantes de moda ES [?] |
| **Amazon (Creators API)** | Sustituye a PA-API 5.0 (Amazon la da por obsoleta; retirada anunciada para 2026). Requiere cuenta de Amazon Afiliados elegible y credenciales nuevas | [S]; requisitos para amazon.es sin verificar [?] |
| **eBay Browse API** | Ver §6 | [V] |

**Lo que NO está disponible (explícitamente):**
- **APIs públicas de catálogo** de Inditex (portal despublicado), El Corte Inglés, Mango, H&M, Uniqlo, Tendam, Zalando (las APIs zDirect son para vendedores), ASOS, Nike y adidas (portal retirado) [V/S].
- **Google:**
  - No existe una API de Google Shopping para consultar productos de terceros. Content API y Merchant API solo gestionan el catálogo propio del comerciante [S].
  - La **Custom Search JSON API** está cerrada a clientes nuevos y se discontinúa el **2027-01-01** [S]; su sucesor (Vertex AI Search) no indexa la web completa por defecto.
- **Búsqueda visual de eBay en España** (`search_by_image` no soporta EBAY_ES) [V].
- **Credenciales de la API de Inditex** publicadas en GitHub: existen, pero **no son una vía legítima**.

---

## 8. Riesgos

1. **Importación de enlaces bloqueada en servidor (alto):** 16 de 21 retailers devuelven 403, 429, un challenge o timeout a un User-Agent honesto. Cambiar el UA, rotar IPs o resolver challenges sería saltarse controles antibots, y queda descartado. **Alternativa:** leer la página en el dispositivo del usuario (webview, extensión para compartir o bookmarklet) a partir de una acción explícita suya, más un fallback manual (foto, nombre, precio).
2. **Condiciones de uso de cada web (alto, sin revisar):** no se han revisado las condiciones de uso de cada retailer. Es habitual que prohíban la extracción automatizada. Incluso una importación iniciada por el usuario necesita **revisión legal**.
3. **Derechos de imagen (alto):** las fotos de producto tienen derechos de autor. En afiliación, Awin solo licencia mostrarlas **sin modificación** y para promocionar al anunciante. Funciones de IA como quitar fondos, try-on o generar outfits con fotos del retailer requieren permiso expreso. Lo mismo aplica a imágenes importadas por enlace si se muestran fuera del uso privado del usuario.
4. **Precio y stock desactualizados (medio):** eBay exige un máximo de 6 h. En Awin no hay plazo fijo, pero la normativa de consumo y la de cada programa sí aplican. Algunos metadatos son poco fiables (Tendam publica `og:price:amount=0.0`).
5. **Admisión en programas (medio):**
   - Algunos programas excluyen apps o tipos de partner (Desigual: apps prohibidas).
   - Mango busca medios de moda con tráfico y creadores.
   - Decathlon paga un 3 % con cookie de 1 día para generalistas.
   - Antes de presentar DressIt como app hay que revisar caso por caso los tipos de partner permitidos.
6. **Inestabilidad de URLs (bajo/medio):**
   - Pedro del Hierro ya vive dentro de cortefiel.com.
   - Mango cambió el formato de sus URLs (`/p/.../ID/color/00`) y bloquea el antiguo `.html`.
   - El JSON-LD de Inditex lleva sufijos de temporada en el SKU (`-I2026`).
   - Conviene guardar la URL canónica (`link rel=canonical`) y el identificador de producto.
7. **Privacidad (medio):** si se usa la búsqueda visual de terceros (por ejemplo, eBay en otros mercados, o la de Inditex si volviera), la foto del usuario se envía fuera. Hace falta base legal (RGPD) y una política de privacidad que lo cubra.

---

## 9. Próximos pasos sugeridos (no ejecutados)
1. **Darse de alta en Awin** (formulario ES; depósito reembolsable) y solicitar **adidas ES** y **Decathlon ES**. Revisar en Create-a-Feed si tienen feed y en qué formato (Legacy o Enhanced).
2. **Escribir al equipo de afiliación de Nike en Awin** (`global-nike@awin.com`) para confirmar si España está cubierta.
3. **Solicitar Mango en Rakuten** y preguntar si hay catálogo de producto disponible.
4. **Implementar la importación de enlaces** con un parser JSON-LD `Product`/`ProductGroup` + `itemprop` (Mango) + OG como último recurso. Desde servidor solo funciona en Tendam, Zalando y Nike; para el resto, extraer en cliente tras validación legal.
5. **eBay:** solo si interesa la segunda mano. Abrir sandbox y solicitar EPN más la Buy API Application, sabiendo que no habrá búsqueda visual en ES.
6. **Inditex:** contacto institucional si el producto lo justifica. No usar credenciales filtradas.

---

## 10. Fuentes (todas consultadas el 2026-11-24)

### Inditex
- [V] https://developer.inditex.com/ (302 a `/apimktplc/web/`; la SPA llama a `/apimktplc/api/apimktplbk/public/marketplaces/resolve`, que devuelve 404, y acaba en `/apimktplc/web/unpublished-marketplace`)
- [V] https://developer.inditex.com/apimktplc/web/products/pubapimkt/protocols/REST/apis/visual-search/overview (redirige a unpublished-marketplace)
- [V] https://developer.inditex.com/apimktplc/web/legal (redirige a unpublished-marketplace)
- [V] https://archive.org/wayback/available?url=developer.inditex.com/apimktplc/web/legal (sin capturas)
- [V] https://opensource.inditex.com/en/
- [V] https://api.github.com/orgs/InditexTech/repos
- [S] https://github.com/api-evangelist/inditex
- [S] https://github.com/DisguisedPigeon/HackUDC2025 (creado 2025-02-21)
- [S] https://github.com/martindios/Pickture (README enlaza a la documentación de Visual Search y Product Search)
- [S] https://github.com/rgranadosd/visual-search-api
- [S] https://github.com/atckr/hackupc
- [S] https://github.com/Nols05/Lookas
- [S] https://github.com/danipvargas/Wearvana (enlaza los términos en `/apimktplc/web/legal`)
- [S] https://github.com/inditex-zboost/boost-2025
- [S, solo resultado de búsqueda] https://www.modaes.com/empresa/las-maquinitas-de-inditex-que-es-y-para-que-sirve-open-platform
- [S, solo resultado de búsqueda] https://medium.com/@InditexTech/how-inditex-is-adopting-microfrontends-for-future-proof-platform-development-bc402652a2ba

### Awin
- [V] https://help.awin.com/llms.txt
- [V] https://help.awin.com/developers/docs/downloading-a-list-of-your-product-feeds.md
- [V] https://help.awin.com/developers/docs/downloading-feeds-using-create-a-feed.md
- [V] https://help.awin.com/developers/docs/product-feed-publisher-guide-intro.md
- [V] https://help.awin.com/developers/docs/hosting-feeds.md
- [V] https://help.awin.com/developers/docs/faqs-for-publishers.md
- [V] https://help.awin.com/developers/docs/awin-resize-and-caching-service.md
- [V] https://help.awin.com/apidocs/retail-publisher-productapidocumentation-1.md
- [V] https://cdn.document360.io/ec9ead62-8ecc-46ef-aac7-9b0a9081b40b/Images/Documentation/PM-FeedColumnDescriptions(1).pdf (2017)
- [V] https://www.awin.com/docs.awin.com/Legal/Publisher+Terms/2025/ES_Awin-AG-Publisher-terms_August-2025.pdf
- [V] https://awin.com/docs.awin.com/Legal/Publisher+Terms/2025/UK_EN_Awin+AG+Publisher+terms_2025.pdf
- [V] https://www.awin.com/gb/compliance-and-regulations/application-process-and-joining-fee (2019)
- [S] https://success.awin.com/articles/en_US/Knowledge/Why-do-I-have-to-pay-the-sign-up-fee (401 al abrirla; contenido según buscador)
- [S] Patrón completo de URL de Create-a-Feed y lista de columnas, tomados de código público en GitHub (búsqueda de código `productdata.awin.com/datafeed/download/apikey`). Varios de esos repositorios exponen claves reales de feeds; no se citan ni se reproducen.
- [V] Directorio: https://www.awin.com/es/search/advertiser-directory (búsquedas: Mango, El Corte Ingles, Springfield, Cortefiel, Pedro del Hierro, Zalando, ASOS, Decathlon, Nike, adidas, Uniqlo, H&M, Sfera, Zara, Tendam, moda)
- [V] Perfiles:
  - https://ui.awin.com/merchant-profile/77008 (adidas ES)
  - https://ui.awin.com/merchant-profile/105405 (Decathlon ES)
  - https://ui.awin.com/merchant-profile/13075 (ECI ES, inactivo)
  - https://ui.awin.com/merchant-profile/6771 (Uniqlo, inactivo)
  - https://ui.awin.com/merchant-profile/13034 (Ticketing ECI ES)
  - https://ui.awin.com/merchant-profile/15573 (Privé by Zalando ES)

### eBay
- [V] https://developer.ebay.com/develop/api/buy/browse_api/item_summary/searchbyimage
- [V] https://developer.ebay.com/develop/api/buy/browse_api
- [V] https://developer.ebay.com/api-docs/buy/static/api-browse.html
- [V] https://developer.ebay.com/api-docs/buy/static/buy-requirements.html
- [V] https://developer.ebay.com/api-docs/buy/static/ref-marketplace-supported.html
- [V] https://developer.ebay.com/develop/api/buy/api_call_limits
- [V] https://developer.ebay.com/develop/apis/api-license-agreement
- [V] https://partnernetwork.ebay.com/page/network-agreement

### Programas de afiliación y otras redes
- [V] https://shop.mango.com/es/es/affiliate
- [V] https://www.nike.com/fi/help/a/nike-affiliate-programme
- [V] https://www.nike.com/es/help/a/nike-affiliate-programme (sin artículo)
- [V] https://dev.tradedoubler.com/products/publisher
- [V] https://directory.tradedoubler.com/en/programs/261390-Desigual-ES
- [S] https://directory.tradedoubler.com/de/programs/260156-VECI-ES-AFF-Viajes-el-corte-ingles
- [S] https://shopper.com/partnerships/myspringfield-com-affiliate-program
- [S] https://uppromote.com/affiliate-directory/zara/
- [S] https://ambassadors.zara.com/uk/terms
- [S] https://www.revshare.so/programs/advertiser/stradivarius-96f9c2ec
- [S] https://affi.io/m/asos
- [S] https://www.makeinfluence.com/en/academy/hms-affiliate-program-how-it-works-for-fashion-creators-and-publishers
- [S] https://pubhelp.rakutenadvertising.com/hc/en-us/article_attachments/22365119792013
- [S] https://developers.merchants.zalando.com/
- [S] https://apis.io/providers/adidas/
- [S] https://affiliate-program.amazon.com/creatorsapi/docs/en-us/paapiv5-deprecation
- [S] https://developers.google.com/custom-search/v1/overview
- [V] https://developers.decathlon.com/ (sin respuesta)

### robots.txt [V] (leídos con curl o, si había 403, desde el navegador)
- Inditex:
  - https://www.zara.com/robots.txt
  - https://www.pullandbear.com/robots.txt
  - https://www.bershka.com/robots.txt
  - https://www.massimodutti.com/robots.txt
  - https://www.stradivarius.com/robots.txt
  - https://www.oysho.com/robots.txt
  - https://www.lefties.com/robots.txt
- El Corte Inglés y Sfera:
  - https://www.elcorteingles.es/robots.txt
  - https://www.sfera.com/robots.txt (404)
- Mango, H&M y Uniqlo:
  - https://shop.mango.com/robots.txt
  - https://www2.hm.com/robots.txt
  - https://www.uniqlo.com/robots.txt
- Tendam:
  - https://myspringfield.com/robots.txt
  - https://cortefiel.com/robots.txt
  - https://pedrodelhierro.com/robots.txt
- Resto:
  - https://www.zalando.es/robots.txt
  - https://www.asos.com/robots.txt
  - https://www.decathlon.es/robots.txt
  - https://www.nike.com/robots.txt
  - https://www.adidas.es/robots.txt

### Sitemaps usados para localizar URLs de prueba [V]
- Inditex:
  - https://www.pullandbear.com/2/info/sitemaps/sitemap-products-pb-es-0.xml.gz
  - https://www.bershka.com/sitemap/productos/sitemap_productos_es-es_men-part0.xml.gz
  - https://www.massimodutti.com/3/info/sitemaps/sitemap-products-md-es-0.xml.gz
  - https://www.stradivarius.com/5/info/sitemaps/sitemap-products-st-es-0.xml.gz
  - https://www.oysho.com/6/info/sitemaps/sitemap-products-oy-es-0.xml.gz
  - https://www.lefties.com/9/info/sitemaps/sitemap-products-lf-es-0.xml.gz
- Mango, H&M, Uniqlo y ASOS:
  - https://shop.mango.com/sitemap-products/sitemap-products_es-es.xml
  - https://www2.hm.com/es_es.product.0.xml
  - https://www.uniqlo.com/es/es/sitemap_es-es_products.xml.gz
  - https://www.asos.com/es/product-sitemap-index-ES.xml
- adidas, Nike y Decathlon:
  - https://www.adidas.es/glass/sitemaps/adidas/ES/es/sitemaps/adidas-ES-es-es-product.xml
  - https://www.nike.com/sitemap-v2-pdp-es-es.xml
  - https://www.decathlon.es/sitemap/decathlon-products-0.xml
- Tendam:
  - https://myspringfield.com/on/demandware.store/Sites-SPF-Site/es_ES/SiteMapCustom-Google?name=sitemap_1-Products%2exml
  - https://cortefiel.com/on/demandware.store/Sites-CTF-Site/es_ES/SiteMapCustom-Google?name=sitemap_1-Products%2exml
- Para Zara, El Corte Inglés y Zalando la URL de prueba se tomó de una página de categoría pública.

### Fichas de producto comprobadas [V]
Las 21 URLs de prueba de la matriz (§2), comprobadas en navegador y con una petición de servidor cada una.
