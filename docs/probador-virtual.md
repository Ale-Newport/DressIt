# Probador virtual multiprenda y avatar persistente

> Estado: 2026-11-24. Servicio [`services/tryon`](../services/tryon/README.md) (puerto 8002) +
> generador ComfyUI ([`services/imagegen`](../services/imagegen/README.md), puerto 8188) + API
> ([`modules/imagegen`](../services/api/src/modules/imagegen)). Fotos de estudio de prendas y
> control de detalle: [generacion-imagenes.md](generacion-imagenes.md) y [vision.md](vision.md).

El usuario guarda una vez su **avatar** (su foto de cuerpo entero sobre un fondo de estudio) y
después puede **verse con cualquier conjunto** de su armario: parte de arriba, de abajo, chaqueta,
calzado y un complemento. La imagen se genera en el servidor, se comprueba que cada prenda visible se
parece a la real y se muestra junto al conjunto real con la etiqueta «Generada con IA».

## 0. Método rápido (por defecto desde el 27/11/2026)

`AVATAR_METHOD=fast`: **FLUX.2 klein 4B** (Apache-2.0) en el [servidor MLX](../services/imagegen/mlx/server.py)
(`POST /v1/tryon`) recibe la foto del avatar y la foto de cada prenda (su foto de estudio o de catálogo
si la tiene; si no, su recorte) y, en **una sola pasada de ~20 s**, devuelve a la misma persona vestida
con ellas. Es edición con varias referencias: la imagen 1 es la persona, de ella salen cara, pelo,
cuerpo, postura, encuadre y fondo; las imágenes 2… son las prendas ([`buildTryonPrompt`](../services/api/src/modules/imagegen/tryon-prompt.ts)).
Hasta 4 piezas (capa exterior, una capa interior si cabe, parte de abajo o vestido, calzado o un
complemento). Cada prenda se nombra como la nombró la detección y, si es de abajo, un vestido o un
abrigo, con el largo que vio («light blue denim jeans (full length, down to the ankles)»): sin él,
unos vaqueros puestos sobre las mallas del avatar salían como bermudas con mallas azules. Qwen comprueba
que la persona lleva cada prenda y, si falta alguna, se repite con otra semilla (dos pasadas como
máximo). Después pasa el mismo control de fidelidad que los otros métodos.

| Medida (M2 Max, fp16) | Resultado |
|---|---|
| Tiempo con 2-4 prendas (persona 0,45 MP, prendas 0,15 MP, salida 0,5 MP) | **19,5-22,6 s** |
| Con referencias mayores (0,6 / 0,25 / 0,6 MP) | 24-36 s, la misma calidad: **descartado** (pasa de 30 s) |
| Caché de las referencias (`use_kv_cache`) | no funciona con klein 4B en mflux 0.24: descartado |

Por qué sustituye a los otros dos métodos como predeterminado: FASHN VTON tarda 1-2 min por prenda y
Qwen-Image-Edit ~3 min por pasada, por encima de los 30 s por imagen exigidos; klein conserva la
identidad (cara, pelo, piel, complexión) y el fondo de la foto, y viste con las prendas de las fotos,
incluidas las de estampado y logotipo. Los otros métodos siguen disponibles (`sequential`, `joint`).
Evaluación ciega con personas reales y sintéticas de distintas edades, sexos y complexiones:
[evidence/foto-estudio-30s-2026-11-27.md](evidence/foto-estudio-30s-2026-11-27.md).

## 1. Cómo funciona

