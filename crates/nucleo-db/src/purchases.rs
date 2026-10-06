//! Compras (Fase 6): órdenes de compra, recepciones, documentos de compra del proveedor,
//! cuentas por pagar, pagos a proveedores e historial de precios. Solo acceso a datos.

use crate::DbResult;
use crate::sales::Totals;
use rusqlite::{Connection, OptionalExtension, Row};

/* ───────────────────────────── Órdenes de compra ───────────────────────────── */

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PoRow {
    pub id: i64,
    pub uid: String,
    pub number: String,
    pub supplier_id: i64,
    pub supplier_uid: String,
    pub supplier_name: String,
    pub order_date: String,
    pub expected_date: Option<String>,
    pub status: String,
    pub totals: Totals,
    pub notes: Option<String>,
    pub void_reason: Option<String>,
}

const PO_SELECT: &str = "SELECT o.id, o.uid, o.number, o.supplier_id, s.uid, s.name, o.order_date, o.expected_date, o.status,
        o.net_minor, o.exempt_minor, o.tax_minor, o.total_minor, o.notes, o.void_reason
    FROM purchase_orders o JOIN suppliers s ON s.id = o.supplier_id";

fn map_po(r: &Row<'_>) -> rusqlite::Result<PoRow> {
    Ok(PoRow {
        id: r.get(0)?,
        uid: r.get(1)?,
        number: r.get(2)?,
        supplier_id: r.get(3)?,
        supplier_uid: r.get(4)?,
        supplier_name: r.get(5)?,
        order_date: r.get(6)?,
        expected_date: r.get(7)?,
        status: r.get(8)?,
        totals: Totals {
            net_minor: r.get(9)?,
            exempt_minor: r.get(10)?,
            discount_minor: 0,
            tax_minor: r.get(11)?,
            total_minor: r.get(12)?,
        },
        notes: r.get(13)?,
        void_reason: r.get(14)?,
    })
}

/// Línea de compra ya calculada (orden o documento).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BuyLine {
    pub product_id: Option<i64>,
    pub description: String,
    pub qty_milli: i64,
    pub unit_price_minor: i64,
    pub taxable: bool,
    pub net_minor: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PoLineRow {
    pub id: i64,
    pub line_no: i64,
    pub product_id: Option<i64>,
    pub product_uid: Option<String>,
    pub description: String,
    pub qty_milli: i64,
    pub received_milli: i64,
    pub unit_price_minor: i64,
    pub taxable: bool,
    pub net_minor: i64,
}

pub struct PoWrite<'a> {
    pub supplier_id: i64,
    pub order_date: &'a str,
    pub expected_date: Option<&'a str>,
    pub totals: Totals,
    pub notes: Option<&'a str>,
}

