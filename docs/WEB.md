# Sitio web y descargas — www.nucleoerp.cl

## Cómo funciona

| Pieza | Dónde |
|---|---|
| Páginas del sitio | `apps/web/` (HTML + CSS, sin dependencias externas; partes comunes y páginas por módulo generadas, ver `apps/web/README.md`) |
| Construcción | `tools/build_web.py` → completa versión, tamaño y SHA-256 |
| Alojamiento | GitHub Pages, gratis, con HTTPS y dominio propio |
| Instalador | Lo compila `release.yml` en Windows y se publica en **www.nucleoerp.cl/descargas/NucleoERPSetup.exe** |

Flujo de una versión nueva:

```
git tag v0.2.0 && git push --tags
   → release.yml: pruebas + compila NucleoERPSetup.exe en Windows
   → crea la versión en GitHub con el .exe y su SHA-256
   → web.yml: reconstruye el sitio con el instalador y lo publica en www.nucleoerp.cl
```

Cambios solo del sitio (textos, diseño) se publican al hacer push a `main` en `apps/web/`.

## Puesta en marcha (una sola vez)

1. **Repositorio en GitHub** (público: el proyecto es de código abierto, AGPL-3.0).
2. En el repositorio: *Settings → Pages → Build and deployment → Source: GitHub Actions*.
3. *Settings → Pages → Custom domain*: `www.nucleoerp.cl` y activar *Enforce HTTPS* cuando esté disponible.
4. Recomendado: verificar el dominio en *Settings (de la cuenta u organización) → Pages → Verified domains*,
   para que nadie más pueda usarlo en GitHub.
5. **DNS de nucleoerp.cl** — en el proveedor de DNS configurado para el dominio (los servidores de
   nombre se ven en NIC Chile):

| Tipo | Nombre | Valor |
|---|---|---|
| CNAME | `www` | `kozuki-oden-ow.github.io` |
| A | `@` (nucleoerp.cl) | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |

Con los registros `A`, quien escriba `nucleoerp.cl` sin `www` llega igual al sitio. Los cambios de DNS
pueden tardar algunas horas en propagarse; GitHub emite el certificado HTTPS automáticamente.

6. En `apps/web/site.config.json` completar `repo_url` y, cuando existan, `donation_url` y `contact_email`.

## Alternativa sin GitHub Pages

`python3 tools/build_web.py --out dist-web --installer NucleoERPSetup.exe` genera una carpeta lista
para subir a cualquier hosting estático (cPanel, Netlify, Cloudflare Pages). La descarga sigue saliendo
de www.nucleoerp.cl.

## SEO, buscadores e IA (sin plugins)

El sitio no usa un CMS: lo que haría un plugin de SEO está en el código y lo genera `tools/build_web.py`.

| Pieza | Qué hace |
|---|---|
| Páginas por módulo (`/funciones/…`) | Una página indexable por función (ventas, inventario, promociones, envíos, F29…) con título, descripción y preguntas propias |
| JSON-LD | Organization, WebSite, SoftwareApplication (con `featureList`), FAQPage, BreadcrumbList, HowTo e ItemList |
| `sitemap.xml` | Automático con todas las páginas, fecha y prioridad |
| `robots.txt` | Todo permitido, incluidos asistentes de IA; apunta al sitemap y a `llms.txt` |
| `llms.txt` y `llms-full.txt` | Resumen del producto para ChatGPT, Claude, Perplexity y Gemini ([llmstxt.org](https://llmstxt.org)) |
| Open Graph | Título, descripción e imagen por página (`assets/og-image.png`, 1200×630) |
| `manifest.webmanifest`, `.well-known/security.txt` | Manifiesto web y contacto de seguridad (RFC 9116) |
| Rendimiento | Capturas WebP con `srcset`, tema claro/oscuro con `<picture>`, fuente precargada, `speculationrules` (prerender al pasar el mouse) y transiciones entre páginas (`@view-transition`) |
| IndexNow | `web.yml` avisa a Bing, Yandex y otros cada vez que se publica; la clave está en `site.config.json` (`indexnow_key`) y se publica en `/<clave>.txt` |

### Google Search Console (una vez, la hace el titular con su cuenta de Google)

1. Entrar a <https://search.google.com/search-console> → *Agregar propiedad* → **Prefijo de URL**:
   `https://www.nucleoerp.cl/`.
2. Método **Etiqueta HTML**: copiar solo el valor de `content="…"` y ponerlo en
   `apps/web/site.config.json` → `google_site_verification`. Publicar (push a `main`) y pulsar *Verificar*.
   (Alternativa: propiedad de **Dominio** con un registro TXT en el DNS de nucleoerp.cl.)
3. En *Sitemaps*, enviar `sitemap.xml`. En *Inspección de URLs*, pedir la indexación de la portada y de
   `/funciones/`.
4. Bing Webmaster Tools: *Importar desde Google Search Console* (o etiqueta en `bing_site_verification`).

## Reglas del sitio

- Sin cookies, analítica, formularios ni recursos de terceros.
- Siempre publicar el SHA-256 del instalador.
- Textos honestos sobre la etapa del proyecto (`stage_label` y `stage_note`).
