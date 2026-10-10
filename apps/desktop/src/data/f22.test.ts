import { describe, expect, it } from "vitest";
import golden from "../../../../golden/f22.json";
import { computeF22, type F22Input } from "./f22";

describe("F22: mismo cálculo que Rust (golden/f22.json)", () => {
  for (const c of golden.casos) {
    it(c.nombre, () => {
      const r = computeF22(c.input as unknown as F22Input);
      expect(r.complete).toBe(true);
      expect(r.idpc_gross).toBe(c.esperado.idpc_gross);
      const exp = c.esperado.codes as unknown as Record<string, number>;
      for (const [k, v] of Object.entries(exp)) expect([k, r.codes[k]]).toEqual([k, v]);
      for (const [k, v] of Object.entries(r.codes)) if (!(k in exp)) expect([k, v]).toEqual([k, 0]);
    });
  }
});
