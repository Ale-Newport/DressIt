# Evidencia: Apple Intelligence (Foundation Models) y Vision en el dispositivo (2026-11-24)

**Pregunta:** ¿mejora la experiencia usar la IA que Apple incorpora en el iPhone, y para qué?

**Entorno:** Mac con macOS 27.2.1 y Apple Intelligence activado. El modelo de Foundation Models es el
mismo que usa un iPhone compatible: disponible, con español y con las capacidades `vision`
(imágenes) y `toolCalling`, comprobadas con `SystemLanguageModel.default`. SDK de iOS 27.2
(Xcode 27.2). Los scripts están en [`scripts/apple-intelligence/`](../../scripts/apple-intelligence/).

## 1. Reconocer prendas en fotos (Foundation Models con imagen, iOS 27+)

Se usaron las 10 fotos de la prueba en el simulador (una prenda por foto, fondos reales). Se pidió
una salida estructurada: tipo, color, estampado, material, nombre y descripción. Tarda entre 1,9 y
3,3 s por foto en el Mac.

| Prenda real | Tipo que dio el modelo | Nombre / descripción |
|---|---|---|
| Cazadora vaquera amarilla | chaqueta ✅ | «chaqueta amarilla» ✅ |
| Vestido floral | vestido ✅ | «Vestido largo blanco con estampado de flores naranjas» ✅ |
| Plumífero azul (puesto) | abrigo (≈) | «Abrigo acolchado de cuello alto con cremallera central» ✅ |
| Gorro con pompón | **chaqueta ❌** | «Gorro de lana negro con banda blanca y pompón» ✅ |
| Gorra azul | **chaqueta ❌** | «Sombrero de color azul con la letra C» (≈) |
| Bufanda en percha | **chaleco de punto ❌** | «Tejido, cuello alto, detalles en puntos» ❌ |
| Bailarinas con flores | **zapatillas ❌** | «Zapatos de estilo clásico con detalles florales» ✅ |
| Vaquero en cuerda | pantalón ✅ | «pantalones azules colgando en cuerda» ✅ |

- Material: «algodón» en las 10 fotos, aunque había lana, punto, plumón, cuero y lona.
- «Otros objetos visibles» (percha, maniquí…): inventa objetos que no hay en varias fotos.

**Conclusión:** para **clasificar**, el modelo de Apple es claramente peor que el clasificador del
servidor (Marqo-FashionSigLIP con umbrales calibrados: 95,9 % de acierto en categoría y 93,3 % en
subcategoría con 58 fotos; véase [vision-2026-11-24.md](vision-2026-11-24.md)). **No lo
sustituye.** Para **redactar** un nombre natural y una frase descriptiva sí es útil, sobre todo si
se le da el tipo ya reconocido por el servidor. En la app se usa así: un botón opcional en la ficha
de la prenda, y el usuario revisa la sugerencia antes de guardarla.

## 2. Entender peticiones al asistente (Foundation Models, texto, iOS 26+)

Doce frases en español con salida estructurada y muestreo determinista (`greedy`). Tarda entre 2,1
y 3,0 s por frase en el Mac. Salidas literales del modelo:

