# ADR-0009 · Imágenes de productos de tiendas

**Decisión.** `retailer_integrations.image_policy` por integración: `licensed` (feeds/APIs que
conceden licencia de uso, p. ej. Awin cláusula 10.1 «sin modificación»), `link_preview` (mostrar la
imagen enlazada desde la tienda, sin re-alojarla ni modificarla) o `none`. Por defecto, la importación
por enlace y la captura usan `none` y se pide al usuario su propia foto. Las imágenes de feeds no se
recortan ni se les quita el fondo (las condiciones de Awin exigen reproducirlas sin modificar).

**Consecuencias.** Menos «magia» visual en la importación por enlace, pero sin uso de imágenes sin
autorización. Cambiar la política de una tienda es una decisión legal documentada.
