# Evidencia: foto de catálogo con fotos reales (2026-11-24)

Prueba de punta a punta del flujo de [foto-catalogo.md](../foto-catalogo.md) contra los servicios
reales: API, servicio de visión en MPS y ComfyUI con Qwen-Image-Edit-2511 (GGUF Q4_K_M + LoRA
Lightning de 4 pasos), en un Mac M2 Max de 64 GB. El script
[`catalog-photo-eval.ts`](../../services/api/scripts/catalog-photo-eval.ts) hace lo siguiente:

1. Registra un usuario con los consentimientos «Imágenes generadas con IA» y «Buscar mis prendas en
   Internet».
2. Importa una foto por condición, como hace la app, y espera a la foto de catálogo de cada prenda
   detectada.
3. Si el sistema pide otra foto, hace lo que permite la app: «Generar de todos modos».
4. Para cada prenda dibuja una comparativa: **foto original | solo fondo eliminado (lo que hacía el
   sistema anterior) | foto de catálogo**.

Las fotos son las de evaluación del servicio de visión ([`manifest.csv`](../../services/vision/eval/manifest.csv)),
con licencia abierta (CC BY, CC BY-SA, CC0 o dominio público, de Flickr y Wikimedia Commons). Las
imágenes generadas son derivadas creadas con IA.

**Qué no se ha probado:** no hay claves de SerpApi, Cloud Vision, Lykdat, FASHN ni fal.ai en este
entorno. La búsqueda inversa en Internet no se ha ejecutado de verdad: todos los buscadores constan
como «sin configurar en el servidor» y no se simula ningún resultado. Tampoco hay catálogos de tiendas
conectados. Por eso ninguna prenda tiene foto oficial y todas pasan a la generación local. El
contrato de cada proveedor está cubierto por tests con las formas de respuesta de su documentación.

## Condiciones pedidas y fotos usadas

| Condición pedida | Foto | Nota |
|---|---|---|
| Camiseta arrugada sobre una cama | `ov_polo_shirt_10` (polo negro arrugado sobre la cama, con logotipo) | además sale cortado por dos bordes |
| Camisa colgada en una percha | `ov_dress_on_hanger_08` (camiseta blanca en percha) | no hay ninguna camisa en percha en el conjunto de evaluación |
| Pantalones doblados | `ov_folded_jeans_05` (vaquero doblado con cinturón) | |
| Jersey sobre una silla | `ov_cardigan_03` (chaqueta de punto con las mangas recogidas, sobre una tela) | no hay ningún jersey sobre una silla en el conjunto |
| Chaqueta llevada por una persona | `ov_puffer_jacket_01` (plumífero puesto) | |
| Zapatillas desde un ángulo lateral | `ov_sneakers_shoes_12` (zapatilla de lado) | |
| Prenda estampada o con logotipos | `wm_t_shirts_07` (camiseta estampada con texto, colgada en una tienda) | |
| Varias prendas en una misma foto | `ov_clothes_on_bed_01` (ropa sobre una cama, modo «varias prendas») | |

## Resultados

Cada fila es una prenda detectada. Los tiempos son de cada intento: Qwen-Image-Edit-2511 en ComfyUI
local, compartiendo la GPU con el benchmark del probador virtual de otra sesión, que hacía cola.
«Ahora» es el resultado al repasar las imágenes guardadas con el control final (§ Fallos encontrados
y corregidos). JSON completo: [foto-catalogo-2026-11-24.json](foto-catalogo-2026-11-24.json) y
[foto-catalogo-2026-11-24-camiseta-arrugada-cama.json](foto-catalogo-2026-11-24-camiseta-arrugada-cama.json).

