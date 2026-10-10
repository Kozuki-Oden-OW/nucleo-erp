// Liquidación de sueldo — espejo exacto de `nucleo-domain/src/payroll.rs` (mismas reglas, enteros
// y textos). Lo usan la vista previa en vivo y el backend de demostración; `golden/remuneraciones.json`
// se ejecuta contra ambas implementaciones. Ninguna tasa, tope ni tramo está escrito aquí: todo llega
// en los indicadores del mes.
import type { F29Note, Severity } from "./f29";

export interface TaxBracket { up_to_utm_e4?: number | null; factor_ppm: number; rebate_utm_e4?: number }
export type EmployerBase = "pension" | "afc";
export interface EmployerRate { code: string; label: string; rate_ppm: number; base?: EmployerBase }
export type HealthDeduction = "up_to_cap" | "legal_only";
export interface GratificationRule { rate_ppm: number; cap_imm_e4: number }
export interface AfcRates { worker_indefinite_ppm?: number; employer_indefinite_ppm?: number; employer_fixed_ppm?: number }
export interface PayrollParams {
  uf_e2?: number; utm?: number; imm?: number; cap_pension_uf_e4?: number; cap_afc_uf_e4?: number; health_ppm?: number;
  afc?: AfcRates; employer?: EmployerRate[]; accident_ppm?: number; tax_brackets?: TaxBracket[];
  gratification?: GratificationRule | null; overtime_surcharge_ppm?: number; health_deduction?: HealthDeduction;
}
export type ContractKind = "indefinido" | "plazo_fijo" | "sin_contrato";
export type Health =
  | { kind: "fonasa" }
  | { kind: "isapre"; plan_uf_e4?: number | null; plan_clp?: number | null }
  | { kind: "ninguna" };
export interface WorkerTerms {
  contract?: ContractKind; owner_salary?: boolean; afp_ppm?: number | null; afp_name?: string | null;
  health?: Health; health_name?: string | null; afc?: boolean; employer_contrib?: boolean; accident?: boolean;
  weekly_hours?: number | null;
}
export type GratificationMode = "ninguna" | "art50" | "fija";
export interface EarningItem { label: string; amount: number; taxable?: boolean; lre?: number | null }
export interface DeductionItem { label: string; amount: number; lre?: number | null }
export interface PayslipInput {
  params: PayrollParams; worker: WorkerTerms; base_salary: number; days?: number; overtime_hours_e2?: number;
  overtime_surcharge_ppm?: number | null; gratification?: GratificationMode; gratification_amount?: number;
  items?: EarningItem[]; deductions?: DeductionItem[]; advance?: number;
}
export interface PayLine { key: string; label: string; amount: number; lre: number | null; detail: string | null }
export interface PayslipResult {
  taxable_earnings: PayLine[]; other_earnings: PayLine[]; legal_deductions: PayLine[]; other_deductions: PayLine[];
  employer: PayLine[]; total_taxable: number; cap_pension: number; cap_afc: number; pension_base: number; afc_base: number;
  tax_base: number; tax: number; tax_bracket: number; total_earnings: number; total_deductions: number; net: number;
  advance: number; to_pay: number; employer_total: number; employer_cost: number; notes: F29Note[]; complete: boolean;
}

const B = BigInt;
const PPM = 1_000_000n;
function divRound(n: bigint, d: bigint): bigint {
  if (d < 0n) { n = -n; d = -d; }
  return n >= 0n ? (n + d / 2n) / d : -((-n + d / 2n) / d);
}
const mulPpm = (base: number, rate: number) => Number(divRound(B(base) * B(rate), PPM));
/** Monto en UF × 10.000 → pesos con la UF × 100. */
export const ufToClp = (ufE4: number, ufE2: number) => Number(divRound(B(ufE4) * B(ufE2), 1_000_000n));

