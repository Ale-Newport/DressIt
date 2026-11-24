# DressIt · App móvil (iOS / Android)

App en español (es-ES) de DressIt: armario digital, estilista y personal shopper. Vive en
`apps/mobile` (paquete `@dressit/mobile`) dentro del monorepo pnpm.

- **Stack**: Expo SDK 58 · React Native 0.88 · React 19.3 · Expo Router 58 (stack + pestañas JS + modales) · TypeScript 6.
- **Datos**: `@tanstack/react-query` 5 con persistencia en AsyncStorage (lectura sin conexión), tokens en `expo-secure-store`.
- **Nativo**: expo-image, expo-image-picker, expo-image-manipulator, expo-camera (fotos y códigos EAN/QR), expo-location (aproximada), expo-calendar (solo lectura), expo-sharing + react-native-view-shot, react-native-webview, expo-share-intent 9, reanimated 4 + gesture-handler 3, FlashList 2, react-native-svg.
- **i18n**: i18next + expo-localization. Español completo; inglés es un esbozo opcional (ver *Variables de entorno*).
- **Tipografías** (SIL OFL 1.1): *Instrument Serif* (titulares) e *Instrument Sans* (interfaz), vía `@expo-google-fonts`.
- **Contrato**: todos los tipos vienen de `@dressit/shared` (`packages/shared/src/api.ts`); listas de categorías, colores, estilos, ocasiones y estados de `vocabulary.ts` / `colors.ts`. No hay datos simulados en la app: cada control llama al endpoint real de `docs/api.md`.

---

## 1. Arquitectura

```
apps/mobile/
├── app.config.ts            # nombre, bundle id, permisos (textos en español), plugins
├── metro.config.js          # monorepo: watchFolders = raíz, node_modules app + raíz
├── jest.config.js / jest.setup.js
├── e2e/                     # flujos Maestro
├── __tests__/               # jest-expo + Testing Library
├── assets/images/           # icono y splash originales (monograma «D»)
└── src/
    ├── app/                 # rutas Expo Router (ver mapa)
    ├── api/
    │   ├── client.ts        # fetch tipado, timeouts, ApiError, refresh single-flight
    │   ├── config.ts        # resolución de la URL base
    │   ├── tokens.ts        # Keychain/Keystore (expo-secure-store) + caché en memoria
    │   ├── upload.ts        # subida multipart con progreso (expo-file-system)
    │   ├── queryClient.ts   # react-query + persistencia + NetInfo/AppState
    │   ├── keys.ts          # fábrica de query keys (invalidaciones coherentes)
    │   └── hooks/           # un fichero por recurso (me, home, garments, imports, outfits, planner, shopping, assistant, auth)
    ├── state/
    │   ├── session.tsx      # estado de sesión (cargando / sin sesión / con sesión)
    │   └── uploadQueue.ts   # cola de subidas en segundo plano para digitalizar en lote
    ├── theme/               # tokens (paletas claro/oscuro, tipografía, espacios) + ThemeProvider
    ├── components/
    │   ├── ui/              # sistema de diseño (ver abajo)
    │   ├── home/ wardrobe/ capture/ imports/ shop/ outfits/ planner/ profile/
    │   ├── OutfitCard.tsx  WeatherSummary.tsx  DateField.tsx
    ├── i18n/                # es/<namespace>.ts (completo) + en/common.ts (esbozo) + tipos
    └── lib/                 # fechas, formatos es-ES, vocabulario, URLs, captura de páginas, media
```

### Capa de datos

- **`api/client.ts`** — `createApiClient()` devuelve un cliente con `get/post/put/patch/del`.
  - JSON de entrada y salida; `Accept-Language: es-ES`.
  - Errores: el sobre `ApiError` (`{ error: { code, message, details } }`) se convierte en `ApiError` (clase) con `status`, `code` y el `message` en español del servidor, que es el que se muestra. Sin cuerpo válido se usa un mensaje genérico en español por código HTTP. Fallo de red → `network_error`; tiempo agotado (20 s por defecto, 45–60 s en endpoints pesados) → `timeout`.
  - Autenticación: `Authorization: Bearer`. Si el token caduca en < 30 s se refresca antes de la petición. Ante un 401 se llama a `POST /v1/auth/refresh` **una sola vez aunque haya varias peticiones concurrentes** (promesa compartida) y se reintenta la petición una vez. Si el refresh es rechazado (400/401/403) la sesión se cierra y se muestra «Tu sesión ha caducado». Si falla por red, se conserva la sesión (el modo sin conexión sigue funcionando).
  - El refresh token rota en cada uso; se guarda siempre el último.
