import { describe, expect, it } from "vitest";
import golden from "../../../../golden/remuneraciones.json";
import { computePayslip, pct, type PayslipInput, type PayslipResult } from "./payroll";

const line = (r: PayslipResult, key: string) =>
  [...r.taxable_earnings, ...r.legal_deductions, ...r.employer].filter((l) => l.key === key).reduce((a, l) => a + l.amount, 0);

describe("Liquidación: mismo cálculo que Rust (golden/remuneraciones.json)", () => {
  for (const c of golden.casos) {
    it(c.nombre, () => {
      const r = computePayslip(c.input as unknown as PayslipInput);
      const e = c.esperado as unknown as Record<string, number> & { employer_lines: Record<string, number> };
      expect(r.complete).toBe(true);
      const got: Record<string, number> = {
        total_taxable: r.total_taxable, pension_base: r.pension_base, afc_base: r.afc_base,
        afp: line(r, "afp"), salud: line(r, "salud"), salud_adicional: line(r, "salud_adicional"), afc: line(r, "afc"),
        horas_extra: line(r, "horas_extra"), gratificacion: line(r, "gratificacion"), tax_base: r.tax_base, tax: r.tax,
        tax_bracket: r.tax_bracket, total_earnings: r.total_earnings, total_deductions: r.total_deductions, net: r.net,
        to_pay: r.to_pay, employer_total: r.employer_total, employer_cost: r.employer_cost,
      };
      for (const [k, v] of Object.entries(got)) expect([k, v]).toEqual([k, e[k]]);
      for (const [k, v] of Object.entries(e.employer_lines)) expect([k, line(r, k)]).toEqual([k, v]);
    });
  }
  it("textos de tasas", () => {
    expect(pct(114_400)).toBe("11,44 %");
    expect(pct(300)).toBe("0,03 %");
  });
  it("sin indicadores avisa lo que falta", () => {
    const r = computePayslip({ params: {}, worker: { owner_salary: true, contract: "sin_contrato", afp_ppm: 104_600 }, base_salary: 1_000_000 });
    expect(r.complete).toBe(false);
    expect(r.cap_pension).toBe(0);
    expect(r.notes.some((n) => n.text.includes("UTM"))).toBe(true);
  });
});
