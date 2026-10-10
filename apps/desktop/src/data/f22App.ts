// Armado del borrador del F22 a partir de lo acumulado del año — espejo de la segunda mitad de
// `build_f22` en `nucleo-app/src/f22_ops.rs` (reemplazos manuales, PPM por mes, avisos y cálculo).
// Lo usa el backend de demostración; el escritorio lo hace en Rust.
import { computeF22, F22_LABEL, type F22Input, type F22Line, type PpmPaid, type Registers } from "./f22";
import type { F29Note } from "./f29";
import type { F22DerivedLine, F22Inputs, F22PpmRow, F22View } from "./types";

export const EMPTY_F22_INPUTS: F22Inputs = {
  params: {}, incentive: false, art21: 0, rebates: 0, registers: {}, overrides: {}, extra: [], ppm_factors: {}, ppm_overrides: {},
};

export interface F22Acc { amount: number; count: number; source: string[] }

export function assembleF22(year: number, regime: string, today: string, inputs: F22Inputs, acc: Map<number, F22Acc>,
  declaredPpm: Record<string, number>, checks: F29Note[], status = "borrador"): F22View {
  const to = `${year}-12-31`;
  const inProgress = today <= to;
  const derived: F22DerivedLine[] = [];
  const lines: F22Line[] = [];
  const codes = new Set<number>([...acc.keys(), ...Object.keys(inputs.overrides).map(Number)]);
  for (const code of [...codes].sort((a, b) => a - b)) {
    const a = acc.get(code) ?? { amount: 0, count: 0, source: [] };
    const ov = inputs.overrides[String(code)];
    const used = ov ?? a.amount;
    derived.push({ code, label: F22_LABEL[code] ?? "", amount: a.amount, count: a.count, source: a.source.length ? a.source.join(", ") : "ingresado a mano", used, overridden: ov !== undefined });
    if (used !== 0) lines.push({ code, amount: used, label: null });
  }
  lines.push(...inputs.extra);
  const ppmRows: F22PpmRow[] = [];
  const ppm: PpmPaid[] = [];
  for (let m = 1; m <= 12; m++) {
    const key = String(m).padStart(2, "0"), period = `${year}-${key}`;
    const manual = inputs.ppm_overrides[key], dec = declaredPpm[period];
    const [amount, source] = manual !== undefined ? [manual, "manual" as const] : dec !== undefined ? [dec, "declarado" as const] : [null, "sin_dato" as const];
    const factor = inputs.ppm_factors[key] ?? null;
    if (amount) ppm.push({ period, amount, factor_e6: factor ?? 0 });
    ppmRows.push({ period, amount, source, factor_e6: factor });
  }
  const missing = ppmRows.filter((r) => r.source === "sin_dato" && (!inProgress || r.period < today)).length;
  if (missing > 0) checks.push({ code: null, severity: "aviso", text: `${missing} mes(es) sin PPM: marca esos F29 como declarados en Impuestos o ingresa el PPM pagado.` });
  if (inProgress) checks.push({ code: null, severity: "info", text: `El año ${year} aún no termina: este borrador es una proyección con lo registrado hasta hoy.` });
  if (regime !== "14d3") checks.push({ code: null, severity: "falta", text: "Por ahora NÚCLEO prepara el F22 del régimen Pro Pyme general (14 D N°3). Para tu régimen, usa esta vista solo como referencia de lo cobrado y pagado." });
  const reg: Registers = inputs.registers ?? {};
  const hasRegisters = Object.values(reg).some((v) => (v ?? 0) !== 0);
  const input: F22Input = { params: { ...inputs.params }, lines, art21: inputs.art21, incentive: inputs.incentive, rebates: inputs.rebates, ppm, registers: hasRegisters ? { ...reg } : null };
  const result = computeF22(input);
  const without = input.incentive ? computeF22({ ...input, incentive: false }) : null;
  return { year, tax_year: year + 1, regime, in_progress: inProgress, inputs: structuredClone(inputs), derived, ppm: ppmRows, input, result, without_incentive: without, checks, status };
}

/** Código del recuadro 17 para una categoría de gasto (igual que el escritorio). */
export function expenseCode(category: string | null | undefined): number {
  const c = (category ?? "").toLowerCase();
  if (c.includes("arriendo")) return 1415;
  if (c.includes("remunera")) return 1411;
  if (c.includes("honorario")) return 1412;
  if (c.includes("maquinaria") || c.includes("equipo") || c.includes("activo")) return 1413;
  if (c.includes("interes") || c.includes("interés")) return 1419;
  return 1424;
}