- **Subidas** (`api/upload.ts`): antes de subir, la foto se redimensiona en el dispositivo (2048 px prendas, 2400 px tickets/etiquetas, 1280 px búsqueda visual) y se recodifica a JPEG (≈ 300–700 KB). Esto acelera los lotes y elimina los metadatos EXIF (incluido GPS). La subida usa la tarea nativa de `expo-file-system` (`multipart`, campo `file` + `kind`) con progreso real y reintento tras refresh en 401.
- **Cola de digitalización** (`state/uploadQueue.ts`): cada foto se sube en cuanto se hace o se elige (3 en paralelo). El usuario puede seguir haciendo fotos o salir de la pantalla. Al terminar, la sesión crea los trabajos `POST /v1/imports/photos` (en bloques de 30 imágenes) cuando todas las subidas han acabado; las fotos reintentadas después generan su propio trabajo. La pantalla de trabajo sondea `GET /v1/imports/:id` cada 1,5 s.
- **react-query**: `networkMode: offlineFirst`, persistencia en AsyncStorage con `maxAge` de **12 h** (las URLs de imagen firmadas no deben cachearse más). No se persisten exportaciones, geocodificación ni asistente. Las recomendaciones (`POST`) se tratan como lecturas cacheables por petición. Mutaciones con invalidación cruzada (cambiar el estado de una prenda invalida armario, estadísticas, inicio, recomendaciones y planificador) y actualizaciones optimistas en mover planes, maleta y lista de deseos.
- **Imágenes**: `expo-image` con `cachePolicy="memory-disk"` y `cacheKey` estable por id de imagen (la firma de la URL cambia, los bytes no).

### Sistema de diseño (`src/components/ui`)

Estética editorial: fondo marfil cálido `#F6F2EC`, tinta casi negra `#171513`, un único acento arcilla `#93452D` (en oscuro `#E0957A` sobre `#121110`), filetes finos, mucho aire y fotografía grande. Contrastes de texto ≥ 4,5:1 en ambos modos. Diseño original (no imita otras apps).

`Text` (variantes display/title/heading…, Dynamic Type con tope en titulares), `Button`, `IconButton` (siempre con etiqueta), `Chip`/`ChipGroup` (semántica radio/checkbox), `Card`, `Sheet` (hoja inferior sobre `Modal`, respeta «Reducir movimiento»), `ConfirmDialog` (con campo opcional: contraseña, «prestada a…»), `EmptyState`, `ErrorState` (mensaje del API + reintentar; variante sin conexión), `OfflineBanner`, `Skeleton*`, `PermissionPrompt` (explica el porqué antes del diálogo del sistema; enlace a Ajustes si se denegó), `Toast` (anunciado a lectores de pantalla), `ProgressBar`, `SegmentedControl`, `ListRow`, `TextField`, `BarChart`, `Badge`/`ConfidenceBadge`/`ProvenanceBadge`, `Screen`/`ScreenHeader`, `QueryView`.

Componentes de dominio:
- **`GarmentTile`** — foto recortada (`contain`) o normal, y si no hay foto, una **silueta SVG original por categoría** (camiseta, camisa, jersey, abrigo, pantalón, falda, vestido, mono, zapatilla, bota, tacón, bolso, sombrero, bufanda, joya, bañador) rellena con el color de la prenda. Insignias de demo, favorito y estado.
- **`OutfitCanvas`** — flat lay con las coordenadas normalizadas `layout` del servidor (como porcentajes: sin pasada de medición). Si falta la caja de un hueco, usa una disposición de reserva. Prendas sin imagen → silueta; productos candidatos (simulación) con borde discontinuo. Se anuncia como una sola imagen con la lista de prendas.
- **`ProductCard`** — siempre muestra tienda, precio y «verificado hace X» o **«precio no verificado»** (también cuando `isStale`: los datos antiguos nunca se presentan como actuales), insignias «Patrocinado» y «Enlace de afiliado», descuento y disponibilidad.
- **`OutfitCard`**, **`WeatherSummary`** (con atribución «Datos meteorológicos: Open-Meteo.com (CC BY 4.0)»), **`DateField`/`MonthCalendar`/`TimeField`** (sin dependencias nativas).

