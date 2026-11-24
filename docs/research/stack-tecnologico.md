# Investigación técnica: stack de DressIt

> Fecha de la investigación: **2026-11-24**. Todas las cifras (versiones, límites, licencias) se han comprobado en fuentes primarias en esa fecha: documentación oficial, fichas de modelos, ficheros de licencia, registros npm/PyPI y API de Hugging Face y GitHub. Si un dato no se ha podido confirmar en una fuente primaria, se indica expresamente.
>
> Alcance: puntos 1 a 5 del encargo (meteorología, visión, móvil, backend y recomendación de outfits). El inventario de competidores está en [`competidores.md`](./competidores.md).

## 0. Resumen ejecutivo

| Área | Recomendación | Motivo principal |
|---|---|---|
| Meteorología | **Open-Meteo** (Forecast + Geocoding). Plan gratuito solo en desarrollo; **plan Standard de pago desde el lanzamiento**. AEMET OpenData como fuente secundaria o de avisos. | La versión gratuita es solo para uso no comercial, y una app con suscripción o anuncios es comercial según sus propios términos. |
| Embeddings y zero-shot | **`Marqo/marqo-fashionSigLIP`** (Apache-2.0, 768 dimensiones, 224 px). Para búsqueda en español libre, opcionalmente `google/siglip2-base-patch16-224` (multilingüe). | Es el mejor modelo de moda con licencia permisiva y funciona con open_clip y transformers. Ninguno de los modelos de moda es multilingüe. |
| Detección multiprenda | **`IDEA-Research/grounding-dino-tiny`** (Apache-2.0); alternativa `google/owlv2-base-patch16-ensemble` (Apache-2.0). A medio plazo, ajustar RF-DETR (Apache-2.0) con datos propios. | Funciona sin entrenamiento. **Evitar Ultralytics** (AGPL-3.0, que cubre también los pesos entrenados) **y DeepFashion2** (uso no comercial). |
| Recorte y segmentación | **BiRefNet_lite** (MIT) para quitar el fondo de una prenda y **SAM 2.1 hiera-small** (Apache-2.0) con prompt de caja en fotos con varias prendas. En el móvil, primero se intenta recortar en el propio dispositivo (Vision en iOS 17+ y ML Kit en Android). | **El modelo por defecto de rembg ahora es `bria-rmbg`**, de uso no comercial, así que hay que fijar siempre el modelo explícitamente. |
| Móvil | **Expo SDK 58** (React Native 0.88, React 19.3) con development builds. **`expo-share-intent` v9** para compartir en iOS y Android. | Es compatible con SDK 58, incluye config plugin y permite inyectar JavaScript en el preprocesado de Safari, con lo que se puede leer el JSON-LD de la página. |
| Backend | Fastify 5.12, Kysely 0.29 con kysely-codegen 0.20, pgvector 0.8.7 (extensión) y 0.3.1 (npm), BullMQ 6 (instalando ioredis aparte) y `@node-rs/argon2`. | Todo está mantenido y es compatible con Node 24, el que usa el repositorio (`.nvmrc` = 24). |
| SSRF | Un **`Agent` de undici con `connect.lookup` propio** que valida cada IP resuelta con ipaddr.js, más redirecciones manuales revalidadas y límites de tamaño y tiempo. Además, control de salida a nivel de red. | Es lo que recomienda OWASP: validar la IP con la que realmente se conecta, sin ventana entre comprobación y uso. `request-filtering-agent` no funciona con el `fetch` nativo. |
| Outfits | Reglas y puntuación (slots, formalidad, color en LCh, clo térmico) + embeddings + re-ranking MMR. Los datasets públicos (Polyvore) sirven para investigar y evaluar, no para entrenar un producto sin revisión legal. | Permite arrancar sin entrenar modelos y deja hueco para personalizar después. |

---

## 1. Meteorología

### 1.1 Open-Meteo: términos de uso

**Uso gratuito: solo no comercial.**
- Los términos dicen: *"You may only use the free API services for non-commercial purposes."* Consideran comercial cualquier *"Websites or apps that have subscriptions or display advertisements."* Una app con plan premium o con publicidad necesita, por tanto, suscripción.
- Límites del plan gratuito: **600 llamadas/min, 5.000/h, 10.000/día y 300.000/mes**, contados por IP y por aplicación. La página de términos es algo incoherente: en el texto dice "menos de 10.000/día" y en la tabla da 10.000/día y 300.000/mes.
- La propia página de precios lo admite para la fase de prototipo: *"Use the free tier for evaluation and prototyping."*

**Planes de pago.** Según la página de precios, *"A subscription grants a commercial use licence and an API key for the dedicated customer endpoint"*.

| Plan | Llamadas/mes | Notas |
|---|---|---|
| Standard | 1M | No incluye las API de histórico, clima, ensemble ni radiación satelital. |
| Professional | 5M | Incluye histórico, clima y ensemble. |
| Enterprise | Más de 50M | Contacto comercial. |

- Endpoint: `https://customer-api.open-meteo.com/...`, añadiendo `&apikey=...` a la petición. Con la clave, Geocoding también usa el prefijo `customer-`.
- La página de precios actual no muestra importes en el HTML estático. La última cifra pública que he encontrado es del blog oficial de Open-Meteo (12-06-2023): **Standard a 29 $/mes y Professional a 99 $/mes**. Hay que confirmarlo en el portal antes de presupuestar.
- **Cómputo de llamadas:** una petición con **más de 10 variables o más de 2 semanas** cuenta como varias llamadas, con fracciones (por ejemplo, 15 variables equivalen a 1,5 llamadas). Por eso conviene pedir 10 variables o menos por petición (ver 1.2).
- Los límites mensuales no se aplican de forma estricta; se envían avisos por email al 80, 90 y 100 %.

**Atribución.** Los datos de la API se ofrecen bajo **CC BY 4.0**.
- Hay que mostrar un enlace junto a cualquier sitio donde se presenten los datos. El ejemplo de la propia página es `<a href="https://open-meteo.com/">Weather data by Open-Meteo.com</a>`.
- Hay que enlazar la licencia, *"indicate if changes were made"* y no sugerir que Open-Meteo avala la app.
- Los datos de localización de Geocoding son de **GeoNames** (*"Location data based on GeoNames"*). GeoNames publica su gazetteer bajo CC BY 4.0.
- El código del servidor de Open-Meteo es **AGPLv3**. Solo importa si se autoaloja; consumir la API no tiene implicaciones.

### 1.2 Forecast API: parámetros que necesitamos

Endpoint: `GET https://api.open-meteo.com/v1/forecast`. En producción, `https://customer-api.open-meteo.com/v1/forecast?...&apikey=KEY`.

| Variable | Tipo | Unidad | Semántica en la documentación |
|---|---|---|---|
| `temperature_2m` | hourly | °C | Instantánea, a 2 m. |
| `apparent_temperature` | hourly | °C | Sensación térmica: combina wind chill, humedad y radiación. **Es la entrada principal de la regla de abrigo.** |
| `precipitation_probability` | hourly | % | Probabilidad de más de 0,1 mm **en la hora anterior**. Sale de ensembles de unos 0,25° (~27 km) con 30 miembros. |
| `precipitation` | hourly | mm | Suma de la hora anterior (lluvia, chubascos y nieve). |
| `wind_speed_10m` | hourly | km/h (por defecto) | Instantánea, a 10 m. Se puede cambiar con `wind_speed_unit=ms\|mph\|kn`. |
| `relative_humidity_2m` | hourly | % | Instantánea. |
| `uv_index` | hourly | índice | Media de la hora anterior. |
| `temperature_2m_max` / `temperature_2m_min` | daily | °C | Agregados diarios. |
| (opcional) `weather_code`, `precipitation_probability_max`, `precipitation_sum`, `uv_index_max` | daily | — | El `weather_code` diario es el fenómeno más severo del día. |

Otros parámetros:
- **`timezone`**: por defecto `GMT`. Acepta nombres IANA o `auto`, y **es obligatorio si se piden variables diarias**.
- **Aviso sobre el horario de verano:** el offset UTC se fija en el momento de la petición (`utc_offset_seconds`) y *"Daylight saving time (DST) changes within the requested range are ignored"*. La documentación recomienda `timeformat=unixtime` y convertir en la app con la zona IANA que devuelve la respuesta. En España conviene usar `Europe/Madrid`, o `Atlantic/Canary` en Canarias, o directamente `auto`.
- **`forecast_days`**: de 0 a 16, 7 por defecto. **`past_days`**: de 0 a 92. Para granularidad fina existen `forecast_hours` y `past_hours`.
- **`current=`**: acepta las mismas variables horarias y se calcula con datos cada 15 minutos.
- **`models`**: `auto`/`best_match` por defecto.
- **`cell_selection`**: `land` por defecto, que elige una celda en tierra con altitud similar. Es útil en la costa.
- **Errores**: HTTP 400 con `{"error": true, "reason": "..."}`.

**Petición recomendada** (10 variables, que cuentan como 1,0 llamada; la precipitación diaria y el UV máximo se derivan de los datos horarios):

```
https://api.open-meteo.com/v1/forecast
  ?latitude=40.4168&longitude=-3.7038
  &hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,wind_speed_10m,relative_humidity_2m,uv_index
  &daily=temperature_2m_max,temperature_2m_min,weather_code
  &timezone=auto&timeformat=unixtime&forecast_days=7
```

