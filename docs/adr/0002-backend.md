# ADR-0002 · Backend: Node 24+, TypeScript nativo, Fastify, zod, Kysely

**Decisión.** Node ≥ 24 ejecuta TypeScript directamente (*type stripping*), sin paso de compilación;
`tsc` (TypeScript 7) solo valida tipos. Fastify 5 por rendimiento y ecosistema (helmet, CORS,
rate-limit, multipart, swagger). Validación con zod y mensajes en español. Kysely + `kysely-codegen`
para SQL tipado generado desde el esquema real, con migraciones SQL explícitas (índices, restricciones,
RLS) aplicadas por un migrador transaccional con checksum.

**Consecuencias.** Solo sintaxis «borrable» (sin enums ni *parameter properties*), forzado con
`erasableSyntaxOnly`. Imagen Docker sin build. El mismo código de dominio (`@dressit/shared`,
`@dressit/stylist-engine`) se usa en API y móvil.