| Condición | Comparativa | Detectado | En el momento | Intentos (s) | Simetría | Ordenada | Parecido | ΔE paleta* | Ahora |
|---|---|---|---|---|---|---|---|---|---|
| Polo arrugado sobre la cama, cortado por dos bordes | [v2](foto-catalogo/camiseta-arrugada-cama.jpg) · [v1](foto-catalogo/camiseta-arrugada-cama-v1-pantalon-inventado.jpg) | polo | pide otra foto; con «Generar de todos modos»: v1 apta (✗ pantalón inventado), **v2 apta** | v1: 757 ✓ · v2: 193 ✓ | 0,97 | 0,68 | 0,82 | 4,2 | v1 rechazada (prenda añadida); v2 apta |
| Camiseta en percha | [ver](foto-catalogo/percha.jpg) | camiseta | apta | 795 ✓ | 0,91 | 0,84 | 0,90 | 0,0 | apta |
| Vaquero doblado con cinturón | [ver](foto-catalogo/pantalon-doblado.jpg) | vaquero | apta | 480 ✓ | 0,92 | 0,81 | 0,78 | 10,4 | apta (8,2) |
| Chaqueta de punto con mangas recogidas | [ver](foto-catalogo/jersey-mangas-recogidas.jpg) | jersey grueso | apta | 900 ✗ (tiempo agotado) · 755 ✓ | 0,95 | 0,87 | 0,89 | 5,6 | apta |
| Plumífero llevado por una persona | [ver](foto-catalogo/chaqueta-puesta.jpg) | plumífero | pide revisión (3 intentos: «ha cambiado los colores») | 754 ✗ · 384 ✗ · 478 ✗ | 0,96 | 0,80 | 0,79 | 15,2 | **apta** (6,1): falso rechazo corregido |
| Zapatilla de lado | [ver](foto-catalogo/zapatilla-lateral.jpg) | zapatillas de running | apta | 751 ✓ | — | 0,56 | 0,93 | 4,4 | apta |
| Camiseta estampada con texto, en tienda | [ver](foto-catalogo/estampada.jpg) | camiseta | pide otra foto (cortada); con «Generar de todos modos»: apta | 462 ✓ | 0,98 | 0,69 | 0,79 | 5,0 | apta |
| Varias prendas sobre la cama, n.º 1 | [ver](foto-catalogo/varias-prendas-1.jpg) | sombrero (chistera) | pide otra foto (pequeña); con «Generar de todos modos»: apta | 181 ✓ | — | 0,84 | 0,93 | 2,9 | apta |
| Varias prendas sobre la cama, n.º 2 | [ver](foto-catalogo/varias-prendas-2.jpg) | «bufanda» (en realidad, la parte de arriba de un frac, mal detectada y recortada) | pide revisión (3 intentos: otro tipo, poco parecido) | 454 ✗ · 458 ✗ · 753 ✗ | — | 0,69 | 0,68 | 7,7 | rechazada (además: prenda añadida) |
| Varias prendas sobre la cama, n.º 3 | — | sin tipo identificado | pide otra foto (pequeña); sin tipo no se puede forzar | — | — | — | — | — | — |

\* ΔE de paleta con el criterio de cada momento: CIEDE2000 con kL = 1 y umbral 12 durante la
evaluación; kL = 2, sin brillos especulares y umbral 10 en el control final (entre paréntesis).

**En resumen**

- De las 7 condiciones pedidas con una sola prenda, las 7 acaban con una foto de catálogo apta tras
  el control final. Dos de ellas necesitaron «Generar de todos modos», porque el sistema pidió primero
  otra foto: la prenda salía cortada por el encuadre.
- En la foto con varias prendas:
  - la chistera queda bien;
  - la pieza mal detectada se rechaza en los tres intentos y se pide intervención del usuario, en vez
    de proponer una prenda inventada;
  - la tercera pieza no se puede forzar, porque no tiene tipo.

**Control negativo: solo quitar el fondo (lo que hacía el sistema anterior)**

| Condición | ¿Pasa como foto de producto? | Simetría | Inclinación | P(packshot) |
|---|---|---|---|---|
| Polo arrugado | no | 0,86 | 3,0° | 0,22 |
| Camiseta en percha | no | 0,86 | 0,5° | 0,57 |
| Vaquero doblado | no | 0,80 | 4,0° | 0,46 |
| Chaqueta de punto | no | 0,81 | 5,5° | 0,70 |
| Plumífero puesto | no | 0,89 | 1,5° | 0,49 |
| Zapatilla de lado | no | — | — | 0,49 |
| Camiseta estampada | no | 0,88 | 2,0° | 0,38 |
| Chistera (complemento) | sí | — | — | 0,68 |

En prendas de ropa, el recorte sin fondo nunca pasa como foto de producto: no es simétrico, sale
torcido o el modelo lo ve desordenado. En complementos (una chistera) no se exige simetría, y un
recorte limpio puede bastar.

## Fallos encontrados y corregidos durante la evaluación

