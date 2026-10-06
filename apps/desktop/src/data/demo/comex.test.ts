import { describe, expect, it } from "vitest";
import sql from "../../../../../crates/nucleo-db/migrations/0016_comex.sql?raw";
import incoterms from "./incoterms.json";
import { DemoBackend } from "./store";
import { addDays, todayIso } from "../../lib/format";

describe("demostración: COMEX", () => {
  it("la guía de Incoterms de la demo es la misma de la migración", () => {
    const rows = [...sql.matchAll(/\('(\w{3})', '2020', '([^']+)', json\('(\{.*?\})'\)/g)].map((m) => ({ code: m[1], name: m[2], content: JSON.parse(m[3]!) }));
    expect(rows).toHaveLength(11);
    expect(incoterms.map((i) => ({ code: i.code, name: i.name, content: i.content }))).toEqual(rows);
  });

  it("cotización → confirmada → costos reales → recibida → cerrada, con stock y Dinero", async () => {
    const b = new DemoBackend();
    const [prod] = await b.searchProducts("martillo");
    const stock0 = prod!.on_hand_milli;
    const [sup] = await b.searchSuppliers("ningbo");
    let d = await b.saveImport({
      supplier_uid: sup!.uid, incoterm: "FOB", transport_mode: "maritimo", origin_country: "China", origin_port: null, destination_port: null,
      currency_code: "USD", rate_e6: 950_000_000, purchase_date: null, production_eta: null, shipment_date: null, eta: addDays(todayIso(), 30), arrival_date: null,
      allocation_basis: "unidades", vat_ppm: 150_000, vat_recoverable: true, notes: null,
      items: [{ product_uid: prod!.uid, description: prod!.name, qty_milli: 100_000, unit_price_minor: 1_000, weight_g: 500, volume_cm3: null, duty_ppm: 50_000, hs_code: null }],
    });
    const cost = (kind: "flete" | "agente_aduana", amount: number, estimate: boolean, payment: "por_pagar" | null = null) => ({
      kind, description: null, supplier_uid: null, currency_code: "CLP", amount_minor: amount, rate_e6: null, is_estimate: estimate, recoverable_tax: false,
      allocation_basis: null, document_ref: null, cost_date: null, payment, due_date: null, paid_method: null, paid_account_uid: null,
    });
    d = await b.addImportCost(d.uid, cost("flete", 100_000, true));
    expect(d.calc.landed_clp).toBe(950_000 + 100_000 + 52_500);
    d = await b.setImportStage(d.uid, "ordenada");
    expect(d.estimated_landed_clp).toBe(1_102_500);
    await expect(b.changeImportEta(d.uid, addDays(todayIso(), 40))).rejects.toThrow(/por qué/);
    d = await b.changeImportEta(d.uid, addDays(todayIso(), 40), "Retraso naviera");
    expect((await b.productInventory(prod!.uid)).analysis!.in_purchase_milli).toBe(100_000);
    d = await b.addImportCost(d.uid, cost("agente_aduana", 50_000, false, "por_pagar"));
    expect((await b.moneyOverview()).payables.some((p) => p.link === `/comex/importacion/${d.uid}`)).toBe(true);
    await expect(b.closeImport(d.uid)).rejects.toThrow(/recibida/);
    d = await b.receiveImport(d.uid, [], todayIso());
    expect(d.stage).toBe("recibida");
    expect((await b.searchProducts("martillo"))[0]!.on_hand_milli).toBe(stock0 + 100_000);
    await expect(b.closeImport(d.uid)).rejects.toThrow(/estimados/);
    const flete = d.costs.find((c) => c.kind === "flete")!;
    d = await b.updateImportCost(d.uid, flete.id, cost("flete", 110_000, false));
    d = await b.closeImport(d.uid);
    expect(d.stage).toBe("cerrada");
    expect(d.timeline.at(-1)!.text).toMatch(/diferencia \+\$60\.500/);
    const k = (await b.productInventory(prod!.uid)).kardex[0]!;
    expect(k.source_type).toBe("IMP");
  });
});
