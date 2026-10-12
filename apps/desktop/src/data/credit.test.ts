import { describe, expect, it } from "vitest";
import { buildCredit, creditWarning } from "./credit";
import type { Customer } from "./types";

const base: Customer = {
  id: 1, uid: "cli_1", rut: "76123456-0", name: "Ferretería Sur SpA", email: null, phone: null, created_at: "2026-01-01T00:00:00Z",
  kind: "empresa", trade_name: null, business_activity: "Ferretería", address: null, commune: null, city: null, region: null,
  contact_name: null, invoice_email: null, payment_terms_days: 30, credit_limit_minor: 1_000_000, notes: null,
  credit_enabled: true, credit_conditions: null, preferred: false,
};
const fmt = (n: number) => `$${n}`;

describe("crédito a clientes", () => {
  it("cuenta respaldos, detecta documentos antiguos y aconseja", () => {
    const c = buildCredit(base, [
      { kind: "carpeta_tributaria", status: "verificado", attachment_uid: "doc_1", file_name: "carpeta.pdf", issued_on: "2026-09-20", verified_on: "2026-09-21", note: null },
      { kind: "vigencia", status: "recibido", attachment_uid: null, file_name: null, issued_on: "2026-08-01", verified_on: null, note: null },
      { kind: "poderes", status: "no_aplica", attachment_uid: null, file_name: null, issued_on: null, verified_on: null, note: null },
    ], 1_200_000, 50_000, "2026-10-12");
    expect(c.docs).toHaveLength(7);
    expect(c.docs_ready).toBe(2);
    expect(c.docs_applicable).toBe(5); // 6 sin «otro», menos poderes (no aplica)
    expect(c.docs.find((d) => d.kind === "vigencia")!.stale).toBe(true);
    expect(c.docs.find((d) => d.kind === "carpeta_tributaria")!.stale).toBe(false);
    expect(c.available_minor).toBe(-200_000);
    expect(c.advice.some((a) => a.includes("supera el cupo"))).toBe(true);
    expect(c.advice.some((a) => a.includes("vencidos"))).toBe(true);
    expect(c.advice.some((a) => a.includes("sin verificar"))).toBe(true);
  });

  it("una persona no necesita documentos de sociedad", () => {
    const c = buildCredit({ ...base, kind: "persona", credit_limit_minor: null }, [], 0, 0, "2026-10-12");
    expect(c.docs_applicable).toBe(3);
    expect(c.advice[0]).toContain("alguien de confianza");
    expect(c.advice.some((a) => a.includes("No tiene cupo"))).toBe(true);
  });

  it("avisa sin bloquear al vender a crédito", () => {
    const c = buildCredit(base, [], 900_000, 0, "2026-10-12");
    expect(creditWarning(c, 50_000, fmt)).toBeNull();
    expect(creditWarning(c, 200_000, fmt)).toContain("su cupo es $1000000");
    expect(creditWarning({ ...c, enabled: false }, 1, fmt)).toContain("no tiene crédito habilitado");
    expect(creditWarning(null, 1, fmt)).toBeNull();
  });
});
