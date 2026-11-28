# Evidencia: detección con VLM, prendas parciales y dos modelos (2026-11-25, tarde)

Segunda ronda tras [foto-estudio-2026-11-25.md](foto-estudio-2026-11-25.md). Objetivo del usuario:
resultados como los de Alta con **cualquier** foto de prendas (parciales, varias, raras o complicadas),
gratis.

## Qué enseñaron las fotos que el usuario pasó por Alta

El usuario subió a Alta dos fotos de nuestro conjunto de evaluación:

- **`ov_hoodie_00`**: una sudadera puesta de la que casi solo se ve la capucha. Alta devolvió la
  sudadera completa, con el forro gris, el bolsillo canguro y los cordones. **No rechaza lo parcial:
  lo reconstruye.** DressIt pedía otra foto («cortada por los bordes»).
- **`ov_clothes_on_bed_01`**: un frac cuyo cuerpo verde y faldones negros el detector partía en dos
  («americana» y «bufanda»). Alta devolvió **un frac**. Su detección entiende qué es una prenda.

## Qué se cambió

1. **Detección con un modelo de visión y lenguaje sobre la foto entera** (como Alta). Qwen3.5-4B en el
   servidor MLX (`POST /v1/garments`) lista las prendas del sujeto principal, cada una como un artículo,
   con su caja, nombre en inglés y en español y la descripción de la prenda completa. El servicio de
   visión segmenta esas cajas con SAM 2.1. Gemma 4 E4B cajeaba mal (6 cajas para unos shorts); Qwen3.5
   encontró el frac como una prenda, la sudadera y la camiseta de debajo, los vaqueros por separado y
   los tacones.
2. **Lo parcial se reconstruye**: no se pide otra foto si la prenda sale cortada, pequeña o puesta; el
   prompt describe la prenda completa y avisa de que se ha completado.
3. **¿Es la misma prenda?** Qwen nombra la foto generada (`POST /v1/identify`) y se compara con la
   prenda: categoría; pantalón, short o falda; tacón, plano, zapatilla o bota; chaqueta, abrigo o
   chaleco; vestido o mono; conjunto en vez de una pieza; capucha perdida; calcetería dibujada como
   otra cosa.
4. **Dos modelos**: klein en MLX (~28 s) y, cuando dibuja otra prenda o en el último intento,
   **Qwen-Image-Edit-2511** en ComfyUI (~3,3 min). klein no conoce el frac: con la forma descrita con
   detalle dibujó una americana con pantalones; Qwen dibujó el frac como Alta.
5. **Calcetería** con presentación propia (plana, sin cuerpo): klein dibujaba unas medias como un body
   con mangas.
6. **Color** solo en las partes de color (el forro gris de una sudadera roja salía turquesa) y no en
   las prendas vistas en parte (su referencia lleva piel y otra ropa).
7. **Control** del modo `studio` más permisivo donde solo rechazaba imágenes buenas (textura, simetría,
   «orden», parecido) y con modo `partial`.
8. **Límite diario propio para los generadores locales** (300 intentos): el de 20, pensado para los de
   pago, cortaba una importación de 29 prendas a las 20.
9. El nombre en español del VLM es el nombre propuesto en la revisión («Sudadera roja con forro
   gris»), y su tipo corrige al clasificador.

## Verificación final (control ciego)

18 fotos importadas **en una sola importación** con la API real (`localhost:3000`): las 13 difíciles
de desarrollo, incluidas las dos que el usuario probó en Alta, y 5 que no se usaron para ajustar
nada. Es la misma importación que se ve en la app con la cuenta de demostración.

- **50 prendas detectadas**, las 50 con foto de catálogo, en **98 min**: ~2 min por prenda de media.
  Hubo 71 intentos de klein (~28 s) y 19 de Qwen (~3,3 min).
- **Tres jueces independientes** puntuaron cada imagen sin saber nada del sistema. Cuenta la mayoría.

