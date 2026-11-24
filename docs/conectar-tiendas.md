# Conectar tiendas de forma oficial: guía paso a paso

Esta guía es para ti, como responsable de DressIt. Explica qué tienes que hacer **tú** (darte de alta,
solicitar programas, copiar claves) para que el catálogo de tiendas funcione por vías oficiales. El
código ya está preparado: en cuanto pegues las credenciales y te aprueben, basta con un comando.

> **Importante: nada funciona hasta que lleguen las aprobaciones.** Las redes de afiliación revisan tu
> alta y, después, **cada tienda** decide si te acepta. Mientras tanto la app lo muestra con honestidad
> en *Perfil → Integraciones* («Catálogo awin: pendiente de credenciales», etc.) y Descubrir explica que
> no hay catálogo autorizado conectado.

El orden de los pasos va de **más tiendas por menos esfuerzo** a menos. Detalle de cada tienda y
fuentes: [comercios.md](comercios.md).

---

## Paso 0. Prepara esto antes de solicitar nada

Las redes te lo van a pedir y las tiendas miran tu web antes de aceptarte.

1. **Una web pública de DressIt** (aunque sea sencilla) con:
   - qué es la app (armario digital + estilista + personal shopper para España);
   - cómo se muestran los productos (ficha con precio, enlace a la tienda **identificado como enlace de
     afiliado**, sin cupones ni cashback);
   - enlaces a App Store / Google Play si ya está publicada; si no, dilo con claridad («en beta»).
2. **Política de privacidad** publicada en una URL estable (por ejemplo `https://<tu-dominio>/privacidad`) y,
   si puedes, **aviso legal** y **condiciones de uso**. Debe mencionar los enlaces de afiliado y las cookies o
   identificadores de seguimiento de las redes.
3. **Un correo profesional** del dominio de la web (las redes desconfían de cuentas genéricas).
4. **Datos de la empresa o de autónomo**: razón social o nombre, NIF/CIF, dirección fiscal, y si tienes
   alta en IVA intracomunitario (ROI/VIES). Las redes los piden para pagarte y emitir autofacturas.
5. **Cuenta bancaria para cobrar**: la introduces **tú** directamente en el formulario de cada red.
6. Las redes con sede en EE. UU. (CJ, Rakuten) pueden pedirte un **formulario fiscal estadounidense para no
   residentes** (W-8BEN o W-8BEN-E). *No verificado en sus páginas públicas: síguelo si aparece en el alta.*
7. **Texto de presentación** (cópialo en cada alta y adáptalo):

   > DressIt es una app española de armario digital y personal shopper. Las usuarias registran su ropa
   > y la app les recomienda conjuntos según el tiempo y la ocasión. Cuando falta una prenda, la app
   > muestra productos de tiendas asociadas que combinan con lo que ya tienen, con precio actualizado y
   > un enlace a la tienda identificado como enlace de afiliado. No usamos cupones, cashback, pujas de
   > marca en buscadores (SEM), retargeting ni actividad CSS de Google Shopping. El orden de las
   > recomendaciones depende solo de la compatibilidad con el armario de la usuaria, nunca de la
   > comisión. Mercado: España. Espacio promocional: app iOS/Android y web <URL>.

   Si alguna parte no es cierta todavía (tráfico, app publicada…), **quítala**: mejor una solicitud honesta.

---

## Paso 1. Awin — el que más tiendas cubre (hazlo primero)

**Tiendas:** Decathlon (105405), adidas (77008), Lefties (25103), Bimba y Lola (129495), JD Sports (10121),
Foot Locker (23409), Sprinter (27904), Privé by Zalando (15573) — todos verificados como activos el
24/11/2026 — y, por confirmar dentro de Awin, Nike ES, SHEIN ES, Springfield, Cortefiel, Pedro del Hierro y
Women'secret.

1. **Alta**: https://ui.awin.com/publisher-signup/es/awin/
   - Tipo de partner: elige el que mejor describa la app (contenido / comparador o portal de compras;
     **no** «cupones» ni «cashback»).
   - Espacio promocional: la URL de la web y, si existen, las de las tiendas de apps.
   - Pega el texto del Paso 0.
   - Awin cobra un **pequeño depósito** que devuelve con el primer pago de comisiones (cláusula 7.1 de sus
     condiciones en español; importe de 1 € según su ayuda, fuente secundaria).
   - Plazo: Awin indicaba como objetivo **24 h laborables** para revisar altas (página de 2019; puede
     haber cambiado).