### Accesibilidad

Etiquetas, roles, estados y pistas en todos los controles; objetivos táctiles ≥ 44 pt (con `hitSlop` en chips pequeños); Dynamic Type (con límite en titulares para no romper el maquetado); contraste AA; «Reducir movimiento» desactiva animaciones de hojas, esqueletos y arrastre; regiones vivas para errores, respuestas del asistente y avisos; alternativa accesible al arrastrar y soltar del planificador («Mover a…»). `testID` en elementos clave para pruebas.

---

## 2. Mapa de navegación

```
/ (raíz: proveedores + Stack con rutas protegidas)
├── (auth)                       sin sesión
│   ├── welcome                  bienvenida
│   ├── login                    iniciar sesión
│   └── register                 registro (acepta condiciones y privacidad)
├── onboarding                   con sesión y onboarding pendiente (todos los pasos se pueden saltar)
└── (app)                        con sesión y onboarding hecho
    ├── (tabs)
    │   ├── index                Inicio
    │   ├── armario              Armario
    │   ├── outfits              Outfits
    │   ├── descubrir            Descubrir
    │   └── perfil               Perfil
    ├── assistant                Asistente (chat)
    ├── events/new               nuevo evento (modal)
    ├── garment/[id] · garment/new (modal)
    ├── wardrobe/stats · wardrobe/spaces
    ├── capture/camera (pantalla completa) · capture/session · capture/job · capture/review/[jobId]
    │   capture/imports · capture/scan (pantalla completa) · capture/text (modal)
    ├── import/link (modal) · import/browser (pantalla completa) · import/product/[id]
    ├── share-intent (modal)     entrada desde la extensión / intent de compartir
    ├── outfit/[id] · outfit/builder (modal) · outfit/compare
    ├── planner · history · trips/index · trips/new (modal) · trips/[id]
    ├── shop/search · shop/product/[id]?kind= · shop/simulate · shop/wishlist · shop/visual-search (modal) · shop/retailers
    └── profile/preferences · style-profile · consents · privacy · location (modal) · calendar · about
```

`src/app/+native-intent.tsx` redirige el enlace que abre la extensión de compartir (`dressit://dataUrl=dressitShareKey…`) a `/share-intent`.

---

## 3. Pantallas

