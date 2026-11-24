# API HTTP `/v1`

Base URL local: `http://localhost:3000` (configurable con `API_PORT`). Tipos TypeScript en
[`packages/shared/src/api.ts`](../packages/shared/src/api.ts). Documentación OpenAPI generada en
tiempo de ejecución: `GET /docs` (Swagger UI) y `GET /docs/json`.

Autenticación: `Authorization: Bearer <accessToken>` (JWT, 15 min). El `refreshToken` rota en cada
uso (`POST /v1/auth/refresh`). Errores: `ApiError` con `error.code` estable y `error.message` en
español apto para mostrar.

| Método | Ruta | Cuerpo / query | Respuesta |
|---|---|---|---|
| POST | `/v1/auth/register` | `RegisterRequest` | `AuthResponse` |
| POST | `/v1/auth/login` | `LoginRequest` | `AuthResponse` |
| POST | `/v1/auth/refresh` | `{ refreshToken }` | `AuthTokens` |
| POST | `/v1/auth/logout` | `{ refreshToken }` | `204` |
| GET | `/v1/me` | – | `UserDto` |
| PATCH | `/v1/me` | `{ displayName?, timezone? }` | `UserDto` |
| PUT | `/v1/me/location` | `{ name, lat, lon, countryCode }` | `UserDto` (coordenadas redondeadas a 2 decimales) |
| GET / PUT | `/v1/me/preferences` | `PreferencesDto` (PUT acepta parcial) | `PreferencesDto` |
| POST | `/v1/me/onboarding/complete` | – | `UserDto` |
| GET | `/v1/me/consents` | – | `ConsentDto[]` |
| PUT | `/v1/me/consents/:kind` | `{ granted: boolean }` | `ConsentDto` |
| GET | `/v1/me/style-profile` | – | `StyleProfileDto` |
| GET | `/v1/me/export` | – | JSON con todos los datos del usuario (RGPD art. 20) |
| DELETE | `/v1/me` | `{ password }` | `204` (borrado definitivo de datos y ficheros) |
| POST | `/v1/me/delete` | `{ password }` | Igual que `DELETE /v1/me` (para proxies que descartan el cuerpo en DELETE) |
| GET | `/v1/geo/search` | `?q=Madrid` | `GeoSearchResult[]` |
| GET | `/v1/home` | – | `HomeResponse` |
| GET | `/v1/garments` | `GarmentListQuery` | `Paginated<GarmentDto>` |
| POST | `/v1/garments` | `GarmentWriteDto` (requiere `category`, `subcategory`) | `GarmentDetailDto` |
| GET | `/v1/garments/:id` | – | `GarmentDetailDto` |
| PATCH | `/v1/garments/:id` | `GarmentWriteDto` | `GarmentDetailDto` |
| DELETE | `/v1/garments/:id` | – | `204` |
| POST | `/v1/garments/bulk` | `BulkGarmentUpdate` | `{ updated: number }` |
| POST | `/v1/garments/:id/status` | `StatusChangeRequest` | `GarmentDetailDto` |
| POST | `/v1/garments/:id/wear` | `WearRequest` | `GarmentDetailDto` |
| GET | `/v1/garments/:id/similar` | – | `{ items: Array<{ garment: GarmentDto, score: number, reason: string }> }` |
| GET | `/v1/wardrobe/stats` | – | `WardrobeStatsDto` |
| GET / POST | `/v1/spaces` | `{ name, kind }` | `SpaceDto[]` / `SpaceDto` |
| PATCH / DELETE | `/v1/spaces/:id` | `{ name?, kind?, position? }` | `SpaceDto` / `204` |
| GET | `/v1/tags` | – | `Array<{ id, name, count }>` |
| POST | `/v1/uploads` | multipart `file` + campo `kind: UploadKind` | `UploadResponse` |
| GET | `/v1/images/:id` | `?v=original|cutout|thumb&exp=…&sig=…` (URL firmada) | binario |
| POST | `/v1/imports/photos` | `PhotoImportRequest` | `ImportJobDto` |
| GET | `/v1/imports` | `?status=needs_review` | `ImportJobDto[]` |
| GET | `/v1/imports/:jobId` | – | `ImportJobDto` |
| POST | `/v1/imports/:jobId/detections/:detectionId/accept` | `AcceptDetectionRequest` | `GarmentDetailDto` |
| POST | `/v1/imports/:jobId/detections/:detectionId/reject` | – | `DetectionDto` |
| POST | `/v1/imports/:jobId/accept-all` | – | `{ accepted: number, garmentIds: string[] }` |
| POST | `/v1/imports/link` | `LinkImportRequest` | `ImportedProductDto` |
| POST | `/v1/imports/link/capture` | `PageCaptureRequest` | `ImportedProductDto` |
| GET | `/v1/imports/link/:id` | – | `ImportedProductDto` |
| POST | `/v1/imports/link/:id/to-wardrobe` | `LinkToWardrobeRequest` | `GarmentDetailDto` |
| POST | `/v1/imports/link/:id/to-wishlist` | – | `WishlistItemDto` |
| POST | `/v1/imports/text` | `ReceiptTextImportRequest` | `ReceiptImportResult` |
| GET | `/v1/weather/day` | `?date=YYYY-MM-DD` | `DayWeatherDto` |
| POST | `/v1/outfits/recommendations` | `RecommendationRequest` | `RecommendationResponse` |
| GET | `/v1/outfits` | `?filter=saved|favorites|all` | `OutfitDto[]` |
| POST | `/v1/outfits` | `ManualOutfitRequest` | `OutfitDto` |
| GET / DELETE | `/v1/outfits/:id` | – | `OutfitDto` / `204` |
| GET | `/v1/outfits/:id/alternatives` | `?slot=bottom` | `AlternativesResponse` |
| POST | `/v1/outfits/:id/swap` | `SwapRequest` | `OutfitDto` |
| POST | `/v1/outfits/:id/feedback` | `FeedbackRequest` | `OutfitDto` |
| POST | `/v1/outfits/:id/wear` | `WearRequest` | `OutfitDto` |
| GET | `/v1/history` | `?from&to` | `UsageHistoryDto[]` |
| GET / POST | `/v1/events` | `?from&to` / `CalendarEventWrite` | `CalendarEventDto[]` / `CalendarEventDto` |
| PATCH / DELETE | `/v1/events/:id` | `CalendarEventWrite` | `CalendarEventDto` / `204` |
| POST | `/v1/events/sync-device` | `DeviceCalendarSyncRequest` | `{ upserted: number, removed: number }` |
| GET | `/v1/planner` | `?from&to` | `PlannerDayDto[]` |
| POST | `/v1/planner` | `PlanWrite` | `PlanDto` |
| PATCH | `/v1/planner/:id` | `Partial<PlanWrite>` (mover = cambiar `date`/`position`) | `PlanDto` |
| DELETE | `/v1/planner/:id` | – | `204` |
| POST | `/v1/planner/suggest-week` | `SuggestWeekRequest` | `PlannerDayDto[]` |
| GET / POST | `/v1/trips` | – / `TripRequest` | `TripDto[]` / `TripDto` |
| GET / DELETE | `/v1/trips/:id` | – | `TripDto` / `204` |
| PATCH | `/v1/trips/:id/packing/:garmentId` | `{ packed: boolean }` | `TripDto` |
| GET | `/v1/retailers` | – | `RetailerIntegrationDto[]` (incluye `catalogSources[]`: estado de cada feed/API oficial, ver [comercios.md](comercios.md)) |
| GET | `/v1/catalog/search` | `CatalogSearchQuery` | `Paginated<ProductSummaryDto>` |
| GET | `/v1/catalog/products/:id` | – | `ProductSummaryDto` |
| GET | `/v1/shopping/sections` | `?sections=para_ti,completa_armario` | `ShoppingSectionDto[]` |
| GET | `/v1/shopping/gaps` | – | `WardrobeGapDto[]` |
| POST | `/v1/shopping/simulate` | `SimulationRequest` | `SimulationResponse` |
| POST | `/v1/shopping/visual-search` | `VisualSearchRequest` | `VisualSearchResponse` |
| POST | `/v1/shopping/outbound` | `{ product: { kind, id }, context?: string }` | `OutboundLinkResponse` |
| GET / POST | `/v1/wishlist` | – / `{ product: { kind, id }, note? }` | `WishlistItemDto[]` / `WishlistItemDto` |
| DELETE | `/v1/wishlist/:id` | – | `204` |
| POST | `/v1/wishlist/:id/owned` | `LinkToWardrobeRequest` | `GarmentDetailDto` (solo tras confirmar que lo posee) |
| POST | `/v1/assistant/messages` | `AssistantMessageRequest` | `AssistantMessageResponse` |
| GET | `/health`, `/ready` | – | estado del servicio y dependencias |
| GET | `/metrics` | – | métricas Prometheus (latencias, errores, costes) |
