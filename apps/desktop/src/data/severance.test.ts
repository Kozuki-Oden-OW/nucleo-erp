import { describe, expect, it } from "vitest";
import golden from "../../../../golden/finiquito.json";
import { computeSeverance, type SeveranceInput } from "./severance";

describe("Finiquito: mismo cálculo que Rust (golden/finiquito.json)", () => {
  for (const c of golden.casos) {
    it(c.nombre, () => {
      const r = computeSeverance(c.input as unknown as SeveranceInput);
      const e = c.esperado as unknown as Record<string, number> & { lines: Record<string, number>; service: number[] };
      expect(r.complete).toBe(true);
      for (const k of ["total_earnings", "total_deductions", "to_pay", "ias_years", "capped_base", "vacation_business_days_e2", "vacation_calendar_days_e2"] as const)
        expect([k, r[k]]).toEqual([k, e[k]]);
      expect([r.service_years, r.service_months, r.service_days]).toEqual(e.service);
      const all = [...r.earnings, ...r.deductions];
      expect(all.length).toBe(Object.keys(e.lines).length);
      for (const [k, v] of Object.entries(e.lines)) expect([k, all.filter((l) => l.key === k).reduce((a, l) => a + l.amount, 0)]).toEqual([k, v]);
    });
  }
});
