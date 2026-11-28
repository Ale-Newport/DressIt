# Evidencia: foto de catálogo rápida y gratuita (2026-11-24)

Objetivo: generar la foto de catálogo mucho más rápido, sin servicios de pago y, si es posible, con mejor calidad.
Todo se ha medido en el Mac de desarrollo (M2 Max, 64 GB, ComfyUI 0.46 en MPS), con ComfyUI recién
arrancado y sin el probador virtual cargado.

Banco de pruebas: [`packshot-bench.ts`](../../services/api/scripts/packshot-bench.ts). Para cada foto de
evaluación hace tres cosas:

1. Detecta la prenda con el servicio de visión.
2. Genera la foto con el mismo prompt y la misma entrada que la API.
3. Pasa el mismo control automático (`/v1/catalog/check`).

Cada intento añade 2–4 s de control, que no se cuentan en la columna de generación.

Perfil por nodos: [`imagegen-profile.ts`](../../services/api/scripts/imagegen-profile.ts).

## Resultado

| Workflow | Modelo | Generación (media) | Aptas al primer intento | Fidelidad (color, prenda, estampado) |
|---|---|---|---|---|
| `packshot` | Qwen-Image-Edit-2511 Q4_K_M + Lightning 4 pasos | **173 s** | 7/7 | 7/7 |
| `packshot-fast` (por defecto) | FLUX.2 klein 4B Q8_0, 4 pasos, cálculo en fp16 | **28 s** | 9/14 (2 semillas) | 14/14 |
| `packshot-fast` + corrección de tono (25/11) | igual, y después [`tone.ts`](../../services/api/src/modules/catalog-photo/tone.ts) | 28 s + 0,2 s | 10/14 (mismas semillas) | 14/14 |

- **Por intento es 6,2 veces más rápido.** Los fallos de klein son de presentación (prenda cortada,
  «desordenada», asimétrica o con sombra en el suelo). El servicio los reintenta con una corrección, así
  que llegar a una foto apta lleva unos 30–60 s, frente a 3 min con Qwen.
