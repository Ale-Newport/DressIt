# Privacidad y seguridad

## RGPD desde el diseño

| Principio | Implementación |
|---|---|
| Base jurídica y consentimiento | Registro con aceptación explícita de términos y privacidad. Consentimientos granulares y versionados en `consents` (append-only): análisis de fotos, ubicación, calendario, importación de correo, asistente con IA externa, analítica, marketing. Se pueden retirar en *Perfil → Privacidad*. Al retirar calendario se borran los eventos sincronizados; al retirar ubicación se borra la ciudad. |
| Minimización | Ubicación redondeada a ~1 km (o solo ciudad); del calendario solo título, horas y lugar; se eliminan todos los metadatos EXIF/GPS de las fotos al subirlas. No se infieren ni guardan atributos corporales ni características sensibles: el servicio de visión solo describe prendas. |
| Derecho de acceso y portabilidad | `GET /v1/me/export`: JSON con todos los datos del usuario. |
| Derecho de supresión | `DELETE /v1/me` (con contraseña): borra en cascada todas las tablas personales y los ficheros del almacenamiento. Queda un evento de auditoría sin identificar al usuario. |
| Limitación de la conservación | Sesiones caducadas purgables (`purgeExpiredSessions`); conversaciones del asistente y sugerencias no guardadas: retención objetivo 30 días (tarea programada en el roadmap). |
| Encargados del tratamiento | Por defecto no se envían datos personales a terceros: la visión es propia, el asistente funciona sin LLM externo. Open-Meteo solo recibe coordenadas de celda (~11 km). |
| Entrenamiento de modelos | Las fotos personales **no** se usan para entrenar modelos externos. Cualquier uso interno para mejorar modelos requerirá un consentimiento específico. |

## Seguridad

- **Autenticación**: contraseñas con argon2id (parámetros OWASP), bloqueo temporal tras 8 intentos,
  mismo mensaje para cuenta inexistente o contraseña incorrecta. JWT HS256 de 15 min + refresh token
  opaco (solo se guarda su SHA-256) con **rotación y detección de reutilización** (revoca la familia).
- **Autorización**: RLS de PostgreSQL forzada en todas las tablas personales y rol de aplicación sin
  privilegios de propietario; comprobado en tests de integración a nivel HTTP y SQL.
- **Ficheros privados**: almacenamiento por usuario; servidos solo mediante **URLs firmadas HMAC**
  (con caducidad y el usuario dentro de la firma) que abren una transacción RLS; en S3 con cifrado en
  reposo (SSE). En local, ficheros con permisos `0600`.
- **SSRF** al importar productos: solo http(s) y puertos 80/443, sin credenciales en la URL, bloqueo de
  nombres internos, **resolución DNS validada en el momento de conectar** (todas las IP deben ser
  unicast públicas; IPv6 solo `2000::/3`), redirecciones revalidadas una a una, límite de tamaño,
  tiempo y tipo de contenido, `robots.txt`. Ver `services/api/src/lib/safe-fetch.ts` y sus tests.
- **Entrada**: validación zod en todas las rutas, límites de tamaño (cuerpo 2 MB, imagen 15 MB,
  60 Mpx), verificación del formato real de las imágenes con sharp.
- **Cabeceras y abuso**: helmet, CORS restringido en producción, *rate limiting* global y más estricto en
  autenticación, importación de enlaces y asistente.
- **Secretos**: solo por variables de entorno; `.env` ignorado por git; en la base de datos solo el
  *nombre* de la variable de credenciales de cada integración. CI con escaneo de secretos (gitleaks).
- **Auditoría**: `audit_events` append-only (registro, inicio de sesión, consentimientos, exportación,
  borrado). Los logs redactan cabeceras de autorización, contraseñas y tokens.
- **Enlaces de afiliación**: siempre identificados al usuario; la comisión no influye en el ranking.
- **Licencias de imágenes comerciales**: política por integración (ADR-0009).

## Pendiente antes del lanzamiento

- Revisión legal: condiciones de uso de cada tienda para la captura en dispositivo, licencias de pesos
  de visión entrenados con DIS5K, textos legales (términos, privacidad, cookies) y registro de
  actividades de tratamiento.
- Plan comercial de Open-Meteo (o AEMET) y contratos de encargado con los proveedores de infraestructura.
- Pruebas de penetración externas y análisis de dependencias continuo.
