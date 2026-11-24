# Changelog

All notable changes to DressIt are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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
