# Instalación en macOS

Probado en macOS (Apple Silicon) con Xcode 27, Node 26, pnpm 10, PostgreSQL 17 (Homebrew), Redis 8 y
Python 3.13 con `uv`.

## 1. Requisitos

```bash
xcode-select --install
```

```bash
brew install node pnpm postgresql@17 redis uv
```

```bash
brew services start postgresql@17 && brew services start redis
```

### pgvector

Homebrew solo publica `pgvector` precompilado para PostgreSQL 18/19. Con PostgreSQL 17, compílalo:

```bash
git clone --depth 1 --branch v0.8.1 https://github.com/pgvector/pgvector.git /tmp/pgvector && cd /tmp/pgvector && make PG_CONFIG=/opt/homebrew/opt/postgresql@17/bin/pg_config PG_SYSROOT=$(xcrun --show-sdk-path) && make install PG_CONFIG=/opt/homebrew/opt/postgresql@17/bin/pg_config PG_SYSROOT=$(xcrun --show-sdk-path)
```

(Con PostgreSQL 18+ basta `brew install pgvector`.) Alternativa: Docker (`docker compose up -d postgres redis minio`).

## 2. Dependencias y base de datos

```bash
pnpm install
```

```bash
pnpm db:setup
```

`db:setup` crea `.env` con secretos aleatorios (si no existe), las bases `dressit` y `dressit_test`, el
rol sin privilegios `dressit_app` y aplica las migraciones.

## 3. Servicio de visión

```bash
cd services/vision && uv sync && uv run uvicorn app.main:app --port 8001
```

La primera ejecución descarga los modelos (~2 GB) en `services/vision/models_cache/`. Ver
[vision.md](vision.md).

## 4. API

```bash
pnpm dev:api
```

API en http://localhost:3000, documentación interactiva en http://localhost:3000/docs. En desarrollo
los trabajos en segundo plano se ejecutan dentro de la API; para un worker separado usa
`WORKER_MODE=separate` y `pnpm dev:worker`.

Opcional — cuenta de demostración con 28 prendas marcadas como DEMO (credenciales en
`.demo-credentials.local`):

```bash
pnpm db:seed:demo
```

## 5. App móvil

```bash
pnpm dev:mobile
```

Ver [mobile.md](mobile.md) para el simulador de iOS, un iPhone real y Android.

## 6. Comprobaciones

```bash
pnpm test
```

```bash
pnpm --filter @dressit/api retailers:check
```
