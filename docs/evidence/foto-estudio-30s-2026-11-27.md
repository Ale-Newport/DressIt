# Evidencia: fotos de estudio y probador con generadores de menos de 30 s (2026-11-27)

Tercera ronda tras [foto-estudio-vlm-2026-11-25.md](foto-estudio-vlm-2026-11-25.md). Encargo: seguir
mejorando las fotos de estudio de cualquier prenda (difícil, rara o vista en parte) hasta una
puntuación perfecta; probar otros modelos, pesos y parámetros, **descartando todo generador que tarde
más de 30 s por imagen**; y generar imágenes del usuario (su cara, su cuerpo) con las prendas que elija.

## 1. Qué generadores caben en 30 s (M2 Max, 64 GB)

| Generador | Tiempo por imagen | Decisión |
|---|---|---|
| **FLUX.2 klein 4B, fp16 sin cuantizar** (mflux 0.24) | mediana 14,2-15,3 s, máximo 22 s (foto de estudio); 17-23 s (probador, 2-4 prendas) | **Elegido** (Apache-2.0) |
| FLUX.2 klein 4B q8 | mediana 15,9 s, máximo 21,9 s | Igual de rápido y menos fiel: descartado |
| FLUX.2 klein 4B q4 | mediana 15,6 s, máximo 22,3 s | Ídem |
| klein 4B, probador con referencias de 0,6 / 0,25 MP y salida de 0,6 MP | 24-36 s | Pasa de 30 s: descartado (0,45 / 0,15 / 0,5 MP dan la misma calidad en 19-23 s) |
| klein 4B con caché de referencias (`use_kv_cache`) | — | No funciona con el 4B en mflux 0.24: descartado |
| Qwen-Image-Edit-2511 (ComfyUI, Lightning 4 pasos) | 173-250 s | **Descartado** (era la escalada de la ronda anterior) |
| FASHN VTON v1.5 (probador prenda a prenda) | 60-120 s por prenda | Descartado como método por defecto |
| FLUX.2 klein 9B, FLUX.3 klein | ~2× el 4B (9B); 16 pasos (FLUX.3) | Descartados: >30 s y licencias no comerciales que exigen cuenta |

Los modelos de visión y lenguaje no generan imágenes y no cuentan para el límite, pero se miden:

| VLM (4-bit, mlx-vlm) | Detección por foto | Calidad |
|---|---|---|
| Qwen3.5-4B (ronda anterior) | 3-12 s | Campos en inglés escritos en español («Calcetines blancos» → klein dibujó un jersey), sin largos, perchas y reflejos como prendas |
| Qwen3.5-9B | 6-31 s | Mejores nombres; aún perchas, reflejos y bastones; olvida guantes y zapatos |
| **Qwen3.5-35B-A3B** (3 B activos) | **4-22 s** | **Elegido**: sin perchas ni reflejos, encuentra guantes, zapatos y bolso, largos y rasgos fiables |

## 2. Qué se cambió

- **Detección**: Qwen3.5-35B-A3B; describe la prenda sola (nunca la persona: «apoyadas en el pelo» hacía
  que klein dibujara una cabeza), da el largo y los rasgos que la foto debe conservar (mangas, capucha,
  cordones, estampado grande, encaje, cinta, faldones, asa); descarta perchas, reflejos, objetos que no
  se llevan y cajas menores del 0,6 % de la foto; traduce lo que llegue en español.
- **Generación**: klein fp16; los shorts y las faldas se presentan con maniquí invisible y el bajo donde
  lo vio la detección (en plano, klein dibujaba bermudas para todos los shorts cortos); el calzado sin
  cordones lo dice (la instrucción pedía «laces tidy»); medias con pie cerrado.
- **Comprobación por rasgos** (`POST /v1/verify`): el VLM lee la foto de estudio y unas reglas la comparan
  con la detección (tipo, largo, forma de los shorts medida en el recorte, mangas, capucha, cordones,
  estampado, encaje, cinta, faldones, asa, pie de las medias, otras prendas añadidas). Lo que falla vuelve
  en el siguiente intento como «It must be exactly like this: …».
