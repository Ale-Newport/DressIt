# DressIt · servicio de visión (`services/vision`)

Microservicio FastAPI que recibe una foto y devuelve, por prenda: recorte RGBA sin fondo,
categoría/subcategoría, colores (CIELAB + CIEDE2000, mismas familias que `packages/shared`),
estampado, materiales, estilos, temporadas, corte, embedding de 768 dimensiones
(FashionSigLIP) y avisos de calidad en español. También embeddings de texto (consultas en
español) y OCR de tickets/etiquetas. Documentación completa: [`docs/vision.md`](../../docs/vision.md).

## Arrancar

```bash
cd services/vision
uv sync                                   # Python 3.13 (.python-version), crea .venv
uv run uvicorn app.main:app --port 8001   # modelos reales; se descargan (~2,2 GB) en el primer uso
```

* Primer arranque: los pesos van a `models_cache/` (ignorado por git). Para descargarlos antes:
  `uv run python scripts/download_models.py`.
* Precarga al arrancar (evita ~13 s en la primera petición): `VISION_PRELOAD=all uv run uvicorn app.main:app --port 8001`.
* Variables desde fichero: `cp .env.example .env` y `uv run uvicorn app.main:app --port 8001 --env-file .env`.
* Backend de pruebas, sin modelos ni descargas: `VISION_BACKEND=stub uv run uvicorn app.main:app --port 8001`
  (`/health` devuelve `"backend": "stub"`; nunca emite atributos).

## Tests y evaluación

```bash
uv run pytest                                   # usa siempre VISION_BACKEND=stub (≈2 s)
uv run python scripts/fetch_eval_images.py      # 58 fotos CC/PD de eval/manifest.csv → eval/images/
uv run python scripts/evaluate.py               # precisión, abstención, latencia → eval/out/results.json
uv run python scripts/calibrate.py              # reajusta app/calibration.json con el split "calib"
uv run python scripts/compare_segmenters.py     # compara modelos de rembg
```

## Endpoints

| Método | Ruta | Entrada | Salida |
|---|---|---|---|
| GET | `/health` | – | `{status, device, backend, models, version}` |
| POST | `/v1/analyze` | multipart `file` (JPEG/PNG/HEIC ≤ 15 MB), `mode` = `single`\|`multi`, `max_items` (1–12, def. 8) | `{image, items[], scene, timings_ms, model_versions}` |
| POST | `/v1/embed/image` | multipart `file`, `segment` (bool, def. false) | `{embedding, model, dim}` |
| POST | `/v1/embed/text` | `{"texts": ["chaqueta beige", …]}` (1–64) | `{embeddings, model, dim, translated}` |
| POST | `/v1/ocr` | multipart `file` | `{text, lines[{text, confidence, bbox}], model}` |

Errores: `{"error": {"code", "message"}}` con 413 (`file_too_large`), 415 (`unsupported_image`), 422
(`invalid_mode`, `invalid_max_items`, `empty_file`, `invalid_text`). OpenAPI en `GET /docs`.

## Variables de entorno

Ver [`.env.example`](.env.example). Las principales:

| Variable | Defecto | Descripción |
|---|---|---|
| `VISION_BACKEND` | `torch` | `torch` (real) o `stub` (determinista, solo tests/CI) |
| `VISION_DEVICE` | `auto` | `auto` (cuda > mps > cpu), `mps`, `cuda`, `cpu` |
| `VISION_PORT` | `8001` | Puerto (lo usa el `Dockerfile`; con uvicorn local pasa `--port`) |
| `VISION_MODELS_CACHE` / `HF_HOME` | `services/vision/models_cache` | Caché de pesos (HF, torch, rembg, EasyOCR) |
| `VISION_PRELOAD` | `none` | `embedding` o `all` para cargar modelos al arrancar |
| `VISION_MAX_CONCURRENCY` | `2` | Análisis simultáneos (memoria) |
| `VISION_THRESHOLD_*` | ver `app/config.py` | Umbrales de abstención por atributo |
| `VISION_NORMALIZE_CUTOUT` | `true` | Balance de blancos/exposición suave del recorte |
| `VISION_REMOVE_SUPPORTS` | `true` | Single: quitar perchas, maniquíes/cabezas, tendedero y pinzas del recorte |
| `VISION_SUPPORT_MIN_PROB` / `VISION_SUPPORT_MIN_PROB_HEAD_FORM` | `0.5` / `0.25` | P(soporte) para quitar una región (la segunda, cabeza bajo un gorro) |
| `VISION_SUPPORT_MAX_AREA` | `0.6` | Nunca se quita una región mayor que esa fracción del objeto |
| `VISION_PROPOSAL_SHORT_SIDE` / `VISION_MAX_PROPOSALS` | `480` / `10` | Entrada del detector y nº de cajas para las propuestas de regiones |
| `VISION_THIN_BORDER_RADIUS` | `0.003` | Estructuras finas que salen por el borde (tendedero); `0` lo desactiva |
| `VISION_LAYER_SINGLE` | `true` | Capas también en single (restar los vaqueros de la chaqueta) |
| `VISION_DECONTAMINATE_EDGES` | `true` | Recolorear los bordes semitransparentes (sin halo del fondo; pymatting) |

## Docker (CPU)

```bash
docker build -t dressit-vision services/vision                                 # pesos al primer uso
docker build --build-arg PRELOAD_MODELS=true -t dressit-vision services/vision # pesos dentro de la imagen
docker run -p 8001:8001 -v dressit-models:/models dressit-vision
```

Reserva ≥ 6 GB de RAM para el contenedor con todos los modelos cargados.
