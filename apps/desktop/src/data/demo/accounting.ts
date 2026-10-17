// Contabilidad de la demostración: mismas reglas que nucleo-app::accounting_ops (Rust) sobre los
// datos en memoria. Plan de cuentas base, asientos automáticos, sumas y saldos y los libros.
import type { AccountingMap, EntryLine, JournalEntry, LedgerAccount, Report, ReportCell } from "../types";

const A = (code: string, name: string, simple: string, nature: LedgerAccount["nature"], postable = true): LedgerAccount => ({
  code, name, simple_name: simple, nature, postable, parent_code: code.includes(".") ? code.slice(0, code.lastIndexOf(".")) : null, archived: false, level: code.split(".").length,
});

export const BASE_CHART: LedgerAccount[] = [
  A("1", "Activo", "Lo que tienes", "activo", false), A("1.1", "Activo circulante", "Dinero, cuentas e inventario", "activo", false),
  A("1.1.01", "Caja", "Dinero en caja", "activo"), A("1.1.02", "Bancos", "Dinero en el banco", "activo"), A("1.1.03", "Clientes", "Dinero que te deben", "activo"),
  A("1.1.04", "IVA crédito fiscal", "IVA de tus compras", "activo"), A("1.1.05", "Mercaderías", "Tu inventario", "activo"),
  A("1.1.06", "Importaciones en curso", "Importaciones por recibir", "activo"), A("1.1.07", "Otros activos circulantes", "Otros activos", "activo"),
  A("1.2", "Activo fijo", "Equipos, vehículos y muebles", "activo", false), A("1.2.01", "Maquinarias y equipos", "Maquinarias y equipos", "activo"),
  A("1.2.02", "Vehículos", "Vehículos", "activo"), A("1.2.03", "Muebles y equipos de oficina", "Muebles y computadores", "activo"),
  A("2", "Pasivo", "Lo que debes", "pasivo", false), A("2.1", "Pasivo circulante", "Deudas de corto plazo", "pasivo", false),
  A("2.1.01", "Proveedores", "Lo que debes a proveedores", "pasivo"), A("2.1.02", "Acreedores varios", "Gastos por pagar", "pasivo"),
  A("2.1.03", "IVA débito fiscal", "IVA de tus ventas", "pasivo"), A("2.1.04", "Remuneraciones por pagar", "Sueldos por pagar", "pasivo"),
  A("2.1.05", "Retenciones y leyes sociales por pagar", "Imposiciones e impuestos retenidos", "pasivo"), A("2.1.06", "Préstamos bancarios", "Créditos del banco", "pasivo"),
  A("3", "Patrimonio", "Lo que es del dueño", "patrimonio", false), A("3.1", "Capital y resultados", "Capital y utilidades", "patrimonio", false),
  A("3.1.01", "Capital", "Capital inicial", "patrimonio"), A("3.1.02", "Aportes del dueño", "Lo que aportaste", "patrimonio"),
  A("3.1.03", "Utilidades acumuladas", "Ganancias de años anteriores", "patrimonio"), A("3.1.04", "Retiros del dueño", "Lo que retiraste", "patrimonio"),
  A("4", "Ingresos", "Lo que ganas", "ingreso", false), A("4.1", "Ingresos de explotación", "Ventas", "ingreso", false), A("4.1.01", "Ventas", "Ventas", "ingreso"),
  A("4.2", "Otros ingresos", "Otros ingresos", "ingreso", false), A("4.2.01", "Sobrantes de inventario", "Inventario que apareció", "ingreso"), A("4.2.02", "Otros ingresos", "Otros ingresos", "ingreso"),
  A("5", "Costos y gastos", "Lo que gastas", "gasto", false), A("5.1", "Costos de explotación", "Costo de lo vendido", "gasto", false),
  A("5.1.01", "Costo de ventas", "Costo de lo vendido", "gasto"), A("5.1.02", "Mermas y ajustes de inventario", "Inventario perdido o dañado", "gasto"),
  A("5.2", "Gastos de administración y ventas", "Gastos del negocio", "gasto", false), A("5.2.01", "Remuneraciones", "Sueldos", "gasto"),
  A("5.2.02", "Gastos de vehículo y transporte", "Vehículo y transporte", "gasto"), A("5.2.03", "Gastos de viaje y alimentación", "Viajes y comidas", "gasto"),
  A("5.2.04", "Gastos de local y oficina", "Local y oficina", "gasto"), A("5.2.05", "Honorarios y capacitación", "Personas y estudios", "gasto"),
  A("5.2.06", "Gastos de ventas y publicidad", "Ventas y publicidad", "gasto"), A("5.2.07", "Gastos de operación", "Operación", "gasto"),
  A("5.2.08", "Servicios contratados", "Servicios", "gasto"), A("5.2.09", "Impuestos, comisiones e intereses", "Impuestos y finanzas", "gasto"),
  A("5.2.99", "Otros gastos", "Otros gastos", "gasto"),
];