- **Restaurar** (`POST /v1/restore`): si klein dibuja otra prenda dos veces (el frac como traje), el
  último intento limpia el recorte real de la prenda imagen a imagen (~12 s).
- **Probador rápido** (`AVATAR_METHOD=fast`, `POST /v1/tryon`): la foto del avatar y la de cada prenda en
  una pasada de klein.

### Lo que se probó y no funcionó

- Comparar foto original y foto de estudio a la vez con el VLM: rechazaba 47 de 50 (también las buenas).
- Leer los rasgos de la prenda original dentro del recuadro rojo: confundía la prenda (unos calcetines
  leídos como sombrero). Se leen en la detección, donde el modelo ya sabe qué es cada prenda.
- Dar a klein el recorte limpio como referencia, «2-inch inseam», la vista de espaldas del frac: klein
  mantiene su forma típica (bermudas, traje con pantalones).

## 3. Resultados

### Fotos de estudio, banco sin la API (18 fotos, 53 prendas, un juez ciego por imagen)

| | Ronda anterior (verificación final) | Esta ronda (banco, antes de los últimos arreglos) |
|---|---|---|
| Aptas | 30/50 | 31/53 |
| Fallos de detección | 5 | 6 (cuello, gafas en el pelo, tira de calcetines, chaleco + pantalón) |
| Intentos por prenda | 1,8 (con Qwen, ~3,3 min) | 1,2 (todos < 30 s) |

El banco no aplica la corrección de color de la API, que es la causa de 4 de los fallos (gris jaspeado →
blanco, carbón → gris). Después de este juicio se corrigieron medias (pie cerrado), bolsos (asa inventada),
faldas (maniquí invisible con largo), restaurar solo ante otra prenda y el tamaño mínimo de caja.

### Fotos de estudio en la app real (verificación final)

Una importación de las 18 fotos con la API real y la cuenta de demostración (la que se ve en la app),
y **3 jueces ciegos por imagen** (cuenta la mayoría), con el mismo criterio estricto que la ronda anterior.

| | Ronda anterior (25/11) | **Esta ronda (27/11)** |
|---|---|---|
| Prendas detectadas | 50 | 50 |
| Con foto de catálogo | 50 | 50 |
| **Aptas** | 30/50 | **31/50** (31/48 sin las 2 detecciones erróneas) |
| Fallos de detección | 5 | **2** |
| Tipo correcto | 41/50 | 42/50 |
| Color correcto | 44/50 | 45/50 |
| Detalles fieles | 27/50 | 33/50 |
| Presentación | 50/50 | 44/50 |
| Generador más lento | Qwen, ~200 s por imagen | **klein, 22 s por imagen** |
| Tiempo total | 98 min | 84 min (con otra aplicación usando la GPU a la vez) |

Intentos por prenda: 22 con uno, 8 con dos y 20 con tres (98 en total); cada intento tarda 30-90 s en
la API (generación ~15 s + control de visión + dos preguntas al VLM, con dos prendas compartiendo el
servidor). La app marca como lista («ready») 32 prendas, de las que 21 son aptas; de las 18 que deja
para revisar, 10 eran aptas: los controles automáticos aún no coinciden con los jueces.

**Qué falla (19):**

- **Detalles que klein no copia** (5): el gráfico del águila sale inventado, el logo de la gorra
  deformado, las mangas de una camiseta raglán cambian de color, una camiseta bajo una sudadera roja
  sale con mangas rojas, la gabardina con una capucha que no tiene.
- **Restaurar el recorte** (4): con calcetines, medias y una cartera puestos o enrollados, el recorte
  real limpiado no parece una prenda de catálogo (tubos, piernas deformes).
- **Prendas que klein no sabe dibujar** (2): el frac (sale levita con pantalón) y un bolso de mano
  plano (lo dibuja con asa y el estampado del vestido).