Notas de implementación:
- **Caché en Redis por celda.** Redondear las coordenadas a 2 decimales (~1 km), con TTL de 30 a 60 minutos. Así casi todas las peticiones de usuarios de la misma ciudad salen de la caché.
- Se admiten varias coordenadas separadas por comas, pero cada ubicación cuenta como llamada.
- **No guardar la ubicación exacta del usuario**: basta con la celda redondeada (minimización RGPD).

### 1.3 Geocoding API

- Endpoint: `GET https://geocoding-api.open-meteo.com/v1/search`. Hay otro para buscar por id: `/v1/get?id=`.
- Parámetros:
  - `name`: obligatorio y de 2 caracteres como mínimo. Con 2 caracteres la coincidencia es exacta; con 3 o más es **por prefijo normalizado, no fuzzy**, sin distinguir mayúsculas ni tildes. Se puede afinar con `"Valencia, ES"`.
  - `count`: 10 por defecto, hasta 100.
  - `language`: `en` por defecto. Con `es`, devuelve nombres traducidos cuando existen.
  - `countryCode`: ISO-3166-1 alfa-2. Con `ES` se evita la ambigüedad entre abreviaturas de admin1 y códigos de país.
  - `format`: `json` o `protobuf`.
  - `apikey`: solo para uso comercial.
- Campos de respuesta: `id`, `name`, `latitude`, `longitude`, `elevation`, `feature_code`, `country_code`, `country`, `admin1`…`admin4` (con sus `_id`), `timezone`, `population` y `postcodes`.
- Ejemplo: `https://geocoding-api.open-meteo.com/v1/search?name=Alcal&count=10&language=es&countryCode=ES`.
- La app debería ofrecer el selector "Usar mi ubicación aproximada" (ver 3.6) y una búsqueda por ciudad con este endpoint. Con `timezone` del resultado se rellena el perfil del usuario.

### 1.4 AEMET OpenData (alternativa española)

- **API key gratuita**, solicitada desde `opendata.aemet.es/centrodedescargas/altaUsuario`. Según las FAQ v1.4 (28-07-2025), las claves pedidas desde el 13-09-2017 tienen **validez indefinida**. Se envía en la cabecera `api_key`.
- **Límite: 40 peticiones por minuto y usuario**, más un límite global. Si se supera, devuelve **HTTP 429** "Too Many Requests".
- **Respuesta en dos pasos.** La primera llamada devuelve un JSON con las URL `datos` y `metadatos`, que son temporales (unos 5 minutos). Cada petición útil cuesta, por tanto, dos llamadas.
- Endpoints relevantes:
  - `/opendata/api/prediccion/especifica/municipio/diaria/{municipio}`
  - `/opendata/api/prediccion/especifica/municipio/horaria/{municipio}`

  Ambos usan el código INE del municipio (5 dígitos), y el maestro de municipios está en `/api/maestro/municipios`. Hay avisos CAP en `/api/avisos_cap/...`.
- **Reutilización** (nota legal; el documento está fechado en noviembre de 2016):
  - Se permite el uso **comercial y no comercial** bajo la Ley 37/2007, modificada por la Ley 18/2015, y el RD 1495/2011.
  - En servicios de valor añadido hay que citar *"Fuente: AEMET"* o *"Información elaborada utilizando, entre otras, la obtenida de la Agencia Estatal de Meteorología"*.
  - No se puede desnaturalizar la información ni sugerir que AEMET avala la app, y hay que indicar la fecha de actualización si existe.
- **Valoración:** sirve como fuente oficial gratuita con uso comercial, pero tiene más fricción que Open-Meteo: dos pasos, códigos INE, 40 peticiones/min, sin coordenadas arbitrarias y un servidor que a veces no responde (durante esta investigación `opendata.aemet.es` dio timeouts). **Uso recomendado: avisos meteorológicos o respaldo, no fuente principal.**

---

## 2. Modelos de visión con uso comercial

### 2.1 Versiones de referencia (PyPI, 2026-11-24)

`transformers` 5.24.0 (Python ≥3.11) · `torch` 2.15.0 · `open-clip-torch` 4.2.2 · `onnxruntime` 1.32.0 · `rembg` 2.0.87 (Python ≥3.11) · `fastapi` 0.165.0 · `sam2` 1.1.0 (el paquete PyPI `sam2` no publica versión desde 12-2024; mejor usar SAM 2 desde transformers).

### 2.2 Embeddings de moda y zero-shot

| Modelo (HF id) | Licencia de los pesos | Base y datos de entrenamiento | Dim. del embedding | Imagen | Tamaño |
|---|---|---|---|---|---|
| **`Marqo/marqo-fashionSigLIP`** | Apache-2.0 | Ajuste fino (GCL) de ViT-B-16-SigLIP (WebLI) con *"over 1M fashion products"*. **La fuente de los datos no se declara.** Modelo solo en inglés (tokenizer SigLIP con 32k de vocabulario y contexto de 64). | **768** | 224×224, normalización 0,5/0,5, *squash* | ~0,2B parámetros; 813 MB en fp32. ONNX de visión: 372 MB fp32 / 94 MB int8 / 54 MB q4f16. ONNX de texto: 441 MB / 111 MB int8. |
| `Marqo/marqo-fashionCLIP` | Apache-2.0 | Ajuste fino de ViT-B-16 `laion2b_s34b_b88k` (LAION-2B) con los mismos datos no declarados. | **512** | 224 (mean/std de CLIP) | ~0,15B parámetros; 599 MB fp32. ONNX de visión: 345 MB / 87 MB int8. |
| `patrickjohncyh/fashion-clip` (FashionCLIP 2.0) | MIT | Ajuste fino de `laion/CLIP-ViT-B-32-laion2B-s34B-b79K` con unos 800K productos de Farfetch (dataset *"awaiting official release"*, no publicado). La ficha avisa de sesgo hacia fotos de producto centradas sobre fondo blanco y de suposiciones de género. | **512** | 224, patch 32 | 605 MB |
| `google/siglip2-base-patch16-224` | Apache-2.0 | WebLI, multilingüe ("multilingual vision-language encoders"). WebLI no es público. | **768** | 224 (también hay 256/384/512 y NaFlex) | ~0,4B parámetros; **1,5 GB**, por el vocabulario multilingüe de 256k tokens |
| `google/siglip-base-patch16-224` (SigLIP 1) | Apache-2.0 | WebLI, en inglés. | 768 | 224 | 813 MB |

Según Marqo, FashionSigLIP mejora a FashionCLIP 2.0 en recall y MRR sobre 6 datasets (por ejemplo, text-to-image AvgRecall 0,231 frente a 0,163). Es un benchmark del propio fabricante.

**Carga de FashionSigLIP:**

```python
# open_clip
import open_clip, torch
model, _, preprocess = open_clip.create_model_and_transforms('hf-hub:Marqo/marqo-fashionSigLIP')
tokenizer = open_clip.get_tokenizer('hf-hub:Marqo/marqo-fashionSigLIP')
with torch.no_grad():
    img = model.encode_image(preprocess(pil).unsqueeze(0), normalize=True)   # (1, 768)
    txt = model.encode_text(tokenizer(["a red midi skirt"]), normalize=True)

# transformers (requiere trust_remote_code)
from transformers import AutoModel, AutoProcessor
model = AutoModel.from_pretrained('Marqo/marqo-fashionSigLIP', trust_remote_code=True)
processor = AutoProcessor.from_pretrained('Marqo/marqo-fashionSigLIP', trust_remote_code=True)
```

**Carga de SigLIP 2:**
- Con transformers: `AutoModel`/`AutoProcessor` y `get_image_features`, o `pipeline("zero-shot-image-classification", model="google/siglip2-base-patch16-224")`. El texto debe usar `padding="max_length", max_length=64`, como se entrenó.
- Con open_clip: `create_model_and_transforms('ViT-B-16-SigLIP2', pretrained='webli')`, que apunta a `timm/ViT-B-16-SigLIP2`, también Apache-2.0.

**Recomendación:**
- Usar **FashionSigLIP** para:
  - embeddings de imagen (búsqueda de similares, deduplicación y compatibilidad);
  - etiquetado zero-shot con un **vocabulario cerrado en inglés** (categoría, subcategoría, estampado, material y estilo) que se traduce a español en la app. Plantilla: `"a photo of a {attr} {category}"`.
- Si se quiere **búsqueda libre en español**, añadir SigLIP 2 base como segundo espacio vectorial (otra columna en pgvector). La alternativa es traducir la consulta con un diccionario de términos de moda.
- Almacenamiento: `vector(768)`, o `halfvec(768)` para ahorrar la mitad, con índice HNSW `vector_cosine_ops`.

**Latencia orientativa en CPU de un Mac Apple Silicon.** No la he medido: torch no está instalado en este equipo, y descargar los pesos requiere autorización. Es una estimación por FLOPs. Un ViT-B/16 a 224 px son unos 17 GFLOPs, lo que da unos **50–150 ms por imagen en CPU** y unos **10–30 ms en MPS**, más rápido aún con lotes. La versión ONNX int8 de Marqo con onnxruntime CPU debería estar en el mismo orden o mejor. **Validar con un benchmark en el Mac de desarrollo antes de fijar los SLA.**

### 2.3 Detección de varias prendas en una foto

