# Limitaciones conocidas

Lista honesta de lo que **no** funciona todavía o funciona con restricciones.

1. **Catálogos comerciales**: no hay ningún catálogo real conectado. Ninguna tienda ofrece alta
   autoservicio y los programas de afiliación requieren aprobación. Descubrir, «Recomendado para ti»,
   la búsqueda de catálogo y la búsqueda visual muestran un estado vacío explicativo hasta ingerir un
   feed autorizado. Los tests usan un feed **de prueba** sintético, nunca mostrado en la app.
2. **Importación por enlace desde servidor**: medida el 2026-11-24, funciona en Springfield, Cortefiel,
   Pedro del Hierro y Nike; las otras 15 tiendas bloquean la lectura automática (403/429/conexión
   rechazada). Para ellas la vía es la captura en el dispositivo. Los resultados cambian con el tiempo
   (Zalando respondía 200 a la investigación y 403 a nuestra medición): ejecuta `retailers:check`.
3. **Imágenes de producto**: por defecto no se muestran las de tiendas sin licencia; el usuario aporta
   su foto.
4. **Precios**: solo son tan frescos como la última lectura/ingesta; pasado `PRICE_FRESHNESS_HOURS` se
   marcan como no verificados.
5. **Meteorología**: el endpoint gratuito de Open-Meteo es solo para uso no comercial; previsión máxima
   de 16 días (más allá, viajes usan la estación del año).
6. **Asistente**: entiende un conjunto amplio pero finito de formulaciones en español; no usa LLM por
   defecto.
7. **Visión**: modelos *zero-shot*. Color principal correcto en ~70 % de fotos reales (el negro
   fotografiado tiende a «antracita», el blanco en sombra a «gris»); detección multi-prenda con 64 % de
   precisión (por eso siempre pasa por revisión); en fotos con la prenda puesta la máscara puede incluir
   piel o solo parte de la prenda. Marca y material rara vez son deducibles: el sistema se abstiene en
   vez de inventar. Los pesos de IS-Net (eliminación de fondo) se entrenaron en parte con DIS5K
   (términos no comerciales): revisión legal pendiente. El servicio necesita ~6 GB de RAM con todos los
   modelos y 13–25 s de arranque en frío.
8. **Correo**: no hay conexión OAuth a buzones; el usuario comparte o pega las confirmaciones.
9. **Calendarios externos** (Google/Outlook): solo calendario del dispositivo y eventos manuales.
10. **Docker Compose** no se ha podido probar en la máquina de desarrollo (sin Docker); la configuración
    local equivalente (Homebrew) sí está probada.
11. **S3**: el controlador S3 está implementado pero los tests usan almacenamiento local.
12. **Probador virtual y fotos generadas** ([probador-virtual.md](probador-virtual.md),
    [generacion-imagenes.md](generacion-imagenes.md)): funcionan en local con modelos abiertos, pero en
    el Mac de desarrollo tardan minutos (1,5–2 min por prenda; ~3 min por foto de estudio); FASHN no
    viste calzado ni complementos (van en una pasada de Qwen-Image-Edit); con ropa voluminosa en la foto
    del avatar quedan artefactos en la cintura; el control de fidelidad compara aspecto y color por
    zona, no detalles finos. SAM 3 no integrado (pesos tras formulario de acceso). Sapiens2 License y
    EIPD de las fotos de cuerpo: revisión legal pendiente.
13. **App móvil**: verificada en el simulador de iOS (ver [evidencia](evidence/ios-simulador-2026-11-24.md)).
    Sin verificar en tiempo de ejecución: extensión de compartir, arrastrar y soltar del planificador,
    exportación de imágenes, Android y iPhone físico (requiere firmar con tu equipo de Apple; la
    extensión de compartir con un Apple ID gratuito puede fallar por el App Group). La cola de subidas
    vive en memoria: si se cierra la app durante una subida, esas fotos se pierden. No hay OCR en el
    dispositivo (se usa el del servidor).
