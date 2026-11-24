# ADR-0001 · Stack móvil: Expo + React Native

**Contexto.** Una app para iOS y Android con cámara, galería, calendario, ubicación aproximada,
extensión de compartir y navegador integrado, mantenida por un equipo pequeño.

**Decisión.** Expo SDK 58 (React Native 0.88, React 19) con TypeScript y Expo Router; *development
builds* (Expo Go de SDK 58 no estaba disponible al publicarse). Módulos: expo-camera, expo-image-picker,
expo-calendar, expo-location, react-native-webview, `expo-share-intent` 9 (única opción verificada para
SDK 58 en ambas plataformas, con *JavaScript preprocessing* de Safari para leer JSON-LD).

**Alternativas.** Swift/Kotlin nativos (doble coste), Flutter (sin compartir tipos con el backend TS).

**Consecuencias.** Un solo lenguaje en todo el producto y contrato de API compartido
(`@dressit/shared`). La extensión de compartir y la captura requieren build de desarrollo, no Expo Go.
