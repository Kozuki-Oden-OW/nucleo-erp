//! Proveedores (Fase 6): ficha, búsqueda sin tildes y resumen de compras.

use crate::customers::fts_query;
use crate::{DbError, DbResult};
use rusqlite::{Connection, OptionalExtension, Row};
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SupplierRow {
    pub id: i64,
    pub uid: String,
    pub rut: Option<String>,
    pub name: String,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub payment_terms_days: i64,
    pub created_at: String,
}

const COLS: &str =
    "s.id, s.uid, s.rut, s.name, s.email, s.phone, s.payment_terms_days, s.created_at";

fn map(r: &Row<'_>) -> rusqlite::Result<SupplierRow> {
    Ok(SupplierRow {
        id: r.get(0)?,
        uid: r.get(1)?,
        rut: r.get(2)?,
        name: r.get(3)?,
        email: r.get(4)?,
        phone: r.get(5)?,
        payment_terms_days: r.get(6)?,
        created_at: r.get(7)?,
    })
}

pub struct SupplierWrite<'a> {
    pub name: &'a str,
    pub rut: Option<&'a str>,
    pub email: Option<&'a str>,
    pub phone: Option<&'a str>,
    pub payment_terms_days: i64,
}

fn dup(res: rusqlite::Result<usize>) -> DbResult<()> {
    match res {
        Err(rusqlite::Error::SqliteFailure(e, Some(msg)))
            if e.code == rusqlite::ErrorCode::ConstraintViolation
                && msg.contains("suppliers.rut") =>
        {
            Err(DbError::Duplicate("RUT"))
        }
        other => {
            other?;
            Ok(())
        }
    }
}

pub fn insert(
    conn: &Connection,
    uid: &str,
    w: &SupplierWrite<'_>,
    now: &str,
) -> DbResult<SupplierRow> {
    dup(conn.execute(
        "INSERT INTO suppliers (uid, rut, name, email, phone, payment_terms_days, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        (
            uid,
            w.rut,
            w.name.trim(),
            w.email,
            w.phone,
            w.payment_terms_days,
            now,
        ),
    ))?;
    by_uid(conn, uid)?.ok_or(DbError::Rule("proveedor no encontrado".into()))
}

pub fn update(conn: &Connection, id: i64, w: &SupplierWrite<'_>, now: &str) -> DbResult<()> {
    dup(conn.execute(
        "UPDATE suppliers SET rut = ?2, name = ?3, email = ?4, phone = ?5, payment_terms_days = ?6, updated_at = ?7
         WHERE id = ?1",
        (id, w.rut, w.name.trim(), w.email, w.phone, w.payment_terms_days, now),
    ))
}

pub fn by_uid(conn: &Connection, uid: &str) -> DbResult<Option<SupplierRow>> {
    Ok(conn
        .query_row(
            &format!("SELECT {COLS} FROM suppliers s WHERE s.uid = ?1"),
            [uid],
            map,
        )
        .optional()?)
}

pub fn search(conn: &Connection, input: &str, limit: u32) -> DbResult<Vec<SupplierRow>> {
    let mut out = Vec::new();
    match fts_query(input) {
        Some(q) => {
            let mut stmt = conn.prepare(&format!(
                "SELECT {COLS} FROM suppliers s JOIN suppliers_fts f ON f.rowid = s.id
                 WHERE suppliers_fts MATCH ?1 AND s.archived_at IS NULL ORDER BY bm25(suppliers_fts) LIMIT ?2"
            ))?;
            for r in stmt.query_map((q, limit), map)? {
                out.push(r?);
            }
        }
        None => {
            let mut stmt = conn.prepare(&format!(
                "SELECT {COLS} FROM suppliers s WHERE s.archived_at IS NULL ORDER BY s.name COLLATE NOCASE LIMIT ?1"
            ))?;
            for r in stmt.query_map([limit], map)? {
                out.push(r?);
            }
        }
    }
    Ok(out)
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SupplierStats {
    pub purchases_count: i64,
    pub purchased_minor: i64,
    pub payable_minor: i64,
    pub last_purchase_date: Option<String>,
}

pub fn stats(conn: &Connection, supplier_id: i64) -> DbResult<SupplierStats> {
    Ok(conn.query_row(
        "SELECT count(*), coalesce(sum(total_minor), 0), coalesce(sum(total_minor - paid_minor), 0), max(issue_date)
         FROM purchases WHERE supplier_id = ?1 AND status = 'registrada'",
        [supplier_id],
        |r| {
            Ok(SupplierStats {
                purchases_count: r.get(0)?,
                purchased_minor: r.get(1)?,
                payable_minor: r.get(2)?,
                last_purchase_date: r.get(3)?,
            })
        },
    )?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::*;

    #[test]
    fn crea_busca_y_no_duplica_rut() {
        let dir = tempfile::tempdir().unwrap();
        let db = fresh_db(&dir);
        let w = SupplierWrite {
            name: "Distribuidora Eléctrica Sur",
            rut: Some("76543210-3"),
            email: None,
            phone: None,
            payment_terms_days: 30,
        };
        let s = insert(db.conn(), "s1", &w, "2026-10-06T12:00:00Z").unwrap();
        assert_eq!(s.payment_terms_days, 30);
        assert_eq!(search(db.conn(), "electrica", 5).unwrap().len(), 1);
        assert!(matches!(
            insert(db.conn(), "s2", &w, "2026-10-06T12:00:00Z"),
            Err(DbError::Duplicate(_))
        ));
        assert_eq!(stats(db.conn(), s.id).unwrap().purchases_count, 0);
    }
}
