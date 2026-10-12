//! Gastos: resumen del mes, promedio por categoría y presupuesto, y punto de equilibrio
//! («¿cuánto necesito vender para cubrir todos mis gastos?»).
//!
//! Los promedios usan los últimos meses completos (sin el mes en curso), desde el primer mes con
//! actividad. Los gastos van sin el IVA recuperable (neto), igual que el costo de lo vendido.

use crate::AppResult;
use crate::company::CompanySession;
use crate::sales_ops::local_today;
use nucleo_db::finance as fdb;
use nucleo_db::reports as rdb;
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};

/// Meses que se pueden promediar (1 a 24).
pub const MAX_INSIGHT_MONTHS: i64 = 24;

/// Un mes del análisis: ventas, costo, gastos y utilidad de gestión.
#[derive(Debug, Clone, Default, Serialize)]
pub struct InsightMonth {
    /// AAAA-MM.
    pub month: String,
    pub sales_net_minor: i64,
    pub sales_count: i64,
    pub cost_minor: i64,
    pub fixed_minor: i64,
    pub variable_minor: i64,
    pub payroll_minor: i64,
    /// Ventas netas − costo − gastos − remuneraciones.
    pub profit_minor: i64,
}

impl InsightMonth {
    fn expenses(&self) -> i64 {
        self.fixed_minor + self.variable_minor + self.payroll_minor
    }
    fn close(&mut self) {
        self.profit_minor = self.sales_net_minor - self.cost_minor - self.expenses();
    }
}

