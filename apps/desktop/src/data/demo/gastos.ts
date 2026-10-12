// Análisis de gastos de la demostración: mismas reglas que nucleo-app::gastos_ops (Rust).
import type { CategoryInsight, ExpenseCategory, ExpenseInsights, InsightMonth, Recurring } from "../types";
import { breakEven, monthlyEquivalent } from "../gastos";
import type { Facts } from "./reports";

const divRound = (n: number, d: number) => (d === 0 ? 0 : Math.sign(n) * Math.sign(d) * Math.floor(Math.abs(n) / Math.abs(d) + 0.5));

export function shiftMonth(month: string, delta: number): string {
  const n = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + delta;
  return `${Math.floor(n / 12)}-${String((((n % 12) + 12) % 12) + 1).padStart(2, "0")}`;
}

export function buildInsights(f: Facts, cats: ExpenseCategory[], recs: Recurring[], cash: number, taxPpm: number | null, monthsWanted: number,
  can: (p: string) => boolean): ExpenseInsights {
  const months = Math.min(24, Math.max(1, Math.round(monthsWanted)));
  const today = f.today, cur = today.slice(0, 7);
  const acts = [...f.sales.map((s) => s.date), ...f.expenses.map((e) => e.date)].sort();
  let start = shiftMonth(cur, -months);
  const first = acts[0]?.slice(0, 7);
  if (first && first > start) start = first;
  const endM = shiftMonth(cur, -1);
  const partial = start > endM;
  const window: string[] = [];
  if (partial) window.push(cur);
  else for (let m = start; m <= endM; m = shiftMonth(m, 1)) window.push(m);
  const blank = (m: string): InsightMonth => ({ month: m, sales_net_minor: 0, sales_count: 0, cost_minor: 0, fixed_minor: 0, variable_minor: 0, payroll_minor: 0, profit_minor: 0 });
  const by = new Map<string, InsightMonth>([...window, cur].map((m) => [m, blank(m)]));
  const salesVisible = can("ventas.ver") && can("costos.ver");
  if (salesVisible) for (const s of f.sales) { const e = by.get(s.date.slice(0, 7)); if (e) { e.sales_count++; e.sales_net_minor += s.net; e.cost_minor += s.cost; } }
  const catSum = new Map<number, number>(), catNow = new Map<number, number>();
  for (const x of f.expenses) {
    const m = x.date.slice(0, 7), e = by.get(m);
    if (e) { if (x.behavior === "fijo") e.fixed_minor += x.net; else e.variable_minor += x.net; }
    if (window.includes(m)) catSum.set(x.category_id, (catSum.get(x.category_id) ?? 0) + x.net);
    if (m === cur) catNow.set(x.category_id, (catNow.get(x.category_id) ?? 0) + x.total);
  }
  const payrollIncluded = can("remuneraciones.ver");
  if (payrollIncluded) for (const p of f.payroll) { const e = by.get(p.period); if (e) e.payroll_minor += p.cost; }
  for (const e of by.values()) e.profit_minor = e.sales_net_minor - e.cost_minor - e.fixed_minor - e.variable_minor - e.payroll_minor;
  const used = window.map((m) => by.get(m)!);
  const n = used.length;
  const tot = (k: keyof Omit<InsightMonth, "month">) => used.reduce((a, m) => a + m[k], 0);
  const avg = (k: keyof Omit<InsightMonth, "month">) => divRound(tot(k), n);
  const totalSales = tot("sales_net_minor"), totalCost = tot("cost_minor"), totalCount = tot("sales_count");
  const margin = salesVisible && totalSales > 0 ? divRound((totalSales - totalCost) * 1_000_000, totalSales) : null;
  const avgExpenses = avg("fixed_minor") + avg("variable_minor") + avg("payroll_minor");
  const be = margin === null ? null : breakEven(avgExpenses, margin);
  const limit = new Date(`${today}T12:00:00Z`); limit.setUTCDate(limit.getUTCDate() + 30);
  const lim = limit.toISOString().slice(0, 10);
  const categories: CategoryInsight[] = cats
    .filter((c) => !c.archived || catSum.has(c.id) || catNow.has(c.id))
    .map((c) => ({ id: c.id, name: c.name, group_name: c.group_name, behavior: c.behavior, avg_month_minor: divRound(catSum.get(c.id) ?? 0, n),
      this_month_minor: catNow.get(c.id) ?? 0, budget_minor: c.monthly_budget_minor }))
    .sort((a, b) => Math.max(b.avg_month_minor, b.this_month_minor) - Math.max(a.avg_month_minor, a.this_month_minor) || a.name.localeCompare(b.name));
  const notes: string[] = [];
  if (partial) notes.push("Todavía no hay un mes completo: los promedios son lo que va del mes en curso.");
  if (!salesVisible) notes.push("Para calcular el margen y la venta necesaria se requiere ver ventas y costos.");
  const remId = cats.find((c) => c.name === "Remuneraciones")?.id;
  if (payrollIncluded && avg("payroll_minor") > 0 && remId !== undefined && (catSum.get(remId) ?? 0) > 0) {
    notes.push("Tienes gastos en «Remuneraciones» y también liquidaciones emitidas: revisa que los sueldos no se cuenten dos veces.");
  }
  const avgSales = avg("sales_net_minor");
  return {
    today, months: used, months_used: n, partial, current: by.get(cur)!,
    avg_sales_minor: avgSales, avg_sales_count: avg("sales_count"), avg_ticket_minor: totalCount > 0 ? divRound(totalSales, totalCount) : null,
    avg_cost_minor: avg("cost_minor"), margin_ppm: margin,
    avg_fixed_minor: avg("fixed_minor"), avg_variable_minor: avg("variable_minor"), avg_payroll_minor: avg("payroll_minor"), avg_expenses_minor: avgExpenses,
    break_even_minor: be, coverage_ppm: be ? divRound(avgSales * 1_000_000, be) : null,
    avg_profit_minor: avgSales - avg("cost_minor") - avgExpenses,
    recurring_month_minor: recs.filter((r) => r.active && r.direction === "egreso" && (!r.ends_on || r.ends_on >= today))
      .reduce((a, r) => a + monthlyEquivalent(r.amount_minor, r.frequency), 0),
    cash_minor: cash,
    payables_30d_minor: f.payables.filter((p) => p.due_date <= lim).reduce((a, p) => a + p.pending_minor, 0),
    tax_ppm: taxPpm, categories, sales_visible: salesVisible, payroll_included: payrollIncluded, notes,
  };
}
