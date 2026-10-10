import { describe, expect, it } from "vitest";
import golden from "../../../../golden/costo.json";
import { computeCostSheet, grossFromNet, netFromGross, type CostSheet } from "./costing";

describe("hoja de costo (golden/costo.json)", () => {
  for (const c of golden.casos) {
    it(c.nombre, () => {
      const r = computeCostSheet(c.input as CostSheet, c.tax_ppm);
      const { notes: _n, ...nums } = r;
      expect(nums).toEqual(c.esperado);
    });
  }
  it("precio neto o con IVA", () => {
    for (const p of golden.precios) {
      const n = netFromGross(p.con_iva, p.tax_ppm);
      expect(n).toBe(p.neto);
      expect(grossFromNet(n, p.tax_ppm)).toBe(p.con_iva_desde_neto);
    }
  });
});