```
Perfil → Tu avatar
  foto de cuerpo entero ──/v1/matte (rembg)──▶ persona recortada ──▶ sobre fondo de estudio ──▶ avatar_bases (frontal)
                                                                                 └─ opcional: vistas 3/4 y perfil
                                                                                    (Qwen-Image-Edit + LoRA de ángulos, marcadas IA)
Conjunto → «Verme con este conjunto»
  POST /v1/outfits/:id/avatar {baseId?, method?} ──▶ cola generation (concurrencia 1) ──▶ worker
     método «sequential» (por defecto):
       1. parte de abajo o vestido   FASHN VTON v1.5, máscara de la zona (sustituye lo que lleva la foto)
       2. capa base (camiseta…)      FASHN, máscara de la zona superior
       3. capa media (jersey…)       FASHN sin máscara (se viste encima)
       4. capa exterior (chaqueta…)  FASHN sin máscara
       5. calzado + gorro o bufanda  Qwen-Image-Edit-2511 (workflow tryon-accessories), y el resultado
                                     se pega SOLO en pies / cabeza / cuello (Sapiens2): el resto de la
                                     imagen queda idéntico al paso 4
       cada paso se guarda en tryon_cache con clave (imagen base, motor, prendas ya puestas en orden)
     método «joint»: una pasada de Qwen-Image-Edit con el conjunto en un tablero (máx. 4 prendas visibles)
  ──▶ control: Sapiens2 separa arriba / abajo / calzado; cada prenda visible se compara con la real
      (FashionSigLIP y CIEDE2000) ──▶ aceptada (garment_images avatar_render) o descartada con motivo
```

- **Identidad intacta**: el método por pasos no genera a la persona; edita su propia foto prenda a
  prenda, así que cara, cuerpo, proporciones, postura y luz son los de la foto (salvo lo que la
  máscara deja redibujar: brazos y torso para una prenda de arriba, piernas para una de abajo).
- **Máscara de la zona**: la primera prenda de cada zona sustituye lo que la foto muestra ahí. Sin
  máscara, FASHN «viste encima» y se cuelan restos de la ropa anterior (las mangas de un plumífero
  bajo una camiseta). La máscara se calcula con Sapiens2 (`agnostic_mask`): ropa de la zona +
  brazos y torso (o piernas), cerrada y dilatada, sin tocar nunca cara, pelo, manos ni la ropa de la
  otra mitad del cuerpo. Las capas siguientes van sin máscara para que la de debajo se vea.
- **Calzado y complementos sin inventos**: la instrucción nombra solo las piezas del conjunto con su
  sitio («bailarinas rosas con flores, on the feet») y la salida de Qwen se pega solo dentro de la
  zona de esas piezas (`POST /v1/composite`). En la primera versión la instrucción ponía ejemplos
  («hats on the head, bags in the hand…») y el modelo añadía sombreros, pañuelos y bolsos que no
  estaban en el conjunto, e incluso quitaba la chaqueta (§4). Los **bolsos no se prueban**: su zona
  sería el brazo y el torso enteros; la app los muestra en el conjunto junto a la imagen.
- **Cambiar una prenda** reutiliza los pasos anteriores a ella: cambiar la chaqueta de un conjunto de
  cuatro prendas rehace solo la chaqueta y el calzado. La app muestra «Paso 3 de 4 · Probando:
  chaqueta vaquera, amarillo · 2 pasos reutilizados».
- **Varias vistas y fondos**: estudio gris, blanco, beige o el fondo original; vista frontal (su
  foto) y, si el generador está disponible, tres cuartos y perfil generadas una vez.
- **Reintentos y errores**: la cola reintenta los fallos de red o de servicio; los errores
  definitivos («El probador virtual no responde», «Falta tu foto de cuerpo entero») llegan en
  español al usuario. Sin servicio de probador, la app ofrece solo el método de una pasada; sin
  ningún generador, oculta la tarjeta.

## 2. Modelos evaluados y elegidos

Investigación del 2026-11-24. Licencias del **código**, de los **pesos** y de los **datos** por
separado: muchos repositorios tienen código abierto y pesos no comerciales.

