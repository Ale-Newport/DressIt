# Generación de imágenes: fotos de estudio y avatar

Dos funciones opcionales con IA generativa:

1. **Foto de estudio** de una prenda: a partir de su recorte, una foto de producto sin fondo y con
   luz uniforme.
2. **Tu avatar**: al empezar (o en *Perfil → Tu avatar*) el usuario sube su foto de cuerpo entero
   (y, opcionalmente, una de su cara); después puede **verse con cualquier conjunto** desde su
   detalle. El probador por pasos, el avatar persistente y su evaluación están en
   [probador-virtual.md](probador-virtual.md); aquí queda el método de una sola pasada.

Ninguna sustituye a la foto real sin que el usuario lo decida. Todas las imágenes generadas se marcan
como tales, en la app y en el propio archivo.

## Arquitectura

```
App ──POST /v1/garments/:id/studio──▶ API ──cola image-generation (concurrencia 1)──▶ worker
                                                                                      │
          ┌──────────── control de fidelidad (servicio de visión) ◀── imagen ◀── ComfyUI (Qwen-Image-Edit-2511)
          ▼
  aceptada → garment_images (kind studio, generated_by)      rechazada → nada guardado, motivo al usuario
```

- **ComfyUI** ([`services/imagegen`](../services/imagegen/README.md)) corre como programa aparte y se
  usa por su API HTTP (`/upload/image`, `/prompt`, `/history`, `/view`). Es GPL-3.0; DressIt no lo
  modifica ni lo enlaza.
- **Workflows** en formato API de ComfyUI:
  [`services/api/src/modules/imagegen/workflows`](../services/api/src/modules/imagegen/workflows),
  generados por [`build_workflows.py`](../services/imagegen/scripts/build_workflows.py) a partir de
  las plantillas oficiales de ComfyUI, con cargadores GGUF.
  - `studio` / `avatar` usan Qwen-Image-Edit-2511 (por defecto).
  - `studio-fast` / `avatar-fast` usan FLUX.2 klein 4B.
- **API**: [`modules/imagegen`](../services/api/src/modules/imagegen).
  - Trabajos en `generation_jobs`; avatar en `avatar_profiles`; consentimientos `ai_image_generation`
    y `avatar`.
  - Endpoints:
    - `GET /v1/generation/status`
    - `POST|GET /v1/garments/:id/studio`
    - `PUT /v1/garments/:id/primary-image`
    - `POST|GET /v1/outfits/:id/avatar`
    - `GET /v1/generations/:id`
    - `GET|PUT|DELETE /v1/me/avatar`
- **Sin generador configurado** (`IMAGEGEN_COMFY_URL` vacío), la API lo indica y la app oculta las
  funciones.

## Modelos y por qué estos

Investigación del 2026-11-24, con fuentes, en el informe del agente resumido aquí. Solo se aceptan
pesos con licencia que permita uso comercial.

