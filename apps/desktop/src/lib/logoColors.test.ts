import { describe, expect, it } from "vitest";
import { paletteFromPixels } from "./logoColors";

/** Imagen RGBA de prueba: una lista de [color, cantidad de píxeles]. */
function pixels(parts: [[number, number, number, number], number][]): number[] {
  return parts.flatMap(([c, k]) => Array.from({ length: k }, () => c).flat());
}

describe("colores del logo", () => {
  it("logo azul y amarillo: el azul (más oscuro) es el principal y el amarillo el secundario", () => {
    const p = paletteFromPixels(pixels([[[253, 199, 1, 255], 700], [[10, 81, 164, 255], 300], [[0, 0, 0, 0], 2000], [[255, 255, 255, 255], 500]]));
    expect(p).toEqual({ primary: "#0a51a4", secondary: "#fdc701" });
  });

  it("los bordes suavizados no cambian el resultado", () => {
    const p = paletteFromPixels(pixels([[[253, 199, 1, 255], 600], [[250, 190, 20, 255], 60], [[10, 81, 164, 255], 300], [[30, 95, 170, 255], 30], [[128, 128, 128, 255], 400]]));
    expect(p?.secondary).toMatch(/^#f[a-f]c[0-9a-f]0[0-9a-f]$/);
    expect(p?.primary).toMatch(/^#0[a-f]5[0-9a-f]a[0-9a-f]$/);
  });

  it("un solo color: no hay secundario; una mancha mínima de otro color no cuenta", () => {
    expect(paletteFromPixels(pixels([[[192, 40, 79, 255], 500]]))).toEqual({ primary: "#c0284f", secondary: null });
    expect(paletteFromPixels(pixels([[[192, 40, 79, 255], 990], [[10, 81, 164, 255], 10]]))?.secondary).toBeNull();
  });

  it("logo en blanco y negro o transparente: no propone colores", () => {
    expect(paletteFromPixels(pixels([[[0, 0, 0, 255], 300], [[255, 255, 255, 255], 300], [[90, 90, 90, 255], 100]]))).toBeNull();
    expect(paletteFromPixels(pixels([[[10, 81, 164, 0], 500]]))).toBeNull();
    expect(paletteFromPixels([])).toBeNull();
  });
});
