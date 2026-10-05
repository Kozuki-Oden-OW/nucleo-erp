#!/usr/bin/env python3
"""Rechaza literales normativos en el código fuente (Blueprint §18, criterio 8).

Busca patrones típicos de tasas tributarias o previsionales escritas a mano en código de
producción. Las pruebas pueden usar tasas de EJEMPLO (que no coinciden con valores reales).
Si se necesita una excepción legítima, agregar el comentario `normativa-ok` en la línea.
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SOURCES = [*ROOT.glob("crates/*/src/**/*.rs"), *ROOT.glob("apps/desktop/src-tauri/src/**/*.rs"),
           *ROOT.glob("apps/desktop/src/**/*.ts"), *ROOT.glob("apps/desktop/src/**/*.tsx")]
PATTERNS = [
    re.compile(r"\b0[.,]19\b"),            # tasa general de IVA escrita a mano
    re.compile(r"\b19\s*%"),
    re.compile(r"dec!\(\s*0?\.19\s*\)"),
    re.compile(r"\b1[.,]19\b"),            # factor neto→bruto
]

def main() -> int:
    problems = []
    for path in SOURCES:
        for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if "normativa-ok" in line:
                continue
            if any(p.search(line) for p in PATTERNS):
                problems.append(f"{path.relative_to(ROOT)}:{n}: {line.strip()}")
    if problems:
        print("Valores normativos escritos en el código (deben venir de nucleo-rules):")
        print("\n".join(problems))
        return 1
    print(f"OK: {len(SOURCES)} archivos revisados, sin valores normativos en el código.")
    return 0

if __name__ == "__main__":
    sys.exit(main())
