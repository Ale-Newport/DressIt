# Poner en marcha la foto de catálogo: lo que tienes que hacer tú

Esta guía es para ti, como responsable de DressIt. El código ya está hecho
([foto-catalogo.md](foto-catalogo.md)): solo faltan cuentas, claves y algunas decisiones. Cada proveedor
funciona por separado. Puedes activarlos de uno en uno: los que no tengan clave se saltan y la app lo
indica.

Los menús de cada web eran así el 24/11/2026; si cambian de nombre, busca la sección equivalente
(«API keys», «Credentials»…).

---

## Modo gratuito (sin pagar ni poner tarjeta)

Funciona así:

| Pieza | Gratis | Cómo |
|---|---|---|
| Foto de estudio con IA | **Sí** | FLUX.2 klein 4B en tu Mac (ComfyUI). Ya está instalado; tarda unos 30 s por foto con el Mac encendido (Qwen-Image-Edit, más fiel en prendas negras: ~3 min, con `IMAGEGEN_PACKSHOT_WORKFLOW=packshot`) |
| Foto oficial en Internet | **Sí**, 250 búsquedas al mes | Plan gratuito de SerpApi (paso 3). Con una búsqueda por prenda, unas 250 prendas al mes |
| Foto oficial de catálogos autorizados | **Sí** | Redes de afiliación ([conectar-tiendas.md](conectar-tiendas.md)): cuesta tiempo, no dinero |
| FASHN, fal.ai, Google Cloud Vision | **No** | Piden pago o tarjeta: no hagas los pasos 1, 2 y 4 |

En `.env` ya está preparado este modo:
- `PACKSHOT_PROVIDERS=comfy`: solo el generador local;
- `SERPAPI_COST_CENTS=0`;
- `CATALOG_SEARCH_QUERIES=crop`: una búsqueda por prenda en vez de dos;
- `CATALOG_DAILY_SEARCHES_PER_USER=8`: unas 240 al mes, por debajo del límite gratuito.

Solo te falta:
1. **SerpApi** (paso 3): crea la cuenta y pega la clave en `SERPAPI_API_KEY=`. Si al registrarte te
   pide tarjeta, no sigas: la app funciona igual sin búsqueda en Internet.
2. **Tener ComfyUI encendido** cuando uses la app: `services/imagegen/run.sh`, o el servidor
   `dressit-imagegen` de `.claude/launch.json`.
3. Reiniciar la API.

Si llegas al límite de 250 búsquedas, SerpApi responde con un error, la app lo muestra como «límite
alcanzado» y sigue generando la foto con IA. No se cobra nada: el plan gratuito no tiene tarjeta
asociada.

## Orden recomendado

| Prioridad | Qué | Para qué | Coste aproximado |
|---|---|---|---|
| 1 | **FASHN** | Fotos de estudio con IA rápidas (~40 s) y de buena calidad | 7,50 $ mínimo (100 imágenes) |
| 2 | **fal.ai** | Reserva de la generación (el mismo modelo que ya funciona en tu Mac) | ~0,035 $ por imagen |
| 3 | **SerpApi (Google Lens)** | Encontrar la foto oficial en Zara, Mango, H&M… | 250 búsquedas gratis al mes |
| 4 | **Google Cloud Vision** | Segundo buscador; su acuerdo con Lens da pruebas de «coincidencia exacta» | 1.000 gratis al mes, después 3,50 $ / 1.000 |
| 5 | **Catálogos de tiendas** (Awin, Rakuten…) | Fotos oficiales con licencia | Gratis, pero requiere aprobación |
| — | Lykdat | Opcional; hoy no funciona su alta | — |

Con **1 y 3** ya tienes el flujo completo: foto oficial cuando existe y foto de estudio rápida cuando no.

Antes de empezar, ten a mano el archivo **`.env`** de la raíz del proyecto
(`/Users/alejandro/Projects/DressIt/.env`). Ábrelo con cualquier editor de texto. Cada clave se pega
después del `=`, sin comillas ni espacios. Las variables que no estén en tu `.env` añádelas al final:
todas aparecen ya en `.env.example`.

> **Nunca** subas `.env` a GitHub (ya está en `.gitignore`) ni compartas las claves en capturas o
> mensajes. Si alguna se filtra, bórrala en la web del proveedor y crea otra.

---

## 1. FASHN (foto de estudio con IA, principal)

