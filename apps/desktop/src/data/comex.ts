// NÚCLEO COMEX — espejo exacto de `nucleo-domain/src/comex.rs` (mismas reglas, enteros y redondeo).
// Lo usan la vista previa en vivo de las pantallas y el backend de demostración. Los casos de
// `golden/comex.json` se ejecutan contra ambas implementaciones para garantizar que coinciden.
// Ningún porcentaje está escrito aquí: arancel e IVA de importación los ingresa el usuario.

export type Basis = "valor" | "peso" | "volumen" | "unidades";
export type CostKind =
  | "flete" | "seguro" | "derechos" | "iva_importacion" | "agente_aduana" | "gastos_portuarios"
  | "almacenaje" | "transporte_interno" | "gastos_bancarios" | "otros";

export interface LandedItem { qty_milli: number; unit_price_minor: number; weight_g?: number | null; volume_cm3?: number | null; duty_ppm?: number | null }
export interface LandedCost { kind: CostKind; amount_clp: number; basis?: Basis | null; recoverable?: boolean }
export interface LandedInput {
  currency_decimals: number;
  rate_e6: number;
  basis: Basis;
  vat_ppm?: number | null;
  vat_recoverable?: boolean;
  items: LandedItem[];
  costs?: LandedCost[];
}
export interface ItemBreakdown {
  fob_clp: number; freight_clp: number; insurance_clp: number; customs_value_clp: number; duty_clp: number;
  vat_clp: number; vat_in_cost_clp: number; local_clp: number; landed_clp: number; unit_cost_e4: number;
}
export interface LandedResult {
  fob_minor: number; fob_clp: number; freight_clp: number; insurance_clp: number; customs_value_clp: number;
  duty_clp: number; duty_entered: boolean; vat_clp: number; vat_entered: boolean; vat_in_cost_clp: number;
  recoverable_clp: number; local_clp: number; landed_clp: number; items: ItemBreakdown[]; notes: string[];
}

export const COST_KINDS: { value: CostKind; label: string; hint: string }[] = [
  { value: "flete", label: "Flete internacional", hint: "Forma parte del valor aduanero" },
  { value: "seguro", label: "Seguro", hint: "Forma parte del valor aduanero; se reparte por valor" },
  { value: "derechos", label: "Derechos de aduana", hint: "Monto real de la declaración: reemplaza el cálculo por arancel" },
  { value: "iva_importacion", label: "IVA de importación", hint: "Monto real de la declaración: reemplaza el cálculo por tasa" },
  { value: "agente_aduana", label: "Agente de aduana", hint: "" },
  { value: "gastos_portuarios", label: "Gastos portuarios", hint: "" },
  { value: "almacenaje", label: "Almacenaje", hint: "" },
  { value: "transporte_interno", label: "Transporte local", hint: "Del puerto o aeropuerto a tu bodega" },
  { value: "gastos_bancarios", label: "Gastos bancarios", hint: "Transferencia al exterior, comisiones" },
  { value: "otros", label: "Otros", hint: "" },
];
export const COST_LABEL = Object.fromEntries(COST_KINDS.map((k) => [k.value, k.label])) as Record<CostKind, string>;
export const STAGE_LABEL: Record<string, string> = {
  cotizacion: "Cotización", ordenada: "Ordenada", pagada: "Pagada al proveedor", produccion: "En producción", lista_despacho: "Lista para despacho",
  embarcada: "Embarcada", en_transito: "En tránsito", arribada: "Arribada", internacion: "En internación", transporte_local: "Transporte local",
  recibida: "Recibida", cerrada: "Cerrada", anulada: "Anulada",
};
export const BASIS_LABEL: Record<Basis, string> = { valor: "Por valor", peso: "Por peso", volumen: "Por volumen", unidades: "Por unidades" };

const COST_TEXT: Record<CostKind, string> = {
  flete: "el flete", seguro: "el seguro", derechos: "los derechos", iva_importacion: "el IVA de importación",
  agente_aduana: "el agente de aduana", gastos_portuarios: "los gastos portuarios", almacenaje: "el almacenaje",
  transporte_interno: "el transporte local", gastos_bancarios: "los gastos bancarios", otros: "otros gastos",
};

