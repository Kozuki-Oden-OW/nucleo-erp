//! Clientes — repositorio mínimo de la Fase 1 (el modelo completo llega en la Fase 2).

use crate::{DbError, DbResult};
use rusqlite::{Connection, Row};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CustomerRow {
    pub id: i64,
    pub uid: String,
    pub rut: Option<String>,
    pub name: String,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub created_at: String,
    #[serde(flatten)]
    pub profile: CustomerProfile,
}

/// Datos opcionales de la ficha: los que pide una factura (giro, dirección, comuna…) y de contacto.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct CustomerProfile {
    /// "persona" o "empresa".
    pub kind: String,
    /// Nombre de fantasía.
    pub trade_name: Option<String>,
    /// Giro.
    pub business_activity: Option<String>,
    pub address: Option<String>,
    pub commune: Option<String>,
    pub city: Option<String>,
    pub region: Option<String>,
    pub contact_name: Option<String>,
    /// Correo para recibir facturas.
    pub invoice_email: Option<String>,
    /// Días de crédito habituales (0 = contado).
    pub payment_terms_days: i64,
    pub credit_limit_minor: Option<i64>,
    pub notes: Option<String>,
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

const COLS: &str = "id, uid, rut, name, email, phone, created_at, kind, trade_name, business_activity, \
    address, commune, city, region, contact_name, invoice_email, payment_terms_days, credit_limit_minor, notes";

fn map(r: &Row<'_>) -> rusqlite::Result<CustomerRow> {
    Ok(CustomerRow {
        id: r.get(0)?,
        uid: r.get(1)?,
        rut: r.get(2)?,
        name: r.get(3)?,
        email: r.get(4)?,
        phone: r.get(5)?,
        created_at: r.get(6)?,
        profile: CustomerProfile {
            kind: r.get(7)?,
            trade_name: r.get(8)?,
            business_activity: r.get(9)?,
            address: r.get(10)?,
            commune: r.get(11)?,
            city: r.get(12)?,
            region: r.get(13)?,
            contact_name: r.get(14)?,
            invoice_email: r.get(15)?,
            payment_terms_days: r.get(16)?,
            credit_limit_minor: r.get(17)?,
            notes: r.get(18)?,
        },
    })
}

/// Guarda los datos opcionales de la ficha (los textos ya vienen validados y sin espacios sobrantes).
pub fn set_profile(conn: &Connection, id: i64, p: &CustomerProfile) -> DbResult<()> {
    conn.execute(
        "UPDATE customers SET kind = ?2, trade_name = ?3, business_activity = ?4, address = ?5, commune = ?6,
            city = ?7, region = ?8, contact_name = ?9, invoice_email = ?10, payment_terms_days = ?11,
            credit_limit_minor = ?12, notes = ?13 WHERE id = ?1",
        rusqlite::params![
            id,
            if p.kind == "empresa" { "empresa" } else { "persona" },
            p.trade_name,
            p.business_activity,
            p.address,
            p.commune,
            p.city,
            p.region,
            p.contact_name,
            p.invoice_email,
            p.payment_terms_days,
            p.credit_limit_minor,
            p.notes
        ],
    )?;
    Ok(())
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

/// Cambia los datos de contacto del cliente.
pub fn update(
    conn: &Connection,
    id: i64,
    name: &str,
    rut: Option<&str>,
    email: Option<&str>,
    phone: Option<&str>,
) -> DbResult<()> {
    let res = conn.execute(
        "UPDATE customers SET name = ?2, rut = ?3, email = ?4, phone = ?5 WHERE id = ?1",
        (id, name.trim(), rut, email, phone),
    );
    match res {
        Err(rusqlite::Error::SqliteFailure(e, Some(msg)))
            if e.code == rusqlite::ErrorCode::ConstraintViolation
                && msg.contains("customers.rut") =>
        {
            Err(DbError::Duplicate("RUT"))
        }
        other => {
            other?;
            Ok(())
        }
    }
}

pub fn by_uid(conn: &Connection, uid: &str) -> DbResult<Option<CustomerRow>> {
    use rusqlite::OptionalExtension;
    Ok(conn
        .query_row(
            &format!("SELECT {COLS} FROM customers WHERE uid = ?1"),
            [uid],
            map,
        )
        .optional()?)
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