| Uso | Modelo | Licencia | Descartados y motivo |
|---|---|---|---|
| Foto de estudio | **Qwen-Image-Edit-2511** (Q4_K_M) + LoRA Lightning de 4 pasos | Apache-2.0 | FLUX.1 Kontext [dev], FLUX.2 [dev] y klein 9B: licencia no comercial. Qwen-Image-2.1: Qwen Research License. LBM: CC BY-NC. BRIA RMBG-2.0: no comercial. |
| Foto de estudio rápida | **FLUX.2 klein 4B** (Q8_0) | Apache-2.0 | — |
| Avatar, una sola pasada | **Qwen-Image-Edit-2511**, con 3 imágenes: cuerpo, tablero del conjunto y cara | Apache-2.0 | Ver la tabla completa en [probador-virtual.md](probador-virtual.md#2-modelos-evaluados-y-elegidos). |
| Avatar, por pasos (por defecto) | **FASHN VTON v1.5** + Sapiens2 + Qwen para calzado y complementos | Apache-2.0 / Sapiens2 License | — |
| Vistas del avatar (3/4, perfil) | Qwen-Image-Edit-2511 + **Multiple-Angles LoRA** (fal) | Apache-2.0 | — |

## Resultados medidos (Mac M2 Max, 64 GB, ComfyUI 0.46 en MPS)

| Prueba | Tiempo | Resultado |
|---|---|---|
| Estudio, Qwen (fp16) | 148 s | **Imagen negra**: desbordamiento de Qwen-Image en fp16 (NaN). |
| Estudio, Qwen (bf16, VAE fp32) | 160–180 s | Correcta: fondo blanco, luz de estudio, forma fiel. Instrucción v1: cambió el punto de una manga y el número y color de los botones. Instrucción v2 (actual): mangas fieles; los botones grises salen oscuros. |
| Estudio, FLUX.2 klein 4B | 490 s (incluye carga en bf16) | Más deriva: color más dorado y botones plateados. |
| Avatar, Qwen (cuerpo + tablero de 4 prendas + cara) | 535 s | Lleva las 4 prendas del tablero; cara y pelo parecidos a la persona; **añadió rotos al vaquero** y simplificó las bailarinas. |
| Estudio desde la app (punta a punta) | 169–186 s | Aceptada (similitud 0,975, ΔE 6,1). Primero los botones salían aclarados: el recorte del servicio de visión aplicaba su corrección de color de fotos de móvil. Ahora se pide sin normalizar (`normalize=false`) y conserva los botones oscuros y grises. |
| Avatar desde la app con un conjunto de 7 prendas | 424–435 s | Con las 7 prendas, el modelo omitió el plumífero y la bufanda y puso la chaqueta de punto por fuera: **rechazado** (0,695). Con solo las prendas visibles (capa exterior, parte de abajo, calzado y un complemento): plumífero, gorro, vaquero y bailarinas correctos, **aceptado** (0,776). |

Comparación de las fotos de estudio (original, Qwen v2, FLUX.2 klein), en
[evidence/generacion/estudio-cardigan.jpg](evidence/generacion/estudio-cardigan.jpg). Foto original:
`ov_cardigan_03`, de AnnaKika, CC BY 2.0. Las otras dos son derivadas generadas con IA.

Las imágenes del avatar de la prueba no se publican: muestran a una persona real, aunque su foto
tenga licencia abierta.

## Control de fidelidad (y sus límites)

- **Foto de estudio:** la imagen generada se recorta (sin la corrección de color de fotos de móvil)
  y se rechaza si cumple cualquiera de estas condiciones:
  - su huella visual (FashionSigLIP) se parece menos de `IMAGEGEN_MIN_SIMILARITY` (0,85) a la de la
    prenda;
  - el tipo de prenda cambia de categoría;
  - **el detalle cambia** (`POST /v1/compare` del servicio de visión, tras alinear las dos siluetas):
    forma (IoU < 0,82), color por zonas en una rejilla de 12×12 (media o percentil 90 > 6, peor
    celda > 12) o textura (SSIM < 0,55). El motivo llega en español («Ha cambiado el color de alguna
    zona (botones, bolsillos, estampado…)»). Medidas reales en
    [evidence/catalogo-2026-11-24.md](evidence/catalogo-2026-11-24.md).
- **Avatar por pasos:** ver [probador-virtual.md](probador-virtual.md): cada prenda visible se busca
  en su zona del cuerpo (Sapiens2) y se compara con la real.
- **Avatar de una sola pasada:** se generan solo las prendas visibles (capa exterior, parte de abajo o vestido, calzado y
  un complemento; máximo 4). Cada una debe reconocerse en la imagen, y la media de su mejor parecido
  debe ser al menos `IMAGEGEN_AVATAR_MIN_SIMILARITY` (0,5). **Este control es débil:** con la ropa
  puesta, el detector reconoce mal las prendas. Un avatar bueno y uno con una prenda equivocada
  sacaron ~0,66. Por eso solo filtra fallos gordos, y la app muestra el avatar junto al conjunto real
  para que el usuario lo compare.
- **Límite:** antes, con solo la similitud global, la chaqueta de punto con los botones cambiados
  obtuvo 0,966 y pasaba; el control por zonas ahora la rechaza (peor celda 21,2). Aun así, un cambio
  menor que una celda (un logotipo pequeño, las costuras) puede pasar. Por eso la app nunca
  sustituye la foto real sin preguntar: muestra las dos lado a lado y el usuario decide. Los avatares llevan la nota «orientativa,
  puede no reflejar exactamente las tallas ni los detalles».

## Privacidad, seguridad y marco legal

- **Consentimientos** propios y revocables. Retirar «Tu avatar» borra al momento las fotos y todas
  las imágenes generadas, y también se borran con la cuenta. Ambos datos se incluyen en la
  exportación RGPD.
- **Fotos del usuario:** son datos personales. No se usan para identificar a nadie: no se calculan
  huellas faciales, así que no hay tratamiento biométrico. Solo sirven de entrada para sus propios
  avatares. Se sirven con URLs firmadas como el resto.
- **Confirmaciones obligatorias:** «estas fotos son mías» y «tengo 18 años o más». La app no
  verifica la edad ni la identidad, porque hacerlo exigiría biometría.
- **Nunca se genera** un avatar con ropa de baño. La instrucción pide siempre una persona vestida.
- **Reglamento europeo de IA, art. 50:** cada imagen generada lleva la marca en sus metadatos EXIF
  («AI-generated image (modelo) - DressIt») y una etiqueta visible «Generada con IA» en la app.
  C2PA no está implementado.
- **Revisión legal pendiente antes de lanzar:** evaluación de impacto (EIPD) por las fotos de
  cuerpo, y redacción final de los textos de consentimiento.

## Limitaciones

- **En el Mac de desarrollo es lento:** unos 3 min por foto de estudio y unos 9 min por avatar. En
  una GPU de servidor serían segundos (ver [README del servidor](../services/imagegen/README.md)).
- **Deriva de detalles:** botones, punto, rotos y accesorios. Se ha reducido con instrucciones más
  estrictas, pero no está resuelta.
- **Identidad en el método de una sola pasada aproximada:** Qwen genera a la persona de nuevo (en las
  pruebas, otra cara y otro cuerpo). El método por pasos edita la foto real y la conserva; no se
  usan modelos de identidad facial (los abiertos no son comerciales).
- **Sin verificar:** el flujo completo en un iPhone físico, y la calidad con fotos de usuarios
  reales distintas de las de evaluación.
