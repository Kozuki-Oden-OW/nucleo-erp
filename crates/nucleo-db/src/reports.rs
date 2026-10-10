//! Consultas de solo lectura de «Análisis y reportes» (Fase 12). Nunca escriben datos de negocio.
//! Cada función devuelve filas genéricas (`Cell`); `nucleo-app` agrega columnas derivadas
//! (márgenes, participación, tramos) y arma el reporte.

use crate::DbResult;
use rusqlite::types::ValueRef;
use rusqlite::{Connection, ToSql};
use serde::Serialize;

/// Celda de un reporte: número entero (montos, cantidades, ppm), texto o vacío.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(untagged)]
pub enum Cell {
    Int(i64),
    Text(String),
    Null,
}

impl Cell {
    pub fn int(&self) -> i64 {
        match self {
            Cell::Int(v) => *v,
            _ => 0,
        }
    }
    pub fn text(&self) -> &str {
        match self {
            Cell::Text(s) => s,
            _ => "",
        }
    }
}

impl From<i64> for Cell {
    fn from(v: i64) -> Self {
        Cell::Int(v)
    }
}
impl From<Option<i64>> for Cell {
    fn from(v: Option<i64>) -> Self {
        v.map(Cell::Int).unwrap_or(Cell::Null)
    }
}
impl From<&str> for Cell {
    fn from(v: &str) -> Self {
        Cell::Text(v.to_string())
    }
}
impl From<String> for Cell {
    fn from(v: String) -> Self {
        Cell::Text(v)
    }
}
impl From<Option<String>> for Cell {
    fn from(v: Option<String>) -> Self {
        v.map(Cell::Text).unwrap_or(Cell::Null)
    }
}

pub type Rows = Vec<Vec<Cell>>;

fn query(conn: &Connection, sql: &str, params: &[&dyn ToSql]) -> DbResult<Rows> {
    let mut stmt = conn.prepare(sql)?;
    let n = stmt.column_count();
    let mut out = Vec::new();
    let mut rows = stmt.query(params)?;
    while let Some(r) = rows.next()? {
        let mut row = Vec::with_capacity(n);
        for i in 0..n {
            row.push(match r.get_ref(i)? {
                ValueRef::Integer(v) => Cell::Int(v),
                ValueRef::Real(v) => Cell::Int(v.round() as i64),
                ValueRef::Text(t) => Cell::Text(String::from_utf8_lossy(t).into_owned()),
                ValueRef::Null | ValueRef::Blob(_) => Cell::Null,
            });
        }
        out.push(row);
    }
    Ok(out)
}

/// Ventas vigentes (efectuadas o cerradas) del período.
const LIVE: &str =
    "s.commercial_state IN ('efectuada', 'cerrada') AND s.issue_date BETWEEN ?1 AND ?2";

/// Clave de agrupación de la fecha de venta: "mes" (AAAA-MM), "semana" (lunes) o "dia".
fn period_key(group: &str, col: &str) -> String {
    match group {
        "dia" => col.to_string(),
        "semana" => format!("date({col}, 'weekday 0', '-6 days')"),
        _ => format!("substr({col}, 1, 7)"),
    }
}

/// [período, documentos, neto (afecto + exento), IVA, total, costo]
pub fn sales_by_period(conn: &Connection, from: &str, to: &str, group: &str) -> DbResult<Rows> {
    let k = period_key(group, "s.issue_date");
    query(
        conn,
        &format!(
            "SELECT {k} AS per, count(*), sum(s.net_minor + s.exempt_minor), sum(s.tax_minor),
                sum(s.total_minor), sum(s.cost_minor)
             FROM sales s WHERE {LIVE} GROUP BY per ORDER BY per"
        ),
        &[&from, &to],
    )
}

/// [cliente, rut, documentos, neto, costo]
pub fn sales_by_customer(conn: &Connection, from: &str, to: &str) -> DbResult<Rows> {
    query(
        conn,
        &format!(
            "SELECT coalesce(c.name, 'Cliente ocasional'), c.rut, count(*),
                sum(s.net_minor + s.exempt_minor), sum(s.cost_minor)
             FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
             WHERE {LIVE} GROUP BY s.customer_id ORDER BY 4 DESC"
        ),
        &[&from, &to],
    )
}

