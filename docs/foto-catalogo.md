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
   nombre, descripción de la prenda completa y rasgos que su foto debe conservar (Qwen3.5-35B-A3B
   local, desde la importación; partes ocultas incluidas: una prenda vista en parte se reconstruye)
                ▼
   foto de estudio desde la foto original: FASHN → fal.ai → MLX (el primero configurado; los demás
   de reserva). En local, FLUX.2 klein 4B en MLX, 14-22 s
                ▼
 7 control automático (visión /v1/catalog/check, kind=studio): recorte con BiRefNet, color igualado
   a la prenda real, presentación + fidelidad; Qwen3.5 comprueba que sea la misma clase de prenda y
   que conserve largo, mangas, capucha, cordones, estampado, encaje y cinta
 8 ¿falla? reintento con correcciones y con cómo debe ser la prenda (hasta PACKSHOT_MAX_ATTEMPTS = 3;
   si klein sigue dibujando otra cosa, el último limpia el recorte real de la prenda) → si sigue
   fallando, se pide intervención del usuario con los motivos
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

### Foto de estudio primero, recorte después (25/11/2026)

Lo que hace Alta (según lo publicado; ver [research/competidores.md](research/competidores.md#cómo-convierte-alta-las-prendas-en-fotos-de-estudio-investigación-del-2026-11-25)),
replicado sin coste. Es el flujo por defecto (`CATALOG_STUDIO_PROMPT=studio`). Medidas, controles
ciegos y fallos que quedan: [evidence/foto-estudio-2026-11-25.md](evidence/foto-estudio-2026-11-25.md) y
[evidence/foto-estudio-vlm-2026-11-25.md](evidence/foto-estudio-vlm-2026-11-25.md). En la
verificación final, 30 de 50 prendas (18 fotos difíciles) fueron aptas a ciegas, y 30 de 45 sin
contar las detecciones erróneas.

1. **Detectar y describir cada prenda en la foto entera** (como Alta), al importar. Qwen3.5-35B-A3B
   (`POST /v1/garments` del [servidor MLX](../services/imagegen/mlx/server.py); mezcla de expertos con
   3 B parámetros activos, 4-15 s por foto) lista las prendas y complementos del sujeto principal, cada
   uno como **un** artículo con su caja:
   - un frac cuyo cuerpo verde y faldones negros el detector partía en dos es una sola prenda;
   - un par de zapatos o calcetines es un artículo (si los lista por separado,
     [`clean_garments`](../services/imagegen/mlx/garments.py) los une);
   - de una sudadera puesta y vista casi solo por la capucha, la prenda entera;
   - se ignoran personas del fondo, muebles, perchas, reflejos y objetos que no se llevan puestos.

   De cada una da un nombre en inglés y otro en español («Sudadera con capucha roja», que la revisión
   propone como nombre), la descripción de la prenda **completa** y sola (colores de cada parte, largo,
   corte, mangas, cierres, forro, estampados; lo que la foto no enseña, como sería lo más probable;
   nunca la persona ni cómo se lleva, porque el editor la dibujaba), si solo se ve en parte y **lo que su
   foto de catálogo debe conservar**: largo, mangas, capucha, cordones, estampado o texto grande, letras,
   encaje, cinta del sombrero, faldones, asa, el color de cada parte («body beige; sleeves blue») y si alguien la
   lleva puesta. El modelo de 4 B que se usaba antes escribía a veces en español los campos en
   inglés (klein dibujó un jersey para «Calcetines blancos»), no decía el largo y listaba perchas y
   reflejos; si aun así llega un nombre en español, el servidor lo traduce. El servicio de visión
   segmenta esas cajas con SAM 2.1 (`boxes` en `/v1/analyze`) en lugar
   de usar Grounding DINO. El tipo sale del nombre cuando el vocabulario lo tiene
   ([`subcategoryFromName`](../services/api/src/modules/catalog-photo/prompt.ts)): el clasificador
   llamaba «bufanda» a una falda o a una mochila. Si el servidor MLX no está, se usa el detector de
   siempre y la prenda se nombra luego, con un recuadro rojo (`POST /v1/describe`).
2. **Nada se rechaza por verse en parte.** Una prenda cortada por el encuadre, pequeña, puesta o tapada
   se reconstruye entera a partir de su descripción, como hace Alta, y el mensaje lo dice («Parte de la
   prenda no se veía en tu foto: la hemos completado»). Solo se pide otra foto si no es ropa.
3. **Foto de estudio desde la foto original**: la foto entera si solo tiene esa prenda; con varias, su
   zona con un 20 % de contexto, porque así queda en el centro, que es lo que nombra el prompt
   ([`buildStudioPrompt`](../services/api/src/modules/catalog-photo/prompt.ts)). El prompt lleva el
   nombre y la descripción completa en lugar de los colores medidos. Fondo **gris muy claro**, porque
   sobre blanco el recorte se come las prendas blancas. La presentación por tipo (flat lay, «fantasma»,
   producto) sale del nombre ([`kindFromName`](../services/api/src/modules/catalog-photo/prompt.ts)).
   Los bolsos sin asa (de cadena o de hombro) llevan la correa en curva delante del bolso: con la correa
   «sobre el bolso», klein les ponía un asa corta (4 de 4; en curva, 0 de 8). Un *clutch*, una cartera o un
   neceser se piden pequeños y planos, sin asas ni correa (salvo que la descripción nombre una), y se quitan
   de su descripción las frases sobre un asa: llevado en la mano, la detección lo describía «con un asa
   corta» y klein dibujaba un bolso con asas. Los zapatos van vacíos y el par idéntico, y los guantes, hasta
   la muñeca salvo que el nombre diga largos (klein los alargaba).
4. **Recorte y color** en el control (`kind=studio` de `/v1/catalog/check`):
   - BiRefNet lite (MIT, en CPU, ~3,5 s) recorta la foto de estudio. IS-Net fallaba en 4 de 23.
   - El recorte se iguala en CIELAB a la prenda de la foto ([`match_garment_colour`](../services/vision/app/pipeline/catalog_check.py)).
     Se oscurece si el modelo la aclaró. Se aclara si es de color y el modelo la oscureció (los vaqueros
     azul medio salían negros). En prendas de color se recuperan el tono y la saturación, solo en las
     partes de color: el forro gris de una sudadera roja no se tiñe. Las prendas neutras no se aclaran
     nunca ni cambian de tono, porque con flash el negro parece gris en la foto.
   - Se juzgan presentación y fidelidad **sobre ese recorte**, que es lo que verá el usuario. Se admite
     el fondo gris, pero no uno con textura. Textura, simetría y «orden» son más permisivos que con el
     flujo anterior: en el control ciego solo rechazaban imágenes buenas.
5. **¿Es la misma prenda?** Qwen nombra lo que muestra la foto de estudio (`POST /v1/identify`) y se
   compara con la prenda ([`sameKindOfItem`](../services/api/src/modules/catalog-photo/prompt.ts)). Cuenta
   la categoría y, dentro de ella, el pantalón frente al short o la falda, los tacones frente al calzado
   plano, las zapatillas o las botas, la chaqueta frente al abrigo largo y el vestido frente al mono.
   Esto atrapa lo que el control de colores y texturas no ve: unos salones negros dibujados como
   mocasines, unos shorts como vaqueros largos, un frac como abrigo.
6. **¿Conserva lo que la distingue?** (`POST /v1/verify`, [`attrs.py`](../services/imagegen/mlx/attrs.py)).
   Qwen lee en la foto de estudio el largo, las mangas, la capucha, los cordones, el estampado o texto
   grande, las letras, el encaje, la cinta del sombrero, los faldones, el asa, el pie de las medias, si se
   ven pies, piernas o manos, si los dos zapatos del par difieren y el color de cada parte, y unas reglas los comparan con lo que dijo la detección: unos shorts muy cortos dibujados por
   la rodilla (el largo de los shorts se mide en el recorte: alto/ancho), un chaleco con mangas, una
   sudadera sin capucha, unos salones con cordones, un sombrero con una cinta inventada, un bolso de
   cadena con asa, unas medias sin pie, letras sin sentido donde la prenda no tiene ninguna, unos
   tacones con las piernas dentro, unos mocasines con la hebilla en uno solo o unas mangas azules
   dibujadas grises no pasan. Un par
   (calcetines, zapatos) cuenta como una prenda, y el largo no se compara si la foto corta la prenda. Lo que falla se convierte en
   cómo debe ser la prenda («blue denim shorts, upper thigh length») y va en el siguiente intento justo
   después de su descripción. Comparar las dos fotos a la vez se descartó: el modelo señalaba diferencias
   que no existían y rechazaba también las fotos buenas (las 47 rechazadas de 50, frente a 20 malas).
7. **Un solo modelo, por debajo de 30 s.** FLUX.2 klein 4B en MLX, sin cuantizar (14-22 s). Si en dos
   intentos sigue dibujando **otro tipo de prenda** (el frac como traje con pantalones, en todas las
   variantes de prompt probadas), el último intento **restaura el recorte real** (`POST /v1/restore`,
   ~12 s): lo pone sobre el gris de estudio y klein lo limpia imagen a imagen conservando el 65 % de la
   imagen de partida. Solo con prendas que nadie lleva puestas (extendidas, colgadas, expuestas) y vistas
   enteras: el recorte de unas medias o unos calcetines puestos salía como tubos deformes. Si el recorte
   está en trozos (un bolso partido por su cadena), el servidor lo rechaza y se hace un intento normal.
   Para otros fallos (un asa, una cinta) restaurar no mejoró en el control ciego. Qwen-Image-Edit en
   ComfyUI (~3,3 min) ya no se usa: excede los 30 s por imagen.

### Modelos comparados (24/11/2026)

| Modelo | Recolocar la prenda / packshot | Coste por imagen | Licencia / condiciones | Integración |
|---|---|---|---|---|
| **FASHN Agent Images** ([docs](https://docs.fashn.ai/api-reference/agent-images)) | La vía de la API hacia su producto [Packshot](https://fashn.ai/packshot): maniquí invisible, flat lay, corrige arrugas y caída. Experimental desde el 26/10/2026. No existe un modelo `packshot` en `/v1/run` | 1 crédito (0,075 $) en `balanced` 1k; 0,15 $ en 2k | Las imágenes generadas son del cliente; FASHN no entrena con ellas; su CDN las borra a los 3 días | **Principal** si hay `FASHN_API_KEY` |
| **Qwen-Image-Edit-2511 en fal.ai** ([modelo](https://fal.ai/models/fal-ai/qwen-image-edit-2511)) | Los mismos pesos que en local | 0,03 $ por megapíxel (≈ 0,035 $ a 896×1120) | Pesos Apache-2.0; fal no entrena con los datos ni da derechos sobre la salida | **Reserva** si hay `FAL_KEY` |
| **FLUX.2 klein 4B en MLX** ([servidor propio](../services/imagegen/mlx/server.py), mflux fp16 sin cuantizar, 4 pasos) + Qwen3.5-35B-A3B para detectar, describir y comprobar | El mismo modelo, sin ComfyUI. Resultados en [evidence/foto-estudio-30s-2026-11-27.md](evidence/foto-estudio-30s-2026-11-27.md) | Gratis; 14-22 s por imagen (q8: ~16 s, q4: ~16 s, peor calidad) | Apache-2.0 (los dos) | **Por defecto** en local (`IMAGEGEN_MLX_URL`) |
| FLUX.2 klein 9B / FLUX.3 klein (MLX) | Más grandes; FLUX.3 klein necesita 16 pasos | ~2× klein 4B (estimado); FLUX.3: >60 s | **Licencias no comerciales** (FLUX Non-Commercial / Kommunity), descarga tras aceptar | Descartados: >30 s y licencia |
| FLUX.2 klein 4B en ComfyUI propio (workflow `packshot-fast`, GGUF Q8_0, 4 pasos, fp16) | 9/14 aptas al primer intento y 14/14 fieles en 7 prendas; aclara las prendas oscuras, que se corrigen después ([evidencia](evidence/packshot-rapido-2026-11-24.md)) | Gratis; **~28 s** por imagen en un Mac M2 Max | Apache-2.0 | Reserva (`IMAGEGEN_PACKSHOT_WORKFLOW=packshot-fast`) |
| **Qwen-Image-Edit-2511 en ComfyUI propio** (workflow `packshot`, GGUF Q4_K_M + Lightning, 4 pasos) | 7/7 aptas; más fiel en el color de las prendas oscuras | Gratis; ~173-200 s por imagen en un Mac M2 Max | Apache-2.0 | **Ya no se usa** (más de 30 s por imagen); sigue disponible con `PACKSHOT_PROVIDERS=…,comfy` |
| Qwen-Image-Edit-2509 | Versión anterior: más deriva que la 2511 | 0,03 $/MP en fal | Apache-2.0 | No se usa (sustituido por 2511) |
| Qwen-Image-2.1 / 2.1-Turbo | Hasta 10 referencias y salida RGBA | — | **Qwen Research License: no comercial** | Descartado |
| Gemini «Nano Banana» 2.1, OpenAI gpt-image-2.x | Editores generales, sin garantías específicas para prendas | 0,03–0,21 $ | Permiten uso comercial; marca SynthID (Gemini) | No integrados; `gpt-image-1` se cerró el 23/10/2026 |

El orden es configurable: `PACKSHOT_PROVIDERS=fashn,fal,mlx` (por defecto, sin ComfyUI). Se usa el
primero configurado y disponible. Si un proveedor falla sin posibilidad de reintento, se pasa al
siguiente. El último intento usa el proveedor de reserva, si lo hay.

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

### Corrección de tono de las prendas oscuras

Los modelos pequeños (klein) iluminan la foto de estudio por igual y aclaran los tejidos oscuros: el
polo negro de la evaluación salía gris claro. Antes del control,
[`tone.ts`](../services/api/src/modules/catalog-photo/tone.ts) compara la claridad del cuerpo de la
prenda (percentil 30 de L\* en CIELAB, que ignora brillos, logotipos y ribetes blancos) en el recorte
del usuario y en la foto generada. Si la prenda es oscura (L\* ≤ 42 en la foto) y la generada es al
menos 6 puntos más clara, aplica a toda la imagen la curva L' = 100·(L/100)^γ, con γ ≤ 2,5 elegido
para igualarlas.

- La curva deja fijo el blanco del fondo y el negro, no crea halos en el borde y no cambia el tono
  (a\* y b\* no se tocan).
- Solo oscurece, y nunca toca las prendas claras o de tono medio: en ellas la luz de la foto del
  usuario engaña más que el modelo (la camiseta gris en sombra mide 50 y es gris claro).
- **Límite:** iguala la foto del usuario, no el color real. Una prenda negra fotografiada con flash
  queda gris antracita (el polo: de 70 a 41), no negra como con Qwen.

### Cuándo se pide otra foto

Con el flujo por defecto (`studio`), solo si lo marcado no es ropa: una prenda cortada, pequeña, puesta o
tapada se reconstruye entera a partir de su descripción, y el mensaje lo dice.

Con el flujo anterior (`packshot`), si la prenda (parte de arriba, de abajo, vestido o abrigo) sale
**cortada por dos o más bordes** del encuadre, o mide menos de 220 px. En ese caso la app explica por qué y
ofrece «Hacer otra foto» o «Generar de todos modos» (`force: true`).

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
| `PACKSHOT_PROVIDERS` | `fashn,fal,mlx` | orden de los generadores (`comfy` añade Qwen-Image-Edit, >30 s) |
| `IMAGEGEN_MLX_URL` | — | servidor local sin ComfyUI ([`run-mlx.sh`](../services/imagegen/run-mlx.sh)): FLUX.2 klein 4B (foto de estudio, restaurar, probador) + Qwen3.5-35B-A3B (detectar, describir, comprobar) |
| `CATALOG_STUDIO_PROMPT` | `studio` | `studio`: foto de estudio primero y recorte después; `packshot`: el flujo anterior (fondo blanco) |
| `IMPORT_VLM_DETECTION` | `true` | al importar, el modelo de visión y lenguaje del servidor MLX detecta y describe las prendas; sin él, el detector del servicio de visión |
| `FASHN_API_KEY` · `FASHN_GENERATION_MODE` · `FASHN_RESOLUTION` · `FASHN_CENTS_PER_CREDIT` | — · `balanced` · `1k` · 7,5 | FASHN |
| `FAL_KEY` · `FAL_PACKSHOT_MODEL` · `FAL_COST_CENTS` | — · `fal-ai/qwen-image-edit-2511` · 3,5 | fal.ai |
| `IMAGEGEN_COMFY_URL` · `IMAGEGEN_PACKSHOT_WORKFLOW` | — · `packshot` | ComfyUI propio: Qwen-Image-Edit (solo si `PACKSHOT_PROVIDERS` incluye `comfy`) |
| `PACKSHOT_MAX_ATTEMPTS` · `PACKSHOT_TIMEOUT_MS` | 3 · 900000 | reintentos y tiempo máximo |
| `CATALOG_DAILY_SEARCHES_PER_USER` · `CATALOG_DAILY_GENERATIONS_PER_USER` · `CATALOG_MONTHLY_BUDGET_CENTS` | 40 · 20 · 5000 | control de costes de los proveedores de pago |
| `CATALOG_DAILY_LOCAL_GENERATIONS_PER_USER` | 300 | intentos al día por usuario con los generadores propios (MLX, ComfyUI): un armario entero de una vez |
| `CATALOG_SEARCH_CACHE_DAYS` · `CATALOG_PHOTO_CONCURRENCY` | 30 · 2 | caché y cola |

### Credenciales que faltan en este entorno (24/11/2026)

Paso a paso para conseguir cada una (webs, menús, costes y decisiones): [configurar-foto-catalogo.md](configurar-foto-catalogo.md).

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
- **Velocidad en local**: ~30 s por prenda con el flujo nuevo (1 s el nombre, ~22 s la foto, ~7 s el
  control) y ~3 min con `packshot` (Qwen) en el Mac de desarrollo; mucho más si la memoria se llena
  (ComfyUI, probador y visión a la vez). Alta tarda segundos porque genera en paralelo en servidores
  con GPU; en un solo Mac, un modelo de 4 B parámetros no baja de ~20 s. Con FASHN, ~40 s según su
  documentación; con fal.ai, sin medir.
- **El flujo nuevo aún falla**: 30 de 50 prendas aptas a ciegas
  ([evidencia](evidence/foto-estudio-vlm-2026-11-25.md)). Fallan:
  - detecciones erróneas del VLM (5 de 50);
  - largos y siluetas (shorts muy cortos dibujados por la rodilla);
  - detalles inventados (cordones, logotipos).

  La presentación (50 de 50) y el color (44 de 50) ya no son el problema.
- **Fotos de tiendas por referencia**: pueden dejar de verse si la tienda cambia la URL o bloquea el
  *hotlinking*. La app vuelve entonces a la foto del usuario.
- **Revisión legal pendiente**: uso de fotos de tiendas sin acuerdo (aunque sea por referencia),
  condiciones de SerpApi (*scraping* de Google) y DPA con cada proveedor.
