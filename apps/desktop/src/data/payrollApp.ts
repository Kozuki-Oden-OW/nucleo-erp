// Armado de la liquidación desde la ficha de la persona, los indicadores del mes y lo que cambia ese
// mes — espejo de `nucleo-app/src/payroll_ops.rs` (build_input, suggested_days, compute_for). Lo usan
// la vista previa en vivo del editor y el backend de demostración.
import { computePayslip, type EarningItem, type PayslipInput, type PayslipResult } from "./payroll";
import { CCAF_NAMES, MUTUAL_NAMES, lreAfpCode, lreHealthCode, lreTotals, type LreRow } from "./lre";
import type { F29Note } from "./f29";
import type { PayrollIndicators, PayrollSettings, PayslipMonth, PreviredRow, Worker } from "./types";

/** Haberes imponibles sin código: los de la ficha son fijos (2111), los del mes variables (2113). */
const withCode = (i: EarningItem, def: number): EarningItem => (i.lre == null && (i.taxable ?? true) ? { ...i, lre: def } : { ...i });

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
      family_loads: t.family_loads ?? 0, invalid_loads: t.invalid_loads ?? 0, allowance_income: t.allowance_income ?? null, apv: t.apv ?? null,
    },
    base_salary: t.base_salary,
    days,
    overtime_hours_e2: month.overtime_hours_e2,
    overtime_surcharge_ppm: t.overtime_surcharge_ppm,
    gratification: t.gratification,
    gratification_amount: t.gratification_amount,
    items: [...t.items.map((i) => withCode(i, 2111)), ...month.items.map((i) => withCode(i, 2113))],
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

/** Foto de una liquidación emitida (lo que usan Previred y el LRE). */
export interface SlipSnapshot { worker: Worker; input: PayslipInput; result: PayslipResult }

/** Resumen de Previred por institución — espejo de `previred` en `payroll_ops.rs`. */
export function previredRows(snaps: SlipSnapshot[], settings: PayrollSettings): PreviredRow[] {
  const rows: PreviredRow[] = [];
  const add = (institution: string, kind: PreviredRow["kind"], worker: number, employer: number) => {
    if (worker === 0 && employer === 0) return;
    const r = rows.find((x) => x.institution === institution);
    if (r) { r.worker += worker; r.employer += employer; r.total = r.worker + r.employer; }
    else rows.push({ institution, kind, worker, employer, total: worker + employer });
  };
  const mutual = settings.mutual != null && MUTUAL_NAMES[settings.mutual] ? `Seguro de accidentes: ${MUTUAL_NAMES[settings.mutual]}` : "Seguro de accidentes (mutual o ISL)";
  for (const s of snaps) {
    const t = s.worker.terms, r = s.result;
    const afp = `AFP ${t.afp ?? "—"}`;
    const health = t.health === "isapre" ? `Isapre ${t.health_name ?? ""}`.trim() : "Fonasa";
    for (const l of r.legal_deductions) {
      if (l.key === "afp") add(afp, "afp", l.amount, 0);
      else if (l.key === "apv") add(`APV ${t.apv?.institution ?? afp}`.replace("APV AFP", "APV en AFP"), "apv", l.amount, 0);
      else if (l.key === "salud" || l.key === "salud_adicional") add(health, "salud", l.amount, 0);
      else if (l.key === "afc") add("Seguro de cesantía (AFC)", "afc", l.amount, 0);
    }
    for (const l of r.employer) {
      if (l.key === "afc_empleador") add("Seguro de cesantía (AFC)", "afc", 0, l.amount);
      else if (l.key === "ley16744") add(mutual, "mutual", 0, l.amount);
      else {
        const payee = (s.input.params.employer ?? []).find((e) => e.code === l.key)?.payee ?? null;
        if (payee === "seguro_social") add("Seguro Social Previsional", "seguro_social", 0, l.amount);
        else if (payee === "afp" || payee == null) add(afp, "afp", 0, l.amount);
        else add(l.label, "otro", 0, l.amount);
      }
    }
    const allowance = r.other_earnings.filter((l) => l.key === "asignacion_familiar").reduce((a, l) => a + l.amount, 0);
    if (allowance > 0) add(`Asignación familiar pagada (la compensa la ${settings.ccaf > 0 ? `caja ${CCAF_NAMES[settings.ccaf]}` : "IPS"})`, "asignacion", 0, -allowance);
  }
  const order = ["afp", "apv", "salud", "afc", "seguro_social", "mutual", "otro", "asignacion"];
  return rows.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || (a.institution < b.institution ? -1 : a.institution > b.institution ? 1 : 0));
}

