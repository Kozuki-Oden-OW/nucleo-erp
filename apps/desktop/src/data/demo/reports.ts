// Reportes de la demostración: misma estructura y reglas que nucleo-app::report_ops (Rust),
// calculados sobre los datos en memoria. El escritorio usa la versión en Rust.
import type { DueRow, Report, ReportCell, ReportColumn, ReportColumnKind, ReportDef, ReportKpi } from "../types";

export interface FactLine { product_uid: string | null; sku: string; name: string; category: string | null; unit: string; qty: number; net: number; cost: number }
export interface FactSale { uid: string; date: string; customer_key: string; customer: string; rut: string | null; net: number; tax: number; total: number; cost: number; lines: FactLine[] }
export interface FactExpense { date: string; category_id: number; category: string; behavior: "fijo" | "variable"; net: number; tax: number; total: number }
export interface FactPurchase { date: string; supplier_key: string; supplier: string; rut: string | null; net: number; exempt: number; tax: number; total: number; pending: number }
export interface FactProduct { uid: string; sku: string; name: string; category: string | null; stock: number; unit: string; cost_e4: number }
export interface FactImport { uid: string; number: string; supplier: string; stage: string; date: string; eta: string | null; currency: string; fob: number | null; landed: number | null; units: number }
export interface Facts {
  today: string;
  sales: FactSale[];
  expenses: FactExpense[];
  purchases: FactPurchase[];
  products: FactProduct[];
  receivables: (DueRow & { issue_date: string })[];
  payables: DueRow[];
  cash: { date: string; amount: number }[];
  openingCash: number;
  payroll: { period: string; cost: number }[];
  imports: FactImport[];
}

interface Def { id: string; group: string; title: string; description: string; uses_period: boolean; perms: string[] }
export const REPORT_DEFS: Def[] = [
  { id: "ventas_periodo", group: "Ventas", title: "Ventas por período", description: "Neto, IVA, total y margen por mes, semana o día.", uses_period: true, perms: ["ventas.ver"] },
  { id: "ventas_cliente", group: "Ventas", title: "Ventas por cliente", description: "Quiénes te compran más y cuánto margen te dejan.", uses_period: true, perms: ["ventas.ver"] },
  { id: "ventas_producto", group: "Ventas", title: "Ventas por producto", description: "Cantidades, neto, costo y margen de cada producto o servicio.", uses_period: true, perms: ["ventas.ver"] },
  { id: "ventas_categoria", group: "Ventas", title: "Ventas por categoría", description: "Qué categorías venden más y cuáles dejan más margen.", uses_period: true, perms: ["ventas.ver"] },
  { id: "utilidad", group: "Rentabilidad", title: "¿Gano o pierdo? (utilidad)", description: "Ventas menos costo de lo vendido, gastos y remuneraciones, mes a mes.", uses_period: true, perms: ["ventas.ver", "costos.ver", "dinero.ver"] },
  { id: "compras_proveedor", group: "Compras y gastos", title: "Compras por proveedor", description: "Cuánto le compras a cada proveedor y cuánto le debes.", uses_period: true, perms: ["compras.ver"] },
  { id: "gastos_categoria", group: "Compras y gastos", title: "Gastos por categoría", description: "En qué se va el dinero: fijos y variables.", uses_period: true, perms: ["dinero.ver"] },
  { id: "inventario", group: "Inventario", title: "Inventario valorizado y rotación", description: "Cuánto vale tu stock, qué se mueve y qué no.", uses_period: true, perms: ["inventario.ver", "costos.ver"] },
  { id: "por_cobrar", group: "Dinero", title: "Por cobrar (antigüedad)", description: "Quién te debe, desde cuándo y cuánto está vencido.", uses_period: false, perms: ["ventas.ver"] },
  { id: "por_pagar", group: "Dinero", title: "Por pagar (antigüedad)", description: "A quién le debes y qué vence primero.", uses_period: false, perms: ["dinero.ver"] },
  { id: "flujo_caja", group: "Dinero", title: "Flujo de caja", description: "Lo que entró y salió de cajas y bancos cada mes, con el saldo.", uses_period: true, perms: ["dinero.ver"] },
  { id: "iva", group: "Impuestos", title: "IVA estimado por mes", description: "IVA de tus ventas menos el de compras y gastos registrados.", uses_period: true, perms: ["contabilidad.ver"] },
  { id: "importaciones", group: "COMEX", title: "Importaciones", description: "Carpetas del período con FOB, costo final y costo por unidad.", uses_period: true, perms: ["comex.ver"] },
];
const GROUPINGS: [string, string][] = [["mes", "Por mes"], ["semana", "Por semana"], ["dia", "Por día"]];

