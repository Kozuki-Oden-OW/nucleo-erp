//! Inventario (Fase 7): bodegas, kárdex, ajustes, transferencias y datos para el análisis de stock.
//! El stock se mueve solo con inserciones en `stock_movements` (ver `products::insert_movement`).

use crate::{DbError, DbResult};
use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;

/* ───────────────────────────── Bodegas ───────────────────────────── */

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct WarehouseRow {
    #[serde(skip)]
    pub id: i64,
    pub uid: String,
    pub code: String,
    pub name: String,
    pub is_default: bool,
    pub archived: bool,
    /// Valor del stock de la bodega al costo promedio (unidad mínima).
    pub stock_value_minor: i64,
    pub products_with_stock: i64,
}

pub fn warehouses(conn: &Connection) -> DbResult<Vec<WarehouseRow>> {
    let mut stmt = conn.prepare(
        "SELECT w.id, w.uid, w.code, w.name, w.is_default, w.archived_at IS NOT NULL,
            coalesce((SELECT CAST(round(sum(CASE WHEN b.on_hand_milli > 0 THEN b.on_hand_milli * b.avg_cost_e4 ELSE 0 END) / 10000000.0) AS INTEGER)
                      FROM stock_balances b WHERE b.warehouse_id = w.id), 0),
            (SELECT count(*) FROM stock_balances b WHERE b.warehouse_id = w.id AND b.on_hand_milli <> 0)
         FROM warehouses w ORDER BY w.archived_at IS NOT NULL, w.is_default DESC, w.name COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(WarehouseRow {
            id: r.get(0)?,
            uid: r.get(1)?,
            code: r.get(2)?,
            name: r.get(3)?,
            is_default: r.get::<_, i64>(4)? == 1,
            archived: r.get::<_, i64>(5)? == 1,
            stock_value_minor: r.get(6)?,
            products_with_stock: r.get(7)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn warehouse_by_uid(conn: &Connection, uid: &str) -> DbResult<Option<WarehouseRow>> {
    Ok(warehouses(conn)?.into_iter().find(|w| w.uid == uid))
}

pub fn insert_warehouse(
    conn: &Connection,
    uid: &str,
    code: &str,
    name: &str,
    now: &str,
) -> DbResult<i64> {
    let res = conn.execute(
        "INSERT INTO warehouses (uid, code, name, is_default, created_at)
         VALUES (?1, ?2, ?3, CASE WHEN EXISTS (SELECT 1 FROM warehouses WHERE is_default = 1) THEN 0 ELSE 1 END, ?4)",
        (uid, code, name.trim(), now),
    );
    match res {
        Err(rusqlite::Error::SqliteFailure(e, Some(msg)))
            if e.code == rusqlite::ErrorCode::ConstraintViolation
                && msg.contains("warehouses.code") =>
        {
            Err(DbError::Duplicate("código de bodega"))
        }
        other => {
            other?;
            Ok(conn.last_insert_rowid())
        }
    }
}

pub fn rename_warehouse(conn: &Connection, id: i64, name: &str) -> DbResult<()> {
    conn.execute(
        "UPDATE warehouses SET name = ?2 WHERE id = ?1",
        (id, name.trim()),
    )?;
    Ok(())
}

pub fn set_default_warehouse(conn: &Connection, id: i64) -> DbResult<()> {
    conn.execute(
        "UPDATE warehouses SET is_default = 0 WHERE is_default = 1",
        [],
    )?;
    conn.execute(
        "UPDATE warehouses SET is_default = 1, archived_at = NULL WHERE id = ?1",
        [id],
    )?;
    Ok(())
}

pub fn archive_warehouse(conn: &Connection, id: i64, now: &str) -> DbResult<()> {
    conn.execute(
        "UPDATE warehouses SET archived_at = ?2 WHERE id = ?1",
        (id, now),
    )?;
    Ok(())
}

/// Siguiente código libre "B1", "B2"… para una bodega nueva.
pub fn next_warehouse_code(conn: &Connection) -> DbResult<String> {
    let n: i64 = conn.query_row("SELECT count(*) FROM warehouses", [], |r| r.get(0))?;
    let mut i = n + 1;
    loop {
        let code = format!("B{i}");
        let used: i64 = conn.query_row(
            "SELECT count(*) FROM warehouses WHERE code = ?1",
            [&code],
            |r| r.get(0),
        )?;
        if used == 0 {
            return Ok(code);
        }
        i += 1;
    }
}

/* ───────────────────────────── Stock por bodega y kárdex ───────────────────────────── */

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct StockByWarehouse {
    pub warehouse_uid: String,
    pub warehouse_name: String,
    pub on_hand_milli: i64,
    pub avg_cost_e4: i64,
}

pub fn stock_by_warehouse(conn: &Connection, product_id: i64) -> DbResult<Vec<StockByWarehouse>> {
    let mut stmt = conn.prepare(
        "SELECT w.uid, w.name, coalesce(b.on_hand_milli, 0), coalesce(b.avg_cost_e4, 0)
         FROM warehouses w LEFT JOIN stock_balances b ON b.warehouse_id = w.id AND b.product_id = ?1
         WHERE w.archived_at IS NULL OR coalesce(b.on_hand_milli, 0) <> 0
         ORDER BY w.is_default DESC, w.name COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([product_id], |r| {
        Ok(StockByWarehouse {
            warehouse_uid: r.get(0)?,
            warehouse_name: r.get(1)?,
            on_hand_milli: r.get(2)?,
            avg_cost_e4: r.get(3)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct KardexRow {
    pub id: i64,
    pub date: String,
    pub warehouse_name: String,
    pub kind: String,
    /// Documento que originó el movimiento (VEN-000012, REC-000003, AJU-000001…).
    pub document: String,
    pub source_type: String,
    pub source_uid: Option<String>,
    pub qty_milli: i64,
    pub unit_cost_e4: i64,
    pub avg_cost_after_e4: i64,
    /// Saldo del producto (todas las bodegas, o la elegida) después del movimiento.
    pub balance_milli: i64,
    pub reason: Option<String>,
}

/// Kárdex de un producto (más reciente primero), con saldo acumulado.
pub fn kardex(
    conn: &Connection,
    product_id: i64,
    warehouse_id: Option<i64>,
    limit: u32,
) -> DbResult<Vec<KardexRow>> {
    let mut stmt = conn.prepare(
        "SELECT m.id, m.movement_date, w.name, m.kind, m.source_type, m.source_id, m.qty_milli, m.unit_cost_e4,
            m.avg_cost_after_e4, m.reason,
            sum(m.qty_milli) OVER (ORDER BY m.movement_date, m.id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW),
            CASE m.source_type
                WHEN 'VEN' THEN (SELECT number FROM sales WHERE id = m.source_id)
                WHEN 'FV' THEN (SELECT number FROM sales WHERE id = m.source_id)
                WHEN 'REC' THEN (SELECT number FROM receipts WHERE id = m.source_id)
                WHEN 'AJU' THEN (SELECT number FROM stock_adjustments WHERE id = m.source_id)
                WHEN 'TRA' THEN (SELECT number FROM stock_transfers WHERE id = m.source_id)
            END,
            CASE m.source_type
                WHEN 'VEN' THEN (SELECT uid FROM sales WHERE id = m.source_id)
                WHEN 'FV' THEN (SELECT uid FROM sales WHERE id = m.source_id)
                WHEN 'REC' THEN (SELECT coalesce(o.uid, c.uid, im.uid) FROM receipts r
                                   LEFT JOIN purchase_orders o ON o.id = r.purchase_order_id
                                   LEFT JOIN imports im ON im.id = r.import_id
                                   LEFT JOIN document_links l ON l.target_type = 'REC' AND l.target_id = r.id AND l.source_type = 'COM'
                                   LEFT JOIN purchases c ON c.id = l.source_id
                                  WHERE r.id = m.source_id)
            END,
            CASE WHEN m.source_type = 'REC' THEN
                (SELECT CASE WHEN r.import_id IS NOT NULL THEN 'IMP' WHEN r.purchase_order_id IS NULL THEN 'COM' ELSE 'OC' END FROM receipts r WHERE r.id = m.source_id)
            END
         FROM stock_movements m JOIN warehouses w ON w.id = m.warehouse_id
         WHERE m.product_id = ?1 AND (?2 IS NULL OR m.warehouse_id = ?2)
         ORDER BY m.movement_date DESC, m.id DESC LIMIT ?3",
    )?;
    let rows = stmt.query_map(rusqlite::params![product_id, warehouse_id, limit], |r| {
        let kind: String = r.get(3)?;
        let st: String = r.get(4)?;
        let number: Option<String> = r.get(11)?;
        let rec_kind: Option<String> = r.get(13)?;
        Ok(KardexRow {
            id: r.get(0)?,
            date: r.get(1)?,
            warehouse_name: r.get(2)?,
            document: if kind == "inicial" {
                "Stock inicial".into()
            } else {
                number.unwrap_or_else(|| st.clone())
            },
            source_type: rec_kind.unwrap_or(st),
            kind,
            source_uid: r.get(12)?,
            qty_milli: r.get(6)?,
            unit_cost_e4: r.get(7)?,
            avg_cost_after_e4: r.get(8)?,
            reason: r.get(9)?,
            balance_milli: r.get(10)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/* ───────────────────────────── Ajustes y transferencias ───────────────────────────── */

#[allow(clippy::too_many_arguments)]
pub fn insert_adjustment(
    conn: &Connection,
    uid: &str,
    number: &str,
    warehouse_id: i64,
    date: &str,
    kind: &str,
    reason: &str,
    by: Option<i64>,
    now: &str,
) -> DbResult<i64> {
    conn.execute(
        "INSERT INTO stock_adjustments (uid, number, warehouse_id, adjust_date, kind, reason, created_by, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![uid, number, warehouse_id, date, kind, reason, by, now],
    )?;
    Ok(conn.last_insert_rowid())
}

#[allow(clippy::too_many_arguments)]
pub fn insert_transfer(
    conn: &Connection,
    uid: &str,
    number: &str,
    from: i64,
    to: i64,
    date: &str,
    notes: Option<&str>,
    by: Option<i64>,
    now: &str,
) -> DbResult<i64> {
    conn.execute(
        "INSERT INTO stock_transfers (uid, number, from_warehouse_id, to_warehouse_id, transfer_date, notes, created_by, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![uid, number, from, to, date, notes, by, now],
    )?;
    Ok(conn.last_insert_rowid())
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct StockDocRow {
    pub uid: String,
    pub number: String,
    pub kind: String,
    pub date: String,
    pub description: String,
    pub lines: i64,
    pub created_by: Option<String>,
}

/// Últimos ajustes y transferencias (para la pestaña "Movimientos").
pub fn stock_documents(conn: &Connection, limit: u32) -> DbResult<Vec<StockDocRow>> {
    let mut stmt = conn.prepare(
        "SELECT * FROM (
            SELECT a.uid, a.number, a.kind, a.adjust_date AS d, w.name || ' · ' || a.reason,
                (SELECT count(*) FROM stock_movements m WHERE m.source_type = 'AJU' AND m.source_id = a.id AND m.kind = 'ajuste'),
                u.display_name, a.id
            FROM stock_adjustments a JOIN warehouses w ON w.id = a.warehouse_id LEFT JOIN users u ON u.id = a.created_by
            UNION ALL
            SELECT t.uid, t.number, 'transferencia', t.transfer_date, f.name || ' → ' || d.name,
                (SELECT count(*) FROM stock_movements m WHERE m.source_type = 'TRA' AND m.source_id = t.id AND m.qty_milli > 0),
                u.display_name, t.id
            FROM stock_transfers t JOIN warehouses f ON f.id = t.from_warehouse_id JOIN warehouses d ON d.id = t.to_warehouse_id
            LEFT JOIN users u ON u.id = t.created_by
         ) ORDER BY d DESC, 1 DESC LIMIT ?1",
    )?;
    let rows = stmt.query_map([limit], |r| {
        Ok(StockDocRow {
            uid: r.get(0)?,
            number: r.get(1)?,
            kind: r.get(2)?,
            date: r.get(3)?,
            description: r.get(4)?,
            lines: r.get(5)?,
            created_by: r.get(6)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/* ───────────────────────────── Datos para el análisis ───────────────────────────── */

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PositionRow {
    pub product_id: i64,
    pub on_hand_milli: i64,
    pub reserved_milli: i64,
    pub in_purchase_milli: i64,
    pub in_import_milli: i64,
    pub in_receiving_milli: i64,
}

pub fn positions(conn: &Connection) -> DbResult<Vec<PositionRow>> {
    let mut stmt = conn.prepare(
        "SELECT product_id, on_hand_milli, reserved_milli, in_purchase_milli, in_import_milli, in_receiving_milli FROM v_stock_position",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(PositionRow {
            product_id: r.get(0)?,
            on_hand_milli: r.get(1)?,
            reserved_milli: r.get(2)?,
            in_purchase_milli: r.get(3)?,
            in_import_milli: r.get(4)?,
            in_receiving_milli: r.get(5)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Saldo de cada producto antes de una fecha (para reconstruir los días con stock).
pub fn balances_before(conn: &Connection, date: &str) -> DbResult<Vec<(i64, i64)>> {
    let mut stmt = conn.prepare(
        "SELECT product_id, sum(qty_milli) FROM stock_movements WHERE movement_date < ?1 GROUP BY product_id",
    )?;
    let rows = stmt.query_map([date], |r| Ok((r.get(0)?, r.get(1)?)))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Movimientos netos por producto y día desde una fecha: (producto, fecha, cantidad, vendida).
pub fn daily_moves_since(conn: &Connection, date: &str) -> DbResult<Vec<(i64, String, i64, i64)>> {
    let mut stmt = conn.prepare(
        "SELECT product_id, movement_date, sum(qty_milli),
            sum(CASE WHEN kind = 'salida' AND source_type IN ('VEN', 'FV', 'SRV') THEN -qty_milli ELSE 0 END)
         FROM stock_movements WHERE movement_date >= ?1 GROUP BY product_id, movement_date ORDER BY product_id, movement_date",
    )?;
    let rows = stmt.query_map([date], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Unidades devueltas por ventas anuladas en el período (se descuentan de lo vendido).
pub fn voided_sales_returns_since(conn: &Connection, date: &str) -> DbResult<Vec<(i64, i64)>> {
    let mut stmt = conn.prepare(
        "SELECT m.product_id, sum(m.qty_milli) FROM stock_movements m
         WHERE m.kind = 'ajuste' AND m.source_type IN ('VEN', 'FV') AND m.qty_milli > 0
           AND (SELECT min(x.movement_date) FROM stock_movements x WHERE x.source_type = m.source_type AND x.source_id = m.source_id) >= ?1
         GROUP BY m.product_id",
    )?;
    let rows = stmt.query_map([date], |r| Ok((r.get(0)?, r.get(1)?)))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Última fecha con movimiento por producto.
pub fn last_movement_dates(conn: &Connection) -> DbResult<Vec<(i64, String)>> {
    let mut stmt = conn.prepare(
        "SELECT product_id, max(movement_date) FROM stock_movements GROUP BY product_id",
    )?;
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Próxima llegada esperada por producto (órdenes emitidas o parciales con fecha).
pub fn next_arrivals(conn: &Connection) -> DbResult<Vec<(i64, String, i64)>> {
    let mut stmt = conn.prepare(
        "SELECT i.product_id, min(o.expected_date), sum(i.qty_milli - i.received_milli)
         FROM purchase_order_items i JOIN purchase_orders o ON o.id = i.purchase_order_id
         WHERE i.product_id IS NOT NULL AND i.received_milli < i.qty_milli AND o.status IN ('emitida', 'parcial')
           AND o.expected_date IS NOT NULL
         GROUP BY i.product_id",
    )?;
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ReorderSettingsRow {
    pub safety_days: i64,
    pub target_coverage_days: i64,
    pub excess_coverage_days: i64,
    pub lead_time_days: Option<i64>,
}

impl Default for ReorderSettingsRow {
    fn default() -> Self {
        Self {
            safety_days: 7,
            target_coverage_days: 30,
            excess_coverage_days: 180,
            lead_time_days: None,
        }
    }
}

pub fn reorder_settings_all(conn: &Connection) -> DbResult<Vec<(i64, ReorderSettingsRow)>> {
    let mut stmt = conn.prepare(
        "SELECT product_id, safety_days, target_coverage_days, excess_coverage_days, lead_time_days FROM reorder_settings",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get(0)?,
            ReorderSettingsRow {
                safety_days: r.get(1)?,
                target_coverage_days: r.get(2)?,
                excess_coverage_days: r.get(3)?,
                lead_time_days: r.get(4)?,
            },
        ))
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn reorder_settings(conn: &Connection, product_id: i64) -> DbResult<ReorderSettingsRow> {
    Ok(conn
        .query_row(
            "SELECT safety_days, target_coverage_days, excess_coverage_days, lead_time_days FROM reorder_settings WHERE product_id = ?1",
            [product_id],
            |r| Ok(ReorderSettingsRow { safety_days: r.get(0)?, target_coverage_days: r.get(1)?, excess_coverage_days: r.get(2)?, lead_time_days: r.get(3)? }),
        )
        .optional()?
        .unwrap_or_default())
}

pub fn save_reorder_settings(
    conn: &Connection,
    product_id: i64,
    s: &ReorderSettingsRow,
) -> DbResult<()> {
    conn.execute(
        "INSERT INTO reorder_settings (product_id, safety_days, target_coverage_days, excess_coverage_days, lead_time_days)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(product_id) DO UPDATE SET safety_days = excluded.safety_days, target_coverage_days = excluded.target_coverage_days,
            excess_coverage_days = excluded.excess_coverage_days, lead_time_days = excluded.lead_time_days",
        rusqlite::params![product_id, s.safety_days, s.target_coverage_days, s.excess_coverage_days, s.lead_time_days],
    )?;
    Ok(())
}

pub fn set_min_stock(conn: &Connection, product_id: i64, min_milli: Option<i64>) -> DbResult<()> {
    conn.execute(
        "UPDATE products SET min_stock_milli = ?2 WHERE id = ?1",
        (product_id, min_milli),
    )?;
    Ok(())
}