| Frase | Lectura del modelo | Valoración |
|---|---|---|
| ¿Qué me pongo mañana para ir a trabajar? | outfit · mañana · trabajo · formalidad +1 · **camisa** | ✅, pero se inventa la prenda y la formalidad |
| Necesito ropa para un viaje de cuatro días a Lisboa | trip · Lisboa · 4 días | ✅ |
| el viernes tengo una boda y no quiero llevar tacones | outfit · viernes · boda · sin tacones · **vestido** | ✅, salvo la prenda inventada |
| algo cómodo para el sábado que voy de excursión al monte | outfit · sábado · ocasión «excursión» (no existe) | ≈ |
| quiero ir arreglada esta noche a cenar con mis pantalones negros | outfit · hoy · cena · «mis pantalones negros» · **falda** | ✅, salvo la prenda inventada |
| búscame unas zapatillas blancas por menos de 80 euros | shopping · zapatillas · blanca · 80 € | ✅ |
| ¿va a llover pasado mañana? | weather · pasado mañana | ✅ |
| ¿qué me falta en el armario para tener más conjuntos? | gaps | ✅ |
| cuántas camisas tengo | **gaps** (debía ser count) · camisa | ❌ |
| me voy el finde a la playa a Valencia | **outfit** · Valencia · 0 días | ❌ (es un viaje) |
| tengo una entrevista el 3 y quiero ir más formal pero sin corbata | outfit · día 3 · entrevista · +1 | ✅, pero no recoge «sin corbata» |
| hace un frío que pela, dame algo abrigado para la uni | outfit · universidad · más abrigo · **abrigo** | ✅, salvo la prenda inventada |

**Conclusión:** acierta en lo que peor cubren las reglas del servidor: «el 3», «la uni»,
«excursión», destinos sin la palabra «viaje»… Pero **se inventa datos**, sobre todo tipos de prenda.
Por eso la app envía su lectura como una pista (`deviceIntent`) y el servidor:

1. aplica primero sus propias reglas;
2. solo toma del modelo lo que las reglas no encontraron;
3. descarta cualquier dato que no esté en el texto del usuario: ciudades, prendas, precios, días o
   ajustes de formalidad que no se mencionan. Los identificadores fuera del vocabulario también se
   descartan.

Las fechas las calcula el servidor; el modelo solo nombra el día. Las respuestas y las tarjetas
salen siempre de funciones reales. Las salidas de esta tabla son los casos de prueba de
`services/api/test/unit/device-intent.test.ts`.

## 3. Resúmenes (Foundation Models, texto, iOS 26+)

El modelo redacta frases correctas en español (por ejemplo: «En noviembre, en Madrid, el clima
suele ser fresco…»). En la app se usa para un **resumen del armario** en Estadísticas. Solo recibe
los datos de las estadísticas en texto (función `wardrobeFacts`) y la instrucción de no añadir
cifras, prendas ni marcas que no estén en esos datos. Se muestra con una nota que indica que lo ha
escrito Apple Intelligence en el iPhone.

## 4. Recortar el fondo en el dispositivo (Vision, iOS 17+)

`VNGenerateForegroundInstanceMaskRequest` con las 21 fotos originales guardadas: **50–70 ms por
foto** en el Mac, con bordes limpios. Igual que `rembg`, recorta el «sujeto» completo:

- se queda con la persona entera en las fotos con la prenda puesta;
- incluye la percha de la bufanda y la cabeza de maniquí del gorro.

**Conclusión:** no sustituye al recorte del servidor, que selecciona la prenda con un detector y
SAM 2.1. Se usa como **vista previa instantánea** en la cola de subida mientras el servidor hace el
recorte definitivo.

## 5. «Mejorar las imágenes con IA»

No se aplica ninguna mejora generativa a las fotos. Un modelo generativo puede cambiar el color, la
textura o la forma de la prenda, y el armario debe reflejar la ropa real. Lo que sí se hace, y es
determinista:

- **En el servidor:** balance de blancos y exposición suaves en cada recorte (ya existía), y ahora
  limpieza de bordes y eliminación de perchas, maniquíes y cuerdas.
- **En la app:** presentación tipo foto de producto, con margen, sombra que sigue el contorno y
  composición del conjunto a escala real.

## Qué no se ha podido verificar

- **Imágenes en el simulador:** no hay runtime de simulador de iOS 27 instalado; solo está el de
  iOS 26.3. La descripción de fotos se probó en el Mac con el mismo modelo, pero no dentro de la app.
- **iPhone físico:** no se ha probado. En un iPhone sin Apple Intelligence, o con iOS anterior a
  26, estas funciones no aparecen y la app funciona como antes.