- **Largo** (2): unos shorts muy cortos salen por medio muslo; unos calcetines por encima de la
  rodilla, por la rodilla.
- **Prendas vistas en parte que se interpretan mal** (3): una camisa azul con puños leída como jersey,
  unas faldas o pantalones de los que solo se ve la cintura.
- **Color** (1): unas medias de encaje verde azulado salen negras (la detección dijo «negras»).
- **Detección** (2): el cuello de una camisa y una caja con chaleco y pantalón.

### Probador rápido por la API (cuenta de demostración)

Avatar sintético (mujer de talla grande sobre fondo gris), 4 conjuntos de prendas de esta importación:
4/4 generados en 34-40 s por trabajo (dos pasadas como máximo, ~20 s cada una, más los controles).
La primera prueba destapó un fallo: la API solo enviaba las prendas con recorte enlazado, y una
falda, unos vaqueros y unos shorts cuya imagen era su foto de estudio no llegaban al generador
(corregido, con prueba). Después: campo, otoño y vestido correctos; en «casual» los vaqueros salen
con un efecto de short sobre mallas.


### Probador rápido (12 casos, 3 jueces ciegos por imagen, mayoría)

6 personas reales de las fotos de evaluación y 6 sintéticas (hombre de 30 años, mujer de 60 con gafas,
mujer de talla grande, hombre asiático, hombre alto negro, mujer con hiyab), cada una con 2-4 prendas.

| | Resultado |
|---|---|
| Aptas | **9/12** |
| Identidad conservada (cara, pelo, piel, complexión) | 12/12 según los 3 jueces |
| Tiempo | 17,2-23,1 s (mediana 19,7 s) |

Fallos: en una foto con gente al fondo, la ropa se copió también a un transeúnte (en la app el avatar va
recortado sobre fondo de estudio); unas zapatillas altas salieron bajas y sin el logotipo; una gabardina
salió más clara y más corta.

Imágenes: [generacion/estudio-30s-final-2026-11-27.jpg](generacion/estudio-30s-final-2026-11-27.jpg) (las 50
de la app con el veredicto de los jueces) y [generacion/probador-rapido-2026-11-27.jpg](generacion/probador-rapido-2026-11-27.jpg)
(los 12 casos del banco y los 4 de la API).

## 4. Segunda vuelta sobre los fallos (27/11, noche)

Lo que destapó el historial de intentos de la verificación final y qué se cambió:

- Los **calcetines y las medias puestos** acabaron restaurados por falsos positivos («varias prendas»
  para un par de calcetines; «leggings» para unas medias): ahora un par cuenta como una prenda y solo se
  restauran prendas que **nadie lleva puestas** (la detección dice si la prenda está puesta).
- El **frac** sí se restauró, pero se eligió un intento editado porque el nombrador llamó «chaqueta» a
  la foto restaurada: la foto restaurada ya no se vuelve a identificar (es la prenda real).
- **Bolsos y cartera**: klein añade un asa corta. El asa solo se comprueba en bolsos (la correa de una
  cartera contaba como asa).
- La **gabardina cortada por la foto** perdía la comprobación de capucha al saltarse la del largo: ahora
  solo se salta el largo.
- **Color por partes** («body beige; sleeves blue»), por familias de color: unas mangas azules dibujadas
  gris marengo o una camiseta gris con mangas rojas no pasan; tonos vecinos (crudo y beis, marino y azul)
  sí.

En el banco (un juez ciego por imagen) salen **32 de 51 aptas** (antes 31 de 53). Restaurar las prendas
extendidas con otros fallos (un asa, una cinta) no mejoró: de 4 restauradas, solo el sombrero salió apto;
los dos bolsos salieron rotos porque su recorte estaba partido por la cadena y el frac restaurado se ve
como una forma plana. Por eso la restauración queda solo para **otro tipo de prenda** y el servidor
rechaza los recortes en trozos (la pieza principal debe ser el 90 % del recorte).

### Segunda verificación en la app (mismas 18 fotos, 3 jueces ciegos por imagen, mayoría)

