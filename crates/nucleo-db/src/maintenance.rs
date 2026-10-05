//! Integridad, conteos y copias consistentes (base de los respaldos, Blueprint §9).

use crate::{DataKey, Db, DbError, DbResult, apply_key};
use rusqlite::Connection;
use rusqlite::backup::Backup;
use std::collections::BTreeMap;
use std::path::Path;
use std::time::Duration;

/// `PRAGMA integrity_check` + `PRAGMA foreign_key_check`. Vacío = todo bien.
pub fn check(conn: &Connection) -> DbResult<Vec<String>> {
    let mut problems = Vec::new();
    let mut stmt = conn.prepare("PRAGMA integrity_check")?;
    for row in stmt.query_map([], |r| r.get::<_, String>(0))? {
        let msg = row?;
        if msg != "ok" {
            problems.push(msg);
        }
    }
    let mut stmt = conn.prepare("PRAGMA foreign_key_check")?;
    for row in stmt.query_map([], |r| {
        Ok(format!("clave foránea rota en {}", r.get::<_, String>(0)?))
    })? {
        problems.push(row?);
    }
    Ok(problems)
}

pub fn ensure_ok(conn: &Connection) -> DbResult<()> {
    let p = check(conn)?;
    if p.is_empty() {
        Ok(())
    } else {
        Err(DbError::Integrity(p))
    }
}

/// Conteo de filas de las tablas de negocio (para el manifiesto del respaldo).
pub fn table_counts(conn: &Connection) -> DbResult<BTreeMap<String, i64>> {
    let mut stmt = conn.prepare(
        "SELECT name FROM sqlite_master
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%'
         ORDER BY name",
    )?;
    let names: Vec<String> = stmt
        .query_map([], |r| r.get(0))?
        .collect::<Result<_, _>>()?;
    let mut out = BTreeMap::new();
    for n in names {
        let c: i64 = conn.query_row(&format!("SELECT count(*) FROM \"{n}\""), [], |r| r.get(0))?;
        out.insert(n, c);
    }
    Ok(out)
}

/// Copia consistente y cifrada de la base **sin cerrar la aplicación** (API de backup de SQLite).
pub fn snapshot_to(db: &Db, dest: &Path, key: &DataKey) -> DbResult<()> {
    if dest.exists() {
        std::fs::remove_file(dest)?;
    }
    let mut out = Connection::open(dest)?;
    out.execute_batch(&format!(
        "PRAGMA key = \"x'{}'\";",
        hex::encode(key.expose_bytes())
    ))?;
    {
        let backup = Backup::new(db.conn(), &mut out)?;
        backup.run_to_completion(1000, Duration::ZERO, None)?;
    }
    apply_key(&out, key)?;
    ensure_ok(&out)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::customers::{NewCustomerRow, insert};
    use crate::test_util::*;

    #[test]
    fn snapshot_cifrado_e_identico() {
        let dir = tempfile::tempdir().unwrap();
        let db = fresh_db(&dir);
        insert(
            db.conn(),
            &NewCustomerRow {
                uid: "u1",
                rut: None,
                name: "Ana",
                email: None,
                phone: None,
                created_at: "t",
            },
        )
        .unwrap();
        let dest = dir.path().join("copia.db");
        snapshot_to(&db, &dest, &key(7)).unwrap();
        let bytes = std::fs::read(&dest).unwrap();
        assert!(!bytes.starts_with(b"SQLite format 3"));
        let copy = Db::open(&dest, &key(7)).unwrap();
        assert_eq!(
            table_counts(copy.conn()).unwrap(),
            table_counts(db.conn()).unwrap()
        );
        assert!(check(copy.conn()).unwrap().is_empty());
    }
}
