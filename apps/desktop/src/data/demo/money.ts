// Piezas puras del módulo Dinero de la demostración: mismas reglas que `finance_ops.rs`.
import type { Aging, ExpenseCategory, Recurring } from "../types";

/** Categorías de gasto iniciales (las mismas que siembra la migración 0007). */
export const DEMO_CATEGORIES: ExpenseCategory[] = [
  ["Arriendo", "fijo"], ["Electricidad", "variable"], ["Agua", "variable"], ["Internet y telefonía", "fijo"],
  ["Transporte", "variable"], ["Marketing", "variable"], ["Remuneraciones", "fijo"], ["Honorarios", "variable"],
  ["Software", "fijo"], ["Maquinaria y equipos", "variable"], ["Materiales", "variable"], ["Logística", "variable"],
  ["Impuestos y contribuciones", "variable"], ["Comisiones bancarias", "variable"], ["Otros", "variable"],
].map(([name, behavior], i) => ({ id: i + 1, name: name!, behavior: behavior as ExpenseCategory["behavior"] }));

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
