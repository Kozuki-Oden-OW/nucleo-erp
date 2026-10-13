//! Tipos de referencia propios del negocio (canales de venta, marketplaces…).

use crate::{DbError, DbResult};
use rusqlite::Connection;

/// (id, nombre) de los tipos vigentes, por nombre.
pub fn list(conn: &Connection) -> DbResult<Vec<(i64, String)>> {
    let mut stmt = conn.prepare(
        "SELECT id, label FROM reference_kinds WHERE archived_at IS NULL ORDER BY label COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn insert(conn: &Connection, label: &str, now: &str) -> DbResult<i64> {
    match conn.execute(
        "INSERT INTO reference_kinds (label, created_at) VALUES (?1, ?2)",
        (label, now),
    ) {
        Err(rusqlite::Error::SqliteFailure(e, _))
            if e.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            Err(DbError::Duplicate("tipo de referencia"))
        }
        other => {
            other?;
            Ok(conn.last_insert_rowid())
        }
    }
}

/// Archiva un tipo: deja de ofrecerse; los documentos que lo usan lo conservan.
pub fn archive(conn: &Connection, id: i64, now: &str) -> DbResult<usize> {
    Ok(conn.execute(
        "UPDATE reference_kinds SET archived_at = ?2 WHERE id = ?1 AND archived_at IS NULL",
        (id, now),
    )?)
}
