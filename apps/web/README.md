# Sitio web — www.nucleoerp.cl

Sitio estático, sin cookies, analítica ni recursos de terceros (coherente con la privacidad de NÚCLEO).
La tipografía (Manrope, licencia OFL) y las capturas se sirven desde el mismo dominio.

| Carpeta | Contenido |
|---|---|
| `index.html`, `descargar/`, `privacidad/`, `firma/`, `404.html` | Páginas escritas a mano |
| `_partials/` | `head`, `header` y `footer` comunes (`<!--#include nombre-->`) |
| `_data/funciones.json` | Módulos y novedades: genera `/funciones/`, el bento del inicio, el pie, `llms.txt` y el JSON-LD |
| `_templates/` | Plantillas de `/funciones/` y de cada módulo |
| `assets/capturas/` | Capturas de la demo en tema claro y oscuro, 800 y 1440 px (WebP) |

```bash
python3 tools/build_web.py --out dist-web                                   # sin instalador ("muy pronto")
python3 tools/build_web.py --out dist-web --installer NucleoERPSetup.exe    # con descarga y SHA-256
```

Una captura se inserta con `<!--SHOT:nombre|texto alternativo|eager-->`. Para agregar un módulo, súmalo a
`_data/funciones.json` con su captura. Configuración en `site.config.json`; publicación, DNS, SEO e
indexación en `docs/WEB.md`.
