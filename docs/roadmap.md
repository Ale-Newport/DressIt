# Roadmap

Estado a 2026-11-24. ✅ hecho y probado · 🟡 parcial · ⏳ pendiente.

## Fase 1 — Investigación y arquitectura ✅
Tecnologías y licencias ([research/stack-tecnologico.md](research/stack-tecnologico.md)), competidores
([research/competidores.md](research/competidores.md)), integraciones comerciales verificadas
([research/integraciones-comerciales.md](research/integraciones-comerciales.md)), arquitectura, modelo de
datos y ADRs.

## Fase 2 — App y armario digital
- ✅ Backend, base de datos con RLS, autenticación, preferencias, consentimientos, exportación y borrado.
- ✅ Subida de fotos (EXIF eliminado), pipeline asíncrono, revisión, lote, duplicados (exactos, casi
  idénticos, similares), organización, estadísticas, coste por uso, espacios, etiquetas, edición masiva.
- ✅ Visión: detección multi-prenda, recorte sin fondo, atributos con confianza y abstención, colores CIELAB, embeddings 768-d, OCR; evaluado con fotos reales ([vision.md](vision.md)).
- ⏳ Recorte en el dispositivo (iOS `VNGenerateForegroundInstanceMaskRequest`, ML Kit en Android) como módulo Expo propio, para previsualizar antes de subir.
- 🟡 App móvil: ver [mobile.md](mobile.md).

## Fase 3 — Outfits y recomendaciones ✅
Motor de compatibilidad, generador, perfil personalizado, meteorología del día completo, recomendaciones
diarias, calendario, historial, feedback y aprendizaje, planificador con conflictos y semana sugerida,
viajes con cápsula y lista de equipaje.

## Fase 4 — Tiendas reales
- ✅ Importación por enlace (medida: 4 tiendas operativas desde servidor), captura en dispositivo
  (contrato y extracción), tickets/correos/etiquetas/EAN, lista de deseos, simulación antes de comprar,
  enlaces auténticos y de afiliado identificados, pipeline de feeds autorizados con frescura de precios.
- ⏳ Catálogos reales: requieren aprobación (Awin: Decathlon ES, adidas ES, Nike; Rakuten: Mango;
  acuerdo con Inditex). En cuanto haya credenciales: `catalog:ingest`.
- ⏳ Adaptador eBay Browse (segunda mano) tras obtener licencia de producción.

## Fase 5 — Funciones avanzadas
- ✅ Estilista conversacional (reglas + herramientas reales), búsqueda visual sobre catálogos
  autorizados (pgvector), analítica del armario, viajes.
- ⏳ LLM opcional para el asistente con consentimiento `ai_assistant_external`.
- ⏳ Evaluación offline del ranking (NDCG, tasa de aceptación) y calibración de pesos con datos reales.
- ⏳ Probador virtual: investigación pendiente; solo como representación aproximada claramente
  etiquetada, nunca como simulación de talla.

## Fase 6 — Lanzamiento
- ✅ Tests (motor, API unitarios e integración contra PostgreSQL real), CI, Docker, documentación.
- ⏳ Revisión legal, plan comercial meteorológico, textos legales, pentest, EAS Build y fichas de tienda.
- ⏳ Suscripción Premium (el campo `users.plan` y la separación de funciones ya existen; sin
  restricciones activadas).
