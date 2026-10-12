//! Reservas de stock de ventas por despachar: se crean al efectuar una venta de un producto en modo
//! «reservar» y se consumen al despachar. Lo pendiente es `qty_milli − dispatched_milli`.

use crate::DbResult;
use rusqlite::{Connection, OptionalExtension};

/// Una línea vendida que falta despachar (o parte de ella).
#[derive(Debug, Clone)]
pub struct PendingRow {
    pub id: i64,
    pub product_id: i64,
    pub warehouse_id: i64,
    pub sale_id: i64,
    pub sale_uid: String,
    pub sale_number: String,
    pub doc_type: String,
    pub issue_date: String,
    pub customer: Option<String>,
    pub product_uid: String,
    pub product_name: String,
    pub sku: String,
    pub unit: String,
    pub line_id: Option<i64>,
    pub qty_milli: i64,
    pub dispatched_milli: i64,
    pub created_at: String,
}

const SELECT: &str = "SELECT r.id, r.product_id, r.warehouse_id, s.id, s.uid, s.number, s.doc_type, s.issue_date,
        c.name, p.uid, p.name, coalesce(p.sku, ''), lower(p.unit_code), r.source_line_id, r.qty_milli,
        r.dispatched_milli, r.created_at
    FROM stock_reservations r
    JOIN sales s ON s.id = r.source_id AND s.doc_type = r.source_type
    JOIN products p ON p.id = r.product_id
    LEFT JOIN customers c ON c.id = s.customer_id";

fn map(r: &rusqlite::Row<'_>) -> rusqlite::Result<PendingRow> {
    Ok(PendingRow {
        id: r.get(0)?,
        product_id: r.get(1)?,
        warehouse_id: r.get(2)?,
        sale_id: r.get(3)?,
        sale_uid: r.get(4)?,
        sale_number: r.get(5)?,
        doc_type: r.get(6)?,
        issue_date: r.get(7)?,
        customer: r.get(8)?,
        product_uid: r.get(9)?,
        product_name: r.get(10)?,
        sku: r.get(11)?,
        unit: r.get(12)?,
        line_id: r.get(13)?,
        qty_milli: r.get(14)?,
        dispatched_milli: r.get(15)?,
        created_at: r.get(16)?,
    })
}

/// Reserva lo vendido de una línea (queda pendiente de despacho).
#[allow(clippy::too_many_arguments)]
pub fn insert(
    conn: &Connection,
    product_id: i64,
    warehouse_id: i64,
    qty_milli: i64,
    source_type: &str,
    source_id: i64,
    source_line_id: i64,
    now: &str,
) -> DbResult<()> {
    conn.execute(
        "INSERT INTO stock_reservations (product_id, warehouse_id, qty_milli, source_type, source_id, source_line_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![product_id, warehouse_id, qty_milli, source_type, source_id, source_line_id, now],
    )?;
    Ok(())
}

/// Reservas activas de ventas, de la más antigua a la más nueva.
pub fn pending(conn: &Connection) -> DbResult<Vec<PendingRow>> {
    let mut stmt = conn.prepare(&format!(
        "{SELECT} WHERE r.status = 'activa' AND s.commercial_state IN ('efectuada', 'cerrada')
         ORDER BY r.created_at, r.id"
    ))?;
    Ok(stmt.query_map([], map)?.collect::<Result<Vec<_>, _>>()?)
}

/// Todas las reservas de una venta (activas y cerradas).
pub fn of_sale(conn: &Connection, sale_id: i64) -> DbResult<Vec<PendingRow>> {
    let mut stmt = conn.prepare(&format!("{SELECT} WHERE s.id = ?1 ORDER BY r.id"))?;
    Ok(stmt
        .query_map([sale_id], map)?
        .collect::<Result<Vec<_>, _>>()?)
}

pub fn by_id(conn: &Connection, id: i64) -> DbResult<Option<PendingRow>> {
    Ok(conn
        .query_row(
            &format!("{SELECT} WHERE r.id = ?1 AND r.status = 'activa'"),
            [id],
            map,
        )
        .optional()?)
}

/// Unidades pendientes de otras ventas para un producto en una bodega (lo ya comprometido).
pub fn committed(conn: &Connection, product_id: i64, warehouse_id: i64) -> DbResult<i64> {
    Ok(conn.query_row(
        "SELECT ifnull(sum(qty_milli - dispatched_milli), 0) FROM stock_reservations
         WHERE product_id = ?1 AND warehouse_id = ?2 AND status = 'activa'",
        (product_id, warehouse_id),
        |r| r.get(0),
    )?)
}

/// Suma lo despachado; si se completa, la reserva queda consumida.
pub fn add_dispatched(conn: &Connection, id: i64, qty_milli: i64, now: &str) -> DbResult<()> {
    conn.execute(
        "UPDATE stock_reservations SET dispatched_milli = dispatched_milli + ?2,
            status = CASE WHEN dispatched_milli + ?2 >= qty_milli THEN 'consumida' ELSE status END,
            closed_at = CASE WHEN dispatched_milli + ?2 >= qty_milli THEN ?3 ELSE closed_at END
         WHERE id = ?1",
        rusqlite::params![id, qty_milli, now],
    )?;
    Ok(())
}

/// Libera las reservas activas de una venta (al anularla). Devuelve lo pendiente por línea.
pub fn release_sale(
    conn: &Connection,
    source_type: &str,
    sale_id: i64,
    now: &str,
) -> DbResult<Vec<(i64, i64)>> {
    let mut stmt = conn.prepare(
        "SELECT source_line_id, qty_milli - dispatched_milli FROM stock_reservations
         WHERE source_type = ?1 AND source_id = ?2 AND status = 'activa' AND source_line_id IS NOT NULL",
    )?;
    let rows = stmt
        .query_map((source_type, sale_id), |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<Vec<(i64, i64)>, _>>()?;
    conn.execute(
        "UPDATE stock_reservations SET status = 'liberada', closed_at = ?3
         WHERE source_type = ?1 AND source_id = ?2 AND status = 'activa'",
        (source_type, sale_id, now),
    )?;
    Ok(rows)
}
