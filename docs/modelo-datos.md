# Modelo de datos

Migraciones SQL en [`services/api/migrations/`](../services/api/migrations/) (aplicadas por
`pnpm db:migrate`, con checksum y bloqueo). Tipos TypeScript generados con `pnpm db:codegen`
(`services/api/src/db/types.ts`).

## Dominios

```mermaid
erDiagram
  users ||--|| user_preferences : tiene
  users ||--|| style_profiles : aprende
  users ||--o{ consents : registra
  users ||--o{ wardrobes : posee
  wardrobes ||--o{ wardrobe_spaces : organiza
  wardrobes ||--o{ garments : contiene
  garments ||--o{ garment_images : fotos
  garments ||--o{ garment_attributes : "atributos con confianza y fuente"
  garments ||--o| garment_embeddings : "vector 768"
  garments ||--o{ garment_availability : "historial de estado"
  garments }o--o{ tags : etiquetas
  users ||--o{ import_jobs : importa
  import_jobs ||--o{ import_detections : detecta
  users ||--o{ outfits : recibe
  outfits ||--o{ outfit_items : compone
  outfit_items }o--|| garments : usa
  outfits ||--o{ outfit_ratings : valora
  users ||--o{ outfit_usage_history : "se puso"
  users ||--o{ calendar_events : agenda
  users ||--o{ outfit_plans : planifica
  users ||--o{ trips : viaja
  users ||--o{ imported_products : "importa por enlace"
  users ||--o{ wishlist_items : desea
  users ||--o{ purchases : compra
  users ||--o{ recommendation_events : "señales"
  users ||--o| avatar_profiles : "fotos propias (consentimiento avatar)"
  users ||--o{ avatar_bases : "imágenes del avatar (vista × fondo)"
  users ||--o{ generation_jobs : "fotos de estudio y pruebas"
  users ||--o{ tryon_cache : "pasos del probador"
  retailers ||--o{ retailer_integrations : "vías de acceso"
  retailers ||--o{ catalog_products : vende
  catalog_products ||--o{ product_variants : tallas
  catalog_products ||--o{ product_prices : "historial de precio"
  catalog_products ||--o{ product_availability : "historial de stock"
  catalog_products ||--o{ product_images : "imágenes con licencia"
  catalog_products ||--o| product_embeddings : "vector 768"
  catalog_products ||--o{ affiliate_links : enlaces
```

## Separación de datos

| Ámbito | Tablas | Acceso |
|---|---|---|
| **Inventario personal** | `garments`, `garment_*`, `tags`, `wardrobe_spaces`, `outfits`, `outfit_*`, `calendar_events`, `outfit_plans`, `trips`, `trip_items` | RLS por `user_id` |
| **Productos del usuario** (guardados o importados) | `imported_products`, `wishlists`, `wishlist_items`, `purchases` | RLS por `user_id` |
| **Imágenes generadas y avatar** | `avatar_profiles`, `avatar_bases`, `generation_jobs`, `tryon_cache` (caché: se purga a los 30 días) | RLS por `user_id`; se borran al retirar el consentimiento «Tu avatar» |
| **Comportamiento y aprendizaje** | `style_profiles`, `recommendation_events`, `outfit_ratings`, `assistant_messages` | RLS por `user_id` |
| **Catálogo comercial** (fuentes autorizadas) | `retailers`, `retailer_integrations`, `catalog_products`, `product_*`, `affiliate_links`, `catalog_sync_runs` | Global, sin datos personales |
| **Infraestructura** | `auth_identities`, `auth_sessions` (hash de refresh tokens), `weather_snapshots` (celda de ~11 km), `audit_events` (append-only) | Solo módulos internos |

## Decisiones de modelado

- **Valor vigente + procedencia**: `garments` guarda el valor actual de cada atributo (consultas
  rápidas, índices) y `garment_attributes` el historial con `confidence` (0–1) y `source`
  (`vision`, `user`, `retailer:<id>`); corregir un atributo inserta una fila con confianza 1 y marca
  las anteriores como no vigentes.
- **Disponibilidad**: estado actual en `garments.status` + historial en `garment_availability`
  (incluye «prestada a…»).
- **Dinero** en céntimos (`int`) + divisa ISO; **fechas locales** (`date`) como `YYYY-MM-DD`.
- **Ubicación** solo aproximada: 2 decimales (~1 km) en `users`; las previsiones se cachean por celda
  de 0,1° (~11 km).
- **Precios**: historial append-only (`product_prices`) con fuente y fecha de observación; el producto
  guarda `last_verified_at` para calcular la frescura.
- **Imágenes generadas**: `garment_images.kind` distingue `studio` (packshot de la foto de
  catálogo, recortado), `avatar_render`, `avatar_base` y `tryon_step`, y `generated_by` guarda el
  modelo (la app etiqueta «Generada con IA»). Un recorte corregido a mano, una foto oficial
  (`product_reference`) o un packshot se añaden como imágenes nuevas: nunca se sobrescribe ni se
  borra la foto original del usuario. Una foto oficial encontrada en Internet se guarda **por
  referencia** (`license = retailer_link_preview`, `source_url` = la imagen de la tienda,
  `storage_key = remote:…`): no se copia.
- **Foto de catálogo** (`catalog_photo_jobs`, migración 0005): un trabajo por detección o prenda con
  la búsqueda (buscadores consultados, texto leído), los candidatos verificados (`candidates`, con
  evidencias, dudas y permisos de uso), los intentos de generación con su control, la elección del
  usuario y el coste. `visual_search_cache` guarda las respuestas de los buscadores por foto
  (30 días) y `external_api_usage` las llamadas y el coste por usuario, proveedor y día (límites y
  presupuesto mensual vía `external_api_month_cost()`, `security definer`).
- **Probador por pasos**: `tryon_cache.key` = SHA-256 de (imagen base, motor y pasos, prendas ya
  puestas en orden con su recorte); cambiar una prenda solo invalida los pasos posteriores.
- **Imágenes**: `license` por imagen (`user_owned`, `retailer_licensed`, `retailer_link_preview`),
  `sha256` (duplicado exacto) y `phash bit(64)` (casi duplicados con `bit_count(a # b)`).
- **Restricciones**: `check` en todos los enumerados, rangos de formalidad/clo, coherencia de
  presupuesto, exactamente una referencia en `outfit_items` y `wishlist_items` (`num_nonnulls`).
- **Índices**: por `(user_id, …)` en todas las tablas personales, GIN para búsqueda de texto en español
  sin acentos (`tsvector` + `unaccent`) y arrays, trigramas para marcas, HNSW coseno para vectores.
