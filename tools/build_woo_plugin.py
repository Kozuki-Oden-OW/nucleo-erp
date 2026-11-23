#!/usr/bin/env python3
"""Arma el .zip instalable del plugin «NÚCLEO ERP para WooCommerce».

Uso:
    python3 tools/build_woo_plugin.py [--out dist-plugin]

Lee la versión de la cabecera del plugin, revisa que coincida con `readme.txt` y con la constante
`NUCLEO_ERP_VERSION`, y deja `nucleo-erp-<versión>.zip` con la carpeta `nucleo-erp/` adentro (como lo
espera WordPress). Las fechas de los archivos son fijas para que el zip sea reproducible.
"""
import argparse
import pathlib
import re
import sys
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "integraciones" / "woocommerce" / "nucleo-erp"
FILES = ["nucleo-erp.php", "uninstall.php", "readme.txt"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="dist-plugin")
    args = ap.parse_args()
    main_php = (SRC / "nucleo-erp.php").read_text(encoding="utf-8")
    readme = (SRC / "readme.txt").read_text(encoding="utf-8")
    header = re.search(r"^\s*\*\s*Version:\s*(\S+)", main_php, re.M)
    const = re.search(r"define\(\s*'NUCLEO_ERP_VERSION',\s*'([^']+)'", main_php)
    stable = re.search(r"^Stable tag:\s*(\S+)", readme, re.M)
    versions = {m.group(1) if m else None for m in (header, const, stable)}
    if len(versions) != 1 or None in versions:
        print(f"ERROR: la versión no coincide (cabecera, constante y readme): {versions}", file=sys.stderr)
        return 1
    version = versions.pop()
    out = ROOT / args.out
    out.mkdir(parents=True, exist_ok=True)
    target = out / f"nucleo-erp-{version}.zip"
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as z:
        for name in FILES:
            info = zipfile.ZipInfo(f"nucleo-erp/{name}", date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            z.writestr(info, (SRC / name).read_bytes())
    print(f"OK: {target.relative_to(ROOT)} ({target.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
