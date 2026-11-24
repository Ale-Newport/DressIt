# Evidencia: digitalización extremo a extremo con modelos reales (2026-11-24)

Generado por `node services/api/scripts/e2e-digitize.ts` contra la API en ejecución y el servicio de
visión real (Marqo-FashionSigLIP + Grounding DINO + SAM 2.1 + rembg isnet, en MPS). Flujo completo:
registro → 10 subidas (`/v1/uploads`) → importación por lote (`/v1/imports/photos`, modo `single`)
→ análisis asíncrono → revisión → aceptación → armario → conjuntos del día.

Fotos reales con licencia abierta etiquetadas a mano (`services/vision/eval/manifest.csv`), elegidas con
subcategorías distintas y prioridad para el conjunto de test reservado.

- Subida de 10 fotos: 1.0 s · análisis del lote: 10.5 s (1.05 s/foto)
- Categoría correcta: **10/10**
- Subcategoría: **10/10 correctas cuando el modelo responde** (0 abstenciones, que el usuario completa en la revisión)
- Color principal en la familia etiquetada: **6/10**
- Prendas en el armario tras la revisión: **10**, todas con recorte sin fondo: 10/10

| Foto | Licencia · autor | Esperado (cat / subcat / color) | Predicho (confianza) | Cat · Sub · Color | Recorte | Avisos |
|---|---|---|---|---|---|---|
| ov_denim_jacket_07 | CC BY 2.0 · Menswear Market | outerwear / chaqueta o cazadora_vaquera o sobrecamisa / amarillo o mostaza | outerwear (0.92) / cazadora_vaquera (0.72) / amarillo | ✅ ✅ ✅ | sí | — |
| ov_baseball_cap_12 | CC BY 2.0 · fireflythegreat | accessory / gorra / azul | accessory (0.99) / gorra (0.89) / morado | ✅ ✅ ❌ | sí | — |
| ov_wool_scarf_00 | CC BY 2.0 · smittenkittenorig | accessory / bufanda / negro o antracita o gris | accessory (0.99) / bufanda (0.96) / negro | ✅ ✅ ✅ | sí | La prenda sale cortada en el borde de la foto |
| ov_beanie_hat_02 | CC BY 2.0 · Menswear Market | accessory / gorro / azul_marino o negro | accessory (1.00) / gorro (0.97) / blanco | ✅ ✅ ❌ | sí | — |
| ov_handbag_19 | CC BY 2.0 · smittenkittenorig | accessory / bolso / gris o marron o antracita | accessory (0.97) / bolso (0.92) / marron | ✅ ✅ ✅ | sí | La prenda sale cortada en el borde de la foto |
| ov_blazer_02 | CC BY-SA 2.0 · achimh | footwear / zapatillas o zapatillas_lona / negro | footwear (0.98) / zapatillas_lona (0.46) / negro | ✅ ✅ ✅ | sí | — |
| ov_cardigan_03 | CC BY 2.0 · AnnaKika | top / cardigan o jersey_grueso / camel o beige o marron | top (0.96) / jersey_grueso (0.49) / camel | ✅ ✅ ✅ | sí | — |
| ov_ballet_flats_09 | CC BY 2.0 · lambsandivydesigns.com | footwear / bailarinas / rosa | footwear (0.99) / bailarinas (0.59) / marron | ✅ ✅ ❌ | sí | — |
| ov_floral_dress_11 | CC BY 2.0 · Dave Hamster | one_piece / vestido / blanco o crudo o naranja | one_piece (0.93) / vestido (0.72) / gris | ✅ ✅ ❌ | sí | — |
| ov_puffer_jacket_01 | CC BY 2.0 · Rydale Country Clothing | outerwear / plumifero / azul o azul_marino | outerwear (0.98) / plumifero (0.72) / azul | ✅ ✅ ✅ | sí | La prenda sale cortada en el borde de la foto |

## Conjuntos generados con esas prendas (Hoy hará entre 6 y 10 °C, con lluvia a mediodía.)

1. Vestido en gris + Plumífero en azul + Zapatillas de lona en negro + Gorro en blanco — puntuación 0.74. Base neutra con un toque de azul: gris, azul y negro combinan bien.
2. Vestido en gris + Plumífero en azul + Bailarinas en marrón + Gorro en blanco — puntuación 0.73. Base neutra con un toque de azul: gris, azul y marrón combinan bien.

Avisos del motor: Solo hemos podido crear 2 conjunto(s) distintos con las prendas disponibles.

Créditos de las fotos: ver columna «Licencia · autor»; URLs de origen en el manifiesto.
