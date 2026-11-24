# ADR-0003 · PostgreSQL + pgvector con RLS

**Decisión.** Una única base PostgreSQL 17 con pgvector (embeddings 768-d, índices HNSW). Todas las
tablas personales tienen `user_id` y una política `user_id = app_current_user_id()` con
`FORCE ROW LEVEL SECURITY`. La API se conecta con el rol **no propietario** `dressit_app`; cada petición
autenticada abre una transacción con `set_config('app.user_id', …, true)` (`withUser`). Las
migraciones usan el rol propietario. Las credenciales/sesiones y el catálogo comercial global están en
tablas sin RLS, accesibles solo desde sus módulos.

**Por qué.** Defensa en profundidad: un fallo en un `where user_id = …` de la aplicación no expone
datos de otros usuarios (lo comprueba un test de integración contra la base real).

**Consecuencias.** Las cascadas de borrado de cuenta funcionan (las acciones referenciales no están
sujetas a RLS). Los trabajos en segundo plano también fijan el contexto de usuario.
