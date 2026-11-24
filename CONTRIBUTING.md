# Contributing to DressIt

Thanks for helping. DressIt is a digital wardrobe, AI stylist and personal
shopper for the Spanish market; the app and its copy are in Spanish, the code
and these guides are in English, and the technical docs in `docs/` are in
Spanish.

## Ground rules

- **Nothing fake.** No mock data presented as real, no invented prices, stock,
  products or photos. Demo data is flagged `is_demo` and labelled DEMO.
- **Only legitimate store integrations.** Official APIs, approved affiliate
  feeds and pages the user opens themselves. No private endpoints, no scraping
  at scale, no CAPTCHA or anti-bot evasion. See [`docs/comercios.md`](docs/comercios.md).
- **Provenance everywhere.** Every retailer field carries its source and
  verification time; inferred values are flagged as inferred.
- **Privacy by design.** Personal tables have `user_id` and a row-level-security
  policy; photos never leave our own infrastructure.
- Be kind: the [Code of Conduct](CODE_OF_CONDUCT.md) applies everywhere.

## How to contribute

1. Open an issue first for anything bigger than a small fix, so the approach can
   be agreed before you write code.
2. Fork, create a branch from `main`, keep the change focused.
3. Add or update tests; a bug fix comes with a test that failed before it.
4. Open a pull request using the template. CI must pass and the code owner must
   approve before it merges.

## Setting up

Requirements: macOS (for iOS) or Linux, Node ≥ 24, pnpm 10, PostgreSQL ≥ 15 with
pgvector, Redis, Python ≥ 3.11 with [uv](https://docs.astral.sh/uv/), Xcode for
iOS. Full guide: [`docs/instalacion-macos.md`](docs/instalacion-macos.md).

```bash
pnpm install
pnpm db:setup            # .env with random secrets, databases, app role, migrations
pnpm dev:api             # API on http://localhost:3000 (OpenAPI at /docs)
cd services/vision && uv sync && uv run uvicorn app.main:app --port 8001
pnpm dev:mobile          # Expo dev server; run a development build with `pnpm --filter @dressit/mobile ios`
```

### The checks CI runs

```bash
pnpm typecheck
pnpm test                                             # shared, engine, API (needs dressit_test), mobile
cd services/vision && VISION_BACKEND=stub uv run pytest -q
```

## Where things live

| Path | What |
|---|---|
| `apps/mobile` | Expo app (Expo Router, React Query) |
| `services/api` | Fastify API, worker, SQL migrations, scripts |
| `services/vision` | FastAPI vision service and its evaluation set |
| `packages/shared` | Domain vocabulary, colour science and the API contract (`api.ts`) |
| `packages/stylist-engine` | Recommendation engine (pure TypeScript) |
| `docs/` | Architecture, ADRs, research, evidence |

## What a good pull request looks like

- One concern per pull request, with a clear description of what and why.
- API changes update `packages/shared/src/api.ts` and `docs/api.md` together.
- Schema changes are a new migration in `services/api/migrations/`; applied
  migrations are never edited (the runner checks their checksums).
- Engine changes keep results deterministic for a given seed and come with tests.

## Licence

By contributing you agree that your contributions are licensed under the
[MIT License](LICENSE).
