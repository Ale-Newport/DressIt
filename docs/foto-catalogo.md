# Foto de catálogo: de la foto de casa a la foto de producto

Convierte la foto que el usuario hace en casa (camiseta arrugada sobre la cama, pantalón doblado,
chaqueta puesta…) en una **foto profesional de producto** de la misma prenda. No se limita a quitar el
fondo: la prenda aparece extendida, con las mangas y las perneras colocadas, de frente y sobre fondo
blanco.

Dos prioridades, en este orden:

1. **Encontrar la foto oficial** de esa misma prenda, con búsqueda inversa en Internet y en los
   catálogos autorizados, y verificar que es la misma prenda y no una parecida.
2. **Si no hay foto oficial utilizable, generar una foto de estudio nueva** con un modelo de edición
   generativa a partir de la foto del usuario. Antes de proponerla se comprueba automáticamente su
   fidelidad y su presentación.

El usuario compara y elige. Sus fotos se conservan siempre y la foto de catálogo se puede regenerar
o sustituir.

Código: [`services/api/src/modules/catalog-photo`](../services/api/src/modules/catalog-photo) (API),
[`services/vision/app/pipeline/catalog_check.py`](../services/vision/app/pipeline/catalog_check.py)
(control) y [`CatalogPhotoCard`](../apps/mobile/src/components/wardrobe/CatalogPhotoCard.tsx) /
[`CatalogPhotoPreview`](../apps/mobile/src/components/capture/CatalogPhotoPreview.tsx) (app).
Evidencia: [evidence/foto-catalogo-2026-11-24.md](evidence/foto-catalogo-2026-11-24.md).

## 1. Flujo

```
 1 foto ──▶ 2 detección, clasificación y recorte (servicio de visión, como antes)
                │  por cada prenda detectada, un trabajo en la cola catalog-photo (asíncrono)
                ▼
 3 OCR de la prenda (marca, texto, referencias)  +  búsqueda inversa
     · catálogos autorizados (FashionSigLIP sobre catalog_products, sin llamadas externas)
     · Google Lens (SerpApi) · Google Cloud Vision Web Detection · Lykdat
       con el recorte de la prenda Y con la foto entera (respuestas en caché 30 días)
                ▼
 4 verificación de los 6 mejores candidatos: descarga de su foto (SSRF-safe), lectura de la página
   de la tienda si lo permite (más fotos oficiales, marca), comparación con la prenda (visión)
     · exacta  = misma prenda verificada + evidencia independiente
     · posible = se parece; el usuario decide
                ▼
 5 ¿foto oficial exacta y utilizable? ── sí ──▶ se propone (no se genera nada)
                │ no
                ▼
 6 ¿información suficiente? (prenda no cortada por el encuadre) ── no ──▶ pide otra foto
                │ sí                                                    (o «Generar de todos modos»)
                ▼
   packshot generativo: FASHN → fal.ai → ComfyUI (el primero configurado; los demás de reserva)
                ▼
 7 control automático (visión /v1/catalog/check): presentación + fidelidad
 8 ¿falla? reintento con correcciones (hasta PACKSHOT_MAX_ATTEMPTS = 3; el último con el proveedor
   de reserva) → si sigue fallando, se pide intervención del usuario con los motivos
                ▼
 9 la app muestra Original / Oficial / Generada (según corresponda)
10 el usuario elige → se actualiza la foto principal de la prenda
```

Se activa solo al importar fotos (`CATALOG_PHOTO_AUTO=true`) mientras el usuario revisa las
detecciones. Si elige una opción en la revisión, se aplica al añadir la prenda. También se puede
lanzar desde la ficha de una prenda: «Crear foto de catálogo», «Volver a generar», «Buscar de nuevo».
Rechazar una detección cancela su trabajo.

## 2. Prioridad 1: la foto oficial

### Buscadores integrados

