# Evidencia: foto de estudio primero, recorte después (2026-11-25)

**Problema:** el flujo anterior tardaba ~30 s por intento y, con fotos de varias prendas, casi nunca
devolvía algo aceptable. **Objetivo:** hacerlo como Alta (investigación en
[research/competidores.md](../research/competidores.md#cómo-convierte-alta-las-prendas-en-fotos-de-estudio-investigación-del-2026-11-25)),
gratis y sin ComfyUI si no aporta nada.

Todo medido en el Mac de desarrollo (M2 Max, 64 GB) con las fotos de evaluación con licencia abierta
([`manifest.csv`](../../services/vision/eval/manifest.csv)): 5 de una prenda y 6 con varias, que dan 23
prendas detectadas. Banco de pruebas: [`studio-bench.ts`](../../services/api/scripts/studio-bench.ts),
con la misma semilla (1234) para los dos flujos.

## Qué fallaba (diagnóstico)

Revisando las 23 imágenes del flujo anterior, casi todos los fallos con varias prendas venían del
**nombre** que recibía el generador, no del generador:

- el clasificador (FashionSigLIP) llamó «vaquero» a unos shorts vaqueros, y salieron unos vaqueros
  largos negros;
- una falda de cuadros se clasificó como «bufanda», y salió una bufanda;
- el vestido azul eléctrico se midió como «celeste», y salió celeste;
- el polo negro fotografiado con flash se midió «antracita/gris», el prompt decía *near-black
  charcoal*, y salió gris. Con la palabra *black*, el mismo modelo lo pinta negro.

FLUX.2 klein dibuja lo que se nombra. Además, IS-Net recortaba mal las imágenes generadas: se comía
media camiseta blanca y la falda de cuadros.

## El flujo nuevo

```
foto ─▶ detección (visión, como antes)
          │ por cada prenda
          ▼
   recuadro rojo sobre la prenda ─▶ Gemma 4 E4B (MLX, ~1 s): «Navy Blue Puffer Jacket», categoría,
          │                          ¿se ve entera?
          │   varias prendas y no se ve entera / no es ropa ─▶ se pide una foto de ella sola
          ▼
   FLUX.2 klein 4B (MLX, ~20-25 s): foto de estudio desde la foto original (o la zona de la prenda
          │  con un 20 % de contexto), la prenda nombrada, fondo gris muy claro
          ▼
   visión /v1/catalog/check kind=studio (~7 s):
     BiRefNet lite recorta la foto de estudio → el color del recorte se iguala a la prenda real
     (claridad y, en prendas de color, tono y saturación) → control de presentación y fidelidad
          ▼
   el recorte es la foto de catálogo
```

## Resultado

Control ciego: las imágenes de los dos flujos se mezclaron, se renombraron al azar y **tres jueces
independientes** (agentes de Claude con un criterio estricto de editor de e-commerce: tipo, color y
detalles de la prenda real, presentación y recorte) puntuaron cada una sin saber de qué flujo venía.
Cuenta la mayoría de los tres.

| Flujo | Aptas | Una prenda | Varias prendas | Nota media (1-5) | Tipo correcto | Color correcto | Recorte limpio |
|---|---|---|---|---|---|---|---|
| Anterior (recorte + ComfyUI klein, fondo blanco) | **5/23** | 0/5 | 5/18 | 2,17 | 16/23 | 13/23 | 19/23 |
| Nuevo sin igualar el color | 9/23 | 3/5 | 6/18 | 2,90 | — | 14/23 | 23/23 |
| **Nuevo** | **11/23** | 2/5 → 3/5¹ | **9/18** | 3,09 | 19/23 | 16/23 | **23/23** |

¹ El polo negro salía negro en la foto de estudio, pero la primera versión del ajuste de color lo
aclaraba hasta el gris que el flash le daba en la foto. Ahora las prendas neutras (negro, gris,
blanco) nunca se aclaran. Comprobado sobre la misma imagen, sin repetir el control ciego.

**Prendas que no se ven enteras.** Con varias prendas, Gemma marcó 7 de 18 recuadros como fragmento o
montón: el montón de ropa que la detección tomó por una mochila, el extremo de un cinturón, un primer
plano duplicado de la falda, dos piezas de un frac sobre una cama, los calcetines y unos vaqueros
tapados por otros. Las 7 imágenes generadas de esos recuadros fueron no aptas en los dos controles
ciegos. Ahora no se generan: la app pide una foto de esa prenda sola y ofrece «Generar de todos
modos». De las 16 que sí se muestran, **10 son aptas** (11 con el polo corregido), frente a 5 de 23
en el flujo anterior, que enseñaba las 18 restantes aunque no sirvieran.

Comparativa (izquierda: flujo anterior; derecha: nuevo; en cada uno, foto | generada | recorte):
[generacion/estudio-primero-vs-actual.jpg](generacion/estudio-primero-vs-actual.jpg).

### Velocidad

| Paso | Anterior | Nuevo |
|---|---|---|
| Nombre de la prenda | — | ~1 s (Gemma 4 E4B) |
| Generación (832×1040, 4 pasos) | ~31 s (ComfyUI, GGUF Q8) | ~22 s de media (MLX q8; 18-34 s) |
| Control | 2-4 s | 5-7 s (BiRefNet en CPU, 3,5 s) |
| Prendas sin arreglo posible | se generaban hasta 3 veces | se piden de nuevo sin generar |

FLUX.2 klein en MLX tarda lo mismo que en ComfyUI cuando se mide en caliente (fp16: 26-30 s; q8: 25-29 s;
a 704×880, 19-25 s): en este Mac el coste está en el modelo, no en ComfyUI. ComfyUI sí aportaba poco aquí:
el servidor MLX se instala con un `pip install`, tiene el nombrador en el mismo proceso y no necesita
workflows. La foto de catálogo ya no lo usa; sigue haciendo falta para los avatares y el probador.

Alta tarda segundos porque genera en paralelo en servidores con GPU. En un solo Mac, el mínimo por
prenda es el de un modelo de 4 B parámetros, unos 20-30 s. Lo que sí se gana es no repetir intentos con
prendas que no se pueden arreglar.

## Prueba de extremo a extremo con la API

Con la API, la cola en proceso, el servicio de visión y el servidor MLX en marcha, se importaron 2
fotos con varias prendas (`ov_leather_jacket_04`, `ov_backpack_16`) con un usuario nuevo que dio el
consentimiento de imágenes con IA. Las 11 prendas detectadas terminaron en **311 s**:

- 3 fotos de estudio listas (vestido azul, chaqueta de cuero y shorts cargo), guardadas como recorte
  RGBA;
- 1 parada tras 3 intentos (las zapatillas: «no se parece lo suficiente»);
- 1 parada por el filtro nuevo («no se ve entera»);
- 6 paradas por el control que ya existía de «prenda muy pequeña» (recorte de menos de 220 px en
  estas fotos de 1024 px).

### Revisión del código

Una revisión adversarial (tres revisores por áreas y dos escépticos por hallazgo) confirmó 8 defectos,
ya corregidos y con pruebas:

1. La app no ofrecía «Generar de todos modos» con los mensajes nuevos.
2. Las generaciones con MLX no contaban para el límite diario por usuario.
3. Cuando el nombrador y el clasificador discrepan de categoría (un cárdigan es `top` para uno y
   `outerwear` para el otro), cada intento fallaba por «tipo». Ahora se omite esa comparación.
4. `kindFromName` confundía «dress shirt», «tie-dye», «cap-sleeve» y «boot-cut».
5. Una prenda recortada a mano en una foto con varias no tenía recuadro y se nombraba otra.
6. Motas y halos del recorte fijaban el encuadre: ahora se limpia la máscara como en las fotos del
   usuario y se descontaminan los bordes.
7. El color se corregía solo en los píxeles opacos y quedaba un borde del color antiguo.
8. Un `null` del VLM se convertía en el nombre «None».

## Qué se probó y se descartó

- **Qwen3.5-4B** como nombrador: razona en voz alta y no devuelve el JSON pedido. Gemma 4 E4B responde
  en ~1 s.
- **Nombrar «la prenda del centro» sin recuadro**: con dos prendas en el recorte, Gemma las nombra
  juntas («Blue Dress with Brown Leather Jacket»). Con el recuadro rojo acierta cuál es.
- **IS-Net** para recortar la foto de estudio: se come las prendas blancas sobre gris. BiRefNet lite
  las recorta bien todas (23/23).
- **BiRefNet con CoreML**: onnxruntime se cuelga compilándolo (`CoreMLExecutionProvider::Compile` no
  vuelve). Se usa en CPU (3,5 s).
- **Fondo blanco**: con prendas blancas el recorte falla. Se pide gris muy claro, que el control de
  `kind=studio` acepta porque se elimina después.
- **APIs de pago o con cuota** (Gemini «Nano Banana», FASHN, fal.ai): Gemini no tiene generación de
  imágenes en su nivel gratuito. Cloudflare Workers AI da unas 80 ediciones al día gratis con
  `flux-2-klein-4b`; no se ha integrado porque el modelo es el mismo que ya corre en local.

## Qué falla todavía

- **Detalles inventados en calzado**: unos salones grises pasaron a mocasines marrones (Gemma los nombró
  «Brown Leather Flat Shoes»), y unas zapatillas de trail a zapatillas de calle con estampado.
- **Azules vivos** (plumífero cobalto): siguen más apagados que en la foto, aunque mejor.
- **Prendas muy peculiares**: los calcetines de dedos pierden los dedos.
- Solo 11 fotos, 23 prendas y una semilla: sirve para comparar los flujos, no para dar una tasa de
  aciertos fiable.
