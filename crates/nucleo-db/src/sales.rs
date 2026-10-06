//! Ventas (Fase 5): cotizaciones, ventas y facturas internas, cobros, referencias externas y la
//! trazabilidad entre documentos. Solo acceso a datos: las reglas viven en `nucleo-app`.

use crate::DbResult;
use rusqlite::{Connection, OptionalExtension, Row};
use serde::Serialize;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
pub struct Totals {
    pub net_minor: i64,
    pub exempt_minor: i64,
    pub discount_minor: i64,
    pub tax_minor: i64,
    pub total_minor: i64,
}

/// Línea lista para guardar (montos ya calculados).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewLine {
    pub product_id: Option<i64>,
    pub description: String,
    pub qty_milli: i64,
    pub list_price_minor: i64,
    pub unit_price_minor: i64,
    pub discount_ppm: i64,
    pub discount_minor: i64,
    pub taxable: bool,
    pub net_minor: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LineRow {
    pub id: i64,
    pub line_no: i64,
    pub product_id: Option<i64>,
    pub product_uid: Option<String>,
    pub description: String,
    pub qty_milli: i64,
    pub unit_price_minor: i64,
    pub discount_ppm: i64,
    pub discount_minor: i64,
    pub taxable: bool,
    pub net_minor: i64,
    pub unit_cost_e4: Option<i64>,
}

fn totals_at(r: &Row<'_>, i: usize) -> rusqlite::Result<Totals> {
    Ok(Totals {
        net_minor: r.get(i)?,
        exempt_minor: r.get(i + 1)?,
        discount_minor: r.get(i + 2)?,
        tax_minor: r.get(i + 3)?,
        total_minor: r.get(i + 4)?,
    })
}

/* ───────────────────────────── Cotizaciones ───────────────────────────── */

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QuoteRow {
    pub id: i64,
    pub uid: String,
    pub number: String,
    pub customer_id: Option<i64>,
    pub customer_uid: Option<String>,
    pub customer_name: String,
    pub prospect_name: Option<String>,
    pub issue_date: String,
    pub valid_until: Option<String>,
    pub status: String,
    pub totals: Totals,
    pub notes: Option<String>,
}

const QUOTE_SELECT: &str = "SELECT q.id, q.uid, q.number, q.customer_id, c.uid,
        coalesce(c.name, q.prospect_name, 'Interesado'), q.prospect_name, q.issue_date, q.valid_until, q.status,
        q.net_minor, q.exempt_minor, q.discount_minor, q.tax_minor, q.total_minor, q.notes
    FROM quotes q LEFT JOIN customers c ON c.id = q.customer_id";

fn map_quote(r: &Row<'_>) -> rusqlite::Result<QuoteRow> {
    Ok(QuoteRow {
        id: r.get(0)?,
        uid: r.get(1)?,
        number: r.get(2)?,
        customer_id: r.get(3)?,
        customer_uid: r.get(4)?,
        customer_name: r.get(5)?,
        prospect_name: r.get(6)?,
        issue_date: r.get(7)?,
        valid_until: r.get(8)?,
        status: r.get(9)?,
        totals: totals_at(r, 10)?,
        notes: r.get(15)?,
    })
}

pub struct QuoteWrite<'a> {
    pub customer_id: Option<i64>,
    pub prospect_name: Option<&'a str>,
    pub issue_date: &'a str,
    pub valid_until: Option<&'a str>,
    pub totals: Totals,
    pub notes: Option<&'a str>,
}