| | Ronda anterior (25/11) | 1.ª verificación (27/11) | **2.ª verificación (27/11, noche)** |
|---|---|---|---|
| Prendas detectadas | 50 | 50 | 51 |
| **Aptas** | 30/50 | 31/50 | **35/51** (35/48 sin las 3 detecciones erróneas) |
| Tipo correcto | 41/50 | 42/50 | 44/51 |
| Color correcto | 44/50 | 45/50 | 48/51 |
| Detalles fieles | 27/50 | 33/50 | 37/51 |
| Presentación | 50/50 | 44/50 | 47/51 |
| Tiempo total | 98 min | 84 min | 84 min |

Intentos: 27 prendas con uno, 4 con dos y 20 con tres. La app marca como lista 32 prendas (23 aptas) y deja
19 para revisar (12 aptas).

**Qué falla (16):**

- **Detección** (3): un chaleco y un pantalón en la misma caja, una tira de calcetín en el borde de la
  foto y solo el cuello de una camisa (que además sale blanca en vez de azul claro).
- **Bolsos** (3): klein pone un asa corta a los dos bolsos de cadena en los 3 intentos (la comprobación lo
  ve, pero la corrección no basta); el bolso de mano se describió con el estampado del vestido.
- **Prendas vistas en parte** (2): un pantalón técnico negro del que solo se ve la cintura sale como chino;
  una camisa azul con puños, como jersey.
- **Límites de klein** (2): el gráfico del águila con letras inventadas sin sentido; el frac restaurado
  queda como una capa plana.
- **Medias y piernas** (2): unas medias transparentes con las rodillas marcadas; unos tacones con las
  piernas (en medias) dentro.
- **Otros** (4): guantes hasta medio antebrazo (los reales llegan a la muñeca), mocasines con la hebilla en
  uno solo, una camiseta raglán con el cuerpo amarillo (era piedra) y una funda antigua dibujada como
  cartera moderna.

## 4b. Tercera vuelta (28/11)

Cambios, cada uno probado antes contra el servidor MLX con las fotos que fallaban:

- **Bolsos sin asa** (de cadena o de hombro, según la detección): la correa en curva delante del bolso y
  «no handle on top». Con la instrucción anterior («correa ordenada sobre el bolso») klein puso asa en 4
  de 4 imágenes; así, en 0 de 8.
- **Zapatos**: vacíos («sin pies, piernas, calcetines ni medias») y el par idéntico.
- **Guantes**: hasta la muñeca, salvo que el nombre diga largos.
- **Comprobaciones nuevas** (`attrs.py`): letras inventadas donde la detección no vio ninguna («text
  added»: klein escribe palabras sin sentido), pies, piernas o manos en zapatos y complementos, y pares
  desiguales.
- **Detección**: una caja que es solo una tira pegada al borde de la foto (los calcetines de los que solo
  se ve el borde) se descarta; la espera de la detección pasa de 2 a 5 min, porque el servidor atiende de
  uno en uno.
- **Probador**: cada prenda de abajo, vestido o abrigo lleva su largo en la instrucción
  («light blue denim jeans (full length, down to the ankles)»). Unos vaqueros sobre las mallas del avatar
  salían como bermudas con mallas azules; ahora salen largos. Los 4 conjuntos por la API, bien.

Repetición dirigida por la app, con las 6 fotos que tenían fallos (24 prendas, 3 jueces ciegos por imagen,
mayoría):

| | 2.ª verificación (27/11) | **Tercera vuelta (28/11)** |
|---|---|---|
| Aptas en esas 6 fotos | 14/24 | **21/24** |

Pasan a aptas los dos bolsos de cadena (ahora sin asa y a la primera), los tacones, las medias
transparentes, los guantes, los mocasines y la camiseta del águila. Siguen fallando la camiseta raglán
(cuerpo amarillo en vez de piedra y un logotipo inventado), los calcetines de los que solo se ve el borde
(la regla de la tira se añadió después) y el bolso de mano que copia el estampado del vestido.