- **Bienvenida / registro / login** — registro con nombre, correo, contraseña (≥ 8) y aceptación obligatoria de condiciones y privacidad (resumen en lenguaje claro). Errores del API visibles. Cierre de sesión revoca el refresh token (`POST /v1/auth/logout`) y borra la caché local.
- **Onboarding** — estilos; colores favoritos / a evitar; corte y tallas; marcas, presupuesto y sostenibilidad / segunda mano; ocasiones habituales, prioridades (comodidad/elegancia/practicidad, normalizadas a 1), sensibilidad a la temperatura, jornada (salida/vuelta); ciudad (búsqueda `/v1/geo/search` o «usar ubicación aproximada»: se redondea a 2 decimales **en el móvil** y el nombre se obtiene con el geocodificador del sistema); consentimientos (fotos, ubicación, calendario); fotos de inspiración opcionales (`kind: inspiration`). Cada paso se guarda con `PUT /v1/me/preferences` parcial; al final `POST /v1/me/onboarding/complete`.
- **Inicio** — saludo, tiempo (resumen del servidor, temperaturas de salida/vuelta, lluvia, viento, UV, atribución), ocasiones (preseleccionada `suggestedOccasion`, con `eventId` si viene de un evento), 4 conjuntos con lienzo, explicación, ajuste al tiempo, formalidad, estilo y marca de exploración. Acciones: aceptar, rechazar con motivos, guardar, regenerar (nueva semilla), cambiar una prenda (alternativas → swap), más formal / informal / abrigado / elegante, «esta prenda está sucia / no disponible» (cambia el estado y regenera excluyéndola), «me lo he puesto». Próximos eventos, plan de hoy, aviso de revisiones pendientes y acceso al asistente.
- **Armario** — rejilla FlashList, búsqueda, filtros (categoría, color, marca, estilo, temporada, material, ocasión, estado, favoritas, etiquetas, espacio, uso), orden, selección múltiple con edición en lote, accesos a estadísticas, espacios e importaciones, y hoja **Añadir**: Cámara · Galería (multiselección → lote) · Enlace de tienda · Escanear etiqueta · Ticket/captura/correo · Manual.
- **Ficha de prenda** — fotos, todos los atributos con confianza y fuente, corrección en línea, estados (incl. «prestada a…»), favorito, «me la he puesto», historial de uso y de disponibilidad, coste por uso, similares y duplicados, borrar.
- **Captura** — cámara con ráfaga (cada foto se sube ya), opción «varias prendas por foto», progreso por foto, trabajo de análisis con sondeo y **cola de revisión** por detección (recorte, campos predichos con confianza y alternativas, aviso de duplicado, editar, aceptar/rechazar, aceptar todo).
- **Escáner** — EAN/UPC/QR. QR con URL → importación de enlace. EAN → `POST /v1/imports/text` (`EAN <código>`, `source: label`) y acciones por línea.
- **Ticket / captura / correo** — texto pegado o imagen (`receipt`/`screenshot`) → `POST /v1/imports/text` → líneas con «Ver producto», «Importar enlace» o «Crear prenda» prerrellenada.
- **Importar enlace** — URL (ofrece pegar el enlace copiado **preguntando antes de leer el portapapeles**), estado de la importación y, si es `blocked`/`partial`, botón destacado **«Abrir en el navegador de la app»**.
- **Navegador de la app** — WebView normal con barra de dirección siempre visible. El usuario navega; al pulsar **«Capturar este producto»** se inyecta un script que solo lee lo que la página publica: bloques `application/ld+json`, microdatos schema.org (`itemprop` name, brand, price, priceCurrency, availability, color, sku, gtin13, image, size), meta `og:`/`product:`/`twitter:` y título → `POST /v1/imports/link/capture`. Nunca resuelve CAPTCHAs ni oculta el navegador; solo permite http(s).
- **Producto importado** — cada campo con insignia verificado / no verificado y su fuente, estado de la importación, variantes (talla/color), foto propia opcional, fecha y precio de compra, y tres destinos claramente separados: **En mi armario** (`to-wardrobe`), **Lista de deseos** (`to-wishlist`) y **Disponible para comprar** (enlace de salida con aviso de afiliado).
- **Outfits** — sugeridos, guardados, favoritos; constructor por huecos con vista previa y puntuación al guardar; ficha (cambiar prenda, guardar, favorito, valorar, aceptar/rechazar, ponérmelo, planificar, comparar, **exportar imagen** con view-shot + hoja de compartir, borrar); comparación lado a lado; **planificador** semana/mes con eventos, conflictos, «sugerir semana» y **arrastrar y soltar** entre días (pulsación larga) → `PATCH /v1/planner/:id`; historial; **viajes** (destino con búsqueda, fechas, actividades, equipaje → cápsula, lista de equipaje marcable, conjuntos por día).
- **Descubrir** — secciones de `/v1/shopping/sections` con su `emptyReason` honesto, huecos del armario (`/v1/shopping/gaps`), búsqueda en catálogo con filtros, ficha de producto («Ver cómo combinarlo con mi ropa» → simulación con antes/después, etiqueta de utilidad, prendas parecidas que ya tienes; «Comprar en <tienda>» vía `/v1/shopping/outbound` + aviso de afiliado; «Ya lo tengo» solo tras confirmar), lista de deseos, búsqueda visual (resultados «Parecido», «Exacto» solo si `match === 'exact'`) y matriz de tiendas/integraciones con estados honestos.
- **Asistente** — chat con tarjetas (conjuntos, prendas, productos, tiempo, viaje, huecos), sugerencias de ejemplo e indicación de si respondió el motor de reglas o un modelo.
- **Perfil** — preferencias y tallas, perfil de estilo aprendido (pesos visibles), ciudad, calendario (sincroniza 14 días en solo lectura: título, hora, lugar y «todo el día»; nunca descripciones ni invitados), tiendas e integraciones, consentimientos (interruptores con explicación), privacidad (**exportar mis datos** → JSON compartido; **borrar cuenta** con contraseña), apariencia (sistema/claro/oscuro), acerca de y licencias, aviso de datos de demostración, cerrar sesión.

Cada pantalla tiene estados de carga (esqueletos), vacío, error (con reintento), sin conexión y, cuando aplica, permisos.

---

## 4. Cómo ejecutarla

