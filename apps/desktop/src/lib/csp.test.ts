// El programa de escritorio solo deja mostrar imágenes propias o «data:» (política de seguridad en
// tauri.conf.json). Una imagen «blob:» carga en el navegador de la demostración pero falla en el
// escritorio: así se rompió la subida del logo (24-11-2026). Las descargas de la demostración sí
// usan «blob:», pero como enlace, no como imagen.
import { describe, expect, it } from "vitest";
import conf from "../../src-tauri/tauri.conf.json";

const sources = import.meta.glob<string>("../**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true });

describe("política de seguridad del escritorio", () => {
  it("las pantallas no cargan imágenes desde direcciones blob:", () => {
    const files = Object.keys(sources);
    expect(files.length).toBeGreaterThan(100);
    const offenders = files.filter((p) => !/\.test\.tsx?$/.test(p) && !p.includes("/data/demo/") && sources[p]!.includes("createObjectURL"));
    expect(offenders).toEqual([]);
  });

  it("la política sigue sin permitir blob: en imágenes", () => {
    const csp: string = conf.app.security.csp;
    expect(csp).toContain("img-src 'self' data:");
    expect(csp).not.toContain("blob:");
  });
});