| Opción | HF id / paquete | Licencia | Datos y caveats | Peso | Uso |
|---|---|---|---|---|---|
| **Grounding DINO tiny** | `IDEA-Research/grounding-dino-tiny` (también `-base`, 933 MB) | Apache-2.0 (código y pesos) | Checkpoint "OGC": O365, GoldG y Cap4M (pares de imagen y texto de la web). | 689 MB | `AutoProcessor` + `AutoModelForZeroShotObjectDetection`. El prompt va en minúsculas con clases separadas por punto: `"t-shirt. shirt. sweater. jacket. coat. dress. skirt. trousers. jeans. shorts. sneakers. boots. bag."`. Después, `processor.post_process_grounded_object_detection(outputs, threshold=0.35, text_threshold=0.25, target_sizes=...)`. Los valores por defecto de la versión 5.24 son 0,25/0,25. |
| MM Grounding DINO | `openmmlab-community/mm_grounding_dino_tiny_o365v1_goldg` | Apache-2.0 | O365 y GoldG, sin Cap4M. | 692 MB | Misma API. Tiene muy pocas descargas, así que conviene evaluarlo antes. |
| **OWLv2** | `google/owlv2-base-patch16-ensemble` (también `-large-patch14-ensemble`, 1,75 GB) | Apache-2.0 (código y checkpoints de Scenic) | Auto-entrenado con pseudo-etiquetas de WebLI y ajustado con O365/VG. La ficha dice que sus *"primary intended users… are AI researchers"*, pero no prohíbe el uso comercial. | 620 MB | `Owlv2Processor` + `Owlv2ForObjectDetection` y `post_process_grounded_object_detection(threshold=0.1, text_labels=...)`. **La entrada se redimensiona a 960×960** (~3.600 tokens), así que es más lento en CPU. Admite **detección guiada por imagen** (`post_process_image_guided_detection`), útil para "encontrar esta prenda en otra foto". |
| YOLOS-Fashionpedia | `valentinafeve/yolos-fashionpedia` | MIT (pesos) | Fashionpedia: anotaciones **CC BY 4.0**, pero imágenes de terceros (Flickr, Unsplash, Pexels…) con sus propios términos. 46 clases de prendas y partes. | 123 MB | Pequeño y especializado en moda, aunque de mantenimiento comunitario. Exige atribución a Fashionpedia. |
| **RF-DETR / RF-DETR-Seg** (para entrenar con datos propios) | `pip install rfdetr` | **Apache-2.0** para Nano, Small, Medium y Large en detección y para todas las tallas de segmentación | Preentrenado en COCO/O365. Atto, Femto, Pico, XL y 2XL están bajo **PML 1.0**, que no permite autoalojamiento comercial sin el add-on Enterprise. | — | **Es la alternativa comercial a YOLO** para ajustar un detector o segmentador de prendas propio. D-FINE y RT-DETR también son Apache-2.0. |
| ~~Ultralytics YOLO (v8/11/26)~~ | `ultralytics` 8.4.x | **AGPL-3.0** | Su web: *"All Ultralytics YOLO trained models fall under the AGPL-3.0 License by default"*. Un SaaS, una API o una app cerrada necesitan **licencia Enterprise**, con precio a medida. | — | **Descartado** salvo que se compre la licencia. |
| ~~Modelos entrenados con DeepFashion2~~ | — | — | DeepFashion2 (491K imágenes, 13 categorías) solo se descarga tras un formulario de Google que no he podido leer. Su predecesor DeepFashion, del mismo laboratorio (MMLAB CUHK), es explícitamente *"non-commercial research purposes only"* y prohíbe el uso comercial de datos derivados. **Hay que tratarlo como no comercial.** | — | **Descartado.** |

**Recomendación:**
- Usar **Grounding DINO tiny** por defecto solo cuando la foto contenga varias prendas o una persona (espejo o *outfit of the day*), con un vocabulario cerrado y NMS por clase.
- Usar **OWLv2** como segunda opción o para la detección guiada por imagen.
- A medio plazo, cuando haya unas miles de fotos propias etiquetadas con consentimiento, **ajustar RF-DETR-Seg (Apache-2.0)**. Sería más rápido que cualquier modelo zero-shot y no arrastraría las licencias de terceros.

### 2.4 Segmentación y quitar el fondo

**rembg** (MIT, versión 2.0.87 del 06-11-2026; usa onnxruntime con CPU, CUDA o ROCm):

> **Atención:** el modelo por defecto de rembg ahora es **`bria-rmbg`** (RMBG-2.0, 1,02 GB), cuya licencia *"requires a paid agreement for commercial use"*. **Hay que pasar siempre `new_session("<modelo>")` de forma explícita.**

| Modelo de rembg | ONNX | Licencia de pesos y origen | Datos y caveats |
|---|---|---|---|
| `u2net` / `u2netp` / `silueta` | 176 / 4,6 / 44 MB | Apache-2.0 (U-2-Net) | DUTS (dataset académico) |
| `u2net_cloth_seg` | 176 MB | MIT (levindabhi/cloth-segmentation, **repositorio archivado**) | Entrenado con unas 45K imágenes de iMaterialist (Fashion) 2019, una competición de Kaggle sujeta a sus propias reglas. Solo da 3 clases (parte superior, inferior y cuerpo entero) y **está pensado para retratos de personas**, no para fotos de prendas sueltas. |
| `isnet-general-use` | 179 MB | Apache-2.0 (xuebinqin/DIS) | **DIS5K: los términos dicen *"available for non-commercial use in research or educational purpose"*.** |
| `birefnet-general` / `-lite` | 973 / 224 MB | MIT | Entrenado con DIS5K-TR, DUTS, HRSOD, UHRSD, HRS10K, P3M-10k y humans, entre otros, **incluido DIS5K, que es no comercial.** |
| `birefnet-portrait`, `-dis`, `-hrsod`, `-cod`, `-massive`, `BiRefNet_HR`, `BiRefNet_dynamic` | 973–1.099 MB | MIT | Igual que el anterior. |
| `sam` (vit_b cuantizado) | 100 + 9 MB | Apache-2.0 | SA-1B |
| ~~`bria-rmbg`~~ | 1.024 MB | **CC BY-NC 4.0**; el uso comercial exige acuerdo con BRIA | Datos con licencia de BRIA |

**BiRefNet directo** (`ZhengPeng7/BiRefNet`, 444 MB en safetensors, y `ZhengPeng7/BiRefNet_lite`, 178 MB):
- Licencia MIT. Entrada de 1024×1024.
- Se carga con `AutoModelForImageSegmentation.from_pretrained(..., trust_remote_code=True)`.
- El autor publica ONNX. En una A100, Swin-L tarda ~165 ms y Swin-T ~94 ms con ONNX. **En CPU será del orden de segundos** (estimación).

**SAM 2 / 2.1**:
- Código y checkpoints con licencia **Apache-2.0**.
- Ids en HF: `facebook/sam2.1-hiera-tiny` (38,9M parámetros, 156 MB), `-small` (46M, 184 MB), `-base-plus` (80,8M, 324 MB) y `-large` (224,4M, 898 MB).
- Requiere Python ≥3.10 y torch ≥2.5.1.
- El repositorio oficial asume CUDA: usa un kernel opcional que requiere `nvcc` y `autocast("cuda")`. **En un Mac conviene usar SAM 2 desde transformers en CPU o MPS** (`PYTORCH_ENABLE_MPS_FALLBACK=1` para las operaciones que falten).
- Con prompt de caja (la que sale de Grounding DINO), **tiny o small son viables en CPU**: estimo entre 0,5 y 2 s por imagen para el codificador; el decodificador es casi gratis.

**SAM 3** (`facebook/sam3`, noviembre de 2025):
- Hace **segmentación por concepto con prompt de texto**, por ejemplo "jacket", y devuelve todas las instancias. Usa `Sam3Model`/`Sam3Processor` de transformers.
- Licencia **"SAM License"**: gratuita y con uso comercial permitido, pero con condiciones (controles de exportación, prohibición de usos militares o ITAR, terminación si se demanda a Meta por propiedad intelectual y obligación de incluir la licencia si se redistribuye).
- Repositorio **gated** con aprobación manual. **~0,9B parámetros y 3,4 GB: demasiado pesado para CPU** en el MVP, aunque es interesante para un futuro servicio con GPU.

**Sobre los datos de entrenamiento.** Casi todos los modelos de recorte de alta calidad con licencia permisiva (BiRefNet, IS-Net) se han entrenado con datasets académicos que prohíben el uso comercial (DIS5K). Si las restricciones del dataset afectan a los pesos es una cuestión jurídica abierta. Pasos recomendados:
1. Documentarlo en un ADR.
2. Pedir revisión legal antes del lanzamiento.
3. Priorizar el **recorte en el propio dispositivo** (2.5), que no tiene ese riesgo y además ahorra servidor.
4. Mantener la opción de reentrenar BiRefNet_lite con datos propios o con licencia.

### 2.5 Recorte en el dispositivo

**iOS: `VNGenerateForegroundInstanceMaskRequest`.**
- Disponible en iOS y iPadOS 17.0+, macOS 14.0+, Mac Catalyst 17+ y visionOS 1+.
- Devuelve `VNInstanceMaskObservation`, con `allInstances` y `generateMaskedImage(ofInstances:from:croppedToInstancesExtent:)`.
- Es el motor de la función "levantar sujeto" de Fotos. Es gratis y no envía nada al servidor.
- Los módulos de terceros indican que necesita **dispositivo real**, no el simulador.

**Android: ML Kit Subject Segmentation.**
- Está en **beta**. Dependencia: `com.google.android.gms:play-services-mlkit-subject-segmentation:16.0.0-beta1`. Requiere **minSdk 24**.
- El modelo no va dentro de la app: lo descarga Google Play services. Se puede forzar la descarga al instalar con el meta-data `com.google.mlkit.vision.DEPENDENCIES=subject_segment`; si no, las primeras peticiones no devuelven resultado mientras descarga.
- Añade unos 200 KB a la app.
- Opciones: `enableForegroundBitmap`, `enableForegroundConfidenceMask` y `enableMultipleSubjects`. Recomienda imágenes de al menos 512×512.