| Modelo | Qué hace | Código | Pesos | Datos de entrenamiento | Decisión |
|---|---|---|---|---|---|
| **FASHN VTON v1.5** (fashn-ai) | Try-on de una prenda por pasada sobre la foto real (972 M parámetros, entrada 576×864) | Apache-2.0 | **Apache-2.0** | No publicados | **Elegido** para el método por pasos |
| FASHN human parser (SegFormer) | Segmentación de la persona para la máscara de FASHN | Apache-2.0 | **NVIDIA SegFormer: solo investigación** | — | **No se usa**: se sustituye por Sapiens2 |
| DWPose (fashn-ai/DWPose, ONNX) | Pose para FASHN | Apache-2.0 | Apache-2.0 | COCO-WholeBody | Usado |
| **Sapiens2-seg-0.4b** (Meta) | Segmentación de 28 partes del cuerpo y ropa | Sapiens2 License | **Sapiens2 License**: uso comercial permitido con restricciones de uso (prohíbe, entre otros, vigilancia, identificación biométrica y deepfakes no consentidos) | Datos de Meta, no publicados | Usado para la máscara y el control. **Revisión legal antes de lanzar** |
| **Qwen-Image-Edit-2511** (Alibaba) | Editor de imágenes multi-imagen | Apache-2.0 | **Apache-2.0** | No publicados | Usado: método de una pasada, calzado y complementos, vistas del avatar |
| Multiple-Angles LoRA (fal) | Cambia el ángulo de cámara en Qwen-Image-Edit-2511 | — | Apache-2.0 | — | Usado para las vistas 3/4 y perfil |
| Qwen-Image 2.x | Generación | — | Qwen Research License (no comercial) | — | Descartado |
| **SAM 3** (Meta) | Segmentación por texto y por puntos | SAM License | SAM License (comercial permitido) **tras formulario de acceso** | SA-Co | No integrado: sin acceso a los pesos. Ver §6 |
| FastFit | Try-on multiprenda con caché de referencia, rápido | Código no comercial | Pesos no comerciales | DressCode-MR (no comercial) | Descartado por licencia |
| Garments2Look | Dataset multiprenda (capas, calzado, complementos) + LoRAs | Apache-2.0 (código) | LoRAs sin licencia declarada | Dataset Apache-2.0 | No se usan los LoRAs (licencia sin declarar). El dataset serviría para evaluar |
| M&M VTO | Try-on multiprenda con texto de estilo | **Sin código ni pesos publicados** | — | — | No integrable |
| IDM-VTON, CatVTON, OOTDiffusion, FitDiT, StableVITON, Leffa | Try-on de una prenda | Varios | **CC BY-NC / no comerciales** (Leffa: MIT pero una prenda y base no comercial) | VITON-HD / DressCode (no comerciales) | Descartados |
| Any2AnyTryon, OmniTry, CatV2TON y otros sobre FLUX.1 [dev] | Try-on | Varios | Base FLUX.1 [dev]: no comercial | — | Descartados |
| InstantID, PuLID | Conservar la cara en la generación | Apache-2.0 | Modelos faciales InsightFace: no comerciales | — | Descartados (y evitan biometría) |

**Por qué FASHN + Qwen y no un modelo multiprenda**: no hay hoy ningún modelo multiprenda abierto
con pesos comerciales. FASHN es el único try-on de calidad con pesos Apache-2.0; se usa en cadena
(una prenda por pasada, de dentro hacia fuera) y Qwen-Image-Edit completa
lo que FASHN no admite (calzado y complementos). La selección se ha decidido midiendo los dos
métodos con fotos reales (§4).

## 3. Hardware y tiempos

- **Mac de desarrollo** (Apple M2 Max, 64 GB de memoria unificada, MPS): tiempos en §4. FASHN corre
  en fp32 (sus pesos bf16 ocupan 1,9 GB; ~6,3 GB de memoria durante una pasada). Qwen-Image-Edit en
  ComfyUI carga ~22 GB de pesos (modelo Q4_K_M 12,8 GB, codificador de texto Q8 8,1 GB, proyector de
  visión 1,4 GB). Ambos caben a la vez en 64 GB; la cola de generación procesa un trabajo cada vez.
