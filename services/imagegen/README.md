# Servidor de generación de imágenes (ComfyUI)

Genera las **fotos de catálogo** de las prendas (packshot: prenda extendida y colocada, fondo blanco;
ver [docs/foto-catalogo.md](../../docs/foto-catalogo.md)) y los **avatares** del usuario con su conjunto. La API
de DressIt lo usa por HTTP como un programa aparte (`IMAGEGEN_COMFY_URL`); los workflows viven en
[`services/api/src/modules/imagegen/workflows`](../api/src/modules/imagegen/workflows) y se generan
con [`scripts/build_workflows.py`](scripts/build_workflows.py).

Detalles, decisiones y resultados: [docs/generacion-imagenes.md](../../docs/generacion-imagenes.md).

## Instalar

```bash
services/imagegen/setup.sh
```

Clona ComfyUI y el nodo ComfyUI-GGUF en `services/imagegen/comfyui/` (excluido de git), crea su
entorno de Python con `uv` y descarga los pesos (~32 GB). Se puede repetir: reanuda descargas y
salta lo que ya está. `setup.sh qwen` o `setup.sh klein` instalan solo un modelo.

| Pieza | Licencia | Tamaño |
|---|---|---|
| ComfyUI (programa aparte, por HTTP) | GPL-3.0 | — |
| ComfyUI-GGUF | Apache-2.0 | — |
| Qwen-Image-Edit-2511 Q4_K_M (unsloth) | Apache-2.0 | 12,8 GB |
| Qwen2.5-VL-7B-Instruct Q8_0 + mmproj f16 (ggml-org) | Apache-2.0 | 9,5 GB |
| Qwen-Image VAE (Comfy-Org) | Apache-2.0 | 0,25 GB |
| Qwen-Image-Edit-2511-Lightning 4 pasos (lightx2v) | Apache-2.0 | 0,85 GB |
| FLUX.2 klein 4B Q8_0 (unsloth) | Apache-2.0 | 4,3 GB |
| Qwen3-4B Q8_0 (unsloth) | Apache-2.0 | 4,3 GB |
| FLUX.2 VAE (Comfy-Org) | Apache-2.0 | 0,34 GB |

Se usan versiones GGUF porque FP8 no funciona en Apple Silicon (MPS).

## Servidor MLX: detectar, comprobar y fotografiar cada prenda, y vestir al usuario (por defecto en Mac)

```bash
services/imagegen/run-mlx.sh
```

Después, en `.env`: `IMAGEGEN_MLX_URL=http://127.0.0.1:8189` y `PACKSHOT_PROVIDERS=mlx`. Es un programa
pequeño ([`mlx/server.py`](mlx/server.py), [`mlx/garments.py`](mlx/garments.py), [`mlx/attrs.py`](mlx/attrs.py)
y [`mlx/restore.py`](mlx/restore.py)) que mantiene en memoria dos modelos nativos de Apple Silicon (MLX),
sin ComfyUI (~36 GB en total):