2. **Solicita los programas**: en *Anunciantes → Directorio* busca cada tienda por nombre o ID y pulsa
   «Unirse». Empieza por: **Decathlon ES, adidas ES, Lefties ES, Foot Locker ES, JD Sports ES, Sprinter ES,
   Bimbaylola_ES, Privé by Zalando ES**. Busca también Springfield ES, Cortefiel ES, Pedro del Hierro ES,
   Women'secret ES y SHEIN ES y apunta su ID si aparecen.
   - **Nike ES**: escribe a `global-nike@awin.com` (es el contacto que da la propia Nike en su página de
     afiliados europea) preguntando el ID del programa de España y si acepta apps.
   - Lee las condiciones de cada programa: Privé by Zalando **prohíbe afiliados CSS** y Foot Locker exige
     aprobación para actividad CSS; explica que DressIt es una app de recomendaciones.
3. **Cuando te aprueben**, consigue dos datos:
   - **ID de publisher**: el número de tu cuenta de publisher en Awin (lo muestra el panel).
   - **Clave de feeds** (no es el token de la API): *Toolbox → Create-a-Feed*, crea un feed cualquiera y
     copia del enlace de descarga lo que va **después de `apikey/`** hasta la siguiente `/`.
4. **Pégalos en `.env`** (en la raíz del proyecto; nunca lo subas a git):

   ```dotenv
   AWIN_PUBLISHER_ID=123456
   AWIN_PRODUCTDATA_API_KEY=la-clave-de-feeds
   ```

   Con eso la ingesta descarga la **lista de feeds** de Awin y usa automáticamente el de cada tienda
   aprobada cuyo ID ya está registrado (Decathlon, adidas, Lefties, Bimba y Lola, JD Sports, Foot Locker,
   Sprinter, Privé). Para una tienda cuyo ID hayas encontrado tú (p. ej. Nike ES), añádela:

   ```dotenv
   AWIN_ADVERTISERS=nike=ID_QUE_TE_DEN,springfield=ID
   ```

   *Opcional — feeds «Enhanced» (formato Google, en JSON):* si en la lista de feeds aparece «Datafeed
   Format: Google» para una tienda, crea un token en *Settings → User settings → API credentials →
   Personal Access Token* y pon `AWIN_API_TOKEN=...`; se descargarán los anunciantes de `AWIN_ADVERTISERS`.
5. Sigue en el **Paso 6** para ingerir y comprobar.

---

## Paso 2. Rakuten Advertising — Mango (y posiblemente ASOS y Massimo Dutti)

**Tiendas:** Mango y Mango Outlet (su página oficial de afiliados remite a Rakuten); ASOS Spain y Massimo
Dutti ES aparecen en Rakuten según fuentes secundarias (compruébalo dentro).

1. **Alta de publisher**: https://publisher.rakutenadvertising.com/register — usa el texto del Paso 0.
   Plazo de revisión: no publicado.
2. **Solicita los programas** en el panel (*Advertisers / Programs*): Mango, Mango Outlet, ASOS, Massimo
   Dutti. Mango busca «medios y blogs de moda con tráfico relevante y creadores afines»: cuenta qué tipo
   de usuarias tiene la app. **Pregunta expresamente si te dan acceso al catálogo de productos** para
   España.
3. **Cuando te aprueben**:
   - Entra en https://developers.rakutenadvertising.com/ con la misma cuenta, ve a *Applications → Add
     Application*. Copia el **client id** y el **client secret**.
   - **ID de cuenta (SID)**: tu número de cuenta de publisher (se pide también al generar un token en esa
     misma página).
   - **MID** de cada tienda: el ID del anunciante, visible en la ficha del programa en el panel.
4. **Pégalos en `.env`**:

   ```dotenv
   RAKUTEN_CLIENT_ID=...
   RAKUTEN_CLIENT_SECRET=...
   RAKUTEN_ACCOUNT_ID=tu-SID
   RAKUTEN_ADVERTISERS=mango=MID_DE_MANGO,asos=MID_DE_ASOS
   ```

   Limitación documentada: esta API no da marca, disponibilidad ni tallas; la app las muestra como
   desconocidas.

---

## Paso 3. Tradedoubler — Bershka (por confirmar) y otros

**Tiendas:** Bershka ES (fuente secundaria), Intimissimi/Tezenis (secundaria). **Desigual ES está en
Tradedoubler pero prohíbe apps móviles**: no lo solicites como app.

