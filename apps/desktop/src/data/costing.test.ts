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

describe("ganancia sobre el costo", () => {
  it("ejemplo del usuario: con IVA $39.000, neto $32.773, costo $17.575 → 86,475 % (86,48 % redondeado)", async () => {
    const { gainOverCost, pctText, netFromGross, grossFromNet } = await import("./costing");
    const net = netFromGross(39_000, 190_000);
    expect(net).toBe(32_773);
    expect(grossFromNet(net, 190_000)).toBe(39_000);
    expect(pctText(gainOverCost(net, 17_575)!, 2)).toBe("86,48 %");
    expect(pctText(gainOverCost(net, 17_575)!, 3)).toBe("86,475 %");
    expect(gainOverCost(1000, 0)).toBeNull();
  });
});