1. Entra en **https://app.fashn.ai** y pulsa *Sign up*. Puedes registrarte con Google o con correo.
2. Ve a **https://app.fashn.ai/api**, o a la sección **API** del menú lateral.
3. Compra créditos para la API: el mínimo es 100 créditos por 7,50 $.
   - 1 crédito = 1 foto de estudio con la configuración por defecto (`balanced`, `1k`).
   - Los créditos de la web y los de la API pueden ser distintos: asegúrate de comprar los de **API**.
4. En la misma página pulsa **Create API key** (o *New key*), ponle de nombre `DressIt` y **copia la
   clave**. Normalmente solo se muestra una vez.
5. En `.env`:
   ```
   FASHN_API_KEY=pega_aquí_la_clave
   ```
6. Opcional, para más calidad a más coste:
   - `FASHN_GENERATION_MODE=quality`: 2 créditos por foto;
   - `FASHN_RESOLUTION=2k`: 2 créditos en `balanced`.

   Los valores por defecto son suficientes para un armario.
7. Revisa sus condiciones en **https://fashn.ai/legal/terms-of-service**:
   - las imágenes generadas son tuyas;
   - FASHN no entrena con tus fotos;
   - borra los datos en base64 al terminar y su CDN a los 3 días.

> Su vía de API para fotos de producto («Agent Images») está marcada como *Experimental*. Si un día
> falla, DressIt pasa sola al siguiente generador.

---

## 2. fal.ai (generación de reserva)

1. Entra en **https://fal.ai** y pulsa *Sign up* (puedes usar GitHub o Google).
2. Añade saldo en **https://fal.ai/dashboard/billing**: con 5–10 $ tienes para cientos de fotos.
3. Ve a **https://fal.ai/dashboard/keys**, pulsa **Add key**, nómbrala `DressIt` y elige el alcance
   *API*. Copia la clave completa, que tiene la forma `xxxxxxxx-xxxx-…:yyyyyyyy`.
4. En `.env`:
   ```
   FAL_KEY=pega_aquí_la_clave
   ```
5. El orden de uso ya está configurado (`PACKSHOT_PROVIDERS=fashn,fal,comfy`):
   - FASHN primero;
   - fal.ai si FASHN falla o no está;
   - tu ComfyUI local en último lugar.

   Si prefieres fal.ai como principal, por ser más barato, cambia esa línea a `fal,fashn,comfy`.

---

## 3. SerpApi — Google Lens (búsqueda de la foto oficial)

1. Entra en **https://serpapi.com/users/sign_up** y crea la cuenta. Te pedirán verificar el correo y,
   a veces, el teléfono.
2. El plan gratuito incluye 250 búsquedas al mes. Cada foto de prenda usa **2 búsquedas** (recorte y
   foto entera), así que da para unas 125 prendas al mes. Para más:
   **https://serpapi.com/pricing**, a partir de 25 $ por 1.000 búsquedas.
3. Ve a **https://serpapi.com/manage-api-key** y copia tu *API Key*.
4. En `.env`:
   ```
   SERPAPI_API_KEY=pega_aquí_la_clave
   ```
   `SERPAPI_COUNTRY=es` y `SERPAPI_HL=es` ya vienen por defecto: resultados de tiendas españolas, en
   español.
5. Si pagas un plan, ajusta el coste por búsqueda para el control de presupuesto. Por ejemplo, con
   el plan Developer (75 $ / 5.000):
   ```
   SERPAPI_COST_CENTS=1.5
   ```
6. Puedes ver tu consumo en **https://serpapi.com/dashboard**.

> **Decisión tuya:** SerpApi obtiene los resultados de Google Lens leyendo su web (*scraping*). Es un
> servicio comercial legal y muy usado, pero Google no tiene una API oficial de Lens. Si no te parece
> aceptable, no pongas esta clave y usa solo Cloud Vision (paso 4), que sí es oficial de Google.

---

## 4. Google Cloud Vision — Web Detection

1. Entra en **https://console.cloud.google.com** con tu cuenta de Google y acepta las condiciones si
   es la primera vez.
2. **Crea un proyecto.** Arriba a la izquierda, en el selector de proyecto, pulsa **Proyecto nuevo**.
   Nómbralo `dressit` y pulsa **Crear**. Asegúrate de que queda seleccionado.