1. **Alta**: https://publishers.tradedoubler.com/es/publishers/signup/ (enlazada desde
   https://www.tradedoubler.com/es). Plazo: no publicado.
2. Busca y solicita **Bershka ES**; lee si acepta apps (el programa de Bershka EE. UU. las marca como
   «condicionales»).
3. **Cuando te aprueben**: *Account → Manage tokens* → copia el token del sistema **PRODUCTS**
   (40 caracteres).
4. Averigua el **ID del feed** de la tienda. La forma oficial es pedir la lista de tus feeds (pon tu
   token donde indica):

   ```bash
   curl "https://api.tradedoubler.com/1.0/productFeeds.json?token=TU_TOKEN"
   ```

   Cada feed trae `feedId`, `name` y `programs`.
5. **Pégalos en `.env`**:

   ```dotenv
   TRADEDOUBLER_PRODUCTS_TOKEN=...
   TRADEDOUBLER_FEEDS=bershka=FEED_ID
   ```

   Limitación documentada: la búsqueda devuelve como máximo 1.000 productos por feed; la ingesta avisa si
   el feed es mayor.

---

## Paso 4. CJ (Commission Junction) — Tous y The North Face (por confirmar)

1. **Alta**: https://signup.cj.com/member/signup/publisher/ (redirige a public.cj.com). Plazo: no
   publicado.
2. Busca y solicita **TOUS EU** y **The North Face Spain**; anota el **ID del anunciante** (CID del
   anunciante) de cada uno.
3. **Cuando te aprueben**:
   - **Personal Access Token**: https://developers.cj.com/account/personal-access-tokens
   - **Tu Company ID (CID)**: aparece en tu cuenta de CJ.
   - **PID (website ID)**: el ID de la propiedad (web/app) que diste de alta en CJ; se usa para generar
     los enlaces de afiliado.
4. **Pégalos en `.env`**:

   ```dotenv
   CJ_PERSONAL_ACCESS_TOKEN=...
   CJ_COMPANY_ID=...
   CJ_WEBSITE_ID=...
   CJ_ADVERTISERS=tous=ID_DE_TOUS
   ```

   (The North Face todavía no está dada de alta como tienda en DressIt; si te aprueban, pide que se añada
   al registro y usa `thenorthface=ID`.)

---

## Paso 5. TradeTracker — Desigual (sin adaptador todavía)

1. **Alta**: https://tradetracker.com/es/afiliados/
2. Solicita **Desigual ES** (campaña 18521) y **pregunta si admite apps** (en Tradedoubler las prohíbe).
3. Si te aprueban, avisa: hay que implementar el adaptador (la API de TradeTracker es SOAP y sus feeds
   solo se documentan con sesión iniciada; no se ha implementado sin documentación).

---

## Paso 6. Ingerir y comprobar (después de cualquier aprobación)

1. Comprueba qué ve el sistema (no descarga nada):

   ```bash
   pnpm --filter @dressit/api catalog:ingest -- --status
   ```

   Cada fuente sale con `✓` si sus credenciales están completas o con `·` y la lista de lo que falta.
2. Ingiere todo lo configurado (o una sola red con `-- --source awin_feed|awin_enhanced|rakuten|tradedoubler|cj`):

   ```bash
   pnpm --filter @dressit/api catalog:ingest
   ```

   Verás una línea por tienda: `✓ decathlon (...): N actualizados, M desactivados, K embeddings` o `✗` con el
   motivo (p. ej. `HTTP 403` si el programa aún no está aprobado). Los avisos (`⚠`) explican límites de la API.
3. **Verifica en la app**: *Perfil → Integraciones*. La tarjeta de la tienda pasa a **Operativa** y sus notas
   dicen «Catálogo awin: operativo.». Si algo falla verás «error en la última ingesta» con el motivo. En
   *Descubrir* y en la búsqueda aparecerán productos con el aviso de enlace de afiliado.
4. **Repite la ingesta al menos una vez al día** (los precios se marcan como no verificados a las 24 h).
   Programa el comando con el planificador que uses en el servidor (cron, systemd timer…).

---

## Paso 7. Acuerdos directos con marcas (Inditex, H&M, Mango, El Corte Inglés…)

Para Zara y el resto de Inditex, El Corte Inglés/Sfera, H&M y Uniqlo **no hay hoy ninguna vía de
afiliación ni API pública**. Lo único legítimo es pedirlo. Canales oficiales encontrados:

- **Inditex**: `inditexinfo@inditex.com` (contacto general de https://www.inditex.com/itxcomweb/es/en/info/contact-us).
  No hay canal específico de partners o de API.
- **Mango**: `press@mango.com` (Comunicación externa y relaciones institucionales) o su programa de
  innovación https://startupstudio.mango.com/.
- **H&M Group**: su página de contacto dice expresamente que **no considera solicitudes de colaboración**
  por esa vía; la única dirección de negocio es `ventures@hmgroup.com` (New Growth & Ventures).
- **El Corte Inglés**: no se ha encontrado un canal público para esto; su programa de Awin está inactivo.

Plantilla de correo (adáptala; no prometas cifras que no tengas):

> **Asunto:** Propuesta de colaboración: catálogo oficial de [MARCA] en la app DressIt
>
> Hola:
>
> Soy [NOMBRE], responsable de DressIt, una app española de armario digital y personal shopper
> ([URL]). Nuestras usuarias registran la ropa que ya tienen y la app les propone conjuntos y, cuando
> les falta una prenda, productos que combinan con su armario.
>
> Nos gustaría mostrar productos de [MARCA] de forma oficial: con datos e imágenes autorizados por
> vosotros, precio y disponibilidad actualizados, y enlace directo a vuestra tienda online. Respetamos
> vuestras condiciones de marca: no modificamos imágenes, no usamos vuestra marca en buscadores y la
> comisión, si la hubiera, no influye en el orden de las recomendaciones.
>
> ¿Tenéis un programa de afiliación, un feed de producto o una API para partners en España? Si es así,
> ¿con quién podemos hablar? Si no, ¿estaríais abiertos a valorar un acuerdo?
>
> Podemos enviaros una demo y la información de la empresa que necesitéis.
>
> Un saludo,
> [NOMBRE] — [CARGO], DressIt — [CORREO] — [TELÉFONO]

Si alguna marca te da acceso a una API o un feed, pide la **documentación oficial y las condiciones por
escrito** (uso de imágenes, frecuencia de actualización, uso en apps) y pásala: el adaptador se escribe
contra esa documentación.

---

## Lo que no se puede conectar (y por qué)

- **Primark**: no vende online en España.
- **Vinted / Wallapop**: sus APIs oficiales son para vendedores profesionales, no para buscar catálogo.
- **Zalando (tienda principal)**: no hay programa de afiliación en España; el «Zalando Partner Program» es
  para vender en Zalando.
- **Google Shopping**: no ofrece API de búsqueda de productos de terceros.
- **Skimlinks Product Key**: no cubre España.
- **Amazon (moda)**: la Creators API exige 10 ventas cualificadas en 30 días con Amazon Afiliados ES; se
  valorará cuando haya tráfico.

## Resumen de variables

| Variable | Dónde se consigue | Red |
|---|---|---|
| `AWIN_PUBLISHER_ID` | Tu número de cuenta de Awin | Awin |
| `AWIN_PRODUCTDATA_API_KEY` | Toolbox → Create-a-Feed → texto tras `apikey/` en el enlace | Awin |
| `AWIN_ADVERTISERS` | `tienda=ID` de anunciantes no registrados aún (o para feeds Enhanced) | Awin |
| `AWIN_API_TOKEN` | Settings → User settings → API credentials (solo feeds Enhanced) | Awin |
| `RAKUTEN_CLIENT_ID` / `RAKUTEN_CLIENT_SECRET` | developers.rakutenadvertising.com → Applications | Rakuten |
| `RAKUTEN_ACCOUNT_ID` | Tu ID de cuenta de publisher (SID) | Rakuten |
| `RAKUTEN_ADVERTISERS` | `tienda=MID` (MID en la ficha del anunciante) | Rakuten |
| `TRADEDOUBLER_PRODUCTS_TOKEN` | Account → Manage tokens → «PRODUCTS» | Tradedoubler |
| `TRADEDOUBLER_FEEDS` | `tienda=feedId` (de `productFeeds.json`) | Tradedoubler |
| `CJ_PERSONAL_ACCESS_TOKEN` | developers.cj.com → Personal Access Tokens | CJ |
| `CJ_COMPANY_ID` / `CJ_WEBSITE_ID` | Tu CID y el PID de tu web/app en CJ | CJ |
| `CJ_ADVERTISERS` | `tienda=ID` del anunciante | CJ |

Los nombres de tienda (`decathlon`, `mango`, `bershka`, `tous`…) son los IDs del registro
`services/api/src/modules/retail/registry.ts`.
