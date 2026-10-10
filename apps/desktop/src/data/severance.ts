// Finiquito básico — espejo exacto de `nucleo-domain/src/severance.rs` (mismas reglas, enteros y
// textos). `golden/finiquito.json` se ejecuta contra ambas implementaciones. Ningún tope ni número
// de días está escrito aquí: llegan en las reglas.
import type { F29Note, Severity } from "./f29";
import type { DeductionItem, PayLine } from "./payroll";
import { ufToClp } from "./payroll";

export type Cause = "mutuo_acuerdo" | "renuncia" | "muerte" | "vencimiento_plazo" | "conclusion_obra" | "necesidades_empresa" | "desahucio" | "art160";
export const CAUSE_LABEL: Record<Cause, string> = {
  necesidades_empresa: "Necesidades de la empresa (art. 161)",
  desahucio: "Desahucio del empleador (art. 161)",
  renuncia: "Renuncia voluntaria (art. 159 N°2)",
  mutuo_acuerdo: "Mutuo acuerdo (art. 159 N°1)",
  vencimiento_plazo: "Vencimiento del plazo (art. 159 N°4)",
  conclusion_obra: "Conclusión de la obra o faena (art. 159 N°5)",
  muerte: "Muerte del trabajador (art. 159 N°3)",
  art160: "Causal del art. 160 (conducta del trabajador)",
};
const LRE_CAUSE: Record<Cause, number | null> = {
  mutuo_acuerdo: 3, renuncia: 4, muerte: 5, vencimiento_plazo: 6, conclusion_obra: 7, necesidades_empresa: 18, desahucio: 19, art160: null,
};
const is161 = (c: Cause) => c === "necesidades_empresa" || c === "desahucio";

export interface SeveranceRules {
  uf_e2?: number; cap_uf_e4?: number; cap_years?: number; vacation_days_per_year?: number; obra_days_per_month_e2?: number; holidays?: string[];
}
export interface SeveranceInput {
  rules: SeveranceRules; start_date: string; end_date: string; cause: Cause; notice_given?: boolean; base_172: number; vacation_base: number;
  pending_vacation_days_e2?: number; vacation_taken_days_e2?: number; afc_offset?: number; deductions?: DeductionItem[];
}
export interface SeveranceResult {
  earnings: PayLine[]; deductions: PayLine[]; total_earnings: number; total_deductions: number; to_pay: number;
  service_years: number; service_months: number; service_days: number; ias_years: number; capped_base: number;
  vacation_business_days_e2: number; vacation_calendar_days_e2: number; lre_cause: number | null; notes: F29Note[]; complete: boolean;
}

