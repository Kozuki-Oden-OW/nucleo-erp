//! Registro de empresas del computador (`app.db`, sin datos de negocio) y operaciones
//! que crean, abren o restauran empresas (multiempresa, ADR-005).

use crate::company::CompanySession;
use crate::keys::{self, KeyStore};
use crate::{AppError, AppResult};
use nucleo_db::{DataKey, Db, audit, maintenance, migrations, now_utc};
use nucleo_io::erpbackup;
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Perfil de operación (Blueprint §1.3). Solo decide qué módulos se muestran.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BusinessProfile {
    Emprendedor,
    Negocio,
    Empresa,
}

impl BusinessProfile {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Emprendedor => "emprendedor",
            Self::Negocio => "negocio",
            Self::Empresa => "empresa",
        }
    }
    pub fn parse(s: &str) -> AppResult<Self> {
        match s {
            "emprendedor" => Ok(Self::Emprendedor),
            "negocio" => Ok(Self::Negocio),
            "empresa" => Ok(Self::Empresa),
            _ => Err(AppError::Validation(format!("perfil desconocido: {s}"))),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CompanyInfo {
    pub uid: String,
    pub name: String,
    pub profile: BusinessProfile,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct CreatedCompany {
    pub company: CompanyInfo,
    /// Mostrar UNA vez al usuario para que la guarde o imprima.
    pub recovery_key: String,
}

pub struct AppService {
    data_dir: PathBuf,
    registry: Connection,
    keys: Box<dyn KeyStore>,
}

const REGISTRY_SQL: &str = "
CREATE TABLE IF NOT EXISTS companies (
    uid         TEXT PRIMARY KEY NOT NULL,
    name        TEXT NOT NULL CHECK (length(trim(name)) > 0),
    profile     TEXT NOT NULL CHECK (profile IN ('emprendedor','negocio','empresa')),
    dir         TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    archived_at TEXT
) STRICT;";

pub(crate) fn validate_name(name: &str) -> AppResult<String> {
    let n = name.trim();
    if n.is_empty() {
        return Err(AppError::Validation("el nombre es obligatorio".into()));
    }
    if n.chars().count() > 200 {
        return Err(AppError::Validation(
            "el nombre no puede superar 200 caracteres".into(),
        ));
    }
    Ok(n.to_string())
}

impl AppService {
    /// Abre (o crea) el directorio de datos. `data_dir` en Windows: %LOCALAPPDATA%\NucleoERP.
    pub fn open(data_dir: &Path, keys: Box<dyn KeyStore>) -> AppResult<Self> {
        std::fs::create_dir_all(data_dir.join("companies"))?;
        let registry = Connection::open(data_dir.join("app.db"))?;
        registry.execute_batch(REGISTRY_SQL)?;
        Ok(Self {
            data_dir: data_dir.to_path_buf(),
            registry,
            keys,
        })
    }

    pub fn data_dir(&self) -> &Path {
        &self.data_dir
    }

    /// Actualiza nombre y perfil en el registro del computador (la base de la empresa ya se
    /// actualizó en la misma operación de `CompanySession::update_business`).
    pub fn update_company(&self, uid: &str, name: &str, profile: BusinessProfile) -> AppResult<()> {
        self.registry.execute(
            "UPDATE companies SET name = ?2, profile = ?3 WHERE uid = ?1",
            (uid, name, profile.as_str()),
        )?;
        Ok(())
    }

    pub fn list_companies(&self) -> AppResult<Vec<CompanyInfo>> {
        let mut stmt = self.registry.prepare(
            "SELECT uid, name, profile, created_at FROM companies WHERE archived_at IS NULL ORDER BY created_at",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
            ))
        })?;
        let mut out = Vec::new();
        for row in rows {
            let (uid, name, profile, created_at) = row?;
            out.push(CompanyInfo {
                uid,
                name,
                profile: BusinessProfile::parse(&profile)?,
                created_at,
            });
        }
        Ok(out)
    }

    fn company_dir(&self, uid: &str) -> AppResult<PathBuf> {
        let dir: Option<String> = self
            .registry
            .query_row(
                "SELECT dir FROM companies WHERE uid = ?1 AND archived_at IS NULL",
                [uid],
                |r| r.get(0),
            )
            .optional()?;
        dir.map(PathBuf::from)
            .ok_or_else(|| AppError::NotFound("la empresa".into()))
    }

    fn register(&self, info: &CompanyInfo, dir: &Path) -> AppResult<()> {
        self.registry.execute(
            "INSERT INTO companies (uid, name, profile, dir, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            (&info.uid, &info.name, info.profile.as_str(), dir.to_string_lossy(), &info.created_at),
        )?;
        Ok(())
    }

    /// Crea un negocio nuevo: carpeta propia, base cifrada, clave en el almacén seguro.
    ///
    /// Es "todo o nada": si cualquier paso falla, no quedan carpetas, claves ni registros
    /// a medio crear.
    pub fn create_company(
        &mut self,
        name: &str,
        profile: BusinessProfile,
    ) -> AppResult<CreatedCompany> {
        // Quien crea el negocio es su dueño (usuario inicial de la migración 0011).
        let user = "dueno";
        let name = validate_name(name)?;
        let uid = uuid::Uuid::now_v7().to_string();
        let key = keys::generate_key()?;
        // Primero la clave: si el almacén seguro no responde, no se crea nada.
        self.keys.put(&uid, &key)?;
        let dir = self.data_dir.join("companies").join(&uid);
        let created_at = now_utc();
        let result = (|| -> AppResult<CompanyInfo> {
            std::fs::create_dir_all(dir.join("documents"))?;
            let mut db = Db::open(&dir.join("company.db"), &key)?;
            migrations::migrate(db.conn_mut())?;
            let tx = db.conn_mut().transaction()?;
            for (k, v) in [
                ("company_uid", uid.as_str()),
                ("company_name", &name),
                ("profile", profile.as_str()),
                ("created_at", &created_at),
            ] {
                tx.execute("INSERT INTO app_meta (key, value) VALUES (?1, ?2)", (k, v))?;
            }
            audit::append(
                &tx,
                &audit::AuditEntry {
                    user_name: user,
                    action: "empresa.crear",
                    entity: "empresa",
                    entity_id: Some(&uid),
                    after_json: Some(
                        serde_json::json!({ "nombre": name, "perfil": profile.as_str() })
                            .to_string(),
                    ),
                    ..Default::default()
                },
            )?;
            tx.commit()?;
            drop(db);
            let info = CompanyInfo {
                uid: uid.clone(),
                name: name.clone(),
                profile,
                created_at: created_at.clone(),
            };
            self.register(&info, &dir)?;
            Ok(info)
        })();
        match result {
            Ok(info) => Ok(CreatedCompany {
                company: info,
                recovery_key: keys::recovery_key(&key),
            }),
            Err(e) => {
                let _ = std::fs::remove_dir_all(&dir);
                let _ = self.keys.delete(&uid);
                Err(e)
            }
        }
    }

    pub fn open_company(&self, uid: &str) -> AppResult<CompanySession> {
        let dir = self.company_dir(uid)?;
        let key = self.keys.get(uid)?;
        CompanySession::open(uid, &dir, key)
    }

    /// Si se perdió el almacén de claves (por ejemplo, Windows reinstalado), la clave de
    /// recuperación vuelve a habilitar la empresa. Se verifica abriendo la base.
    pub fn recover_key(&self, uid: &str, recovery: &str) -> AppResult<()> {
        let dir = self.company_dir(uid)?;
        let key = keys::key_from_recovery(recovery).ok_or_else(|| {
            AppError::Validation("la clave de recuperación no tiene el formato correcto".into())
        })?;
        Db::open(&dir.join("company.db"), &key)?;
        self.keys.put(uid, &key)
    }

    /// Restaura un respaldo como **empresa nueva** (nunca sobrescribe la actual).
    pub fn restore_backup(
        &mut self,
        path: &Path,
        password: &str,
        user: &str,
    ) -> AppResult<CompanyInfo> {
        let opened = erpbackup::open(path, password)?;
        let key = DataKey::from_hex(&opened.data_key_hex()?).ok_or_else(|| {
            AppError::Validation("la clave contenida en el respaldo está dañada".into())
        })?;
        let uid = uuid::Uuid::now_v7().to_string();
        let dir = self.data_dir.join("companies").join(&uid);
        std::fs::create_dir_all(dir.join("documents"))?;
        std::fs::copy(opened.db_path(), dir.join("company.db"))?;
        let docs = opened.documents_dir();
        if docs.exists() {
            copy_dir(&docs, &dir.join("documents"))?;
        }
        let result = (|| -> AppResult<CompanyInfo> {
            let mut db = Db::open(&dir.join("company.db"), &key)?;
            maintenance::ensure_ok(db.conn())?;
            let before = migrations::current_version(db.conn())?;
            if before == opened.manifest.schema_version {
                let counts = maintenance::table_counts(db.conn())?;
                for (table, expected) in &opened.manifest.counts {
                    if table == "audit_log" {
                        continue; // la restauración agrega su propio registro
                    }
                    if counts.get(table) != Some(expected) {
                        return Err(AppError::Validation(format!(
                            "el respaldo no coincide con su manifiesto en la tabla {table}"
                        )));
                    }
                }
            }
            migrations::migrate(db.conn_mut())?;
            let date = now_utc().chars().take(10).collect::<String>();
            let name = format!("{} (restaurada {date})", opened.manifest.company_name);
            let profile = db
                .get_meta("profile")?
                .map(|p| BusinessProfile::parse(&p))
                .transpose()?
                .unwrap_or(BusinessProfile::Emprendedor);
            let tx = db.conn_mut().transaction()?;
            tx.execute(
                "INSERT INTO app_meta (key, value) VALUES ('company_uid', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                [&uid],
            )?;
            audit::append(
                &tx,
                &audit::AuditEntry {
                    user_name: user,
                    action: "empresa.restaurar",
                    entity: "empresa",
                    entity_id: Some(&uid),
                    after_json: Some(
                        serde_json::json!({
                            "desde_respaldo": path.file_name().map(|f| f.to_string_lossy().to_string()),
                            "empresa_original": opened.manifest.company_uid,
                            "creado": opened.manifest.created_at,
                        })
                        .to_string(),
                    ),
                    ..Default::default()
                },
            )?;
            tx.commit()?;
            Ok(CompanyInfo {
                uid: uid.clone(),
                name,
                profile,
                created_at: now_utc(),
            })
        })();
        match result {
            Ok(info) => {
                self.keys.put(&uid, &key)?;
                self.register(&info, &dir)?;
                Ok(info)
            }
            Err(e) => {
                // No dejar una empresa a medio restaurar.
                let _ = std::fs::remove_dir_all(&dir);
                Err(e)
            }
        }
    }
}

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let dest = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &dest)?;
        } else {
            std::fs::copy(entry.path(), dest)?;
        }
    }
    Ok(())
}
