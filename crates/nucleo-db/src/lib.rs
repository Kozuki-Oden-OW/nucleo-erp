//! # nucleo-db
//!
//! Base de datos de cada empresa: un archivo SQLite **cifrado con SQLCipher** (ADR-001,
//! ADR-004, ADR-005). Este crate abre la base con su clave, aplica migraciones, mantiene
//! la auditoría encadenada, la búsqueda FTS5 y las copias consistentes para respaldos.

pub mod audit;
pub mod customers;
pub mod maintenance;
pub mod migrations;

use rusqlite::{Connection, OpenFlags};
use std::path::{Path, PathBuf};

/// Clave de datos de una empresa (256 bits). Se borra de memoria al soltarse.
pub struct DataKey([u8; 32]);

impl DataKey {
    pub fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }
    pub fn from_hex(s: &str) -> Option<Self> {
        let v = hex::decode(s.trim()).ok()?;
        let arr: [u8; 32] = v.try_into().ok()?;
        Some(Self(arr))
    }
    /// Acceso explícito a los bytes (para envolver la clave en un respaldo cifrado).
    pub fn expose_bytes(&self) -> &[u8; 32] {
        &self.0
    }
    fn pragma(&self) -> String {
        format!("PRAGMA key = \"x'{}'\";", hex::encode(self.0))
    }
}

impl Drop for DataKey {
    fn drop(&mut self) {
        for b in self.0.iter_mut() {
            // Escritura volátil para que el compilador no elimine el borrado.
            unsafe { std::ptr::write_volatile(b, 0) };
        }
    }
}

impl std::fmt::Debug for DataKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("DataKey(****)")
    }
}

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("error de base de datos: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("error de archivo: {0}")]
    Io(#[from] std::io::Error),
    #[error("la clave no corresponde o el archivo no es una base de NÚCLEO")]
    WrongKeyOrNotEncrypted,
    #[error(
        "la base fue creada por una versión más nueva de NÚCLEO (esquema {db}, esta versión soporta hasta {app})"
    )]
    NewerSchema { db: i64, app: i64 },
    #[error("por seguridad, NÚCLEO no abre bases en carpetas de red compartidas")]
    NetworkPath,
    #[error("ya existe un registro con el mismo {0}")]
    Duplicate(&'static str),
    #[error("la verificación de integridad encontró problemas: {0:?}")]
    Integrity(Vec<String>),
}

pub type DbResult<T> = Result<T, DbError>;

/// Conexión abierta a la base de una empresa.
pub struct Db {
    conn: Connection,
    path: PathBuf,
}

/// Rutas UNC (\\servidor\carpeta) no se permiten: SQLite por red corrompe datos (riesgo T-03).
fn is_network_path(path: &Path) -> bool {
    let s = path.to_string_lossy();
    s.starts_with(r"\\") && !s.starts_with(r"\\?\") || s.starts_with("//")
}

pub(crate) fn apply_key(conn: &Connection, key: &DataKey) -> DbResult<()> {
    conn.execute_batch(&key.pragma())?;
    // Con SQLCipher, una clave errónea recién falla al leer.
    conn.query_row("SELECT count(*) FROM sqlite_master", [], |r| {
        r.get::<_, i64>(0)
    })
    .map_err(|_| DbError::WrongKeyOrNotEncrypted)?;
    Ok(())
}

impl Db {
    /// Abre (o crea) la base cifrada en `path` con `key`.
    pub fn open(path: &Path, key: &DataKey) -> DbResult<Self> {
        if is_network_path(path) {
            return Err(DbError::NetworkPath);
        }
        let conn = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_WRITE
                | OpenFlags::SQLITE_OPEN_CREATE
                | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        apply_key(&conn, key)?;
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA synchronous = NORMAL;
             PRAGMA busy_timeout = 5000;",
        )?;
        let mode: String =
            conn.pragma_update_and_check(None, "journal_mode", "WAL", |r| r.get(0))?;
        debug_assert_eq!(mode.to_lowercase(), "wal");
        Ok(Self {
            conn,
            path: path.to_path_buf(),
        })
    }

    pub fn conn(&self) -> &Connection {
        &self.conn
    }
    pub fn conn_mut(&mut self) -> &mut Connection {
        &mut self.conn
    }
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Versión de SQLCipher enlazada (vacía si la base no estuviera cifrada).
    pub fn cipher_version(&self) -> DbResult<String> {
        Ok(self
            .conn
            .query_row("PRAGMA cipher_version", [], |r| r.get(0))?)
    }

    pub fn set_meta(&self, key: &str, value: &str) -> DbResult<()> {
        self.conn.execute(
            "INSERT INTO app_meta (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )?;
        Ok(())
    }

    pub fn get_meta(&self, key: &str) -> DbResult<Option<String>> {
        use rusqlite::OptionalExtension;
        Ok(self
            .conn
            .query_row("SELECT value FROM app_meta WHERE key = ?1", [key], |r| {
                r.get(0)
            })
            .optional()?)
    }
}

/// Fecha y hora UTC en RFC 3339 para columnas `*_at` / `ts_utc`.
pub fn now_utc() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
}

#[cfg(test)]
pub(crate) mod test_util {
    use super::*;

    pub fn key(n: u8) -> DataKey {
        DataKey::from_bytes([n; 32])
    }

    pub fn fresh_db(dir: &tempfile::TempDir) -> Db {
        let mut db = Db::open(&dir.path().join("empresa.db"), &key(7)).unwrap();
        migrations::migrate(db.conn_mut()).unwrap();
        db
    }
}

#[cfg(test)]
mod tests {
    use super::test_util::*;
    use super::*;

    #[test]
    fn la_base_queda_cifrada_en_disco() {
        let dir = tempfile::tempdir().unwrap();
        let db = fresh_db(&dir);
        assert!(
            !db.cipher_version().unwrap().is_empty(),
            "SQLCipher debe estar enlazado"
        );
        db.set_meta("nombre", "Mi Negocio").unwrap();
        drop(db);
        let bytes = std::fs::read(dir.path().join("empresa.db")).unwrap();
        assert!(
            !bytes.starts_with(b"SQLite format 3"),
            "un SQLite plano empieza con ese encabezado"
        );
        let needle = b"Mi Negocio";
        assert!(
            !bytes.windows(needle.len()).any(|w| w == needle),
            "el texto no debe verse en claro"
        );
    }

    #[test]
    fn clave_incorrecta_no_abre() {
        let dir = tempfile::tempdir().unwrap();
        drop(fresh_db(&dir));
        let err = Db::open(&dir.path().join("empresa.db"), &key(8))
            .err()
            .unwrap();
        assert!(matches!(err, DbError::WrongKeyOrNotEncrypted));
    }

    #[test]
    fn rechaza_rutas_de_red() {
        assert!(is_network_path(Path::new(
            r"\\SERVIDOR\compartida\empresa.db"
        )));
        assert!(!is_network_path(Path::new(r"C:\Datos\empresa.db")));
        assert!(!is_network_path(Path::new(r"\\?\C:\Datos\empresa.db")));
    }

    #[test]
    fn metadatos() {
        let dir = tempfile::tempdir().unwrap();
        let db = fresh_db(&dir);
        db.set_meta("perfil", "emprendedor").unwrap();
        db.set_meta("perfil", "negocio").unwrap();
        assert_eq!(db.get_meta("perfil").unwrap().as_deref(), Some("negocio"));
        assert_eq!(db.get_meta("no").unwrap(), None);
    }
}
