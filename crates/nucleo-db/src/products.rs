//! Productos y servicios (base de la Fase 5): ficha, búsqueda, stock y costo promedio.
//! Las bodegas, ajustes y transferencias completos llegan con la Fase 7 (Inventario).

use crate::customers::fts_query;
use crate::{DbError, DbResult};
use rusqlite::{Connection, OptionalExtension, Row};
use serde::Serialize;

/// Producto tal como lo ve la interfaz (montos en unidad mínima, cantidades en milésimas).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ProductRow {
    #[serde(skip)]
    pub id: i64,
    pub uid: String,
    pub sku: String,
    pub name: String,
    /// Código de unidad en minúsculas ("un", "kg"…).
    pub unit: String,
    /// "producto" o "servicio".
    pub kind: String,
    pub price_minor: i64,
    pub cost_e4: i64,
    pub on_hand_milli: i64,
    pub min_milli: i64,
    pub taxable: bool,
    #[serde(skip)]
    pub track_stock: bool,
}

const SELECT: &str = "SELECT p.id, p.uid, coalesce(p.sku, ''), p.name, lower(p.unit_code),
        CASE p.kind WHEN 'servicio' THEN 'servicio' ELSE 'producto' END,
        p.price_minor, p.avg_cost_e4,
        coalesce((SELECT sum(b.on_hand_milli) FROM stock_balances b WHERE b.product_id = p.id), 0),
        coalesce(p.min_stock_milli, 0), p.taxable, p.track_stock
    FROM products p";

fn map(r: &Row<'_>) -> rusqlite::Result<ProductRow> {
    Ok(ProductRow {
        id: r.get(0)?,
        uid: r.get(1)?,
        sku: r.get(2)?,
        name: r.get(3)?,
        unit: r.get(4)?,
        kind: r.get(5)?,
        price_minor: r.get(6)?,
        cost_e4: r.get(7)?,
        on_hand_milli: r.get(8)?,
        min_milli: r.get(9)?,
        taxable: r.get::<_, i64>(10)? == 1,
        track_stock: r.get::<_, i64>(11)? == 1,
    })
}

pub fn by_uid(conn: &Connection, uid: &str) -> DbResult<Option<ProductRow>> {
    Ok(conn
        .query_row(&format!("{SELECT} WHERE p.uid = ?1"), [uid], map)
        .optional()?)
}

pub fn by_id(conn: &Connection, id: i64) -> DbResult<Option<ProductRow>> {
    Ok(conn
        .query_row(&format!("{SELECT} WHERE p.id = ?1"), [id], map)
        .optional()?)
}

/// Busca por nombre, código o código de barras (prefijos, sin tildes). Sin texto: por nombre.
pub fn search(conn: &Connection, input: &str, limit: u32) -> DbResult<Vec<ProductRow>> {
    let mut rows = Vec::new();
    match fts_query(input) {
        Some(q) => {
            let mut stmt = conn.prepare(&format!(
                "{SELECT} JOIN products_fts f ON f.rowid = p.id
                 WHERE products_fts MATCH ?1 AND p.archived_at IS NULL
                 ORDER BY bm25(products_fts) LIMIT ?2"
            ))?;
            for r in stmt.query_map((q, limit), map)? {
                rows.push(r?);
            }
        }
        None => {
            let mut stmt = conn.prepare(&format!(
                "{SELECT} WHERE p.archived_at IS NULL ORDER BY p.name COLLATE NOCASE LIMIT ?1"
            ))?;
            for r in stmt.query_map([limit], map)? {
                rows.push(r?);
            }
        }
    }
    Ok(rows)
}

pub struct NewProductRow<'a> {
    pub uid: &'a str,
    pub sku: Option<&'a str>,
    pub name: &'a str,
    pub unit_code: &'a str,
    /// "bien" o "servicio".
    pub kind: &'a str,
    pub price_minor: i64,
    pub cost_e4: i64,
    pub taxable: bool,
    pub created_at: &'a str,
}

