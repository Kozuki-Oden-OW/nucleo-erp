// Gastos: cuentas del punto de equilibrio, proyección y reparto de la utilidad.
// Mismas reglas que nucleo-app::gastos_ops (Rust) donde se repiten. Montos en pesos enteros,
// márgenes en ppm (1.000.000 = 100 %).

/** Grupos de categorías, en el orden en que se muestran. */
export const CATEGORY_GROUPS = [
  "Vehículo y transporte", "Viajes y comidas", "Local y oficina", "Personas y estudios", "Ventas y publicidad",
  "Operación", "Servicios", "Impuestos y finanzas", "Otros",
] as const;

/** Atajos para registrar rápido lo más común (nombre de categoría, texto del botón). */
export const QUICK_CATEGORIES: [string, string][] = [
  ["Combustible", "Bencina"], ["Transporte", "Transporte"], ["Alimentación y comidas", "Comida"], ["Viajes y pasajes", "Viajes"],
  ["Alojamiento", "Alojamiento"], ["Arriendo", "Arriendo"], ["Estudios y capacitación", "Estudios"], ["Publicidad y marketing", "Publicidad"],
  ["Peajes y estacionamientos", "Peajes"], ["Útiles de oficina", "Oficina"],
];

const divRound = (n: number, d: number) => (d === 0 ? 0 : Math.sign(n) * Math.sign(d) * Math.floor(Math.abs(n) / Math.abs(d) + 0.5));

/** Equivalente mensual de un monto según su frecuencia. */
export function monthlyEquivalent(amount: number, frequency: string): number {
  switch (frequency) {
    case "semanal": return divRound(amount * 52, 12);
    case "bimestral": return divRound(amount, 2);
    case "trimestral": return divRound(amount, 3);
    case "anual": return divRound(amount, 12);
    default: return amount;
  }
}

/** Venta neta que cubre `expenses` con un margen sobre la venta `marginPpm` (hacia arriba). */
export function breakEven(expenses: number, marginPpm: number): number | null {
  if (!(marginPpm > 0)) return null;
  return Math.ceil((Math.max(0, expenses) * 1_000_000) / marginPpm);
}

/** Total de un gasto: cantidad (milésimas) × valor, redondeado al peso. */
export function lineTotal(qtyMilli: number, unit: number): number {
  return divRound(unit * qtyMilli, 1000);
}

export interface PlanInput {
  /** Gastos mensuales (fijos + variables + remuneraciones), sin IVA recuperable. */
  expenses: number;
  /** Margen sobre la venta, en ppm. */
  marginPpm: number;
  /** Utilidad mensual que quieres que te quede (sueldo del dueño, ahorro…). */
  targetProfit: number;
  /** Días que vendes al mes. */
  daysOpen: number;
  /** Venta promedio por boleta o factura (neto), si se conoce. */
  avgTicket: number | null;
  /** Tasa de IVA en ppm, para mostrar la venta con IVA. */
  taxPpm: number | null;
}

export interface Plan {
  /** Venta neta mensual para cubrir solo los gastos (punto de equilibrio). */
  breakEven: number | null;
  /** Venta neta mensual para cubrir los gastos y dejar la utilidad deseada. */
  needed: number | null;
  neededWithTax: number | null;
  perWeek: number | null;
  perDay: number | null;
  /** Ventas (documentos) al mes con la venta promedio. */
  salesCount: number | null;
}

export function plan(p: PlanInput): Plan {
  const be = breakEven(p.expenses, p.marginPpm);
  const needed = breakEven(p.expenses + Math.max(0, p.targetProfit), p.marginPpm);
  const days = Math.max(1, Math.round(p.daysOpen));
  return {
    breakEven: be,
    needed,
    neededWithTax: needed === null ? null : p.taxPpm ? needed + divRound(needed * p.taxPpm, 1_000_000) : needed,
    perWeek: needed === null ? null : divRound(needed * 12, 52),
    perDay: needed === null ? null : Math.ceil(needed / days),
    salesCount: needed === null || !p.avgTicket ? null : Math.ceil(needed / p.avgTicket),
  };
}

export interface ProjectionMonth {
  /** 1 = el próximo mes. */
  n: number;
  sales: number;
  grossMargin: number;
  expenses: number;
  profit: number;
  /** Utilidad acumulada desde hoy. */
  cumulative: number;
  /** Dinero estimado: caja de hoy + utilidad acumulada. */
  cash: number;
}

/**
 * Proyección mes a mes: la venta crece `growthPpm` cada mes (compuesto) y los gastos `expenseGrowthPpm`.
 * Es una estimación de gestión, no considera plazos de cobro ni de pago.
 */
export function project(p: { sales: number; marginPpm: number; expenses: number; growthPpm: number; expenseGrowthPpm: number; cash: number; months: number }): ProjectionMonth[] {
  const out: ProjectionMonth[] = [];
  let sales = p.sales, expenses = p.expenses, cum = 0;
  for (let n = 1; n <= p.months; n++) {
    sales = divRound(sales * (1_000_000 + p.growthPpm), 1_000_000);
    expenses = divRound(expenses * (1_000_000 + p.expenseGrowthPpm), 1_000_000);
    const grossMargin = divRound(sales * p.marginPpm, 1_000_000);
    const profit = grossMargin - expenses;
    cum += profit;
    out.push({ n, sales, grossMargin, expenses, profit, cumulative: cum, cash: p.cash + cum });
  }
  return out;
}

/** Destinos para repartir la utilidad del mes; los porcentajes los decide quien usa el sistema. */
export const SPLIT_KEYS = ["reserva", "reinvertir", "publicidad", "inversiones", "retiro"] as const;
export type SplitKey = (typeof SPLIT_KEYS)[number];
export const SPLIT_LABEL: Record<SplitKey, { label: string; hint: string }> = {
  reserva: { label: "Reserva (colchón)", hint: "Para meses malos o imprevistos" },
  reinvertir: { label: "Reinvertir en el negocio", hint: "Stock, equipos, crecer en lo mismo" },
  publicidad: { label: "Publicidad", hint: "Para vender más" },
  inversiones: { label: "Inversiones fuera del negocio", hint: "Acciones, otro proyecto" },
  retiro: { label: "Retiro del dueño", hint: "Lo que te pagas a ti" },
};
/** Reparto inicial de ejemplo (editable). */
export const DEFAULT_SPLIT: Record<SplitKey, number> = { reserva: 20, reinvertir: 30, publicidad: 10, inversiones: 10, retiro: 30 };

/** Reparte una utilidad según porcentajes (enteros); lo que sobra del redondeo va al primero con %. */
export function split(profit: number, pct: Record<SplitKey, number>): Record<SplitKey, number> {
  const base = Math.max(0, profit);
  const out = Object.fromEntries(SPLIT_KEYS.map((k) => [k, Math.floor((base * Math.max(0, pct[k] ?? 0)) / 100)])) as Record<SplitKey, number>;
  const totalPct = SPLIT_KEYS.reduce((a, k) => a + Math.max(0, pct[k] ?? 0), 0);
  if (totalPct === 100) {
    const rest = base - SPLIT_KEYS.reduce((a, k) => a + out[k], 0);
    const first = SPLIT_KEYS.find((k) => (pct[k] ?? 0) > 0);
    if (first) out[first] += rest;
  }
  return out;
}

/** Meses de gastos que cubre `cash` si no entrara ninguna venta (null si no hay gastos). */
export function runwayMonths(cash: number, monthlyBurn: number): number | null {
  if (monthlyBurn <= 0) return null;
  return Math.max(0, cash) / monthlyBurn;
}
