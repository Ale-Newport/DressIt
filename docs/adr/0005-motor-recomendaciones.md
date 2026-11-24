# ADR-0005 · Motor de recomendaciones híbrido y determinista

**Decisión.** Generación por restricciones + búsqueda en haz sobre núcleos de conjunto, 12
características interpretables (color en CIELAB con rueda RYB, estilo, formalidad, modelo térmico ISO
9920 para todo el día, materiales, silueta, preferencias, afinidad, rotación, similitud visual), ranking
personal por regresión logística online con regularización, diversificación MMR y exploración
controlada. Explicaciones generadas de las contribuciones. Ver [docs/recomendaciones.md](../recomendaciones.md).

**Por qué no un LLM.** Requisito del producto: criterios verificables, reproducibilidad, coste
controlado, nunca inventar prendas. Un LLM puede usarse como capa conversacional (ADR-0008), no como
fuente de verdad.

**Consecuencias.** Tests deterministas; el feedback cambia el ranking de forma demostrable; los eventos
quedan registrados para calibración offline.
