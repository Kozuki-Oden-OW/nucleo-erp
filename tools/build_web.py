#!/usr/bin/env python3
"""Construye el sitio www.nucleoerp.cl (apps/web) en una carpeta lista para publicar.

Uso:
    python3 tools/build_web.py --out dist-web [--installer ruta/NucleoERPSetup.exe] [--demo apps/desktop/dist-demo]

- Une las partes comunes (`<!--#include head|header|footer-->`, carpeta `_partials/`).
- Genera /funciones/ y una página por módulo desde `_data/funciones.json` (`_templates/`).
- Reemplaza los marcadores {{...}} con site.config.json y los datos de la versión.
- `<!--SHOT:nombre|texto alternativo|eager-->` inserta una captura que sigue el tema claro u oscuro
  del visitante (assets/capturas/<nombre>-<tema>-<ancho>.webp).
- Genera sitemap.xml, llms.txt, llms-full.txt, .well-known/security.txt y la clave de IndexNow.
- Con --installer copia el instalador a /descargas/NucleoERPSetup.exe y publica su tamaño y SHA-256.
  Sin --installer, la página de descarga muestra "muy pronto".
- Con --demo copia la demostración navegable (`pnpm build:demo`) en /demo/.
- Falla si queda algún marcador sin reemplazar o falta una captura.
"""
import argparse
import datetime as dt
import hashlib
import html
import json
import pathlib
import re
import shutil
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
WEB = ROOT / "apps" / "web"
TEXT_EXT = {".html", ".xml", ".txt", ".css", ".json", ".webmanifest"}
SHOTS = "/assets/capturas"


def human_size(n: int) -> str:
    return f"{n / (1024 * 1024):.1f} MB".replace(".", ",")


def conditional(text: str, name: str, keep_if: bool) -> str:
    pattern = re.compile(
        rf"<!--IF:{name}-->\n?(.*?)<!--ELSE:{name}-->\n?(.*?)<!--END:{name}-->\n?", re.S
    )
    return pattern.sub(lambda m: m.group(1) if keep_if else m.group(2), text)


def esc(s: str) -> str:
    return html.escape(s, quote=True)


def picture(name: str, alt: str, eager: bool, out: pathlib.Path, missing: list) -> str:
    for theme in ("light", "dark"):
        for w in (800, 1440):
            if not (out / "assets" / "capturas" / f"{name}-{theme}-{w}.webp").is_file():
                missing.append(f"{name}-{theme}-{w}.webp")
    src = lambda t: f"{SHOTS}/{name}-{t}-800.webp 800w, {SHOTS}/{name}-{t}-1440.webp 1440w"
    sizes = "(max-width: 1100px) 100vw, 1080px"
    load = 'loading="eager" fetchpriority="high"' if eager else 'loading="lazy"'
    return (
        f'<picture><source media="(prefers-color-scheme: dark)" type="image/webp" srcset="{src("dark")}" sizes="{sizes}">'
        f'<img src="{SHOTS}/{name}-light-1440.webp" srcset="{src("light")}" sizes="{sizes}" width="1440" height="900" '
        f'alt="{esc(alt)}" {load} decoding="async"></picture>'
    )


def card(m: dict, wide: bool = False) -> str:
    tag = '<span class="tag">Nuevo</span>' if m.get("nuevo") else ""
    return (
        f'<a class="{"wide" if wide else ""}" href="/funciones/{m["slug"]}/">{tag}'
        f'<div class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
        f'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{m["icono"]}</svg></div>'
        f'<h3>{esc(m["nombre"])}</h3><p>{esc(m["corto"])}</p><span class="more">Ver más →</span></a>'
    )


