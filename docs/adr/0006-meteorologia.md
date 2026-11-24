# ADR-0006 · Meteorología: Open-Meteo

**Decisión.** Open-Meteo: previsión horaria de temperatura, sensación térmica, probabilidad e
intensidad de precipitación, viento, humedad y UV hasta 16 días, más geocodificación en español. Datos
CC BY 4.0 (atribución visible en la app). La API gratuita es **solo para uso no comercial**: en
producción se define `OPEN_METEO_API_KEY` (endpoint `customer-api`). Caché por celda de ~11 km y día
(sin datos personales). AEMET OpenData queda como alternativa/respaldo (reutilización comercial
permitida con atribución, pero con límites y respuestas lentas observadas).

**Consecuencias.** Coste previsible en producción; la app funciona (con aviso) si el proveedor cae,
usando caché o la estación del año.
