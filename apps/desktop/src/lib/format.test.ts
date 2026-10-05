import { describe, expect, it } from "vitest";
import { formatBytes, formatCLP, formatRut } from "./format";

describe("formatos chilenos", () => {
  it("formatea pesos sin decimales", () => {
    expect(formatCLP(1234567).replace(/\s/g, " ")).toMatch(/1\.234\.567/);
  });
  it("formatea RUT con puntos", () => {
    expect(formatRut("12345678-5")).toBe("12.345.678-5");
    expect(formatRut("1000000-K")).toBe("1.000.000-K");
    expect(formatRut(null)).toBe("—");
  });
  it("formatea tamaños", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2,0 KB");
  });
});