function money(v: number): string {
  const s = String(Math.abs(v));
  let out = "";
  for (let i = 0; i < s.length; i++) { if (i > 0 && (s.length - i) % 3 === 0) out += "."; out += s[i]; }
  return `${v < 0 ? "−" : ""}$${out}`;
}
function dec4(e4: number): string {
  const whole = Math.trunc(e4 / 10_000), frac = e4 % 10_000;
  return frac === 0 ? String(whole) : `${whole},${String(frac).padStart(4, "0").replace(/0+$/, "")}`;
}
export function pct(ppm: number): string {
  const whole = Math.trunc(ppm / 10_000), frac = Math.abs(ppm % 10_000);
  return frac === 0 ? `${whole} %` : `${whole},${String(frac).padStart(4, "0").replace(/0+$/, "")} %`;
}
const utmTxt = (e4: number) => `${dec4(e4)} UTM`;
export const ufLabel = (e4: number) => `${dec4(e4)} UF`;
const ufValue = (e2: number) => `${money(Math.trunc(e2 / 100)).replace("$", "")},${String(e2 % 100).padStart(2, "0")}`;
const hoursTxt = (e2: number) => e2 % 100 === 0 ? String(e2 / 100) : `${Math.trunc(e2 / 100)},${String(e2 % 100).padStart(2, "0")}`.replace(/0+$/, "");

const line = (key: string, label: string, amount: number, lre: number | null, detail: string | null): PayLine => ({ key, label, amount, lre, detail });
const sum = (ls: PayLine[]) => ls.reduce((a, l) => a + l.amount, 0);
const INF = Number.MAX_SAFE_INTEGER;