const B = BigInt;
function divRound(n: bigint, d: bigint): bigint {
  if (d < 0n) { n = -n; d = -d; }
  return n >= 0n ? (n + d / 2n) / d : -((-n + d / 2n) / d);
}
const daysInMonth = (y: number, m: number) => (m === 2 ? ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28) : [4, 6, 9, 11].includes(m) ? 30 : 31);
function parseDate(s: string): [number, number, number] | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const y = Number(s.slice(0, 4)), m = Number(s.slice(5, 7)), d = Number(s.slice(8, 10));
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m) ? [y, m, d] : null;
}
const toDays = (y: number, m: number, d: number) => Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
function fromDays(z: number): [number, number, number] {
  const t = new Date(z * 86_400_000);
  return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()];
}
const iso = (z: number) => { const [y, m, d] = fromDays(z); return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`; };
function service(start: [number, number, number], end: [number, number, number]): [number, number, number] {
  const [ey, em, ed] = fromDays(toDays(...end) + 1);
  const [sy, sm, sd] = start;
  let months = (ey - sy) * 12 + (em - sm), days = ed - sd;
  if (days < 0) { months -= 1; const [py, pm] = em === 1 ? [ey - 1, 12] : [ey, em - 1]; days += daysInMonth(py, pm); }
  return [Math.floor(months / 12), ((months % 12) + 12) % 12, days];
}
function money(v: number): string {
  const s = String(Math.abs(v));
  let out = "";
  for (let i = 0; i < s.length; i++) { if (i > 0 && (s.length - i) % 3 === 0) out += "."; out += s[i]; }
  return `${v < 0 ? "−" : ""}$${out}`;
}
const dec2 = (e2: number) => (e2 % 100 === 0 ? String(e2 / 100) : `${Math.trunc(e2 / 100)},${String(e2 % 100).padStart(2, "0")}`.replace(/0+$/, ""));
const line = (key: string, label: string, amount: number, lre: number | null, detail: string): PayLine => ({ key, label, amount, lre, detail });

export function computeSeverance(input: SeveranceInput): SeveranceResult {
  const rules = input.rules;
  const r: SeveranceResult = {
    earnings: [], deductions: [], total_earnings: 0, total_deductions: 0, to_pay: 0, service_years: 0, service_months: 0, service_days: 0,
    ias_years: 0, capped_base: 0, vacation_business_days_e2: 0, vacation_calendar_days_e2: 0, lre_cause: LRE_CAUSE[input.cause], notes: [], complete: true,
  };
  const note = (severity: Severity, text: string) => {
    if (severity === "falta") r.complete = false;
    if (!r.notes.some((n) => n.text === text)) r.notes.push({ code: null, severity, text });
  };
  const start = parseDate(input.start_date), end = parseDate(input.end_date);
  if (!start || !end) { note("falta", "Las fechas de ingreso y de término deben ser válidas (AAAA-MM-DD)."); return r; }
  const zs = toDays(...start), ze = toDays(...end);
  if (ze < zs) { note("falta", "La fecha de término no puede ser anterior a la de ingreso."); return r; }
  const [years, months, days] = service(start, end);
  r.service_years = years; r.service_months = months; r.service_days = days;

  const uf = rules.uf_e2 ?? 0, capUf = rules.cap_uf_e4 ?? 0;
  const cap = uf > 0 && capUf > 0 ? ufToClp(capUf, uf) : null;
  r.capped_base = cap == null ? input.base_172 : Math.min(input.base_172, cap);
  const needsCap = is161(input.cause);
  if (needsCap && cap == null) note("falta", "Faltan la UF y el tope en UF de la base de las indemnizaciones (indicadores del mes).");
  if (needsCap && cap != null && input.base_172 > cap) note("info", `La última remuneración supera el tope legal: las indemnizaciones se calculan sobre ${money(r.capped_base)}.`);

  // 1. Feriado.
  const perYear = rules.vacation_days_per_year ?? 0;
  let lastDay = ze;
  if (perYear <= 0) note("falta", "Faltan los días de feriado por año (indicadores del mes).");
  else {
    const proportional = Number(divRound(B(perYear) * 100n * B(months * 30 + days), 360n));
    const business = Math.max((input.pending_vacation_days_e2 ?? 0) + proportional - (input.vacation_taken_days_e2 ?? 0), 0);
    r.vacation_business_days_e2 = business;
    const holidays = (rules.holidays ?? []).map(parseDate).filter((x): x is [number, number, number] => !!x).map((x) => toDays(...x));
    if (!holidays.length && business > 0) note("aviso", "No hay feriados nacionales en los indicadores: solo se sumaron sábados y domingos al convertir el feriado a días corridos.");
    let left = business, calendar = 0;
    while (left > 0) {
      lastDay += 1;
      const wd = (((lastDay + 4) % 7) + 7) % 7;
      if (wd === 0 || wd === 6 || holidays.includes(lastDay)) calendar += 100;
      else { const take = Math.min(left, 100); left -= take; calendar += take; }
    }
    r.vacation_calendar_days_e2 = calendar;
    if (calendar > 0) {
      const amount = Number(divRound(B(input.vacation_base) * B(calendar), 3000n));
      r.earnings.push(line("feriado", "Indemnización por feriado", amount, 2313,
        `${dec2(business)} días hábiles (hasta el ${iso(lastDay)}) = ${dec2(calendar)} días corridos × ${money(input.vacation_base)} / 30`));
    }
  }

  // 2. Art. 161.
  if (is161(input.cause)) {
    if (!input.notice_given) r.earnings.push(line("aviso_previo", "Indemnización sustitutiva del aviso previo", r.capped_base, 2315, "Una remuneración mensual (no se dio aviso con 30 días)"));
    if (years >= 1) {
      const fraction = months > 6 || (months === 6 && days > 0);
      const paid = years + (fraction ? 1 : 0);
      const capYears = rules.cap_years ?? 0;
      if (capYears > 0) r.ias_years = Math.min(paid, capYears);
      else { note("falta", "Falta el tope de años de la indemnización (indicadores del mes)."); r.ias_years = paid; }
      const ias = r.capped_base * r.ias_years;
      r.earnings.push(line("anios_servicio", "Indemnización por años de servicio", ias, 2314,
        `${money(r.capped_base)} × ${r.ias_years} año(s)${fraction ? " (la fracción de más de seis meses cuenta como año)" : ""}`));
      const off = input.afc_offset ?? 0;
      if (off > 0) r.deductions.push(line("aporte_afc", "Aporte del empleador al seguro de cesantía (art. 13 Ley 19.728)", Math.min(off, ias), 3185, "Se descuenta de la indemnización por años de servicio"));
      else note("info", "Por necesidades de la empresa, el empleador puede descontar de la indemnización su aporte a la cuenta individual del seguro de cesantía: pide el certificado a la AFC.");
    } else note("info", "Con menos de un año de servicio no corresponde indemnización por años de servicio.");
  }

  // 3. Obra o faena.
  if (input.cause === "conclusion_obra") {
    const worked = years * 12 + months + (days > 15 ? 1 : 0);
    const perMonth = rules.obra_days_per_month_e2 ?? 0;
    if (perMonth <= 0) note("falta", "Faltan los días por mes de la indemnización por obra o faena (indicadores del mes).");
    else if (worked >= 1) {
      const amount = Number(divRound(B(input.base_172) * B(perMonth * worked), 3000n));
      r.earnings.push(line("obra_faena", "Indemnización por tiempo servido (obra o faena)", amount, 2314, `${dec2(perMonth)} días × ${worked} mes(es) × ${money(input.base_172)} / 30`));
    }
  }
  if (input.cause === "art160") note("aviso", "Con una causal del art. 160 no hay indemnización por años de servicio ni aviso previo. Si la persona reclama y el juez no la acoge, se pagan con recargo: asesórate.");

  for (const d of (input.deductions ?? []).filter((d) => d.amount !== 0)) r.deductions.push({ key: "descuento", label: d.label, amount: d.amount, lre: d.lre ?? null, detail: null });
  r.total_earnings = r.earnings.reduce((a, l) => a + l.amount, 0);
  r.total_deductions = r.deductions.reduce((a, l) => a + l.amount, 0);
  r.to_pay = r.total_earnings - r.total_deductions;
  note("info", "El sueldo de los días trabajados del último mes se paga con su liquidación normal. El finiquito se firma ante un ministro de fe (notario, inspección del trabajo) o en el portal de la Dirección del Trabajo.");
  return r;
}