/// Inserta el producto. Si no trae código, se asigna `P-00001` según su id.
pub fn insert(conn: &Connection, p: &NewProductRow<'_>) -> DbResult<ProductRow> {
    let unit_ok: bool = conn
        .query_row(
            "SELECT count(*) FROM units WHERE code = ?1",
            [p.unit_code],
            |r| r.get::<_, i64>(0),
        )
        .map(|n| n > 0)?;
    if !unit_ok {
        return Err(DbError::Rule(format!(
            "la unidad «{}» no existe",
            p.unit_code
        )));
    }
    let track = if p.kind == "servicio" { 0 } else { 1 };
    let res = conn.execute(
        "INSERT INTO products (uid, kind, sku, name, unit_code, taxable, track_stock, price_minor, avg_cost_e4, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        (
            p.uid,
            p.kind,
            p.sku,
            p.name.trim(),
            p.unit_code,
            p.taxable as i64,
            track,
            p.price_minor,
            p.cost_e4,
            p.created_at,
        ),
    );
    match res {
        Err(rusqlite::Error::SqliteFailure(e, Some(msg)))
            if e.code == rusqlite::ErrorCode::ConstraintViolation
                && msg.contains("products.sku") =>
        {
            return Err(DbError::Duplicate("código de producto"));
        }
        other => {
            other?;
        }
    }
    let id = conn.last_insert_rowid();
    if p.sku.is_none() {
        conn.execute(
            "UPDATE products SET sku = printf('P-%05d', id) WHERE id = ?1",
            [id],
        )?;
    }
    by_id(conn, id)?.ok_or(DbError::Rule("producto no encontrado".into()))
}

pub struct ProductUpdate<'a> {
    pub name: &'a str,
    pub sku: &'a str,
    pub unit_code: &'a str,
    pub price_minor: i64,
    pub taxable: bool,
    pub min_stock_milli: Option<i64>,
    pub updated_at: &'a str,
}

/// Cambia los datos de la ficha (no el stock ni el costo: esos los mueve el libro de stock).
pub fn update(conn: &Connection, id: i64, u: &ProductUpdate<'_>) -> DbResult<()> {
    let unit_ok: i64 = conn.query_row(
        "SELECT count(*) FROM units WHERE code = ?1",
        [u.unit_code],
        |r| r.get(0),
    )?;
    if unit_ok == 0 {
        return Err(DbError::Rule(format!(
            "la unidad «{}» no existe",
            u.unit_code
        )));
    }
    let res = conn.execute(
        "UPDATE products SET name = ?2, sku = ?3, unit_code = ?4, price_minor = ?5, taxable = ?6,
            min_stock_milli = ?7, updated_at = ?8 WHERE id = ?1",
        rusqlite::params![
            id,
            u.name.trim(),
            u.sku,
            u.unit_code,
            u.price_minor,
            u.taxable as i64,
            u.min_stock_milli,
            u.updated_at
        ],
    );
    match res {
        Err(rusqlite::Error::SqliteFailure(e, Some(msg)))
            if e.code == rusqlite::ErrorCode::ConstraintViolation
                && msg.contains("products.sku") =>
        {
            Err(DbError::Duplicate("código de producto"))
        }
        other => {
            other?;
            Ok(())
        }
    }
}

/// Bodega por defecto; se crea "Bodega principal" la primera vez que se necesita.
pub fn default_warehouse(conn: &Connection, now: &str) -> DbResult<i64> {
    if let Some(id) = conn
        .query_row(
            "SELECT id FROM warehouses WHERE is_default = 1 AND archived_at IS NULL",
            [],
            |r| r.get(0),
        )
        .optional()?
    {
        return Ok(id);
    }
    conn.execute(
        "INSERT INTO warehouses (uid, code, name, is_default, created_at)
         VALUES (?1, 'B1', 'Bodega principal', 1, ?2)",
        (uuid::Uuid::now_v7().to_string(), now),
    )?;
    Ok(conn.last_insert_rowid())
}

/// Saldo y costo promedio de un producto en una bodega.
pub fn balance(conn: &Connection, product_id: i64, warehouse_id: i64) -> DbResult<(i64, i64)> {
    let row: Option<(i64, i64)> = conn
        .query_row(
            "SELECT on_hand_milli, avg_cost_e4 FROM stock_balances WHERE product_id = ?1 AND warehouse_id = ?2",
            (product_id, warehouse_id),
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    match row {
        Some(r) => Ok(r),
        None => {
            let avg: i64 = conn.query_row(
                "SELECT avg_cost_e4 FROM products WHERE id = ?1",
                [product_id],
                |r| r.get(0),
            )?;
            Ok((0, avg))
        }
    }
}

/// Un movimiento del libro de stock (solo inserción; el saldo lo mantiene un trigger).
pub struct Movement<'a> {
    pub product_id: i64,
    pub warehouse_id: i64,
    pub date: &'a str,
    pub kind: &'a str,
    pub qty_milli: i64,
    pub unit_cost_e4: i64,
    pub avg_cost_after_e4: i64,
    pub source_type: &'a str,
    pub source_id: i64,
    pub source_line_id: Option<i64>,
    pub reason: Option<&'a str>,
    pub created_by: Option<i64>,
    pub created_at: &'a str,
}