- **No se llega a 10 veces** con modelos gratuitos en este Mac. Lo que queda por probar está en
  [Qué falta](#qué-falta).

Comparativa (original | Qwen | klein): [generacion/packshot-qwen-vs-klein.jpg](generacion/packshot-qwen-vs-klein.jpg).
Fotos de evaluación con licencia abierta ([`manifest.csv`](../../services/vision/eval/manifest.csv));
las generadas son derivadas creadas con IA.

## Calidad, prenda a prenda

| Prenda | Qwen | klein (prompt final) |
|---|---|---|
| Polo negro con logotipo | Negro, logotipo correcto | **Sale gris claro** (L\* 70 frente a 40 en la foto). Con la corrección de tono, gris antracita oscuro (41) |
| Camiseta blanca en percha | Bien | Bien |
| Vaquero doblado con cinturón | Bien | Bien, conserva el cinturón |
| Chaqueta de punto con ochos | Bien | Ochos y 6 botones bien; color algo más anaranjado |
| Plumífero puesto | **Sale celeste** (el control lo aceptó) | Azul más parecido al original |
| Zapatilla de lucha | Bien | Bien (una vez «fondo» por la sombra del suelo) |
| Camiseta con texto «Mistletoe» | Bien, texto legible | Bien, texto legible |

## Qué se ha cambiado y por qué

1. **Workflow `packshot-fast`** ([`build_workflows.py`](../../services/imagegen/scripts/build_workflows.py)):
   - FLUX.2 klein 4B, con unas 5 veces menos pesos que Qwen-Image-Edit, Apache-2.0, ya instalado.
   - Lienzo de 832×1040 y foto de referencia a 0,5 MP.
   - Cálculo en **fp16** con el nodo `ModelComputeDtype`.

   Medidas en este Mac:

   | Configuración | Tiempo |
   |---|---|
   | bf16 a 896×1120 | 49 s |
   | fp16 a 896×1120 | 36 s |
   | fp16 a 832×1040, referencia a 0,5 MP | 28 s |
   | fp16 a 768×960 | 22 s, pero los botones salían grises |

   El lienzo de cada workflow va en su `.meta.json` (`canvas`), y la API lo usa en vez del suyo por
   defecto.
2. **Qwen sin una pasada de más:** con cfg 1 ComfyUI nunca usa el negativo, pero el workflow pasaba igualmente
   la foto por el codificador de 7B una segunda vez. Ahora el negativo es `ConditioningZeroOut`. Afecta a
   `packshot`, `avatar`, `tryon-accessories` y `avatar-view`.
3. **Prompt** ([`prompt.ts`](../../services/api/src/modules/catalog-photo/prompt.ts), versión
   `2026-11-24.6`). klein dibuja lo que se nombra:
   - con «extend trouser legs» y «no trousers» en el prompt de una chaqueta, añadía un pantalón en las
     dos pruebas;
   - con «ghost mannequin», dibujaba el maniquí.

   Ahora:
   - cada tipo de prenda solo nombra sus propias partes;
   - la presentación «fantasma» se describe sin la palabra *mannequin*;
   - de cada tono se nombra solo el color principal: el plumífero se describía como «blue, light blue
     and white» por los brillos y salía celeste;
   - «antracita» se describe como casi negro;
   - se pide conservar la claridad del color de la foto.

   Estos cambios valen también para Qwen.

## Corrección de tono de las prendas oscuras (25/11/2026)

klein aclara los tejidos oscuros. Ahora la API oscurece la foto generada hasta la claridad de la
prenda en la foto del usuario, antes del control (método en
[foto-catalogo.md](../foto-catalogo.md#corrección-de-tono-de-las-prendas-oscuras)). Mismo banco, mismas
semillas (klein da la misma imagen con la misma semilla, así que la comparación es exacta):

| Prenda | Claridad del cuerpo (L\*): foto · klein · corregida · Qwen | γ |
|---|---|---|
| Polo negro (foto con flash) | 40 · 70 / 67 · 41 / 40 · 18 | 2,5 / 2,32 |
| Plumífero azul | 36 · 48 / 41 · 36 / sin cambio · 56 | 1,38 / — |
| Zapatilla negra | 7 · 16 / 14 · 7 / 7 · 7 | 1,49 / 1,37 |
| Resto (claras o de tono medio) | sin cambio | — |

- El control automático sigue aceptando 14/14 por fidelidad. Ya aceptaba el polo gris, porque
  iguala la luminosidad media antes de comparar colores, así que la mejora no se ve en la tabla de
  aciertos, solo en la imagen.
- La única diferencia de presentación (la zapatilla con la semilla 777, «desordenada» antes y apta
  después) es ruido del control, no un efecto buscado.
- Tarda ~0,2 s por imagen.
- Comparativa (original | klein | klein corregida | Qwen):
  [generacion/packshot-tono-oscuro.jpg](generacion/packshot-tono-oscuro.jpg).
- **Límite:** iguala la foto del usuario, no el color real. El polo, fotografiado con flash, queda
  gris antracita, no negro como con Qwen.

## Qué falta

- **Negros fotografiados con flash:** quedan antracita. Se podría usar también el color con nombre
  («negro») como tope, pero exige una curva que no oscurezca los logotipos claros.
- **Más velocidad, por probar:**
  - los pesos de klein sin cuantizar (`Comfy-Org/Flux-2-Klein-4B`, 7,75 GB) evitarían descuantizar GGUF
    en cada paso;
  - 768×960 baja a 22 s, a costa de detalle.
- **Memoria:** con ComfyUI, el probador virtual y el servicio de visión cargados a la vez, el Mac llenó
  los 15 GB de swap y ComfyUI quedó parado. klein ocupa ~9 GB frente a los ~22 GB de Qwen.
- Solo 7 prendas y 2 semillas: no basta para dar una tasa de aciertos fiable.