export const CONCEPTS: [string, string, string][] = [
  ["caja", "1.1.01", "Cobros y pagos en efectivo (cuentas tipo caja)"], ["bancos", "1.1.02", "Cobros y pagos por banco o billetera digital"],
  ["clientes", "1.1.03", "Ventas por cobrar"], ["iva_credito", "1.1.04", "IVA de compras, gastos e importaciones"], ["mercaderias", "1.1.05", "Inventario"],
  ["importaciones", "1.1.06", "Costos de importación hasta recibir"], ["proveedores", "2.1.01", "Compras e importaciones por pagar"],
  ["acreedores", "2.1.02", "Gastos por pagar"], ["iva_debito", "2.1.03", "IVA de ventas"], ["rem_por_pagar", "2.1.04", "Líquido a pagar de las liquidaciones"],
  ["retenciones", "2.1.05", "Imposiciones, impuesto único y aportes del empleador"], ["capital", "3.1.01", "Saldos iniciales de caja, bancos y stock"],
  ["aportes", "3.1.02", "Stock agregado sin compra («Agregar stock»)"], ["ventas", "4.1.01", "Ventas netas"], ["sobrantes", "4.2.01", "Ajustes de inventario a favor"],
  ["costo_ventas", "5.1.01", "Costo de lo vendido"], ["mermas", "5.1.02", "Ajustes de inventario en contra"],
  ["remuneraciones", "5.2.01", "Costo de las liquidaciones y gastos de remuneraciones"], ["compras_otros", "5.2.99", "Compras de servicios o productos sin stock"],
  ["otros_gastos", "5.2.99", "Gastos sin cuenta propia"],
];
export const DEFAULT_GROUPS: Record<string, string> = {
  "Vehículo y transporte": "5.2.02", "Viajes y comidas": "5.2.03", "Local y oficina": "5.2.04", "Personas y estudios": "5.2.05",
  "Ventas y publicidad": "5.2.06", "Operación": "5.2.07", "Servicios": "5.2.08", "Impuestos y finanzas": "5.2.09",
};

export interface AccFacts {
  sales: { uid: string; number: string; date: string; party: string; total: number; tax: number; cost: number }[];
  cobros: { key: string; number: string; date: string; amount: number; cash: boolean; party: string }[];
  pagos: { key: string; number: string; date: string; amount: number; cash: boolean; party: string; expense: boolean }[];
  purchases: { uid: string; ref: string; date: string; party: string; total: number; tax: number; stock: number }[];
  expenses: { uid: string; number: string; date: string; desc: string; cat: string; group: string; total: number; tax: number }[];
  openings: { key: string; date: string; name: string; cash: boolean; amount: number }[];
  transfers: { key: string; date: string; amount: number; fromCash: boolean; toCash: boolean; from: string; to: string }[];
}

export function resolveMap(m: AccountingMap, chart: LedgerAccount[]): { concept: (k: string) => string; group: (g: string) => string; name: (c: string) => string } {
  const ok = (c: string | undefined) => !!c && chart.some((a) => a.code === c && a.postable && !a.archived);
  const concept = (k: string) => (ok(m.concepts[k]) ? m.concepts[k]! : CONCEPTS.find((x) => x[0] === k)?.[1] ?? "5.2.99");
  return {
    concept,
    group: (g) => (ok(m.groups[g]) ? m.groups[g]! : DEFAULT_GROUPS[g] ?? concept("otros_gastos")),
    name: (c) => chart.find((a) => a.code === c)?.name ?? c,
  };
}

