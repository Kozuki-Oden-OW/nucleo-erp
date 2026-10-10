// Espejo en TypeScript de nucleo-domain::costing (Rust): precio neto o con IVA y hoja de costo.
// Mismos enteros y mismo redondeo (half away from zero); se prueba contra golden/costo.json.

const PPM = 1_000_000n;

function divRound(n: bigint, d: bigint): bigint {
  if (d < 0n) { n = -n; d = -d; }
  return n >= 0n ? (n + d / 2n) / d : -((-n + d / 2n) / d);
}

/** Neto a partir de un precio con impuesto. Sin tasa devuelve el mismo monto. */
export function netFromGross(gross: number, taxPpm: number | null): number {
  if (!taxPpm || taxPpm <= 0) return gross;
  return Number(divRound(BigInt(gross) * PPM, PPM + BigInt(taxPpm)));
}

/** Precio con impuesto a partir del neto. */
export function grossFromNet(net: number, taxPpm: number | null): number {
  if (!taxPpm || taxPpm <= 0) return net;
  return net + Number(divRound(BigInt(net) * BigInt(taxPpm), PPM));
}

export interface CostSheet {
  purchase_minor: number;
  currency: string;
  currency_digits: number;
  fx_rate_e6: number;
  freight_minor: number;
  shipping_minor: number;
  labor_minor: number;
  other_minor: number;
  units_milli: number;
  pesos_include_tax: boolean;
}

export interface CostSheetResult {
  purchase_clp: number;
  freight: number;
  shipping: number;
  labor: number;
  other: number;
  total: number;
  units_milli: number;
  unit_cost_e4: number;
  unit_cost: number;
  notes: string[];
}

export const EMPTY_COST_SHEET: CostSheet = {
  purchase_minor: 0, currency: "CLP", currency_digits: 0, fx_rate_e6: 0, freight_minor: 0, shipping_minor: 0,
  labor_minor: 0, other_minor: 0, units_milli: 1000, pesos_include_tax: false,
};

export function computeCostSheet(s: CostSheet, taxPpm: number | null): CostSheetResult {
  const notes: string[] = [];
  const tax = s.pesos_include_tax ? taxPpm : null;
  if (s.pesos_include_tax && taxPpm === null) notes.push("El negocio no tiene tasa de IVA: los montos en pesos se usan tal cual.");
  const net = (x: number) => netFromGross(Math.max(0, x), tax);
  const isClp = !s.currency || s.currency.toUpperCase() === "CLP";
  let purchase = 0;
  if (isClp) purchase = net(s.purchase_minor);
  else if (s.purchase_minor > 0 && s.fx_rate_e6 <= 0) notes.push(`Falta el tipo de cambio de ${s.currency}: la compra no se sumó.`);
  else purchase = Number(divRound(BigInt(Math.max(0, s.purchase_minor)) * BigInt(s.fx_rate_e6), 10n ** BigInt(s.currency_digits) * PPM));
  const freight = net(s.freight_minor);
  const shipping = net(s.shipping_minor);
  const labor = Math.max(0, s.labor_minor);
  const other = net(s.other_minor);
  const total = purchase + freight + shipping + labor + other;
  const units = s.units_milli > 0 ? s.units_milli : 1000;
  const unitE4 = Number(divRound(BigInt(total) * 10_000n * 1000n, BigInt(units)));
  return {
    purchase_clp: purchase, freight, shipping, labor, other, total, units_milli: units,
    unit_cost_e4: unitE4, unit_cost: Number(divRound(BigInt(unitE4), 10_000n)), notes,
  };
}

/** ¿La hoja tiene algún dato? */
export function costSheetUsed(s: CostSheet | null | undefined): boolean {
  return !!s && (s.purchase_minor > 0 || s.freight_minor > 0 || s.shipping_minor > 0 || s.labor_minor > 0 || s.other_minor > 0);
}