### Tercera verificación completa en la app (28/11; mismas 18 fotos, 3 jueces ciegos, mayoría)

| | Ronda anterior (25/11) | 1.ª (27/11) | 2.ª (27/11, noche) | **3.ª (28/11)** |
|---|---|---|---|---|
| Prendas detectadas | 50 | 50 | 51 | 50 |
| **Aptas** | 30/50 | 31/50 | 35/51 | **38/50** (38/47 sin las 3 detecciones erróneas) |
| Tipo correcto | 41/50 | 42/50 | 44/51 | 45/50 |
| Color correcto | 44/50 | 45/50 | 48/51 | 47/50 |
| Detalles fieles | 27/50 | 33/50 | 37/51 | 34/50 |
| Presentación | 50/50 | 44/50 | 47/51 | 47/50 |
| Tiempo total | 98 min | 84 min | 84 min | 79 min |

Intentos: 25 prendas con uno, 7 con dos y 18 con tres. La app marca como lista 32 (24 aptas) y deja 18
para revisar (14 aptas).

Frente a la 2.ª verificación, prenda a prenda: pasan a aptas los dos bolsos de cadena, los guantes, los
tacones, las medias transparentes y los mocasines; dejan de serlo unos shorts muy cortos (dibujados largos),
unas zapatillas rojas (klein copió en la lengüeta la marca de agua del fotógrafo) y unas medias de encaje
(dos medias sueltas con hebillas copiadas de los zapatos). Esas tres salieron bien en otras ejecuciones:
es la variación de klein de una semilla a otra. La tira de calcetines ya no se detecta.

**Qué falla (12):**

- **Detección o lectura de la prenda** (6): una caja con chaleco y pantalón, solo el cuello de una camisa
  azul (sale blanca), una camisa azul con puños leída como jersey, un pantalón técnico negro visto solo en la
  cintura (sale chino), dos estuches antiguos leídos como cartera y el bolso de mano descrito con el
  estampado del vestido.
- **Límites de klein** (6): el frac (deforme), el gráfico del águila con letras inventadas, la raglán
  (amarilla y con un logotipo inventado), los shorts muy cortos, las zapatillas con la marca de agua y las
  medias de encaje.

Imágenes: [generacion/estudio-30s-final-2026-11-28.jpg](generacion/estudio-30s-final-2026-11-28.jpg) (las
50, aptas primero) y [generacion/probador-api-2026-11-28.jpg](generacion/probador-api-2026-11-28.jpg)
(los 4 conjuntos del probador por la API, con «casual» ya con los vaqueros largos).

## 4c. Cuarta vuelta (28/11): los fallos de detección

**Una segunda mirada de cerca, probada y descartada.** Para cada detección se recortó su zona con margen,
ampliada y con la caja en rojo, y se preguntó al VLM si era una prenda, un trozo de otra ya listada, varias
prendas o algo que no es ropa. En las 18 fotos:

- Diciéndole el nombre detectado, lo confirma casi siempre: no separó el chaleco del pantalón ni cambió nada
  que importara.
- Sin el nombre, empeora: el pantalón pasó a «delantero del frac» y se fusionó con el frac, el jersey azul
  pasó a «rebeca» y la falda a «pantalón».
- La primera versión, con «trozo de otra prenda», descartaba las camisetas que asoman bajo una sudadera o una
  cazadora.

Las fotos de evaluación tienen 640-1280 px y el VLM ya las ve enteras a 1024 px: el recorte no le da píxeles
nuevos, y la detección tardaba un 50-100 % más. Se retiró el código.

**Los jueces se equivocaban con las prendas pequeñas.** Vista de cerca, la foto de la rebeca tiene tres capas:
una camisa blanca de cuello, un jersey azul claro de cuello redondo y la rebeca. Las dos detecciones que los
jueces daban por erróneas («camisa blanca» por el cuello y «jersey azul claro») eran correctas. El bolso de
mano sí tiene estampado de flores. El banco (`catalog-e2e-bench.ts`) añade ahora un panel central con la zona
de la caja ampliada, y se volvieron a juzgar las 50 fotos de la 3.ª verificación con 3 jueces nuevos:

| Mismas 50 fotos de estudio | Foto entera | **Foto entera + zona ampliada** |
|---|---|---|
| Aptas | 38/50 | **36/50** |
| Detección errónea | 3 | **1** (un chaleco y un pantalón en una caja) |
| Color correcto | 47/50 | 45/50 |
| Detalles fieles | 34/50 | 37/50 |

Con la zona ampliada pasan a aptas la camisa, el jersey, la camiseta del águila y el pantalón técnico, y dejan
de serlo seis que de lejos parecían bien:

- de color: un bolso bronce aclarado a champán, una camiseta gris verdosa en gris neutro y una cazadora
  coñac en melocotón;
- de forma: un gorro holgado con una vuelta inventada, unas bailarinas dibujadas como mocasines y unos
  calcetines por encima de la rodilla dibujados hasta la rodilla.

Es el criterio más fiable, y el que se usa a partir de aquí.

**El color no admite una regla general.** Se midió la luminosidad (percentil 30 de L\*) y la saturación de la
prenda en la foto y en la foto de estudio de las 50:

- prendas aptas salen 18-48 puntos más claras que en la foto (calcetines, top y zapatos blancos, gabardina),
  porque la foto de casa tiene sombras;
- la cazadora y el bolso con el color mal difieren menos de 2 puntos: el fallo es de matiz.

Oscurecer los tonos medios estropearía las prendas claras, así que la corrección de color se queda como está.

**Bolsos de mano.** La detección describe un *clutch* llevado en la mano como «con un asa corta». klein dibujó
un bolso grande con dos asas y, con «sin asas», un bolso plano con una cadena inventada. Ahora:

- de un *clutch*, una cartera o un neceser se quitan las frases que hablan de asa;
- se pide «pequeño y plano, sin asas, sin correa ni cadena», salvo que la descripción mencione una correa;
- la comprobación nunca da por bueno un asa en un *clutch*.

Contra el servidor, con dos semillas: con la descripción original, 4 de 4 salen con asa; sin la frase del
asa, 2 de 2 sin asa ni cadena. Con la instrucción que genera ahora la API, otras 4 de 4 salen como bolso de
mano pequeño y sin asas. En la app (la foto del vestido, 3 jueces con zona ampliada) salió, en cambio, un
primer plano de tela plana sin forma de bolso: no apto, y la comprobación automática lo dio por bueno. En la
misma ejecución, el vestido y los guantes salieron aptos, y los salones blancos, planos (en la verificación
anterior, con la misma instrucción, salieron bien): klein cambia de una semilla a otra, y un solo intento por
foto no basta para medir un arreglo.

## 5. Por qué no es perfecto todavía

Con la regla de 30 s por imagen, en este Mac solo cabe FLUX.2 klein 4B, y klein tiene límites que ni
la instrucción ni la comprobación corrigen: no conoce el frac, inventa o deforma gráficos y logotipos
pequeños, y con prendas raras vuelve a su forma típica; además, la misma prenda sale bien o mal según la
semilla. Lo que mejoró (de 30 a 38 de 50 en tres rondas, con el criterio de la foto entera) es todo lo que
dependía de la detección y de las reglas: largos de shorts y faldas, cordones, capucha, chalecos sin mangas,
medias con pie, bolsos sin asa, zapatos vacíos, guantes cortos. Con el criterio más estricto de la zona
ampliada son 36 de 50, y lo que queda es casi todo generación: matices de color, formas típicas que klein
impone (la vuelta de un gorro, unas bailarinas como mocasines, unos shorts muy cortos como bermudas), el
frac y las medias de encaje. Solo queda un error de detección (un chaleco tendido sobre un pantalón). Para seguir subiendo harían falta un modelo de edición mayor que quepa en
30 s (una GPU de servidor lo permitiría con Qwen-Image-Edit-2511, Apache-2.0) o aceptar más tiempo
solo para las prendas difíciles.
