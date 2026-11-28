# Probador virtual (`services/tryon`)

Servicio HTTP (FastAPI, puerto 8002) que viste a una persona con **una prenda por pasada** usando
**FASHN VTON v1.5**, y que analiza qué lleva puesto una imagen con **Sapiens2** (para el control de
fidelidad de la API). La API de DressIt lo usa para el método «Probador (prenda a prenda)» de
*Tu avatar*. Diseño, modelos, licencias y resultados: [docs/probador-virtual.md](../../docs/probador-virtual.md).

## Instalar

```bash
services/tryon/setup.sh
```

Crea el entorno (uv) y descarga ~3,9 GB de pesos en `services/tryon/models/` (no se versionan):

| Carpeta | Pesos | Licencia de los pesos |
|---|---|---|
| `fashn-vton-1.5/` | `fashn-ai/fashn-vton-1.5` | Apache-2.0 |
| `dwpose/` | `fashn-ai/DWPose` (`yolox_l.onnx`, `dw-ll_ucoco_384.onnx`) | Apache-2.0 |
| `sapiens2-seg-0.4b/` | `facebook/sapiens2-seg-0.4b` | Sapiens2 License (ver restricciones en la documentación) |

**No** se descarga `fashn-ai/fashn-human-parser` (pesos de licencia no comercial): la máscara
de la ropa a sustituir se calcula con Sapiens2.

## Arrancar

```bash
services/tryon/run.sh
```

Y en la API: `TRYON_SERVICE_URL=http://localhost:8002`. En Apple Silicon usa MPS en fp32; en CUDA,
bf16. El modelo se carga en la primera petición (~10 s).

## Endpoints

| Método | Ruta | Uso |
|---|---|---|
| `GET` | `/health` | `{status, device, models: {nombre: presente}, loaded}` |
| `POST` | `/v1/tryon` | multipart: `person`, `garment` (recorte RGBA o foto de producto), `category` (`tops`, `bottoms`, `one-pieces`), `steps` (4–50, 20 por defecto), `seed`, `mask` (`true`: sustituye la ropa de esa zona; `false`: viste por encima). Devuelve PNG. Cabeceras `x-timings-ms`, `x-masked`. |
| `POST` | `/v1/composite` | multipart: `base`, `edited` (salida de la pasada de calzado/complementos), `regions` (`feet`, `head`, `neck`, separadas por comas) → `base` con `edited` pegado solo en esas zonas (Sapiens2). |
| `POST` | `/v1/parse` | multipart `image` → `{upper, lower, shoes, face: {area, png_base64}}`: recorte RGBA de cada zona según Sapiens2. |

Errores en español con el formato `{"error": {"code", "message"}}`. El servicio no guarda nada.

## Tests y evaluación

```bash
cd services/tryon && uv run pytest          # contratos y máscara (sin pesos)
uv run python eval/benchmark.py --cases <casos.json> --out <carpeta>   # con vision, tryon y ComfyUI arrancados
```

`eval/benchmark.py` compara tres métodos (una pasada con Qwen-Image-Edit, secuencial sin máscara y
secuencial con máscara) con métricas por prenda (ΔE y similitud FashionSigLIP de cada zona), un
indicador de identidad y el tiempo.

## Código de terceros

`app/fashn/` contiene código copiado de [FASHN VTON v1.5](https://github.com/fashn-AI/fashn-vton-1.5)
(Apache-2.0); cambios y motivo en [`app/fashn/NOTICE.md`](app/fashn/NOTICE.md).
