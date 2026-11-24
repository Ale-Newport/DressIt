# Servidor de generación de imágenes (ComfyUI)

Genera las **fotos de estudio** de las prendas y los **avatares** del usuario con su conjunto. La API
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

## Arrancar

```bash
services/imagegen/run.sh
```

Escucha en `http://127.0.0.1:8188`. En macOS arranca en fp16 (bf16 es muy lento en MPS). Después,
en `.env`: `IMAGEGEN_COMFY_URL=http://127.0.0.1:8188`. Sin esa variable la API desactiva la
generación y la app oculta esas funciones.

## Probar un workflow sin la app

```bash
cd services/api
node scripts/imagegen-try.ts studio <recorte.png> /tmp/estudio.png "jersey de punto, camel"
node scripts/imagegen-try.ts studio <recorte.png> /tmp/estudio.png "jersey de punto, camel" studio-fast
```

## Producción

En servidores con GPU (CUDA), el mismo ComfyUI con los pesos completos (bf16/fp8 de Comfy-Org) y
los mismos workflows cambiando los nodos `UnetLoaderGGUF`/`CLIPLoaderGGUF` por `UNETLoader`/`CLIPLoader`.
Un solo proceso de generación (`pnpm --filter @dressit/api worker`) consume la cola con concurrencia 1.