export function reportCatalog(can: (p: string) => boolean): ReportDef[] {
  return REPORT_DEFS.map((d) => ({ id: d.id, group: d.group, title: d.title, description: d.description, uses_period: d.uses_period,
    groupings: d.id === "ventas_periodo" ? GROUPINGS : [], available: d.perms.every(can) }));
}

const divRound = (n: number, d: number) => { const q = Math.abs(n) / Math.abs(d); const r = Math.floor(q + 0.5); return Math.sign(n) * Math.sign(d) * r; };
const ppm = (part: number, whole: number): ReportCell => (whole === 0 ? null : divRound(part * 1_000_000, whole));
const col = (key: string, label: string, kind: ReportColumnKind): ReportColumn => ({ key, label, kind });
const kpi = (label: string, value: number, kind: ReportColumnKind, tone: ReportKpi["tone"] = null): ReportKpi => ({ label, value, kind, tone });
const num = (c: ReportCell) => (typeof c === "number" ? c : 0);
const sum = (rows: ReportCell[][], i: number) => rows.reduce((a, r) => a + num(r[i]!), 0);
const dayOrd = (d: string) => Math.round(Date.parse(`${d}T12:00:00Z`) / 86_400_000);

export function months(from: string, to: string): string[] {
  let y = Number(from.slice(0, 4)), m = Number(from.slice(5, 7));
  const ty = Number(to.slice(0, 4)), tm = Number(to.slice(5, 7));
  const out: string[] = [];
  while ((y < ty || (y === ty && m <= tm)) && out.length < 600) { out.push(`${y}-${String(m).padStart(2, "0")}`); m++; if (m > 12) { m = 1; y++; } }
  return out;
}
function periodKey(date: string, group: string): string {
  if (group === "dia") return date;
  if (group === "semana") { const d = new Date(`${date}T12:00:00Z`); const wd = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - wd); return d.toISOString().slice(0, 10); }
  return date.slice(0, 7);
}
function bucket(days: number): string {
  if (days <= 0) return "Al día";
  if (days <= 30) return "1 a 30 días";
  if (days <= 60) return "31 a 60 días";
  if (days <= 90) return "61 a 90 días";
  return "Más de 90 días";
}