> **Expo Go no sirve**: la app usa módulos nativos que Expo Go no incluye (extensión de compartir, WebView, view-shot…) y Expo Go para SDK 58 no estaba publicado. Se usa siempre una **development build** (`expo-dev-client` incluido).

Requisitos: Node ≥ 24 (probado con 26), pnpm 10, Xcode (probado con 27.2) con CocoaPods para iOS, Android Studio con un emulador para Android. El API debe estar en marcha (`pnpm dev:api`, puerto 3000).

```bash
# desde la raíz del monorepo
pnpm install

# iOS Simulator (genera ios/ con prebuild, compila e instala; arranca Metro)
pnpm --filter @dressit/mobile ios            # = npx expo run:ios
# o un simulador concreto:
cd apps/mobile && npx expo run:ios --device "iPhone 17 Pro"

# Android emulator
pnpm --filter @dressit/mobile android        # = npx expo run:android

# Solo Metro (cuando la dev build ya está instalada)
pnpm dev:mobile                              # = expo start
```

`ios/` y `android/` se generan (Continuous Native Generation) y están en `.gitignore`: toda la configuración nativa está en `app.config.ts` y los plugins.

### URL del API (`src/api/config.ts`)

| Dónde se ejecuta | URL por defecto |
|---|---|
| `EXPO_PUBLIC_API_URL` definida | esa URL (gana siempre) |
| Simulador de iOS | `http://localhost:3000` |
| Emulador de Android | `http://10.0.2.2:3000` (alias del host) |
| Dispositivo físico en desarrollo | `http://<IP LAN del Mac>:3000`, tomada del host de Metro |

En dispositivo físico el API debe escuchar en `0.0.0.0` (no solo en `127.0.0.1`), y el móvil y el Mac deben estar en la misma red. La IP se ve en *Ajustes del sistema → Red* o con `ipconfig getifaddr en0`. La URL en uso se muestra en *Perfil → Acerca de*.

### iPhone físico (firma gratuita con Apple ID)

1. Conecta el iPhone por cable y activa **Modo desarrollador** (*Ajustes → Privacidad y seguridad → Modo desarrollador*, reinicia).
2. En Xcode, *Settings → Accounts*, añade tu Apple ID (crea un *Personal Team* gratuito).
3. El bundle id `com.dressit.app` es un **marcador**: con un equipo gratuito usa uno propio:
   ```bash
   cd apps/mobile
   DRESSIT_BUNDLE_ID=com.tunombre.dressit DRESSIT_ALLOW_HTTP=1 \
   EXPO_PUBLIC_API_URL=http://192.168.1.20:3000 npx expo run:ios --device
   ```
   (`--device` sin valor muestra la lista de dispositivos.) Si Xcode pide equipo de firma, abre `ios/DressIt.xcworkspace`, elige tu *Personal Team* en *Signing & Capabilities* para el target de la app **y** para la extensión *DressIt Share*, y repite el comando.
4. La primera vez: *Ajustes → General → VPN y gestión de dispositivos* → confía en tu certificado de desarrollador.
5. Limitaciones de la cuenta gratuita: los perfiles caducan a los 7 días (vuelve a ejecutar el comando) y los **App Groups** que usa la extensión de compartir pueden no estar disponibles en equipos gratuitos; si la firma de la extensión falla, la app funciona igual pero sin «Compartir con DressIt» en iOS.

`DRESSIT_ALLOW_HTTP=1` añade `NSAllowsArbitraryLoads` a la build de desarrollo para poder hablar por HTTP con la IP del Mac. Sin esa variable solo se permite HTTP a `localhost` y red local (`NSAllowsLocalNetworking`). Producción debe usar HTTPS.

### Android

El emulador accede al host por `10.0.2.2`. Las builds *debug* permiten tráfico HTTP en claro; una build *release* necesita HTTPS. Para un móvil Android físico usa `EXPO_PUBLIC_API_URL=http://<IP LAN>:3000` o `adb reverse tcp:3000 tcp:3000` (y entonces `EXPO_PUBLIC_API_URL=http://localhost:3000`).

### Variables de entorno

| Variable | Uso |
|---|---|
| `EXPO_PUBLIC_API_URL` | URL base del API (sin barra final). |
| `DRESSIT_BUNDLE_ID` | Sustituye el bundle id / package `com.dressit.app` (marcador). |
| `DRESSIT_ALLOW_HTTP=1` | Solo desarrollo: HTTP a IP de la LAN en iOS. |
| `EXPO_PUBLIC_ENABLE_EN=1` | Activa el esbozo en inglés si el idioma del dispositivo es inglés. Por defecto la app va siempre en español (mercado España) para no mostrar una interfaz a medio traducir. |

