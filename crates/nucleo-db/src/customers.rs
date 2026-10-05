//! Clientes — repositorio mínimo de la Fase 1 (el modelo completo llega en la Fase 2).

use crate::{DbError, DbResult};
use rusqlite::{Connection, Row};
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CustomerRow {
    pub id: i64,
    pub uid: String,
    pub rut: Option<String>,
    pub name: String,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct NewCustomerRow<'a> {
    pub uid: &'a str,
    pub rut: Option<&'a str>,
    pub name: &'a str,
    pub email: Option<&'a str>,
    pub phone: Option<&'a str>,
    pub created_at: &'a str,
}

const COLS: &str = "id, uid, rut, name, email, phone, created_at";

fn map(r: &Row<'_>) -> rusqlite::Result<CustomerRow> {
    Ok(CustomerRow {
        id: r.get(0)?,
        uid: r.get(1)?,
        rut: r.get(2)?,
        name: r.get(3)?,
        email: r.get(4)?,
        phone: r.get(5)?,
        created_at: r.get(6)?,
    })
}

pub fn insert(conn: &Connection, c: &NewCustomerRow<'_>) -> DbResult<CustomerRow> {
    let res = conn.execute(
        "INSERT INTO customers (uid, rut, name, email, phone, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        (c.uid, c.rut, c.name.trim(), c.email, c.phone, c.created_at),
    );
    match res {
        Err(rusqlite::Error::SqliteFailure(e, Some(msg)))
            if e.code == rusqlite::ErrorCode::ConstraintViolation
                && msg.contains("customers.rut") =>
        {
            return Err(DbError::Duplicate("RUT"));
        }
        other => {
            other?;
        }
    }
    let id = conn.last_insert_rowid();
    Ok(conn.query_row(
        &format!("SELECT {COLS} FROM customers WHERE id = ?1"),
        [id],
        map,
    )?)
}

/// Convierte el texto del usuario en una consulta FTS5 segura con búsqueda por prefijo.
/// "juan pér" → `"juan"* "pér"*`
pub fn fts_query(input: &str) -> Option<String> {
    let terms: Vec<String> = input
        .split_whitespace()
        .map(|t| t.replace('"', ""))
        .filter(|t| !t.is_empty())
        .map(|t| format!("\"{t}\"*"))
        .collect();
    if terms.is_empty() {
        None
    } else {
        Some(terms.join(" "))
    }
}

pub fn search(conn: &Connection, input: &str, limit: u32) -> DbResult<Vec<CustomerRow>> {
    let Some(q) = fts_query(input) else {
        return list(conn, limit, None);
    };
    let mut stmt = conn.prepare(&format!(
        "SELECT {} FROM customers c JOIN customers_fts f ON f.rowid = c.id
         WHERE customers_fts MATCH ?1 AND c.archived_at IS NULL
         ORDER BY bm25(customers_fts) LIMIT ?2",
        COLS.split(", ")
            .map(|c| format!("c.{c}"))
            .collect::<Vec<_>>()
            .join(", ")
    ))?;
    let rows = stmt.query_map((q, limit), map)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Lista paginada por cursor (keyset): rápida aunque haya cientos de miles de filas.
pub fn list(conn: &Connection, limit: u32, after_id: Option<i64>) -> DbResult<Vec<CustomerRow>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLS} FROM customers WHERE archived_at IS NULL AND id > ?1 ORDER BY id LIMIT ?2"
    ))?;
    let rows = stmt.query_map((after_id.unwrap_or(0), limit), map)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn count(conn: &Connection) -> DbResult<i64> {
    Ok(conn.query_row(
        "SELECT count(*) FROM customers WHERE archived_at IS NULL",
        [],
        |r| r.get(0),
    )?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::*;

    fn nuevo<'a>(uid: &'a str, name: &'a str, rut: Option<&'a str>) -> NewCustomerRow<'a> {
        NewCustomerRow {
            uid,
            rut,
            name,
            email: None,
            phone: None,
            created_at: "2026-10-05T12:00:00Z",
        }
    }

    #[test]
    fn inserta_y_busca_con_tildes_y_prefijos() {
        let dir = tempfile::tempdir().unwrap();
        let db = fresh_db(&dir);
        insert(db.conn(), &nuevo("u1", "Juan Pérez", Some("12345678-5"))).unwrap();
        insert(db.conn(), &nuevo("u2", "Ferretería Los Andes", None)).unwrap();
        assert_eq!(search(db.conn(), "juan", 10).unwrap().len(), 1);
        assert_eq!(
            search(db.conn(), "perez", 10).unwrap()[0].name,
            "Juan Pérez"
        ); // sin tilde
        assert_eq!(search(db.conn(), "ferre and", 10).unwrap().len(), 1); // prefijos
        assert_eq!(search(db.conn(), "12345678", 10).unwrap().len(), 1); // por RUT
        assert_eq!(count(db.conn()).unwrap(), 2);
    }

    #[test]
    fn rut_duplicado() {
        let dir = tempfile::tempdir().unwrap();
        let db = fresh_db(&dir);
        insert(db.conn(), &nuevo("u1", "A", Some("12345678-5"))).unwrap();
        let err = insert(db.conn(), &nuevo("u2", "B", Some("12345678-5")))
            .err()
            .unwrap();
        assert!(matches!(err, DbError::Duplicate("RUT")));
    }

    #[test]
    fn nombre_vacio_rechazado_por_la_base() {
        let dir = tempfile::tempdir().unwrap();
        let db = fresh_db(&dir);
        assert!(insert(db.conn(), &nuevo("u1", "   ", None)).is_err());
    }

    #[test]
    fn consulta_fts_segura() {
        assert_eq!(
            fts_query("juan \"; DROP"),
            Some("\"juan\"* \";\"* \"DROP\"*".into())
        );
        assert_eq!(fts_query("   "), None);
    }

    #[test]
    fn paginacion_por_cursor() {
        let dir = tempfile::tempdir().unwrap();
        let db = fresh_db(&dir);
        for i in 0..25 {
            insert(
                db.conn(),
                &nuevo(&format!("u{i}"), &format!("Cliente {i}"), None),
            )
            .unwrap();
        }
        let p1 = list(db.conn(), 10, None).unwrap();
        let p2 = list(db.conn(), 10, Some(p1.last().unwrap().id)).unwrap();
        assert_eq!(p1.len(), 10);
        assert_eq!(p2[0].id, p1.last().unwrap().id + 1);
    }
}