export function buildJournal(f: AccFacts, m: AccountingMap, chart: LedgerAccount[], from: string, to: string): JournalEntry[] {
  const r = resolveMap(m, chart);
  const out: JournalEntry[] = [];
  const inR = (d: string) => d >= from && d <= to;
  const entry = (key: string, date: string, reference: string, description: string, st: string | null, link: string | null, parts: [string, number, boolean][]) => {
    const lines: EntryLine[] = [];
    for (const [code, amount, debit] of parts) {
      if (!amount) continue;
      const d = (amount > 0) === debit;
      lines.push({ account_code: code, account_name: r.name(code), debit_minor: d ? Math.abs(amount) : 0, credit_minor: d ? 0 : Math.abs(amount), memo: null });
    }
    const dd = lines.reduce((a, l) => a + l.debit_minor, 0), cc = lines.reduce((a, l) => a + l.credit_minor, 0);
    if (dd === cc && dd > 0) out.push({ key, date, reference, description, origin: key.startsWith("auto:CTA") ? "apertura" : "automatico", source_type: st, link, status: "calculado", lines });
  };
  const c = r.concept;
  for (const o of f.openings) if (inR(o.date)) entry(`auto:CTA:${o.key}`, o.date, "Saldo inicial", `Saldo inicial de ${o.name}`, null, "/dinero?tab=cuentas", [[c(o.cash ? "caja" : "bancos"), o.amount, true], [c("capital"), o.amount, false]]);
  for (const s of f.sales) if (inR(s.date)) entry(`auto:VEN:${s.uid}`, s.date, s.number, `Venta a ${s.party}`, "VEN", `/ventas/${s.uid}`, [[c("clientes"), s.total, true], [c("ventas"), s.total - s.tax, false], [c("iva_debito"), s.tax, false], [c("costo_ventas"), s.cost, true], [c("mercaderias"), s.cost, false]]);
  for (const p of f.cobros) if (inR(p.date)) entry(`auto:PAG:${p.key}`, p.date, p.number, `Cobro a ${p.party}`, "PAG", null, [[c(p.cash ? "caja" : "bancos"), p.amount, true], [c("clientes"), p.amount, false]]);
  for (const p of f.pagos) if (inR(p.date)) entry(`auto:EGR:${p.key}`, p.date, p.number, `Pago a ${p.party}`, "EGR", null, [[c(p.expense ? "acreedores" : "proveedores"), p.amount, true], [c(p.cash ? "caja" : "bancos"), p.amount, false]]);
  for (const p of f.purchases) if (inR(p.date)) { const net = p.total - p.tax, stock = Math.min(Math.max(p.stock, 0), Math.max(net, 0)); entry(`auto:COM:${p.uid}`, p.date, p.ref, `Compra a ${p.party}`, "COM", `/compras/doc/${p.uid}`, [[c("mercaderias"), stock, true], [c("compras_otros"), net - stock, true], [c("iva_credito"), p.tax, true], [c("proveedores"), p.total, false]]); }
  for (const g of f.expenses) if (inR(g.date)) entry(`auto:GAS:${g.uid}`, g.date, g.number, `Gasto: ${g.desc}`, "GAS", `/gastos/gasto/${g.uid}`, [[g.cat === "Remuneraciones" ? c("remuneraciones") : r.group(g.group), g.total - g.tax, true], [c("iva_credito"), g.tax, true], [c("acreedores"), g.total, false]]);
  for (const t of f.transfers) if (inR(t.date) && t.fromCash !== t.toCash) entry(`auto:TRF:${t.key}`, t.date, "Traspaso", `Traspaso de ${t.from} a ${t.to}`, null, "/dinero?tab=cuentas", [[c(t.toCash ? "caja" : "bancos"), t.amount, true], [c(t.fromCash ? "caja" : "bancos"), t.amount, false]]);
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
}

export interface Trial { code: string; name: string; nature: LedgerAccount["nature"]; debit: number; credit: number; balance: number }
export function trial(entries: JournalEntry[], chart: LedgerAccount[]): Trial[] {
  const by = new Map<string, [number, number]>();
  for (const e of entries) {
    if (e.status === "reversado" && e.origin !== "manual") continue;
    for (const l of e.lines) { const x = by.get(l.account_code) ?? [0, 0]; by.set(l.account_code, [x[0] + l.debit_minor, x[1] + l.credit_minor]); }
  }
  return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([code, [d, c]]) => {
    const a = chart.find((x) => x.code === code);
    return { code, name: a?.name ?? code, nature: a?.nature ?? "gasto", debit: d, credit: c, balance: d - c };
  });
}

const cellOrNull = (v: number): ReportCell => (v ? v : null);
const ppm = (p: number, w: number): ReportCell => (w ? Math.round((p * 1_000_000) / w) : null);