---

## 5. Extensión de compartir (enlaces desde tiendas y navegadores)

Librería: **`expo-share-intent` 9** (versión que declara soporte de SDK 58). `expo-sharing` 58 incluye ahora una recepción de compartidos propia, pero está marcada como *experimental*, así que no se usa. Configuración en `app.config.ts` (plugin) — requiere **development build**; no funciona en Expo Go.

| | iOS | Android |
|---|---|---|
| Mecanismo | Share Extension «DressIt Share» (target nativo generado en prebuild) que abre la app | `intent-filter` `ACTION_SEND` `text/*` en la actividad principal (`singleTask`) |
| Qué acepta | 1 URL web / página web y texto | texto y enlaces |
| Datos estructurados | **Solo desde Safari**: el preprocesador JS de la extensión lee los `<meta>` de la página y, además (inyectado por nosotros), los bloques JSON-LD y los microdatos schema.org. Si existen, la app llama a `POST /v1/imports/link/capture` | No hay preprocesador: llega solo la URL/texto |
| Sin datos estructurados (apps de tiendas, otros navegadores) | `POST /v1/imports/link` | `POST /v1/imports/link` |

Flujo: compartir → `dressit://dataUrl=…` → `+native-intent.tsx` → `/share-intent` → importación → ficha del producto con «En mi armario» / «Lista de deseos». Texto sin enlace (p. ej. un correo de pedido) → se ofrece importarlo como ticket. Sin sesión, la ruta protegida lleva antes al login.

En EAS Build la extensión añade un segundo target: hay que tener `eas.json` y credenciales para ambos (ver FAQ de expo-share-intent).

---

## 6. Privacidad en el dispositivo

- **Ubicación**: solo *cuando se usa*, precisión reducida en iOS (`NSLocationDefaultAccuracyReduced`), solo `ACCESS_COARSE_LOCATION` en Android (`ACCESS_FINE_LOCATION` y segundo plano bloqueados). Coordenadas redondeadas a 2 decimales antes de geocodificar y de enviar (`roundCoord` también en el hook, por si acaso).
- **Calendario**: solo lectura. En Android se pide únicamente `READ_CALENDAR` (con `PermissionsAndroid`, porque la petición de expo-calendar pide también escritura; `WRITE_CALENDAR` está bloqueado). Solo se envían título, inicio, fin, «todo el día» y lugar.
- **Fotos**: selector del sistema (sin permiso de galería completa en iOS 14+/Android 13+). Recodificación JPEG en el móvil → sin EXIF/GPS.
- **Portapapeles**: nunca se lee sin que el usuario pulse «Pegar enlace copiado».
- **Sesión**: tokens en Keychain/Keystore (`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`); al cerrar sesión o caducar se borra la caché local persistida.
- **Permisos Android declarados**: `CAMERA`, `READ_MEDIA_IMAGES`, `ACCESS_COARSE_LOCATION`, `READ_CALENDAR` (+ los que Expo añade para red/vibración). Micrófono, vídeo/audio, almacenamiento heredado y servicio en primer plano bloqueados.

---

## 7. Pruebas

```bash
pnpm --filter @dressit/mobile exec tsc --noEmit     # tipos
pnpm --filter @dressit/mobile test                  # jest-expo + @testing-library/react-native 14
```

Cubre: cliente API (cabeceras, query string, mapeo de errores, red, timeout, 204, **refresh + reintento**, **single-flight con 3 peticiones concurrentes**, refresh proactivo, fin de sesión), `ProductCard` (tienda/precio, «verificado hace X», datos antiguos → «precio no verificado», patrocinado/afiliado, resumen accesible), `OutfitCanvas` (coordenadas → porcentajes, disposición de reserva, orden z, siluetas, etiqueta accesible), `GarmentTile` (silueta sin foto, imagen, formas por categoría, etiqueta y estado *checked*), aserciones de accesibilidad de los componentes base (roles, estados, valores, regiones), utilidades (fechas, formatos, redondeo de ubicación, URLs, construcción de `PageCaptureRequest` con JSON-LD/meta/microdatos, pesos de prioridades) y **pruebas de humo de pantallas** (Inicio, Armario, Descubrir, Perfil, Estadísticas) renderizadas con respuestas reales grabadas del API local (`__tests__/api-fixtures`, anonimizadas) para detectar errores de ejecución que el compilador no ve.