// Enteros grandes para que productos de montos × tasas no pierdan precisión.
const B = BigInt;
/** División entera con redondeo half away from zero. */
function divRound(n: bigint, d: bigint): bigint {
  if (d < 0n) { n = -n; d = -d; }
  return n >= 0n ? (n + d / 2n) / d : -((-n + d / 2n) / d);
}
export function toClp(amountMinor: number, decimals: number, rateE6: number): number {
  return Number(divRound(B(amountMinor) * B(rateE6), 10n ** B(decimals) * 1_000_000n));
}
/** Reparto por resto mayor: la suma es exacta. Pesos todos en cero → partes iguales. */
export function allocate(total: number, weights: bigint[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  let ws = weights.map((w) => (w > 0n ? w : 0n));
  let sum = ws.reduce((a, b) => a + b, 0n);
  if (sum === 0n) { ws = ws.map(() => 1n); sum = B(n); }
  const t = B(total);
  const floorDiv = (a: bigint, b: bigint) => { const q = a / b; return a % b !== 0n && (a < 0n) !== (b < 0n) ? q - 1n : q; };
  const out = ws.map((w) => floorDiv(t * w, sum));
  const rems = ws.map((w, i) => ({ r: t * w - floorDiv(t * w, sum) * sum, i }));
  let left = t - out.reduce((a, b) => a + b, 0n);
  rems.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  let k = 0;
  while (left > 0n) { out[rems[k % n]!.i]! += 1n; left -= 1n; k++; }
  return out.map(Number);
}

function lineMinor(qtyMilli: number, unitMinor: number): number {
  return Number(divRound(B(qtyMilli) * B(unitMinor), 1000n));
}

export function landedCost(input: LandedInput): LandedResult {
  const items = input.items;
  const n = items.length;
  const costs = input.costs ?? [];
  const notes: string[] = [];
  const fob = items.map((it) => toClp(lineMinor(it.qty_milli, it.unit_price_minor), input.currency_decimals, input.rate_e6));
  const fobMinor = items.reduce((a, it) => a + lineMinor(it.qty_milli, it.unit_price_minor), 0);
  if (input.rate_e6 <= 0 && fobMinor > 0) notes.push("Falta el tipo de cambio: la mercadería quedó en $0.");
  const zeros = () => new Array<number>(n).fill(0);
  const addTo = (into: number[], part: number[]) => part.forEach((v, i) => { into[i]! += v; });
  const weights = (basis: Basis, what: string): bigint[] => {
    const value = () => fob.map((v) => B(v));
    if (basis === "valor") return value();
    if (basis === "unidades") return items.map((i) => B(i.qty_milli));
    const per = items.map((i) => (basis === "peso" ? i.weight_g : i.volume_cm3));
    if (per.some((p) => p == null || p <= 0)) {
      const note = `Falta el ${basis} de algún producto: ${what} se repartió por valor.`;
      if (!notes.includes(note)) notes.push(note);
      return value();
    }
    return items.map((i, k) => B(per[k] ?? 0) * B(i.qty_milli));
  };
  const freight = zeros(), insurance = zeros(), local = zeros();
  let recoverable = 0;
  for (const c of costs.filter((c) => c.kind === "flete" || c.kind === "seguro")) {
    const basis = c.basis ?? (c.kind === "seguro" ? "valor" : input.basis);
    addTo(c.kind === "flete" ? freight : insurance, allocate(c.amount_clp, weights(basis, COST_TEXT[c.kind])));
  }
  const cv = fob.map((v, i) => v + freight[i]! + insurance[i]!);
  const dutyLines = costs.filter((c) => c.kind === "derechos");
  const dutyEntered = dutyLines.length > 0;
  const duty = zeros(), dutyCost = zeros();
  if (dutyEntered) {
    const anyRate = items.some((i) => (i.duty_ppm ?? 0) > 0);
    const w = cv.map((v, i) => (anyRate ? B(v) * B(items[i]!.duty_ppm ?? 0) : B(v)));
    for (const c of dutyLines) {
      const part = allocate(c.amount_clp, w);
      addTo(duty, part);
      if (c.recoverable) recoverable += c.amount_clp; else addTo(dutyCost, part);
    }
  } else {
    cv.forEach((v, i) => { const d = Number(divRound(B(v) * B(items[i]!.duty_ppm ?? 0), 1_000_000n)); duty[i] = d; dutyCost[i] = d; });
  }
  const vatLines = costs.filter((c) => c.kind === "iva_importacion");
  const vatEntered = vatLines.length > 0;
  const vat = zeros(), vatCost = zeros();
  if (vatEntered) {
    const w = cv.map((v, i) => B(v + duty[i]!));
    for (const c of vatLines) {
      const part = allocate(c.amount_clp, w);
      addTo(vat, part);
      if (c.recoverable) recoverable += c.amount_clp; else addTo(vatCost, part);
    }
  } else if (input.vat_ppm != null) {
    const ppm = input.vat_ppm;
    cv.forEach((v, i) => {
      const x = Number(divRound(B(v + duty[i]!) * B(ppm), 1_000_000n));
      vat[i] = x;
      if (input.vat_recoverable ?? true) recoverable += x; else vatCost[i] = x;
    });
  } else if (fobMinor > 0) notes.push("Sin tasa de IVA de importación: no se calculó.");
  for (const c of costs.filter((c) => !["flete", "seguro", "derechos", "iva_importacion"].includes(c.kind))) {
    if (c.recoverable) { recoverable += c.amount_clp; continue; }
    addTo(local, allocate(c.amount_clp, weights(c.basis ?? input.basis, COST_TEXT[c.kind])));
  }
  const out: ItemBreakdown[] = items.map((it, i) => {
    const landed = cv[i]! + dutyCost[i]! + vatCost[i]! + local[i]!;
    return {
      fob_clp: fob[i]!, freight_clp: freight[i]!, insurance_clp: insurance[i]!, customs_value_clp: cv[i]!, duty_clp: duty[i]!,
      vat_clp: vat[i]!, vat_in_cost_clp: vatCost[i]!, local_clp: local[i]!, landed_clp: landed,
      unit_cost_e4: it.qty_milli > 0 ? Number(divRound(B(landed) * 10_000_000n, B(it.qty_milli))) : 0,
    };
  });
  const sum = (f: (x: ItemBreakdown) => number) => out.reduce((a, x) => a + f(x), 0);
  return {
    fob_minor: fobMinor, fob_clp: sum((x) => x.fob_clp), freight_clp: sum((x) => x.freight_clp), insurance_clp: sum((x) => x.insurance_clp),
    customs_value_clp: sum((x) => x.customs_value_clp),
    duty_clp: dutyEntered ? dutyLines.reduce((a, c) => a + c.amount_clp, 0) : sum((x) => x.duty_clp), duty_entered: dutyEntered,
    vat_clp: sum((x) => x.vat_clp), vat_entered: vatEntered, vat_in_cost_clp: sum((x) => x.vat_in_cost_clp),
    recoverable_clp: recoverable, local_clp: sum((x) => x.local_clp), landed_clp: sum((x) => x.landed_clp), items: out, notes,
  };
}

/* ───── Exportación ───── */

export interface ExportItem { qty_milli: number; unit_price_minor: number; unit_cost_e4: number }
export interface ExportInput { currency_decimals: number; rate_e6: number; items: ExportItem[]; costs_clp?: number[] }
export interface ExportResult {
  revenue_minor: number; revenue_clp: number; goods_cost_clp: number; costs_clp: number; contribution_clp: number;
  profit_clp: number; margin_ppm: number | null; breakeven_revenue_clp: number | null;
}

export function exportMargin(input: ExportInput): ExportResult {
  const revenueMinor = input.items.reduce((a, i) => a + lineMinor(i.qty_milli, i.unit_price_minor), 0);
  const revenue = input.items.reduce((a, i) => a + toClp(lineMinor(i.qty_milli, i.unit_price_minor), input.currency_decimals, input.rate_e6), 0);
  const goods = input.items.reduce((a, i) => a + Number(divRound(B(i.qty_milli) * B(i.unit_cost_e4), 10_000_000n)), 0);
  const costs = (input.costs_clp ?? []).reduce((a, b) => a + b, 0);
  const contribution = revenue - goods;
  const profit = contribution - costs;
  return {
    revenue_minor: revenueMinor, revenue_clp: revenue, goods_cost_clp: goods, costs_clp: costs, contribution_clp: contribution, profit_clp: profit,
    margin_ppm: revenue > 0 ? Number(divRound(B(profit) * 1_000_000n, B(revenue))) : null,
    breakeven_revenue_clp: contribution > 0 ? Number(divRound(B(costs) * B(revenue), B(contribution))) : null,
  };
}

/** Precio neto sugerido para lograr un margen sobre el precio de venta. */
export function priceForMargin(unitCost: number, marginPpm: number): number {
  if (marginPpm >= 1_000_000) return 0;
  return Math.round(unitCost / (1 - marginPpm / 1_000_000));
}
