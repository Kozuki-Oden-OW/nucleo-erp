import { describe, expect, it } from "vitest";
import { computeTotals, lineAmounts } from "./calc";

const line = (qty_milli: number, unit_price_minor: number, discount_ppm = 0, taxable = true) =>
  ({ product_uid: null, description: "x", qty_milli, unit_price_minor, discount_ppm, taxable });

// Tasas de EJEMPLO (no normativas): 10 % para probar la mecánica de cálculo.
const EJEMPLO_PPM = 100_000;

describe("vista previa de totales", () => {
  it("multiplica cantidad decimal y redondea mitad hacia arriba", () => {
    expect(lineAmounts(line(2500, 1999))).toEqual({ gross: 4998, discount: 0, net: 4998 });
    expect(lineAmounts(line(1500, 3))).toEqual({ gross: 5, discount: 0, net: 5 }); // 4,5 → 5
  });
  it("aplica descuento porcentual sobre el bruto de la línea", () => {
    expect(lineAmounts(line(3000, 64_990, 50_000))).toEqual({ gross: 194_970, discount: 9_749, net: 185_221 });
  });
  it("calcula impuesto por documento solo sobre lo afecto", () => {
    const t = computeTotals([line(1000, 10_000), line(1000, 5_000, 0, false)], EJEMPLO_PPM);
    expect(t).toEqual({ net_minor: 10_000, exempt_minor: 5_000, discount_minor: 0, tax_minor: 1_000, total_minor: 16_000 });
  });
  it("sin impuesto activo, todo queda como subtotal sin impuesto", () => {
    const t = computeTotals([line(2000, 7_490)], null);
    expect(t).toEqual({ net_minor: 0, exempt_minor: 14_980, discount_minor: 0, tax_minor: 0, total_minor: 14_980 });
  });
});