/// Una categoría con su promedio mensual, lo gastado este mes y su presupuesto.
#[derive(Debug, Clone, Serialize)]
pub struct CategoryInsight {
    pub id: i64,
    pub name: String,
    pub group_name: String,
    pub behavior: String,
    /// Promedio mensual sin IVA recuperable.
    pub avg_month_minor: i64,
    /// Gastado en el mes en curso (total, como se registró).
    pub this_month_minor: i64,
    pub budget_minor: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExpenseInsights {
    pub today: String,
    /// Meses usados para los promedios.
    pub months: Vec<InsightMonth>,
    pub months_used: i64,
    /// Sin meses completos: los promedios son lo que va del mes en curso.
    pub partial: bool,
    pub current: InsightMonth,
    pub avg_sales_minor: i64,
    pub avg_sales_count: i64,
    pub avg_ticket_minor: Option<i64>,
    pub avg_cost_minor: i64,
    /// Margen sobre la venta: (ventas − costo) ÷ ventas, en ppm.
    pub margin_ppm: Option<i64>,
    pub avg_fixed_minor: i64,
    pub avg_variable_minor: i64,
    pub avg_payroll_minor: i64,
    /// Fijos + variables + remuneraciones.
    pub avg_expenses_minor: i64,
    /// Venta neta mensual que cubre todos los gastos con el margen actual.
    pub break_even_minor: Option<i64>,
    /// Venta promedio ÷ venta necesaria, en ppm.
    pub coverage_ppm: Option<i64>,
    pub avg_profit_minor: i64,
    /// Equivalente mensual de los pagos recurrentes activos.
    pub recurring_month_minor: i64,
    /// Saldo de cajas y bancos.
    pub cash_minor: i64,
    /// Lo que vence por pagar en los próximos 30 días.
    pub payables_30d_minor: i64,
    pub tax_ppm: Option<i64>,
    pub categories: Vec<CategoryInsight>,
    /// `false` si quien opera no ve ventas o costos: no hay margen ni punto de equilibrio.
    pub sales_visible: bool,
    pub payroll_included: bool,
    pub notes: Vec<String>,
}

fn ym(s: &str) -> (i32, i32) {
    (
        s.get(..4).and_then(|x| x.parse().ok()).unwrap_or(2000),
        s.get(5..7).and_then(|x| x.parse().ok()).unwrap_or(1),
    )
}

fn shift(month: &str, delta: i32) -> String {
    let (y, m) = ym(month);
    let n = y * 12 + (m - 1) + delta;
    format!("{:04}-{:02}", n.div_euclid(12), n.rem_euclid(12) + 1)
}

fn div(a: i64, b: i64) -> i64 {
    if b == 0 {
        0
    } else {
        nucleo_domain::comex::div_round(a as i128, b as i128) as i64
    }
}

/// Equivalente mensual de un monto según su frecuencia.
pub fn monthly_equivalent(amount: i64, frequency: &str) -> i64 {
    match frequency {
        "semanal" => div(amount * 52, 12),
        "bimestral" => div(amount, 2),
        "trimestral" => div(amount, 3),
        "anual" => div(amount, 12),
        _ => amount,
    }
}

/// Venta neta que cubre `expenses` con un margen sobre la venta `margin_ppm` (redondeo hacia arriba).
pub fn break_even(expenses: i64, margin_ppm: i64) -> Option<i64> {
    if margin_ppm <= 0 {
        return None;
    }
    let num = expenses.max(0) as i128 * 1_000_000;
    let m = margin_ppm as i128;
    Some(((num + m - 1) / m) as i64)
}

impl CompanySession {
    /// Resumen de gastos y punto de equilibrio con el promedio de los últimos `months` meses.
    pub fn expense_insights(&self, months: i64) -> AppResult<ExpenseInsights> {
        self.require("dinero.ver")?;
        let conn = self.db.conn();
        let months = months.clamp(1, MAX_INSIGHT_MONTHS) as i32;
        let today = local_today(conn)?;
        let current_m = today[..7].to_string();
        let first = fdb::first_activity(conn)?.map(|d| d[..7].to_string());
        let mut start = shift(&current_m, -months);
        if let Some(f) = first.as_ref().filter(|f| **f > start) {
            start = f.clone();
        }
        let end_m = shift(&current_m, -1);
        let partial = start > end_m;
        let window: Vec<String> = if partial {
            vec![current_m.clone()]
        } else {
            let mut v = vec![start.clone()];
            while v.last().is_some_and(|m| *m < end_m) {
                let next = shift(v.last().unwrap_or(&end_m), 1);
                v.push(next);
            }
            v
        };
        let from = format!("{}-01", window[0]);
        let all_from = from.clone().min(format!("{current_m}-01"));

        let cats = fdb::all_categories(conn)?;
        let fixed: HashMap<i64, bool> = cats.iter().map(|c| (c.id, c.behavior == "fijo")).collect();
        let mut by: BTreeMap<String, InsightMonth> = window
            .iter()
            .chain(std::iter::once(&current_m))
            .map(|m| {
                (
                    m.clone(),
                    InsightMonth {
                        month: m.clone(),
                        ..Default::default()
                    },
                )
            })
            .collect();

        let sales_visible = self.can("ventas.ver") && self.can("costos.ver");
        if sales_visible {
            for row in rdb::sales_by_period(conn, &all_from, &today, "mes")? {
                if let Some(e) = by.get_mut(row[0].text()) {
                    e.sales_count += row[1].int();
                    e.sales_net_minor += row[2].int();
                    e.cost_minor += row[5].int();
                }
            }
        }
        let mut cat_sum: HashMap<i64, i64> = HashMap::new();
        let mut cat_now: HashMap<i64, i64> = HashMap::new();
        for (m, cat, net, total) in fdb::expenses_by_month_category(conn, &all_from, &today)? {
            if let Some(e) = by.get_mut(&m) {
                if fixed.get(&cat).copied().unwrap_or(false) {
                    e.fixed_minor += net;
                } else {
                    e.variable_minor += net;
                }
            }
            if window.contains(&m) {
                *cat_sum.entry(cat).or_default() += net;
            }
            if m == current_m {
                *cat_now.entry(cat).or_default() += total;
            }
        }
        let payroll_included = self.can("remuneraciones.ver");
        if payroll_included {
            for row in rdb::payroll_by_month(conn, &all_from, &today)? {
                if let Some(e) = by.get_mut(row[0].text()) {
                    e.payroll_minor += row[1].int();
                }
            }
        }
        for e in by.values_mut() {
            e.close();
        }
        let current = by.get(&current_m).cloned().unwrap_or_default();
        let used: Vec<InsightMonth> = window.iter().filter_map(|m| by.get(m).cloned()).collect();
        let n = used.len() as i64;
        let avg = |f: fn(&InsightMonth) -> i64| div(used.iter().map(f).sum(), n);
        let avg_sales = avg(|m| m.sales_net_minor);
        let avg_cost = avg(|m| m.cost_minor);
        let avg_count = avg(|m| m.sales_count);
        let total_sales: i64 = used.iter().map(|m| m.sales_net_minor).sum();
        let total_count: i64 = used.iter().map(|m| m.sales_count).sum();
        let total_cost: i64 = used.iter().map(|m| m.cost_minor).sum();
        let margin_ppm = (sales_visible && total_sales > 0)
            .then(|| div((total_sales - total_cost) * 1_000_000, total_sales));
        let avg_fixed = avg(|m| m.fixed_minor);
        let avg_variable = avg(|m| m.variable_minor);
        let avg_payroll = avg(|m| m.payroll_minor);
        let avg_expenses = avg_fixed + avg_variable + avg_payroll;
        let be = margin_ppm.and_then(|m| break_even(avg_expenses, m));
        let coverage = be.filter(|b| *b > 0).map(|b| div(avg_sales * 1_000_000, b));

        let recurring_month: i64 = fdb::recurring(conn)?
            .iter()
            .filter(|r| r.active && r.direction == "egreso")
            .filter(|r| r.ends_on.as_deref().is_none_or(|e| e >= today.as_str()))
            .map(|r| monthly_equivalent(r.amount_minor, &r.frequency))
            .sum();
        let cash: i64 = fdb::accounts(conn)?
            .iter()
            .filter(|a| !a.archived)
            .map(|a| a.balance_minor)
            .sum();
        let limit = crate::inventory_ops::date_ord(&today)
            .map(|d| crate::inventory_ops::date_str(d + 30))
            .unwrap_or_else(|| today.clone());
        let payables_30d: i64 = fdb::open_payables(conn)?
            .iter()
            .filter(|p| p.due_date <= limit)
            .map(|p| p.pending_minor)
            .sum();

        let mut categories: Vec<CategoryInsight> = cats
            .iter()
            .filter(|c| !c.archived || cat_sum.contains_key(&c.id) || cat_now.contains_key(&c.id))
            .map(|c| CategoryInsight {
                id: c.id,
                name: c.name.clone(),
                group_name: c.group_name.clone(),
                behavior: c.behavior.clone(),
                avg_month_minor: div(cat_sum.get(&c.id).copied().unwrap_or(0), n),
                this_month_minor: cat_now.get(&c.id).copied().unwrap_or(0),
                budget_minor: c.monthly_budget_minor,
            })
            .collect();
        categories.sort_by(|a, b| {
            (b.avg_month_minor.max(b.this_month_minor))
                .cmp(&a.avg_month_minor.max(a.this_month_minor))
                .then_with(|| a.name.cmp(&b.name))
        });

        let mut notes = Vec::new();
        if partial {
            notes.push(
                "Todavía no hay un mes completo: los promedios son lo que va del mes en curso."
                    .into(),
            );
        }
        if !sales_visible {
            notes.push(
                "Para calcular el margen y la venta necesaria se requiere ver ventas y costos."
                    .into(),
            );
        }
        if payroll_included
            && avg_payroll > 0
            && cats
                .iter()
                .any(|c| c.name == "Remuneraciones" && cat_sum.get(&c.id).copied().unwrap_or(0) > 0)
        {
            notes.push("Tienes gastos en «Remuneraciones» y también liquidaciones emitidas: revisa que los sueldos no se cuenten dos veces.".into());
        }

        Ok(ExpenseInsights {
            today,
            months: used,
            months_used: n,
            partial,
            current,
            avg_sales_minor: avg_sales,
            avg_sales_count: avg_count,
            avg_ticket_minor: (total_count > 0).then(|| div(total_sales, total_count)),
            avg_cost_minor: avg_cost,
            margin_ppm,
            avg_fixed_minor: avg_fixed,
            avg_variable_minor: avg_variable,
            avg_payroll_minor: avg_payroll,
            avg_expenses_minor: avg_expenses,
            break_even_minor: be,
            coverage_ppm: coverage,
            avg_profit_minor: avg_sales - avg_cost - avg_expenses,
            recurring_month_minor: recurring_month,
            cash_minor: cash,
            payables_30d_minor: payables_30d,
            tax_ppm: self.tax_ppm()?,
            categories,
            sales_visible,
            payroll_included,
            notes,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn meses() {
        assert_eq!(shift("2026-01", -1), "2025-12");
        assert_eq!(shift("2026-10", -6), "2026-04");
        assert_eq!(shift("2025-12", 1), "2026-01");
    }

    #[test]
    fn equilibrio() {
        // Gastos 1.000.000 con 25 % de margen: hay que vender 4.000.000 netos.
        assert_eq!(break_even(1_000_000, 250_000), Some(4_000_000));
        assert_eq!(break_even(1_000_000, 0), None);
        assert_eq!(break_even(100, 300_000), Some(334));
        assert_eq!(monthly_equivalent(120_000, "anual"), 10_000);
        assert_eq!(monthly_equivalent(12_000, "semanal"), 52_000);
    }
}
