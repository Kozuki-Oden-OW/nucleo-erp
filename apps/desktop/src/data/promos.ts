// Motor de descuentos y promociones: calcula qué promociones aplican a una venta y cuánto ahorra
// cada línea. El resultado se guarda como descuento por línea (que el backend ya valida).
// Si varias promociones tocan un mismo producto, se usa la de mayor ahorro (no se suman).
import type { Promotion, PromoKind, PromoRule } from "./types";

export const PROMO_KIND_LABEL: Record<PromoKind, string> = {
  pack: "Pack",
  cantidad: "Por cantidad",
  lleva_paga: "Lleva X paga Y",
  cliente: "Por cliente",
  preferencial: "Cliente preferencial",
};
export const PROMO_KIND_HINT: Record<PromoKind, string> = {
  pack: "Dos o más productos juntos a un precio fijo o con un % de descuento.",
  cantidad: "Más unidades, más descuento: tramos por cantidad (ej. 10 % desde 12 unidades).",
  lleva_paga: "Lleva 3 y paga 2, lleva 2 y paga 1…",
  cliente: "Un % de descuento para clientes que elijas.",
  preferencial: "Un % para todos los clientes marcados como preferenciales.",
};

export const EMPTY_RULE: PromoRule = {
  items: [], category_uid: null, all_products: false, pack_price_minor: null, pct_ppm: null, tiers: [], mixed: false, buy: 3, pay: 2, customer_uids: [],
};

export interface PromoLine { product_uid: string | null; qty_milli: number; unit_price_minor: number }
export interface PromoCustomer { uid: string; preferred: boolean }

export interface LineSaving {
  /** Descuento sugerido para la línea (ppm). */
  discount_ppm: number;
  saving_minor: number;
  promo_uid: string;
  promo_name: string;
}
export interface AppliedPromo { uid: string; name: string; kind: PromoKind; saving_minor: number; detail: string }
export interface PromoResult {
  /** Por índice de línea; `null` si ninguna promoción aplica a esa línea. */
  lines: (LineSaving | null)[];
  applied: AppliedPromo[];
  total_saving_minor: number;
}

const gross = (l: PromoLine) => Math.round((l.qty_milli * l.unit_price_minor) / 1000);
const pctOf = (amount: number, ppm: number) => Math.round((amount * ppm) / 1_000_000);

function inScope(p: Promotion, uid: string | null): boolean {
  if (!uid) return p.rule.all_products;
  return p.rule.all_products || p.rule.items.some((i) => i.product_uid === uid) || p.category_product_uids.includes(uid);
}

