// Borrador del F22 Pro Pyme general (art. 14 letra D) N°3) — espejo exacto de `nucleo-domain/src/f22.rs`
// (mismas reglas, enteros y textos). `golden/f22.json` se ejecuta contra ambas implementaciones.
// Ningún valor normativo está escrito aquí: tasa, 14 E, UF y factores llegan en la entrada.
import type { F29Note, Severity } from "./f29";

export interface F22Params { idpc_rate_ppm?: number; incentive_rate_ppm?: number; incentive_cap_uf_e4?: number; uf_e2?: number }
export interface PpmPaid { period?: string | null; amount: number; factor_e6: number }
export interface F22Line { code: number; amount: number; label?: string | null }
export interface Registers {
  cpts_initial?: number; dividends_received?: number; withdrawals?: number; foreign_tax_credit_final?: number; capital_historic?: number;
  rex_final?: number; rai_initial?: number; rex_initial?: number; rex_increase?: number;
}
export interface F22Input { params: F22Params; lines?: F22Line[]; art21?: number; incentive?: boolean; rebates?: number; ppm?: PpmPaid[]; registers?: Registers | null }
export interface F22Result { codes: Record<string, number>; idpc_gross: number; notes: F29Note[]; complete: boolean }

const INCOME = [1400, 1817, 1401, 1587, 1588, 1402, 1403];
const EXPENSE = [1406, 1409, 1818, 1411, 1412, 1413, 1415, 1419, 1422, 1424, 1425, 1426];
export const r17Kind = (code: number): 1 | -1 | null => (INCOME.includes(code) ? 1 : EXPENSE.includes(code) ? -1 : null);
export const R17_INCOME = INCOME;
export const R17_EXPENSE = EXPENSE;
export const F22_LABEL: Record<number, string> = {
  1400: "Ingresos del giro percibidos",
  1817: "Ingresos devengados en años anteriores y percibidos en el año",
  1401: "Rentas de fuente extranjera percibidas",
  1587: "Ingresos de operaciones con empresas relacionadas del art. 14 A",
  1588: "Otros ingresos percibidos o devengados",
  1402: "Ingresos por intereses y reajustes",
  1403: "Otros ingresos del giro",
  1410: "Total de ingresos anuales",
  1406: "Existencias al ingresar al régimen",
  1409: "Existencias, insumos y servicios del negocio, pagados",
  1818: "Existencias, insumos y servicios adeudados en años anteriores y pagados en el año",
  1411: "Remuneraciones pagadas",
  1412: "Honorarios pagados",
  1413: "Adquisición de bienes del activo fijo, pagados",
  1415: "Arriendos pagados",
  1419: "Intereses y reajustes pagados por préstamos",
  1422: "Partidas del art. 21 inc. 1° (impuestos, multas e intereses fiscales)",
  1424: "Otros gastos deducibles",
  1425: "Gastos de operaciones con empresas relacionadas del art. 14 A",
  1426: "Pérdida tributaria de años anteriores",
  1430: "Total de egresos anuales",
  1431: "Partidas del art. 21 inc. 1° (se agregan)",
  1729: "Base imponible antes del incentivo al ahorro",
  1432: "Incentivo al ahorro (art. 14 letra E)",
  1440: "Base imponible afecta a impuesto de primera categoría (o pérdida)",
  18: "Base imponible de primera categoría (línea 54)",
  19: "Rebajas al impuesto",
  20: "Impuesto de primera categoría",
  36: "Pagos provisionales mensuales reajustados",
  305: "Resultado de la liquidación anual",
  90: "Impuesto a pagar",
  85: "Saldo a favor",
  1445: "Capital propio tributario simplificado inicial",
  1705: "Base imponible afecta a impuesto de primera categoría",
  1726: "Retiros o dividendos percibidos en el año",
  1479: "Retiros o dividendos repartidos en el año",
  1708: "Partidas del art. 21 inc. 1°",
  1379: "Crédito por impuestos pagados en el exterior imputable a impuestos finales",
  1710: "Incentivo al ahorro (se suma de vuelta)",
  1545: "Capital propio tributario simplificado final",
  1703: "CPTS final",
  1704: "Retiros o dividendos repartidos en el año",
  1720: "Subtotal",
  1493: "Saldo del registro REX al término del año",
  1494: "Capital aportado histórico",
  1500: "Rentas afectas a impuestos finales (RAI) del año",
  1451: "RAI: remanente del año anterior",
  1459: "RAI: reverso del remanente",
  1463: "RAI: aumentos del año",
  1475: "RAI: retiros imputados",
  1484: "RAI: remanente para el año siguiente",
  1454: "REX: remanente del año anterior",
  1470: "REX: aumentos del año",
  1487: "REX: remanente para el año siguiente",
};

const B = BigInt;
const PPM = 1_000_000n;
function divRound(n: bigint, d: bigint): bigint {
  if (d < 0n) { n = -n; d = -d; }
  return n >= 0n ? (n + d / 2n) / d : -((-n + d / 2n) / d);
}

