# Despliegue

## Piezas

| Pieza | Imagen / artefacto | Escalado |
|---|---|---|
| API | `services/api/Dockerfile` (Node 24, sin build) | Horizontal, sin estado |
| Worker | misma imagen, `node services/api/src/worker.ts` | Horizontal (concurrencia 2 por réplica) |
| Visión | `services/vision/Dockerfile` | CPU (o GPU) aparte; 1 réplica atiende varios workers |
| PostgreSQL 17 + pgvector | Gestionado (RDS, Cloud SQL, Neon, Supabase…) | Réplicas de lectura si hace falta |
| Redis | Gestionado | — |
| Imágenes | S3 compatible (S3, R2, MinIO) con SSE | — |
| App | EAS Build → App Store / Google Play | — |

Región recomendada: UE (p. ej. `eu-south-2` Madrid o `eu-west-3`) por RGPD.

## Pasos

1. Crear la base de datos con pgvector y un rol propietario para migraciones; crear el rol
   `dressit_app` con contraseña y `LOGIN` (sin privilegios de propietario ni `BYPASSRLS`).
2. Variables de entorno (ver `.env.example`): `NODE_ENV=production`, `DATABASE_URL` (rol app),
   `DATABASE_ADMIN_URL` (solo para migrar), `REDIS_URL`, `JWT_SECRET`, `IMAGE_URL_SECRET`,
   `API_PUBLIC_URL`, `STORAGE_DRIVER=s3` + `S3_*`, `VISION_SERVICE_URL`, `OPEN_METEO_API_KEY`
   (obligatoria para uso comercial), credenciales de feeds autorizados.
3. Migrar: `node services/api/src/db/migrate.ts` (con `DATABASE_ADMIN_URL`).
4. Arrancar API (`WORKER_MODE=separate`), workers y visión. Comprobar `GET /ready`.
5. Programar: `catalog:ingest` (al menos diario, según las condiciones del feed),
   `retailers:check` (semanal) y la purga de retención.
6. Observabilidad: recoger `/metrics` con Prometheus, alertas sobre `dressit_external_call_duration_seconds{outcome="error"}`, latencia p95 de `/v1/outfits/recommendations` y `dressit_cost_units_total`.

## App Store y Google Play

- iOS: `eas build -p ios --profile production`; requiere cuenta Apple Developer, identificador
  definitivo (sustituir `com.dressit.app`), textos de permisos en español (ya incluidos), etiquetas de
  privacidad de App Store coherentes con [privacidad-seguridad.md](privacidad-seguridad.md) y la
  extensión de compartir firmada en el mismo App Group.
- Android: `eas build -p android --profile production`; formulario de seguridad de datos de Google Play;
  solo permisos `CAMERA`, `READ_MEDIA_IMAGES`, `ACCESS_COARSE_LOCATION`, `READ_CALENDAR`.
- `EXPO_PUBLIC_API_URL` debe apuntar a la API pública con HTTPS.
