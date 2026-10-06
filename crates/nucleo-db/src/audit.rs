//! Auditoría encadenada (ADR-012, Blueprint §10.3).
//!
//! Cada registro guarda el hash SHA-256 del anterior. Si alguien modifica la base por
//! fuera de NÚCLEO, `verify_chain` detecta exactamente dónde se rompió la cadena.

use crate::{DbResult, now_utc};
use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;
use sha2::{Digest, Sha256};

pub const GENESIS_HASH: &str = "0000000000000000000000000000000000000000000000000000000000000000";

#[derive(Debug, Clone, Default)]
pub struct AuditEntry<'a> {
    pub user_name: &'a str,
    pub action: &'a str,
    pub entity: &'a str,
    pub entity_id: Option<&'a str>,
    pub before_json: Option<String>,
    pub after_json: Option<String>,
    pub reason: Option<&'a str>,
}

#[allow(clippy::too_many_arguments)]
fn compute_hash(
    prev: &str,
    ts: &str,
    user: &str,
    action: &str,
    entity: &str,
    entity_id: Option<&str>,
    before: Option<&str>,
    after: Option<&str>,
    reason: Option<&str>,
) -> String {
    // JSON como forma canónica: evita ambigüedades de separadores.
    let canonical = serde_json::json!([
        prev, ts, user, action, entity, entity_id, before, after, reason
    ])
    .to_string();
    hex::encode(Sha256::digest(canonical.as_bytes()))
}

/// Agrega un registro. Debe llamarse dentro de la misma transacción que el cambio auditado.
pub fn append(conn: &Connection, e: &AuditEntry<'_>) -> DbResult<i64> {
    let prev: String = conn
        .query_row(
            "SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1",
            [],
            |r| r.get(0),
        )
        .optional()?
        .unwrap_or_else(|| GENESIS_HASH.to_string());
    let ts = now_utc();
    let hash = compute_hash(
        &prev,
        &ts,
        e.user_name,
        e.action,
        e.entity,
        e.entity_id,
        e.before_json.as_deref(),
        e.after_json.as_deref(),
        e.reason,
    );
    conn.execute(
        "INSERT INTO audit_log (ts_utc, user_name, action, entity, entity_id, before_json, after_json, reason, prev_hash, hash)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        rusqlite::params![ts, e.user_name, e.action, e.entity, e.entity_id, e.before_json, e.after_json, e.reason, prev, hash],
    )?;
    Ok(conn.last_insert_rowid())
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ChainReport {
    pub entries: i64,
    pub ok: bool,
    /// Primer registro donde la cadena no cuadra.
    pub broken_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AuditRow {
    pub id: i64,
    pub ts_utc: String,
    pub user_name: String,
    pub action: String,
    pub entity: String,
    pub entity_id: Option<String>,
    pub before_json: Option<String>,
    pub after_json: Option<String>,
    pub reason: Option<String>,
}

/// Registros más recientes primero, con filtro de texto opcional (usuario, acción o entidad)
/// y paginación por cursor (`before_id`).
pub fn recent(
    conn: &Connection,
    query: &str,
    before_id: Option<i64>,
    limit: u32,
) -> DbResult<Vec<AuditRow>> {
    let like = format!("%{}%", query.trim());
    let mut stmt = conn.prepare(
        "SELECT id, ts_utc, user_name, action, entity, entity_id, before_json, after_json, reason FROM audit_log
         WHERE id < ?1 AND (user_name LIKE ?2 OR action LIKE ?2 OR entity LIKE ?2 OR ifnull(entity_id, '') LIKE ?2)
         ORDER BY id DESC LIMIT ?3",
    )?;
    let rows = stmt.query_map(
        rusqlite::params![before_id.unwrap_or(i64::MAX), like, limit],
        |r| {
            Ok(AuditRow {
                id: r.get(0)?,
                ts_utc: r.get(1)?,
                user_name: r.get(2)?,
                action: r.get(3)?,
                entity: r.get(4)?,
                entity_id: r.get(5)?,
                before_json: r.get(6)?,
                after_json: r.get(7)?,
                reason: r.get(8)?,
            })
        },
    )?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn verify_chain(conn: &Connection) -> DbResult<ChainReport> {
    let mut stmt = conn.prepare(
        "SELECT id, ts_utc, user_name, action, entity, entity_id, before_json, after_json, reason, prev_hash, hash
         FROM audit_log ORDER BY id",
    )?;
    let mut rows = stmt.query([])?;
    let mut expected_prev = GENESIS_HASH.to_string();
    let mut entries = 0;
    while let Some(r) = rows.next()? {
        entries += 1;
        let id: i64 = r.get(0)?;
        let prev: String = r.get(9)?;
        let stored: String = r.get(10)?;
        let recomputed = compute_hash(
            &prev,
            &r.get::<_, String>(1)?,
            &r.get::<_, String>(2)?,
            &r.get::<_, String>(3)?,
            &r.get::<_, String>(4)?,
            r.get::<_, Option<String>>(5)?.as_deref(),
            r.get::<_, Option<String>>(6)?.as_deref(),
            r.get::<_, Option<String>>(7)?.as_deref(),
            r.get::<_, Option<String>>(8)?.as_deref(),
        );
        if prev != expected_prev || recomputed != stored {
            return Ok(ChainReport {
                entries,
                ok: false,
                broken_at: Some(id),
            });
        }
        expected_prev = stored;
    }
    Ok(ChainReport {
        entries,
        ok: true,
        broken_at: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::*;

    fn entry(action: &str) -> AuditEntry<'_> {
        AuditEntry {
            user_name: "admin",
            action,
            entity: "cliente",
            entity_id: Some("1"),
            ..Default::default()
        }
    }

    #[test]
    fn cadena_valida() {
        let dir = tempfile::tempdir().unwrap();
        let db = fresh_db(&dir);
        for a in ["crear", "editar", "archivar"] {
            append(db.conn(), &entry(a)).unwrap();
        }
        let r = verify_chain(db.conn()).unwrap();
        assert_eq!(
            r,
            ChainReport {
                entries: 3,
                ok: true,
                broken_at: None
            }
        );
    }

    #[test]
    fn la_app_no_puede_modificar_ni_borrar() {
        let dir = tempfile::tempdir().unwrap();
        let db = fresh_db(&dir);
        append(db.conn(), &entry("crear")).unwrap();
        assert!(
            db.conn()
                .execute("UPDATE audit_log SET action = 'x'", [])
                .is_err()
        );
        assert!(db.conn().execute("DELETE FROM audit_log", []).is_err());
    }

    #[test]
    fn detecta_manipulacion_externa() {
        let dir = tempfile::tempdir().unwrap();
        let db = fresh_db(&dir);
        for a in ["crear", "editar", "archivar"] {
            append(db.conn(), &entry(a)).unwrap();
        }
        // Simula a alguien que borra los triggers y edita la base a mano.
        db.conn()
            .execute_batch("DROP TRIGGER audit_log_no_update; UPDATE audit_log SET action = 'otra' WHERE id = 2;")
            .unwrap();
        let r = verify_chain(db.conn()).unwrap();
        assert!(!r.ok);
        assert_eq!(r.broken_at, Some(2));
    }
}