pub fn insert_po(
    conn: &Connection,
    uid: &str,
    number: &str,
    w: &PoWrite<'_>,
    by: Option<i64>,
    now: &str,
) -> DbResult<i64> {
    conn.execute(
        "INSERT INTO purchase_orders (uid, number, supplier_id, order_date, expected_date, net_minor, exempt_minor, tax_minor,
            total_minor, notes, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        rusqlite::params![
            uid, number, w.supplier_id, w.order_date, w.expected_date, w.totals.net_minor, w.totals.exempt_minor,
            w.totals.tax_minor, w.totals.total_minor, w.notes, by, now
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn update_po(conn: &Connection, id: i64, w: &PoWrite<'_>) -> DbResult<()> {
    conn.execute(
        "UPDATE purchase_orders SET supplier_id = ?2, order_date = ?3, expected_date = ?4, net_minor = ?5, exempt_minor = ?6,
            tax_minor = ?7, total_minor = ?8, notes = ?9 WHERE id = ?1",
        rusqlite::params![
            id, w.supplier_id, w.order_date, w.expected_date, w.totals.net_minor, w.totals.exempt_minor,
            w.totals.tax_minor, w.totals.total_minor, w.notes
        ],
    )?;
    Ok(())
}

pub fn replace_po_items(conn: &Connection, po_id: i64, lines: &[BuyLine]) -> DbResult<()> {
    conn.execute(
        "DELETE FROM purchase_order_items WHERE purchase_order_id = ?1",
        [po_id],
    )?;
    let mut stmt = conn.prepare(
        "INSERT INTO purchase_order_items (purchase_order_id, line_no, product_id, description, qty_milli, unit_price_minor,
            taxable, net_minor) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
    )?;
    for (i, l) in lines.iter().enumerate() {
        stmt.execute(rusqlite::params![
            po_id,
            i as i64 + 1,
            l.product_id,
            l.description,
            l.qty_milli,
            l.unit_price_minor,
            l.taxable as i64,
            l.net_minor
        ])?;
    }
    Ok(())
}

pub fn po_by_uid(conn: &Connection, uid: &str) -> DbResult<Option<PoRow>> {
    Ok(conn
        .query_row(&format!("{PO_SELECT} WHERE o.uid = ?1"), [uid], map_po)
        .optional()?)
}

pub fn po_by_id(conn: &Connection, id: i64) -> DbResult<Option<PoRow>> {
    Ok(conn
        .query_row(&format!("{PO_SELECT} WHERE o.id = ?1"), [id], map_po)
        .optional()?)
}

pub fn po_lines(conn: &Connection, po_id: i64) -> DbResult<Vec<PoLineRow>> {
    let mut stmt = conn.prepare(
        "SELECT i.id, i.line_no, i.product_id, p.uid, i.description, i.qty_milli, i.received_milli, i.unit_price_minor,
            i.taxable, i.net_minor
         FROM purchase_order_items i LEFT JOIN products p ON p.id = i.product_id
         WHERE i.purchase_order_id = ?1 ORDER BY i.line_no",
    )?;
    let rows = stmt.query_map([po_id], |r| {
        Ok(PoLineRow {
            id: r.get(0)?,
            line_no: r.get(1)?,
            product_id: r.get(2)?,
            product_uid: r.get(3)?,
            description: r.get(4)?,
            qty_milli: r.get(5)?,
            received_milli: r.get(6)?,
            unit_price_minor: r.get(7)?,
            taxable: r.get::<_, i64>(8)? == 1,
            net_minor: r.get(9)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn list_pos(
    conn: &Connection,
    query: &str,
    supplier_id: Option<i64>,
    limit: u32,
) -> DbResult<Vec<PoRow>> {
    let like = format!("%{}%", query.trim());
    let mut stmt = conn.prepare(&format!(
        "{PO_SELECT} WHERE (?1 = '%%' OR o.number LIKE ?1 OR s.name LIKE ?1) AND (?2 IS NULL OR o.supplier_id = ?2)
         ORDER BY o.order_date DESC, o.id DESC LIMIT ?3"
    ))?;
    let rows = stmt.query_map(rusqlite::params![like, supplier_id, limit], map_po)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn set_po_status(conn: &Connection, id: i64, status: &str) -> DbResult<()> {
    conn.execute(
        "UPDATE purchase_orders SET status = ?2 WHERE id = ?1",
        (id, status),
    )?;
    Ok(())
}

pub fn void_po(conn: &Connection, id: i64, reason: &str) -> DbResult<()> {
    conn.execute(
        "UPDATE purchase_orders SET status = 'anulada', void_reason = ?2 WHERE id = ?1",
        (id, reason),
    )?;
    Ok(())
}

pub fn add_received(conn: &Connection, item_id: i64, qty_milli: i64) -> DbResult<()> {
    conn.execute(
        "UPDATE purchase_order_items SET received_milli = received_milli + ?2 WHERE id = ?1",
        (item_id, qty_milli),
    )?;
    Ok(())
}

/* ───────────────────────────── Recepciones ───────────────────────────── */

#[allow(clippy::too_many_arguments)]
pub fn insert_receipt(
    conn: &Connection,
    uid: &str,
    number: &str,
    supplier_id: i64,
    po_id: Option<i64>,
    warehouse_id: i64,
    date: &str,
    by: Option<i64>,
    now: &str,
) -> DbResult<i64> {
    conn.execute(
        "INSERT INTO receipts (uid, number, supplier_id, purchase_order_id, warehouse_id, receipt_date, status, created_by,
            created_at, confirmed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'confirmada', ?7, ?8, ?8)",
        rusqlite::params![uid, number, supplier_id, po_id, warehouse_id, date, by, now],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn insert_receipt_item(
    conn: &Connection,
    receipt_id: i64,
    po_item_id: Option<i64>,
    product_id: i64,
    qty_milli: i64,
    unit_cost_e4: i64,
) -> DbResult<i64> {
    conn.execute(
        "INSERT INTO receipt_items (receipt_id, purchase_order_item_id, product_id, qty_milli, unit_cost_e4)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        (receipt_id, po_item_id, product_id, qty_milli, unit_cost_e4),
    )?;
    Ok(conn.last_insert_rowid())
}

/// Recepciones de una orden: (número, fecha).
pub fn po_receipts(conn: &Connection, po_id: i64) -> DbResult<Vec<(String, String)>> {
    let mut stmt = conn.prepare(
        "SELECT number, receipt_date FROM receipts WHERE purchase_order_id = ?1 AND status = 'confirmada' ORDER BY id",
    )?;
    let rows = stmt.query_map([po_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Ítems de una recepción: (producto, cantidad, costo unitario e4, bodega).
pub fn receipt_items(conn: &Connection, receipt_id: i64) -> DbResult<Vec<(i64, i64, i64, i64)>> {
    let mut stmt = conn.prepare(
        "SELECT i.product_id, i.qty_milli, i.unit_cost_e4, r.warehouse_id FROM receipt_items i
         JOIN receipts r ON r.id = i.receipt_id WHERE i.receipt_id = ?1",
    )?;
    let rows = stmt.query_map([receipt_id], |r| {
        Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn void_receipt(conn: &Connection, receipt_id: i64) -> DbResult<()> {
    conn.execute(
        "UPDATE receipts SET status = 'anulada' WHERE id = ?1",
        [receipt_id],
    )?;
    Ok(())
}

/* ───────────────────────────── Documentos de compra ───────────────────────────── */

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PurchaseRow {
    pub id: i64,
    pub uid: String,
    pub number: String,
    pub supplier_id: i64,
    pub supplier_uid: String,
    pub supplier_name: String,
    pub doc_kind: Option<String>,
    pub doc_number: Option<String>,
    pub po_id: Option<i64>,
    pub issue_date: String,
    pub due_date: Option<String>,
    pub status: String,
    pub payment_state: String,
    pub paid_minor: i64,
    pub totals: Totals,
    pub void_reason: Option<String>,
    pub notes: Option<String>,
}

const PUR_SELECT: &str = "SELECT c.id, c.uid, c.number, c.supplier_id, s.uid, s.name, c.supplier_doc_kind, c.supplier_doc_number,
        c.purchase_order_id, c.issue_date, c.due_date, c.status, c.payment_state, c.paid_minor,
        c.net_minor, c.exempt_minor, c.tax_minor, c.total_minor, c.void_reason, c.notes
    FROM purchases c JOIN suppliers s ON s.id = c.supplier_id";

fn map_pur(r: &Row<'_>) -> rusqlite::Result<PurchaseRow> {
    Ok(PurchaseRow {
        id: r.get(0)?,
        uid: r.get(1)?,
        number: r.get(2)?,
        supplier_id: r.get(3)?,
        supplier_uid: r.get(4)?,
        supplier_name: r.get(5)?,
        doc_kind: r.get(6)?,
        doc_number: r.get(7)?,
        po_id: r.get(8)?,
        issue_date: r.get(9)?,
        due_date: r.get(10)?,
        status: r.get(11)?,
        payment_state: r.get(12)?,
        paid_minor: r.get(13)?,
        totals: Totals {
            net_minor: r.get(14)?,
            exempt_minor: r.get(15)?,
            discount_minor: 0,
            tax_minor: r.get(16)?,
            total_minor: r.get(17)?,
        },
        void_reason: r.get(18)?,
        notes: r.get(19)?,
    })
}

pub struct PurchaseWrite<'a> {
    pub supplier_id: i64,
    pub doc_kind: Option<&'a str>,
    pub doc_number: Option<&'a str>,
    pub po_id: Option<i64>,
    pub issue_date: &'a str,
    pub due_date: Option<&'a str>,
    pub totals: Totals,
    pub notes: Option<&'a str>,
}

/// Inserta el documento de compra ya registrado. `None` si el proveedor ya tiene ese documento.
pub fn insert_purchase(
    conn: &Connection,
    uid: &str,
    number: &str,
    w: &PurchaseWrite<'_>,
    by: Option<i64>,
    now: &str,
) -> DbResult<Option<i64>> {
    let res = conn.execute(
        "INSERT INTO purchases (uid, number, supplier_id, supplier_doc_kind, supplier_doc_number, purchase_order_id, issue_date,
            due_date, status, net_minor, exempt_minor, tax_minor, total_minor, notes, created_by, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'registrada', ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
        rusqlite::params![
            uid, number, w.supplier_id, w.doc_kind, w.doc_number, w.po_id, w.issue_date, w.due_date, w.totals.net_minor,
            w.totals.exempt_minor, w.totals.tax_minor, w.totals.total_minor, w.notes, by, now
        ],
    );
    match res {
        Err(rusqlite::Error::SqliteFailure(e, Some(msg)))
            if e.code == rusqlite::ErrorCode::ConstraintViolation
                && msg.contains("purchases.supplier_id") =>
        {
            Ok(None)
        }
        Err(e) => Err(e.into()),
        Ok(_) => Ok(Some(conn.last_insert_rowid())),
    }
}

pub fn insert_purchase_items(
    conn: &Connection,
    purchase_id: i64,
    lines: &[BuyLine],
) -> DbResult<()> {
    let mut stmt = conn.prepare(
        "INSERT INTO purchase_items (purchase_id, line_no, product_id, description, qty_milli, unit_price_minor, taxable,
            net_minor) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
    )?;
    for (i, l) in lines.iter().enumerate() {
        stmt.execute(rusqlite::params![
            purchase_id,
            i as i64 + 1,
            l.product_id,
            l.description,
            l.qty_milli,
            l.unit_price_minor,
            l.taxable as i64,
            l.net_minor
        ])?;
    }
    Ok(())
}

pub fn purchase_by_uid(conn: &Connection, uid: &str) -> DbResult<Option<PurchaseRow>> {
    Ok(conn
        .query_row(&format!("{PUR_SELECT} WHERE c.uid = ?1"), [uid], map_pur)
        .optional()?)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PurchaseLineRow {
    pub line_no: i64,
    pub product_uid: Option<String>,
    pub description: String,
    pub qty_milli: i64,
    pub unit_price_minor: i64,
    pub taxable: bool,
    pub net_minor: i64,
}

pub fn purchase_lines(conn: &Connection, purchase_id: i64) -> DbResult<Vec<PurchaseLineRow>> {
    let mut stmt = conn.prepare(
        "SELECT i.line_no, p.uid, i.description, i.qty_milli, i.unit_price_minor, i.taxable, i.net_minor
         FROM purchase_items i LEFT JOIN products p ON p.id = i.product_id WHERE i.purchase_id = ?1 ORDER BY i.line_no",
    )?;
    let rows = stmt.query_map([purchase_id], |r| {
        Ok(PurchaseLineRow {
            line_no: r.get(0)?,
            product_uid: r.get(1)?,
            description: r.get(2)?,
            qty_milli: r.get(3)?,
            unit_price_minor: r.get(4)?,
            taxable: r.get::<_, i64>(5)? == 1,
            net_minor: r.get(6)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Vistas de la lista de documentos de compra.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PurchaseView {
    Todas,
    PorPagar,
    Anuladas,
}

pub fn list_purchases(
    conn: &Connection,
    query: &str,
    view: PurchaseView,
    supplier_id: Option<i64>,
    limit: u32,
) -> DbResult<Vec<PurchaseRow>> {
    let cond = match view {
        PurchaseView::Todas => "c.status = 'registrada'",
        PurchaseView::PorPagar => "c.status = 'registrada' AND c.payment_state <> 'pagada'",
        PurchaseView::Anuladas => "c.status = 'anulada'",
    };
    let like = format!("%{}%", query.trim());
    let mut stmt = conn.prepare(&format!(
        "{PUR_SELECT} WHERE {cond} AND (?1 = '%%' OR c.number LIKE ?1 OR s.name LIKE ?1 OR coalesce(c.supplier_doc_number, '') LIKE ?1)
           AND (?2 IS NULL OR c.supplier_id = ?2)
         ORDER BY c.issue_date DESC, c.id DESC LIMIT ?3"
    ))?;
    let rows = stmt.query_map(rusqlite::params![like, supplier_id, limit], map_pur)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Documentos de compra registrados que nacieron de una orden: (uid, número).
pub fn purchases_of_po(conn: &Connection, po_id: i64) -> DbResult<Vec<(String, String)>> {
    let mut stmt = conn.prepare(
        "SELECT uid, number FROM purchases WHERE purchase_order_id = ?1 AND status = 'registrada' ORDER BY id",
    )?;
    let rows = stmt.query_map([po_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn set_purchase_payment(conn: &Connection, id: i64, paid: i64, state: &str) -> DbResult<()> {
    conn.execute(
        "UPDATE purchases SET paid_minor = ?2, payment_state = ?3 WHERE id = ?1",
        (id, paid, state),
    )?;
    Ok(())
}

/// Anula el documento. Su número de proveedor queda marcado "(anulado …)" para poder volver a
/// registrar el mismo documento corregido (la restricción de unicidad incluye los anulados).
pub fn void_purchase(conn: &Connection, id: i64, reason: &str) -> DbResult<()> {
    conn.execute(
        "UPDATE purchases SET status = 'anulada', void_reason = ?2,
            supplier_doc_number = CASE WHEN supplier_doc_number IS NULL THEN NULL
                                       ELSE supplier_doc_number || ' (anulado ' || number || ')' END
         WHERE id = ?1",
        (id, reason),
    )?;
    Ok(())
}

/* ───────────────────────────── Por pagar y pagos ───────────────────────────── */

pub fn insert_payable(
    conn: &Connection,
    purchase_id: i64,
    supplier_id: i64,
    due: &str,
    amount: i64,
) -> DbResult<i64> {
    conn.execute(
        "INSERT INTO payables (source_type, source_id, supplier_id, installment, due_date, amount_minor)
         VALUES ('COM', ?1, ?2, 1, ?3, ?4)",
        (purchase_id, supplier_id, due, amount),
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn open_payable(conn: &Connection, purchase_id: i64) -> DbResult<Option<i64>> {
    Ok(conn
        .query_row(
            "SELECT id FROM payables WHERE source_type = 'COM' AND source_id = ?1 AND status = 'abierta' LIMIT 1",
            [purchase_id],
            |r| r.get(0),
        )
        .optional()?)
}

pub fn void_payables(conn: &Connection, purchase_id: i64) -> DbResult<()> {
    conn.execute(
        "UPDATE payables SET status = 'anulada' WHERE source_type = 'COM' AND source_id = ?1",
        [purchase_id],
    )?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub fn insert_supplier_payment(
    conn: &Connection,
    uid: &str,
    number: &str,
    supplier_id: i64,
    account_id: i64,
    date: &str,
    method: &str,
    amount: i64,
    payable_id: i64,
    by: Option<i64>,
    now: &str,
) -> DbResult<i64> {
    conn.execute(
        "INSERT INTO payments (uid, doc_type, number, direction, party_type, party_id, money_account_id, payment_date, method,
            amount_minor, created_by, created_at)
         VALUES (?1, 'EGR', ?2, 'salida', 'proveedor', ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![uid, number, supplier_id, account_id, date, method, amount, by, now],
    )?;
    let id = conn.last_insert_rowid();
    conn.execute(
        "INSERT INTO payment_allocations (payment_id, payable_id, amount_minor, created_at) VALUES (?1, ?2, ?3, ?4)",
        (id, payable_id, amount, now),
    )?;
    Ok(id)
}

/// Pagos vigentes de un documento de compra: (número, fecha, monto, medio).
pub fn purchase_payments(
    conn: &Connection,
    purchase_id: i64,
) -> DbResult<Vec<(String, String, i64, String)>> {
    let mut stmt = conn.prepare(
        "SELECT p.number, p.payment_date, a.amount_minor, p.method FROM payment_allocations a
         JOIN payments p ON p.id = a.payment_id JOIN payables b ON b.id = a.payable_id
         WHERE b.source_type = 'COM' AND b.source_id = ?1 AND p.status = 'vigente' ORDER BY p.payment_date, p.id",
    )?;
    let rows = stmt.query_map([purchase_id], |r| {
        Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn void_payments_of_purchase(
    conn: &Connection,
    purchase_id: i64,
    reason: &str,
) -> DbResult<usize> {
    Ok(conn.execute(
        "UPDATE payments SET status = 'anulado', void_reason = ?2 WHERE status = 'vigente' AND id IN (
            SELECT a.payment_id FROM payment_allocations a JOIN payables b ON b.id = a.payable_id
            WHERE b.source_type = 'COM' AND b.source_id = ?1)",
        (purchase_id, reason),
    )?)
}

/* ───────────────────────────── Historial de precios ───────────────────────────── */

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct PriceHistoryRow {
    pub supplier_uid: String,
    pub supplier_name: String,
    pub date: String,
    pub document: String,
    pub unit_price_minor: i64,
    pub qty_milli: i64,
}

/// Últimos precios de compra de un producto (documentos registrados y órdenes emitidas).
pub fn price_history(
    conn: &Connection,
    product_id: i64,
    limit: u32,
) -> DbResult<Vec<PriceHistoryRow>> {
    let mut stmt = conn.prepare(
        "SELECT s.uid, s.name, c.issue_date, c.number, i.unit_price_minor, i.qty_milli
           FROM purchase_items i JOIN purchases c ON c.id = i.purchase_id JOIN suppliers s ON s.id = c.supplier_id
          WHERE i.product_id = ?1 AND c.status = 'registrada'
         UNION ALL
         SELECT s.uid, s.name, o.order_date, o.number, i.unit_price_minor, i.qty_milli
           FROM purchase_order_items i JOIN purchase_orders o ON o.id = i.purchase_order_id JOIN suppliers s ON s.id = o.supplier_id
          WHERE i.product_id = ?1 AND o.status NOT IN ('borrador', 'anulada')
         ORDER BY 3 DESC LIMIT ?2",
    )?;
    let rows = stmt.query_map((product_id, limit), |r| {
        Ok(PriceHistoryRow {
            supplier_uid: r.get(0)?,
            supplier_name: r.get(1)?,
            date: r.get(2)?,
            document: r.get(3)?,
            unit_price_minor: r.get(4)?,
            qty_milli: r.get(5)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}
