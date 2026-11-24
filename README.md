# DressIt

**Armario digital, estilista con IA y personal shopper** para iOS y Android. Mercado inicial: España
(interfaz y recomendaciones en español, arquitectura preparada para internacionalización).

- **Armario digital**: digitaliza tu ropa con la cámara o la galería (también varias prendas por foto y
  por lotes), con eliminación de fondo, reconocimiento de atributos con nivel de confianza, detección de
  duplicados, revisión rápida, organización por espacios, estados (colada, prestada…), coste por uso y
  estadísticas.
- **¿Qué me pongo hoy?**: conjuntos completos con tus prendas reales, adaptados al tiempo de **todo tu
  día** (no solo de la hora actual), a tus planes y a tu estilo, con explicaciones, cambios de una sola
  prenda y aprendizaje real de tus valoraciones.
- **Personal shopper**: detecta qué le falta a tu armario («con una chaqueta beige podrías crear 7
  conjuntos nuevos»), simula productos con tu ropa antes de comprar y te lleva a la página auténtica
  del producto. Sin inventar precios, stock ni productos.
- **Planificador, viajes y estilista conversacional** en español.

> **Estado honesto (2026-11-24).** Backend, motor de recomendaciones, modelo de datos, servicio de
> visión y app móvil: completos y probados (214 tests). La app se ha recorrido en el simulador de iOS
> contra la API y la visión reales: registro, onboarding, 10 fotos de galería digitalizadas, conjuntos
> con el tiempo real de Madrid, viaje desde el asistente y privacidad
> ([evidencia](docs/evidence/ios-simulador-2026-11-24.md)). La conexión con tiendas reales funciona mediante importación por enlace (medida:
> 4 tiendas desde servidor; el resto mediante captura en el dispositivo) y el pipeline de catálogos está
> listo, pero **ningún catálogo comercial está conectado todavía**: todas las vías legítimas requieren
> aprobación de la tienda o de la red de afiliación. Ver [limitaciones](docs/limitaciones.md) y la
> [matriz de comercios](docs/comercios.md).

## Estructura

```
apps/mobile/              App Expo (iOS/Android) — docs/mobile.md
services/api/             API Fastify + worker (Node 24+, TypeScript)
services/vision/          Servicio de visión (Python, FastAPI, PyTorch) — docs/vision.md
packages/shared/          Vocabulario de dominio, color (CIELAB/CIEDE2000) y contrato de API
packages/stylist-engine/  Motor de recomendaciones (TS puro, determinista)
docs/                     Arquitectura, ADRs, investigación, evidencias
scripts/                  Preparación de la base de datos
```

## Inicio rápido (macOS)

Requisitos: Node ≥ 24, pnpm 10, PostgreSQL ≥ 15 con pgvector, Redis, Python 3.11+ con `uv`, Xcode
(para iOS). Guía detallada: [docs/instalacion-macos.md](docs/instalacion-macos.md).

```bash
pnpm install
```

```bash
pnpm db:setup
```

```bash
pnpm dev:api
```

```bash
cd services/vision && uv sync && uv run uvicorn app.main:app --port 8001
```

```bash
pnpm dev:mobile
```

Con Docker: `docker compose up -d postgres redis minio` (dependencias) o
`docker compose --profile app up -d --build` (todo el backend).

## Tests

```bash
pnpm test
```

| Paquete | Tests | Qué cubre |
|---|---|---|
| `@dressit/shared` | 14 | CIEDE2000 contra valores de referencia, familias de color, integridad del vocabulario |
| `@dressit/stylist-engine` | 24 | Solo prendas disponibles, conjuntos completos, tiempo del día completo, formalidad, feedback que cambia el ranking, redundancia de compras, utilidad marginal, escala (1 500 prendas) |
| `@dressit/api` (unitarios) | 33 | SSRF, robots.txt, extracción schema.org/microdatos, categorías, feeds Awin, EAN, OCR de tickets, tiempo, URLs firmadas |
| `@dressit/api` (integración, PostgreSQL real) | 33 | Los 10 criterios de validación de la especificación y la retención de datos: ver [docs/tests.md](docs/tests.md) |
| `services/vision` (pytest, backend stub) | 50 | Color CIELAB, pHash, contrato HTTP, abstención por umbrales |
| `@dressit/mobile` (jest-expo) | 60 | Cliente API (refresh, errores), componentes, accesibilidad, pantallas con respuestas reales grabadas, regresiones del simulador |

Evaluación del servicio de visión con 58 fotos reales con licencia abierta: categoría 95,9 %,
subcategoría 93,3 % cuando responde (cobertura 91,8 %), estampado 91,4 % — ver
[docs/vision.md](docs/vision.md) y [evidencias](docs/evidence/).

Además: `pnpm --filter @dressit/api retailers:check` mide la importación real contra las tiendas
([evidencia](docs/evidence/)).

## Documentación

| Tema | Documento |
|---|---|
| Arquitectura y diagrama de componentes | [docs/arquitectura.md](docs/arquitectura.md) |
| Decisiones técnicas (ADR) | [docs/adr/](docs/adr/README.md) |
| Modelo de datos | [docs/modelo-datos.md](docs/modelo-datos.md) |
| API (`/v1`) | [docs/api.md](docs/api.md) · OpenAPI en `/docs` |
| Motor de recomendaciones | [docs/recomendaciones.md](docs/recomendaciones.md) |
| Visión artificial | [docs/vision.md](docs/vision.md) |
| Comercios: matriz, estrategia, cómo añadir tiendas | [docs/comercios.md](docs/comercios.md) |
| Privacidad y seguridad | [docs/privacidad-seguridad.md](docs/privacidad-seguridad.md) |
| Tests y evidencias | [docs/tests.md](docs/tests.md) · [docs/evidence/](docs/evidence/) |
| App móvil (iOS y Android) | [docs/mobile.md](docs/mobile.md) |
| Instalación en macOS | [docs/instalacion-macos.md](docs/instalacion-macos.md) |
| Despliegue y publicación | [docs/despliegue.md](docs/despliegue.md) |
| Roadmap y limitaciones | [docs/roadmap.md](docs/roadmap.md) · [docs/limitaciones.md](docs/limitaciones.md) |
| Investigación (stack, competidores, comercios) | [docs/research/](docs/research/) |

## Principios

- Nada simulado presentado como real: los datos de demostración se marcan como DEMO y los fixtures de
  test nunca se muestran en la app.
- Cada dato de tienda lleva su procedencia y fecha de verificación.
- Sin dependencia obligatoria de APIs de IA de pago; las fotos se procesan en infraestructura propia.
- Solo integraciones permitidas: sin endpoints privados ni evasión de medidas anti-bot.

Datos meteorológicos: [Open-Meteo.com](https://open-meteo.com) (CC BY 4.0).
