# Evidencia: app iOS en el simulador contra la API y la visión reales (2026-11-24)

Entorno: iPhone 17 Pro (iOS 26.3) en el simulador de Xcode 27.2, build de desarrollo de Expo SDK 58,
Metro en local, API (`pnpm dev:api`) y servicio de visión (`uv run uvicorn …`, MPS) en el mismo Mac,
PostgreSQL 17 + pgvector local, previsión real de Open-Meteo. Ubicación del simulador fijada en Madrid.

## Recorrido realizado (cuenta nueva creada desde la app)

| Paso | Resultado | Captura |
|---|---|---|
| Registro (nombre, correo, contraseña, aceptación de condiciones) | Cuenta creada contra la API; arranca el onboarding | — |
| Onboarding de 8 pasos: estilos, colores (paleta compartida), corte y tallas, marcas y presupuesto, ocasiones y prioridades, ciudad, privacidad, inspiración | Todos los pasos guardan en la API | — |
| Ciudad con «Usar ubicación aproximada» | iOS pide solo ubicación **aproximada**; la app redondea a 2 decimales y resuelve «Madrid» en el dispositivo | [00](ios/00-onboarding-ciudad.jpg) |
| Inicio | Tiempo real de Madrid (6–10 °C, lluvia 13:00–17:00, salida/vuelta, viento, atribución Open-Meteo) | [01](ios/01-inicio-tiempo.jpg) |
| Galería → 10 fotos (selector nativo con acceso privado) → subida en segundo plano → análisis → revisión | 10 detecciones con recorte sin fondo (la persona se elimina en las fotos puestas), confianza por atributo, «Revisar» en los dudosos, alternativas | [02](ios/02-revision-deteccion.jpg) |
| «Aceptar todas» → armario | 10 prendas con recortes y nombres correctos («Jersey grueso en camel») | [03](ios/03-armario.jpg) |
| Conjuntos del día (universidad, frío y lluvia) | Camiseta + jersey grueso + vaquero + plumífero + bufanda + gorro; explicaciones trazables; aviso honesto cuando un conjunto no protege de la lluvia | [04](ios/04-conjunto-flatlay.jpg), [05](ios/05-conjunto-explicacion.jpg) |
| Descubrir | Explica que no hay catálogo autorizado; el análisis de huecos funciona sin catálogo: «Con un bolso negro podrías crear 6 conjuntos nuevos con 7 prendas que ya tienes» | [06](ios/06-descubrir-huecos.jpg) |
| Asistente: «Necesito ropa para un viaje de cuatro días a Madrid» | Geocodifica, usa la previsión 25–28 nov (1–12 °C), crea maleta de 7 prendas con un conjunto por día; indica «sin IA externa» | [07](ios/07-asistente-viaje.jpg), [08](ios/08-viaje-capsula.jpg) |
| Perfil → Permisos y consentimientos | Fechas reales en los decididos, «Sin decidir» en el resto; condiciones/privacidad bloqueadas | [09](ios/09-consentimientos.jpg) |
| Segunda subida (1 foto) tras corregir el error de progreso | Sube y analiza sin errores | — |

## Errores encontrados en esta prueba y corregidos

| # | Error | Causa | Corrección | Prueba de regresión |
|---|---|---|---|---|
| 1 | Aviso «Cannot convert BigInt to number» al subir fotos | En iOS los contadores Int64 de `expo-file-system` llegan como BigInt (los tipos dicen `number`); Hermes no permite mezclarlos | `toUploadProgress()` normaliza con `Number()` | `apps/mobile/__tests__/lib/regressions.test.ts` |
| 2 | Pantalla roja al cambiar de pestaña («Cannot read property 'emit' of undefined») | La barra de pestañas usaba la forma antigua de props (`navigation`); Expo Router 58 pasa `emitter` y `navigateToTab`. Un doble *cast* ocultaba el error al compilador | Tipada con `BottomTabBarProps` de `expo-router/js-tabs` | `tsc` ahora lo comprueba |
| 3 | La app pedía «mínimo 8 caracteres» y la API exige 10 | Regla duplicada desalineada | App y textos a 10 | — |
| 4 | Consentimientos nunca decididos mostraban «1 ene» | La API devolvía la fecha 1970 | `updatedAt: null` + «Sin decidir» | `api.test.ts › reports undecided consents…` |
| 5 | El primer toque en las hojas inferiores no hacía nada | Ajuste automático de *insets* del `ScrollView` de iOS desplazaba el contenido al presentarse | `contentInsetAdjustmentBehavior="never"` | Verificado en el simulador |
| 6 | Titular de Inicio gigante que repetía el tiempo | Se mostraba el saludo completo como título | Título corto + recomendación como subtítulo | `regressions.test.ts` |

También: la barra de filtros del armario pasa a una fila desplazable y la respuesta del asistente ya no
escribe «°c».

## Limitaciones observadas (no corregidas aquí)

- Recortes: en fotos con la prenda puesta el plumífero incluye parte de las piernas; en fotos colgadas
  aparecen perchas o la cuerda de tender. Es la limitación conocida del servicio de visión
  ([vision.md](../vision.md)).
- Colores: el vaquero se clasificó como «gris» y el gorro marino con franja blanca como «blanco».
- No se ejecutaron en tiempo real: la extensión de compartir, el arrastrar y soltar del planificador,
  la exportación de imágenes, Android y un iPhone físico.