/// [código, producto, categoría, cantidad (milésimas), unidad, neto, costo]
pub fn sales_by_product(conn: &Connection, from: &str, to: &str) -> DbResult<Rows> {
    query(
        conn,
        &format!(
            "SELECT coalesce(p.sku, ''), coalesce(p.name, i.description), k.name, sum(i.qty_milli),
                lower(coalesce(p.unit_code, '')), sum(i.net_minor), sum(coalesce(i.cost_minor, 0))
             FROM sale_items i JOIN sales s ON s.id = i.sale_id
             LEFT JOIN products p ON p.id = i.product_id LEFT JOIN categories k ON k.id = p.category_id
             WHERE {LIVE}
             GROUP BY coalesce(CAST(i.product_id AS TEXT), 'd:' || i.description) ORDER BY 6 DESC"
        ),
        &[&from, &to],
    )
}

/// [categoría, productos distintos, ventas con la categoría, neto, costo]
pub fn sales_by_category(conn: &Connection, from: &str, to: &str) -> DbResult<Rows> {
    query(
        conn,
        &format!(
            "SELECT coalesce(k.name, 'Sin categoría'), count(DISTINCT i.product_id), count(DISTINCT s.id),
                sum(i.net_minor), sum(coalesce(i.cost_minor, 0))
             FROM sale_items i JOIN sales s ON s.id = i.sale_id
             LEFT JOIN products p ON p.id = i.product_id LEFT JOIN categories k ON k.id = p.category_id
             WHERE {LIVE} GROUP BY k.id ORDER BY 4 DESC"
        ),
        &[&from, &to],
    )
}

/// [mes, gastos netos] de gastos registrados.
pub fn expenses_by_month(conn: &Connection, from: &str, to: &str) -> DbResult<Rows> {
    query(
        conn,
        "SELECT substr(expense_date, 1, 7), sum(net_minor) FROM expenses
         WHERE status = 'registrado' AND expense_date BETWEEN ?1 AND ?2 GROUP BY 1 ORDER BY 1",
        &[&from, &to],
    )
}

/// [mes, costo empresa] de las liquidaciones emitidas, por mes de remuneración.
pub fn payroll_by_month(conn: &Connection, from: &str, to: &str) -> DbResult<Rows> {
    query(
        conn,
        "SELECT period, sum(employer_cost_minor) FROM payslips
         WHERE status = 'emitida' AND period BETWEEN substr(?1, 1, 7) AND substr(?2, 1, 7)
         GROUP BY period ORDER BY period",
        &[&from, &to],
    )
}

/// Gastos netos registrados en la categoría «Remuneraciones» (para avisar doble conteo).
pub fn payroll_like_expenses(conn: &Connection, from: &str, to: &str) -> DbResult<i64> {
    Ok(conn.query_row(
        "SELECT coalesce(sum(g.net_minor), 0) FROM expenses g JOIN expense_categories k ON k.id = g.category_id
         WHERE g.status = 'registrado' AND g.expense_date BETWEEN ?1 AND ?2 AND k.name = 'Remuneraciones'",
        [from, to],
        |r| r.get(0),
    )?)
}

/// [proveedor, rut, documentos, neto, exento, IVA, total, por pagar]
pub fn purchases_by_supplier(conn: &Connection, from: &str, to: &str) -> DbResult<Rows> {
    query(
        conn,
        "SELECT v.name, v.rut, count(*), sum(c.net_minor), sum(c.exempt_minor), sum(c.tax_minor),
            sum(c.total_minor), sum(c.total_minor - c.paid_minor)
         FROM purchases c JOIN suppliers v ON v.id = c.supplier_id
         WHERE c.status = 'registrada' AND c.issue_date BETWEEN ?1 AND ?2
         GROUP BY v.id ORDER BY 7 DESC",
        &[&from, &to],
    )
}

/// [categoría, tipo (fijo/variable), cantidad, neto, IVA, total]
pub fn expenses_by_category(conn: &Connection, from: &str, to: &str) -> DbResult<Rows> {
    query(
        conn,
        "SELECT k.name, k.behavior, count(*), sum(g.net_minor), sum(g.tax_minor), sum(g.total_minor)
         FROM expenses g JOIN expense_categories k ON k.id = g.category_id
         WHERE g.status = 'registrado' AND g.expense_date BETWEEN ?1 AND ?2
         GROUP BY k.id ORDER BY 4 DESC",
        &[&from, &to],
    )
}

