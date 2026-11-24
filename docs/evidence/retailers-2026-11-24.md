# Evidencia: importación de enlaces por servidor (2026-11-24)

Generado por `pnpm --filter @dressit/api retailers:check` (services/api/scripts/check-retailers.ts).
Una petición por tienda a una página pública de producto (mercado español), con el user-agent
`DressItLinkPreview/0.1 (+https://github.com/Ale-Newport/DressIt; importación a petición del usuario)`, respetando robots.txt y **sin** técnicas de evasión anti-bot.
Cuando la tienda bloquea la lectura desde servidor, la vía operativa es la captura en el
dispositivo del usuario (navegador integrado / compartir desde Safari).

| Tienda | Resultado | Detalle | Tiempo | URL de prueba |
|---|---|---|---|---|
| Zara | ⛔ solo captura en dispositivo | http_status 403: La tienda respondió con el estado 403. | 291 ms | https://www.zara.com/es/es/cazadora-regular-fit-con-lana-p04517500.html |
| Pull&Bear | ⛔ solo captura en dispositivo | http_status 403: La tienda respondió con el estado 403. | 394 ms | https://www.pullandbear.com/es/chaqueta-doble-faz-l07720321 |
| Bershka | ⛔ solo captura en dispositivo | http_status 403: La tienda respondió con el estado 403. | 275 ms | https://www.bershka.com/es/cazadora-acolchada-capucha-c0p226931225.html |
| Massimo Dutti | ⛔ solo captura en dispositivo | http_status 403: La tienda respondió con el estado 403. | 381 ms | https://www.massimodutti.com/es/botin-plano-chelsea-piso-track-l11126650 |
| Stradivarius | ⛔ solo captura en dispositivo | http_status 403: La tienda respondió con el estado 403. | 330 ms | https://www.stradivarius.com/es/cazadora-oversize-efecto-piel-l08460705 |
| Oysho | ⛔ solo captura en dispositivo | http_status 403: La tienda respondió con el estado 403. | 280 ms | https://www.oysho.com/es/camiseta-seamless-base-layers-l30216842 |
| Lefties | ⛔ solo captura en dispositivo | http_status 403: La tienda respondió con el estado 403. | 340 ms | https://www.lefties.com/es/hombre/ropa/pantalones/pantal%C3%B3n-jogger-tailoring-c1030267575p753740600.html |
| El Corte Inglés | ⛔ solo captura en dispositivo | http_status 403: La tienda respondió con el estado 403. | 198 ms | https://www.elcorteingles.es/moda-hombre/A59419370-negro-pr-abrigo-tecnico-de-hombre-color-negro-cuello-desmontable/ |
| Mango | ⛔ solo captura en dispositivo | http_status 429: La tienda respondió con el estado 429. | 180 ms | https://shop.mango.com/es/es/p/mujer/abrigos/abrigos/abrigo-lana-cruzado-botones/47041448/56/00 |
| H&M | ⛔ solo captura en dispositivo | http_status 403: La tienda respondió con el estado 403. | 383 ms | https://www2.hm.com/es_es/productpage.1348073008.html |
| Uniqlo | ⛔ solo captura en dispositivo | network: No se pudo conectar con la tienda. | 294 ms | https://www.uniqlo.com/es/es/products/E422987-000/00 |
| Springfield | ✅ operativa | HTTP 200; datos estructurados (json_ld): título, precio 39.99 EUR, marca Springfield, disponibilidad in_stock, 4 imágenes | 759 ms | https://myspringfield.com/es/es/hombre/cazadoras/chaqueta-softshell-capucha/0954304.html |
| Cortefiel | ✅ operativa | HTTP 200; datos estructurados (json_ld): título, precio 69.99 EUR, marca Cortefiel, disponibilidad in_stock, 4 imágenes | 549 ms | https://cortefiel.com/es/es/mujer/abrigos/gabardina-satinada-capucha-desmontable/6614836.html |
| Pedro del Hierro | ✅ operativa | HTTP 200; datos estructurados (json_ld): título, precio 44.95 EUR, marca Pedro del Hierro, disponibilidad in_stock, 4 imágenes | 3915 ms | https://cortefiel.com/es/es/hombre/camisas/camisa-cuadro-melange/1844322.html |
| Zalando | ⛔ solo captura en dispositivo | http_status 403: La tienda respondió con el estado 403. | 402 ms | https://www.zalando.es/jack-and-jones-jjgalaxy-puffer-chaqueta-de-invierno-sky-captain-ja222t28r-k11.html |
| ASOS | ⛔ solo captura en dispositivo | network: No se pudo conectar con la tienda. | 492 ms | https://www.asos.com/es/asos-design/asos-design-sudadera-con-capucha-con-detalle-de-nudo-y-cintura-ajustada-en-gris-antracita/prd/212100190 |
| Decathlon | ⛔ solo captura en dispositivo | http_status 403: La tienda respondió con el estado 403. | 179 ms | https://www.decathlon.es/es/p/camiseta-running-transpirable-mujer-kiprun-skincare-negro/100155/c382m8548024 |
| Nike | ✅ operativa | HTTP 200; datos estructurados (json_ld): título, precio 127.99 EUR, marca Nike, disponibilidad unknown, 1 imágenes, 2 variantes | 1018 ms | https://www.nike.com/es/t/24-7-impossiblysoft-plush-chaqueta-therma-fit-hombre-Hd8aZX3i |
| Adidas | ⛔ solo captura en dispositivo | http_status 403: La tienda respondió con el estado 403. | 526 ms | https://www.adidas.es/sudadera-trefoil-essentials-crew/KS8921.html |
