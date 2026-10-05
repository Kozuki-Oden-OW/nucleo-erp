//! Migraciones versionadas con `PRAGMA user_version`, cada una en su propia transacción.

use crate::{DbError, DbResult};
use rusqlite::Connection;

pub struct Migration {
    pub version: i64,
    pub name: &'static str,
    pub sql: &'static str,
}

pub const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        name: "nucleo_base",
        sql: include_str!("../migrations/0001_nucleo_base.sql"),
    },
    Migration {
        version: 2,
        name: "seguridad_configuracion",
        sql: include_str!("../migrations/0002_seguridad_configuracion.sql"),
    },
    Migration {
        version: 3,
        name: "maestros",
        sql: include_str!("../migrations/0003_maestros.sql"),
    },
    Migration {
        version: 4,
        name: "productos_inventario",
        sql: include_str!("../migrations/0004_productos_inventario.sql"),
    },
    Migration {
        version: 5,
        name: "ventas",
        sql: include_str!("../migrations/0005_ventas.sql"),
    },
    Migration {
        version: 6,
        name: "compras",
        sql: include_str!("../migrations/0006_compras.sql"),
    },
    Migration {
        version: 7,
        name: "dinero",
        sql: include_str!("../migrations/0007_dinero.sql"),
    },
    Migration {
        version: 8,
        name: "contabilidad_impuestos",
        sql: include_str!("../migrations/0008_contabilidad_impuestos.sql"),
    },
    Migration {
        version: 9,
        name: "comex",
        sql: include_str!("../migrations/0009_comex.sql"),
    },
    Migration {
        version: 10,
        name: "analitica",
        sql: include_str!("../migrations/0010_analitica.sql"),
    },
];

pub fn latest_version() -> i64 {
    MIGRATIONS.last().map(|m| m.version).unwrap_or(0)
}

pub fn current_version(conn: &Connection) -> DbResult<i64> {
    Ok(conn.query_row("PRAGMA user_version", [], |r| r.get(0))?)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MigrationReport {
    pub from: i64,
    pub to: i64,
}

/// Aplica las migraciones pendientes. Rechaza bases de una versión más nueva.
pub fn migrate(conn: &mut Connection) -> DbResult<MigrationReport> {
    let from = current_version(conn)?;
    let latest = latest_version();
    if from > latest {
        return Err(DbError::NewerSchema {
            db: from,
            app: latest,
        });
    }
    for m in MIGRATIONS.iter().filter(|m| m.version > from) {
        let tx = conn.transaction()?;
        tx.execute_batch(m.sql)?;
        tx.pragma_update(None, "user_version", m.version)?;
        tx.commit()?;
    }
    Ok(MigrationReport { from, to: latest })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::*;

    #[test]
    fn versiones_correlativas() {
        for (i, m) in MIGRATIONS.iter().enumerate() {
            assert_eq!(
                m.version,
                i as i64 + 1,
                "migración {} fuera de orden",
                m.name
            );
        }
    }

    #[test]
    fn aplica_y_es_idempotente() {
        let dir = tempfile::tempdir().unwrap();
        let mut db = fresh_db(&dir);
        assert_eq!(current_version(db.conn()).unwrap(), latest_version());
        let again = migrate(db.conn_mut()).unwrap();
        assert_eq!(again.from, again.to);
    }

    #[test]
    fn rechaza_esquema_mas_nuevo() {
        let dir = tempfile::tempdir().unwrap();
        let mut db = fresh_db(&dir);
        db.conn().pragma_update(None, "user_version", 999).unwrap();
        assert!(matches!(
            migrate(db.conn_mut()),
            Err(DbError::NewerSchema { db: 999, .. })
        ));
    }

    #[test]
    fn migracion_fallida_no_deja_cambios_a_medias() {
        let dir = tempfile::tempdir().unwrap();
        let db = fresh_db(&dir);
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        // Una migración rota dentro de una transacción no deja tablas creadas.
        let tx = conn.transaction().unwrap();
        let r = tx.execute_batch("CREATE TABLE a (x INTEGER); CREATE TABLE a (x INTEGER);");
        assert!(r.is_err());
        drop(tx);
        let n: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE name = 'a'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 0);
        drop(db);
    }
}