Jest usa el *crawler* de Node (`watchman: false`) porque en algunas máquinas la instalación local de watchman está rota.

### E2E con Maestro (`apps/mobile/e2e`)

| Flujo | Qué recorre |
|---|---|
| `register-onboarding-garment-home.yaml` | Registro con correo aleatorio → onboarding (responde estilos, salta el resto) → Armario → Añadir → Manual (camiseta) → Inicio con recomendaciones |
| `link-import.yaml` | Registro → Armario → Añadir → Enlace → ficha del producto → Lista de deseos (o comprueba que se ofrece el navegador de la app si la tienda bloquea) |

Maestro no está en el repo (herramienta global). Instalación: `curl -fsSL "https://get.maestro.mobile.dev" | bash`. Con el API y una dev build instalada en el simulador/emulador:

```bash
cd apps/mobile
maestro test e2e/register-onboarding-garment-home.yaml
maestro test -e PRODUCT_URL="https://www.tienda.es/p/chaqueta.html" e2e/link-import.yaml
```

Si cambias el bundle id, actualiza `appId` en los YAML.

---

## 8. Verificación realizada

- `pnpm --filter @dressit/mobile exec tsc --noEmit` → sin errores (con las rutas tipadas de Expo Router generadas).
- `pnpm --filter @dressit/mobile test` → 7 suites, 58 pruebas, todas en verde.
- `npx expo export --platform ios` y `--platform android` → ambos bundles Hermes generados sin avisos (≈ 5,8 MB cada uno).
- `npx expo-doctor` → 20/20 comprobaciones correctas.
- `npx expo prebuild --platform android` → manifiesto con los permisos esperados (los no deseados con `tools:node="remove"`) e `intent-filter` `SEND text/*`.
- **Build nativa iOS**: `npx expo run:ios --device "iPhone 17 Pro"` (iOS 26.3, Xcode 27.2) → *Build Succeeded*, 0 errores, incluida la extensión *DressItShare*. La CLI terminó con «Simulator app did not open fast enough» al intentar abrir Simulator.app, pero la app quedó instalada; se abrió con `npx expo start --dev-client` + `xcrun simctl openurl <udid> "exp+dressit://?__expo_url=http%3A%2F%2Flocalhost%3A8081"`. Capturas: [`docs/evidence/ios-welcome.png`](evidence/ios-welcome.png) y [`docs/evidence/ios-register.png`](evidence/ios-register.png).
- Contrato contra el API local en marcha (`curl`): registro, preferencias, alta de prenda, onboarding, `/v1/home`, recomendaciones (3 conjuntos con tiempo), listado paginado y secciones de compra devuelven las formas de `api.ts`.
- No verificado en dispositivo: las pantallas con sesión iniciada (la herramienta de simulador disponible no permite escribir texto en el simulador), Android en emulador, la extensión de compartir de extremo a extremo y los flujos Maestro.

## 9. Limitaciones conocidas

- **Sin OCR en el dispositivo** (sin servicios de pago): para tickets/etiquetas en imagen se envía `imageId` con texto vacío y el resultado depende de si el servidor hace OCR. Se dice así en la interfaz.
- **Cola de subidas en memoria**: si se cierra la app mientras suben fotos, esas fotos se pierden (los trabajos ya creados siguen en *Importaciones*).
- **Constructor de conjuntos**: no hay puntuación en vivo porque el API solo puntúa al crear (`POST /v1/outfits`).
- **Extensión de compartir iOS** con equipo gratuito de Apple: puede fallar la firma del App Group (ver §4).
- **Inglés**: esbozo; desactivado por defecto.
- **Espacios**: reordenación con botones subir/bajar (no arrastre).
- **E2E**: los flujos Maestro están escritos pero no se han ejecutado aquí (Maestro no está instalado).

---

## 10. Ambigüedades del contrato API (para alinear con el equipo del API)

