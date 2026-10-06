#!/usr/bin/env python3
"""Construye el sitio www.nucleoerp.cl (apps/web) en una carpeta lista para publicar.

Uso:
    python3 tools/build_web.py --out dist-web [--installer ruta/NucleoERPSetup.exe] [--demo apps/desktop/dist-demo]

- Reemplaza los marcadores {{...}} con site.config.json y los datos de la versión.
- Con --installer copia el instalador a /descargas/NucleoERPSetup.exe y publica su
  tamaño y SHA-256. Sin --installer, la página de descarga muestra "muy pronto".
- Con --demo copia la demostración navegable (la interfaz del escritorio con datos ficticios,
  construida con `pnpm build:demo`) en /demo/.
- Falla si queda algún marcador sin reemplazar.
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
TEXT_EXT = {".html", ".xml", ".txt", ".css", ".json"}


def human_size(n: int) -> str:
    return f"{n / (1024 * 1024):.1f} MB".replace(".", ",")


def conditional(text: str, name: str, keep_if: bool) -> str:
    pattern = re.compile(
        rf"<!--IF:{name}-->\n?(.*?)<!--ELSE:{name}-->\n?(.*?)<!--END:{name}-->\n?", re.S
    )
    return pattern.sub(lambda m: m.group(1) if keep_if else m.group(2), text)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--installer")
    ap.add_argument("--demo")
    args = ap.parse_args()

    cfg = json.loads((WEB / "site.config.json").read_text(encoding="utf-8"))
    tauri = json.loads((ROOT / "apps/desktop/src-tauri/tauri.conf.json").read_text(encoding="utf-8"))
    today = dt.date.today().isoformat()

    out = pathlib.Path(args.out).resolve()
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(WEB, out, ignore=shutil.ignore_patterns("site.config.json", "README.md"))

    installer = pathlib.Path(args.installer) if args.installer else None
    values = {
        "SITE_URL": cfg["site_url"].rstrip("/"),
        "VERSION": tauri["version"],
        "STAGE_LABEL": html.escape(cfg["stage_label"]),
        "STAGE_NOTE": html.escape(cfg["stage_note"]),
        "BUILD_DATE": today,
        "RELEASE_DATE": today,
        "SIZE": "—",
        "SHA256": "—",
    }
    if installer:
        data = installer.read_bytes()
        values["SIZE"] = human_size(len(data))
        values["SHA256"] = hashlib.sha256(data).hexdigest()
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
    values["REPO_TEXT"] = (f'<a href="{html.escape(repo)}">Ver el código fuente</a>.' if repo
                           else "El código se publicará junto con la primera versión.")
    values["REPO_FOOTER_LINK"] = f'<a href="{html.escape(repo)}">Código fuente</a>' if repo else ""
    donation = cfg.get("donation_url", "").strip()
    values["DONATION_TEXT"] = (f'<a href="{html.escape(donation)}">apoyar NÚCLEO</a>.' if donation
                               else "muy pronto publicaremos cómo hacerlo.")
    email = cfg.get("contact_email", "").strip()
    values["CONTACT_TEXT"] = (f'Escríbenos a <a href="mailto:{html.escape(email)}">{html.escape(email)}</a>.'
                              if email else "Pronto publicaremos un correo de contacto.")

    leftovers = []
    for f in out.rglob("*"):
        if f.suffix not in TEXT_EXT or not f.is_file() or "demo" in f.relative_to(out).parts[:1]:
            continue
        text = f.read_text(encoding="utf-8")
        text = conditional(text, "INSTALLER", installer is not None)
        for k, v in values.items():
            text = text.replace("{{" + k + "}}", v)
        f.write_text(text, encoding="utf-8")
        leftovers += [f"{f.relative_to(out)}: {m}" for m in re.findall(r"\{\{[A-Z_]+\}\}", text)]
    (out / "CNAME").write_text(cfg["cname"] + "\n")
    (out / ".nojekyll").write_text("")
    if leftovers:
        print("Marcadores sin reemplazar:\n" + "\n".join(leftovers))
        return 1
    print(f"Sitio construido en {out} (instalador: {'sí' if installer else 'no'}, demo: {'sí' if args.demo else 'no'})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
