//! Categorías de productos: lista con cantidad de productos, crear, renombrar, eliminar
//! (archivar) y asignar productos en lote.

use crate::{DbError, DbResult};
use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CategoryRow {
    #[serde(skip)]
    pub id: i64,
    pub uid: String,
    pub name: String,
    /// Productos y servicios activos en la categoría.
    pub product_count: i64,
}

/// Categorías activas, por nombre.
pub fn list(conn: &Connection) -> DbResult<Vec<CategoryRow>> {
    let mut stmt = conn.prepare(
        "SELECT c.id, c.uid, c.name,
            (SELECT count(*) FROM products p WHERE p.archived_at IS NULL AND (p.category_id = c.id
                OR EXISTS (SELECT 1 FROM product_extra_categories x WHERE x.product_id = p.id AND x.category_id = c.id)))
         FROM categories c WHERE c.archived_at IS NULL
         ORDER BY c.name COLLATE NOCASE",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(CategoryRow {
                id: r.get(0)?,
                uid: r.get(1)?,
                name: r.get(2)?,
                product_count: r.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Id de una categoría activa.
pub fn id_by_uid(conn: &Connection, uid: &str) -> DbResult<Option<i64>> {
    Ok(conn
        .query_row(
            "SELECT id FROM categories WHERE uid = ?1 AND archived_at IS NULL",
            [uid],
            |r| r.get(0),
        )
        .optional()?)
}

fn name_taken(conn: &Connection, name: &str, except: Option<i64>) -> DbResult<bool> {
    let n: i64 = conn.query_row(
        "SELECT count(*) FROM categories
         WHERE archived_at IS NULL AND parent_id IS NULL AND name = ?1 COLLATE NOCASE
           AND (?2 IS NULL OR id <> ?2)",
        rusqlite::params![name, except],
        |r| r.get(0),
    )?;
    Ok(n > 0)
}

pub fn insert(conn: &Connection, uid: &str, name: &str, now: &str) -> DbResult<i64> {
    if name_taken(conn, name, None)? {
        return Err(DbError::Duplicate("nombre de categoría"));
    }
    conn.execute(
        "INSERT INTO categories (uid, name, created_at) VALUES (?1, ?2, ?3)",
        (uid, name, now),
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn rename(conn: &Connection, id: i64, name: &str) -> DbResult<()> {
    if name_taken(conn, name, Some(id))? {
        return Err(DbError::Duplicate("nombre de categoría"));
    }
    conn.execute("UPDATE categories SET name = ?2 WHERE id = ?1", (id, name))?;
    Ok(())
}

/// Elimina (archiva) la categoría. Si era la principal de un producto, pasa a principal otra de
/// sus categorías; si no tiene otra, queda sin categoría.
pub fn archive(conn: &Connection, id: i64, now: &str) -> DbResult<usize> {
    conn.execute(
        "DELETE FROM product_extra_categories WHERE category_id = ?1",
        [id],
    )?;
    let moved = conn.execute(
        "UPDATE products SET updated_at = ?2, category_id = (
            SELECT x.category_id FROM product_extra_categories x JOIN categories k ON k.id = x.category_id
            WHERE x.product_id = products.id AND k.archived_at IS NULL ORDER BY k.name COLLATE NOCASE LIMIT 1)
         WHERE category_id = ?1",
        (id, now),
    )?;
    conn.execute(
        "DELETE FROM product_extra_categories WHERE (product_id, category_id) IN (SELECT id, category_id FROM products WHERE category_id IS NOT NULL)",
        [],
    )?;
    conn.execute(
        "UPDATE categories SET archived_at = ?2 WHERE id = ?1",
        (id, now),
    )?;
    Ok(moved)
}

/// Agrega una categoría a varios productos: si no tienen categoría, queda como principal; si ya
/// tienen otra, se suma a sus otras categorías. Devuelve cuántos cambiaron.
pub fn add_to(
    conn: &Connection,
    product_ids: &[i64],
    category_id: i64,
    now: &str,
) -> DbResult<usize> {
    let mut main = conn.prepare(
        "UPDATE products SET category_id = ?2, updated_at = ?3 WHERE id = ?1 AND category_id IS NULL",
    )?;
    let mut extra = conn.prepare(
        "INSERT OR IGNORE INTO product_extra_categories (product_id, category_id)
         SELECT id, ?2 FROM products WHERE id = ?1 AND category_id IS NOT ?2",
    )?;
    let mut n = 0;
    for id in product_ids {
        let changed = main.execute(rusqlite::params![id, category_id, now])?
            + extra.execute(rusqlite::params![id, category_id])?;
        n += changed.min(1);
    }
    Ok(n)
}

/// Quita una categoría de un producto (principal u otra). Si era la principal, pasa a principal
/// otra de sus categorías.
pub fn remove_from(
    conn: &Connection,
    product_id: i64,
    category_id: i64,
    now: &str,
) -> DbResult<()> {
    conn.execute(
        "DELETE FROM product_extra_categories WHERE product_id = ?1 AND category_id = ?2",
        (product_id, category_id),
    )?;
    let promoted: Option<i64> = conn
        .query_row(
            "SELECT x.category_id FROM product_extra_categories x JOIN categories k ON k.id = x.category_id
             WHERE x.product_id = ?1 AND k.archived_at IS NULL ORDER BY k.name COLLATE NOCASE LIMIT 1",
            [product_id],
            |r| r.get(0),
        )
        .optional()?;
    let n = conn.execute(
        "UPDATE products SET category_id = ?3, updated_at = ?4 WHERE id = ?1 AND category_id = ?2",
        rusqlite::params![product_id, category_id, promoted, now],
    )?;
    if let Some(p) = promoted.filter(|_| n > 0) {
        conn.execute(
            "DELETE FROM product_extra_categories WHERE product_id = ?1 AND category_id = ?2",
            (product_id, p),
        )?;
    }
    Ok(())
}

/// Asigna (o quita, con `None`) la categoría principal de varios productos. Devuelve cuántos cambiaron.
pub fn assign(
    conn: &Connection,
    product_ids: &[i64],
    category_id: Option<i64>,
    now: &str,
) -> DbResult<usize> {
    let mut stmt = conn.prepare(
        "UPDATE products SET category_id = ?2, updated_at = ?3
         WHERE id = ?1 AND category_id IS NOT ?2",
    )?;
    let mut drop_extra = conn.prepare(
        "DELETE FROM product_extra_categories WHERE product_id = ?1 AND category_id IS ?2",
    )?;
    let mut n = 0;
    for id in product_ids {
        n += stmt.execute(rusqlite::params![id, category_id, now])?;
        drop_extra.execute(rusqlite::params![id, category_id])?;
    }
    Ok(n)
}