**Módulos React Native / Expo disponibles** (todos MIT y todos con poca tracción):

| Paquete | Última versión | iOS | Android | Notas |
|---|---|---|---|---|
| `@six33/react-native-bg-removal` | 1.3.4 (09-01-2026) | Vision `VNGenerateForegroundInstanceMaskRequest` (iOS 17+); en iOS 15.1–16 lanza `REQUIRES_API_FALLBACK` | ML Kit (API 24+) | 23 estrellas. El más completo. |
| `@westwood-dev/expo-segmentation` | 0.1.0 (07-06-2026) | Vision (iOS 17) | ML Kit (API 24) | Módulo Expo con `isAvailable()`. Muy nuevo (0 estrellas). |
| `react-native-background-remover` (atlj) | 0.3.2 (17-12-2024) | Vision (iOS 15+) | ML Kit | 102 estrellas, pero **sin actividad desde 2024**. |
| `react-native-subject-lift` | 0.2.0 (03-2026) | VisionKit `ImageAnalysisInteraction` (iOS 16+) | ML Kit + Reanimated | Interacción tipo "levantar sujeto"; no es procesado por lotes. |

**Recomendación:** escribir un **módulo Expo local** (Swift + Kotlin, unas 150 líneas; `npx create-expo-module --local`) inspirado en `@six33/react-native-bg-removal`, en vez de depender de paquetes con un solo mantenedor. Si el dispositivo no lo soporta (iOS menor que 17, sin Play services o con error), se recurre al recorte en el servidor.

### 2.6 Pipeline recomendado para el Mac de desarrollo

**Pipeline por defecto** (servicio Python FastAPI, CPU o MPS):

1. **Ingesta**: corregir la orientación EXIF, **eliminar GPS y EXIF**, redimensionar a 1536 px como máximo y calcular un hash perceptual (pHash) para detectar duplicados.
2. **Clasificar el tipo de foto** con FashionSigLIP zero-shot: "prenda suelta o flat-lay", "persona con outfit" o "captura de tienda".
3. **Si hay varias prendas o una persona**: detectar con Grounding DINO tiny, aplicar NMS y segmentar cada caja con **SAM 2.1 hiera-small**.
4. **Si es una prenda suelta**: usar la máscara del dispositivo si llega; si no, **BiRefNet_lite** (transformers) o rembg con `birefnet-general-lite` en ONNX.
5. **Embedding** de FashionSigLIP (768 dimensiones), **atributos zero-shot** (categoría, estampado, manga, largo, material, estilo y formalidad) y **colores dominantes** con k-means en CIELAB sobre los píxeles de la máscara (ver 5.3).
6. Guardar en S3 el PNG recortado y su miniatura WebP, y en Postgres/pgvector los vectores y atributos.

Descargas aproximadas: Grounding DINO tiny 689 MB + SAM 2.1 small 184 MB + BiRefNet_lite 178 MB + FashionSigLIP 813 MB, en torno a **1,9 GB**. SigLIP 2 base añadiría 1,5 GB.

Latencia estimada en CPU de Apple Silicon (**sin medir**; hay que validarla):

| Paso | Estimación |
|---|---|
| Embedding | 0,05–0,15 s |
| BiRefNet_lite a 1024 px | 0,5–2 s |
| Grounding DINO tiny | 1–3 s |
| SAM 2.1 small | 0,5–2 s |
| **Foto de una prenda** | **~1–2 s** |
| **Foto de outfit con 4 prendas** | **~3–7 s** |

Con MPS se espera entre 2 y 5 veces menos. Se procesa en BullMQ, nunca en la petición HTTP.

**Pipeline ligero de respaldo** (para máquinas modestas o CI):
- Recorte **en el dispositivo** como camino principal; en el servidor, rembg con `isnet-general-use` (179 MB) o `birefnet-general-lite` (224 MB) en onnxruntime CPU.
- Embeddings con **`Marqo/marqo-fashionCLIP`** en ONNX int8: visión 87 MB y texto 64 MB, 512 dimensiones.
- Sin detector: el usuario sube una prenda por foto o recorta a mano.
- Descarga total de unos 400 MB y menos de 1 s por prenda en CPU (estimación).

---

## 3. Móvil (Expo / React Native)

### 3.1 Versiones actuales

| Elemento | Versión | Notas |
|---|---|---|
| **Expo SDK** | **58** (`expo` 58.0.26) | Publicado el 15-10-2026. Según la tabla de la documentación, mínimos de iOS 16.4+ y Android 7+, compileSdk 37, targetSdk 36 y Xcode 26.4+. El post de lanzamiento dice que está *"built for iOS 27"*. |
| **React Native** | **0.88.1** | La que incluye SDK 58 (`bundledNativeModules.json`). |
| React | 19.3.0 | |
| `expo-router` | ~58.0.32 | Desde SDK 55 los paquetes `expo-*` siguen la numeración del SDK. En SDK 58 se estabilizan data loaders, SSR, middleware, native tabs y toolbars. Se rehace el núcleo de navegación: hay que **leer la guía de migración**. `withLayoutContext` pasa a estar obsoleto en favor de `integrateWithRouter`. |
| Reanimated / Worklets / Gesture Handler | 4.7.1 / 0.13.0 / ~3.3.0 | Versiones incluidas en SDK 58. En npm ya hay 4.8.0 / 0.14.0 / 3.5.0. |

**Expo Go.** Al publicarse SDK 58 se anunció que la versión de Expo Go para SDK 58 llegaría *"within a few weeks"*. Desde el 03-09-2026 Expo Go exige iniciar sesión. Como DressIt necesita módulos nativos (share extension, segmentación), **hay que trabajar con development builds (`expo-dev-client`) desde el primer día**. `npx create-expo-app --template default@sdk-58` crea el proyecto en SDK 58.

### 3.2 Compartir desde otras apps

| Librería | Versión | iOS | Android | Compatibilidad con SDK 58 | Preprocesado JS en Safari |
|---|---|---|---|---|---|
| **`expo-share-intent`** (achorein) | **9.0.0** (21-10-2026) | Share extension que **redirige a la app principal** | Intent filters `text/*`, `image/*`, multiarchivo… | **Sí.** Su tabla de versiones da "SDK 58 → 9.0+", y el `peerDependencies` exige `expo ^58`, `expo-linking ≥58.0.13` y `expo-constants ≥58.0.12`. | **Sí.** Genera un `ShareExtensionPreprocessor.js` (`NSExtensionJavaScriptPreprocessingFile`) que recoge `document.title` y todas las `<meta>`. La opción **`preprocessorInjectJS`** inyecta código propio antes de `completionFunction`. Requiere `NSExtensionActivationSupportsWebPageWithMaxCount` (activo por defecto). |
| `expo-share-extension` (MaxAst) | 5.0.6 (23-02-2026); hay una 6.0.0-beta | **Solo iOS**. Muestra una vista React Native propia dentro de la extensión, al estilo Pinterest. | No | **No verificada.** Su tabla de compatibilidad llega solo hasta SDK 54. | Sí: opción `preprocessingFile`, con resultado en `preprocessingResults`. **Es incompatible con `WebURL`**: deja de llegar `url` y hay que leer `window.location.href`. |
| `react-native-share-menu` / `react-native-receive-sharing-intent` | 6.0.0 (2022) / 2.0.0 (2021) | — | — | Abandonadas | — |

**Recomendación: `expo-share-intent` v9.** Es la única con iOS y Android, config plugin, soporte declarado para SDK 58 y mantenimiento activo. Ejemplo de `app.json`:

```json
["expo-share-intent", {
  "iosActivationRules": {
    "NSExtensionActivationSupportsWebURLWithMaxCount": 1,
    "NSExtensionActivationSupportsWebPageWithMaxCount": 1,
    "NSExtensionActivationSupportsImageWithMaxCount": 10
  },
  "androidIntentFilters": ["text/*", "image/*"],
  "androidMultiIntentFilters": ["image/*"],
  "preprocessorInjectJS": "metas['dressit:jsonld'] = JSON.stringify(Array.from(document.querySelectorAll('script[type=\"application/ld+json\"]')).map(function(s){return s.textContent}).slice(0,5)); metas['dressit:url'] = location.href;"
}]
```

En la app, `shareIntent.meta['dressit:jsonld']` contiene el JSON-LD (`Product` / `Offer`) ya renderizado por Safari.

**¿Puede una share extension de iOS leer el JSON-LD?** **Sí, si se comparte desde Safari.**
- Apple documenta que en las extensiones Share *"you can give users access to web content by asking Safari to run a JavaScript file"*. Hace falta `NSExtensionJavaScriptPreprocessingFile` y que `NSExtensionActivationSupportsWebPageWithMaxCount` sea distinto de cero.
- `run({completionFunction})` se ejecuta en el contexto de la página, con acceso al DOM.

**Limitaciones:**
1. Solo funciona cuando el origen es Safari. Desde Chrome en iOS o desde las apps nativas de tiendas (Zara, Mango, Shein…) normalmente llega solo URL o texto.
2. En Android no existe nada equivalente.
3. Conviene recortar la carga: limitar el tamaño y el número de scripts.

**Por eso el backend debe tener un *fetcher* de URL de producto seguro frente a SSRF (4.6)** que extraiga JSON-LD y OpenGraph cuando la app no los traiga. Hay que respetar robots y los términos de cada tienda.

