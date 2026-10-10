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
            (SELECT count(*) FROM products p WHERE p.category_id = c.id AND p.archived_at IS NULL)
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

/// Elimina (archiva) la categoría. Sus productos quedan sin categoría.
pub fn archive(conn: &Connection, id: i64, now: &str) -> DbResult<usize> {
    let moved = conn.execute(
        "UPDATE products SET category_id = NULL, updated_at = ?2 WHERE category_id = ?1",
        (id, now),
    )?;
    conn.execute(
        "UPDATE categories SET archived_at = ?2 WHERE id = ?1",
        (id, now),
    )?;
    Ok(moved)
}

/// Asigna (o quita, con `None`) la categoría de varios productos. Devuelve cuántos cambiaron.
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
    let mut n = 0;
    for id in product_ids {
        n += stmt.execute(rusqlite::params![id, category_id, now])?;
    }
    Ok(n)
}
