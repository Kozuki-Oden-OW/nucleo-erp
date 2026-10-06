import { describe, expect, it } from "vitest";
import { DemoBackend } from "./store";

describe("demostración: ciclo de venta completo sin re-digitar", () => {
  it("COT → venta → efectuada a crédito → abono → pago → documentada → cerrada", async () => {
    const b = new DemoBackend();
    const [cust] = await b.searchCustomers("constructora");
    const [prod] = await b.searchProducts("taladro 18");
    const stock0 = prod!.on_hand_milli;
    const q = await b.saveQuote({ customer_uid: cust!.uid, issue_date: "2026-10-05", valid_until: null, lines: [
      { product_uid: prod!.uid, description: prod!.name, qty_milli: 2000, unit_price_minor: prod!.price_minor, discount_ppm: 0, taxable: true },
    ] });
    expect(q.number).toMatch(/^COT-\d{6}$/);
    await b.setQuoteStatus(q.uid, "aceptada");
    let s = await b.convertQuote(q.uid);
    expect(s.lines[0]!.qty_milli).toBe(2000);
    expect(s.chain.map((c) => c.kind)).toEqual(["COT", "VEN"]);
    s = await b.effectSale(s.uid, { mode: "credito", method: "", due_date: "2026-11-05" });
    expect(s.commercial_state).toBe("efectuada");
    expect(s.documentation_state).toBe("pendiente");
    expect((await b.searchProducts("taladro 18"))[0]!.on_hand_milli).toBe(stock0 - 2000);
    s = await b.registerPayment(s.uid, 1000, "Transferencia", "2026-10-06");
    expect(s.payment_state).toBe("abonada");
    s = await b.registerPayment(s.uid, s.total_minor - 1000, "Transferencia", "2026-10-07");
    expect(s.payment_state).toBe("pagada");
    expect(s.commercial_state).toBe("efectuada"); // sigue pendiente de documentación
    s = await b.markDocumented(s.uid, { doc_kind: "Factura", external_number: "563" });
    expect(s.commercial_state).toBe("cerrada");
    expect(s.chain.at(-1)!.number).toBe("Factura Nº 563");
    await expect(b.convertQuote(q.uid)).rejects.toThrow(/ya se convirtió/);
  });
  it("anular devuelve el stock y exige motivo", async () => {
    const b = new DemoBackend();
    const [prod] = await b.searchProducts("martillo");
    const s0 = await b.saveSale({ doc_type: "FV", customer_uid: null, issue_date: "2026-10-05", lines: [
      { product_uid: prod!.uid, description: prod!.name, qty_milli: 3000, unit_price_minor: prod!.price_minor, discount_ppm: 0, taxable: true },
    ] });
    expect(s0.number).toMatch(/^FV-/);
    await b.effectSale(s0.uid, { mode: "contado", method: "Efectivo", due_date: null });
    await expect(b.voidSale(s0.uid, " ")).rejects.toThrow(/motivo/);
    const v = await b.voidSale(s0.uid, "Error de digitación");
    expect(v.commercial_state).toBe("anulada");
    expect((await b.searchProducts("martillo"))[0]!.on_hand_milli).toBe(prod!.on_hand_milli);
  });
  it("venta a crédito requiere cliente", async () => {
    const b = new DemoBackend();
    const s = await b.saveSale({ doc_type: "VEN", customer_uid: null, issue_date: "2026-10-05", lines: [{ product_uid: null, description: "Servicio", qty_milli: 1000, unit_price_minor: 1000, discount_ppm: 0, taxable: true }] });
    await expect(b.effectSale(s.uid, { mode: "credito", method: "", due_date: "2026-11-01" })).rejects.toThrow(/cliente/);
  });
});