- **Servidor (no medido aquí)**: FASHN corre en bf16 en GPUs NVIDIA Ampere o posteriores. Con los
  tamaños de pesos de arriba, una GPU de 24 GB (L4, A10, RTX 4090) debería dar para los dos modelos
  cargados; hay que medirlo antes de dimensionar la producción.
- **Ejecución local obligatoria**: no se usa ninguna API de terceros; las fotos del usuario no
  salen de la infraestructura de DressIt.

## 4. Resultados medidos

Método rápido (por defecto): ver §0 y [evidence/foto-estudio-30s-2026-11-27.md](evidence/foto-estudio-30s-2026-11-27.md) (9 de 12 aptas a ciegas, 17-23 s). Los métodos `sequential` y `joint` no se han vuelto a medir.

## 5. Cómo arrancarlo

```bash
services/tryon/setup.sh        # entorno + ~3,9 GB de pesos (FASHN, DWPose, Sapiens2)
services/imagegen/setup.sh     # ComfyUI + Qwen-Image-Edit-2511 + LoRAs (~24 GB), para calzado, complementos y vistas
services/tryon/run.sh          # :8002
services/imagegen/run.sh       # :8188
```

En `.env` de la API: `TRYON_SERVICE_URL=http://localhost:8002`, `IMAGEGEN_COMFY_URL=http://localhost:8188`
y, opcionalmente, `TRYON_STEPS` (20), `AVATAR_METHOD` (`sequential`), `TRYON_MIN_SIMILARITY` (0,6) y
`TRYON_MAX_DELTA_E` (15).

En la app: *Perfil → Tu avatar* (consentimiento, foto de cuerpo entero, confirmaciones), «Imágenes de
tu avatar» para elegir fondo y vista, y en cualquier conjunto «Verme con este conjunto».

Pruebas: `services/tryon` (`uv run pytest`: contratos y máscara), `services/api`
(`test/unit/imagegen.test.ts`: plan de capas, claves de caché, máscara por paso y decisión del
control; `test/integration/generative.test.ts`: imágenes del avatar, orden de las pasadas, caché al
cambiar una prenda, rechazo por color, servicio caído, retención y borrado), `apps/mobile`
(`__tests__/components/tryon.test.tsx`: progreso, elección de imagen y método, puntos de recorte).

## 6. Limitaciones

- **Lento en el Mac**: alrededor de 1,5–2 min por prenda (20 pasos) más ~3 min de la pasada de
  calzado y complementos. En una GPU de servidor serían segundos por prenda.
- **FASHN no admite calzado, bolsos, gorros ni joyas**: el calzado y un gorro o bufanda van en una
  pasada de Qwen-Image-Edit limitada a su zona; los bolsos y las joyas no se prueban.
- **La foto del avatar importa**: con ropa voluminosa (un plumífero) la máscara redibuja brazos y
  torso y quedan artefactos en la cintura; la app pide «de pie y de frente, brazos algo separados,
  ropa ajustada».
- **Capas**: una capa media o exterior se dibuja encima sin máscara; una chaqueta abierta deja ver
  la camiseta, pero un jersey grueso bajo un abrigo entallado no cambia el volumen del abrigo.
- **Postura**: la pose es la de la foto; las vistas 3/4 y perfil son generadas (Qwen) y la identidad
  puede variar en ellas.
- **Control de fidelidad**: compara cada zona con la prenda real (aspecto global y color medio), no
  los detalles finos (botones, logotipos). La app muestra siempre el resultado junto al conjunto real.
- **SAM 3**: sin acceso a los pesos (formulario de Meta); se usa SAM 2.1. Cuando se tenga acceso,
  `segment_points` y la detección multi del servicio de visión son los puntos de integración.
- **Sapiens2 License**: permite uso comercial con restricciones de uso; necesita revisión legal
  antes de lanzar (igual que la EIPD por las fotos de cuerpo).