pub fn insert_quote(
    conn: &Connection,
    uid: &str,
    number: &str,
    w: &QuoteWrite<'_>,
    created_by: Option<i64>,
    now: &str,
) -> DbResult<i64> {
    conn.execute(
        "INSERT INTO quotes (uid, number, customer_id, prospect_name, issue_date, valid_until, net_minor, exempt_minor,
            discount_minor, tax_minor, total_minor, notes, salesperson_id, created_by, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13, ?14)",
        rusqlite::params![
            uid,
            number,
            w.customer_id,
            w.prospect_name,
            w.issue_date,
            w.valid_until,
            w.totals.net_minor,
            w.totals.exempt_minor,
            w.totals.discount_minor,
            w.totals.tax_minor,
            w.totals.total_minor,
            w.notes,
            created_by,
            now
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn update_quote(conn: &Connection, id: i64, w: &QuoteWrite<'_>, now: &str) -> DbResult<()> {
    conn.execute(
        "UPDATE quotes SET customer_id = ?2, prospect_name = ?3, issue_date = ?4, valid_until = ?5, net_minor = ?6,
            exempt_minor = ?7, discount_minor = ?8, tax_minor = ?9, total_minor = ?10, notes = ?11, updated_at = ?12
         WHERE id = ?1",
        rusqlite::params![
            id,
            w.customer_id,
            w.prospect_name,
            w.issue_date,
            w.valid_until,
            w.totals.net_minor,
            w.totals.exempt_minor,
            w.totals.discount_minor,
            w.totals.tax_minor,
            w.totals.total_minor,
            w.notes,
            now
        ],
    )?;
    Ok(())
}

pub fn replace_quote_items(conn: &Connection, quote_id: i64, lines: &[NewLine]) -> DbResult<()> {
    conn.execute("DELETE FROM quote_items WHERE quote_id = ?1", [quote_id])?;
    let mut stmt = conn.prepare(
        "INSERT INTO quote_items (quote_id, line_no, product_id, description, qty_milli, unit_price_minor, discount_ppm,
            discount_minor, taxable, net_minor) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
    )?;
    for (i, l) in lines.iter().enumerate() {
        stmt.execute(rusqlite::params![
            quote_id,
            i as i64 + 1,
            l.product_id,
            l.description,
            l.qty_milli,
            l.unit_price_minor,
            l.discount_ppm,
            l.discount_minor,
            l.taxable as i64,
            l.net_minor
        ])?;
    }
    Ok(())
}

pub fn quote_by_uid(conn: &Connection, uid: &str) -> DbResult<Option<QuoteRow>> {
    Ok(conn
        .query_row(
            &format!("{QUOTE_SELECT} WHERE q.uid = ?1"),
            [uid],
            map_quote,
        )
        .optional()?)
}

pub fn quote_by_id(conn: &Connection, id: i64) -> DbResult<Option<QuoteRow>> {
    Ok(conn
        .query_row(&format!("{QUOTE_SELECT} WHERE q.id = ?1"), [id], map_quote)
        .optional()?)
}

pub fn quote_lines(conn: &Connection, quote_id: i64) -> DbResult<Vec<LineRow>> {
    let mut stmt = conn.prepare(
        "SELECT i.id, i.line_no, i.product_id, p.uid, i.description, i.qty_milli, i.unit_price_minor, i.discount_ppm,
            i.discount_minor, i.taxable, i.net_minor
         FROM quote_items i LEFT JOIN products p ON p.id = i.product_id
         WHERE i.quote_id = ?1 ORDER BY i.line_no",
    )?;
    let rows = stmt.query_map([quote_id], |r| {
        Ok(LineRow {
            id: r.get(0)?,
            line_no: r.get(1)?,
            product_id: r.get(2)?,
            product_uid: r.get(3)?,
            description: r.get(4)?,
            qty_milli: r.get(5)?,
            unit_price_minor: r.get(6)?,
            discount_ppm: r.get(7)?,
            discount_minor: r.get(8)?,
            taxable: r.get::<_, i64>(9)? == 1,
            net_minor: r.get(10)?,
            unit_cost_e4: None,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Cotizaciones más recientes primero; filtra por número o nombre del cliente/interesado.
pub fn list_quotes(conn: &Connection, query: &str, limit: u32) -> DbResult<Vec<QuoteRow>> {
    let like = format!("%{}%", query.trim());
    let mut stmt = conn.prepare(&format!(
        "{QUOTE_SELECT} WHERE (?1 = '%%' OR q.number LIKE ?1 OR coalesce(c.name, q.prospect_name, '') LIKE ?1)
         ORDER BY q.issue_date DESC, q.id DESC LIMIT ?2"
    ))?;
    let rows = stmt.query_map((like, limit), map_quote)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn set_quote_status(conn: &Connection, id: i64, status: &str, now: &str) -> DbResult<()> {
    conn.execute(
        "UPDATE quotes SET status = ?2, updated_at = ?3 WHERE id = ?1",
        (id, status, now),
    )?;
    Ok(())
}

/* ───────────────────────────── Ventas ───────────────────────────── */

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SaleRow {
    pub id: i64,
    pub uid: String,
    pub doc_type: String,
    pub number: String,
    pub customer_id: Option<i64>,
    pub customer_uid: Option<String>,
    pub customer_name: String,
    pub issue_date: String,
    pub due_date: Option<String>,
    pub commercial_state: String,
    pub payment_state: String,
    pub documentation_state: String,
    pub totals: Totals,
    pub paid_minor: i64,
    pub cost_minor: i64,
    pub payment_method: Option<String>,
    pub notes: Option<String>,
    pub void_reason: Option<String>,
    pub warehouse_id: Option<i64>,
}

const SALE_SELECT: &str = "SELECT s.id, s.uid, s.doc_type, s.number, s.customer_id, c.uid,
        coalesce(c.name, 'Cliente ocasional'), s.issue_date, s.due_date, s.commercial_state, s.payment_state,
        s.documentation_state, s.net_minor, s.exempt_minor, s.discount_minor, s.tax_minor, s.total_minor,
        s.paid_minor, s.cost_minor, s.payment_method, s.notes, s.void_reason, s.warehouse_id
    FROM sales s LEFT JOIN customers c ON c.id = s.customer_id";

fn map_sale(r: &Row<'_>) -> rusqlite::Result<SaleRow> {
    Ok(SaleRow {
        id: r.get(0)?,
        uid: r.get(1)?,
        doc_type: r.get(2)?,
        number: r.get(3)?,
        customer_id: r.get(4)?,
        customer_uid: r.get(5)?,
        customer_name: r.get(6)?,
        issue_date: r.get(7)?,
        due_date: r.get(8)?,
        commercial_state: r.get(9)?,
        payment_state: r.get(10)?,
        documentation_state: r.get(11)?,
        totals: totals_at(r, 12)?,
        paid_minor: r.get(17)?,
        cost_minor: r.get(18)?,
        payment_method: r.get(19)?,
        notes: r.get(20)?,
        void_reason: r.get(21)?,
        warehouse_id: r.get(22)?,
    })
}

pub struct SaleWrite<'a> {
    pub customer_id: Option<i64>,
    pub issue_date: &'a str,
    pub totals: Totals,
    pub notes: Option<&'a str>,
}

#[allow(clippy::too_many_arguments)]
pub fn insert_sale(
    conn: &Connection,
    uid: &str,
    doc_type: &str,
    number: &str,
    state: &str,
    w: &SaleWrite<'_>,
    created_by: Option<i64>,
    now: &str,
) -> DbResult<i64> {
    conn.execute(
        "INSERT INTO sales (uid, doc_type, number, customer_id, issue_date, commercial_state, net_minor, exempt_minor,
            discount_minor, tax_minor, total_minor, notes, salesperson_id, created_by, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13, ?14)",
        rusqlite::params![
            uid,
            doc_type,
            number,
            w.customer_id,
            w.issue_date,
            state,
            w.totals.net_minor,
            w.totals.exempt_minor,
            w.totals.discount_minor,
            w.totals.tax_minor,
            w.totals.total_minor,
            w.notes,
            created_by,
            now
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn update_sale_draft(conn: &Connection, id: i64, w: &SaleWrite<'_>, now: &str) -> DbResult<()> {
    conn.execute(
        "UPDATE sales SET customer_id = ?2, issue_date = ?3, net_minor = ?4, exempt_minor = ?5, discount_minor = ?6,
            tax_minor = ?7, total_minor = ?8, notes = ?9, updated_at = ?10
         WHERE id = ?1",
        rusqlite::params![
            id,
            w.customer_id,
            w.issue_date,
            w.totals.net_minor,
            w.totals.exempt_minor,
            w.totals.discount_minor,
            w.totals.tax_minor,
            w.totals.total_minor,
            w.notes,
            now
        ],
    )?;
    Ok(())
}

pub fn replace_sale_items(conn: &Connection, sale_id: i64, lines: &[NewLine]) -> DbResult<()> {
    conn.execute("DELETE FROM sale_items WHERE sale_id = ?1", [sale_id])?;
    let mut stmt = conn.prepare(
        "INSERT INTO sale_items (sale_id, line_no, product_id, description, qty_milli, list_price_minor, unit_price_minor,
            discount_ppm, discount_minor, taxable, net_minor) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
    )?;
    for (i, l) in lines.iter().enumerate() {
        stmt.execute(rusqlite::params![
            sale_id,
            i as i64 + 1,
            l.product_id,
            l.description,
            l.qty_milli,
            l.list_price_minor,
            l.unit_price_minor,
            l.discount_ppm,
            l.discount_minor,
            l.taxable as i64,
            l.net_minor
        ])?;
    }
    Ok(())
}

pub fn sale_by_uid(conn: &Connection, uid: &str) -> DbResult<Option<SaleRow>> {
    Ok(conn
        .query_row(&format!("{SALE_SELECT} WHERE s.uid = ?1"), [uid], map_sale)
        .optional()?)
}

pub fn sale_by_id(conn: &Connection, id: i64) -> DbResult<Option<SaleRow>> {
    Ok(conn
        .query_row(&format!("{SALE_SELECT} WHERE s.id = ?1"), [id], map_sale)
        .optional()?)
}

pub fn sale_lines(conn: &Connection, sale_id: i64) -> DbResult<Vec<LineRow>> {
    let mut stmt = conn.prepare(
        "SELECT i.id, i.line_no, i.product_id, p.uid, i.description, i.qty_milli, i.unit_price_minor, i.discount_ppm,
            i.discount_minor, i.taxable, i.net_minor, i.unit_cost_e4
         FROM sale_items i LEFT JOIN products p ON p.id = i.product_id
         WHERE i.sale_id = ?1 ORDER BY i.line_no",
    )?;
    let rows = stmt.query_map([sale_id], |r| {
        Ok(LineRow {
            id: r.get(0)?,
            line_no: r.get(1)?,
            product_id: r.get(2)?,
            product_uid: r.get(3)?,
            description: r.get(4)?,
            qty_milli: r.get(5)?,
            unit_price_minor: r.get(6)?,
            discount_ppm: r.get(7)?,
            discount_minor: r.get(8)?,
            taxable: r.get::<_, i64>(9)? == 1,
            net_minor: r.get(10)?,
            unit_cost_e4: r.get(11)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Fija el costo de una línea al efectuar (el trigger lo permite solo esta vez).
pub fn set_line_cost(
    conn: &Connection,
    item_id: i64,
    unit_cost_e4: i64,
    cost_minor: i64,
) -> DbResult<()> {
    conn.execute(
        "UPDATE sale_items SET unit_cost_e4 = ?2, cost_minor = ?3 WHERE id = ?1",
        (item_id, unit_cost_e4, cost_minor),
    )?;
    Ok(())
}

/// Vistas de la lista de ventas (mismas que la interfaz).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SaleView {
    Todas,
    PorCobrar,
    PendientesDoc,
    Borradores,
    Anuladas,
}

pub fn list_sales(
    conn: &Connection,
    query: &str,
    view: SaleView,
    limit: u32,
) -> DbResult<Vec<SaleRow>> {
    let cond = match view {
        SaleView::Todas => "s.commercial_state <> 'anulada'",
        SaleView::PorCobrar => {
            "s.commercial_state IN ('efectuada', 'cerrada') AND s.payment_state <> 'pagada'"
        }
        SaleView::PendientesDoc => {
            "s.documentation_state = 'pendiente' AND s.commercial_state <> 'anulada'"
        }
        SaleView::Borradores => "s.commercial_state IN ('borrador', 'cotizada', 'aceptada')",
        SaleView::Anuladas => "s.commercial_state = 'anulada'",
    };
    let like = format!("%{}%", query.trim());
    let mut stmt = conn.prepare(&format!(
        "{SALE_SELECT} WHERE {cond} AND (?1 = '%%' OR s.number LIKE ?1 OR coalesce(c.name, 'Cliente ocasional') LIKE ?1)
         ORDER BY s.issue_date DESC, s.id DESC LIMIT ?2"
    ))?;
    let rows = stmt.query_map((like, limit), map_sale)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Pasa la venta a efectuada con sus datos de cierre (montos ya guardados en borrador).
#[allow(clippy::too_many_arguments)]
pub fn mark_effected(
    conn: &Connection,
    id: i64,
    warehouse_id: i64,
    due_date: Option<&str>,
    payment_method: &str,
    documentation_state: &str,
    cost_minor: i64,
    now: &str,
) -> DbResult<()> {
    conn.execute(
        "UPDATE sales SET commercial_state = 'efectuada', issued_at = ?2, warehouse_id = ?3, due_date = ?4,
            payment_method = ?5, documentation_state = ?6, cost_minor = ?7, updated_at = ?2
         WHERE id = ?1",
        rusqlite::params![
            id,
            now,
            warehouse_id,
            due_date,
            payment_method,
            documentation_state,
            cost_minor
        ],
    )?;
    Ok(())
}

pub fn set_payment(
    conn: &Connection,
    id: i64,
    paid_minor: i64,
    state: &str,
    now: &str,
) -> DbResult<()> {
    conn.execute(
        "UPDATE sales SET paid_minor = ?2, payment_state = ?3, updated_at = ?4 WHERE id = ?1",
        (id, paid_minor, state, now),
    )?;
    Ok(())
}

pub fn set_commercial_state(conn: &Connection, id: i64, state: &str, now: &str) -> DbResult<()> {
    conn.execute(
        "UPDATE sales SET commercial_state = ?2, updated_at = ?3 WHERE id = ?1",
        (id, state, now),
    )?;
    Ok(())
}

pub fn set_documentation_state(conn: &Connection, id: i64, state: &str, now: &str) -> DbResult<()> {
    conn.execute(
        "UPDATE sales SET documentation_state = ?2, updated_at = ?3 WHERE id = ?1",
        (id, state, now),
    )?;
    Ok(())
}

pub fn void_sale(conn: &Connection, id: i64, reason: &str, now: &str) -> DbResult<()> {
    conn.execute(
        "UPDATE sales SET commercial_state = 'anulada', void_reason = ?2, updated_at = ?3 WHERE id = ?1",
        (id, reason, now),
    )?;
    Ok(())
}

/* ───────────────────────────── Cobros ───────────────────────────── */

pub fn insert_receivable(
    conn: &Connection,
    sale_id: i64,
    customer_id: Option<i64>,
    due_date: &str,
    amount_minor: i64,
) -> DbResult<i64> {
    conn.execute(
        "INSERT INTO receivables (sale_id, customer_id, installment, due_date, amount_minor) VALUES (?1, ?2, 1, ?3, ?4)",
        (sale_id, customer_id, due_date, amount_minor),
    )?;
    Ok(conn.last_insert_rowid())
}

/// Vencimiento abierto de la venta (una sola cuota en la Fase 5).
pub fn open_receivable(conn: &Connection, sale_id: i64) -> DbResult<Option<i64>> {
    Ok(conn
        .query_row(
            "SELECT id FROM receivables WHERE sale_id = ?1 AND status = 'abierta' ORDER BY installment LIMIT 1",
            [sale_id],
            |r| r.get(0),
        )
        .optional()?)
}

pub fn void_receivables(conn: &Connection, sale_id: i64) -> DbResult<()> {
    conn.execute(
        "UPDATE receivables SET status = 'anulada' WHERE sale_id = ?1",
        [sale_id],
    )?;
    Ok(())
}

/// Caja por defecto para registrar cobros; se crea "Caja" la primera vez.
pub fn default_cash_account(conn: &Connection, now: &str) -> DbResult<i64> {
    if let Some(id) = conn
        .query_row(
            "SELECT id FROM money_accounts WHERE kind = 'caja' AND archived_at IS NULL ORDER BY id LIMIT 1",
            [],
            |r| r.get(0),
        )
        .optional()?
    {
        return Ok(id);
    }
    conn.execute(
        "INSERT INTO money_accounts (uid, kind, name, created_at) VALUES (?1, 'caja', 'Caja', ?2)",
        (uuid::Uuid::now_v7().to_string(), now),
    )?;
    Ok(conn.last_insert_rowid())
}

pub struct PaymentWrite<'a> {
    pub uid: &'a str,
    pub number: &'a str,
    pub customer_id: Option<i64>,
    pub money_account_id: i64,
    pub date: &'a str,
    /// Código del medio: efectivo, transferencia, debito, credito, cheque, otro.
    pub method: &'a str,
    pub amount_minor: i64,
    pub created_by: Option<i64>,
    pub created_at: &'a str,
}

/// Registra un cobro (PAG) y lo aplica al vencimiento indicado (el trigger actualiza el saldo).
pub fn insert_payment(
    conn: &Connection,
    p: &PaymentWrite<'_>,
    receivable_id: i64,
) -> DbResult<i64> {
    conn.execute(
        "INSERT INTO payments (uid, doc_type, number, direction, party_type, party_id, money_account_id, payment_date,
            method, amount_minor, created_by, created_at)
         VALUES (?1, 'PAG', ?2, 'entrada', CASE WHEN ?3 IS NULL THEN NULL ELSE 'cliente' END, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![
            p.uid,
            p.number,
            p.customer_id,
            p.money_account_id,
            p.date,
            p.method,
            p.amount_minor,
            p.created_by,
            p.created_at
        ],
    )?;
    let id = conn.last_insert_rowid();
    conn.execute(
        "INSERT INTO payment_allocations (payment_id, receivable_id, amount_minor, created_at) VALUES (?1, ?2, ?3, ?4)",
        (id, receivable_id, p.amount_minor, p.created_at),
    )?;
    Ok(id)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PaymentRow {
    pub id: i64,
    pub number: String,
    pub date: String,
    pub amount_minor: i64,
    pub method: String,
    pub status: String,
}

/// Cobros aplicados a una venta (vigentes y anulados), en orden.
pub fn sale_payments(conn: &Connection, sale_id: i64) -> DbResult<Vec<PaymentRow>> {
    let mut stmt = conn.prepare(
        "SELECT p.id, p.number, p.payment_date, a.amount_minor, p.method, p.status
         FROM payment_allocations a JOIN payments p ON p.id = a.payment_id
         JOIN receivables r ON r.id = a.receivable_id
         WHERE r.sale_id = ?1 ORDER BY p.payment_date, p.id",
    )?;
    let rows = stmt.query_map([sale_id], |r| {
        Ok(PaymentRow {
            id: r.get(0)?,
            number: r.get(1)?,
            date: r.get(2)?,
            amount_minor: r.get(3)?,
            method: r.get(4)?,
            status: r.get(5)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn void_payments_of_sale(conn: &Connection, sale_id: i64, reason: &str) -> DbResult<usize> {
    Ok(conn.execute(
        "UPDATE payments SET status = 'anulado', void_reason = ?2
         WHERE status = 'vigente' AND id IN (
            SELECT a.payment_id FROM payment_allocations a JOIN receivables r ON r.id = a.receivable_id WHERE r.sale_id = ?1)",
        (sale_id, reason),
    )?)
}

/* ───────────────────────────── Referencia externa ───────────────────────────── */

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ExternalRefRow {
    pub doc_kind: Option<String>,
    pub external_number: Option<String>,
    pub issue_date: Option<String>,
    pub observation: Option<String>,
    pub marked_at: String,
}

pub fn upsert_external_ref(
    conn: &Connection,
    sale_id: i64,
    r: &ExternalRefRow,
    marked_by: Option<i64>,
) -> DbResult<()> {
    conn.execute(
        "INSERT INTO external_doc_refs (sale_id, doc_kind, external_number, issue_date, observation, marked_by, marked_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(sale_id) DO UPDATE SET doc_kind = excluded.doc_kind, external_number = excluded.external_number,
            issue_date = excluded.issue_date, observation = excluded.observation, marked_by = excluded.marked_by,
            marked_at = excluded.marked_at",
        rusqlite::params![
            sale_id,
            r.doc_kind,
            r.external_number,
            r.issue_date,
            r.observation,
            marked_by,
            r.marked_at
        ],
    )?;
    Ok(())
}

pub fn external_ref(conn: &Connection, sale_id: i64) -> DbResult<Option<ExternalRefRow>> {
    Ok(conn
        .query_row(
            "SELECT doc_kind, external_number, issue_date, observation, marked_at FROM external_doc_refs WHERE sale_id = ?1",
            [sale_id],
            |r| {
                Ok(ExternalRefRow {
                    doc_kind: r.get(0)?,
                    external_number: r.get(1)?,
                    issue_date: r.get(2)?,
                    observation: r.get(3)?,
                    marked_at: r.get(4)?,
                })
            },
        )
        .optional()?)
}

/* ───────────────────────────── Trazabilidad ───────────────────────────── */

pub fn insert_link(
    conn: &Connection,
    source: (&str, i64),
    target: (&str, i64),
    relation: &str,
    now: &str,
) -> DbResult<()> {
    conn.execute(
        "INSERT OR IGNORE INTO document_links (source_type, source_id, target_type, target_id, relation, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        (source.0, source.1, target.0, target.1, relation, now),
    )?;
    Ok(())
}

/// Cotización de la que nació una venta (uid y número).
pub fn quote_of_sale(conn: &Connection, sale_id: i64) -> DbResult<Option<(String, String)>> {
    Ok(conn
        .query_row(
            "SELECT q.uid, q.number FROM document_links l JOIN quotes q ON q.id = l.source_id
             WHERE l.source_type IN ('COT', 'PRE', 'PRO') AND l.target_type IN ('VEN', 'FV') AND l.target_id = ?1
               AND l.relation = 'convertido' LIMIT 1",
            [sale_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?)
}

/// Venta en que se convirtió una cotización (uid y número).
pub fn sale_of_quote(conn: &Connection, quote_id: i64) -> DbResult<Option<(String, String)>> {
    Ok(conn
        .query_row(
            "SELECT s.uid, s.number FROM document_links l JOIN sales s ON s.id = l.target_id
             WHERE l.source_type IN ('COT', 'PRE', 'PRO') AND l.source_id = ?1 AND l.target_type IN ('VEN', 'FV')
               AND l.relation = 'convertido' LIMIT 1",
            [quote_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?)
}

/* ───────────────────────────── Ficha de cliente ───────────────────────────── */

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CustomerSalesStats {
    pub sales_count: i64,
    pub revenue_minor: i64,
    pub receivable_minor: i64,
    pub last_sale_date: Option<String>,
    /// Días (número juliano) de cada fecha con compra, sin repetir.
    pub purchase_days: Vec<i64>,
}

pub fn customer_stats(conn: &Connection, customer_id: i64) -> DbResult<CustomerSalesStats> {
    let (count, revenue, receivable, last): (i64, i64, i64, Option<String>) = conn.query_row(
        "SELECT count(*), coalesce(sum(total_minor), 0), coalesce(sum(total_minor - paid_minor), 0), max(issue_date)
         FROM sales WHERE customer_id = ?1 AND commercial_state IN ('efectuada', 'cerrada')",
        [customer_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    )?;
    let mut stmt = conn.prepare(
        "SELECT DISTINCT CAST(julianday(issue_date) AS INTEGER) FROM sales
         WHERE customer_id = ?1 AND commercial_state IN ('efectuada', 'cerrada') ORDER BY 1",
    )?;
    let days = stmt
        .query_map([customer_id], |r| r.get(0))?
        .collect::<Result<Vec<i64>, _>>()?;
    Ok(CustomerSalesStats {
        sales_count: count,
        revenue_minor: revenue,
        receivable_minor: receivable,
        last_sale_date: last,
        purchase_days: days,
    })
}

pub fn customer_recent_sales(
    conn: &Connection,
    customer_id: i64,
    limit: u32,
) -> DbResult<Vec<SaleRow>> {
    let mut stmt = conn.prepare(&format!(
        "{SALE_SELECT} WHERE s.customer_id = ?1 AND s.commercial_state IN ('efectuada', 'cerrada')
         ORDER BY s.issue_date DESC, s.id DESC LIMIT ?2"
    ))?;
    let rows = stmt.query_map((customer_id, limit), map_sale)?;
    Ok(rows.collect::<Result<_, _>>()?)
}