3. **Activa la facturación** (es obligatoria aunque uses solo lo gratuito):
   - abre **https://console.cloud.google.com/billing**;
   - crea una cuenta de facturación con tu tarjeta y vincúlala al proyecto.

   Las primeras 1.000 consultas al mes son gratis; después cuestan 3,50 $ por cada 1.000.
4. **Activa la API.** Abre **https://console.cloud.google.com/apis/library/vision.googleapis.com** y
   pulsa **Habilitar**.
5. **Crea la clave.** Abre **https://console.cloud.google.com/apis/credentials** y pulsa **+ Crear
   credenciales → Clave de API**. Copia la clave que aparece.
6. **Restringe la clave** (importante):
   - en la lista de claves pulsa sobre la nueva;
   - en **Restricciones de API**, elige **Restringir clave** y marca solo **Cloud Vision API**;
   - pulsa **Guardar**.
7. **Pon un límite de gasto.** En **https://console.cloud.google.com/billing/budgets** crea un
   presupuesto, por ejemplo de 10 €, con avisos al 50 % y al 90 %.
8. En `.env`:
   ```
   GOOGLE_CLOUD_VISION_API_KEY=pega_aquí_la_clave
   ```

---

## 5. Lykdat (opcional; hoy no se puede)

A 24/11/2026, su consola (**https://console.lykdat.com**) y su documentación devuelven un error
(HTTP 402) y no hay forma de darse de alta. Además su catálogo es de tiendas de EE. UU. y Reino
Unido. **No hace falta.** Si algún día vuelve a funcionar:

1. Regístrate en la consola.
2. Copia la *Publishable API Key*.
3. Pégala en `LYKDAT_API_KEY=`.

---

## 6. Catálogos de tiendas (fotos oficiales con licencia)

Las fotos encontradas con Google Lens son de las tiendas y DressIt solo las enseña enlazadas. Las
fotos de los **catálogos de afiliación** vienen con licencia de uso. Darse de alta lleva días o
semanas, porque cada tienda te aprueba.

Sigue la guía detallada que ya tienes, **[conectar-tiendas.md](conectar-tiendas.md)**:

| Paso de esa guía | Red | Tiendas |
|---|---|---|
| 0 | — | Prepara una web pública de DressIt (la piden todas las redes) |
| 1 | **Awin** (empieza por aquí) | Decathlon, adidas, Lefties, Bimba y Lola, JD Sports, Foot Locker, Sprinter… |
| 2 | Rakuten Advertising | Mango (posiblemente ASOS y Massimo Dutti) |
| 3 | Tradedoubler | Bershka (por confirmar) |
| 4 | CJ | Tous, The North Face (por confirmar) |
| 6 | — | Ingerir el catálogo: `pnpm --filter @dressit/api catalog:ingest` |
| 7 | — | Acuerdos directos (Inditex, H&M, El Corte Inglés): por correo, sin alta pública |

Cuando haya catálogo cargado, la foto de catálogo lo usa sola: busca primero ahí, sin coste y con
licencia.

---

## 7. Decisiones que tienes que tomar

1. **Fotos de tiendas encontradas en Internet.** Por defecto (`OFFICIAL_PHOTO_WEB_IMAGES=link_preview`)
   la app las enseña tal como las sirve la web de la tienda. No las copia, solo tú las ves, y lleva
   «Foto oficial de …» con un enlace a la tienda. Sin acuerdo con la tienda es una zona gris legal:
   - si prefieres no arriesgar, pon `OFFICIAL_PHOTO_WEB_IMAGES=none`: la búsqueda solo identificará
     marca, modelo y enlace, y la foto de estudio se generará con IA;
   - lo recomendable es consultarlo con un abogado antes de publicar la app.
2. **Presupuesto.** Los valores por defecto limitan el gasto:
   - `CATALOG_MONTHLY_BUDGET_CENTS=5000`: 50 $ al mes entre todos los proveedores de pago;
   - `CATALOG_DAILY_SEARCHES_PER_USER=40` y `CATALOG_DAILY_GENERATIONS_PER_USER=20`.

   Ajústalos a tu gusto.
3. **Automático o a petición.** Con `CATALOG_PHOTO_AUTO=true` (por defecto), cada prenda importada
   prepara su foto de catálogo sola. Con `false`, solo cuando el usuario pulsa «Crear foto de
   catálogo»; gasta menos.
4. **Protección de datos (antes de publicar).** Cada proveedor recibe fotos de los usuarios. Pide o
   acepta su acuerdo de encargado del tratamiento (DPA):

   | Proveedor | Cómo |
   |---|---|
   | SerpApi | escribiendo a privacy@serpapi.com |
   | Google Cloud | en la consola: *IAM y administración → Configuración de privacidad*, «Cloud Data Processing Addendum» |
   | FASHN | sección *Legal* de su web o soporte |
   | fal.ai | sección *Legal* de su web o soporte |

   Añádelos a la política de privacidad de la app.

---

## 8. Activarlo y comprobar que funciona

1. Guarda `.env`.
2. **Reinicia la API** para que lea las claves nuevas: si la tienes abierta con `pnpm dev:api`, para
   con `Ctrl+C` y vuelve a lanzarla.
   - Si usas el *worker* aparte (`pnpm dev:worker`), reinícialo también.
   - Los trabajos que estén en cola en ese momento se pierden: lánzalos de nuevo desde la app.
3. **Mira qué detecta el servidor.** Abre la app → cualquier prenda → tarjeta «Foto de catálogo» →
   «Dónde hemos buscado». También puedes llamar al API con tu sesión:
   ```bash
   curl -s http://localhost:3000/v1/catalog-photos/status -H "authorization: Bearer TU_TOKEN"
   ```
   Cada proveedor configurado debe aparecer con `"configured": true` y `"missing": []`.
4. **En la app**:
   - Perfil → Privacidad → **Permisos y consentimientos**: activa «Buscar mis prendas en Internet» y
     «Imágenes generadas con IA».
   - Haz una foto de una prenda **que sepas de qué tienda es** (por ejemplo, algo de Zara con la
     etiqueta visible).
   - En la revisión verás «Buscando la foto oficial…». Si la encuentra, aparece «Oficial · Zara» con
     sus pruebas; si no, se genera la foto de estudio.
5. **Prueba completa con las 8 fotos de ejemplo** (opcional), desde la carpeta del proyecto:
   ```bash
   cd services/api && node --env-file-if-exists=../../.env scripts/catalog-photo-eval.ts
   ```
   Genera comparativas nuevas en `docs/evidence/foto-catalogo/`.
6. **Vigila el gasto** la primera semana:
   - SerpApi: **https://serpapi.com/dashboard**
   - Google: **https://console.cloud.google.com/billing**
   - FASHN: **https://app.fashn.ai/api**
   - fal.ai: **https://fal.ai/dashboard/billing**

Cuando hayas hecho las primeras búsquedas reales, conviene revisar los umbrales de «coincidencia
exacta» (`OFFICIAL_PHOTO_EXACT_SIMILARITY`): hoy están calibrados solo con datos locales. Si ves
coincidencias marcadas como exactas que no lo son, súbelo de 0,86 a 0,9.

---

## 9. Producción (cuando publiques)

- En el servidor de producción pon las mismas variables como secretos del entorno (no en un archivo
  dentro de la imagen). Ver [despliegue.md](despliegue.md).
- Si usas FASHN o fal.ai, **no necesitas GPU** en el servidor. El ComfyUI local es solo para
  desarrollo; en producción quítalo de la lista: `PACKSHOT_PROVIDERS=fashn,fal`.
- El *worker* (`pnpm --filter @dressit/api worker`) procesa la cola `catalog-photo` con Redis. Sin él,
  las fotos de catálogo se quedan «En cola».

## Lista de comprobación

- [ ] FASHN: cuenta, créditos de API, `FASHN_API_KEY`
- [ ] fal.ai: cuenta, saldo, `FAL_KEY`
- [ ] SerpApi: cuenta, `SERPAPI_API_KEY` (y decidir si aceptas el *scraping*)
- [ ] Google Cloud: proyecto, facturación, Vision API activada, clave restringida, presupuesto,
      `GOOGLE_CLOUD_VISION_API_KEY`
- [ ] Decidir `OFFICIAL_PHOTO_WEB_IMAGES` (`link_preview` o `none`)
- [ ] Revisar los límites de gasto
- [ ] Reiniciar la API (y el *worker*)
- [ ] Probar con una prenda de tienda conocida
- [ ] Altas en redes de afiliación ([conectar-tiendas.md](conectar-tiendas.md)), empezando por Awin
- [ ] DPA con cada proveedor y política de privacidad actualizada, antes de publicar
