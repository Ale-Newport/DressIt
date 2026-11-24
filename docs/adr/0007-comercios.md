# ADR-0007 · Datos de comercios solo por vías legítimas

**Contexto.** Ninguna tienda española ofrece hoy un catálogo con alta autoservicio; el portal de APIs de
Inditex no está publicado; 15 de 19 tiendas medidas bloquean la lectura desde servidor.

**Decisión.**
1. Importación por enlace a petición del usuario con lectura de datos estructurados (schema.org
   JSON-LD/microdatos/OpenGraph), user-agent honesto, `robots.txt` y protección SSRF; sin evasión
   anti-bot. Estado medido y publicado por tienda.
2. Captura en el dispositivo (navegador integrado / Safari) de la página que el usuario está viendo.
3. Catálogo comercial solo desde feeds de afiliación o APIs autorizadas (Awin, Rakuten…), con historial
   de precios, frescura y enlaces de afiliado identificados.
4. Procedencia y verificación explícitas de cada dato; nunca precios no verificados como actuales.

**Consecuencias.** Descubrir queda vacío (y lo explica) hasta tener al menos un feed aprobado; la
simulación de compras funciona ya con productos importados por el usuario. Ver [docs/comercios.md](../comercios.md).