pub fn insert_movement(conn: &Connection, m: &Movement<'_>) -> DbResult<()> {
    conn.execute(
        "INSERT INTO stock_movements (product_id, warehouse_id, movement_date, kind, qty_milli, unit_cost_e4,
            avg_cost_after_e4, source_type, source_id, source_line_id, reason, created_by, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        rusqlite::params![
            m.product_id,
            m.warehouse_id,
            m.date,
            m.kind,
            m.qty_milli,
            m.unit_cost_e4,
            m.avg_cost_after_e4,
            m.source_type,
            m.source_id,
            m.source_line_id,
            m.reason,
            m.created_by,
            m.created_at
        ],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::*;

    const T: &str = "2026-10-06T12:00:00Z";

    fn nuevo<'a>(uid: &'a str, name: &'a str, kind: &'a str) -> NewProductRow<'a> {
        NewProductRow {
            uid,
            sku: None,
            name,
            unit_code: "UN",
            kind,
            price_minor: 1000,
            cost_e4: 6_000_000,
            taxable: true,
            created_at: T,
        }
    }

    #[test]
    fn inserta_con_codigo_automatico_y_busca() {
        let dir = tempfile::tempdir().unwrap();
        let db = fresh_db(&dir);
        let p = insert(db.conn(), &nuevo("p1", "Martillo carpintero", "bien")).unwrap();
        assert_eq!(p.sku, format!("P-{:05}", p.id));
        assert_eq!(p.unit, "un");
        assert!(p.track_stock);
        let s = insert(db.conn(), &nuevo("p2", "Instalación eléctrica", "servicio")).unwrap();
        assert_eq!(s.kind, "servicio");
        assert!(!s.track_stock);
        assert_eq!(search(db.conn(), "martil", 10).unwrap().len(), 1);
        assert_eq!(search(db.conn(), "instalacion", 10).unwrap()[0].uid, "p2");
        assert_eq!(search(db.conn(), "", 10).unwrap().len(), 2);
    }

    #[test]
    fn stock_por_libro_de_movimientos() {
        let dir = tempfile::tempdir().unwrap();
        let db = fresh_db(&dir);
        let p = insert(db.conn(), &nuevo("p1", "Clavo", "bien")).unwrap();
        let w = default_warehouse(db.conn(), T).unwrap();
        assert_eq!(default_warehouse(db.conn(), T).unwrap(), w, "no duplica");
        insert_movement(
            db.conn(),
            &Movement {
                product_id: p.id,
                warehouse_id: w,
                date: "2026-10-06",
                kind: "inicial",
                qty_milli: 5_000,
                unit_cost_e4: 6_000_000,
                avg_cost_after_e4: 6_000_000,
                source_type: "AJU",
                source_id: p.id,
                source_line_id: None,
                reason: Some("Stock inicial"),
                created_by: None,
                created_at: T,
            },
        )
        .unwrap();
        assert_eq!(balance(db.conn(), p.id, w).unwrap(), (5_000, 6_000_000));
        assert_eq!(
            by_uid(db.conn(), "p1").unwrap().unwrap().on_hand_milli,
            5_000
        );
    }

    #[test]
    fn unidad_inexistente_y_codigo_duplicado() {
        let dir = tempfile::tempdir().unwrap();
        let db = fresh_db(&dir);
        let mut n = nuevo("p1", "Tornillo", "bien");
        n.unit_code = "XX";
        assert!(insert(db.conn(), &n).is_err());
        n.unit_code = "UN";
        n.sku = Some("T-1");
        insert(db.conn(), &n).unwrap();
        n.uid = "p2";
        assert!(matches!(insert(db.conn(), &n), Err(DbError::Duplicate(_))));
    }
}
