import { describe, expect, it } from "vitest";
import { applyPromotions, EMPTY_RULE, packMargin } from "./promos";
import type { Promotion, PromoKind, PromoRule } from "./types";

const promo = (uid: string, kind: PromoKind, rule: Partial<PromoRule>, extra: Partial<Promotion> = {}): Promotion => ({
  uid, name: uid, kind, rule: { ...EMPTY_RULE, ...rule }, starts_on: null, ends_on: null, active: true, status: "activa", notes: null,
  created_at: "", products: [], category: null, category_product_uids: [], customers: [], ...extra,
});
const line = (product_uid: string, units: number, price: number) => ({ product_uid, qty_milli: units * 1000, unit_price_minor: price });

describe("promociones", () => {
  it("pack a precio fijo: 2 productos a $18.000", () => {
    const p = promo("pack", "pack", { items: [{ product_uid: "a", qty_milli: 1000 }, { product_uid: "b", qty_milli: 1000 }], pack_price_minor: 18_000 });
    const r = applyPromotions([p], [line("a", 1, 12_000), line("b", 1, 8_000)], null);
    expect(r.total_saving_minor).toBe(2_000);
    expect(r.lines[0]!.saving_minor + r.lines[1]!.saving_minor).toBe(2_000);
    expect(r.lines[0]!.discount_ppm).toBe(100_000); // 1.200 de 12.000
    // Sin el segundo producto no hay pack.
    expect(applyPromotions([p], [line("a", 3, 12_000)], null).total_saving_minor).toBe(0);
    // Dos packs completos.
    expect(applyPromotions([p], [line("a", 2, 12_000), line("b", 3, 8_000)], null).total_saving_minor).toBe(4_000);
  });

  it("pack con 10 % y margen", () => {
    const p = promo("pack", "pack", { items: [{ product_uid: "a", qty_milli: 2000 }], pct_ppm: 100_000 }, {
      products: [{ uid: "a", sku: "A", name: "A", unit: "un", price_minor: 10_000, cost_e4: 60_000_000, qty_milli: 2000 }],
    });
    expect(applyPromotions([p], [line("a", 2, 10_000)], null).total_saving_minor).toBe(2_000);
    expect(packMargin(p)).toEqual({ regular: 20_000, promo: 18_000, cost: 12_000 });
  });

  it("por cantidad con tramos, por línea y sumando productos", () => {
    const tiers = [{ min_milli: 5_000, pct_ppm: 50_000 }, { min_milli: 10_000, pct_ppm: 100_000 }];
    const per = promo("q", "cantidad", { all_products: true, tiers });
    expect(applyPromotions([per], [line("a", 12, 1_000), line("b", 6, 1_000)], null).lines.map((l) => l?.discount_ppm)).toEqual([100_000, 50_000]);
    const mixed = promo("q", "cantidad", { all_products: true, tiers, mixed: true });
    expect(applyPromotions([mixed], [line("a", 6, 1_000), line("b", 6, 1_000)], null).lines.map((l) => l?.discount_ppm)).toEqual([100_000, 100_000]);
  });

  it("lleva 3 paga 2", () => {
    const p = promo("3x2", "lleva_paga", { items: [{ product_uid: "a", qty_milli: 0 }], buy: 3, pay: 2 });
    expect(applyPromotions([p], [line("a", 7, 1_000)], null).total_saving_minor).toBe(2_000);
  });

  it("cliente, preferencial y la mejor gana (no se suman)", () => {
    const c = promo("c", "cliente", { all_products: true, pct_ppm: 50_000, customer_uids: ["cli"] });
    const pref = promo("p", "preferencial", { all_products: true, pct_ppm: 80_000 });
    const lines = [line("a", 1, 10_000)];
    expect(applyPromotions([c, pref], lines, { uid: "otro", preferred: false }).total_saving_minor).toBe(0);
    expect(applyPromotions([c, pref], lines, { uid: "cli", preferred: false }).total_saving_minor).toBe(500);
    const r = applyPromotions([c, pref], lines, { uid: "cli", preferred: true });
    expect(r.total_saving_minor).toBe(800);
    expect(r.applied.map((a) => a.uid)).toEqual(["p"]);
  });

  it("ignora promociones pausadas, programadas o vencidas", () => {
    const p = promo("c", "preferencial", { all_products: true, pct_ppm: 80_000 }, { status: "pausada" });
    expect(applyPromotions([p], [line("a", 1, 10_000)], { uid: "x", preferred: true }).applied).toEqual([]);
  });
});
