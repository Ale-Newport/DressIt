# ADR-0008 · Estilista conversacional

**Decisión.** Motor por defecto: intérprete de intenciones en español (fechas relativas, ocasiones,
números en palabras, «con mis pantalones negros», «sin zapatos», «menos de 80 €», «viaje de cuatro días
a Madrid», «estilo old money») que llama a las **mismas funciones** de la app y devuelve tarjetas con
resultados reales y la traza de herramientas usadas. Un LLM con *tool calling* puede añadirse detrás de
`ai_assistant_external` (consentimiento explícito) sin cambiar las herramientas.

**Consecuencias.** Sin coste por mensaje ni envío de datos a terceros por defecto; cobertura de lenguaje
limitada a los patrones soportados (se responde con ayuda cuando no se entiende).
