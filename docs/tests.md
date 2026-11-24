# Tests y evidencias

## Cómo ejecutarlos

```bash
pnpm test
```

```bash
pnpm --filter @dressit/stylist-engine test
```

```bash
pnpm --filter @dressit/api test
```

```bash
cd services/vision && VISION_BACKEND=stub uv run pytest -q
```

Los tests de integración de la API usan la base `dressit_test` (creada por `pnpm db:setup`) con el rol
sin privilegios y RLS activo: nunca tocan la base de desarrollo (el arnés aborta si
`DATABASE_TEST_ADMIN_URL` no apunta a `dressit_test`). Solo las dependencias externas se sustituyen por
dobles de prueba definidos en `services/api/test/integration/helpers.ts`: proveedor meteorológico,
servicio de visión y una «tienda» local con páginas sintéticas.

## Criterios de validación de la especificación (§18)

| # | Criterio | Test(s) |
|---|---|---|
| 1 | Una prenda añadida aparece correctamente en el armario | `wardrobe › a garment added appears…`, `photo digitisation › uploads, analyses, reviews and adds garments` |
| 2 | Los outfits solo usan prendas realmente disponibles | `daily recommendations › outfits only use garments that are really available` (API) + `only uses garments it was given…` (motor) |
| 3 | Las recomendaciones cambian según la meteorología | `recommendations change with the weather (whole-day forecast)` (API) + `changes with the weather`, `plans for the whole day` (motor) |
| 4 | El feedback modifica recomendaciones posteriores | `feedback changes later recommendations…` (API) + `rejections and acceptances change the subsequent ranking` (motor) |
| 5 | No recomienda comprar prendas existentes sin una razón clara | `ingests an authorised feed and ranks products… never pushing duplicates` (API) + `does not rank buying a duplicate above a useful new piece` (motor) |
| 6 | Los productos comerciales corresponden a productos auténticos | `imports a product page with verified provenance…` (cada campo con fuente y `verified`), `retailers:check` contra webs reales |
| 7 | Los enlaces abren páginas de compra válidas | `simulates a product… and opens the authentic product link` (enlace del feed / canónico), evidencia en `docs/evidence/retailers-*.md` |
| 8 | Los precios no se presentan como actuales si no han sido verificados | `flags stale prices instead of presenting them as current`, `never accepts a zero OpenGraph price placeholder` |
| 9 | Los datos de distintos usuarios no se mezclan | `never mixes data of different users` (HTTP **y** SQL directo con el rol de la app), `rejects tampered signed image URLs` |
| 10 | El sistema funciona si una tienda o proveedor deja de responder | `reports blocked, unavailable, robots-disallowed and non-product pages honestly`, `keeps working when the weather provider is down`, `fails gracefully when the vision service is down and can be retried` |

## Otros bloques cubiertos

- **Seguridad básica**: SSRF (IPs privadas, IPv4-mapped, NAT64, metadatos cloud, redirecciones,
  tamaño, tipo, tiempo), robots.txt, refresh tokens (rotación y reutilización), mensajes de login sin
  enumeración, autenticación obligatoria, URLs firmadas, eliminación de EXIF.
- **Importación de prendas y deduplicación**: lote multi-prenda, abstención del modelo (sin inventar),
  duplicado exacto en subida y en detección, `accept-all` que omite duplicados, reintentos.
- **Importación por URL**: JSON-LD (Product, ProductGroup, AggregateOffer, @graph), microdatos,
  OpenGraph, precios en formato español, muros anti-bot.
- **Motor y ranking de productos**: ver [recomendaciones.md](recomendaciones.md).
- **Asistente**: fechas, números, ocasiones, prendas referenciadas, exclusiones, viajes.
- **RGPD**: exportación completa y borrado definitivo (comprobado en la base con el rol propietario).

## Evidencias con servicios reales

| Evidencia | Contenido |
|---|---|
| [evidence/retailers-2026-11-24.md](evidence/retailers-2026-11-24.md) | Importación por enlace contra 19 páginas reales de tiendas españolas |
| Prueba manual del 2026-11-24 (registrada aquí) | Open-Meteo real para Madrid: «Hoy hará entre 6 y 10 °C, con lluvia a mediodía»; 4 conjuntos con abrigo/gabardina y paraguas, capas, formalidad de universidad; cambio de prenda, rechazo, «me lo he puesto», colada excluida y ocasión «entrevista» más formal |
| [evidence/vision-2026-11-24.md](evidence/vision-2026-11-24.md) | Evaluación del servicio de visión: 58 fotos reales con licencia abierta, precisión por atributo, abstención y latencia |
| [evidence/digitalizacion-e2e-2026-11-24.md](evidence/digitalizacion-e2e-2026-11-24.md) | Criterio 3 de aceptación: 10 fotos por la API real + visión real → 10/10 categorías y subcategorías, 10/10 recortes, 6/10 colores, 0,9 s/foto, conjuntos generados |
| [evidence/engine-bench-2026-11-24.md](evidence/engine-bench-2026-11-24.md) | Latencia del motor (30–3 000 prendas: p95 < 55 ms) |
| [evidence/api-latency-2026-11-24.md](evidence/api-latency-2026-11-24.md) | Latencia extremo a extremo de la API (recomendaciones p95 19 ms) |

## Tests móviles

60 tests con jest-expo y Testing Library: cliente API, componentes, accesibilidad, pantallas con
respuestas grabadas de la API real y regresiones encontradas en el simulador. Flujos E2E con Maestro en
`apps/mobile/e2e/` (Maestro no está instalado en la máquina de desarrollo: no ejecutados). Recorrido
manual completo en el simulador de iOS: [evidence/ios-simulador-2026-11-24.md](evidence/ios-simulador-2026-11-24.md).

```bash
pnpm --filter @dressit/mobile test
```