| Modelo | Para qué | Licencia | Descarga | Tiempo (M2 Max) |
|---|---|---|---|---|
| Qwen3.5-35B-A3B 4-bit ([mlx-vlm](https://github.com/Blaizzy/mlx-vlm) 0.8.1; mezcla de expertos con 3 B activos) | `POST /v1/garments`: todas las prendas de la foto entera, cada una como **una** (un frac; un par de zapatos), con su caja, nombre en inglés y en español, la descripción de la prenda **completa** y lo que su foto de catálogo debe conservar (largo, mangas, capucha, cordones, estampado grande, encaje, cinta, faldones, asa, color de cada parte) y si alguien la lleva puesta. `POST /v1/verify`: lee esos rasgos en la foto de estudio y los compara por reglas. `POST /v1/identify`: qué prenda muestra una foto de estudio | Apache-2.0 | ~20 GB | 4-15 s por foto; ~2 s por comprobación |
| FLUX.2 klein 4B ([mflux](https://github.com/filipstrand/mflux) 0.24, fp16 sin cuantizar) | `POST /v1/edit`: la foto de estudio. `POST /v1/restore`: el recorte real de una prenda que nadie lleva puesta, limpiado (imagen a imagen), cuando klein dibuja otra prenda; rechaza (422) los recortes en trozos. `POST /v1/tryon`: la persona de su foto vistiendo hasta 4 prendas; `POST /v1/tryon/check`: qué prendas lleva de verdad | Apache-2.0 | ~15 GB | 14-22 s la foto de estudio, ~12 s la restaurada, 19-23 s el probador |

- **Todo por debajo de 30 s por imagen.** Sin cuantizar, klein es más rápido que en q8 o q4 (mediana 14 s
  frente a 16 s) y más fiel. Qwen-Image-Edit (ComfyUI, ~3 min) y FLUX.3 klein (16 pasos) se descartan por
  lentos; FLUX.2 klein 9B y FLUX.3 klein además exigen aceptar una licencia no comercial.
- Una sola cola (un hilo: MLX no comparte su *stream* entre hilos), así que la API puede enviar varias
  prendas a la vez sin saturar la GPU.
- La caché de MLX se limita a `MLX_CACHE_GB` (2) y se vacía tras cada trabajo.
- `MLX_VLM` elige el modelo de visión y lenguaje (`none` lo desactiva); `MLX_QUANTIZE=8` cuantiza klein.
- Pruebas sin modelos: `.mflux-venv/bin/python -m pytest services/imagegen/mlx/test_garments.py`.
- Bancos de pruebas sin la API: [`mlx/bench.py`](mlx/bench.py) (tiempos y variantes de klein),
  [`mlx/loop_bench.py`](mlx/loop_bench.py) (generar → comprobar → reintentar → restaurar, como la API),
  [`mlx/vlm_bench.py`](mlx/vlm_bench.py) (detección) y [`mlx/bench_tryon.py`](mlx/bench_tryon.py) (probador).
  Los datos de entrada los exportan `services/api/scripts/studio-dataset.ts` y `studio-prompts.ts`.

Detalle y medidas: [docs/foto-catalogo.md](../../docs/foto-catalogo.md) y
[docs/probador-virtual.md](../../docs/probador-virtual.md).

## Arrancar ComfyUI (vistas del avatar y métodos antiguos del probador; opcional)

```bash
services/imagegen/run.sh
```

Escucha en `http://127.0.0.1:8188`. En macOS arranca en fp16 (bf16 es muy lento en MPS). Después,
en `.env`: `IMAGEGEN_COMFY_URL=http://127.0.0.1:8188`. Sin esa variable la API desactiva la
generación y la app oculta esas funciones.

## Probar un workflow sin la app

```bash
cd services/api
node scripts/imagegen-try.ts packshot <foto.jpg> /tmp/packshot.png cardigan camel
# velocidad y control de calidad sobre las fotos de evaluación (packshot-fast = klein, packshot = Qwen)
node --env-file=../../.env scripts/packshot-bench.ts packshot-fast /tmp/bench
# tiempo de cada nodo de ComfyUI
node --env-file=../../.env scripts/imagegen-profile.ts packshot-fast <foto.jpg> /tmp/p.png cardigan
```

La foto de catálogo usa por defecto `packshot-fast` (FLUX.2 klein 4B, ~28 s en un M2 Max); `packshot`
(Qwen-Image-Edit, ~3 min) es más fiel en prendas negras; la API oscurece después las prendas oscuras que klein aclara. Medidas en
[docs/evidence/packshot-rapido-2026-11-24.md](../../docs/evidence/packshot-rapido-2026-11-24.md).
Con ComfyUI, el probador virtual y el servicio de visión cargados a la vez, un Mac de 64 GB puede
quedarse sin memoria y ComfyUI se para: arranca solo los servicios que vayas a usar.

## Producción

En servidores con GPU (CUDA), el mismo ComfyUI con los pesos completos (bf16/fp8 de Comfy-Org) y
los mismos workflows cambiando los nodos `UnetLoaderGGUF`/`CLIPLoaderGGUF` por `UNETLoader`/`CLIPLoader`.
Un solo proceso de generación (`pnpm --filter @dressit/api worker`) consume la cola con concurrencia 1.