1. **Escalas de puntuación** sin documentar (0–1 o 0–100): `OutfitDto.score`, `breakdown.*`, `formality`, `styleMatch`, `AlternativesResponse.alternatives[].delta`, `GarmentDto.formality/warmth`, `ImportJobDto.progress`, `/garments/:id/similar` `score`, `duplicateGroups[].score`, `DetectionDto.duplicate.score`, `VisualSearchResponse.results[].similarity`, `SimulationResponse.similarOwned[].similarity`, `baseline/withProduct.avgScore`, `StyleProfileDto` pesos. La app acepta ambas (≤ 1 → fracción).
2. **`GarmentStatus`** no tiene «no disponible» genérico: «esta prenda no está disponible» se envía como `stored`.
3. **Feedback irreversible**: no hay acción para deshacer `reject` ni `DELETE` de un uso (`wear`).
4. **Recomendaciones**: ¿los conjuntos rechazados pueden volver a aparecer con la misma petición/semilla? ¿`exclude` es necesario si el estado ya excluye la prenda? `adjustments.elegance` solo admite `0|1` (no hay «menos elegante»). `RecommendationResponse.greeting` duplica `HomeResponse.greeting`.
5. **`DayWeatherDto.rainPeriods.from/to`**: ¿`HH:MM` o ISO? La app acepta ambos.
6. **`HomeResponse.upcomingEvents`**: rango y límite no especificados. `CalendarEventDto` no tiene `allDay` (la sincronización sí lo envía).
7. **`GarmentListQuery`**: estado por defecto (¿se excluyen `retired`/`lent`/`stored`?); `color` ¿familia o hex? (se envía la familia); etiquetas en `addTags`/`removeTags`/`tags` ¿nombres o ids? (se envían nombres).
8. **`GarmentAttributeDto.attribute`/`source`**: nombres y valores posibles no listados (se asumen los campos de `GarmentDto`; fuentes `user`, `vision`, `link`, `receipt`, `inferred`…).
9. **`AcceptDetectionRequest.overrides`**: ¿se fusionan con lo predicho? Si solo se corrige `category`, ¿qué pasa con `subcategory`? `accept-all` no admite overrides (la app acepta primero una a una las editadas).
10. **`POST /v1/imports/photos`**: ¿máximo de `imageIds`? (la app trocea en 30).
11. **`ReceiptTextImportRequest.text`** es obligatorio: con imagen y sin texto se envía `''`. ¿Hace OCR el servidor? No hay endpoint de búsqueda por **EAN**: se reutiliza `/v1/imports/text` con `"EAN <código>"` y `source: label`.
12. **Espacios**: semántica de `position` (¿intercambio o inserción? ¿única?). La app intercambia con dos `PATCH`.
13. **`StatusChangeRequest.lentTo`**: no vuelve en `GarmentDetailDto` (se lee de la nota de `availabilityHistory`).
14. **Catálogo → armario**: no hay endpoint directo. «Ya lo tengo» hace `POST /v1/wishlist` + `POST /v1/wishlist/:id/owned`. `CatalogSearchQuery.minPrice/maxPrice` ¿euros o céntimos? (se envían euros).
15. **`ImportedProductDto`** no tiene `isStale` ni ventana de frescura; `ShoppingSectionDto` no indica explícitamente «no hay catálogo configurado» (se deduce de `emptyReason`). Se sugiere un código de motivo.
16. **`PageCaptureRequest.url`**: la app envía `document.location.href` (puede diferir del enlace original); ¿el servidor lo valida contra los dominios de la tienda? Las claves `dressit:jsonld`, `dressit:microdata`, `dressit:url` son una convención interna de la extensión iOS.
17. **`SimulationResponse.outfits`**: ¿se guardan? ¿se pueden abrir con `GET /v1/outfits/:id`?
18. **Constructor**: no hay endpoint para puntuar sin guardar; `OutfitDto` no devuelve la valoración (`rate`) previa del usuario; `/v1/outfits?filter=` sin paginación.
19. **Viajes**: `activities` sin vocabulario (se envían ids de ocasión + texto libre); `destinationName` (se envía «ciudad, región»); falta `countryCode`.
20. **Planificador**: al mover (`PATCH { date }`) ¿se recalcula `position`? ¿Qué hace `suggest-week` con días ya planificados? `GET /v1/history` `from/to` ¿inclusivos?
21. **`POST /v1/me/onboarding/complete`** y **`DELETE /v1/me`**: la app asume `204`/`UserDto` según la tabla; `DELETE /v1/me` lleva cuerpo `{ password }` (algunos proxies descartan cuerpos en DELETE).