export function computePayslip(input: PayslipInput): PayslipResult {
  const p = input.params, w = input.worker;
  const uf = p.uf_e2 ?? 0, utm = p.utm ?? 0, imm = p.imm ?? 0, healthPpm = p.health_ppm ?? 0;
  const afcR = { worker_indefinite_ppm: 0, employer_indefinite_ppm: 0, employer_fixed_ppm: 0, ...p.afc };
  const contract = w.contract ?? "indefinido";
  const health: Health = w.health ?? { kind: "fonasa" };
  const r: PayslipResult = {
    taxable_earnings: [], other_earnings: [], legal_deductions: [], other_deductions: [], employer: [],
    total_taxable: 0, cap_pension: 0, cap_afc: 0, pension_base: 0, afc_base: 0, tax_base: 0, tax: 0, tax_bracket: 0,
    total_earnings: 0, total_deductions: 0, net: 0, advance: 0, to_pay: 0, employer_total: 0, employer_cost: 0, notes: [], complete: true,
  };
  const note = (severity: Severity, text: string) => {
    if (severity === "falta") r.complete = false;
    if (!r.notes.some((n) => n.text === text)) r.notes.push({ code: null, severity, text });
  };

  // 1. Sueldo proporcional (mes comercial de 30 días).
  const rawDays = input.days ?? 30;
  const days = Math.min(Math.max(rawDays, 0), 30);
  if (days !== rawDays) note("aviso", "Los días trabajados deben estar entre 0 y 30 (mes comercial).");
  const salary = days === 30 ? input.base_salary : Number(divRound(B(input.base_salary) * B(days), 30n));
  r.taxable_earnings.push(w.owner_salary
    ? line("sueldo_empresarial", "Sueldo empresarial", salary, 2161, days !== 30 ? `${money(input.base_salary)} / 30 × ${days} días` : null)
    : line("sueldo", "Sueldo base", salary, 2101, days !== 30 ? `${money(input.base_salary)} / 30 × ${days} días` : null));

  // 2. Horas extra.
  let overtime = 0;
  const otH = input.overtime_hours_e2 ?? 0;
  if (otH > 0) {
    const surcharge = input.overtime_surcharge_ppm ?? p.overtime_surcharge_ppm ?? 0;
    const h = w.weekly_hours != null && w.weekly_hours > 0 ? w.weekly_hours : null;
    if (h == null) note("falta", "Para calcular las horas extra falta la jornada semanal del contrato.");
    else if (surcharge <= 0) note("falta", "Falta el recargo de las horas extra (en los indicadores del mes o en el contrato).");
    else {
      const base = imm > 0 && input.base_salary < imm ? imm : input.base_salary;
      overtime = Number(divRound(B(base) * 28n * (PPM + B(surcharge)) * B(otH), 30n * B(h) * 4n * PPM * 100n));
      r.taxable_earnings.push(line("horas_extra", "Horas extra", overtime, 2102,
        `${money(base)} / 30 × 28 / (${h} h × 4) × (1 + ${pct(surcharge)}) × ${hoursTxt(otH)} h`));
    }
  }

  // 3. Haberes imponibles.
  let taxableItems = 0;
  for (const it of (input.items ?? []).filter((i) => (i.taxable ?? true) && i.amount !== 0)) {
    taxableItems += it.amount;
    r.taxable_earnings.push(line("haber", it.label, it.amount, it.lre ?? null, null));
  }

  // 4. Gratificación.
  const mode = input.gratification ?? "ninguna";
  if (mode === "fija") {
    const g = input.gratification_amount ?? 0;
    if (g > 0) r.taxable_earnings.push(line("gratificacion", "Gratificación", g, 2106, "Monto pactado"));
  } else if (mode === "art50") {
    const g = p.gratification;
    if (g && imm > 0) {
      const base = salary + overtime + taxableItems;
      const a = B(base) * B(g.rate_ppm) * 12n * 10_000n;
      const b = B(imm) * B(g.cap_imm_e4) * PPM;
      const capped = b < a;
      const amount = Number(divRound(capped ? b : a, 12n * 10_000n * PPM));
      r.taxable_earnings.push(line("gratificacion", "Gratificación legal (art. 50)", amount, 2106,
        capped ? `Tope mensual: ${dec4(g.cap_imm_e4)} ingresos mínimos de ${money(imm)} / 12` : `${pct(g.rate_ppm)} de ${money(base)}`));
    } else note("falta", "Para la gratificación del art. 50 faltan el ingreso mínimo y la regla de gratificación en los indicadores del mes.");
  }
  r.total_taxable = sum(r.taxable_earnings);

  // 5. Topes imponibles.
  const capP = p.cap_pension_uf_e4 ?? 0, capA = p.cap_afc_uf_e4 ?? 0;
  if (uf <= 0 || capP <= 0) note("falta", "Faltan la UF del cierre del mes y el tope imponible (indicadores del mes).");
  const capPension = uf > 0 && capP > 0 ? ufToClp(capP, uf) : INF;
  const capAfc = uf > 0 && capA > 0 ? ufToClp(capA, uf) : INF;
  r.cap_pension = capPension === INF ? 0 : capPension;
  r.cap_afc = capAfc === INF ? 0 : capAfc;
  r.pension_base = Math.max(Math.min(r.total_taxable, capPension), 0);
  r.afc_base = Math.max(Math.min(r.total_taxable, capAfc), 0);
  if (r.total_taxable > capPension) note("info", `Lo imponible supera el tope de ${ufLabel(capP)}: las cotizaciones se calculan sobre ${money(r.cap_pension)}.`);
  if (days === 30 && imm > 0 && r.total_taxable < imm && (w.weekly_hours == null || w.weekly_hours >= 30))
    note("aviso", `Lo imponible (${money(r.total_taxable)}) es menor que el ingreso mínimo (${money(imm)}).`);

  // 6. AFP.
  let afp = 0;
  if (w.afp_ppm != null) {
    afp = mulPpm(r.pension_base, w.afp_ppm);
    r.legal_deductions.push(line("afp", w.afp_name ? `AFP ${w.afp_name}` : "AFP", afp, 3141, `${money(r.pension_base)} × ${pct(w.afp_ppm)}`));
  }

  // 7. Salud.
  let healthDeduction = 0;
  if (health.kind !== "ninguna") {
    if (healthPpm <= 0) note("falta", "Falta la tasa de cotización legal de salud en los indicadores del mes.");
    const legal = mulPpm(r.pension_base, healthPpm);
    const label = health.kind === "fonasa" ? "Salud (Fonasa)" : w.health_name ? `Salud ${w.health_name} (cotización legal)` : "Salud Isapre (cotización legal)";
    r.legal_deductions.push(line("salud", label, legal, 3143, `${money(r.pension_base)} × ${pct(healthPpm)}`));
    let additional = 0;
    if (health.kind === "isapre") {
      const plan: [number, string] | null = health.plan_uf_e4 != null && uf > 0
        ? [ufToClp(health.plan_uf_e4, uf), `Plan ${ufLabel(health.plan_uf_e4)} × UF ${ufValue(uf)}`]
        : health.plan_clp != null ? [health.plan_clp, "Plan pactado en pesos"] : null;
      if (!plan) note("falta", "Falta el valor del plan de Isapre (en UF o en pesos).");
      else {
        additional = Math.max(plan[0] - legal, 0);
        if (additional > 0) r.legal_deductions.push(line("salud_adicional", "Salud: adicional del plan Isapre", additional, 3144, `${plan[1]} = ${money(plan[0])} − ${money(legal)}`));
        else note("info", `La cotización legal de ${pct(healthPpm)} (${money(legal)}) cubre el plan de Isapre (${money(plan[0])}): la diferencia queda como excedente en la Isapre.`);
      }
    }
    healthDeduction = (p.health_deduction ?? "up_to_cap") === "legal_only"
      ? legal
      : Math.min(legal + additional, capPension === INF ? INF : mulPpm(capPension, healthPpm));
  }

  // 8. Seguro de cesantía.
  let afcWorker = 0;
  if (w.afc) {
    if (contract === "sin_contrato") note("aviso", "El seguro de cesantía exige contrato de trabajo: con sueldo empresarial normalmente no se cotiza. Confírmalo con tu contador.");
    else if (contract === "indefinido") {
      afcWorker = mulPpm(r.afc_base, afcR.worker_indefinite_ppm);
      if (afcWorker > 0) r.legal_deductions.push(line("afc", "Seguro de cesantía", afcWorker, 3151, `${money(r.afc_base)} × ${pct(afcR.worker_indefinite_ppm)}`));
    }
  }

  // 9. Impuesto único.
  r.tax_base = Math.max(r.total_taxable - afp - healthDeduction - afcWorker, 0);
  const brackets = p.tax_brackets ?? [];
  if (utm <= 0 || brackets.length === 0) note("falta", "Faltan la UTM del mes y la tabla del impuesto único (indicadores del mes).");
  else {
    const baseE4 = B(r.tax_base) * 10_000n;
    let idx = brackets.findIndex((b) => b.up_to_utm_e4 == null || baseE4 <= B(b.up_to_utm_e4) * B(utm));
    if (idx < 0) idx = brackets.length - 1;
    const b = brackets[idx]!;
    r.tax_bracket = idx + 1;
    const taxE6 = B(r.tax_base) * B(b.factor_ppm) - B(b.rebate_utm_e4 ?? 0) * B(utm) * 100n;
    r.tax = Number(divRound(taxE6 > 0n ? taxE6 : 0n, PPM));
    const detail = b.factor_ppm === 0
      ? `Base ${money(r.tax_base)}: tramo exento (hasta ${b.up_to_utm_e4 != null ? utmTxt(b.up_to_utm_e4) : ""})`
      : `${money(r.tax_base)} × ${pct(b.factor_ppm)} − ${utmTxt(b.rebate_utm_e4 ?? 0)} × ${money(utm)}`;
    r.legal_deductions.push(line("impuesto", "Impuesto único", r.tax, 3161, detail));
  }

  // 10–11. No imponibles y descuentos voluntarios.
  for (const it of (input.items ?? []).filter((i) => !(i.taxable ?? true) && i.amount !== 0)) r.other_earnings.push(line("haber", it.label, it.amount, it.lre ?? null, null));
  for (const d of (input.deductions ?? []).filter((d) => d.amount !== 0)) r.other_deductions.push(line("descuento", d.label, d.amount, d.lre ?? null, null));

  r.total_earnings = r.total_taxable + sum(r.other_earnings);
  r.total_deductions = sum(r.legal_deductions) + sum(r.other_deductions);
  r.net = r.total_earnings - r.total_deductions;
  r.advance = Math.max(input.advance ?? 0, 0);
  r.to_pay = r.net - r.advance;
  if (r.to_pay < 0) note("aviso", "Los descuentos y el anticipo superan lo que corresponde pagar: revisa los descuentos voluntarios.");

  // 12. Aportes del empleador.
  if (w.employer_contrib ?? true) {
    for (const e of (p.employer ?? []).filter((e) => e.rate_ppm > 0)) {
      const base = (e.base ?? "pension") === "afc" ? r.afc_base : r.pension_base;
      r.employer.push(line(e.code, e.label, mulPpm(base, e.rate_ppm), null, `${money(base)} × ${pct(e.rate_ppm)}`));
    }
  }
  if (w.afc) {
    const rate = contract === "indefinido" ? afcR.employer_indefinite_ppm : contract === "plazo_fijo" ? afcR.employer_fixed_ppm : 0;
    if (rate > 0) r.employer.push(line("afc_empleador", "Seguro de cesantía (empleador)", mulPpm(r.afc_base, rate), 4151, `${money(r.afc_base)} × ${pct(rate)}`));
  }
  const acc = p.accident_ppm ?? 0;
  if ((w.accident ?? true) && acc > 0)
    r.employer.push(line("ley16744", "Accidentes del trabajo (Ley 16.744)", mulPpm(r.pension_base, acc), 4152, `${money(r.pension_base)} × ${pct(acc)}`));
  r.employer_total = sum(r.employer);
  r.employer_cost = r.total_earnings + r.employer_total;
  return r;
}
