#!/usr/bin/env python3
"""Arma la extensión de NÚCLEO para la app de Claude (NucleoERP.mcpb).

Copia la lista de herramientas de la interfaz (apps/desktop/src/agent/tools.json), pone la versión de
package.json en el manifiesto y empaqueta la carpeta tools/claude-extension como .mcpb (un zip).

Uso: python3 tools/build_claude_extension.py [--out carpeta]
"""
import argparse
import json
import pathlib
import shutil
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
EXT = ROOT / "tools" / "claude-extension"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "dist-extension"))
    ap.add_argument("--version", help="versión de la extensión (por defecto, la de package.json)")
    args = ap.parse_args()
    out = pathlib.Path(args.out)

    tools = json.loads((ROOT / "apps/desktop/src/agent/tools.json").read_text(encoding="utf-8"))
    version = args.version or json.loads((ROOT / "apps/desktop/package.json").read_text(encoding="utf-8"))["version"]
    shutil.copy(ROOT / "apps/desktop/src/agent/tools.json", EXT / "server" / "tools.json")
    shutil.copy(ROOT / "apps/desktop/src-tauri/icons/icon.png", EXT / "icon.png")

    manifest_path = EXT / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["version"] = version
    manifest["tools"] = [{"name": t["name"], "description": t["description"][:200]} for t in tools]
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    out.mkdir(parents=True, exist_ok=True)
    target = out / "NucleoERP.mcpb"
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as z:
        for f in ("manifest.json", "icon.png", "server/index.js", "server/tools.json"):
            z.write(EXT / f, f)
    print(f"Extensión {version} con {len(tools)} herramientas: {target}")


if __name__ == "__main__":
    main()