def module_page(tpl: str, m: dict, mods: list, site: str) -> str:
    puntos = "".join(
        f'<article class="card reveal"><h3>{esc(p["t"])}</h3><p>{esc(p["d"])}</p></article>' for p in m["puntos"]
    )
    faq = ""
    if m.get("preguntas"):
        items = "".join(
            f"<details><summary>{esc(q['q'])}</summary><p>{esc(q['a'])}</p></details>" for q in m["preguntas"]
        )
        faq = (
            '<section class="alt"><div class="wrap faq" style="max-width:840px"><div class="head">'
            '<span class="eyebrow">Preguntas</span><h2>Preguntas frecuentes</h2></div>'
            f"{items}</div></section>"
        )
    i = mods.index(m)
    related = [mods[(i + k) % len(mods)] for k in (1, 2, 3)]
    graph = [
        {
            "@type": "BreadcrumbList",
            "itemListElement": [
                {"@type": "ListItem", "position": 1, "name": "Inicio", "item": f"{site}/"},
                {"@type": "ListItem", "position": 2, "name": "Funciones", "item": f"{site}/funciones/"},
                {"@type": "ListItem", "position": 3, "name": m["nombre"], "item": f"{site}/funciones/{m['slug']}/"},
            ],
        },
        {
            "@type": "WebPage",
            "@id": f"{site}/funciones/{m['slug']}/",
            "name": m["titulo"],
            "description": m["meta"],
            "inLanguage": "es-CL",
            "isPartOf": {"@id": f"{site}/#sitio"},
            "about": {"@id": f"{site}/#software"},
            "primaryImageOfPage": f"{site}{SHOTS}/{m['captura']}-dark-1440.webp",
        },
    ]
    if m.get("preguntas"):
        graph.append({
            "@type": "FAQPage",
            "mainEntity": [
                {"@type": "Question", "name": q["q"], "acceptedAnswer": {"@type": "Answer", "text": q["a"]}}
                for q in m["preguntas"]
            ],
        })
    jsonld = json.dumps({"@context": "https://schema.org", "@graph": graph}, ensure_ascii=False)
    vals = {
        "M_SLUG": m["slug"],
        "M_NOMBRE": esc(m["nombre"]),
        "M_TITULO": esc(m["titulo"]),
        "M_META": esc(m["meta"]),
        "M_INTRO": esc(m["intro"]),
        "M_CORTO": esc(m["corto"]),
        "M_CAPTURA": m["captura"],
        "M_ALT": esc(f"{m['nombre']} en NÚCLEO ERP").replace("|", "-"),
        "M_TAG": '<a class="pill" href="/#novedades"><b>NUEVO</b> En la versión {{VERSION}}</a>' if m.get("nuevo") else "",
        "M_PUNTOS": puntos,
        "M_FAQ": faq,
        "M_RELATED": "".join(card(r) for r in related),
        "M_JSONLD": jsonld.replace("</", "<\\/"),
    }
    out = tpl
    for k, v in vals.items():
        out = out.replace("{{" + k + "}}", v)
    return out


