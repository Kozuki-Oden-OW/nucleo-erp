import { describe, expect, it } from "vitest";
import golden from "../../../../golden/comex.json";
import { allocate, exportMargin, landedCost, toClp, type ExportInput, type LandedInput } from "./comex";

describe("COMEX: mismo cálculo que Rust (golden/comex.json)", () => {
  for (const c of golden.importaciones) {
    it(c.nombre, () => {
      const r = landedCost(c.input as LandedInput);
      const e = c.esperado;
      expect([r.customs_value_clp, r.duty_clp, r.vat_clp, r.recoverable_clp, r.landed_clp]).toEqual([e.customs_value_clp, e.duty_clp, e.vat_clp, e.recoverable_clp, e.landed_clp]);
      expect(r.items.map((x) => [x.landed_clp, x.unit_cost_e4])).toEqual(e.items.map((x) => [x.landed_clp, x.unit_cost_e4]));
      expect(r.items.reduce((a, x) => a + x.landed_clp, 0)).toBe(r.landed_clp);
    });
  }
  for (const c of golden.exportaciones) {
    it(c.nombre, () => {
      const r = exportMargin(c.input as ExportInput);
      const e = c.esperado;
      expect([r.revenue_clp, r.goods_cost_clp, r.profit_clp, r.margin_ppm, r.breakeven_revenue_clp]).toEqual([e.revenue_clp, e.goods_cost_clp, e.profit_clp, e.margin_ppm, e.breakeven_revenue_clp]);
    });
  }
  it("reparto exacto y conversión con redondeo", () => {
    expect(allocate(100_000, [100_000n, 50_000n])).toEqual([66_667, 33_333]);
    expect(allocate(10, [1n, 1n, 1n])).toEqual([4, 3, 3]);
    expect(allocate(7, [0n, 0n])).toEqual([4, 3]);
    expect(toClp(1_050, 2, 950_500_000)).toBe(9_980);
  });
});
