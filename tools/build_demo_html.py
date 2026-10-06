#!/usr/bin/env python3
"""Empaqueta la demostración navegable en UN solo archivo HTML (CSS, JS e imagen incrustados).

Sirve para compartir la demo sin servidor (por ejemplo, como página privada para una prueba de
usabilidad). El sitio www.nucleoerp.cl publica la versión normal en /demo/ (ver web.yml).

Uso:
    cd apps/desktop && pnpm exec vite build --base ./ --outDir ../../dist-demo-single
    python3 tools/build_demo_html.py dist-demo-single nucleo-erp-demo.html
"""
import base64
import pathlib
import sys


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    build, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
    assets = build / "assets"
    js = next(assets.glob("index-*.js")).read_text(encoding="utf-8")
    css = next(assets.glob("index-*.css")).read_text(encoding="utf-8")
    for img in assets.glob("*.png"):
        uri = "data:image/png;base64," + base64.b64encode(img.read_bytes()).decode()
        js = js.replace(f"new URL(`{img.name}`,import.meta.url).href", f'"{uri}"')
        if img.name in js:
            print(f"No se pudo incrustar {img.name}")
            return 1
    js = js.replace("</script", "<\\/script")
    html = (
        "<!doctype html>\n<html lang=\"es-CL\"><head><meta charset=\"utf-8\">"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
        f"<title>NÚCLEO ERP</title><style>{css}</style></head>"
        f"<body><div id=\"root\"></div><script type=\"module\">{js}</script></body></html>\n"
    )
    out.write_text(html, encoding="utf-8")
    print(f"{out} ({len(html) // 1024} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
