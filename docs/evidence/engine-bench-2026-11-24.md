# Evidencia: rendimiento del motor de outfits (2026-11-24)

`pnpm --filter @dressit/stylist-engine bench` en MacBook Pro (Apple Silicon), Node v26.13.1. Armarios aleatorios del vocabulario completo, ocasión «trabajo», 8–16 °C con 60 % de lluvia, 4 conjuntos por petición, 15 repeticiones.

| Prendas | p50 (ms) | p95 (ms) | Candidatos evaluados |
|---|---|---|---|
| 30 | 14.2 | 35.6 | 950 |
| 100 | 43.4 | 53.0 | 3000 |
| 300 | 38.8 | 42.1 | 3000 |
| 1000 | 13.9 | 14.7 | 1000 |
| 3000 | 15.2 | 17.0 | 1000 |

La poda por capa (top-N) acota el número de candidatos evaluados, por lo que la latencia no crece con el tamaño del armario.