/** Arma los cinco libros contables. `all` = asientos desde el inicio (para saldos anteriores y el balance general). */
export function accountingReport(id: string, r: Report, period: JournalEntry[], all: JournalEntry[], chart: LedgerAccount[], from: string, to: string): void {
  const live = (e: JournalEntry) => e.status !== "reversado" || e.origin === "manual";
  const col = (key: string, label: string, kind: Report["columns"][number]["kind"]) => ({ key, label, kind });
  const kpi = (label: string, value: number, kind: Report["kpis"][number]["kind"], tone: Report["kpis"][number]["tone"] = null) => ({ label, value, kind, tone });
  if (id === "libro_diario") {
    r.columns = [col("fecha", "Fecha", "date"), col("asiento", "Documento", "text"), col("glosa", "Glosa", "text"), col("cuenta", "Cuenta", "text"), col("debe", "Debe", "money"), col("haber", "Haber", "money")];
    let d = 0, h = 0, n = 0;
    for (const e of period.filter(live)) { n++; for (const l of e.lines) { d += l.debit_minor; h += l.credit_minor; r.rows.push([e.date, e.reference, e.status === "reversado" ? `${e.description} (reversado)` : e.description, `${l.account_code} ${l.account_name}`, cellOrNull(l.debit_minor), cellOrNull(l.credit_minor)]); r.links.push(e.link); } }
    r.totals = ["Total", null, null, null, d, h];
    r.kpis = [kpi("Asientos", n, "int"), kpi("Total debe", d, "money"), kpi("Diferencia debe − haber", d - h, "money", d === h ? "success" : "danger")];
    r.notes.push("Los meses abiertos se calculan desde tus documentos; los cerrados muestran lo guardado al cerrarlos (Impuestos → Contabilidad).");
  } else if (id === "libro_mayor") {
    const opening = new Map(trial(all.filter((e) => e.date < from), chart).map((t) => [t.code, t.balance]));
    const by = new Map<string, { name: string; moves: [string, string, string, number, number, string | null][] }>();
    for (const e of period.filter(live)) for (const l of e.lines) { const x = by.get(l.account_code) ?? { name: l.account_name, moves: [] }; x.moves.push([e.date, e.reference, e.description, l.debit_minor, l.credit_minor, e.link]); by.set(l.account_code, x); }
    for (const [code, b] of opening) if (b && !by.has(code)) by.set(code, { name: chart.find((a) => a.code === code)?.name ?? code, moves: [] });
    r.columns = [col("cuenta", "Cuenta", "text"), col("fecha", "Fecha", "date"), col("documento", "Documento", "text"), col("glosa", "Glosa", "text"), col("debe", "Debe", "money"), col("haber", "Haber", "money"), col("saldo", "Saldo", "money")];
    for (const [code, x] of [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const acc = `${code} ${x.name}`; let bal = opening.get(code) ?? 0;
      r.rows.push([acc, null, null, "Saldo anterior", null, null, bal]); r.links.push(null);
      for (const [d, doc, desc, de, ha, link] of x.moves) { bal += de - ha; r.rows.push([acc, d, doc, desc, cellOrNull(de), cellOrNull(ha), bal]); r.links.push(link); }
    }
    r.notes.push("Saldo positivo = deudor (debe mayor que haber); negativo = acreedor.");
  } else if (id === "balance_comprobacion") {
    const rows = trial(period, chart);
    r.columns = [col("codigo", "Código", "text"), col("cuenta", "Cuenta", "text"), col("debitos", "Débitos", "money"), col("creditos", "Créditos", "money"), col("deudor", "Saldo deudor", "money"), col("acreedor", "Saldo acreedor", "money"), col("activo", "Activo", "money"), col("pasivo", "Pasivo", "money"), col("perdidas", "Pérdidas", "money"), col("ganancias", "Ganancias", "money")];
    const t = [0, 0, 0, 0, 0, 0, 0, 0];
    for (const x of rows) {
      const dr = Math.max(x.balance, 0), cr = Math.max(-x.balance, 0), res = x.nature === "ingreso" || x.nature === "gasto";
      const v = [x.debit, x.credit, dr, cr, res ? 0 : dr, res ? 0 : cr, res ? dr : 0, res ? cr : 0];
      v.forEach((n, i) => { t[i]! += n; });
      r.rows.push([x.code, x.name, ...v.map(cellOrNull)]); r.links.push(null);
    }
    const result = t[7]! - t[6]!;
    r.rows.push([null, result >= 0 ? "Utilidad del período" : "Pérdida del período", null, null, null, null, ...(result >= 0 ? [null, cellOrNull(result), cellOrNull(result), null] : [cellOrNull(-result), null, null, cellOrNull(-result)])]); r.links.push(null);
    r.totals = ["Total", null, t[0]!, t[1]!, t[2]!, t[3]!, t[4]! + Math.max(-result, 0), t[5]! + Math.max(result, 0), t[6]! + Math.max(result, 0), t[7]! + Math.max(-result, 0)];
    r.kpis = [kpi("Diferencia débitos − créditos", t[0]! - t[1]!, "money", t[0] === t[1] ? "success" : "danger"), kpi(result >= 0 ? "Utilidad del período" : "Pérdida del período", Math.abs(result), "money", result >= 0 ? "success" : "danger")];
    r.notes.push("Sumas del período elegido. Para el balance del año, elige «Este año».");
  } else if (id === "estado_resultados") {
    const rows = trial(period, chart);
    const sum = (p: string, s: number) => rows.filter((x) => x.code.startsWith(p)).reduce((a, x) => a + s * x.balance, 0);
    const sales = sum("4.1", -1), cost = sum("5.1", 1), other = sum("4.2", -1), gross = sales - cost;
    r.columns = [col("concepto", "Concepto", "text"), col("monto", "Monto", "money"), col("part", "% de las ventas", "pct")];
    const push = (l: string, v: number) => { r.rows.push([l, v, ppm(v, sales)]); r.links.push(null); };
    push("Ingresos de explotación (ventas)", sales);
    for (const x of rows.filter((x) => x.code.startsWith("5.1") && x.balance)) push(`  − ${x.name}`, -x.balance);
    push("= Margen bruto", gross);
    let opex = 0;
    for (const x of rows.filter((x) => x.code.startsWith("5.") && !x.code.startsWith("5.1") && x.balance)) { opex += x.balance; push(`  − ${x.name}`, -x.balance); }
    const op = gross - opex; push("= Resultado operacional", op);
    for (const x of rows.filter((x) => x.code.startsWith("4.2") && x.balance)) push(`  + ${x.name}`, -x.balance);
    const res = op + other; push(`= ${res >= 0 ? "Utilidad" : "Pérdida"} del período (antes de impuesto)`, res);
    r.kpis = [kpi("Ventas", sales, "money"), kpi("Margen bruto", gross, "money"), kpi("Resultado", res, "money", res >= 0 ? "success" : "danger")];
    r.notes.push("Desde los asientos: ventas netas, costo de lo vendido al costo promedio, gastos, remuneraciones y ajustes de inventario. No incluye el impuesto a la renta.");
  } else if (id === "balance_general") {
    const rows = trial(all.filter((e) => e.date <= to), chart);
    r.from = to;
    r.columns = [col("seccion", "Sección", "text"), col("cuenta", "Cuenta", "text"), col("monto", "Monto", "money")];
    const section = (name: string, nature: string, sign: number) => {
      let total = 0;
      for (const x of rows.filter((x) => x.nature === nature && x.balance)) { total += sign * x.balance; r.rows.push([name, `${x.code} ${x.name}`, sign * x.balance]); r.links.push(null); }
      r.rows.push([name, `Total ${name.toLowerCase()}`, total]); r.links.push(null);
      return total;
    };
    const assets = section("Activo", "activo", 1), liab = section("Pasivo", "pasivo", -1), eq = section("Patrimonio", "patrimonio", -1);
    const result = rows.filter((x) => x.nature === "ingreso" || x.nature === "gasto").reduce((a, x) => a - x.balance, 0);
    r.rows.push(["Patrimonio", "Resultado acumulado (utilidad o pérdida)", result]); r.links.push(null);
    const right = liab + eq + result;
    r.rows.push([null, "Pasivo + patrimonio + resultado", right]); r.links.push(null);
    r.kpis = [kpi("Lo que tienes (activo)", assets, "money"), kpi("Lo que debes (pasivo)", liab, "money"), kpi("Patrimonio y resultado", eq + result, "money"), kpi("Diferencia", assets - right, "money", assets === right ? "success" : "danger")];
    r.notes.push(`Saldos acumulados desde el inicio hasta el ${to.split("-").reverse().join("-")}.`);
  }
}