| | Resultado |
|---|---|
| Aptas | **30/50** (60 %); **30/45** sin las 5 detecciones erróneas (67 %) |
| Presentación correcta | **50/50** |
| Color correcto | 44/50 |
| Tipo correcto | 41/50 |
| Detalles fieles | 27/50 |
| Escalados a Qwen | 18, de los que 11 acabaron aptos |

Comparativa (aptas y no aptas): [generacion/vlm-final-2026-11-25.jpg](generacion/vlm-final-2026-11-25.jpg).

En el desarrollo de esta ronda, con 13 fotos y 31 prendas, se pasó de 20/31 aptas a esta versión.
En la primera ronda (una foto de estudio sin VLM) se medía 11/23, y el flujo original 5/23.

### Qué falla todavía

- **Detecciones erróneas del VLM (5 de 50)**: una caja sobre un montón de cosas, el cuello de una camisa
  en vez de la camisa, un chaleco y un pantalón juntos, una mancha diminuta en el cuello de una
  gabardina y el reflejo de un bolso en un espejo.
- **Largo y silueta**: dos shorts muy cortos salen por la rodilla, una cazadora corta sale más larga y
  un vestido entallado sale evasé.
- **Detalles inventados**: cordones en mocasines y en salones blancos, logotipos en una mochila y en
  una camiseta, una banda roja en un sombrero de paja, el broche de la modelo convertido en una
  mancha verde, una tapeta de botones en un jersey.
- **Capucha perdida**: en esta pasada, la sudadera salió sin capucha (en la anterior, con ella).
  Después de la verificación se añadió la comprobación «prenda con capucha → la foto debe tenerla»,
  que no se ha vuelto a medir.

### Arreglos posteriores a la verificación (con pruebas, sin volver a medir)

La revisión de código adversarial encontró 11 defectos confirmados, todos corregidos:

- en el modo de una prenda, se vuelve al flujo de visión clásico (capas y soportes) y se le añade
  el nombre del VLM;
- no se guarda el nombre del VLM si el usuario cambió el tipo;
- los duplicados se buscan con el tipo corregido;
- la regla de «conjunto» ya no salta con «suit jacket»;
- «dress pants/shoes» no es un vestido;
- si el proveedor de reserva falla, no se descarta el principal;
- el escalado por identidad solo se hace desde klein;
- el límite de pago no corta la generación local;
- una prenda pequeña no cuenta como parcial;
- se guarda la categoría del VLM;
- no se recolorea con una referencia contaminada.

A esto se suman las comprobaciones de capucha y de calcetería. Lo que ya está en la app de la cuenta
de demostración se generó **antes** de estos arreglos.

## Velocidad y coste

Todo es gratuito y local (Apache-2.0: Qwen3.5-4B, FLUX.2 klein 4B y Qwen-Image-Edit-2511; MIT:
BiRefNet).

| Paso | Tiempo en el M2 Max |
|---|---|
| Detección y descripción (Qwen3.5-4B) | 3-12 s por foto |
| Foto de estudio con klein | ~28 s por intento |
| Foto de estudio con Qwen-Image-Edit (escalado) | ~3,3 min por intento |
| Control (BiRefNet, color, identidad) | 6-8 s |
| 50 prendas, de 2 en 2 | 98 min |

Alta tarda segundos porque genera en paralelo en servidores con GPU. Aquí el tiempo lo marca Qwen:
con más trabajos en paralelo (`CATALOG_PHOTO_CONCURRENCY`), klein seguiría con otras prendas mientras
ComfyUI está ocupado.

## Incidencias de la sesión

- **Memoria**: dos copias de cada servidor (una de otra sesión, inactiva) llenaron los 60 GB de swap y
  el disco. El servidor MLX ocupaba 31 GB porque MLX no vaciaba su caché; ahora se limita
  (`MLX_CACHE_GB`, 2) y ocupa ~10 GB.
- **Qwen3.5-9B** como juez no se pudo probar: no quedaba disco para descargarlo.
- **Qwen3.5-4B como juez** de imágenes era demasiado indulgente: solo detectaba el 37 % de las imágenes
  no aptas. Se usa solo para nombrar lo que muestra la foto generada, que sí hace bien.