/// [código, producto, categoría, stock (milésimas), unidad, costo promedio e4, vendido en el
/// período (milésimas), costo de lo vendido en el período, uid]
pub fn inventory_valuation(conn: &Connection, from: &str, to: &str) -> DbResult<Rows> {
    query(
        conn,
        &format!(
            "SELECT p.sku, p.name, k.name,
                coalesce((SELECT sum(b.on_hand_milli) FROM stock_balances b WHERE b.product_id = p.id), 0) AS stock,
                lower(p.unit_code), p.avg_cost_e4,
                coalesce((SELECT sum(i.qty_milli) FROM sale_items i JOIN sales s ON s.id = i.sale_id
                          WHERE i.product_id = p.id AND {LIVE}), 0),
                coalesce((SELECT sum(i.cost_minor) FROM sale_items i JOIN sales s ON s.id = i.sale_id
                          WHERE i.product_id = p.id AND {LIVE}), 0),
                p.uid
             FROM products p LEFT JOIN categories k ON k.id = p.category_id
             WHERE p.archived_at IS NULL AND p.track_stock = 1
             ORDER BY stock * p.avg_cost_e4 DESC, p.name"
        ),
        &[&from, &to],
    )
}

/// [cliente, documento, emisión, vencimiento, monto, pagado, saldo, uid de la venta]
pub fn open_receivables(conn: &Connection) -> DbResult<Rows> {
    query(
        conn,
        "SELECT coalesce(c.name, 'Cliente ocasional'), s.number, s.issue_date, r.due_date, r.amount_minor,
            r.paid_minor, r.amount_minor - r.paid_minor, s.uid
         FROM receivables r JOIN sales s ON s.id = r.sale_id LEFT JOIN customers c ON c.id = s.customer_id
         WHERE r.status = 'abierta' AND r.amount_minor > r.paid_minor ORDER BY r.due_date, s.number",
        &[],
    )
}

/// [mes, entradas, salidas] de cobros y pagos vigentes.
pub fn cash_by_month(conn: &Connection, from: &str, to: &str) -> DbResult<Rows> {
    query(
        conn,
        "SELECT substr(payment_date, 1, 7),
            sum(CASE direction WHEN 'entrada' THEN amount_minor ELSE 0 END),
            sum(CASE direction WHEN 'salida' THEN amount_minor ELSE 0 END)
         FROM payments WHERE status = 'vigente' AND payment_date BETWEEN ?1 AND ?2
         GROUP BY 1 ORDER BY 1",
        &[&from, &to],
    )
}

/// Saldo de cajas y bancos antes de `from`: saldos iniciales más cobros menos pagos anteriores.
pub fn cash_before(conn: &Connection, from: &str) -> DbResult<i64> {
    Ok(conn.query_row(
        "SELECT coalesce((SELECT sum(opening_minor) FROM money_accounts WHERE currency_code = 'CLP'), 0)
              + coalesce((SELECT sum(CASE direction WHEN 'entrada' THEN amount_minor ELSE -amount_minor END)
                          FROM payments WHERE status = 'vigente' AND payment_date < ?1), 0)",
        [from],
        |r| r.get(0),
    )?)
}

/// [mes, IVA débito, IVA crédito compras, IVA crédito gastos]
pub fn vat_by_month(conn: &Connection, from: &str, to: &str) -> DbResult<Rows> {
    query(
        conn,
        &format!(
            "SELECT m, sum(d), sum(c), sum(g) FROM (
                SELECT substr(s.issue_date, 1, 7) AS m, s.tax_minor AS d, 0 AS c, 0 AS g FROM sales s WHERE {LIVE}
                UNION ALL
                SELECT substr(issue_date, 1, 7), 0, tax_minor, 0 FROM purchases
                 WHERE status = 'registrada' AND issue_date BETWEEN ?1 AND ?2
                UNION ALL
                SELECT substr(expense_date, 1, 7), 0, 0, tax_minor FROM expenses
                 WHERE status = 'registrado' AND expense_date BETWEEN ?1 AND ?2
             ) GROUP BY m ORDER BY m"
        ),
        &[&from, &to],
    )
}

/// [carpeta, proveedor, etapa, fecha de compra, ETA, moneda, FOB (moneda), costo total CLP,
/// unidades (milésimas), uid]
pub fn imports(conn: &Connection, from: &str, to: &str) -> DbResult<Rows> {
    query(
        conn,
        "SELECT i.number, coalesce(v.name, '—'), i.stage, coalesce(i.purchase_date, substr(i.created_at, 1, 10)),
            i.eta, i.currency_code, i.fob_minor, i.landed_total_clp,
            (SELECT sum(qty_milli) FROM import_items WHERE import_id = i.id), i.uid
         FROM imports i LEFT JOIN suppliers v ON v.id = i.supplier_id
         WHERE i.is_scenario = 0 AND i.stage <> 'anulada'
           AND coalesce(i.purchase_date, substr(i.created_at, 1, 10)) BETWEEN ?1 AND ?2
         ORDER BY 4 DESC, i.number DESC",
        &[&from, &to],
    )
}