**Otras implicaciones:**
- `expo-share-intent` no permite una interfaz propia dentro de la extensión: abre la app principal. Para el MVP es una ventaja, porque hay un solo bundle de JavaScript y menos memoria.
- No funciona en Expo Go (se puede desactivar con `useShareIntent({ disabled: true })` para desarrollar otras pantallas).
- Desde la v6 ya no necesita el script post-install.

### 3.3 Otras librerías

| Necesidad | Librería y versión | Notas verificadas |
|---|---|---|
| WebView | `react-native-webview` 14.0.1 (incluida en SDK 58) | Para el navegador de compras dentro de la app con `injectedJavaScript`, que puede leer JSON-LD también en Android. |
| Calendario del sistema | `expo-calendar` 58.0.8 | **Nueva API orientada a objetos** (`ExpoCalendar`, `ExpoCalendarEvent`…). Las funciones antiguas están en `expo-calendar/legacy`, y llamarlas desde el import principal lanza error. En iOS 17 está `requestCalendarPermissions(writeOnly)` y la opción del plugin `writeOnlyAccess`. **`calendar.addEventWithForm()` abre la interfaz del sistema y no necesita permisos en Android**: es ideal para "añadir el outfit al evento". |
| Ubicación aproximada | `expo-location` 58.0.22 | `Accuracy.Lowest` (~3 km) y `Low` (~1 km). La respuesta de permisos trae `ios.accuracy: 'full' \| 'reduced'` (iOS 14+) y `android.accuracy: 'fine' \| 'coarse'`. El plugin añade `ACCESS_COARSE_LOCATION` y `ACCESS_FINE_LOCATION`; **para pedir solo la aproximada hay que excluir `ACCESS_FINE_LOCATION`** con `android.blockedPermissions`, como indica la guía de permisos de Expo. `getLastKnownPositionAsync({maxAge})` es rápido. SDK 58 añade una nueva API en `expo-location/next`. |
| Galería con selección múltiple | `expo-image-picker` 58.0.10 | `allowsMultipleSelection` (Android e iOS 14+), `selectionLimit` (0 = máximo del sistema) y `orderedSelection` (iOS 15+). **Con selección múltiple se ignora `allowsEditing`.** Abrir la galería no necesita permiso (PHPicker). Opciones del plugin: `photosPermission`, `cameraPermission` y `microphonePermission: false`. Recuperar la selección con `getPendingResultAsync` si Android mata la actividad. |
| Cámara | `expo-camera` 58.0.14 | Novedad de SDK 58: `CameraView.scanDocumentAsync`, que escanea documentos de varias páginas. Puede servir para tiquets o etiquetas de composición. |
| Listas | `@shopify/flash-list` 2.3.x | **La v2 solo funciona con New Architecture**, está escrita solo en JavaScript, no necesita `estimatedItemSize` y admite **masonry**, útil para la cuadrícula del armario. |
| Drag and drop | `react-native-sortables` 1.10.1 (activo, ~1k estrellas) | Grid y Flex, Reanimated 3 y 4, autoscroll, compatible con Expo y háptica opcional. Recomendado para reordenar prendas y montar el collage del outfit. |
| | `react-native-reorderable-list` 0.18.3 (activo) | Listas verticales; peer `reanimated >=3.12`. |
| | `react-native-draggable-flatlist` 4.0.3 | Último release en mayo de 2025, con mantenimiento bajo. No se recomienda. |
| Calendario con drag and drop | `@howljs/calendar-kit` 2.5.6 (último release en 10-2025) | Vistas de día, 3 días y semana con eventos arrastrables (Reanimated y Gesture Handler). Sirve para planificar la semana. |
| | `react-native-calendars` 1.1314.0 | Vista mensual, sin drag and drop. **Arrastrar un outfit a un día de un mes** habrá que implementarlo con Gesture Handler y Reanimated (`measure()` de las celdas); ninguna librería lo resuelve de serie. |
| Almacenamiento seguro | `expo-secure-store` 58.0.3 | Keychain y Keystore. Históricamente iOS ha rechazado valores de más de ~2048 bytes, así que conviene guardar tokens, no JSON grande. `keychainAccessible`, `requireAuthentication` y **`accessGroup` para compartir el token con la share extension**. En Android excluye SecureStore del Auto Backup por defecto. |
| i18n | `expo-localization` 58.0.5 + `i18next` 27.2.6 + `react-i18next` 18.0.3 | `getLocales()` y el hook `useLocales()`. La opción `supportedLocales` del plugin activa el idioma por app en los ajustes del sistema. Expo lista react-i18next entre las librerías compatibles. Empezar con `es-ES` y dejar preparado `ca`, `eu`, `gl` y `en`. |

---

## 4. Backend (Node 24, Fastify, Postgres)

### 4.1 Versiones (npm, 2026-11-24)

| Paquete | Versión | Notas |
|---|---|---|
| `fastify` | **5.12.8** | Major actual. Hay `6.0.0-alpha.6` en el tag `next`: **no usarla todavía**. La tabla LTS indica soporte de Node 20 y 22 para la v5; **Node 24 no aparece** en esa tabla, aunque el repositorio usa 24. Hay que cubrirlo en CI. |
| `@fastify/jwt` | 10.2.9 | |
| `@fastify/multipart` | 10.1.9 | Usar `limits.fileSize`, `files` y streams hacia S3. No guardar en memoria. |
| `@fastify/rate-limit` | 11.3.0 | Con un store de Redis (ioredis) para varias instancias. |
| `@fastify/helmet` | 13.2.0 | |
| `@fastify/cors` / `@fastify/under-pressure` | 11.4.3 / 9.2.2 | |
| Validación | `fastify-type-provider-zod` 7.0.0 (zod ≥4.1.5) o `@fastify/type-provider-typebox` 6.3.0 | |
| `kysely` | 0.29.9 | Requiere Node ≥22. |
| `kysely-codegen` | 0.20.0 (16-02-2026) | Admite `kysely >=0.27 <1`. Opciones `--overrides` y `--custom-imports` para tipar columnas `vector` (por ejemplo `"items.embedding":"ColumnType<number[], string, string>"`) y `--camel-case`. |
| `pg` | 8.23.1 | |
| `pgvector` (npm) | 0.3.1 | Requiere Node ≥22. Desde `pgvector/kysely` se importan `toSql`, `l2Distance`, `cosineDistance`, `maxInnerProduct`… Con `pg` se usa `registerTypes` (`registerType` está obsoleto). |
| Extensión pgvector | **0.8.7** | `vector` indexable hasta 2.000 dimensiones y `halfvec` hasta 4.000. Desde la 0.8.0 hay **iterative index scans** (`SET hnsw.iterative_scan = strict_order`) para consultas HNSW con filtro. Para el armario de un usuario (cientos de prendas) basta un escaneo exacto con `WHERE user_id = $1`; HNSW es para el catálogo global de shopping. |
| `bullmq` | **6.7.9** | **La v6 (30-07-2026) trae cambios incompatibles:** ioredis pasa a ser *peer* opcional (**hay que instalarlo aparte**), se eliminan los *repeatable jobs* (se usan Job Schedulers), desaparece `debounce` (se usa deduplicación) y también el estado `paused`. Añade un backend de PostgreSQL opcional. |
| `ioredis` | 6.1.0 | Requiere Node ≥20. |
| `@node-rs/argon2` | 2.2.2 (06-10-2026) | Binarios precompilados (napi-rs), sin node-gyp. **Recomendado.** La alternativa `argon2` 0.45.2 también está mantenida. Parámetros OWASP para argon2id: **m = 19.456 KiB (19 MiB), t = 2, p = 1**, o equivalentes (46 MiB/t=1, 12 MiB/t=3…). |
| `undici` | 8.13.1 | Requiere Node ≥22.19. |
| `ipaddr.js` | 2.5.0 | |
| `@aws-sdk/client-s3` | 3.1176.0 | Compatible con S3 en general: MinIO en desarrollo y R2 o Scaleway en producción. |
| `sharp` | 0.35.5 | Miniaturas en Node, si no se hacen en Python. |

### 4.2 Búsqueda de URL segura frente a SSRF

**Estado de las librerías:**

| Librería | Versión y fecha | Valoración |
|---|---|---|
| `request-filtering-agent` (azu) | 3.3.1 (21-11-2026, activa) | Es un `http.Agent` que valida **la IP a la que se conecta tras resolver el DNS**. Bloquea rangos privados, link-local, 0.0.0.0, IPv4 mapeadas en IPv6, NAT64 y todo IPv6 fuera de `2000::/3`. **Pero *"Node.js's built-in fetch does not support http.Agent"*:** sirve con got, axios o node-fetch, **no con undici ni con `fetch`**. |
| `ssrf-req-filter` | 1.1.1 (05-2024) | Sin actividad. Descartada. |
| `ssrf-agent-guard` | 0.1.14 | Inmadura. |
| `ssrfcheck` | 1.4.0 | Solo valida la cadena de la URL, sin resolver el DNS. Insuficiente. |

**Recomendación: un `Agent` de undici con `connect.lookup` propio.** La opción `connect` de Client y Agent acepta *"every `tls.connect()` option"*, incluido `lookup`. Así la IP que se valida es la misma con la que se conecta, lo que evita el *DNS rebinding*, como pide OWASP: *"Use an HTTP client mechanism that connects to the validated IP while preserving the original hostname"*. Esqueleto:

```ts
import { Agent, fetch } from 'undici';
import dns from 'node:dns';
import ipaddr from 'ipaddr.js';

const V6_GLOBAL = ipaddr.parseCIDR('2000::/3');
export function isPublicIp(ip: string): boolean {
  let a = ipaddr.parse(ip);
  if (a.kind() === 'ipv6' && (a as ipaddr.IPv6).isIPv4MappedAddress()) return false; // bloquear mapeadas
  if (a.kind() === 'ipv4') return a.range() === 'unicast';
  return a.range() === 'unicast' && (a as ipaddr.IPv6).match(V6_GLOBAL);
}

// Node llama a lookup con {all:true} cuando autoSelectFamily está activo (por defecto en Node ≥20)
function safeLookup(hostname: string, opts: any, cb: any) {
  dns.lookup(hostname, { ...opts, all: true }, (err, addrs: any) => {
    if (err) return cb(err);
    const bad = addrs.find((x: any) => !isPublicIp(x.address));
    if (bad || addrs.length === 0) return cb(Object.assign(new Error('SSRF_BLOCKED'), { code: 'SSRF_BLOCKED' }));
    return opts.all ? cb(null, addrs) : cb(null, addrs[0].address, addrs[0].family);
  });
}

export const safeAgent = new Agent({
  connect: { lookup: safeLookup, timeout: 5_000 },
  headersTimeout: 10_000, bodyTimeout: 15_000, connections: 32,
});

export async function safeFetch(raw: string, hops = 0): Promise<Response> {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('SCHEME');
  if (url.port && !['80', '443'].includes(url.port)) throw new Error('PORT');
  if (url.username || url.password) throw new Error('CREDENTIALS');
  // Si el host es una IP literal, net.connect NO llama a lookup: validar aquí
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (ipaddr.isValid(host) && !isPublicIp(host)) throw new Error('SSRF_BLOCKED');
  const res = await fetch(url, { dispatcher: safeAgent, redirect: 'manual',
    headers: { 'user-agent': 'DressItBot/1.0 (+https://dressit.example/bot)', accept: 'text/html,application/xhtml+xml' } });
  if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
    if (hops >= 3) throw new Error('TOO_MANY_REDIRECTS');
    return safeFetch(new URL(res.headers.get('location')!, url).toString(), hops + 1);   // revalida cada salto
  }
  return res; // el llamante debe leer como máximo ~2 MB del stream y comprobar content-type
}
```

**Medidas complementarias:**
- Lista de hosts bloqueados (`localhost`, `*.internal`, `metadata.google.internal`).
- Límite de tamaño del cuerpo, cortando el stream al pasar de 2–3 MB, y lista de *content-type* permitidos.
- Ejecutar el fetcher en un **worker de BullMQ separado**.
- **Control de salida a nivel de red** (security groups o firewall sin acceso a la VPC ni a `169.254.169.254`). OWASP lo considera *"highly recommended"*.
- Registrar los bloqueos.
- Si se usa got o axios en otro punto, `request-filtering-agent` es una alternativa válida.

---

## 5. Compatibilidad de outfits, color, clima y diversidad

### 5.1 Enfoques y datasets

**Enfoques en la literatura:**

| Trabajo | Idea |
|---|---|
| Han et al., *Learning Fashion Compatibility with Bidirectional LSTMs* (ACM MM 2017, arXiv:1707.05691) | Un outfit como secuencia, modelada con una Bi-LSTM; también hace "rellenar el hueco". |
| Vasileva et al., *Learning Type-Aware Embeddings for Fashion Compatibility* (ECCV 2018, arXiv:1803.09196) | Un embedding general con proyecciones por par de tipos (por ejemplo, top↔zapato). Es la referencia clásica para "compatibilidad por tipo". |
| Chen et al., *POG: Personalized Outfit Generation* (KDD 2019, arXiv:1905.01866) | Transformer encoder-decoder personalizado, en producción en Alibaba iFashion. |
| Sarkar et al., *OutfitTransformer* (arXiv:2204.04812, 2022) | Self-attention sobre el conjunto de prendas, con un token de outfit para la compatibilidad y la recuperación de complementarias. |

**Datasets y licencias:**

| Dataset | Licencia | Caveat |
|---|---|---|
| **Polyvore Outfits** (Vasileva) | Código BSD-3-Clause. Dataset en HF `mvasil/polyvore-outfits` (6 GB, *gated*, etiquetado como **CC BY 4.0**). | Las imágenes son de producto, con copyright de las tiendas, y se extrajeron de Polyvore, que ya no existe. La etiqueta CC BY la puso quien lo publicó y **no garantiza los derechos de las imágenes**. |
| Polyvore (Han) | Repositorio `xthan/polyvore-dataset` con Apache-2.0 (código). | Las imágenes originales están en Kaggle. Mismo caveat. |
| POG / iFashion | Sin licencia declarada (`wenyuer/POG`). | Asumir solo investigación. |
| Fashionpedia | Anotaciones CC BY 4.0. | Imágenes de terceros. |
| DeepFashion / DeepFashion2 | No comercial (ver 2.3). | |

**Recomendación práctica para el MVP** (sin entrenar):

1. **Restricciones duras**:
   - Slots obligatorios: `top + bottom | one-piece`, más `shoes`, y `outer` opcional.
   - Nada de prendas sucias o "en la lavandería".
   - Respetar las reglas del usuario ("nunca X con Y").
   - Formalidad dentro de ±1 nivel respecto a la ocasión.
   - Temporada y clo dentro del rango objetivo (5.4).
   - Lluvia: exige una capa impermeable o descarta calzado de ante.
2. **Puntuación** como suma ponderada de:
   - armonía de color (5.3);
   - coherencia de estilo (similitud entre los embeddings de FashionSigLIP de las prendas y entre cada prenda y el *prompt* del estilo del usuario);
   - ajuste térmico;
   - novedad (penalizar prendas usadas recientemente);
   - preferencia aprendida del usuario.
3. **Personalización**: registrar like, dislike, "me lo puse" y "cambié X" como señales, y entrenar un *ranker* ligero por usuario (regresión logística o LightGBM sobre las características anteriores).
4. **Más adelante**: un modelo de compatibilidad tipo type-aware u OutfitTransformer sobre embeddings congelados de FashionSigLIP, entrenado con datos propios consentidos. Polyvore se usaría **solo para evaluar** mientras no haya revisión legal.

### 5.2 Diversidad: re-ranking con MMR

MMR (Carbonell y Goldstein, SIGIR 1998, DOI 10.1145/290941.291025) va eligiendo de forma iterativa:

`o* = argmax_{o ∈ C \ S} [ λ · rel(o) − (1 − λ) · max_{s ∈ S} sim(o, s) ]`

Notas prácticas:
- `rel` es la puntuación de 5.1, normalizada entre 0 y 1.
- `sim(o, s)` combina un **Jaccard ponderado de prendas** (la prenda principal pesa doble) con la similitud coseno de los embeddings medios del outfit.
- Empezar con **λ = 0,7** y ajustarlo con test A/B.
- Añadir restricciones duras de diversidad: no repetir la prenda principal en el top 3 y como mucho dos outfits con el mismo bottom.
- Aplicar MMR solo sobre los N = 50–100 mejores candidatos.

### 5.3 Armonía de color en ropa

**1. Extracción.** Aplicar k-means (k = 3–5) en **CIELAB** sobre los píxeles de la máscara, sin el fondo.
- Fusionar centroides con **ΔE00 < 6–8** (CIEDE2000; Sharma et al.).
- Guardar los 3 colores principales con su peso. Para el estampado, guardar la varianza o el número de clusters relevantes.

**2. LCh.** Pasar cada color a `L*` (claridad), `C*` (croma) y `h°` (tono). En TypeScript se puede usar `culori` 4.0.2 o `colorjs.io` 0.7.1, ambas MIT, que también calculan OKLCH y ΔE2000.

**3. Neutros.** Son heurísticas que hay que calibrar con fotos reales:
- **Neutros acromáticos**: `C* < ~10`, es decir, negro, blanco, gris y crudo.
- **Neutros de moda**:
  - navy: L* 15–35, h ≈ 250–290°, C* < ~35;
  - beige y camel: h ≈ 50–85°, C* < ~30, L* > 50;
  - denim: h ≈ 230–260°, C* 10–35;
  - verde oliva y caqui: h ≈ 90–120°, C* < ~30.
- Los neutros combinan con todo y **no cuentan como colores para la armonía**.

**4. Armonía** entre los colores cromáticos del outfit, usando las plantillas de tono de Matsuda que usan Cohen-Or et al. (*Color Harmonization*, SIGGRAPH 2006):
- monocromático o análogo (Δh ≤ 30°);
- complementario (Δh ≈ 180° ± 30°);
- tríada (≈ 120°);
- "un color de acento + neutros".

La puntuación mide si los tonos caben en algún sector de plantilla; si caben en varios, se toma la mejor.

**5. Reglas de estilismo:**
- Como máximo 2–3 colores cromáticos y **un solo estampado protagonista**.
- Contraste de claridad **ΔL\* ≥ 15–20** entre la parte de arriba y la de abajo, salvo un *total look* monocromo intencionado.
- Bonificar la repetición de un color (por ejemplo, el bolso con un detalle del top).
- La paleta personal del usuario es opcional: estación de color u otra preferencia.

### 5.4 Confort térmico: valores clo por prenda

**Definiciones:**
- **1 clo = 0,155 m²·K/W.**
- **Suma de la ASHRAE 55** (indicada en la tabla de prendas): `I_cl ≈ Σ I_clu`.
- **ISO 9920:2009, §4.3**, según la implementación de `pythermalcomfort` (MIT): `I_cl = 0,835 · Σ I_clu + 0,161`.
- **Corrección por actividad** (ASHRAE 55, I_cl,active): si `met > 1,2`, `I_cl · (0,6 + 0,4 / met)`. Caminar a unos 4 km/h equivale a ~2 met.

