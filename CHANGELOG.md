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

- **Studio photos with generative AI**: from a garment's cutout, Qwen-Image-Edit-2511 (Apache-2.0)
  on a ComfyUI server makes a background-free studio photo; it is kept only if it still matches the
  real garment (embedding, colour, type) and the user chooses whether to use it.
- **Your avatar**: an optional onboarding step and *Perfil → Tu avatar* take a face and a
  full-body photo (own consent, "they are mine" and "I am 18+" confirmations); outfits can then
  be rendered on the user, shown next to the real outfit. Withdrawing the consent deletes the
  photos and every render. Every generated image is labelled in the app and in its EXIF
  (EU AI Act art. 50). Setup, models, measurements and limits in `docs/generacion-imagenes.md`.
- **Multi-garment virtual try-on** (`services/tryon`, FASHN VTON v1.5, Apache-2.0): the user's
  saved avatar is dressed one garment at a time — bottom or dress, then base, mid and outer layers —
  and shoes plus one accessory are added in a last Qwen-Image-Edit pass. The first garment of each
  body region replaces what the photo shows there (clothing mask from Sapiens2 body parsing, not
  FASHN's non-commercial parser); later layers are dressed over it. Every step is cached, so
  changing one garment only redoes the steps after it. Progress ("Paso 2 de 4 · Probando: …") is
  shown in the app, and the one-pass method stays available to choose.
- **Persistent avatar images**: the user's own full-body photo cut out on a studio background
  (grey, white, beige or their own), plus optional generated three-quarter and side views
  (Multiple-Angles LoRA), saved once and reused by every try-on; a new body photo replaces them.
- **Fidelity of worn garments**: try-on results are parsed (Sapiens2) and each visible garment is
  checked against the real one (FashionSigLIP similarity and CIEDE2000); renders that changed a
  garment are discarded with the reason in Spanish.
- **Detail fidelity for studio photos** (`POST /v1/compare` in the vision service): shape IoU,
  colour per zone on a 12×12 grid and texture SSIM after alignment. It now rejects a studio photo
  that changed the buttons, which the global embedding let through (`docs/evidence/catalogo-2026-11-24.md`).
- **Manual cutout correction**: "Corregir recorte" on a garment or on a detection in review; the
  user taps "es prenda" / "no es prenda" points on the original photo and SAM 2.1 re-segments it;
  "no es prenda" points also remove thin strands (hair, fingers) near them. Previous cutouts are
  kept in the garment's gallery.
- **Official store photo**: when a connected catalogue sells the very same garment (similarity
  ≥ 0.9), its photo can be added to the garment's gallery with attribution, without replacing the
  user's photos.
- **Upright correction** of tops, bottoms, dresses and coats photographed at an angle (symmetry
  search, ±25°).

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
