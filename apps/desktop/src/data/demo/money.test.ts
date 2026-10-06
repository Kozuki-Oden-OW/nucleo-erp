import { describe, expect, it } from "vitest";
import { DemoBackend } from "./store";
import { occurrences } from "./money";
import { addDays, todayIso } from "../../lib/format";

describe("demostración: Dinero", () => {
  it("los recurrentes mensuales respetan el último día del mes", () => {
    const r = { frequency: "mensual" as const, starts_on: "2026-01-31", ends_on: null, day_of_period: 31 };
    expect(occurrences(r, "2026-01-01", "2026-04-30")).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(occurrences({ ...r, frequency: "semanal", starts_on: "2026-03-02" }, "2026-03-10", "2026-03-25")).toEqual(["2026-03-16", "2026-03-23"]);
  });

  it("gasto por pagar → abono → pago final mueve la cuenta elegida; anular devuelve el dinero", async () => {
    const b = new DemoBackend();
    const t = todayIso();
    const [banco] = (await b.moneyAccounts()).filter((a) => a.kind === "banco");
    const cats = await b.expenseCategories();
    const luz = cats.find((c) => c.name === "Electricidad")!;
    let g = await b.registerExpense({ category_id: luz.id, supplier_uid: null, date: t, description: "Luz bodega", total_minor: 119_000, tax_included: true, due_date: addDays(t, 10), paid_method: null, paid_account_uid: null, recurring_id: null });
    expect(g.payment_state).toBe("por_pagar");
    expect(g.net_minor + g.tax_minor).toBe(119_000);
    expect(g.net_minor).toBe(100_000);
    const ov = await b.moneyOverview();
    expect(ov.payables.some((p) => p.link === `/dinero/gasto/${g.uid}`)).toBe(true);
    g = await b.payExpense(g.uid, 19_000, "Transferencia", t, banco!.uid);
    expect(g.payment_state).toBe("abonado");
    g = await b.payExpense(g.uid, 100_000, "Transferencia", t, banco!.uid);
    expect(g.payment_state).toBe("pagado");
    const after = (await b.moneyAccounts()).find((a) => a.uid === banco!.uid)!;
    expect(after.balance_minor).toBe(banco!.balance_minor - 119_000);
    const ledger = await b.accountLedger(banco!.uid);
    expect(ledger.filter((l) => l.detail.includes("Luz bodega")).map((l) => l.amount_minor)).toEqual([-100_000, -19_000]);
    expect(ledger.every((l) => l.date <= t)).toBe(true);
    await expect(b.voidExpense(g.uid, " ")).rejects.toThrow(/motivo/);
    g = await b.voidExpense(g.uid, "Error de digitación");
    expect(g.payment_state).toBe("anulado");
    expect((await b.moneyAccounts()).find((a) => a.uid === banco!.uid)!.balance_minor).toBe(banco!.balance_minor);
  });

  it("traspaso entre cuentas conserva el total y el resumen proyecta 13 semanas", async () => {
    const b = new DemoBackend();
    const before = await b.moneyOverview();
    const [caja, banco] = [before.accounts.find((a) => a.kind === "caja")!, before.accounts.find((a) => a.kind === "banco")!];
    const accs = await b.transferMoney({ from_uid: banco.uid, to_uid: caja.uid, date: todayIso(), amount_minor: 50_000 });
    expect(accs.find((a) => a.uid === caja.uid)!.balance_minor).toBe(caja.balance_minor + 50_000);
    const ov = await b.moneyOverview();
    expect(ov.cash_minor).toBe(before.cash_minor);
    expect(ov.projection).toHaveLength(13);
    expect(ov.projection[0]!.opening_minor).toBe(ov.cash_minor);
    await expect(b.archiveMoneyAccount(caja.uid)).rejects.toThrow(/saldo cero/);
    await expect(b.createMoneyAccount({ kind: "banco", name: "Otra", account_label: "123456789012", opening_minor: 0 })).rejects.toThrow(/4 dígitos/);
  });

  it("el cobro de una venta entra a la cuenta según el medio", async () => {
    const b = new DemoBackend();
    const [prod] = await b.searchProducts("martillo");
    const caja0 = (await b.moneyAccounts()).find((a) => a.kind === "caja")!;
    const s = await b.saveSale({ doc_type: "VEN", customer_uid: null, issue_date: todayIso(), lines: [
      { product_uid: prod!.uid, description: prod!.name, qty_milli: 1000, unit_price_minor: prod!.price_minor, discount_ppm: 0, taxable: true },
    ] });
    const done = await b.effectSale(s.uid, { mode: "contado", method: "Efectivo", due_date: null });
    expect((await b.moneyAccounts()).find((a) => a.uid === caja0.uid)!.balance_minor).toBe(caja0.balance_minor + done.total_minor);
    const d = await b.dashboard();
    expect(d.cash_minor).toBe((await b.moneyOverview()).cash_minor);
  });
});
