# Evidencia: latencia de la API (2026-11-24)

`node services/api/scripts/latency.ts` contra la API local (MacBook Pro Apple Silicon, PostgreSQL 17 local), cuenta de prueba con 15 prendas, previsión de Open-Meteo en caché. Secuencial, un cliente.

| Endpoint | Peticiones | p50 (ms) | p95 (ms) |
|---|---|---|---|
| POST /v1/outfits/recommendations (4 conjuntos, tiempo en caché) | 30 | 14 | 15 |
| GET /v1/garments | 50 | 2 | 3 |
| GET /v1/home | 30 | 3 | 4 |
| GET /v1/wardrobe/stats | 20 | 2 | 3 |
| GET /v1/shopping/gaps | 10 | 194 | 216 |

`/v1/shopping/gaps` ejecuta el motor para ~27 arquetipos × contextos habituales; es candidato a caché (shopping_recommendations) cuando crezca.