Investigación del 2026-11-24, con la documentación oficial de cada proveedor.

| Buscador | Qué devuelve | Cómo se envía la foto | Coste | Estado y riesgos | Credencial |
|---|---|---|---|---|---|
| **Google Lens vía SerpApi** ([docs](https://serpapi.com/google-lens-api)) | `visual_matches` (título, página, imagen, tienda, precio) y `exact_matches` | Subida directa con la [Image API](https://serpapi.com/image-api): ≤ 500 KB, devuelve un `image_id` válido 10 min. No hace falta una URL pública de la foto. `country=es`, `hl=es` y la marca leída como `q` | 250 búsquedas gratis al mes; 25 $ / 1.000 (Starter) | Google ya no ofrece la pestaña `products`. **SerpApi se define como *scraping* de Google Lens**: decisión del propietario. Su «Legal Shield» solo cubre los planes Production o superiores | `SERPAPI_API_KEY` |
| **Google Cloud Vision Web Detection** ([docs](https://docs.cloud.google.com/vision/docs/detecting-web)) | Páginas con imágenes coincidentes, imágenes parecidas, entidades y «mejor suposición» | base64 en la petición; clave en la cabecera `x-goog-api-key` (nunca en la URL); modelo `builtin/latest` | 1.000 gratis al mes; 3,5 $ / 1.000 | Es la vía oficial de Google, pero no devuelve precios y no se puede orientar a España (`includeGeoResults` está obsoleto) | `GOOGLE_CLOUD_VISION_API_KEY` |
| **Lykdat Global Search** ([docs](https://apidocs.lykdat.com/)) | Productos parecidos de su índice (marca, tienda, imágenes, precio) | multipart con `api_key` en el formulario | 49,99 $ / 3.000 (precio de 2025) | **A 24/11/2026 su consola y su documentación devuelven HTTP 402** (despliegue desactivado). Catálogo centrado en EE. UU. y Reino Unido: no aparecen tiendas españolas | `LYKDAT_API_KEY` |
| **Catálogos autorizados** (FashionSigLIP) | Productos de los feeds de afiliación conectados (Awin, Rakuten, Tradedoubler, CJ) | Nada sale del servidor | 0 | Solo encuentra lo que hay en los catálogos conectados ([conectar-tiendas.md](conectar-tiendas.md)) | Las de cada red |

Descartados: Bing Visual Search (retirado el 11/08/2025), Vision API Product Search (en
mantenimiento y solo busca en un catálogo propio), TinEye (encuentra copias de la misma foto, no
productos), y hacer *scraping* propio de Google o Yandex.

### Qué se busca y cómo se ordena

- **Dos consultas por buscador**: el recorte de la prenda (con un 8 % de contexto) y la foto entera.
  `CATALOG_SEARCH_QUERIES=crop,full` permite usar solo una.
- **OCR de la prenda**: se leen la marca (lista de tiendas del registro y marcas habituales), los
  textos de etiquetas y logotipos y las referencias (formato Inditex `1234/567/800`, EAN-13). La
  marca se envía a Lens como texto y sirve de evidencia.
- **Fusión**: los candidatos se agrupan por página de producto (sin parámetros de seguimiento). Se
  priorizan las tiendas del registro (Zara, Pull&Bear, Bershka, Massimo Dutti, Stradivarius, Mango,
  El Corte Inglés, H&M, Uniqlo…), los dominios `.es` y las rutas `/es/`, sin descartar ninguna otra
  tienda. También suman la marca o la referencia leídas, la imagen exacta y el acuerdo entre
  buscadores.

### Verificación: la misma prenda, no una parecida

Para cada uno de los 6 mejores candidatos:

1. Se descarga su foto (`safeFetch`: sin direcciones privadas, solo `image/*`, máximo 8 MB).
2. Se lee la página de la tienda (respetando `robots.txt`), si lo permite. De sus datos estructurados
   (schema.org) salen más fotos oficiales, la marca y el título. Muchas tiendas bloquean la lectura
   desde servidor; entonces se usa la foto que dio el buscador.
3. Cada foto se compara con la prenda del usuario (`/v1/catalog/check`, `kind=official`): se busca la
   prenda de la misma categoría aunque la lleve una modelo, y se miden la similitud FashionSigLIP, la
   paleta de color y el tipo.
4. **Veredicto** ([`matching.ts`](../services/api/src/modules/catalog-photo/matching.ts)):
   - **exacta**: mismo tipo, mismos colores, similitud ≥ `OFFICIAL_PHOTO_EXACT_SIMILARITY` (0,86)
     **y** al menos una evidencia independiente:
     - la referencia o la marca leídas en la prenda coinciden (también un texto de la etiqueta que no
       esté en la lista de marcas);
     - el buscador encontró la misma imagen;
     - la encuentran dos buscadores distintos;
     - o, si viene de un catálogo autorizado, la similitud es ≥ 0,90.

     El mismo buscador con dos consultas **no** cuenta como acuerdo.
   - **posible**: mismo tipo y similitud ≥ 0,78. Se muestra como alternativa, con sus dudas («Solo hay
     parecido visual…», «puede ser otra variante»), y el usuario decide.
   - descartada en cualquier otro caso.
5. De las fotos de un producto se elige la más adecuada para un armario: fondo neutro, prenda sola y
   entera, sin modelo, y la más parecida en color (la variante correcta).

### Permisos de uso de las imágenes

| Origen | Uso (`usage`) | Qué se hace |
|---|---|---|
| Feed de un catálogo autorizado (licencia de la red de afiliación) | `licensed` | Se copia la foto (`retailer_licensed`) con atribución y enlace |
| Foto encontrada en Internet | `link_preview` (por defecto) | **No se copia**: se muestra desde la web de la tienda, solo al propietario, con atribución («Foto oficial de …») y enlace a la página (`retailer_link_preview`) |
| Foto encontrada en Internet con `OFFICIAL_PHOTO_WEB_IMAGES=none` | `reference_only` | Solo identifica el producto (marca, modelo, enlace); la foto no se usa |

Las URL y la procedencia (buscador, página, tienda, evidencias) se guardan siempre. Si se elige la
foto oficial, la marca, el modelo y el enlace de la tienda completan la ficha, pero solo los campos
que el usuario no había rellenado. **Revisión legal pendiente**: mostrar por referencia la foto de
una tienda sin acuerdo con ella es una zona gris. `OFFICIAL_PHOTO_WEB_IMAGES=none` lo desactiva.

## 3. Prioridad 2: foto de estudio con IA

### Modelos comparados (24/11/2026)

| Modelo | Recolocar la prenda / packshot | Coste por imagen | Licencia / condiciones | Integración |
|---|---|---|---|---|
| **FASHN Agent Images** ([docs](https://docs.fashn.ai/api-reference/agent-images)) | La vía de la API hacia su producto [Packshot](https://fashn.ai/packshot): maniquí invisible, flat lay, corrige arrugas y caída. Experimental desde el 26/10/2026. No existe un modelo `packshot` en `/v1/run` | 1 crédito (0,075 $) en `balanced` 1k; 0,15 $ en 2k | Las imágenes generadas son del cliente; FASHN no entrena con ellas; su CDN las borra a los 3 días | **Principal** si hay `FASHN_API_KEY` |
| **Qwen-Image-Edit-2511 en fal.ai** ([modelo](https://fal.ai/models/fal-ai/qwen-image-edit-2511)) | Los mismos pesos que en local | 0,03 $ por megapíxel (≈ 0,035 $ a 896×1120) | Pesos Apache-2.0; fal no entrena con los datos ni da derechos sobre la salida | **Reserva** si hay `FAL_KEY` |
| **Qwen-Image-Edit-2511 en ComfyUI propio** (GGUF Q4_K_M + Lightning, 4 pasos) | Sí: probado con polo, chaqueta de punto, vaquero y más (ver la evidencia) | Electricidad; 3–8 min por imagen en un Mac M2 Max (segundos en una GPU de servidor) | Apache-2.0 | Activo en desarrollo (`IMAGEGEN_COMFY_URL`) |
| Qwen-Image-Edit-2509 | Versión anterior: más deriva que la 2511 | 0,03 $/MP en fal | Apache-2.0 | No se usa (sustituido por 2511) |
| Qwen-Image-2.1 / 2.1-Turbo | Hasta 10 referencias y salida RGBA | — | **Qwen Research License: no comercial** | Descartado |
| Gemini «Nano Banana» 2.1, OpenAI gpt-image-2.x | Editores generales, sin garantías específicas para prendas | 0,03–0,21 $ | Permiten uso comercial; marca SynthID (Gemini) | No integrados; `gpt-image-1` se cerró el 23/10/2026 |

El orden es configurable: `PACKSHOT_PROVIDERS=fashn,fal,comfy`. Se usa el primero configurado y
disponible. Si un proveedor falla sin posibilidad de reintento, se pasa al siguiente. El último
intento usa el proveedor de reserva, si lo hay.

### Qué recibe el modelo

- **La foto del usuario**:
  - entera, si solo tiene esa prenda: así no se pierde lo que el recorte automático no vio (IS-Net a
    veces deja fuera unas mangas extendidas);
  - si tiene varias prendas, la zona de esa prenda con un 8 % de contexto.

  No se le da el recorte sin fondo: el modelo tiene que ver el tejido, las costuras y la luz reales,
  y quitar él el fondo, la percha, las manos o a la persona.
- **Un lienzo nuevo de 896×1120 (4:5)**: la imagen generada no hereda el encuadre torcido de la foto
  de casa. Es el cambio clave frente al sistema anterior, que solo pedía una foto de estudio del
  recorte y exigía conservar la misma silueta.
- **La instrucción** ([`prompt.ts`](../services/api/src/modules/catalog-photo/prompt.ts)): el prompt
  base del propietario, en inglés, con la descripción de la prenda (marca, colores, material,
  estampado y tipo) y las instrucciones de su categoría:

| Tipo | Presentación | Instrucción específica (resumen) |
|---|---|---|
| Camisetas, tops | flat lay | torso extendido, ambas mangas desplegadas y simétricas, cuello centrado, bajo recto |
| Camisas, polos, blusas | flat lay | cuello bien doblado y simétrico, tapeta centrada, mangas desplegadas, puños ordenados |
| Jerséis, cárdigan, sudaderas | flat lay | mangas ordenadas junto al cuerpo, cuello centrado, mismo punto y su escala, volumen natural |
| Pantalones y vaqueros | flat lay | cintura horizontal, ambas piernas extendidas, alineadas y visibles hasta el bajo |
| Shorts / faldas | flat lay | cintura horizontal, simetría, caída natural hasta el bajo |
| Vestidos y monos | maniquí invisible | caída natural, simetría, silueta completa y proporciones reales |
| Chaquetas y abrigos | maniquí invisible | hombros nivelados, mangas simétricas, solapas y cierres coherentes, volumen del tejido |
| Calzado | producto | vista lateral de tres cuartos, forma, material y diseño a la vista; si son un par, juntos |
| Bolsos | producto | de frente, erguido, asas ordenadas, herrajes y logotipo como en la foto |
| Complementos | producto | la orientación más comercial, completo y centrado |

Además:

- si se leyó texto o un logotipo, se pide reproducirlo **legible, en el mismo sitio, tamaño y color**;
- en fotos con varias prendas se pide usar solo esa;
- se prohíbe inventar partes que no se ven: las zonas ocultas deben ser lisas y coherentes con lo
  visible;
- un reintento añade la corrección del fallo detectado. Por ejemplo, «the previous attempt was not
  arranged properly…» o «…changed the colours. Keep exactly…».

### Cuándo se pide otra foto

Si la prenda (parte de arriba, de abajo, vestido o abrigo) sale **cortada por dos o más bordes** del
encuadre, o mide menos de 220 px, reconstruirla obligaría a inventar. La app explica por qué y ofrece
«Hacer otra foto» o «Generar de todos modos» (`force: true`).

## 4. Control automático: presentación y fidelidad

`POST /v1/catalog/check` del servicio de visión
([`catalog_check.py`](../services/vision/app/pipeline/catalog_check.py)). Mide dos cosas
independientes; la imagen solo se da por buena si pasa las dos.

**Presentación** (¿parece una foto de producto?), sobre la imagen generada:

| Medida | Umbral | Atrapa |
|---|---|---|
| Fondo: L* medio, desviación y croma del borde (4 %) | L* ≥ 84, σ ≤ 9, croma ≤ 10 | cama, suelo, muebles, fondo con textura |
| Margen de la prenda al borde | ≥ 0,8 % | prenda cortada |
| Tamaño (lado largo de la caja / lado de la imagen) | ≥ 0,42 | prenda diminuta |
| **Simetría** de la silueta respecto a un eje vertical (IoU con su reflejo) | ≥ 0,88 (arriba, abajo, vestidos, abrigos) | mangas dobladas, perneras torcidas, prenda arrugada |
| Inclinación del eje de simetría | ≤ 4° | prenda torcida o en escorzo |
| Componentes conexos | 1 (2 en calzado y complementos) | varias prendas, perchas, objetos |
| Otra prenda de ropa (detector de varias prendas: Grounding DINO + SAM 2.1) de otra categoría, ≥ 8 % de la imagen; los complementos no cuentan | ninguna | el modelo «viste» la prenda como un conjunto (en la evaluación, un polo con un pantalón inventado que se tocaba con él y pasaba por una sola silueta) |
| FashionSigLIP sin entrenamiento: P(packshot) frente a P(arrugada, doblada, en percha, en silla) y P(puesta) | P(packshot) ≥ 0,5; P(puesta) ≤ 0,5 | «sigue pareciendo una foto de casa», persona |

**Fidelidad** a la prenda real. No depende de cómo esté colocada, porque el packshot la recoloca a
propósito:

| Medida | Umbral | Atrapa |
|---|---|---|
| Tipo (categoría) | el mismo | otra prenda |
| Similitud FashionSigLIP con el recorte real | ≥ 0,70 | una prenda distinta |
| Paleta: Earth Mover's Distance con coste CIEDE2000 con kL = 2 (el ajuste habitual en textiles). Antes se alinea la luminosidad media (la luz de estudio aclara u oscurece) y se quitan los brillos especulares: hasta el 10 % más claro de una prenda de color, si es casi neutro (nailon al sol, satén) | ≤ 10; ningún color principal (≥ 15 %) perdido ni añadido (ΔE ≤ 15 con kL = 3: cuenta el tono, no la luz) | cambio de color, estampado perdido |
| Desplazamiento de luminosidad | ≤ 42 L* | negro → blanco |
| Liso ↔ estampado (rayas, cuadros, flores…) | sin cambio | estampado inventado o perdido |
| Textura: χ² entre histogramas LBP uniformes a la misma escala de prenda | ≤ 0,35 | otro tejido o punto |
| Texto/logotipo (OCR de los dos) | ≥ 50 % de las palabras | logotipo cambiado o ilegible |

Por qué se sustituye el control anterior (`/v1/compare`, que se mantiene en el servicio): exigía la
**misma silueta** (IoU ≥ 0,82 con alineado rígido) y el mismo color por zonas. Por eso rechazaba
justo lo que se pide ahora (mangas extendidas, piernas colocadas) y premiaba conservar el desorden
de la foto original.

Calibración con generaciones reales y controles negativos (detalle en la evidencia):

- **Presentación**: los packshots buenos dan una simetría de 0,94–0,97, y los recortes «solo sin
  fondo» de fotos desordenadas 0,80–0,86. Estos últimos además fallan por inclinación o por
  P(packshot).
- **Paleta**: misma prenda 4,1–8,9 frente a 9,6–30,1 entre prendas distintas. El único par distinto
  que pasa por color (plumífero azul frente a vaquero azul, 9,6) lo descartan el tipo y la similitud.
  Con el primer criterio (kL = 1, sin quitar brillos) un plumífero fotografiado al sol fallaba en
  los tres intentos, aunque la foto generada era fiel: sus brillos contaban como un «color blanco»
  perdido.
- **Similitud**: misma prenda recolocada 0,73–0,93 en la evaluación, frente a 0,42–0,68 entre prendas
  distintas o mal detectadas. La similitud sola no basta: un polo con un pantalón inventado dio 0,74.
  Eso lo atrapa la regla de prenda añadida.
- **Evaluación con 8 condiciones reales**: las 7 de una sola prenda acaban con una foto apta (dos tras
  «Generar de todos modos»). En la foto con varias prendas, la pieza mal detectada se rechaza y se pide
  ayuda al usuario. Detalle, comparativas y fallos corregidos:
  [evidence/foto-catalogo-2026-11-24.md](evidence/foto-catalogo-2026-11-24.md).

## 5. Elección, armario y API

| Método | Ruta | Cuerpo | Respuesta |
|---|---|---|---|
| GET | `/v1/catalog-photos/status` | – | `CatalogPhotoServiceStatusDto`: buscadores y generadores configurados, credenciales que faltan (solo nombres), límites |
| POST | `/v1/garments/:id/catalog-photo` | `{ mode?: 'auto'\|'search'\|'generate', force? }` | `CatalogPhotoDto` (202) |
| GET | `/v1/garments/:id/catalog-photo` | – | `CatalogPhotoDto \| null` (el último) |
| GET | `/v1/catalog-photos/:id` | – | `CatalogPhotoDto`: estado y etapa, original, oficial (con evidencias), alternativas, generada (con su control), intentos, buscadores consultados, texto leído, elección, mensaje |
| POST | `/v1/catalog-photos/:id/choose` | `{ choice: 'official'\|'generated'\|'original', matchId?, acceptWarnings? }` | `CatalogPhotoDto` |
| — | `DetectionDto.catalogPhoto` | — | resumen para la cola de revisión |

- Elegir `generated` exige que haya pasado el control, salvo `acceptWarnings: true`: el usuario vio
  los motivos y la usa igualmente.
- Elegir `official` con una alternativa «posible» es el usuario confirmando que es su prenda.
- `original` vuelve a su foto.
- Las fotos generadas llevan `generatedBy`, la etiqueta visible «Generada con IA» en la app y la marca
  en EXIF (Reglamento de IA, art. 50).

## 6. Asincronía, caché, costes y errores

- **Cola `catalog-photo`** (BullMQ; en desarrollo, en el propio proceso):
  - concurrencia `CATALOG_PHOTO_CONCURRENCY` (2) y 2 reintentos con espera;
  - estados `queued → searching → generating → ready | needs_user | failed`, después
    `confirmed | dismissed`, con la etapa en curso («Buscando la foto oficial…», «Creando la foto de
    estudio…», «Comprobando que es fiel…») que la app consulta cada 4 s;
  - los errores transitorios (429, 5xx, red) se reintentan y los definitivos se explican en español.
- **Caché**: cada respuesta de un buscador se guarda 30 días (`visual_search_cache`) con la clave
  proveedor + consulta + SHA-256 de la imagen + marca. Repetir la búsqueda de la misma foto no se
  vuelve a pagar.
- **Costes**:
  - `external_api_usage` cuenta llamadas y coste estimado por usuario, proveedor y día;
  - el coste de cada trabajo va en `cost_cents`;
  - límites diarios por usuario: `CATALOG_DAILY_SEARCHES_PER_USER` (40) y
    `CATALOG_DAILY_GENERATIONS_PER_USER` (20);
  - presupuesto mensual total de los proveedores de pago: `CATALOG_MONTHLY_BUDGET_CENTS` (50 $);
  - cuando se alcanza un límite, ese proveedor se omite y la app lo dice.
- **Credenciales**: solo en el backend (variables de entorno). La app nunca las ve, y
  `/v1/catalog-photos/status` solo dice qué variable falta. La clave de Cloud Vision va en una
  cabecera, no en la URL.

## 7. Privacidad

- La búsqueda en Internet envía la foto de la prenda (el recorte y la foto entera) a terceros.
  Necesita su propio consentimiento, revocable: **«Buscar mis prendas en Internet»**
  (`visual_search_external`). Al retirarlo se borran las respuestas guardadas. Sin él solo se busca
  en los catálogos conectados.
- Generar con FASHN o fal.ai envía el recorte de la foto a ese proveedor. Lo cubre el consentimiento
  «Imágenes generadas con IA», cuyo texto lo dice. Ninguno de los dos entrena con los datos; FASHN
  borra los datos en base64 al terminar y su CDN a los 3 días.
- Retención:
  - respuestas de buscadores: 30 días;
  - trabajos descartados o fallidos: 30 días;
  - packshots nunca asociados a una prenda: 30 días;
  - contadores de uso: 400 días;
  - la exportación RGPD incluye `catalog_photo_jobs` y `external_api_usage`.
- Pendiente antes de producción: los acuerdos de encargado del tratamiento (DPA) con SerpApi
  (EE. UU., cláusulas contractuales tipo), Google, Lykdat, FASHN y fal.

## 8. Configuración

| Variable | Por defecto | Para qué |
|---|---|---|
| `CATALOG_PHOTO_AUTO` | `true` | preparar la foto de catálogo de cada detección al importar |
| `CATALOG_SEARCH_QUERIES` | `crop,full` | consultas por buscador |
| `SERPAPI_API_KEY` · `SERPAPI_COUNTRY` · `SERPAPI_HL` · `SERPAPI_COST_CENTS` | — · `es` · `es` · 2,5 | Google Lens |
| `GOOGLE_CLOUD_VISION_API_KEY` · `GOOGLE_CLOUD_VISION_COST_CENTS` | — · 0,35 | Web Detection |
| `LYKDAT_API_KEY` · `LYKDAT_COST_CENTS` | — · 1,67 | Lykdat |
| `OFFICIAL_PHOTO_EXACT_SIMILARITY` · `OFFICIAL_PHOTO_POSSIBLE_SIMILARITY` | 0,86 · 0,78 | veredicto |
| `OFFICIAL_PHOTO_WEB_IMAGES` | `link_preview` | `none`: no usar fotos de tiendas encontradas en Internet |
| `PACKSHOT_PROVIDERS` | `fashn,fal,comfy` | orden de los generadores |
| `FASHN_API_KEY` · `FASHN_GENERATION_MODE` · `FASHN_RESOLUTION` · `FASHN_CENTS_PER_CREDIT` | — · `balanced` · `1k` · 7,5 | FASHN |
| `FAL_KEY` · `FAL_PACKSHOT_MODEL` · `FAL_COST_CENTS` | — · `fal-ai/qwen-image-edit-2511` · 3,5 | fal.ai |
| `IMAGEGEN_COMFY_URL` · `IMAGEGEN_PACKSHOT_WORKFLOW` | — · `packshot` | ComfyUI propio |
| `PACKSHOT_MAX_ATTEMPTS` · `PACKSHOT_TIMEOUT_MS` | 3 · 900000 | reintentos y tiempo máximo |
| `CATALOG_DAILY_SEARCHES_PER_USER` · `CATALOG_DAILY_GENERATIONS_PER_USER` · `CATALOG_MONTHLY_BUDGET_CENTS` | 40 · 20 · 5000 | control de costes |
| `CATALOG_SEARCH_CACHE_DAYS` · `CATALOG_PHOTO_CONCURRENCY` | 30 · 2 | caché y cola |

### Credenciales que faltan en este entorno (24/11/2026)

Ninguna de estas claves está en `.env`. La integración está hecha y probada con los contratos de cada
API, pero **no se ha hecho ninguna búsqueda real en Internet ni ninguna generación con FASHN ni con
fal.ai**:

| Variable | Dónde se consigue |
|---|---|
| `SERPAPI_API_KEY` | [serpapi.com](https://serpapi.com) → Dashboard → API Key (250 búsquedas gratis al mes) |
| `GOOGLE_CLOUD_VISION_API_KEY` | Google Cloud Console → activar Cloud Vision API y facturación → Credenciales → Clave de API, restringida a Cloud Vision |
| `LYKDAT_API_KEY` | console.lykdat.com, que hoy no funciona (HTTP 402) |
| `FASHN_API_KEY` | [app.fashn.ai](https://app.fashn.ai) → API → crear clave (créditos desde 7,50 $) |
| `FAL_KEY` | [fal.ai](https://fal.ai) → Dashboard → Keys |

Funciona ya, sin claves: los catálogos autorizados conectados y la generación con Qwen-Image-Edit-2511
en el ComfyUI local, que es la usada en la evidencia.

## 9. Limitaciones

- **Sin búsquedas reales todavía** (faltan las claves). Los umbrales del veredicto «exacta» se
  calibraron con catálogos de prueba y con la similitud entre la misma prenda recolocada y prendas
  distintas. Hay que revisarlos con las primeras búsquedas reales.
- **FashionSigLIP no distingue dos prendas casi iguales** (dos vaqueros oscuros parecidos). Por eso
  «exacta» exige evidencia independiente y la fidelidad también mira paleta, textura y texto. Aun así,
  un detalle pequeño (un botón distinto, una costura) puede pasar el control de la foto generada. La
  app siempre muestra la foto del usuario al lado y nunca sustituye nada sin que lo elija.
- **Errores de detección previos**: si el servicio de visión clasifica o recorta mal una prenda (en la
  evaluación, la parte de arriba de un frac como «bufanda»; un jersey con las mangas extendidas como
  «chaleco»), la generación parte de un dato malo. El control lo rechaza o, si la referencia también
  es incompleta, puede no notarlo. Por eso la revisión permite corregir el tipo y «Volver a generar».
- **Pequeños artefactos**: un resto de fondo junto a un puño, un tono jaspeado algo más oscuro. Pasan
  el control si no cambian la prenda; la app muestra siempre la foto real al lado.
- **Lo que no se ve se reconstruye**: un pantalón doblado o un jersey sobre una silla esconden partes.
  La instrucción pide que sean lisas y coherentes. Solo se pide otra foto cuando la prenda sale
  cortada por el encuadre.
- **Velocidad en local**: unos 3,5 min por imagen en el Mac de desarrollo, y hasta 15 min si comparte
  la GPU con otros trabajos. Con FASHN, ~40 s según su documentación; con fal.ai, sin medir.
- **Fotos de tiendas por referencia**: pueden dejar de verse si la tienda cambia la URL o bloquea el
  *hotlinking*. La app vuelve entonces a la foto del usuario.
- **Revisión legal pendiente**: uso de fotos de tiendas sin acuerdo (aunque sea por referencia),
  condiciones de SerpApi (*scraping* de Google) y DPA con cada proveedor.