Las tablas oficiales (ASHRAE 55 Tabla 5.2.2.2B; ISO 7730 / ISO 9920) son de pago. Los valores de abajo proceden de:
- **(A)** el diccionario `clo_individual_garments` de `pythermalcomfort` y la Wikipedia, que reproducen los valores de ASHRAE y del ASHRAE Handbook;
- **(T)** la tabla de Engineering ToolBox, del tipo ISO 7730. Es secundaria y no cita su fuente.

**Tabla recomendada para DressIt** (en clo, para la suma simple):

| Categoría de DressIt | Valor recomendado | Fuente / rango |
|---|---|---|
| Ropa interior (braga o calzoncillo + sujetador) | 0,04 | A: 0,03–0,04 + 0,01 |
| Medias o pantis | 0,02 | A/T: 0,02 |
| Camiseta térmica de manga larga (primera capa) | 0,20 | A: long underwear top 0,20 |
| Top de tirantes o sin mangas | 0,10 | A: 0,12; T: 0,06 |
| Camiseta de manga corta | 0,08 | A: 0,08; T: 0,09 |
| Polo o punto de manga corta | 0,17 | A: 0,17 |
| Camisa o blusa de manga corta | 0,19 | A: 0,19 |
| Blusa ligera de manga larga | 0,15 | T: 0,15 |
| Camisa de manga larga | 0,25 | A/T: 0,25 |
| Camisa de franela o sobrecamisa | 0,32 | A: 0,34; T: 0,30 |
| Sudadera | 0,34 | A: 0,34 |
| Jersey fino o cárdigan fino | 0,25 | A: 0,25; T: 0,20 |
| Jersey grueso | 0,36 | A: 0,36; T: 0,35 |
| Jersey grueso de cuello alto | 0,37 | T: 0,37 |
| Chaleco de punto | 0,12 | T: 0,12–0,13 |
| Shorts | 0,06 | A/T: 0,06 |
| Bermudas | 0,08 | A: 0,08; T: 0,11 |
| Pantalón fino (lino o chino ligero) | 0,15 | A: 0,15; T: 0,20 |
| Pantalón normal o vaquero | 0,24 | A: 0,24; T: 0,25 |
| Pantalón de chándal | 0,28 | A: 0,28 |
| Falda fina | 0,14 | A: 0,14 |
| Falda gruesa | 0,23 | A: 0,23; T: 0,25 |
| Vestido ligero sin mangas | 0,25 | T: 0,25 |
| Vestido camisero de manga corta | 0,29 | A: 0,29 |
| Vestido fino de manga larga | 0,33 | A: 0,33 |
| Vestido de invierno o grueso de manga larga | 0,40–0,47 | T: 0,40; A: 0,47 |
| Mono o peto | 0,30 | A: 0,30 (peto); T: 0,28 |
| Chaqueta ligera de verano | 0,25 | T: 0,25 |
| Americana o blazer | 0,36 (fina) / 0,44 (gruesa) | A: suit jacket, 0,36 / 0,44 |
| Chaqueta (vaquera, de cuero, bomber) | 0,35 | T: jacket 0,35 |
| Plumífero | 0,55 | T: 0,55 |
| Abrigo | 0,60 | T: 0,60 |
| Parka | 0,70 | T: 0,70 |
| Calcetines | 0,02 | A/T: 0,02 |
| Calcetines gruesos largos | 0,10 | T: 0,10 |
| Zapatos o sandalias | 0,02 | A/T: 0,02–0,04 |
| Botas | 0,10 | A: 0,10; T: 0,05 |
| Bufanda, gorro o guantes | 0,05 cada uno | **Heurístico: no está en las fuentes consultadas.** |

**Objetivo de clo según `apparent_temperature`.** Es una **regla heurística propia** para estar de pie o caminar en la calle, en unidades de suma simple, y debe calibrarse con lo que diga el usuario. Como referencia de interior, la ASHRAE da 0,5 clo como ropa típica de verano y 1,0 de invierno, y Schiavon y Lee (2013) estiman la ropa de interior con `clo = 10^(−0,1635 − 0,0066·T6am)` entre 5 y 26 °C.

| Sensación térmica (AT) | clo objetivo | Ejemplo |
|---|---|---|
| ≥ 27 °C | 0,20–0,40 | Camiseta + shorts o falda fina + sandalias |
| 22–27 °C | 0,35–0,55 | Camisa de manga corta + pantalón fino |
| 17–22 °C | 0,50–0,80 | Manga larga + vaquero, más chaqueta ligera opcional |
| 12–17 °C | 0,75–1,10 | Lo anterior + jersey fino o americana o chaqueta |
| 7–12 °C | 1,05–1,40 | Jersey grueso + chaqueta, o abrigo |
| 2–7 °C | 1,35–1,70 | Jersey + abrigo o plumífero |
| < 2 °C | ≥ 1,65 | Primera capa térmica + jersey grueso + parka + accesorios |

**Cómo aplicar la regla:**
- Calcular la AT mínima y máxima en la franja horaria del usuario (por ejemplo, 8:00–20:00).
- **El abrigo se elige por la AT mínima, la capa base por la AT máxima.** Si la diferencia es de 8 °C o más, proponer capas que se puedan quitar.
- **Ajustes por usuario**: un desplazamiento de ±0,1–0,3 clo si el usuario es friolero o caluroso, que se aprende con el *feedback* de "tuve frío o calor".
- **Lluvia**: si `precipitation_probability ≥ 40 %` o `precipitation ≥ 0,5 mm/h` en la franja, exigir una prenda exterior impermeable o sugerir paraguas, y penalizar ante, seda y calzado abierto.
- **Viento**: con `wind_speed_10m ≥ 30 km/h`, priorizar una capa cortavientos y penalizar faldas vaporosas.
- **UV**: con `uv_index ≥ 6`, sugerir gafas y gorra y favorecer los colores claros.
- **Humedad**: con humedad mayor del 70 % y AT de más de 25 °C, priorizar lino o algodón y penalizar sintéticos.

---

## 6. Tabla resumen de licencias

| Componente | Licencia del código | Licencia de pesos o datos | Caveat de los datos de entrenamiento | ¿Uso comercial en DressIt? |
|---|---|---|---|---|
| Open-Meteo API | (servidor AGPLv3) | Datos CC BY 4.0 | — | **Sí, con suscripción** (el plan gratuito es no comercial) y con atribución |
| Open-Meteo Geocoding | — | Datos de GeoNames, CC BY 4.0 | — | Sí, con suscripción y atribución |
| AEMET OpenData | — | Ley 37/2007, reutilización | — | Sí, citando "Fuente: AEMET" |
| `Marqo/marqo-fashionSigLIP` | Apache-2.0 | Apache-2.0 | Base WebLI; ajuste con ">1M productos" de fuente no declarada | Sí (riesgo bajo-medio) |
| `Marqo/marqo-fashionCLIP` | Apache-2.0 | Apache-2.0 | Base LAION-2B; fuente del ajuste no declarada | Sí (riesgo bajo-medio) |
| `patrickjohncyh/fashion-clip` | MIT | MIT | LAION-2B + Farfetch (no publicado) | Sí (riesgo bajo-medio) |
| `google/siglip2-*` | Apache-2.0 | Apache-2.0 | WebLI (no público) | Sí |
| `IDEA-Research/grounding-dino-*` | Apache-2.0 | Apache-2.0 | O365, GoldG, Cap4M | Sí |
| `google/owlv2-*` | Apache-2.0 | Apache-2.0 | WebLI con pseudo-etiquetas; la ficha está orientada a investigación | Sí |
| `valentinafeve/yolos-fashionpedia` | — | MIT | Fashionpedia: anotaciones CC BY 4.0 e imágenes de terceros | Sí, con atribución (riesgo medio) |
| RF-DETR (N/S/M/L det, todos los Seg) | Apache-2.0 | Apache-2.0 | COCO / O365 | Sí |
| RF-DETR A/F/P/XL/2XL | PML 1.0 | PML 1.0 | — | Solo en Roboflow o con Enterprise |
| Ultralytics YOLO | AGPL-3.0 | AGPL-3.0 (también los modelos entrenados) | — | **No**, sin licencia Enterprise |
| Modelos entrenados con DeepFashion2 | — | — | Dataset no comercial | **No** |
| rembg | MIT | Según el modelo | — | Sí, **fijando el modelo** |
| BiRefNet / BiRefNet_lite | MIT | MIT | **DIS5K: no comercial**; también P3M y otros | Sí en los pesos (**riesgo medio**: revisión legal) |
| IS-Net (`isnet-general-use`) | Apache-2.0 | Apache-2.0 | **DIS5K: no comercial** | Igual que BiRefNet |
| U²-Net (`u2net`) | Apache-2.0 | Apache-2.0 | DUTS | Sí (riesgo bajo-medio) |
| `u2net_cloth_seg` | MIT (archivado) | MIT | iMaterialist 2019 (reglas de la competición de Kaggle) | Riesgo medio. Además, no está pensado para prendas sueltas. |
| RMBG-2.0 / 1.4 (BRIA) | — | **CC BY-NC 4.0** / licencia BRIA no comercial | Datos con licencia | **No**, sin acuerdo con BRIA |
| SAM 2 / 2.1 | Apache-2.0 | Apache-2.0 | SA-1B / SA-V | Sí |
| SAM 3 | SAM License | SAM License (*gated*) | SA-Co | Sí, con condiciones. Muy pesado en CPU. |
| `mattmdjaga/segformer_b2_clothes` | — | "other" | Dataset de *human parsing* (ATR) | Evitar |
| iOS Vision / ML Kit | Plataforma | Términos de Apple / Google | — | Sí (ML Kit está en beta) |
| Polyvore Outfits | BSD-3 (código) | HF: CC BY 4.0 (*gated*) | Imágenes con copyright de terceros | Solo evaluación o investigación, salvo revisión legal |
| POG / iFashion | — | Sin licencia | — | Solo investigación |