def llms(cfg: dict, mods: list, version: str, full: bool) -> str:
    site = cfg["site_url"].rstrip("/")
    lines = [
        "# NÚCLEO ERP",
        "",
        "> ERP gratuito, local y de código abierto (AGPL-3.0) para emprendedores y pymes de Chile, de FAVOR SpA. "
        "Programa para Windows 10 y 11 que funciona sin Internet y guarda los datos de cada empresa cifrados en el "
        "computador del usuario. No es un sistema tributario: no emite facturas electrónicas ni se conecta al SII; "
        "prepara facturas internas y borradores del F29 y F22 explicados.",
        "",
        f"Versión actual: {version} ({cfg['stage_label']}). Precio: gratis, sin mensualidades ni funciones bloqueadas.",
        "",
        "## Páginas principales",
        f"- [Inicio]({site}/): qué es NÚCLEO, novedades, privacidad y preguntas frecuentes",
        f"- [Descargar]({site}/descargar/): instalador oficial para Windows, SHA-256 e instrucciones",
        f"- [Demo]({site}/demo/): la interfaz real con datos ficticios, en el navegador",
        f"- [Funciones]({site}/funciones/): todos los módulos",
        f"- [Privacidad]({site}/privacidad/): el programa no envía datos; el sitio no usa cookies ni rastreadores",
        "",
        "## Módulos",
    ]
    for m in mods:
        lines.append(f"- [{m['nombre']}]({site}/funciones/{m['slug']}/): {m['corto']}")
        if full:
            lines.append(f"  {m['intro']}")
            lines += [f"  - {p['t']}: {p['d']}" for p in m["puntos"]]
            lines += [f"  - P: {q['q']} R: {q['a']}" for q in m.get("preguntas", [])]
    lines += ["", "## Opcional"]
    if cfg.get("repo_url"):
        lines.append(f"- [Código fuente]({cfg['repo_url']}): repositorio público")
    lines.append(f"- [Resumen completo para IA]({site}/llms-full.txt)")
    return "\n".join(lines) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--installer")
    ap.add_argument("--demo")
    args = ap.parse_args()

    cfg = json.loads((WEB / "site.config.json").read_text(encoding="utf-8"))
    data = json.loads((WEB / "_data" / "funciones.json").read_text(encoding="utf-8"))
    mods = data["modulos"]
    tauri = json.loads((ROOT / "apps/desktop/src-tauri/tauri.conf.json").read_text(encoding="utf-8"))
    today = dt.date.today()
    site = cfg["site_url"].rstrip("/")

    out = pathlib.Path(args.out).resolve()
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(WEB, out, ignore=shutil.ignore_patterns("_*", "site.config.json", "README.md"))

    # Páginas de funciones.
    tpl = (WEB / "_templates" / "funcion.html").read_text(encoding="utf-8")
    for m in mods:
        d = out / "funciones" / m["slug"]
        d.mkdir(parents=True, exist_ok=True)
        (d / "index.html").write_text(module_page(tpl, m, mods, site), encoding="utf-8")
    idx = (WEB / "_templates" / "funciones.html").read_text(encoding="utf-8")
    funciones_ld = json.dumps({
        "@context": "https://schema.org",
        "@type": "ItemList",
        "name": "Funciones de NÚCLEO ERP",
        "itemListElement": [
            {"@type": "ListItem", "position": i + 1, "name": m["nombre"], "url": f"{site}/funciones/{m['slug']}/"}
            for i, m in enumerate(mods)
        ],
    }, ensure_ascii=False)
    (out / "funciones" / "index.html").write_text(idx.replace("{{FUNCIONES_JSONLD}}", funciones_ld), encoding="utf-8")

    installer = pathlib.Path(args.installer) if args.installer else None
    wide = {"ventas", "inventario", "promociones"}
    half = (len(mods) + 1) // 2
    foot = lambda ms: "".join(f'<li><a href="/funciones/{m["slug"]}/">{esc(m["nombre"])}</a></li>' for m in ms)
    values = {
        "SITE_URL": site,
        "VERSION": tauri["version"],
        "STAGE_LABEL": esc(cfg["stage_label"]),
        "STAGE_NOTE": esc(cfg["stage_note"]),
        "BUILD_DATE": today.isoformat(),
        "RELEASE_DATE": today.isoformat(),
        "YEAR": str(today.year),
        "SIZE": "—",
        "SHA256": "—",
        "ASSET_VERSION": hashlib.sha256((WEB / "assets" / "site.css").read_bytes()).hexdigest()[:10],
        "BENTO": "".join(card(m, m["slug"] in wide) for m in mods),
        "MODULE_COUNT": str(len(mods)),
        "NEWS": "".join(
            f'<a class="reveal" href="/funciones/{n["slug"]}/"><i class="dot"></i><span><strong>{esc(n["t"])}</strong>'
            f'<span>{esc(n["d"])}</span></span></a>'
            for n in data["novedades"]["items"]
        ),
        "FEATURE_LIST_JSON": json.dumps([f"{m['nombre']}: {m['corto']}" for m in mods], ensure_ascii=False),
        "FOOTER_MODULES_A": foot(mods[:half]),
        "FOOTER_MODULES_B": foot(mods[half:]),
    }
    verify = []
    if cfg.get("google_site_verification", "").strip():
        verify.append(f'<meta name="google-site-verification" content="{esc(cfg["google_site_verification"].strip())}">')
    if cfg.get("bing_site_verification", "").strip():
        verify.append(f'<meta name="msvalidate.01" content="{esc(cfg["bing_site_verification"].strip())}">')
    values["VERIFY_META"] = "\n  ".join(verify)

    if installer:
        raw = installer.read_bytes()
        values["SIZE"] = human_size(len(raw))
        values["SHA256"] = hashlib.sha256(raw).hexdigest()
        dest = out / "descargas"
        dest.mkdir(exist_ok=True)
        shutil.copy2(installer, dest / "NucleoERPSetup.exe")
        (dest / "NucleoERPSetup.exe.sha256").write_text(f"{values['SHA256']}  NucleoERPSetup.exe\n")

    if args.demo:
        demo = pathlib.Path(args.demo)
        if not (demo / "index.html").is_file():
            print(f"No se encontró la demostración construida en {demo}")
            return 1
        shutil.copytree(demo, out / "demo")

    repo = cfg.get("repo_url", "").strip()
    values["REPO_TEXT"] = (f'<a href="{esc(repo)}">Ver el código fuente</a>.' if repo
                           else "El código se publicará junto con la primera versión.")
    values["REPO_FOOTER_ITEM"] = f'<li><a href="{esc(repo)}">Código fuente</a></li>' if repo else ""
    values["REPO_FOOTER_LINK"] = f'<a href="{esc(repo)}">Código fuente</a>' if repo else ""
    values["REPO_URL"] = esc(repo or "https://github.com/")
    donation = cfg.get("donation_url", "").strip()
    values["DONATION_TEXT"] = (f'<a href="{esc(donation)}">apoyar NÚCLEO</a>.' if donation
                               else "muy pronto publicaremos cómo hacerlo.")
    email = cfg.get("contact_email", "").strip()
    values["CONTACT_TEXT"] = (f'Escríbenos a <a href="mailto:{esc(email)}">{esc(email)}</a>.'
                              if email else "Pronto publicaremos un correo de contacto.")

    partials = {p.stem: p.read_text(encoding="utf-8").rstrip("\n") for p in (WEB / "_partials").glob("*.html")}
    leftovers, missing = [], []
    for f in out.rglob("*"):
        if f.suffix not in TEXT_EXT or not f.is_file() or "demo" in f.relative_to(out).parts[:1]:
            continue
        text = f.read_text(encoding="utf-8")
        text = re.sub(r"<!--#include (\w+)-->", lambda m: partials[m.group(1)], text)
        if 'name="robots" content="noindex"' in text:
            text = re.sub(r'\s*<meta name="robots" content="index[^"]*">', "", text)
        text = conditional(text, "INSTALLER", installer is not None)
        for _ in range(2):  # dos pasadas: los valores generados pueden traer marcadores
            for k, v in values.items():
                text = text.replace("{{" + k + "}}", v)
        text = re.sub(
            r"<!--SHOT:([\w-]+)\|([^|>]*)(\|eager)?-->",
            lambda m: picture(m.group(1), m.group(2), bool(m.group(3)), out, missing),
            text,
        )
        f.write_text(text, encoding="utf-8")
        leftovers += [f"{f.relative_to(out)}: {m}" for m in re.findall(r"\{\{[A-Z_]+\}\}", text)]

    # Mapa del sitio con todas las páginas (sin la 404), la demo y la fecha de construcción.
    pages = sorted(
        "/" + str(p.parent.relative_to(out)).replace("\\", "/").strip(".") + "/"
        for p in out.rglob("index.html")
        if "demo" not in p.relative_to(out).parts[:1]
    )
    pages = [p.replace("//", "/") for p in pages] + (["/demo/"] if args.demo else [])
    prio = lambda u: "1.0" if u == "/" else "0.9" if u in ("/descargar/", "/funciones/") else "0.8" if u.startswith("/funciones/") else "0.5"
    (out / "sitemap.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "".join(f"  <url><loc>{site}{u}</loc><lastmod>{today.isoformat()}</lastmod><priority>{prio(u)}</priority></url>\n" for u in pages)
        + "</urlset>\n",
        encoding="utf-8",
    )

    # Para asistentes de IA (https://llmstxt.org).
    (out / "llms.txt").write_text(llms(cfg, mods, tauri["version"], False), encoding="utf-8")
    (out / "llms-full.txt").write_text(llms(cfg, mods, tauri["version"], True), encoding="utf-8")

    # security.txt (RFC 9116): cómo avisar un problema de seguridad.
    wk = out / ".well-known"
    wk.mkdir(exist_ok=True)
    expires = (dt.datetime.combine(today, dt.time()) + dt.timedelta(days=330)).strftime("%Y-%m-%dT00:00:00Z")
    contact = f"mailto:{email}" if email else f"{repo}/security/advisories/new" if repo else f"{site}/privacidad/"
    (wk / "security.txt").write_text(
        f"Contact: {contact}\nExpires: {expires}\nPreferred-Languages: es, en\nCanonical: {site}/.well-known/security.txt\n",
        encoding="utf-8",
    )

    # Clave de IndexNow (Bing, Yandex y otros): el archivo demuestra que el sitio es nuestro.
    key = cfg.get("indexnow_key", "").strip()
    if key:
        if not re.fullmatch(r"[A-Za-z0-9-]{8,128}", key):
            print("indexnow_key no es válida")
            return 1
        (out / f"{key}.txt").write_text(key, encoding="utf-8")

    (out / "CNAME").write_text(cfg["cname"] + "\n")
    (out / ".nojekyll").write_text("")
    if leftovers or missing:
        print("Marcadores sin reemplazar:\n" + "\n".join(leftovers) if leftovers else "")
        print("Capturas que faltan:\n" + "\n".join(sorted(set(missing))) if missing else "")
        return 1
    print(f"Sitio construido en {out}: {len(pages)} páginas (instalador: {'sí' if installer else 'no'}, demo: {'sí' if args.demo else 'no'})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
