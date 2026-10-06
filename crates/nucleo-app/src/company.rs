//! Sesión abierta sobre la base de una empresa y sus casos de uso.

use crate::auth::Actor;
use crate::registry::{BusinessProfile, validate_name};
use crate::{APP_VERSION, AppError, AppResult};
use nucleo_db::customers::{self, CustomerRow, NewCustomerRow};
use nucleo_db::{DataKey, Db, audit, maintenance, migrations, now_utc};
use nucleo_domain::Rut;
use nucleo_io::erpbackup;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub struct CompanySession {
    pub(crate) uid: String,
    pub(crate) name: String,
    pub(crate) profile: BusinessProfile,
    pub(crate) dir: PathBuf,
    pub(crate) db: Db,
    pub(crate) key: DataKey,
    /// Quién opera. `None` = falta iniciar sesión (hay usuarios con contraseña).
    pub(crate) actor: Option<Actor>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct NewCustomer {
    pub name: String,
    pub rut: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BackupDone {
    pub path: String,
    pub file_name: String,
    pub size_bytes: u64,
    pub manifest: erpbackup::Manifest,
    /// El respaldo se reabrió y validó inmediatamente después de crearlo.
    pub verified: bool,
}

fn none_if_blank(s: &Option<String>) -> Option<String> {
    s.as_ref()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

/// Valida y normaliza los datos de un cliente: (nombre, RUT compacto, correo, teléfono).
type CustomerFields = (String, Option<String>, Option<String>, Option<String>);
pub(crate) fn validate_customer(input: &NewCustomer) -> AppResult<CustomerFields> {
    let name = validate_name(&input.name)?;
    let rut = match none_if_blank(&input.rut) {
        Some(r) => Some(
            Rut::parse(&r)
                .map_err(|e| AppError::Validation(format!("RUT: {e}")))?
                .compact(),
        ),
        None => None,
    };
    let email = none_if_blank(&input.email);
    if let Some(e) = &email
        && (!e.contains('@') || e.len() > 254)
    {
        return Err(AppError::Validation(
            "el correo no tiene un formato válido".into(),
        ));
    }
    let phone = none_if_blank(&input.phone);
    if phone.as_ref().is_some_and(|p| p.chars().count() > 40) {
        return Err(AppError::Validation(
            "el teléfono es demasiado largo".into(),
        ));
    }
    Ok((name, rut, email, phone))
}

/// "Ferretería Los Andes" → "ferreteria-los-andes".
pub fn slug(name: &str) -> String {
    let mut out = String::new();
    for c in name.trim().to_lowercase().chars() {
        let mapped = match c {
            'á' | 'à' | 'ä' | 'â' => 'a',
            'é' | 'è' | 'ë' | 'ê' => 'e',
            'í' | 'ì' | 'ï' | 'î' => 'i',
            'ó' | 'ò' | 'ö' | 'ô' => 'o',
            'ú' | 'ù' | 'ü' | 'û' => 'u',
            'ñ' => 'n',
            c if c.is_ascii_alphanumeric() => c,
            _ => '-',
        };
        if mapped == '-' && (out.is_empty() || out.ends_with('-')) {
            continue;
        }
        out.push(mapped);
    }
    let out = out.trim_end_matches('-').to_string();
    if out.is_empty() {
        "empresa".into()
    } else {
        out.chars().take(40).collect()
    }
}

/// `empresa_YYYY-MM-DD.erpbackup`; si ya existe, agrega la hora para no sobrescribir.
pub fn backup_file_name(dir: &Path, company: &str, now: time::OffsetDateTime) -> PathBuf {
    let base = format!(
        "{}_{:04}-{:02}-{:02}",
        slug(company),
        now.year(),
        now.month() as u8,
        now.day()
    );
    let first = dir.join(format!("{base}.erpbackup"));
    if !first.exists() {
        return first;
    }
    let with_time = dir.join(format!(
        "{base}_{:02}{:02}.erpbackup",
        now.hour(),
        now.minute()
    ));
    if !with_time.exists() {
        return with_time;
    }
    dir.join(format!(
        "{base}_{:02}{:02}{:02}.erpbackup",
        now.hour(),
        now.minute(),
        now.second()
    ))
}

impl CompanySession {
    pub(crate) fn open(uid: &str, dir: &Path, key: DataKey) -> AppResult<Self> {
        let mut db = Db::open(&dir.join("company.db"), &key)?;
        migrations::migrate(db.conn_mut())?;
        let name = db.get_meta("company_name")?.unwrap_or_default();
        let profile = db
            .get_meta("profile")?
            .map(|p| BusinessProfile::parse(&p))
            .transpose()?
            .unwrap_or(BusinessProfile::Emprendedor);
        let mut s = Self {
            uid: uid.into(),
            name,
            profile,
            dir: dir.into(),
            db,
            key,
            actor: None,
        };
        s.auto_login()?;
        Ok(s)
    }

    pub fn uid(&self) -> &str {
        &self.uid
    }
    pub fn name(&self) -> &str {
        &self.name
    }
    pub fn profile(&self) -> BusinessProfile {
        self.profile
    }
    pub fn cipher_version(&self) -> AppResult<String> {
        Ok(self.db.cipher_version()?)
    }

    /// Agrega un cliente. Valida el RUT (opcional) y audita en la misma transacción.
    pub fn add_customer(&mut self, input: &NewCustomer) -> AppResult<CustomerRow> {
        let user = self.require("clientes.editar")?.username.clone();
        let user = user.as_str();
        let (name, rut, email, phone) = validate_customer(input)?;
        let uid = uuid::Uuid::now_v7().to_string();
        let created_at = now_utc();
        let tx = self.db.conn_mut().transaction()?;
        let row = customers::insert(
            &tx,
            &NewCustomerRow {
                uid: &uid,
                rut: rut.as_deref(),
                name: &name,
                email: email.as_deref(),
                phone: phone.as_deref(),
                created_at: &created_at,
            },
        )?;
        audit::append(
            &tx,
            &audit::AuditEntry {
                user_name: user,
                action: "cliente.crear",
                entity: "cliente",
                entity_id: Some(&row.uid),
                after_json: Some(serde_json::to_string(&row).unwrap_or_default()),
                ..Default::default()
            },
        )?;
        tx.commit()?;
        Ok(row)
    }

    pub fn search_customers(&self, query: &str, limit: u32) -> AppResult<Vec<CustomerRow>> {
        self.require("clientes.ver")?;
        Ok(customers::search(
            self.db.conn(),
            query,
            limit.clamp(1, 200),
        )?)
    }

    pub fn count_customers(&self) -> AppResult<i64> {
        Ok(customers::count(self.db.conn())?)
    }

    pub fn verify_audit(&self) -> AppResult<audit::ChainReport> {
        Ok(audit::verify_chain(self.db.conn())?)
    }

    /// Crea un respaldo `.erpbackup` en `dest_dir`, lo **verifica** reabriéndolo y lo audita.
    pub fn create_backup(&mut self, dest_dir: &Path, password: &str) -> AppResult<BackupDone> {
        let user = self.require("respaldos.crear")?.username.clone();
        let user = user.as_str();
        std::fs::create_dir_all(dest_dir)?;
        let tmp = tempfile::tempdir()?;
        let snapshot = tmp.path().join("company.db");
        maintenance::snapshot_to(&self.db, &snapshot, &self.key)?;
        let snap_db = Db::open(&snapshot, &self.key)?;
        let counts = maintenance::table_counts(snap_db.conn())?;
        let schema_version = migrations::current_version(snap_db.conn())?;
        drop(snap_db);

        let now = time::OffsetDateTime::now_utc();
        let out = backup_file_name(dest_dir, &self.name, now);
        let manifest = erpbackup::create(
            &erpbackup::BackupInput {
                db_snapshot: &snapshot,
                data_key: self.key.expose_bytes(),
                documents_dir: Some(&self.dir.join("documents")),
                settings_json: None,
                app_version: APP_VERSION,
                schema_version,
                company_uid: &self.uid,
                company_name: &self.name,
                created_at: &now_utc(),
                counts,
            },
            password,
            &out,
        )?;

        // Verificación inmediata (Blueprint §9.2 paso 3).
        let opened = erpbackup::open(&out, password)?;
        let check = Db::open(&opened.db_path(), &self.key)?;
        maintenance::ensure_ok(check.conn())?;
        let verified = opened.manifest == manifest
            && maintenance::table_counts(check.conn())? == manifest.counts;
        if !verified {
            return Err(AppError::Validation(
                "el respaldo se creó pero no pasó la verificación".into(),
            ));
        }

        let size_bytes = std::fs::metadata(&out)?.len();
        let file_name = out
            .file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_default();
        let tx = self.db.conn_mut().transaction()?;
        audit::append(
            &tx,
            &audit::AuditEntry {
                user_name: user,
                action: "respaldo.crear",
                entity: "respaldo",
                entity_id: Some(&file_name),
                after_json: Some(
                    serde_json::json!({ "bytes": size_bytes, "verificado": true }).to_string(),
                ),
                ..Default::default()
            },
        )?;
        tx.commit()?;
        Ok(BackupDone {
            path: out.to_string_lossy().to_string(),
            file_name,
            size_bytes,
            manifest,
            verified,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slug_de_nombres() {
        assert_eq!(slug("Ferretería Los Andes"), "ferreteria-los-andes");
        assert_eq!(slug("  Ñuñoa & Cía. "), "nunoa-cia");
        assert_eq!(slug("***"), "empresa");
    }

    #[test]
    fn nombre_de_respaldo_no_sobrescribe() {
        let dir = tempfile::tempdir().unwrap();
        let now = time::macros::datetime!(2026-10-05 14:30:15 UTC);
        let a = backup_file_name(dir.path(), "Mi Negocio", now);
        assert_eq!(a.file_name().unwrap(), "mi-negocio_2026-10-05.erpbackup");
        std::fs::write(&a, b"x").unwrap();
        let b = backup_file_name(dir.path(), "Mi Negocio", now);
        assert_eq!(
            b.file_name().unwrap(),
            "mi-negocio_2026-10-05_1430.erpbackup"
        );
    }
}