/** Ahorro (en pesos) de una promoción en cada línea, sin mezclar con otras promociones. */
export function promoSavings(p: Promotion, lines: PromoLine[], customer: PromoCustomer | null): { amounts: number[]; detail: string } | null {
  const r = p.rule;
  const zero = lines.map(() => 0);
  switch (p.kind) {
    case "cliente":
    case "preferencial": {
      const ok = customer && (p.kind === "preferencial" ? customer.preferred : r.customer_uids.includes(customer.uid));
      if (!ok || !r.pct_ppm) return null;
      const amounts = lines.map((l) => (inScope(p, l.product_uid) ? pctOf(gross(l), r.pct_ppm!) : 0));
      return { amounts, detail: `${r.pct_ppm / 10_000} % ${p.kind === "preferencial" ? "por cliente preferencial" : "para este cliente"}` };
    }
    case "cantidad": {
      const tierFor = (q: number) => [...r.tiers].sort((a, b) => b.min_milli - a.min_milli).find((t) => q >= t.min_milli) ?? null;
      if (r.mixed) {
        const total = lines.reduce((a, l) => a + (inScope(p, l.product_uid) ? l.qty_milli : 0), 0);
        const t = tierFor(total);
        if (!t) return null;
        return { amounts: lines.map((l) => (inScope(p, l.product_uid) ? pctOf(gross(l), t.pct_ppm) : 0)), detail: `${t.pct_ppm / 10_000} % desde ${t.min_milli / 1000} unidades (sumando productos)` };
      }
      let best = 0;
      const amounts = lines.map((l) => {
        if (!inScope(p, l.product_uid)) return 0;
        const t = tierFor(l.qty_milli);
        if (!t) return 0;
        best = Math.max(best, t.pct_ppm);
        return pctOf(gross(l), t.pct_ppm);
      });
      return best ? { amounts, detail: `hasta ${best / 10_000} % por cantidad` } : null;
    }
    case "lleva_paga": {
      if (r.buy < 2 || r.pay < 1 || r.pay >= r.buy) return null;
      const amounts = lines.map((l) => {
        if (!inScope(p, l.product_uid)) return 0;
        const free = Math.floor(l.qty_milli / 1000 / r.buy) * (r.buy - r.pay);
        return free * l.unit_price_minor;
      });
      return { amounts, detail: `lleva ${r.buy} paga ${r.pay}` };
    }
    case "pack": {
      if (r.items.length === 0) return null;
      // Cuántos packs completos hay en la venta.
      const qtyOf = (uid: string) => lines.reduce((a, l) => a + (l.product_uid === uid ? l.qty_milli : 0), 0);
      const packs = Math.min(...r.items.map((i) => Math.floor(qtyOf(i.product_uid) / i.qty_milli)));
      if (!packs || !Number.isFinite(packs)) return null;
      const priceOf = (uid: string) => lines.find((l) => l.product_uid === uid)?.unit_price_minor ?? 0;
      const parts = r.items.map((i) => Math.round((i.qty_milli * priceOf(i.product_uid)) / 1000));
      const regular = parts.reduce((a, b) => a + b, 0);
      const perPack = r.pack_price_minor != null ? regular - r.pack_price_minor : pctOf(regular, r.pct_ppm ?? 0);
      if (perPack <= 0 || regular <= 0) return null;
      const total = perPack * packs;
      // Se reparte entre los productos del pack según su peso en el precio normal.
      const amounts = [...zero];
      r.items.forEach((it, k) => {
        const share = Math.round((total * parts[k]!) / regular);
        let left = share;
        lines.forEach((l, idx) => {
          if (l.product_uid !== it.product_uid || left <= 0) return;
          const take = Math.min(left, gross(l));
          amounts[idx]! += take;
          left -= take;
        });
      });
      return { amounts, detail: `${packs} ${packs === 1 ? "pack" : "packs"}${r.pack_price_minor != null ? "" : ` con ${(r.pct_ppm ?? 0) / 10_000} %`}` };
    }
  }
}

/** Calcula las promociones vigentes para la venta. */
export function applyPromotions(promos: Promotion[], lines: PromoLine[], customer: PromoCustomer | null): PromoResult {
  const best: (LineSaving | null)[] = lines.map(() => null);
  const details = new Map<string, string>();
  for (const p of promos) {
    if (p.status !== "activa") continue;
    const s = promoSavings(p, lines, customer);
    if (!s) continue;
    details.set(p.uid, s.detail);
    s.amounts.forEach((amount, i) => {
      const g = gross(lines[i]!);
      if (amount <= 0 || g <= 0) return;
      const a = Math.min(amount, g);
      if (!best[i] || a > best[i]!.saving_minor) {
        best[i] = { discount_ppm: Math.min(1_000_000, Math.round((a * 1_000_000) / g)), saving_minor: a, promo_uid: p.uid, promo_name: p.name };
      }
    });
  }
  const applied = new Map<string, AppliedPromo>();
  for (const b of best) {
    if (!b) continue;
    const p = promos.find((x) => x.uid === b.promo_uid)!;
    const cur = applied.get(p.uid) ?? { uid: p.uid, name: p.name, kind: p.kind, saving_minor: 0, detail: details.get(p.uid) ?? "" };
    cur.saving_minor += b.saving_minor;
    applied.set(p.uid, cur);
  }
  const list = [...applied.values()];
  return { lines: best, applied: list, total_saving_minor: list.reduce((a, x) => a + x.saving_minor, 0) };
}

/** Margen de un pack o precio promocional frente al costo (para avisar si se vende bajo costo). */
export function packMargin(p: Pick<Promotion, "rule" | "products">): { regular: number; promo: number; cost: number } | null {
  if (!p.products.length) return null;
  const regular = p.products.reduce((a, x) => a + Math.round((x.qty_milli * x.price_minor) / 1000), 0);
  const cost = p.products.reduce((a, x) => a + Math.round((x.qty_milli * x.cost_e4) / 10_000_000), 0);
  const promo = p.rule.pack_price_minor ?? regular - pctOf(regular, p.rule.pct_ppm ?? 0);
  return { regular, promo, cost };
}
