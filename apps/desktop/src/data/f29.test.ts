import { describe, expect, it } from "vitest";
import golden from "../../../../golden/f29.json";
import { computeF29, type F29Input } from "./f29";

describe("F29: mismo cálculo que Rust (golden/f29.json)", () => {
  for (const c of golden.casos) {
    it(c.nombre, () => {
      const r = computeF29(c.input as F29Input);
      const e = c.esperado as unknown as { codes: Record<string, number>; absent?: number[]; complete: boolean };
      for (const [k, v] of Object.entries(e.codes)) expect([k, r.codes[k] ?? 0]).toEqual([k, v]);
      for (const a of e.absent ?? []) expect(r.codes[String(a)]).toBeUndefined();
      expect(r.complete).toBe(e.complete);
    });
  }
});
