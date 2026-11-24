# ADR-0004 · Visión artificial con modelos abiertos en un servicio Python

**Decisión.** Microservicio FastAPI (`services/vision`) con PyTorch: Marqo-FashionSigLIP (Apache-2.0,
768-d) para embeddings y clasificación *zero-shot* con umbrales de abstención; detección
multi-prenda de vocabulario abierto (Grounding DINO tiny, Apache-2.0); eliminación de fondo con rembg y
un modelo indicado explícitamente (el modelo por defecto de rembg, BRIA RMBG, es no comercial);
colores dominantes por k-means en CIELAB con CIEDE2000 (misma implementación que `@dressit/shared`);
OCR para tickets y etiquetas. Detalles y licencias en [docs/vision.md](../vision.md).

**Alternativas descartadas.** APIs multimodales de pago (coste, privacidad, dependencia), YOLO de
Ultralytics (AGPL), modelos entrenados con DeepFashion2 (licencia no comercial).

**Consecuencias.** Las fotos se procesan en infraestructura propia y no se envían a terceros. Los
pesos de BiRefNet/IS-Net se entrenaron en parte con DIS5K (términos no comerciales): pendiente de
revisión legal antes de producción.
