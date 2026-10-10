import { describe, expect, it } from "vitest";
import golden from "../../../../golden/lre.json";
import { buildLre, lreAfpCode, lreFileName, lreHealthCode, type LreRow } from "./lre";

describe("LRE: mismo archivo que Rust (golden/lre.json)", () => {
  for (const c of golden.casos) it(c.nombre, () => expect(buildLre(c.rows as unknown as LreRow[])).toBe(c.esperado));
  it("códigos y nombre", () => {
    expect(lreFileName("76.543.210-3", "2026-09")).toBe("765432103_202609.csv");
    expect(lreAfpCode("PlanVital")).toBe(11);
    expect(lreHealthCode("isapre", "Banmédica")).toBe(3);
  });
});
