# Sitio web — www.nucleoerp.cl

Sitio estático, sin cookies, analítica, fuentes ni scripts externos (coherente con la política de
privacidad de NÚCLEO). Las páginas usan marcadores `{{...}}` que completa `tools/build_web.py`.

```bash
python3 tools/build_web.py --out dist-web                              # sin instalador ("muy pronto")
python3 tools/build_web.py --out dist-web --installer NucleoERPSetup.exe  # con descarga y SHA-256
```

Configuración en `site.config.json`: dominio, URL del repositorio, enlace de donaciones, correo de
contacto y texto de la etapa actual. Publicación y DNS: ver `docs/WEB.md`.