---

## Fuentes

Todas consultadas el **2026-11-24**.

**Meteorología**
- Open-Meteo, términos: https://open-meteo.com/en/terms
- Open-Meteo, precios: https://open-meteo.com/en/pricing
- Open-Meteo, licencia y atribución: https://open-meteo.com/en/licence
- Open-Meteo, Forecast API: https://open-meteo.com/en/docs
- Open-Meteo, Geocoding API: https://open-meteo.com/en/docs/geocoding-api
- Open-Meteo, anuncio de suscripciones comerciales (2023): https://openmeteo.substack.com/p/api-subscriptions-for-commercial
- GeoNames (licencia CC BY 4.0): https://www.geonames.org/
- AEMET OpenData: https://opendata.aemet.es/centrodedescargas/inicio
- AEMET, FAQ v1.4 (28-07-2025): https://opendata.aemet.es/centrodedescargas/docs/FAQs220424.pdf
- AEMET, nota legal: https://www.aemet.es/es/nota_legal
- AEMET OpenData (página informativa): https://www.aemet.es/en/datos_abiertos/AEMET_OpenData
- Rutas de los endpoints municipales de AEMET (fuentes de climaemet): https://github.com/rOpenSpain/climaemet/blob/main/R/aemet-forecast-hourly.R y https://jentic.com/apis/aemet.es/aemet

**Visión**
- https://huggingface.co/Marqo/marqo-fashionSigLIP · https://huggingface.co/Marqo/marqo-fashionSigLIP/raw/main/open_clip_config.json
- https://huggingface.co/Marqo/marqo-fashionCLIP · https://huggingface.co/Marqo/marqo-fashionCLIP/raw/main/open_clip_config.json
- https://github.com/marqo-ai/marqo-FashionCLIP · https://www.marqo.ai/blog/search-model-for-fashion
- https://huggingface.co/patrickjohncyh/fashion-clip
- https://huggingface.co/google/siglip2-base-patch16-224 · https://huggingface.co/blog/siglip2 · https://huggingface.co/timm/ViT-B-16-SigLIP2
- open_clip, lista de modelos preentrenados: https://github.com/mlfoundations/open_clip/blob/main/src/open_clip/pretrained.py
- https://huggingface.co/google/owlv2-base-patch16-ensemble · https://huggingface.co/docs/transformers/model_doc/owlv2
- https://github.com/google-research/scenic/tree/main/scenic/projects/owl_vit
- https://huggingface.co/IDEA-Research/grounding-dino-tiny · https://huggingface.co/docs/transformers/model_doc/grounding-dino · https://github.com/IDEA-Research/GroundingDINO
- https://huggingface.co/openmmlab-community/mm_grounding_dino_tiny_o365v1_goldg
- https://huggingface.co/valentinafeve/yolos-fashionpedia
- Fashionpedia: https://fashionpedia.github.io/home/ · https://fashionpedia.github.io/home/data_license.html
- DeepFashion2: https://github.com/switchablenorms/DeepFashion2
- DeepFashion, acuerdo de licencia: https://mmlab.ie.cuhk.edu.hk/projects/DeepFashion/DeepFashionAgreement.pdf
- Ultralytics, licencia: https://www.ultralytics.com/license
- RF-DETR: https://github.com/roboflow/rf-detr
- rembg: https://github.com/danielgatis/rembg · https://pypi.org/project/rembg/ · https://github.com/danielgatis/rembg/releases/tag/v0.0.0
- BiRefNet: https://huggingface.co/ZhengPeng7/BiRefNet · https://github.com/ZhengPeng7/BiRefNet
- DIS5K: https://github.com/xuebinqin/DIS · https://github.com/xuebinqin/DIS/blob/main/DIS5K-Dataset-Terms-of-Use.pdf
- U-2-Net: https://github.com/xuebinqin/U-2-Net
- cloth-segmentation: https://github.com/levindabhi/cloth-segmentation
- BRIA RMBG-2.0: https://huggingface.co/briaai/RMBG-2.0
- SAM 2: https://github.com/facebookresearch/sam2 · https://huggingface.co/facebook/sam2.1-hiera-small
- SAM 3: https://huggingface.co/facebook/sam3 · https://github.com/facebookresearch/sam3/blob/main/LICENSE
- API de modelos de Hugging Face (tamaños y licencias): `https://huggingface.co/api/models/<id>?blobs=true`
- Apple Vision: https://developer.apple.com/documentation/vision/vngenerateforegroundinstancemaskrequest
- ML Kit Subject Segmentation: https://developers.google.com/ml-kit/vision/subject-segmentation/android
- Módulos React Native de recorte: https://github.com/SIX33-Software/f2-background-remover · https://github.com/westwood-dev/expo-segmentation · https://github.com/atlj/react-native-background-remover · https://github.com/baygut/react-native-subject-lift
- PyPI (versiones): https://pypi.org/project/transformers/ · https://pypi.org/project/torch/ · https://pypi.org/project/open-clip-torch/ · https://pypi.org/project/onnxruntime/ · https://pypi.org/project/ultralytics/

**Móvil**
- Expo, changelog: https://expo.dev/changelog · https://expo.dev/changelog/sdk-58
- Expo, tabla de versiones: https://docs.expo.dev/versions/latest/
- Módulos nativos incluidos en SDK 58: https://unpkg.com/expo@58.0.26/bundledNativeModules.json
- expo-share-intent: https://github.com/achorein/expo-share-intent · https://github.com/achorein/expo-share-intent/blob/main/plugin/src/ios/writeIosShareExtensionFiles.ts
- expo-share-extension: https://github.com/MaxAst/expo-share-extension
- Apple, App Extension Programming Guide ("Accessing a Webpage"): https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/ExtensionScenarios.html
- https://docs.expo.dev/versions/latest/sdk/location/
- Expo, guía de permisos (`android.blockedPermissions`): https://docs.expo.dev/guides/permissions/
- https://docs.expo.dev/versions/latest/sdk/imagepicker/
- https://docs.expo.dev/versions/latest/sdk/calendar/
- https://docs.expo.dev/versions/latest/sdk/securestore/
- https://docs.expo.dev/versions/latest/sdk/localization/
- FlashList: https://github.com/Shopify/flash-list
- https://github.com/MatiPl01/react-native-sortables · https://github.com/omahili/react-native-reorderable-list · https://github.com/computerjazz/react-native-draggable-flatlist · https://github.com/howljs/react-native-calendar-kit
- Registro npm: `https://registry.npmjs.org/<paquete>`, consultado para todas las versiones citadas.

**Backend**
- Fastify LTS: https://fastify.dev/docs/latest/Reference/LTS/
- BullMQ v6.0.0: https://github.com/taskforcesh/bullmq/releases/tag/v6.0.0
- pgvector: https://github.com/pgvector/pgvector · https://github.com/pgvector/pgvector-node
- kysely-codegen: https://github.com/RobinBlomberg/kysely-codegen
- undici, Client: https://github.com/nodejs/undici/blob/main/docs/docs/api/Client.md
- undici, Connector: https://github.com/nodejs/undici/blob/main/docs/docs/api/Connector.md
- request-filtering-agent: https://github.com/azu/request-filtering-agent
- OWASP SSRF Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html
- OWASP Password Storage Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- Node.js, releases: https://nodejs.org/dist/index.json

**Outfits, color y confort térmico**
- Han et al. 2017: https://arxiv.org/abs/1707.05691
- Vasileva et al. 2018: https://arxiv.org/abs/1803.09196 · https://github.com/mvasil/fashion-compatibility · https://huggingface.co/datasets/mvasil/polyvore-outfits
- Polyvore (Han): https://github.com/xthan/polyvore-dataset
- POG: https://arxiv.org/abs/1905.01866 · https://github.com/wenyuer/POG
- OutfitTransformer: https://arxiv.org/abs/2204.04812
- MMR (Carbonell y Goldstein, 1998): https://doi.org/10.1145/290941.291025
- Color Harmonization (Cohen-Or et al., 2006): https://igl.ethz.ch/projects/color-harmonization/
- CIEDE2000 (Sharma et al.): https://hajim.rochester.edu/ece/sites/gsharma/ciede2000/
- culori: https://www.npmjs.com/package/culori · colorjs.io: https://www.npmjs.com/package/colorjs.io
- pythermalcomfort, valores de prendas y conjuntos: https://github.com/pythermalcomfort/pythermalcomfort/blob/master/pythermalcomfort/utilities.py
- pythermalcomfort, fórmula ISO 9920: https://github.com/pythermalcomfort/pythermalcomfort/blob/master/pythermalcomfort/clothing/clo_intrinsic_insulation_ensemble.py
- pythermalcomfort, clo dinámico ASHRAE 55: https://github.com/pythermalcomfort/pythermalcomfort/blob/master/pythermalcomfort/clothing/clo_dynamic_ashrae.py
- pythermalcomfort, Schiavon y Lee 2013: https://github.com/pythermalcomfort/pythermalcomfort/blob/master/pythermalcomfort/models/clo_tout.py
- Clothing insulation (valores ASHRAE): https://en.wikipedia.org/wiki/Clothing_insulation
- Engineering ToolBox, tabla de clo: https://www.engineeringtoolbox.com/clo-clothing-thermal-insulation-d_732.html