export function buildReport(id: string, f: Facts, from: string, to: string, group: string | null, can: (p: string) => boolean): Report {
  const def = REPORT_DEFS.find((d) => d.id === id);
  if (!def) throw new Error("No encontramos ese reporte.");
  const r: Report = { id, title: def.title, description: def.description, from, to, uses_period: def.uses_period, columns: [], rows: [], totals: null, links: [], kpis: [], notes: [], chart: null };
  const costs = can("costos.ver");
  const sales = f.sales.filter((s) => s.date >= from && s.date <= to);
  const inRange = (d: string) => d >= from && d <= to;
  const g = group === "dia" || group === "semana" ? group : "mes";

  switch (id) {
    case "ventas_periodo": {
      const by = new Map<string, number[]>();
      if (g === "mes") for (const m of months(from, to)) by.set(m, [0, 0, 0, 0, 0]);
      for (const s of sales) { const k = periodKey(s.date, g); const e = by.get(k) ?? [0, 0, 0, 0, 0]; e[0]! += 1; e[1]! += s.net; e[2]! += s.tax; e[3]! += s.total; e[4]! += s.cost; by.set(k, e); }
      r.columns = [col("periodo", g === "dia" ? "Día" : g === "semana" ? "Semana del" : "Mes", g === "mes" ? "month" : "date"), col("docs", "Ventas", "int"), col("neto", "Neto", "money"), col("iva", "IVA", "money"), col("total", "Total", "money")];
      if (costs) r.columns.push(col("costo", "Costo", "money"), col("margen", "Margen", "money"), col("margen_pct", "Ganancia s/costo %", "pct"));
      const keys = [...by.keys()].sort();
      for (const k of keys) { const v = by.get(k)!; const row: ReportCell[] = [k, v[0]!, v[1]!, v[2]!, v[3]!]; if (costs) row.push(v[4]!, v[1]! - v[4]!, ppm(v[1]! - v[4]!, v[4]!)); r.rows.push(row); }
      const n = sales.reduce((a, s) => a + s.net, 0), c = sales.reduce((a, s) => a + s.cost, 0);
      const tot: ReportCell[] = ["Total", sales.length, n, sales.reduce((a, s) => a + s.tax, 0), sales.reduce((a, s) => a + s.total, 0)];
      if (costs) tot.push(c, n - c, ppm(n - c, c));
      r.totals = tot;
      r.kpis.push(kpi("Ventas netas", n, "money"), kpi("Documentos", sales.length, "int"));
      if (costs) r.kpis.push(kpi("Margen", n - c, "money"), kpi("Ganancia sobre costo", num(ppm(n - c, c)), "pct"));
      r.chart = { label: 0, series: [2] };
      break;
    }
    case "ventas_cliente": {
      const by = new Map<string, { name: string; rut: string | null; docs: number; net: number; cost: number }>();
      for (const s of sales) { const e = by.get(s.customer_key) ?? { name: s.customer, rut: s.rut, docs: 0, net: 0, cost: 0 }; e.docs++; e.net += s.net; e.cost += s.cost; by.set(s.customer_key, e); }
      const data = [...by.values()].sort((a, b) => b.net - a.net);
      const total = data.reduce((a, x) => a + x.net, 0), c = data.reduce((a, x) => a + x.cost, 0);
      r.columns = [col("cliente", "Cliente", "text"), col("rut", "RUT", "rut"), col("docs", "Ventas", "int"), col("neto", "Neto", "money")];
      if (costs) r.columns.push(col("margen", "Margen", "money"), col("margen_pct", "Ganancia s/costo %", "pct"));
      r.columns.push(col("part", "Participación", "pct"));
      for (const x of data) { const row: ReportCell[] = [x.name, x.rut, x.docs, x.net]; if (costs) row.push(x.net - x.cost, ppm(x.net - x.cost, x.cost)); row.push(ppm(x.net, total)); r.rows.push(row); }
      const tot: ReportCell[] = [`${data.length} clientes`, null, sales.length, total]; if (costs) tot.push(total - c, ppm(total - c, c)); tot.push(ppm(total, total));
      r.totals = tot;
      if (data[0]) {
        r.kpis.push(kpi("Clientes con compras", data.length, "int"), kpi(`Principal: ${data[0].name}`, num(ppm(data[0].net, total)), "pct"),
          kpi("Los 5 principales", num(ppm(data.slice(0, 5).reduce((a, x) => a + x.net, 0), total)), "pct"));
      }
      break;
    }
    case "ventas_producto":
    case "ventas_categoria": {
      const byProduct = id === "ventas_producto";
      type Acc = { cells: ReportCell[]; net: number; cost: number; prods: Set<string>; sales: Set<string> };
      const by = new Map<string, Acc>();
      for (const s of sales) for (const l of s.lines) {
        const key = byProduct ? (l.product_uid ?? `d:${l.name}`) : (l.category ?? "Sin categoría");
        const e = by.get(key) ?? { cells: byProduct ? [l.sku, l.name, l.category, 0, l.unit] : [l.category ?? "Sin categoría"], net: 0, cost: 0, prods: new Set<string>(), sales: new Set<string>() };
        if (byProduct) e.cells[3] = num(e.cells[3]!) + l.qty;
        e.net += l.net; e.cost += l.cost; if (l.product_uid) e.prods.add(l.product_uid); e.sales.add(s.uid);
        by.set(key, e);
      }
      const data = [...by.values()].sort((a, b) => b.net - a.net);
      const total = data.reduce((a, x) => a + x.net, 0), c = data.reduce((a, x) => a + x.cost, 0);
      r.columns = byProduct
        ? [col("codigo", "Código", "text"), col("producto", "Producto", "text"), col("categoria", "Categoría", "text"), col("cantidad", "Cantidad", "qty"), col("unidad", "Unidad", "text"), col("neto", "Neto", "money")]
        : [col("categoria", "Categoría", "text"), col("productos", "Productos distintos", "int"), col("ventas", "Ventas", "int"), col("neto", "Neto", "money")];
      if (costs) r.columns.push(col("costo", "Costo", "money"), col("margen", "Margen", "money"), col("margen_pct", "Ganancia s/costo %", "pct"));
      r.columns.push(col("part", "Participación", "pct"));
      for (const x of data) {
        const row: ReportCell[] = byProduct ? [...x.cells, x.net] : [x.cells[0]!, x.prods.size, x.sales.size, x.net];
        if (costs) row.push(x.cost, x.net - x.cost, ppm(x.net - x.cost, x.cost));
        row.push(ppm(x.net, total));
        r.rows.push(row);
      }
      const tot: ReportCell[] = ["Total", ...Array(byProduct ? 4 : 2).fill(null), total];
      if (costs) tot.push(c, total - c, ppm(total - c, c));
      tot.push(ppm(total, total));
      r.totals = tot;
      r.kpis.push(kpi("Ventas netas", total, "money"));
      if (costs) r.kpis.push(kpi("Margen", total - c, "money"), kpi("Ganancia sobre costo", num(ppm(total - c, c)), "pct"));
      if (byProduct) {
        r.kpis.push(kpi("Productos vendidos", data.length, "int"));
        if (data.some((x) => x.cells[2] === null)) r.notes.push("Hay productos sin categoría: asígnalas en Productos → Categorías para verlos agrupados.");
      } else r.chart = { label: 0, series: [3] };
      break;
    }
    case "utilidad": {
      const by = new Map<string, number[]>(months(from, to).map((m) => [m, [0, 0, 0, 0]]));
      const at = (m: string) => { const e = by.get(m) ?? [0, 0, 0, 0]; by.set(m, e); return e; };
      for (const s of sales) { const e = at(s.date.slice(0, 7)); e[0]! += s.net; e[1]! += s.cost; }
      for (const x of f.expenses) if (inRange(x.date)) at(x.date.slice(0, 7))[2]! += x.net;
      const payroll = can("remuneraciones.ver");
      if (payroll) for (const p of f.payroll) if (p.period >= from.slice(0, 7) && p.period <= to.slice(0, 7)) at(p.period)[3]! += p.cost;
      r.columns = [col("mes", "Mes", "month"), col("ventas", "Ventas netas", "money"), col("costo", "Costo de lo vendido", "money"), col("bruto", "Margen bruto", "money"),
        col("gastos", "Gastos", "money"), col("rem", "Remuneraciones", "money"), col("utilidad", "Utilidad", "money"), col("pct", "Utilidad %", "pct")];
      const tt = [0, 0, 0, 0];
      for (const m of [...by.keys()].sort()) {
        const v = by.get(m)!; v.forEach((x, i) => { tt[i]! += x; });
        const gross = v[0]! - v[1]!, profit = gross - v[2]! - v[3]!;
        r.rows.push([m, v[0]!, v[1]!, gross, v[2]!, v[3]!, profit, ppm(profit, v[0]!)]);
      }
      const gross = tt[0]! - tt[1]!, profit = gross - tt[2]! - tt[3]!;
      r.totals = ["Total", tt[0]!, tt[1]!, gross, tt[2]!, tt[3]!, profit, ppm(profit, tt[0]!)];
      r.kpis = [kpi("Ventas netas", tt[0]!, "money"), kpi("Margen bruto", gross, "money"), kpi("Gastos y remuneraciones", tt[2]! + tt[3]!, "money"),
        kpi(profit >= 0 ? "Utilidad" : "Pérdida", Math.abs(profit), "money", profit >= 0 ? "success" : "danger")];
      r.chart = { label: 0, series: [1, 6] };
      r.notes.push("Es una utilidad de gestión: ventas netas menos el costo de lo vendido, los gastos registrados y el costo empresa de las liquidaciones emitidas. No reemplaza el estado de resultados contable.");
      if (payroll && tt[3]! > 0 && f.expenses.some((x) => inRange(x.date) && x.category === "Remuneraciones")) {
        r.notes.push("Tienes gastos en la categoría «Remuneraciones» y también liquidaciones emitidas: revisa que los sueldos no se cuenten dos veces.");
      }
      if (!payroll) r.notes.push("Sin permiso para ver remuneraciones: no se incluyen.");
      break;
    }
    case "compras_proveedor": {
      const by = new Map<string, ReportCell[]>();
      for (const p of f.purchases) if (inRange(p.date)) {
        const e = by.get(p.supplier_key) ?? [p.supplier, p.rut, 0, 0, 0, 0, 0, 0];
        e[2] = num(e[2]!) + 1; e[3] = num(e[3]!) + p.net; e[4] = num(e[4]!) + p.exempt; e[5] = num(e[5]!) + p.tax; e[6] = num(e[6]!) + p.total; e[7] = num(e[7]!) + p.pending;
        by.set(p.supplier_key, e);
      }
      const data = [...by.values()].sort((a, b) => num(b[6]!) - num(a[6]!));
      const total = sum(data, 6);
      r.columns = [col("proveedor", "Proveedor", "text"), col("rut", "RUT", "rut"), col("docs", "Documentos", "int"), col("neto", "Neto", "money"), col("exento", "Exento", "money"),
        col("iva", "IVA", "money"), col("total", "Total", "money"), col("deuda", "Por pagar", "money"), col("part", "Participación", "pct")];
      r.rows = data.map((x) => [...x, ppm(num(x[6]!), total)]);
      r.totals = [`${data.length} proveedores`, null, sum(data, 2), sum(data, 3), sum(data, 4), sum(data, 5), total, sum(data, 7), ppm(total, total)];
      r.kpis = [kpi("Compras (total)", total, "money"), kpi("IVA crédito", sum(data, 5), "money"), kpi("Por pagar de estas compras", sum(data, 7), "money")];
      break;
    }
    case "gastos_categoria": {
      const by = new Map<number, ReportCell[]>();
      for (const x of f.expenses) if (inRange(x.date)) {
        const e = by.get(x.category_id) ?? [x.category, x.behavior === "fijo" ? "Fijo" : "Variable", 0, 0, 0, 0];
        e[2] = num(e[2]!) + 1; e[3] = num(e[3]!) + x.net; e[4] = num(e[4]!) + x.tax; e[5] = num(e[5]!) + x.total;
        by.set(x.category_id, e);
      }
      const data = [...by.values()].sort((a, b) => num(b[3]!) - num(a[3]!));
      const total = sum(data, 3), fixed = data.filter((x) => x[1] === "Fijo").reduce((a, x) => a + num(x[3]!), 0);
      r.columns = [col("categoria", "Categoría", "text"), col("tipo", "Tipo", "text"), col("cantidad", "Gastos", "int"), col("neto", "Neto", "money"), col("iva", "IVA", "money"), col("total", "Total", "money"), col("part", "Participación", "pct")];
      r.rows = data.map((x) => [...x, ppm(num(x[3]!), total)]);
      r.totals = ["Total", null, sum(data, 2), total, sum(data, 4), sum(data, 5), ppm(total, total)];
      r.kpis = [kpi("Gastos netos", total, "money"), kpi("Fijos", fixed, "money"), kpi("Variables", total - fixed, "money")];
      r.chart = { label: 0, series: [3] };
      break;
    }
    case "inventario": {
      const days = Math.max(1, dayOrd(to) - dayOrd(from) + 1);
      const sold = new Map<string, { qty: number; cost: number }>();
      for (const s of sales) for (const l of s.lines) if (l.product_uid) { const e = sold.get(l.product_uid) ?? { qty: 0, cost: 0 }; e.qty += l.qty; e.cost += l.cost; sold.set(l.product_uid, e); }
      r.columns = [col("codigo", "Código", "text"), col("producto", "Producto", "text"), col("categoria", "Categoría", "text"), col("stock", "Stock", "qty"), col("unidad", "Unidad", "text"),
        col("costo", "Costo unitario", "money"), col("valor", "Valor", "money"), col("vendido", "Vendido en el período", "qty"), col("rotacion", "Rotación (veces)", "ratio"), col("dias", "Días de inventario", "days")];
      let valueTotal = 0, idle = 0, idleValue = 0;
      const rows = f.products.map((p) => {
        const value = divRound(Math.max(0, p.stock) * p.cost_e4, 10_000_000);
        const s = sold.get(p.uid) ?? { qty: 0, cost: 0 };
        return { p, value, s };
      }).sort((a, b) => b.value - a.value || a.p.name.localeCompare(b.p.name));
      for (const { p, value, s } of rows) {
        valueTotal += value;
        if (s.qty === 0 && p.stock > 0) { idle++; idleValue += value; }
        r.rows.push([p.sku, p.name, p.category, p.stock, p.unit, divRound(p.cost_e4, 10_000), value, s.qty, value > 0 ? divRound(s.cost * 100, value) : null, s.qty > 0 ? divRound(Math.max(0, p.stock) * days, s.qty) : null]);
        r.links.push(`/inventario/producto/${p.uid}`);
      }
      r.totals = ["Total", `${rows.length} productos`, null, null, null, null, valueTotal, null, null, null];
      r.kpis = [kpi("Valor del inventario (hoy)", valueTotal, "money"), kpi("Productos con stock", f.products.filter((p) => p.stock > 0).length, "int"),
        kpi("Sin ventas en el período", idle, "int", idle > 0 ? "warning" : null), kpi("Capital inmovilizado", idleValue, "money", idleValue > 0 ? "warning" : null)];
      r.notes.push("Stock y costo son los de hoy; lo vendido, la rotación y los días de inventario usan el período elegido.");
      break;
    }
    case "por_cobrar":
    case "por_pagar": {
      const receivable = id === "por_cobrar";
      const t0 = dayOrd(f.today);
      const buckets = new Map<string, number>();
      let total = 0, overdue = 0;
      const pairs: [ReportCell[], string | null][] = [];
      r.columns = receivable
        ? [col("cliente", "Cliente", "text"), col("doc", "Documento", "text"), col("emision", "Emisión", "date"), col("vence", "Vence", "date"), col("monto", "Monto", "money"), col("pagado", "Pagado", "money"), col("saldo", "Saldo", "money"), col("dias", "Días vencido", "days"), col("tramo", "Tramo", "text")]
        : [col("proveedor", "Proveedor o concepto", "text"), col("origen", "Origen", "text"), col("doc", "Documento", "text"), col("vence", "Vence", "date"), col("monto", "Monto", "money"), col("pagado", "Pagado", "money"), col("saldo", "Saldo", "money"), col("dias", "Días vencido", "days"), col("tramo", "Tramo", "text")];
      for (const d of receivable ? f.receivables : f.payables) {
        const days = t0 - dayOrd(d.due_date);
        total += d.pending_minor; if (days > 0) overdue += d.pending_minor;
        buckets.set(bucket(days), (buckets.get(bucket(days)) ?? 0) + d.pending_minor);
        const origin = d.link.startsWith("/compras") ? "Compra" : d.link.startsWith("/dinero/gasto") ? "Gasto" : d.link.startsWith("/comex") ? "Importación" : "Otro";
        const second: ReportCell[] = receivable ? [d.document, (d as DueRow & { issue_date: string }).issue_date] : [origin, d.document];
        pairs.push([[d.party, ...second, d.due_date, d.amount_minor, d.amount_minor - d.pending_minor, d.pending_minor, Math.max(0, days), bucket(days)], d.link]);
      }
      pairs.sort((a, b) => num(b[0][7]!) - num(a[0][7]!));
      r.rows = pairs.map((p) => p[0]); r.links = pairs.map((p) => p[1]);
      r.totals = ["Total", null, null, null, sum(r.rows, 4), sum(r.rows, 5), total, null, null];
      r.kpis.push(kpi(receivable ? "Total por cobrar" : "Total por pagar", total, "money"), kpi("Vencido", overdue, "money", overdue > 0 ? "danger" : null));
      for (const b of ["1 a 30 días", "31 a 60 días", "61 a 90 días", "Más de 90 días"]) { const v = buckets.get(b); if (v) r.kpis.push(kpi(`Vencido ${b}`, v, "money", "warning")); }
      r.notes.push(`Saldos abiertos al ${f.today}.`);
      break;
    }
    case "flujo_caja": {
      const start = f.openingCash + f.cash.filter((c) => c.date < from).reduce((a, c) => a + c.amount, 0);
      const by = new Map<string, [number, number]>(months(from, to).map((m) => [m, [0, 0]]));
      for (const c of f.cash) if (inRange(c.date)) { const e = by.get(c.date.slice(0, 7)) ?? [0, 0]; if (c.amount > 0) e[0] += c.amount; else e[1] -= c.amount; by.set(c.date.slice(0, 7), e); }
      r.columns = [col("mes", "Mes", "month"), col("entradas", "Entradas (cobros)", "money"), col("salidas", "Salidas (pagos)", "money"), col("neto", "Flujo del mes", "money"), col("saldo", "Saldo al cierre", "money")];
      let bal = start, ins = 0, outs = 0;
      for (const m of [...by.keys()].sort()) { const [i, o] = by.get(m)!; bal += i - o; ins += i; outs += o; r.rows.push([m, i, o, i - o, bal]); }
      r.totals = ["Total", ins, outs, ins - outs, bal];
      r.kpis = [kpi("Saldo al inicio", start, "money"), kpi("Entradas", ins, "money"), kpi("Salidas", outs, "money"), kpi("Saldo al final", bal, "money", bal >= 0 ? "success" : "danger")];
      r.chart = { label: 0, series: [1, 2] };
      r.notes.push("Cobros y pagos registrados en cajas y bancos en pesos; los traspasos entre cuentas no cambian el total.");
      break;
    }
    case "iva": {
      const by = new Map<string, number[]>(months(from, to).map((m) => [m, [0, 0, 0]]));
      const at = (d: string) => { const k = d.slice(0, 7); const e = by.get(k) ?? [0, 0, 0]; by.set(k, e); return e; };
      for (const s of sales) at(s.date)[0]! += s.tax;
      for (const p of f.purchases) if (inRange(p.date)) at(p.date)[1]! += p.tax;
      for (const x of f.expenses) if (inRange(x.date)) at(x.date)[2]! += x.tax;
      r.columns = [col("mes", "Mes", "month"), col("debito", "IVA ventas (débito)", "money"), col("credito_c", "IVA compras (crédito)", "money"), col("credito_g", "IVA gastos (crédito)", "money"), col("resultado", "Resultado", "money")];
      const tt = [0, 0, 0];
      for (const m of [...by.keys()].sort()) { const v = by.get(m)!; v.forEach((x, i) => { tt[i]! += x; }); r.rows.push([m, v[0]!, v[1]!, v[2]!, v[0]! - v[1]! - v[2]!]); }
      const res = tt[0]! - tt[1]! - tt[2]!;
      r.totals = ["Total", tt[0]!, tt[1]!, tt[2]!, res];
      r.kpis = [kpi("IVA débito", tt[0]!, "money"), kpi("IVA crédito", tt[1]! + tt[2]!, "money"), kpi(res >= 0 ? "IVA a pagar (estimado)" : "Remanente (estimado)", Math.abs(res), "money", res > 0 ? "warning" : "success")];
      r.chart = { label: 0, series: [1, 4] };
      r.notes.push("Resultado positivo = IVA a pagar; negativo = remanente. Es una estimación desde tus documentos: no arrastra remanentes ni incluye el IVA de importaciones. El borrador del F29 está en Impuestos.");
      break;
    }
    case "importaciones": {
      const data = f.imports.filter((i) => inRange(i.date)).sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number));
      r.columns = [col("carpeta", "Carpeta", "text"), col("proveedor", "Proveedor", "text"), col("etapa", "Etapa", "text"), col("fecha", "Fecha", "date"), col("eta", "ETA", "date"), col("moneda", "Moneda", "text"),
        col("fob", "FOB", "fx"), col("costo", "Costo final (CLP)", "money"), col("unidades", "Unidades", "qty"), col("unitario", "Costo por unidad", "money")];
      let landed = 0;
      for (const i of data) {
        landed += i.landed ?? 0;
        r.rows.push([i.number, i.supplier, i.stage.replace(/_/g, " "), i.date, i.eta, i.currency, i.fob, i.landed, i.units, i.units > 0 && i.landed ? divRound(i.landed * 1000, i.units) : null]);
        r.links.push(`/comex/importacion/${i.uid}`);
      }
      r.totals = [`${data.length} carpetas`, null, null, null, null, null, null, landed, null, null];
      r.kpis = [kpi("Carpetas", data.length, "int"), kpi("Costo final total", landed, "money")];
      r.notes.push("El costo final es el último calculado en cada carpeta (estimado hasta que se cierra).");
      break;
    }
  }
  if (r.links.length !== r.rows.length) r.links = r.rows.map(() => null);
  return r;
}
