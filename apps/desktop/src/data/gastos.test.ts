import { describe, expect, it } from "vitest";
import { DEFAULT_SPLIT, breakEven, lineTotal, monthlyEquivalent, plan, project, runwayMonths, split } from "./gastos";

describe("gastos", () => {
  it("punto de equilibrio", () => {
    // Gastos $1.000.000 con 25 % de margen sobre la venta: hay que vender $4.000.000 netos.
    expect(breakEven(1_000_000, 250_000)).toBe(4_000_000);
    expect(breakEven(100, 300_000)).toBe(334);
    expect(breakEven(1_000, 0)).toBeNull();
  });
  it("cantidad × valor", () => {
    expect(lineTotal(40_000, 1_290)).toBe(51_600);
    expect(lineTotal(1_500, 999)).toBe(1_499);
    expect(monthlyEquivalent(120_000, "anual")).toBe(10_000);
    expect(monthlyEquivalent(12_000, "semanal")).toBe(52_000);
  });
  it("plan con utilidad deseada", () => {
    const p = plan({ expenses: 1_000_000, marginPpm: 400_000, targetProfit: 600_000, daysOpen: 25, avgTicket: 20_000, taxPpm: 190_000 });
    expect(p.breakEven).toBe(2_500_000);
    expect(p.needed).toBe(4_000_000);
    expect(p.neededWithTax).toBe(4_760_000);
    expect(p.perDay).toBe(160_000);
    expect(p.salesCount).toBe(200);
  });
  it("proyección y reparto", () => {
    const r = project({ sales: 1_000_000, marginPpm: 500_000, expenses: 300_000, growthPpm: 100_000, expenseGrowthPpm: 0, cash: 50_000, months: 2 });
    expect(r[0]).toMatchObject({ sales: 1_100_000, grossMargin: 550_000, profit: 250_000, cash: 300_000 });
    expect(r[1]).toMatchObject({ sales: 1_210_000, profit: 305_000, cumulative: 555_000 });
    const s = split(1_000_001, DEFAULT_SPLIT);
    expect(Object.values(s).reduce((a, b) => a + b, 0)).toBe(1_000_001);
    expect(split(-5, DEFAULT_SPLIT).retiro).toBe(0);
    expect(runwayMonths(3_000_000, 1_000_000)).toBe(3);
  });
});
