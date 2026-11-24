# Changelog

All notable changes to DressIt are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Apple Intelligence on the iPhone** (local native module `dressit-intelligence`, all on device):
  the assistant's request is read by Apple's on-device model and sent as a grounded hint
  (`deviceIntent`); a wardrobe summary in Statistics; "Describe with Apple Intelligence" on a
  garment (iOS 27); instant background-removal previews with Vision while uploading. A switch in
  Privacy turns it off. Evaluation and limits in `docs/evidence/apple-intelligence-2026-11-24.md`.
- **Official catalog sources** (`services/api/src/modules/catalog/sources/`): adapters for Awin
  (feed list discovery + Enhanced JSONL API), Rakuten Advertising Product Search, Tradedoubler
  Products API and CJ Product Feed GraphQL, written against each network's public docs, with
  documented rate limits, `Retry-After` handling and `feed`/`api` provenance. Each one stays
  disabled until its credentials are set, and `GET /v1/retailers` reports `catalogSources` per store
  (`pending_credentials`, `configured`, `operational`, `error`, `unsupported`). New stores with
  verified programmes (Lefties, Bimba y Lola, JD Sports, Foot Locker, Sprinter…), an updated matrix
  in `docs/comercios.md` and a step-by-step guide for the owner in `docs/conectar-tiendas.md`.

### Changed

- **Flat lays at real-world scale**: a shared composer (`composeFlatLay`) places the outer layer
  over the bottom and accessories and shoes in a side column, using each cutout's real proportions
  and typical garment sizes, without overlaps, for whatever canvas size the app draws.
- **Garment photos**: cutouts are shown whole with breathing room and a soft shadow that follows
  their outline (iOS) in the wardrobe, outfits, garment detail, builder and review queue.

## [0.1.0] - 2026-11-24

First public version.

### Added

- **Mobile app (iOS/Android, Expo SDK 58)** in Spanish: sign-up and 8-step
  onboarding, wardrobe with search, filters, bulk edit, spaces and statistics,
  photo capture from camera or gallery in batches with a review queue, store
  link import and in-app page capture, daily outfits with swap and feedback,
  planner, trips, Discover, conversational stylist and privacy controls.
- **API** (Fastify, PostgreSQL + pgvector): row-level security on every personal
  table, rotating refresh tokens, asynchronous photo pipeline with duplicate
  detection, SSRF-safe product import with per-field provenance, Open-Meteo
  weather for the whole day, authorised affiliate-feed ingestion, purchase
  simulation, GDPR export and deletion, limited retention.
- **Recommendation engine**: deterministic outfit generation with CIELAB colour
  harmony, an ISO 9920 thermal model, a ranking model learnt from feedback, MMR
  diversity and traceable explanations; marginal-utility scoring for purchases.
- **Vision service**: garment detection, background removal, attributes with
  calibrated confidence and abstention, CIELAB colours, 768-d embeddings and OCR.
- Research, architecture decision records, a measured store-integration matrix
  and evidence for every claim in `docs/`.

### Known limitations

- No licensed retailer catalogue is connected yet: affiliate programmes must
  approve the project first. Discover says so instead of showing invented products.
- Server-side link import works for 4 of 19 measured stores; the rest are read
  from the page the user opens on their device.
- Not yet verified on a physical iPhone or on Android. See
  [`docs/limitaciones.md`](docs/limitaciones.md).

[Unreleased]: https://github.com/Ale-Newport/DressIt/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Ale-Newport/DressIt/releases/tag/v0.1.0