export function computeF22(input: F22Input): F22Result {
  const p = input.params;
  const r: F22Result = { codes: {}, idpc_gross: 0, notes: [], complete: true };
  const note = (severity: Severity, code: number | null, text: string) => {
    if (severity === "falta") r.complete = false;
    if (!r.notes.some((n) => n.text === text)) r.notes.push({ code, severity, text });
  };
  const codes = new Map<number, number>();
  const add = (c: number, v: number) => codes.set(c, (codes.get(c) ?? 0) + v);

  let ppmTotal = 0, ppmNominal = 0;
  for (const x of input.ppm ?? []) {
    if (x.factor_e6 <= 0) note("falta", 36, "Falta el factor de reajuste de algún PPM (tabla del SII de reajuste de PPM).");
    const f = x.factor_e6 > 0 ? x.factor_e6 : 1_000_000;
    ppmTotal += Number(divRound(B(x.amount) * B(f), PPM));
    ppmNominal += x.amount;
  }
  for (const l of input.lines ?? []) {
    if (r17Kind(l.code) != null) add(l.code, l.amount);
    else note("aviso", l.code, `El código ${l.code} no es del recuadro 17: no se consideró.`);
  }
  if (ppmTotal !== ppmNominal) add(1588, ppmTotal - ppmNominal);
  const art21 = input.art21 ?? 0;
  if (art21 !== 0) add(1422, art21);
  let income = 0, expenses = 0;
  for (const [c, v] of codes) { if (r17Kind(c) === 1) income += v; else if (r17Kind(c) === -1) expenses += v; }
  codes.set(1410, income);
  codes.set(1430, expenses);
  if (art21 !== 0) codes.set(1431, art21);
  const before = income - expenses + art21;
  codes.set(1729, before);

  const g = input.registers ?? null;
  const withdrawals = g?.withdrawals ?? 0;
  let incentive = 0;
  if (input.incentive) {
    const rate = p.incentive_rate_ppm ?? 0, capUf = p.incentive_cap_uf_e4 ?? 0, uf = p.uf_e2 ?? 0;
    if (rate <= 0 || capUf <= 0 || uf <= 0) note("falta", 1432, "Para el incentivo al ahorro faltan su porcentaje, el tope en UF y la UF del 31 de diciembre.");
    else {
      const invested = before - withdrawals - art21;
      const cap = Number(divRound(B(capUf) * B(uf), PPM));
      incentive = Math.min(Math.max(Number(divRound(B(invested) * B(rate), PPM)), 0), cap);
      codes.set(1432, incentive);
    }
  }
  const base = before - incentive;
  codes.set(1440, base);

  const rate = p.idpc_rate_ppm ?? 0;
  if (rate <= 0) note("falta", 20, "Falta la tasa del impuesto de primera categoría del año comercial.");
  const taxable = Math.max(base, 0);
  r.idpc_gross = Number(divRound(B(taxable) * B(rate), PPM));
  const rebates = input.rebates ?? 0;
  const tax = Math.max(r.idpc_gross - Math.max(rebates, 0), 0);
  if (base < 0) note("info", 1440, "El año terminó con pérdida tributaria: no hay impuesto de primera categoría y la pérdida se rebaja el próximo año (código 1426).");
  codes.set(18, taxable);
  if (rebates > 0) codes.set(19, rebates);
  codes.set(20, tax);
  if (ppmTotal !== 0) codes.set(36, ppmTotal);
  const result = tax - ppmTotal;
  codes.set(305, result);
  if (result > 0) codes.set(90, result);
  else if (result < 0) {
    codes.set(85, -result);
    note("info", 85, "Queda saldo a favor: en el F22 eliges si lo devuelven (código 87) o lo dejas para el año siguiente.");
  }

  if (!g) note("aviso", null, "Sin los saldos del F22 del año anterior no se calculan el capital propio tributario ni las rentas afectas a impuestos finales.");
  else {
    const n = (v?: number) => v ?? 0;
    const cpts = n(g.cpts_initial) + taxable + n(g.dividends_received) - withdrawals - art21 - n(g.foreign_tax_credit_final) + incentive;
    for (const [c, v] of [[1445, n(g.cpts_initial)], [1705, taxable], [1726, n(g.dividends_received)], [1479, withdrawals], [1708, art21], [1379, n(g.foreign_tax_credit_final)], [1710, incentive]] as const)
      if (v !== 0) codes.set(c, v);
    codes.set(1545, cpts);
    const subtotal = Math.max(cpts, 0) + withdrawals;
    const rai = Math.max(subtotal - n(g.rex_final) - n(g.capital_historic), 0);
    codes.set(1703, Math.max(cpts, 0));
    if (withdrawals !== 0) codes.set(1704, withdrawals);
    codes.set(1720, subtotal);
    if (n(g.rex_final) !== 0) codes.set(1493, n(g.rex_final));
    if (n(g.capital_historic) !== 0) codes.set(1494, n(g.capital_historic));
    codes.set(1500, rai);
    const imputed = Math.min(withdrawals, rai);
    const rexAvail = n(g.rex_initial) + n(g.rex_increase);
    const toRex = Math.min(withdrawals - imputed, rexAvail);
    if (withdrawals - imputed - toRex > 0) note("aviso", 1475, "Los retiros superan las rentas acumuladas: hay retiros en exceso. Revísalo con tu contador.");
    for (const [c, v] of [[1451, n(g.rai_initial)], [1459, n(g.rai_initial)], [1463, rai], [1475, imputed], [1484, rai - imputed], [1454, n(g.rex_initial)], [1470, n(g.rex_increase)], [1487, rexAvail - toRex]] as const)
      if (v !== 0) codes.set(c, v);
    if (withdrawals > 0) note("info", 1475, "Hubo retiros: el crédito que les corresponde (recuadro 21, DJ 1948 y certificado) lo calcula tu contador.");
  }
  r.codes = Object.fromEntries([...codes.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => [String(k), v]));
  return r;
}