1. **El generador inventó un pantalón debajo del polo, y el control lo aceptó.** Polo y pantalón se
   tocaban, así que el análisis los vio como una sola silueta, y la similitud (0,73) superaba el
   umbral. Corrección:
   - el control pasa también el detector de varias prendas y rechaza cualquier prenda de ropa de
     otra categoría que ocupe al menos el 8 % de la imagen (código `extra_garment`);
   - el prompt pide mostrar solo esa prenda;
   - un reintento por este motivo añade su propia corrección.

   Repetido con la versión corregida: el polo sale solo, apto al primer intento.
2. **Falso rechazo del plumífero fotografiado al sol.** El 19 % de la referencia eran brillos
   especulares casi blancos, que contaban como un color «perdido». Corrección:
   - se quitan esos brillos (como máximo el 10 % más claro, solo si es casi neutro y la prenda es de
     color);
   - la paleta se compara con kL = 2 y los colores perdidos o añadidos con kL = 3.

   Con el criterio nuevo, la misma prenda da ΔE 4,1–8,9 y las prendas distintas 9,6–30,1. Los
   brillos no se confunden con rayas blancas: hay un test de las dos situaciones.
3. **Tiempo agotado que interrumpía cualquier trabajo de ComfyUI.** Al vencer el plazo, el cliente
   enviaba `/interrupt`, que detiene lo que se esté ejecutando, aunque sea de otra sesión. Ahora
   interrumpe solo si el prompt que se ejecuta es el suyo; si sigue en cola, lo retira. En esta
   prueba solo se interrumpió el propio packshot.
4. **El recorte automático pierde a veces las mangas extendidas** (IS-Net; foto `wm_sweaters_09`).
   El generador recibía solo la zona detectada: reconstruyó unas mangas lisas sin el jacquard de los
   puños, y el control no podía notarlo porque la referencia tampoco tenía mangas. Ahora, si la foto
   tiene una sola prenda, el generador recibe la foto entera. Comprobado en la app: capturas 15 y 16.

## La app (simulador de iOS, iPhone 17, iOS 26.3)

| Captura | Qué muestra |
|---|---|
| [13](ios/13-revision-preparando-foto-catalogo.jpg) | Cola de revisión: «Preparando la foto de catálogo…» mientras el usuario revisa los datos detectados |
| [14](ios/14-revision-foto-catalogo-lista.jpg) | «Foto de catálogo lista»: la foto creada con IA (etiqueta «IA») para elegirla antes de añadir la prenda |
| [15](ios/15-ficha-foto-catalogo.jpg) | Ficha de la prenda: «Tu foto» frente a «Creada con IA» («Comprobada»), con «Usar la foto de IA», «Volver a generar» y «Buscar de nuevo» |

| [16](ios/16-ficha-foto-catalogo-regenerada.jpg) | «Volver a generar», tras corregir el tipo («chaleco» → «jersey») en la revisión y ya con la versión que da al generador la foto entera: la foto nueva conserva el jacquard de los puños, que la primera había perdido. Queda un pequeño resto blanco junto al puño derecho |
| [17](ios/17-foto-catalogo-elegida.jpg) | «Usar la foto de IA»: queda «En uso» y aparece el aviso «Foto de catálogo actualizada. Tu foto original se conserva.» |
| [18](ios/18-armario-foto-catalogo.jpg) | El armario muestra la prenda con su foto de catálogo y la etiqueta «IA» |

Recorrido completo en la app con el jersey `wm_sweaters_09`, desde su importación hasta su foto en el
armario (sin las pruebas de visión intermedias):

1. Importación de la foto; la cola de revisión prepara la foto de catálogo.
2. El usuario corrige el tipo y añade la prenda.
3. Abre la ficha, compara su foto con la generada y pide «Volver a generar».
4. Elige la nueva y el armario se actualiza.

La cuenta de prueba es local (`e@e.es`) y la API, el servicio de visión y ComfyUI son los del Mac.


## Rendimiento

En este Mac (M2 Max), compartiendo la GPU con otra sesión, cada intento tarda 181–900 s. Sin
competencia por la GPU tarda 193–201 s, como el polo repetido o la primera prueba fuera de la app.
El control del servicio de visión (análisis, detector de varias prendas y OCR) añade 5–7 s por intento, medido en este Mac. Con FASHN (~40 s
según su documentación) o fal.ai el tiempo lo marca el proveedor; no se ha medido, porque faltan las
claves.
