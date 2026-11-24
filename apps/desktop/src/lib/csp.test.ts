// El programa de escritorio solo deja mostrar imágenes propias o «data:» (política de seguridad en
// tauri.conf.json). Una imagen «blob:» carga en el navegador de la demostración pero falla en el
// escritorio: así se rompió la subida del logo (24-11-2026). Las descargas de la demostración sí
// usan «blob:», pero como enlace, no como imagen.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}

describe("política de seguridad del escritorio", () => {
  it("las pantallas no cargan imágenes desde direcciones blob:", () => {
    const root = join(__dirname, "..");
    const offenders = sources(root).filter((p) => !p.includes(join("data", "demo"))).filter((p) => readFileSync(p, "utf8").includes("createObjectURL"));
    expect(offenders.map((p) => p.slice(root.length + 1))).toEqual([]);
  });

  it("la política sigue sin permitir blob: en imágenes", () => {
    const conf = JSON.parse(readFileSync(join(__dirname, "..", "..", "src-tauri", "tauri.conf.json"), "utf8")) as { app: { security: { csp: string } } };
    expect(conf.app.security.csp).toContain("img-src 'self' data:");
    expect(conf.app.security.csp).not.toContain("blob:");
  });
});
