// Piezas puras del módulo Dinero de la demostración: mismas reglas que `finance_ops.rs`.
import type { Aging, ExpenseCategory, Recurring } from "../types";

/** Categorías de gasto iniciales (las mismas que siembran las migraciones 0007 y 0027). */
export const DEMO_CATEGORIES: ExpenseCategory[] = ([
  ["Arriendo", "fijo", "Local y oficina"], ["Electricidad", "variable", "Local y oficina"], ["Agua", "variable", "Local y oficina"],
  ["Internet y telefonía", "fijo", "Local y oficina"], ["Transporte", "variable", "Vehículo y transporte"], ["Publicidad y marketing", "variable", "Ventas y publicidad"],
  ["Remuneraciones", "fijo", "Personas y estudios"], ["Honorarios", "variable", "Personas y estudios"], ["Software", "fijo", "Servicios"],
  ["Maquinaria y equipos", "variable", "Operación"], ["Materiales", "variable", "Operación"], ["Logística", "variable", "Operación"],
  ["Impuestos y contribuciones", "variable", "Impuestos y finanzas"], ["Comisiones bancarias", "variable", "Impuestos y finanzas"], ["Otros", "variable", "Otros"],
  ["Combustible", "variable", "Vehículo y transporte"], ["Peajes y estacionamientos", "variable", "Vehículo y transporte"], ["Mantención de vehículos", "variable", "Vehículo y transporte"],
  ["Viajes y pasajes", "variable", "Viajes y comidas"], ["Alojamiento", "variable", "Viajes y comidas"], ["Alimentación y comidas", "variable", "Viajes y comidas"],
  ["Gas", "variable", "Local y oficina"], ["Aseo y mantención", "variable", "Local y oficina"], ["Útiles de oficina", "variable", "Local y oficina"],
  ["Reparaciones", "variable", "Local y oficina"], ["Estudios y capacitación", "variable", "Personas y estudios"],
  ["Comisiones de venta y plataformas", "variable", "Ventas y publicidad"], ["Envases y embalaje", "variable", "Operación"],
  ["Contabilidad y asesorías", "fijo", "Servicios"], ["Seguros", "fijo", "Servicios"], ["Intereses de créditos", "fijo", "Impuestos y finanzas"],
  ["Patentes y permisos", "variable", "Impuestos y finanzas"],
] as const).map(([name, behavior, group_name], i) => ({ id: i + 1, name, behavior, group_name, monthly_budget_minor: null, archived: false }));

export const PROJECTION_WEEKS = 13;

/** Código del medio de pago a partir de su nombre visible (igual que `method_code`). */
export function methodCode(m: string): string {
  const n = m.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (n.startsWith("efect")) return "efectivo";
  if (n.startsWith("transf")) return "transferencia";
  if (n.includes("debito")) return "debito";
  if (n.includes("credito")) return "credito";
  if (n.startsWith("cheq")) return "cheque";
  return "otro";
}

export function emptyAging(): Aging {
  return { current_minor: 0, d1_30_minor: 0, d31_60_minor: 0, d61_90_minor: 0, d90_plus_minor: 0 };
}

export function agingAdd(a: Aging, daysOverdue: number, amount: number): void {
  if (daysOverdue <= 0) a.current_minor += amount;
  else if (daysOverdue <= 30) a.d1_30_minor += amount;
  else if (daysOverdue <= 60) a.d31_60_minor += amount;
  else if (daysOverdue <= 90) a.d61_90_minor += amount;
  else a.d90_plus_minor += amount;
}

const pad = (n: number) => String(n).padStart(2, "0");
const plusDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Fechas en que ocurre un recurrente entre `from` y `to` (ISO, inclusive). */
export function occurrences(r: Pick<Recurring, "frequency" | "starts_on" | "ends_on" | "day_of_period">, from: string, to: string): string[] {
  const end = r.ends_on && r.ends_on < to ? r.ends_on : to;
  const out: string[] = [];
  if (r.frequency === "semanal") {
    for (let d = r.starts_on; d <= end; d = plusDays(d, 7)) if (d >= from) out.push(d);
    return out;
  }
  const step = r.frequency === "bimestral" ? 2 : r.frequency === "trimestral" ? 3 : r.frequency === "anual" ? 12 : 1;
  const day = Math.min(31, Math.max(1, r.day_of_period ?? Number(r.starts_on.slice(8, 10))));
  let y = Number(r.starts_on.slice(0, 4));
  let m = Number(r.starts_on.slice(5, 7));
  for (let i = 0; i < 600; i++) {
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const d = `${y}-${pad(m)}-${pad(Math.min(day, last))}`;
    if (d > end) break;
    if (d >= from && d >= r.starts_on) out.push(d);
    m += step;
    while (m > 12) { m -= 12; y += 1; }
  }
  return out;
}
