// Armado de la liquidación desde la ficha de la persona, los indicadores del mes y lo que cambia ese
// mes — espejo de `nucleo-app/src/payroll_ops.rs` (build_input, suggested_days, compute_for). Lo usan
// la vista previa en vivo del editor y el backend de demostración.
import { computePayslip, type PayslipInput, type PayslipResult } from "./payroll";
import type { PayrollIndicators, PayslipMonth, Worker } from "./types";

const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export function periodRange(period: string): [string, string] {
  const y = Number(period.slice(0, 4)), m = Number(period.slice(5, 7));
  return [`${period}-01`, `${period}-${String(daysIn(y, m)).padStart(2, "0")}`];
}

/** Días del mes comercial (30) que corresponden según las fechas de ingreso y término. */
export function suggestedDays(w: Pick<Worker, "start_date" | "end_date">, period: string): number {
  const [from, to] = periodRange(period);
  const start = w.start_date > from ? w.start_date : from;
  const endRaw = w.end_date ?? to;
  const end = endRaw < to ? endRaw : to;
  if (start > end) return 0;
  if (start === from && end === to) return 30;
  return Math.min(Math.max(Number(end.slice(8, 10)) - Number(start.slice(8, 10)) + 1, 0), 30);
}

export function inPeriod(w: Pick<Worker, "start_date" | "end_date">, period: string): boolean {
  const [from, to] = periodRange(period);
  return w.start_date <= to && (w.end_date === null || w.end_date >= from);
}

export const EMPTY_MONTH: PayslipMonth = { days: null, overtime_hours_e2: 0, items: [], deductions: [], advance: 0 };

export function buildPayslipInput(w: Worker, ind: PayrollIndicators, month: PayslipMonth, days: number): PayslipInput {
  const t = w.terms;
  const afp = t.afp ? ind.afp.find((a) => a.name.trim().toLowerCase() === t.afp!.trim().toLowerCase()) : undefined;
  return {
    params: structuredClone(ind.params),
    worker: {
      contract: t.contract, owner_salary: w.is_owner, afp_ppm: afp?.rate_ppm ?? null, afp_name: t.afp,
      health: t.health === "isapre"
        ? { kind: "isapre", plan_uf_e4: t.isapre_plan_uf_e4 && t.isapre_plan_uf_e4 > 0 ? t.isapre_plan_uf_e4 : null, plan_clp: t.isapre_plan_clp && t.isapre_plan_clp > 0 ? t.isapre_plan_clp : null }
        : { kind: t.health },
      health_name: t.health_name, afc: t.afc, employer_contrib: t.employer_contrib, accident: t.accident, weekly_hours: t.weekly_hours,
    },
    base_salary: t.base_salary,
    days,
    overtime_hours_e2: month.overtime_hours_e2,
    overtime_surcharge_ppm: t.overtime_surcharge_ppm,
    gratification: t.gratification,
    gratification_amount: t.gratification_amount,
    items: [...t.items, ...month.items],
    deductions: [...t.deductions, ...month.deductions],
    advance: month.advance,
  };
}

/** Calcula y agrega el aviso de AFP sin tasa en los indicadores (igual que el escritorio). */
export function computeFor(w: Worker, ind: PayrollIndicators, input: PayslipInput): PayslipResult {
  const r = computePayslip(input);
  if (w.terms.afp && input.worker.afp_ppm == null) {
    r.complete = false;
    r.notes.unshift({ code: null, severity: "falta", text: `Falta la tasa de la AFP ${w.terms.afp} en los indicadores del mes${ind.afp.length ? " (revisa que el nombre coincida)" : ""}.` });
  }
  return r;
}

/** Nota que se antepone cuando los indicadores del mes no están confirmados. */
export function indicatorsNote(fromPeriod: string | null): string {
  return fromPeriod
    ? `Los indicadores de este mes no están confirmados: se están usando los de ${fromPeriod}. Revísalos y guárdalos antes de emitir.`
    : "Faltan los indicadores del mes (UF, UTM, topes, tasas de AFP y tabla del impuesto único).";
}
