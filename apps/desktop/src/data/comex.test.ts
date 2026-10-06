import { describe, expect, it } from "vitest";
import { computeLanded, priceForMargin, type ComexScenario } from "./comex";

// Porcentajes de EJEMPLO (no normativos) para verificar la mecánica.
const base: ComexScenario = {
  name: "A", transport: "maritimo", transit_days: 30, rate_e6: 1_000_000_000, freight_cents: 10_000, insurance_cents: 0, insurance_ppm: 0,
  duty_ppm: 100_000, vat_ppm: 200_000, vat_recoverable: true, agent_clp: 50_000, port_clp: 0, inland_clp: 0, bank_clp: 0, other_clp: 0,
};
const items = [{ description: "A", qty: 10, fob_unit_cents: 9_000 }, { description: "B", qty: 30, fob_unit_cents: 1_000 }];

describe("costo de importación", () => {
  it("CIF, arancel, IVA y prorrateo por valor que cuadra al peso", () => {
    const r = computeLanded(items, base);
    expect(r.fob_cents).toBe(120_000); // USD 1.200
    expect(r.cif_cents).toBe(130_000); // + flete USD 100
    expect(r.cif_clp).toBe(1_300_000); // tipo de cambio 1.000
    expect(r.duty_clp).toBe(130_000);
    expect(r.vat_clp).toBe(286_000); // (1.300.000 + 130.000) × 20 %
    expect(r.landed_clp).toBe(1_480_000); // IVA recuperable: no suma
    expect(r.items.reduce((a, i) => a + i.landed_total_clp, 0)).toBe(r.landed_clp);
    expect(r.items[0]!.landed_unit_clp).toBe(111_000); // 75 % del costo / 10 unidades
  });
  it("IVA no recuperable suma al costo", () => {
    expect(computeLanded(items, { ...base, vat_recoverable: false }).landed_clp).toBe(1_766_000);
  });
  it("precio para un margen sobre la venta", () => {
    expect(priceForMargin(65_000, 350_000)).toBe(100_000);
  });
});
