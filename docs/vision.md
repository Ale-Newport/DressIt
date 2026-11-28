# Servicio de visión (`services/vision`)

> Estado: 2026-11-24 · versión 0.1.0 · Python 3.13 · FastAPI · puerto 8001.
> Resultados medidos: [`docs/evidence/vision-2026-11-24.md`](evidence/vision-2026-11-24.md) y, para la
> limpieza del recorte, [`docs/evidence/recortes-2026-11-24.md`](evidence/recortes-2026-11-24.md).
> Arranque y variables: [`services/vision/README.md`](../services/vision/README.md).

El servicio de visión recibe una foto y devuelve una ficha por prenda: el recorte sin fondo,
los atributos del vocabulario de DressIt (`services/vision/app/vocabulary.json`, exportado de
`packages/shared`), los colores dominantes, un embedding para búsqueda y avisos de calidad en
español. La API Node (`services/api`) es su único cliente. El servicio no guarda nada (ver
[Privacidad](#privacidad)).

## 1. Contrato HTTP

| Método | Ruta | Uso |
|---|---|---|
| `GET /health` | `{status, device, backend, models:{nombre: cargado}, version}`. `backend` es `torch` (modelos reales) o `stub`. |
| `POST /v1/analyze` | multipart `file` (JPEG, PNG o HEIC ≤ 15 MB), `mode=single|multi`, `max_items` (1–12, 8 por defecto), `normalize` (`true` por defecto; `false` no corrige blancos ni exposición: para fotos de estudio, que ya vienen corregidas). |
| `POST /v1/segment/points` | Corrección manual: `file`, `points` (JSON `[[x, y, 1|0], …]` normalizados, 1 = prenda, 0 = no es prenda; máx. 20) y `box` opcional → `{cutout_png_base64, bbox, mask_area_ratio, colors}`. |
| `POST /v1/matte` | Recorte de la persona (para las imágenes del avatar): `{png_base64, width, height, coverage}`. |
| `POST /v1/catalog/check` | Foto de catálogo: `reference` (recorte RGBA de la prenda real), `candidate` (packshot generado u oficial), `kind=generated\|studio\|official` (`studio`: foto de estudio sobre gris claro; la recorta con BiRefNet lite, iguala su color a la prenda real si `colour_fix=true`, por defecto, y la juzga sobre ese recorte), `category`, `subcategory`, `ocr` → `{presentation:{background_l, background_l_std, background_chroma, margin, extent, symmetry, tilt, components, neat, worn, passed, reasons, codes}, fidelity:{similarity, category, same_category, pattern, palette_emd, lightness_shift, missing_colors, extra_colors, texture_chi2, text_match, passed, reasons, codes}, bbox, cutout_png_base64}`. Independiente de cómo esté colocada la prenda; ver [foto-catalogo.md](foto-catalogo.md#4-control-automático-presentación-y-fidelidad). |
| `POST /v1/compare` | `reference` y `candidate` (recortes RGBA) → fidelidad de detalle: `{shape_iou, mean_delta_e, p90_delta_e, max_cell_delta_e, ssim, cells, passed, reasons[]}`. |
| `POST /v1/embed/image` | Embedding de la imagen entera (fotos de catálogo). Con `segment=true` recorta antes la prenda principal, igual que `analyze`. |
| `POST /v1/embed/text` | `{"texts": [...]}` en español o inglés → embeddings en el mismo espacio que las imágenes. Devuelve también `translated`, el texto inglés que se ha embebido. |
| `POST /v1/ocr` | Texto de tickets, etiquetas y capturas: `{text, lines:[{text, confidence, bbox}], model}`. |

Cada elemento de `items[]` de `/v1/analyze` contiene:

- `bbox`: `[x0, y0, x1, y1]` normalizado entre 0 y 1, sobre la imagen ya girada según EXIF.
- `cutout_png_base64`: PNG RGBA con el fondo transparente, recortado a la prenda con un 4 % de margen. El lado mayor mide como máximo 1024 px. Los píxeles semitransparentes del borde llevan el color estimado de la prenda, no el del fondo original (sin halo).
- `mask_area_ratio`: fracción de la foto que ocupa la prenda.
- `detection_score`: puntuación del detector. Es `null` si la prenda salió de la segmentación de fondo.
- `category`, `subcategory`, `pattern` y `fit`: `{value, confidence, alternatives[]}` o `null`.
- `materials`, `styles` y `seasons`: `{value: [ids], confidence}` o `null`.
- `colors`: de 1 a 3 elementos `{hex, family, share}`, con las proporciones sumando 1.
- `embedding`: 768 floats normalizados L2. `embedding_model` vale `"Marqo/marqo-fashionSigLIP"`.
- `quality`: `{blur, brightness, warnings[]}`.

En el nivel superior, la respuesta incluye `image {width, height, sha256, phash, exif_transposed}`, `scene`
(tipo de foto: `single`, `multiple` o `worn`), `timings_ms` por etapa y `model_versions` (ids y
*revisions* exactos de los modelos).

Los errores siguen el formato `{"error": {"code", "message"}}` (mensaje en español): 413
`file_too_large`, 415 `unsupported_image`, 422 `invalid_mode`, `invalid_max_items`,
`empty_file` e `invalid_text`.

**Dimensión del embedding: 768.** Encaja con `vector(768)` de pgvector. La similitud es el coseno;
como los vectores van normalizados, el producto escalar da lo mismo.

## 2. Pipeline de `/v1/analyze`

```
bytes ─► decodificar (JPEG/PNG/HEIC/WebP) + EXIF transpose + SHA-256 + pHash
      ─► copia de trabajo ≤ 2048 px ─► auto-recorte suave de bordes uniformes
      ─► tipo de foto (zero-shot FashionSigLIP: prenda suelta / varias prendas / persona vestida)
      ─► regiones:
           single + prenda suelta   → rembg isnet-general-use (máscara del objeto saliente)
                                       ∥ en paralelo: propuestas de regiones (Grounding DINO a 480 px
                                         con prendas + soportes, SAM 2.1 por caja)
                                       → quitar soportes verificados por FashionSigLIP (percha,
                                         maniquí/cabeza, tendedero, pinza, gancho) y líneas finas
                                         que salen por el borde de la foto
           multi, o persona/flat-lay → Grounding DINO tiny (cajas de prendas, nunca "person")
                                       → filtrado de cajas → SAM 2.1 small (máscara por caja)
           PNG con transparencia     → se usa su canal alfa
      ─► recorte RGBA (+ normalización suave de blancos/exposición)
      ─► FashionSigLIP (un único lote) ─► cabezas zero-shot calibradas con abstención
      ─► capas: una prenda reconocida dentro de otra se le resta (multi y single)
      ─► selección: single = prenda principal; multi = quitar no-prendas, fragmentos y duplicados
      ─► bordes: color de primer plano en los píxeles semitransparentes (solo recortes devueltos)
      ─► colores (k-means CIELAB + CIEDE2000) y calidad, solo para las prendas devueltas
```

### Detalles

- **Orientación EXIF.** Se aplica `ImageOps.exif_transpose`. `exif_transposed` indica si
  había rotación, y `width`, `height` y `bbox` se refieren a la imagen ya girada.
- **Hashes.** `sha256` se calcula sobre los bytes subidos y sirve para detectar duplicados
  exactos. `phash` es un pHash DCT de 64 bits (16 hex) de la imagen girada. Distancias de
  Hamming medidas con las 58 fotos de evaluación:
  - redimensionar al 50 % y recomprimir a JPEG q60: ≤ 2;
  - recortar un 3 % por lado: mediana 8 y máximo 16;
  - fotos distintas: mínimo 18 y mediana 32.

  Recomendación para la API:
  - ≤ 6: misma foto (`exact_photo` o `near_photo`);
  - de 7 a 16: posible copia editada, a confirmar con el embedding;
  - ≥ 18: fotos distintas.
- **Auto-recorte suave.** Solo elimina márgenes uniformes, como un fondo de estudio, bordes de
  escaneo o bandas negras. El color del borde es la mediana del marco exterior y se recortan las
  filas y columnas a menos de ΔE76 = 6 de ese color. El recorte solo se aplica si quita al menos
  un 4 % del área y siempre deja un 3 % de margen.
- **Tipo de foto.** FashionSigLIP compara la foto con prompts de tres escenas (`single`,
  `multiple` y `worn`). En modo `single`, si la escena es `worn` o `multiple` con confianza
  ≥ 0,5, se usa el detector y se elige la prenda principal. La puntuación combina el área de la
  máscara, la cercanía al centro y la confianza de categoría, y da prioridad a la ropa sobre el
  calzado y los complementos. El tipo de foto solo describe la escena. No se infiere nada de la
  persona.
- **Filtrado de detecciones** (`app/pipeline/detect.py`):
  - se descartan las cajas diminutas (< 0,4 % del área o lado < 3 %);
  - se eliminan las **cajas de grupo**, las que solo envuelven varias detecciones distintas
    (una persona entera, una barra con tres vaqueros o dos bolsos juntos);
  - se fusionan los **pares** de zapatos o guantes de tamaño parecido que están juntos;
  - se aplica NMS independiente de la clase (IoU ≥ 0,6) y supresión por contención dentro del
    mismo grupo.
- **Máscaras en multi** (`app/pipeline/analyze.py`):
  - la máscara de SAM se limita a la caja más un 3 %;
  - se eliminan duplicados por IoU de máscara ≥ 0,7;
  - **capas**: tras clasificar, si una máscara grande contiene (≥ 60 %) una prenda de otra
    categoría reconocida con subcategoría (por ejemplo, una chaqueta abierta sobre unos shorts),
    esos píxeles se le restan y la prenda grande se vuelve a embeber. Desde el 2026-11-24 también
    en modo `single` (`VISION_LAYER_SINGLE`), pero allí solo se restan prendas de ropa (arriba,
    abajo, una pieza, abrigo): así el plumífero puesto deja de llevarse los vaqueros, y la
    cinturilla de una falda tomada por "cinturón" no se resta;
  - los fragmentos contenidos en otra prenda (≥ 70 %) se descartan.
- **Qué se devuelve en multi.**
  - Se descarta un ítem si la probabilidad de las clases de rechazo es ≥ 0,5. Estas clases son
    personas, partes del cuerpo, escenas, documentos, comida, animales y fondo vacío.
  - Se conserva un ítem sin categoría solo si su detección es ≥ 0,35 y no ha sido recortado
    por capas (el usuario lo etiqueta).
  - Un "complemento" sin subcategoría necesita una detección ≥ 0,30.
  - El modo `single` devuelve siempre exactamente un ítem, aunque no reconozca ninguna prenda. En
    ese caso los atributos van a `null` y se añade un aviso.
- **Limpieza del recorte en `single`** (`app/pipeline/refine.py`; desde el 2026-11-24). rembg
  devuelve todo lo saliente: la prenda *y* su soporte (el gancho de la percha, la cabeza de
  maniquí bajo un gorro, el tendedero y sus pinzas). Solo en la ruta de rembg y con escena que no
  sea `worn`:
  1. **Propuestas en paralelo con rembg.** Grounding DINO recibe las 23 consultas de prenda más
     una lista **cerrada** de soportes (`clothes hanger`, `mannequin`, `mannequin head`,
     `clothesline`, `clothespin`, `hook`; nunca "person" ni "face"), a 480 px y con la foto
     rellenada a un cuadrado (forma de entrada fija: sin recompilar en MPS). SAM 2.1 segmenta
     las 10 mejores cajas (sin duplicados ni cajas de foto entera). Todo esto corre en otro hilo
     mientras rembg corre en onnxruntime/CoreML, así que casi no suma latencia.
  2. **Verificación semántica.** Las etiquetas de Grounding DINO tiny no sirven (ve "mannequin"
     en cualquier prenda y "clothes hanger" en un bolso), así que solo aportan regiones. Cada
     región (máscara de SAM ∩ primer plano, sobre blanco) se embebe con FashionSigLIP y compite
     en un softmax con las 70 subcategorías, las clases de rechazo, **partes de prenda** (asa o
     cadena de bolso, cordón, hebilla, cremallera, manga, etiqueta…) y **soportes** (percha,
     maniquí, tendedero, pinza/gancho y "forma lisa sin rasgos"). Las partes de prenda están
     para que una cadena de bolso o un cordón no se tomen por un tendedero.
  3. **Se quita** una región si P(soporte) ≥ 0,5 (`VISION_SUPPORT_MIN_PROB`) y ocupa ≤ 60 % del
     objeto, **salvo** donde la solapa una región reconocida como prenda (P(soporte) < 0,3) que
     no sea mayoritariamente el propio soporte (una caja "gorro + cabeza" no protege la cabeza).
     Si en total se quitaría más del 60 % del objeto, no se quita nada.
  4. **Cabeza de maniquí bajo un gorro.** El modelo ve la cabeza lisa como "un sombrero"
     (P(soporte) ≈ 0,3). Si la foto entera parece una prenda de cabeza (P(gorro + gorra +
     sombrero) ≥ 0,5 con el embedding de la escena, ya calculado), una región cuya clase más
     probable sea maniquí/forma, con P(soporte) ≥ 0,25, que llegue al fondo del objeto y empiece
     claramente por debajo de su parte superior, se trata como soporte.
  5. **Líneas que cruzan el borde** (`VISION_THIN_BORDER_RADIUS`). Las partes de la máscara más
     estrechas que ~0,6 % del lado mayor que **tocan el borde de la foto** (un tendedero, una
     barra) se quitan. Las partes finas de la propia prenda (asas, cadenas, cordones, cinturones)
     terminan dentro de la foto y se conservan.
- **Bordes sin halo** (`VISION_DECONTAMINATE_EDGES`). En los píxeles semitransparentes del borde
  el color observado mezcla prenda y fondo (una línea clara alrededor de una americana negra
  fotografiada sobre blanco). Se sustituye por el color de primer plano estimado con
  `pymatting.estimate_foreground_ml` (Germer et al., 2020; MIT), calculado a ≤ 512 px y aplicado
  solo a los píxeles con 0 < alfa < 250. Solo se hace en los recortes devueltos (≈ 35 ms); el
  clasificador los ve compuestos sobre blanco, así que no cambia lo que clasifica. Los colores
  de la ficha salen de los píxeles opacos de la máscara y no se ven afectados.
- **Normalización del recorte** (`VISION_NORMALIZE_CUTOUT`, activada por defecto).
  - **Balance de blancos:** ganancias de von Kries en RGB lineal estimadas con el fondo
    alrededor de la prenda. Solo se aplican si ese fondo es casi neutro (croma mediana entre 4 y
    14, L* > 35), es decir, una pared o sábana con dominante de color. Las ganancias se limitan
    a ±6 % por canal.
  - **Exposición:** una única ganancia para los tres canales, solo si el p98 de luminancia
    es < 0,7 y con un tope de ×1,3. Así se conservan la relación entre canales y el tono.
  - Los colores se extraen de esos mismos píxeles, de modo que la muestra coincide con lo que
    ve el usuario. Con esos topes, el tono de un color saturado no puede moverse de forma
    apreciable.
- **Colores** (`app/colors.py`). Usan la misma conversión sRGB → XYZ (D65) → CIELAB y el mismo
  CIEDE2000 (Sharma 2005) que `packages/shared/src/colors.ts`. La paridad se comprueba con un
  fixture generado desde TypeScript con 214 colores y 107 pares, con un error ≤ 1e-9.
  - Se toma una muestra determinista de hasta 20 000 píxeles **de la máscara**, sin fondo.
  - Se aplica k-means++ con k = 6 y semilla fija.
  - Se fusionan los grupos con ΔE2000 < 10, o < 22 si pertenecen a la misma familia (pliegues
    y sombras de una misma tela).
  - Se descartan los grupos con menos del 8 % de los píxeles y se conservan como máximo 3.
  - Cada color es la mediana Lab de sus píxeles. La familia es la más cercana por CIEDE2000,
    excluyendo las metálicas, igual que en TypeScript.
- **Calidad** (`app/quality.py`). Se calcula sobre el recorte de la prenda, con avisos en español.
  - `blur` va de 0 a 1. Estima la σ del desenfoque gaussiano con el método de re-desenfoque
    (Zhuo & Sim, 2011), que no depende del contraste. Por eso una prenda lisa no aparece como
    "borrosa".
  - `brightness` es la L*/100 media del recorte.
  - Avisos: «Imagen borrosa» (`blur` ≥ 0,5), «Poca luz», «Imagen sobreexpuesta», «Resolución
    baja» (lado < 256 px), «La prenda sale cortada en el borde de la foto», «La prenda ocupa muy
    poco en la foto», «No se ha podido separar bien la prenda del fondo», «No se reconoce ninguna
    prenda en la imagen» y «Clasificación poco segura: revisa la categoría».

### Digitalización: enderezado, corrección manual y control de fidelidad

- **Enderezado** (`VISION_UPRIGHT_CORRECTION`, activo por defecto): las prendas de arriba, de abajo,
  vestidos y abrigos se giran hasta que su silueta es simétrica respecto a la vertical
  (búsqueda por IoU con su reflejo: paso de 2,5° y afinado de 0,5°, máximo ±25°). Solo se gira si
  el ángulo es ≥ 3° y la simetría mejora al menos 0,04; el ángulo va en `upright_rotation`. Bolsos,
  calzado y complementos no se tocan (no son simétricos). **No hay corrección de perspectiva**
  (una prenda fotografiada en escorzo sigue en escorzo).
- **Corrección manual** (`/v1/segment/points`): SAM 2.1 con puntos «prenda» / «no es prenda» sobre la
  foto original. Después pasa la misma limpieza que los recortes automáticos y, además, cada punto
  «no es prenda» elimina las **partes finas** de la máscara a menos de un 8 % del lado de la foto
  (hebras de pelo sobre el hombro, dedos, el gancho de una percha): SAM tiende a conservar el pelo
  que cae sobre una prenda aunque se marque como «no es prenda». El cuerpo de la prenda nunca se
  toca. Prueba real en el simulador (plumífero con pelo sobre el hombro, 4 puntos):
  [antes y después](evidence/digitalizacion/recorte-manual-antes-despues.jpg).
- **Control de fidelidad de detalle** (`/v1/compare`): compara el recorte real con una imagen
  derivada (la foto de estudio generada). Se alinean con ECC sobre las máscaras (rígido para la
  forma, afín para color y textura) y se mide:
  - forma: IoU de las máscaras (mínimo 0,82);
  - color por zonas: CIEDE2000 en una rejilla de 12×12 sobre la prenda (media ≤ 6, percentil 90 ≤ 6
    y peor celda ≤ 12): un botón ocupa más o menos una celda;
  - textura: SSIM de la luminancia dentro de la prenda (mínimo 0,55).

  Medido con generaciones reales (chaqueta de punto con botones,
  [evidencia](evidence/catalogo-2026-11-24.md)): las dos buenas dan peor celda 5,4–6,7, SSIM
  0,75–0,91 e IoU 0,97–0,99; la que cambió los botones da peor celda 21,2 y SSIM 0,19 y se rechaza.
  Con el control anterior (solo similitud global) esa pasaba con 0,966.

### Búsqueda por texto en español (`/v1/embed/text`)

FashionSigLIP solo tiene torre de texto en inglés. Por eso cada consulta se reescribe con un
glosario determinista español → inglés (`app/prompts.py`), construido a partir de las etiquetas
del vocabulario y de sinónimos de moda habituales. No se usa ningún servicio externo.

- Se busca la coincidencia más larga: «azul marino», «cazadora vaquera», «manga corta»…
- El orden sustantivo-adjetivo se pasa a adjetivo-sustantivo, de modo que «chaqueta beige»
  queda como «beige jacket».
- Las palabras desconocidas se mantienen, así que una consulta en inglés pasa sin cambios.
- Se embeben las plantillas `"{q}"` y `"a photo of {q}"` y se promedian.

En una prueba de 70 clases (la etiqueta española de cada subcategoría frente a 49 prendas
reales), la traducción acierta el 91,8 % en top-1 y el texto español sin traducir, el 85,7 %.
Se descartó un modelo multilingüe porque su espacio vectorial sería distinto del de las imágenes
de FashionSigLIP. Obligaría a guardar un segundo vector por prenda.

### OCR (`/v1/ocr`)

EasyOCR (es + en, CPU) se carga **solo en la primera llamada** a `/v1/ocr`. La imagen se reduce
a ≤ 2000 px. Las palabras se agrupan en líneas por orden de lectura y se recomponen los importes
partidos («29 , 95 €» → «29,95 €»). Se eligió EasyOCR (Apache-2.0, con detector CRAFT bajo MIT)
porque es aceptable, tiene un modelo de español y funciona sin GPU. RapidOCR/PaddleOCR es más
ligero, pero su modelo latino rinde peor en español.

## 3. Modelos y licencias

Licencias comprobadas el 2026-11-24 en la API de Hugging Face (`cardData.license`), en los
ficheros `LICENSE` de GitHub y en los metadatos de los paquetes instalados.

| Componente | Modelo / versión | Licencia (pesos / código) | Datos de entrenamiento y observaciones |
|---|---|---|---|
| Embeddings y zero-shot | `Marqo/marqo-fashionSigLIP` @ `c56244cc94f9` (open_clip 4.2.2) | Apache-2.0 / MIT (open_clip) | Ajuste fino de ViT-B-16-SigLIP (WebLI) con "más de 1 M de productos de moda". **El origen de los datos no se declara.** Solo inglés. 768 dimensiones, 224 px, 0,2 B parámetros. |
| Detector multiprenda | `IDEA-Research/grounding-dino-tiny` @ `a2bb814dd30d` | Apache-2.0 | O365, GoldG y Cap4M. Se usa con un vocabulario cerrado de 23 prendas y nunca con "person". OWLv2 (`google/owlv2-base-patch16-ensemble`, Apache-2.0) se puede configurar con `VISION_DETECTOR_MODEL`. |
| Máscara por caja | `facebook/sam2.1-hiera-small` @ `ee5bba1d82bb` (transformers 5.24) | Apache-2.0 | SA-1B. Al cargar aparece un aviso inocuo de transformers ("sam2_video → sam2"): el checkpoint incluye las capas de vídeo y solo se usan las de imagen. |
| Quitar fondo | rembg 2.0.87 · `isnet-general-use` | MIT (rembg) / Apache-2.0 (IS-Net) | **Entrenado con DIS5K, cuyos términos dicen *"non-commercial use in research or educational purpose"*. Cuestión legal ABIERTA: no está claro si esas restricciones del dataset afectan a los pesos. No se puede dar por resuelta.** Lo mismo ocurre con BiRefNet. |
| OCR | EasyOCR 1.7.2 (es, en) | Apache-2.0; detector CRAFT MIT | Se descarga en el primer uso de `/v1/ocr`. |
| Color de borde del recorte | pymatting 1.1.16 (`estimate_foreground_ml`) | MIT (código; no tiene pesos) | Algoritmo clásico, sin datos de entrenamiento. Ya era dependencia de rembg; ahora se declara en `pyproject.toml`. |

La limpieza del recorte (2026-11-24) **no añade modelos**: reutiliza Grounding DINO tiny, SAM 2.1
small y FashionSigLIP, ya cargados. Grounding DINO pasa a usarse también en `single` con una lista
cerrada de soportes (percha, maniquí, cabeza de maniquí, tendedero, pinza, gancho), solo como
propuesta de regiones que después verifica FashionSigLIP.

**Descartados:**

- **`bria-rmbg`**: es el modelo por defecto de rembg y es CC BY-NC. El servicio siempre indica
  el modelo de forma explícita.
- **`briaai/RMBG-1.4`**: licencia no comercial.
- **Ultralytics / YOLO**: AGPL-3.0, que también cubre los pesos.
- **Modelos con DeepFashion o DeepFashion2**: uso no comercial.
- **SegFormer de NVIDIA**: licencia de código no comercial.
- **`u2net_cloth_seg`**: repositorio archivado, datos de una competición de Kaggle y pensado para
  personas; en la comparativa fallaba con zapatos, bolsos y gorras.

**Comparativa de quitar fondo.** Se probó en 33 fotos de prenda suelta del conjunto de
evaluación, en CPU con onnxruntime. Hoja visual en `eval/out/segmenters.jpg`.

| Modelo rembg | p50 / p95 (ms) | Exactitud de categoría con su recorte | Observaciones |
|---|---|---|---|
| **isnet-general-use** (elegido) | 799 / 858 (CPU); ≈290 con CoreML | 100 % | El más limpio con fondos con objetos: no incluyó el calendario ni la cortina. |
| birefnet-general-lite | 3520 / 3874 | 100 % | Bordes algo más finos, pero 4,4 veces más lento; incluyó el calendario. Mismo problema de DIS5K. |
| u2net | 304 / 319 | 100 % | Rápido, pero incluyó objetos del fondo. Es la alternativa si la latencia de CPU es crítica (`VISION_SEGMENTER=u2net`). |
| u2net_cloth_seg | 1623 / 1663 | 90,9 % | Falla en artículos que no van sobre una persona. |

## 4. Clasificación zero-shot, calibración y umbrales

- **Prompts** (`app/prompts.py`, versión `2026-11-24.1`). Cada id del vocabulario tiene entre 2
  y 6 sinónimos en inglés, combinados con entre 1 y 4 plantillas. El prototipo de cada clase es
  la media normalizada de los embeddings de todos sus textos.
- **Categoría y subcategoría.** Un softmax plano sobre las 70 subcategorías más 7 clases de
  rechazo: persona, cuerpo, animal, escena, documento, comida y fondo.
  - La categoría es la suma de las probabilidades de sus subcategorías.
  - La subcategoría es la mejor **dentro** de la categoría elegida (coherencia jerárquica).
  - `alternatives` lista las 3 siguientes con probabilidad ≥ 0,02.
- **Calibración.** La probabilidad es `softmax(s · coseno)`. La escala `s` se ajusta minimizando
  la NLL en el split `calib` de `eval/manifest.csv` (`scripts/calibrate.py` genera
  `app/calibration.json`):

  | Cabeza | Escala `s` | Cómo se obtuvo |
  |---|---|---|
  | Prenda (categoría y subcategoría) | 72,5 | Ajustada con NLL |
  | Estampado | 167,5 | Ajustada con NLL |
  | Material, estilo, abrigo, corte y escena | 72,5 | Heredan la escala de prenda: no hay etiquetas para calibrarlas |

  Con 21 imágenes de calibración, la estimación es ruidosa. Hay que recalibrar cuando haya
  correcciones reales de usuarios.
- **Materiales.**
  - Solo se emiten los que se distinguen a simple vista: denim, punto, pana, cuero, ante, lona,
    plumón, terciopelo, satén y tweed.
  - Algodón, poliéster, viscosa, lino, cachemira, seda, lana, nailon, técnico y sintético
    compiten en el softmax para absorber probabilidad, pero **nunca** se devuelven a partir de
    píxeles.
  - Hay además implicaciones por definición cuando la subcategoría es segura: un vaquero o una
    cazadora vaquera son denim, una chaqueta de cuero es cuero, un jersey o cárdigan es punto y
    unas zapatillas de lona son lona.
- **Estilos.** Combinan 0,7 × la afinidad esperada del vocabulario (Σ P(sub) · `styles` de la
  subcategoría) con 0,3 × la evidencia zero-shot normalizada. Se devuelven hasta 3.
- **Temporadas.** Tres niveles de abrigo zero-shot (ligero, medio y abrigado) se convierten en
  estaciones:
  - ligero → primavera y verano;
  - medio → primavera y otoño;
  - abrigado → otoño e invierno.

  La puntuación de cada estación es la suma de las probabilidades de los niveles que la cubren.
- **Corte (`fit`).** Solo se estima en partes de arriba, partes de abajo, una pieza y abrigos,
  y **solo si la prenda se lleva puesta** (escena `worn`). Si la prenda está plana o colgada, no
  se conoce su talla respecto a un cuerpo y el servicio se abstiene.

**Umbrales** (`app/config.py`; se pueden cambiar con `VISION_THRESHOLD_<NOMBRE>`). Por debajo del
umbral, el atributo es `null` o queda fuera de la lista.

| Atributo | Umbral | Justificación (split calib) |
|---|---|---|
| category | 0,50 | Cobertura del 100 % y acierto del 95 % en cualquier umbral entre 0,3 y 0,7. |
| subcategory | 0,40 | Con 0,40: cobertura del 90 % y acierto del 89 %. Con 0,70 la cobertura cae al 71 %. |
| pattern | 0,60 | Cobertura del 79 % y acierto del 93 % (con 0,55 eran 89 % y 94 %). Se sube por los errores con mucha confianza en tejidos de punto. |
| material | 0,70 | Conservador: el material se infiere mal a partir de la imagen. |
| style | 0,50 | Sobre la puntuación combinada (afinidad). |
| season | 0,60 | Probabilidad acumulada de los niveles de abrigo. |
| fit | 0,60 | Además exige `worn`. |
| detection | 0,18 | Grounding DINO (caja y texto). El filtrado posterior quita el ruido. |
| not_garment | 0,50 | Suma de las clases de rechazo. |

## 5. Evaluación

**Método** (`scripts/evaluate.py`):

- 58 fotos reales con licencia CC0, CC BY, CC BY-SA o de dominio público, de Flickr (vía
  Openverse) y Wikimedia Commons. `eval/manifest.csv` recoge URL, licencia, autor y etiquetas.
  Las imágenes se descargan con `scripts/fetch_eval_images.py` y no se suben a git.
- Las etiquetas (categoría, subcategorías aceptables, familias de color aceptables y estampado)
  las puso a mano el ingeniero que construyó el servicio. Cuando hay ambigüedad real, se admiten
  varios valores separados por `|`.
- Hay 49 fotos de una prenda (de ellas, 12 con la prenda puesta) y 9 de varias prendas: outfits
  puestos, flat lays, varias prendas colgadas y dos bolsos.
- División determinista por hash: `calib` (21 + 3) y `test` (28 + 6).

**Resultados** (MPS, Apple M2 Max; detalle y fallos en la evidencia):

| Métrica (todas / solo test) | Valor |
|---|---|
| Categoría: acierto (cobertura) | 95,9 % (100 %) / 92,9 % (100 %) |
| Subcategoría: acierto cuando responde (cobertura) | 93,3 % (91,8 %) / 92,6 % (96,4 %) |
| Estampado: acierto cuando responde (cobertura) | 88,6 % (85,4 %) / 85,0 % (90,9 %) |
| Color principal en familia aceptada / en el top-3 | 74,5 % / 83,0 % |
| Multi: recall / precisión por categoría | 82,1 % / 63,9 % |
| Texto español → prenda (70 clases, top-1) | 91,8 % traducido frente a 85,7 % sin traducir |
| Halo en el borde del recorte (ΔL* mediana borde semitransparente − interior opaco) | 10,9 (18,8 antes) |
| Latencia single p50 / p95 (MPS, en caliente) | 786 / 1090 ms (634 / 1042 antes de la limpieza del recorte) |
| Latencia multi p50 / p95 (MPS, en caliente) | 1132 / 1653 ms (1073 / 1601 antes) |
| Arranque en frío (cargar todos los modelos ya descargados) | ≈ 13–25 s |

Las latencias en CPU sin MPS ni CoreML aparecen en la evidencia. La tabla es la del 2026-11-24
tras la limpieza del recorte; la comparación antes/después, con las mismas 58 fotos y la misma
máquina, está en [`recortes-2026-11-24.md`](evidence/recortes-2026-11-24.md): categoría,
subcategoría y multi no cambian; estampado −1 foto (abstención), color principal +1 foto neta.

## 6. Limitaciones conocidas

- **Ropa puesta.** SAM a veces incluye piel, pelo, brazos o piernas en la máscara de una prenda,
  o se queda solo con una parte (la capucha de una sudadera se clasificó como gorro). Las capas
  quitan otra *prenda* reconocida (los vaqueros bajo el plumífero), pero no partes del cuerpo: no
  se detectan personas por política. La prenda principal de un outfit es ambigua. Para recortes
  limpios conviene pedir al usuario la prenda plana o colgada.
- **Soportes que quedan.** La limpieza solo quita lo que FashionSigLIP reconoce con seguridad.
  Quedan, por ejemplo: la percha de madera dentro del cuello de una cazadora (P(soporte) ≈ 0,25),
  a veces la percha dentro de un plumífero, una pinza verde del tendedero, el gancho negro de un
  expositor de camisetas y figuras u objetos que no son soportes (un muñeco de cartón junto a
  unas zapatillas). En multi no se aplica: una cabeza de maniquí puede salir como ítem
  "complemento" sin subcategoría. Un asa o una correa **fina que salga por el borde de la foto**
  se quitaría como si fuera un tendedero.
- **Multi.**
  - Se pierden prendas pequeñas o tapadas, como una camiseta bajo una chaqueta abierta o unas
    botas negras.
  - Aparecen ítems que no son ropa del vocabulario (calcetines, medias, un farol junto a unos
    bolsos), clasificados como "complemento".
  - La precisión es del 64 %: la UI debe tratar las detecciones como propuestas para revisar.
- **Color.**
  - En fotos, el negro sale a menudo como "antracita" y el blanco a la sombra como "gris" o
    "celeste". Las familias neutras vecinas se confunden.
  - Los soportes de exposición que no se quitan (ver arriba) pueden entrar en el recorte y en
    los colores.
  - `colors` incluye hasta 3 colores; el principal acierta en el 70 % de los casos.
- **Estampado.** Los tejidos de punto o canalé lisos se confunden con espiguilla o pata de gallo.
- **Subcategorías finas**, como zapatillas frente a running o lona, o jersey frente a chaleco
  de punto: se ofrecen alternativas.
- **Materiales, estilos y temporadas** son estimaciones. La composición real está en la etiqueta
  y se puede leer con `/v1/ocr`.
- **Evaluación pequeña.** Con 58 fotos, los intervalos de confianza son amplios: ±7–10 puntos en
  categoría. Hay que ampliarla con fotos reales de usuarios, con consentimiento.
- **CPU y MPS** pueden dar resultados distintos en decisiones al límite del umbral, por
  diferencias numéricas en fp32.
- **Tamaño de la respuesta.** El recorte PNG pesa entre 0,05 y 1,5 MB por prenda en base64.
- **Licencias de datos** de IS-Net y BiRefNet (DIS5K): pendiente de revisión legal (ver §3).
- **SAM 3** (Meta, nov. 2025; segmentación por texto «camiseta», «percha»…) no se usa: sus pesos
  están tras un formulario de acceso (SAM License, uso comercial permitido) que no se ha
  solicitado. Cuando se tenga acceso, sustituiría a Grounding DINO + SAM 2.1 en `multi` y a los
  puntos en la corrección manual. Se mantiene SAM 2.1 (Apache-2.0).
- **Sin corrección de perspectiva** ni de iluminación generativa en el recorte: la imagen de
  catálogo (prenda extendida y colocada) es la foto oficial encontrada o el packshot generativo de
  [foto-catalogo.md](foto-catalogo.md), que este servicio valida con `/v1/catalog/check`.
  `/v1/compare` (misma silueta) ya no decide nada: rechazaba justo la recolocación de la prenda.

## 7. Privacidad

- Las imágenes se procesan **solo en memoria**. El servicio no escribe en disco ni imágenes,
  ni recortes, ni embeddings, ni texto OCR, y no tiene base de datos.
- Los únicos ficheros que escribe son los pesos de los modelos en `models_cache/` y la caché
  compilada de CoreML.
- **Nunca** se envían imágenes ni texto a terceros: toda la inferencia es local. Las únicas
  conexiones salientes son las descargas de pesos de Hugging Face, GitHub (rembg) y EasyOCR en
  el primer uso. Se pueden evitar horneando los pesos en la imagen de Docker
  (`PRELOAD_MODELS=true`).
- **No se infiere ningún atributo de personas**: ni cuerpo, ni tono de piel, ni edad, ni género,
  ni identidad.
  - El detector busca prendas y, en fotos de prenda suelta, una lista cerrada de soportes
    (percha, maniquí, cabeza de maniquí, tendedero, pinza, gancho). Nunca "person" ni "face".
    "mannequin head" puede activarse sobre una cabeza real; por eso esas consultas no se usan
    en fotos con la prenda puesta, solo proponen regiones que se **restan** del recorte, y no
    aparecen en la respuesta.
  - Las clases "persona" y "partes del cuerpo" sirven únicamente para **descartar** recortes que
    no son prenda, y no aparecen en la respuesta.
  - `scene: worn` solo indica que la prenda está puesta.
- Los logs (accesos de uvicorn y carga de modelos) no contienen contenido de las imágenes ni texto OCR.
- Las fotos de evaluación son públicas con licencia abierta. Sus atribuciones están en
  `eval/manifest.csv`.