/** Filas del LRE — espejo de `lre` en `payroll_ops.rs`. */
export function lreRows(snaps: SlipSnapshot[], settings: PayrollSettings, period: string): { rows: LreRow[]; warnings: string[] } {
  const warnings: string[] = [];
  const warn = (m: string) => { if (!warnings.includes(m)) warnings.push(m); };
  const [from, to] = periodRange(period);
  const CAUSE_CODE: Record<string, number> = { mutuo_acuerdo: 3, renuncia: 4, muerte: 5, vencimiento_plazo: 6, conclusion_obra: 7, necesidades_empresa: 18, desahucio: 19 };
  const rows = snaps.map((s) => {
    const w = s.worker, t = w.terms, r = s.result, name = w.name;
    const amounts: Record<string, number> = {};
    const put = (c: number, v: number) => { amounts[String(c)] = (amounts[String(c)] ?? 0) + v; };
    for (const l of r.taxable_earnings) if (l.lre != null) put(l.lre, l.amount);
    for (const l of r.other_earnings) { if (l.lre != null) put(l.lre, l.amount); else { warnings.push(`${name}: «${l.label}» no tiene código del LRE; se informó como gastos por causa del trabajo (2306).`); put(2306, l.amount); } }
    for (const l of r.legal_deductions) if (l.lre != null) put(l.lre, l.amount);
    for (const l of r.other_deductions) put(l.lre ?? 3183, l.amount);
    for (const l of r.employer) { if (l.lre != null) put(l.lre, l.amount); else warn(`«${l.label}» no tiene código en el LRE vigente: no se informa (sí se paga en Previred).`); }
    if (r.advance > 0) put(3188, r.advance);
    let afp = lreAfpCode(t.afp);
    if (afp == null) { warnings.push(`${name}: AFP sin código del LRE; se informó como «no está en AFP» (100).`); afp = 100; }
    let health = t.health_lre_code ?? lreHealthCode(t.health, t.health_name);
    if (health == null) { warnings.push(`${name}: falta el código del LRE de la Isapre (ingrésalo en la ficha).`); health = 0; }
    const region = t.region ?? settings.region ?? (warnings.push(`${name}: falta la región donde presta servicios.`), 0);
    const comuna = t.comuna ?? settings.comuna ?? (warnings.push(`${name}: falta la comuna (código territorial) donde presta servicios.`), 0);
    const mutual = settings.mutual ?? (warn("Falta la mutual o ISL del empleador (datos del empleador)."), 0);
    const end = w.end_date && w.end_date >= from && w.end_date <= to ? w.end_date : null;
    const endCause = end && t.end_cause ? CAUSE_CODE[t.end_cause] ?? null : null;
    if (end && endCause == null) warnings.push(`${name}: terminó este mes; falta la causal de término.`);
    const row: LreRow = {
      rut: w.rut, start_date: w.start_date, end_date: end, end_cause: endCause, region, comuna, jornada: t.jornada ?? 101, disability: t.disability ?? 0,
      pensioner: !!t.pensioner, afp, health, afc: t.afc, ccaf: settings.ccaf, mutual, family_loads: Math.max(t.family_loads ?? 0, 0),
      invalid_loads: Math.max(t.invalid_loads ?? 0, 0), allowance_bracket: r.allowance_bracket, days: Math.min(Math.max(s.input.days ?? 30, 0), 30),
      young_subsidy: !!t.young_subsidy, apvi: !!t.apv, amounts,
    };
    if (lreTotals(amounts)[5501] !== r.to_pay) warnings.push(`${name}: el total líquido del libro no cuadra con la liquidación; revísala.`);
    return row;
  });
  return { rows, warnings };
}

export type { F29Note };
