//! Casos de uso del Núcleo (Fase 4): sesión de usuario, datos del negocio, usuarios y roles,
//! numeración, monedas, documentos adjuntos, búsqueda global y visor de auditoría.
//!
//! Regla de todos los casos de uso: verificar el permiso en el backend (la interfaz no es una
//! frontera de confianza) y auditar el cambio en la misma transacción.

use crate::auth::{self, Actor, LOCK_MINUTES, MAX_FAILED};
use crate::company::CompanySession;
use crate::registry::{BusinessProfile, validate_name};
use crate::{AppError, AppResult};
use nucleo_db::audit::{self, AuditEntry, AuditRow};
use nucleo_db::core::{
    self as dbcore, AttachmentRow, CurrencyRow, NewAttachment, RateRow, SearchHit, SequenceRow,
};
use nucleo_db::now_utc;
use nucleo_db::users::{self, PermissionRow, RoleRow, UserRow};
use nucleo_io::vault;
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::Path;

/* ───────────────────────────── Tipos de entrada y salida ───────────────────────────── */

/// Datos del negocio (Blueprint §3.2 y §15 #1). Solo el nombre es obligatorio.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BusinessSettings {
    pub name: String,
    pub profile: BusinessProfile,
    pub rut: Option<String>,
    pub legal_name: Option<String>,
    pub activity: Option<String>,
    pub address: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    /// Las ventas efectuadas nacen "pendientes de documentación" (D-10, §7.3).
    pub documentation_reminder: bool,
    /// Calcular IVA informativo en los documentos (requiere un paquete normativo vigente).
    pub tax_enabled: bool,
    /// Tasa que se aplica (ppm) y su origen: el paquete normativo vigente o, si no hay uno, la
    /// tasa que el usuario anotó. `None` = sin tasa: los documentos no calculan impuesto.
    pub tax_rate_ppm: Option<i64>,
    pub tax_rule_source: Option<String>,
    /// Tasa anotada por el usuario (D-F5-02), aunque un paquete normativo tenga prioridad.
    pub tax_rate_user_ppm: Option<i64>,
    /// Logo del negocio como imagen `data:` (PNG, JPEG o WebP), para la interfaz y los documentos.
    pub logo: Option<String>,
}

/// Cambios a los datos del negocio. `None` = no cambia; texto vacío = borrar el dato.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct BusinessPatch {
    pub name: Option<String>,
    pub profile: Option<BusinessProfile>,
    pub rut: Option<String>,
    pub legal_name: Option<String>,
    pub activity: Option<String>,
    pub address: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub documentation_reminder: Option<bool>,
    pub tax_enabled: Option<bool>,
    /// Tasa anotada por el usuario en ppm; 0 = borrarla.
    pub tax_rate_user_ppm: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SecuritySettings {
    /// Minutos sin actividad antes de bloquear la pantalla (0 = nunca). Solo aplica con contraseñas.
    pub lock_minutes: u32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NewUser {
    pub username: String,
    pub display_name: String,
    pub roles: Vec<String>,
    pub password: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UserPatch {
    pub display_name: String,
    pub is_active: bool,
    pub roles: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CurrentUser {
    pub uid: String,
    pub username: String,
    pub display_name: String,
    pub roles: Vec<String>,
    pub permissions: Vec<String>,
}

impl From<&Actor> for CurrentUser {
    fn from(a: &Actor) -> Self {
        Self {
            uid: a.uid.clone(),
            username: a.username.clone(),
            display_name: a.display_name.clone(),
            roles: a.roles.clone(),
            permissions: a.permissions.iter().cloned().collect(),
        }
    }
}

/// Entidad a la que se vincula un documento adjunto.
#[derive(Debug, Clone, Deserialize)]
pub struct EntityRef {
    pub entity: String,
    pub uid: String,
}

const MAX_TEXT: usize = 300;

const LOGO_KEY: &str = "negocio.logo";
const LOGO_MAX_BYTES: usize = 400 * 1024;

fn b64_decode(s: &str) -> Option<Vec<u8>> {
    let val = |c: u8| -> Option<u32> {
        Some(match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => return None,
        } as u32)
    };
    let bytes: Vec<u8> = s.bytes().filter(|c| !c.is_ascii_whitespace()).collect();
    let body = bytes
        .strip_suffix(b"==")
        .or_else(|| bytes.strip_suffix(b"="))
        .unwrap_or(&bytes);
    let mut out = Vec::with_capacity(body.len() * 3 / 4);
    for chunk in body.chunks(4) {
        let mut acc = 0u32;
        for (i, c) in chunk.iter().enumerate() {
            acc |= val(*c)? << (18 - 6 * i);
        }
        let n = match chunk.len() {
            4 => 3,
            3 => 2,
            2 => 1,
            _ => return None,
        };
        for i in 0..n {
            out.push((acc >> (16 - 8 * i)) as u8);
        }
    }
    Some(out)
}

/// Valida que el logo sea una imagen PNG, JPEG o WebP real y de tamaño razonable.
fn validate_logo(d: &str) -> AppResult<String> {
    let bad = || AppError::Validation("el logo debe ser una imagen PNG, JPG o WebP".into());
    let (head, data) = d.split_once(',').ok_or_else(bad)?;
    let mime = head
        .strip_prefix("data:")
        .and_then(|h| h.strip_suffix(";base64"))
        .ok_or_else(bad)?;
    let bytes = b64_decode(data).ok_or_else(bad)?;
    if bytes.len() > LOGO_MAX_BYTES {
        return Err(AppError::Validation(
            "el logo es demasiado grande (máximo 400 KB)".into(),
        ));
    }
    let ok = match mime {
        "image/png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "image/jpeg" => bytes.starts_with(&[0xFF, 0xD8, 0xFF]),
        "image/webp" => bytes.len() > 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP",
        _ => false,
    };
    if !ok {
        return Err(bad());
    }
    Ok(format!("data:{mime};base64,{}", data.trim()))
}

fn clean(v: &Option<String>) -> Option<String> {
    v.as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn check_len(label: &str, v: &Option<String>) -> AppResult<()> {
    if v.as_ref().is_some_and(|s| s.chars().count() > MAX_TEXT) {
        return Err(AppError::Validation(format!(
            "{label} no puede superar {MAX_TEXT} caracteres"
        )));
    }
    Ok(())
}

/// Tabla y columna de cada entidad que admite adjuntos.
fn entity_table(entity: &str) -> AppResult<&'static str> {
    Ok(match entity {
        "cliente" => "customers",
        "proveedor" => "suppliers",
        "producto" => "products",
        "cotizacion" => "quotes",
        "venta" => "sales",
        "orden_compra" => "purchase_orders",
        "compra" => "purchases",
        "gasto" => "expenses",
        "importacion" => "imports",
        _ => {
            return Err(AppError::Validation(format!(
                "no se pueden adjuntar documentos a «{entity}»"
            )));
        }
    })
}

fn entity_id(conn: &Connection, entity: &str, uid: &str) -> AppResult<i64> {
    let table = entity_table(entity)?;
    conn.query_row(
        &format!("SELECT id FROM {table} WHERE uid = ?1"),
        [uid],
        |r| r.get(0),
    )
    .optional()?
    .ok_or_else(|| AppError::NotFound(format!("el registro de {entity}")))
}

/// Tipo de contenido por extensión (solo para mostrar el ícono y abrir con la aplicación correcta).
fn mime_for(name: &str) -> &'static str {
    let ext = name
        .rsplit('.')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    match ext.as_str() {
        "pdf" => "application/pdf",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "txt" => "text/plain",
        "csv" => "text/csv",
        "xml" => "application/xml",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls" => "application/vnd.ms-excel",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "zip" => "application/zip",
        _ => "application/octet-stream",
    }
}

/// Nombre de archivo seguro para mostrar y exportar (sin rutas ni caracteres reservados de Windows).
fn safe_file_name(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or(name);
    let cleaned: String = base
        .chars()
        .map(|c| {
            if matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*') || c.is_control() {
                '_'
            } else {
                c
            }
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').to_string();
    if trimmed.is_empty() {
        "documento".into()
    } else {
        trimmed.chars().take(180).collect()
    }
}

/// Si alguien tiene contraseña, NÚCLEO pedirá iniciar sesión: debe existir entonces al menos un
/// Dueño o Administrador activo con contraseña, o nadie podría volver a administrar el negocio.
fn ensure_owner_can_log_in(conn: &Connection) -> AppResult<()> {
    if !users::any_password(conn)? {
        return Ok(());
    }
    let owners_with_pw: i64 = conn.query_row(
        "SELECT count(DISTINCT u.id) FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
         WHERE u.is_active = 1 AND u.archived_at IS NULL AND u.password_hash IS NOT NULL AND r.code IN ('dueno', 'admin')",
        [],
        |r| r.get(0),
    )?;
    if owners_with_pw == 0 {
        return Err(AppError::Validation(
            "primero asigna una contraseña a un usuario Dueño o Administrador: al activar contraseñas, NÚCLEO pedirá iniciar sesión".into(),
        ));
    }
    Ok(())
}

impl CompanySession {
    /* ───────────── Sesión ───────────── */

    /// Sin contraseñas activas, opera el dueño sin pedir inicio de sesión.
    pub(crate) fn auto_login(&mut self) -> AppResult<()> {
        let conn = self.db.conn();
        self.actor = if users::any_password(conn)? {
            None
        } else {
            match users::default_owner(conn)? {
                Some(u) => Some(Actor::from_user(&u, users::permissions_of(conn, u.id)?)),
                None => None,
            }
        };
        Ok(())
    }

    pub fn login_required(&self) -> bool {
        self.actor.is_none()
    }

    pub fn current_user(&self) -> Option<CurrentUser> {
        self.actor.as_ref().map(CurrentUser::from)
    }

    pub(crate) fn actor(&self) -> AppResult<&Actor> {
        self.actor.as_ref().ok_or(AppError::LoginRequired)
    }

    pub(crate) fn require(&self, perm: &str) -> AppResult<&Actor> {
        let a = self.actor()?;
        a.require(perm)?;
        Ok(a)
    }

    /// Nombre de usuario de quien opera (para auditoría).
    pub fn actor_name(&self) -> AppResult<String> {
        Ok(self.actor()?.username.clone())
    }

    pub fn can(&self, perm: &str) -> bool {
        self.actor.as_ref().is_some_and(|a| a.can(perm))
    }

    pub fn login(&mut self, username: &str, password: &str) -> AppResult<CurrentUser> {
        let now = time::OffsetDateTime::now_utc();
        let now_s = now_utc();
        let user = users::by_username(self.db.conn(), username)?
            .filter(|u| u.is_active)
            .ok_or(AppError::BadCredentials)?;
        let (hash, failed, locked_until) = users::credentials(self.db.conn(), user.id)?;
        if let Some(until) = locked_until.filter(|u| u.as_str() > now_s.as_str()) {
            let until =
                time::OffsetDateTime::parse(&until, &time::format_description::well_known::Rfc3339)
                    .unwrap_or(now);
            return Err(AppError::Locked(((until - now).whole_minutes() + 1).max(1)));
        }
        let ok = match &hash {
            Some(h) => auth::verify_password(password, h),
            None => false, // un usuario sin contraseña no inicia sesión cuando hay contraseñas activas
        };
        let lock = (!ok && failed + 1 >= MAX_FAILED).then(|| {
            (now + time::Duration::minutes(LOCK_MINUTES))
                .format(&time::format_description::well_known::Rfc3339)
                .unwrap_or_default()
        });
        let tx = self.db.conn_mut().transaction()?;
        users::record_login(&tx, user.id, ok, &now_s, lock.as_deref())?;
        audit::append(
            &tx,
            &AuditEntry {
                user_name: &user.username,
                action: if ok {
                    "sesion.iniciar"
                } else {
                    "sesion.fallida"
                },
                entity: "usuario",
                entity_id: Some(&user.uid),
                ..Default::default()
            },
        )?;
        tx.commit()?;
        if !ok {
            return Err(if lock.is_some() {
                AppError::Locked(LOCK_MINUTES)
            } else {
                AppError::BadCredentials
            });
        }
        let actor = Actor::from_user(&user, users::permissions_of(self.db.conn(), user.id)?);
        let out = CurrentUser::from(&actor);
        self.actor = Some(actor);
        Ok(out)
    }

    /// Cierra la sesión. Si no hay contraseñas activas, vuelve a operar el dueño.
    pub fn logout(&mut self) -> AppResult<()> {
        if let Some(a) = &self.actor {
            let name = a.username.clone();
            let uid = a.uid.clone();
            let tx = self.db.conn_mut().transaction()?;
            audit::append(
                &tx,
                &AuditEntry {
                    user_name: &name,
                    action: "sesion.cerrar",
                    entity: "usuario",
                    entity_id: Some(&uid),
                    ..Default::default()
                },
            )?;
            tx.commit()?;
        }
        self.auto_login()
    }

    /// Usuarios activos que pueden iniciar sesión (para la pantalla de ingreso).
    pub fn login_candidates(&self) -> AppResult<Vec<(String, String)>> {
        Ok(users::list(self.db.conn())?
            .into_iter()
            .filter(|u| u.is_active && u.has_password)
            .map(|u| (u.username, u.display_name))
            .collect())
    }

    /* ───────────── Negocio ───────────── */

    fn tax_rule(&self) -> AppResult<Option<(i64, String)>> {
        let today = now_utc().chars().take(10).collect::<String>();
        let row: Option<(String, String, String)> = self
            .db
            .conn()
            .query_row(
                "SELECT v.data_json, v.source, s.code FROM rule_values v JOIN rule_sets s ON s.id = v.rule_set_id
                 WHERE v.code = 'IVA_TASA_GENERAL' AND v.valid_from <= ?1 AND (v.valid_until IS NULL OR v.valid_until >= ?1)
                 ORDER BY v.valid_from DESC LIMIT 1",
                [&today],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?;
        Ok(row.and_then(|(data, source, code)| {
            let v: serde_json::Value = serde_json::from_str(&data).ok()?;
            let dec: rust_decimal::Decimal = v.get("value")?.as_str()?.parse().ok()?;
            let ppm = (dec * rust_decimal::Decimal::from(1_000_000)).round();
            Some((
                rust_decimal::prelude::ToPrimitive::to_i64(&ppm)?,
                format!("{code} · {source}"),
            ))
        }))
    }

    pub fn business(&self) -> AppResult<BusinessSettings> {
        self.actor()?;
        let stored = dbcore::get_setting(self.db.conn(), "negocio")?.unwrap_or_default();
        let s = |k: &str| stored.get(k).and_then(|v| v.as_str()).map(String::from);
        let b = |k: &str, d: bool| stored.get(k).and_then(|v| v.as_bool()).unwrap_or(d);
        let user_rate = stored.get("tax_rate_user_ppm").and_then(|v| v.as_i64());
        let rule = self.tax_rule()?.or_else(|| {
            user_rate.map(|r| {
                (
                    r,
                    "Tasa anotada por ti en Configuración → Mi negocio".to_string(),
                )
            })
        });
        Ok(BusinessSettings {
            name: self.name.clone(),
            profile: self.profile,
            rut: s("rut"),
            legal_name: s("legal_name"),
            activity: s("activity"),
            address: s("address"),
            phone: s("phone"),
            email: s("email"),
            documentation_reminder: b(
                "documentation_reminder",
                self.profile != BusinessProfile::Emprendedor,
            ),
            tax_enabled: b("tax_enabled", self.profile != BusinessProfile::Emprendedor),
            tax_rate_ppm: rule.as_ref().map(|r| r.0),
            tax_rule_source: rule.map(|r| r.1),
            tax_rate_user_ppm: user_rate,
            logo: dbcore::get_setting(self.db.conn(), LOGO_KEY)?
                .and_then(|v| v.as_str().map(String::from)),
        })
    }

    /// Guarda (o quita, con `None`) el logo del negocio. Acepta una imagen `data:` PNG, JPEG o
    /// WebP de hasta 400 KB; la interfaz la reduce antes de enviarla.
    pub fn set_business_logo(&mut self, data_url: Option<&str>) -> AppResult<BusinessSettings> {
        let user = self.require("config.editar")?.username.clone();
        let logo = match data_url.map(str::trim).filter(|s| !s.is_empty()) {
            Some(d) => Some(validate_logo(d)?),
            None => None,
        };
        let tx = self.db.conn_mut().transaction()?;
        match &logo {
            Some(d) => dbcore::set_setting(&tx, LOGO_KEY, &serde_json::Value::String(d.clone()))?,
            None => {
                tx.execute("DELETE FROM settings WHERE key = ?1", [LOGO_KEY])?;
            }
        }
        audit::append(
            &tx,
            &AuditEntry {
                user_name: &user,
                action: if logo.is_some() { "negocio.logo" } else { "negocio.logo_quitar" },
                entity: "negocio",
                entity_id: Some(&self.uid),
                after_json: Some(
                    serde_json::json!({ "texto": if logo.is_some() { "Cambió el logo del negocio" } else { "Quitó el logo del negocio" } })
                        .to_string(),
                ),
                ..Default::default()
            },
        )?;
        tx.commit()?;
        self.business()
    }

    /// Actualiza los datos del negocio. Devuelve los nuevos datos; quien llama actualiza además
    /// el registro del computador (`AppService::update_company`).
    pub fn update_business(&mut self, patch: &BusinessPatch) -> AppResult<BusinessSettings> {
        let user = self.require("config.editar")?.username.clone();
        let before = self.business()?;
        let mut b = before.clone();
        if let Some(n) = &patch.name {
            b.name = validate_name(n)?;
        }
        if let Some(p) = patch.profile {
            b.profile = p;
        }
        if let Some(v) = &patch.rut {
            b.rut = match clean(&Some(v.clone())) {
                Some(r) => Some(
                    nucleo_domain::Rut::parse(&r)
                        .map_err(|e| AppError::Validation(format!("RUT del negocio: {e}")))?
                        .to_string(),
                ),
                None => None,
            };
        }
        for (label, field, val) in [
            ("la razón social", &mut b.legal_name, &patch.legal_name),
            ("el giro", &mut b.activity, &patch.activity),
            ("la dirección", &mut b.address, &patch.address),
            ("el teléfono", &mut b.phone, &patch.phone),
            ("el correo", &mut b.email, &patch.email),
        ] {
            if let Some(v) = val {
                let v = Some(v.clone());
                check_len(label, &v)?;
                *field = clean(&v);
            }
        }
        if b.email.as_ref().is_some_and(|e| !e.contains('@')) {
            return Err(AppError::Validation(
                "el correo del negocio no tiene un formato válido".into(),
            ));
        }
        if let Some(v) = patch.documentation_reminder {
            b.documentation_reminder = v;
        }
        if let Some(v) = patch.tax_enabled {
            b.tax_enabled = v;
        }
        if let Some(v) = patch.tax_rate_user_ppm {
            if !(0..1_000_000).contains(&v) {
                return Err(AppError::Validation(
                    "la tasa debe estar entre 0 % y 100 %".into(),
                ));
            }
            b.tax_rate_user_ppm = (v > 0).then_some(v);
        }
        let stored = serde_json::json!({
            "rut": b.rut, "legal_name": b.legal_name, "activity": b.activity, "address": b.address,
            "phone": b.phone, "email": b.email, "documentation_reminder": b.documentation_reminder,
            "tax_enabled": b.tax_enabled, "tax_rate_user_ppm": b.tax_rate_user_ppm,
        });
        let tx = self.db.conn_mut().transaction()?;
        dbcore::set_setting(&tx, "negocio", &stored)?;
        for (k, v) in [
            ("company_name", b.name.as_str()),
            ("profile", b.profile.as_str()),
        ] {
            tx.execute(
                "INSERT INTO app_meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (k, v),
            )?;
        }
        audit::append(
            &tx,
            &AuditEntry {
                user_name: &user,
                action: "negocio.editar",
                entity: "negocio",
                entity_id: Some(&self.uid),
                before_json: serde_json::to_string(&BusinessSettings {
                    logo: None,
                    ..before.clone()
                })
                .ok(),
                after_json: serde_json::to_string(&BusinessSettings {
                    logo: None,
                    ..b.clone()
                })
                .ok(),
                ..Default::default()
            },
        )?;
        tx.commit()?;
        self.name = b.name.clone();
        self.profile = b.profile;
        self.business()
    }

    pub fn security(&self) -> AppResult<SecuritySettings> {
        self.actor()?;
        let v = dbcore::get_setting(self.db.conn(), "seguridad")?;
        Ok(SecuritySettings {
            lock_minutes: v
                .and_then(|v| v.get("lock_minutes")?.as_u64())
                .map(|m| m as u32)
                .unwrap_or(15),
        })
    }

    pub fn update_security(&mut self, s: &SecuritySettings) -> AppResult<SecuritySettings> {
        let user = self.require("usuarios.gestionar")?.username.clone();
        if s.lock_minutes > 480 {
            return Err(AppError::Validation(
                "el bloqueo por inactividad puede ser de hasta 480 minutos".into(),
            ));
        }
        let tx = self.db.conn_mut().transaction()?;
        dbcore::set_setting(
            &tx,
            "seguridad",
            &serde_json::json!({ "lock_minutes": s.lock_minutes }),
        )?;
        audit::append(
            &tx,
            &AuditEntry {
                user_name: &user,
                action: "seguridad.editar",
                entity: "negocio",
                after_json: serde_json::to_string(s).ok(),
                ..Default::default()
            },
        )?;
        tx.commit()?;
        Ok(s.clone())
    }

    /* ───────────── Usuarios y roles ───────────── */

    pub fn list_users(&self) -> AppResult<Vec<UserRow>> {
        self.require("usuarios.gestionar")?;
        Ok(users::list(self.db.conn())?)
    }

    pub fn roles(&self) -> AppResult<(Vec<RoleRow>, Vec<PermissionRow>)> {
        self.require("usuarios.gestionar")?;
        Ok((
            users::roles(self.db.conn())?,
            users::permissions(self.db.conn())?,
        ))
    }

    pub fn create_user(&mut self, input: &NewUser) -> AppResult<UserRow> {
        let by = self.require("usuarios.gestionar")?.username.clone();
        let username = auth::validate_username(&input.username)?;
        let display = validate_name(&input.display_name)?;
        if input.roles.is_empty() {
            return Err(AppError::Validation(
                "asigna al menos un rol al usuario".into(),
            ));
        }
        let hash = match input.password.as_deref().filter(|p| !p.is_empty()) {
            Some(p) => Some(auth::hash_password(p)?),
            None => None,
        };
        let uid = uuid::Uuid::now_v7().to_string();
        let tx = self.db.conn_mut().transaction()?;
        let id = users::insert(&tx, &uid, &username, &display, &now_utc())?;
        users::set_roles(&tx, id, &input.roles)?;
        users::set_password_hash(&tx, id, hash.as_deref())?;
        ensure_owner_can_log_in(&tx)?;
        let row =
            users::by_uid(&tx, &uid)?.ok_or_else(|| AppError::NotFound("el usuario".into()))?;
        audit::append(
            &tx,
            &AuditEntry {
                user_name: &by,
                action: "usuario.crear",
                entity: "usuario",
                entity_id: Some(&uid),
                after_json: serde_json::to_string(&row).ok(),
                ..Default::default()
            },
        )?;
        tx.commit()?;
        Ok(row)
    }

    pub fn update_user(&mut self, uid: &str, patch: &UserPatch) -> AppResult<UserRow> {
        let by = self.require("usuarios.gestionar")?.username.clone();
        let display = validate_name(&patch.display_name)?;
        if patch.roles.is_empty() {
            return Err(AppError::Validation(
                "asigna al menos un rol al usuario".into(),
            ));
        }
        let tx = self.db.conn_mut().transaction()?;
        let before =
            users::by_uid(&tx, uid)?.ok_or_else(|| AppError::NotFound("el usuario".into()))?;
        users::update_profile(&tx, before.id, &display, patch.is_active)?;
        users::set_roles(&tx, before.id, &patch.roles)?;
        if users::active_owners(&tx)? == 0 {
            return Err(AppError::Validation(
                "debe quedar al menos un usuario activo con rol Dueño o Administrador".into(),
            ));
        }
        ensure_owner_can_log_in(&tx)?;
        let after =
            users::by_uid(&tx, uid)?.ok_or_else(|| AppError::NotFound("el usuario".into()))?;
        audit::append(
            &tx,
            &AuditEntry {
                user_name: &by,
                action: "usuario.editar",
                entity: "usuario",
                entity_id: Some(uid),
                before_json: serde_json::to_string(&before).ok(),
                after_json: serde_json::to_string(&after).ok(),
                ..Default::default()
            },
        )?;
        tx.commit()?;
        if self.actor.as_ref().is_some_and(|a| a.uid == uid) {
            let perms = users::permissions_of(self.db.conn(), after.id)?;
            self.actor = Some(Actor::from_user(&after, perms));
        }
        Ok(after)
    }

    /// Asigna o quita la contraseña de un usuario. Cada persona puede cambiar la suya; para
    /// otros usuarios hace falta el permiso de gestionar usuarios.
    pub fn set_password(&mut self, uid: &str, password: Option<&str>) -> AppResult<()> {
        let me = self.actor()?.clone();
        if me.uid != uid {
            me.require("usuarios.gestionar")?;
        }
        let hash = match password.filter(|p| !p.is_empty()) {
            Some(p) => Some(auth::hash_password(p)?),
            None => None,
        };
        let tx = self.db.conn_mut().transaction()?;
        let user =
            users::by_uid(&tx, uid)?.ok_or_else(|| AppError::NotFound("el usuario".into()))?;
        users::set_password_hash(&tx, user.id, hash.as_deref())?;
        ensure_owner_can_log_in(&tx)?;
        audit::append(
            &tx,
            &AuditEntry {
                user_name: &me.username,
                action: if hash.is_some() {
                    "usuario.contrasena"
                } else {
                    "usuario.quitar_contrasena"
                },
                entity: "usuario",
                entity_id: Some(uid),
                ..Default::default()
            },
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn update_role_permissions(
        &mut self,
        role: &str,
        permissions: &[String],
    ) -> AppResult<RoleRow> {
        let by = self.require("usuarios.gestionar")?.username.clone();
        if role == "dueno" || role == "admin" {
            return Err(AppError::Validation(
                "los roles Dueño y Administrador siempre tienen todos los permisos".into(),
            ));
        }
        let tx = self.db.conn_mut().transaction()?;
        let before = users::roles(&tx)?
            .into_iter()
            .find(|r| r.code == role)
            .ok_or_else(|| AppError::NotFound("el rol".into()))?;
        users::set_role_permissions(&tx, role, permissions)?;
        let after = users::roles(&tx)?
            .into_iter()
            .find(|r| r.code == role)
            .ok_or_else(|| AppError::NotFound("el rol".into()))?;
        audit::append(
            &tx,
            &AuditEntry {
                user_name: &by,
                action: "rol.permisos",
                entity: "rol",
                entity_id: Some(role),
                before_json: serde_json::to_string(&before.permissions).ok(),
                after_json: serde_json::to_string(&after.permissions).ok(),
                ..Default::default()
            },
        )?;
        tx.commit()?;
        Ok(after)
    }

    /* ───────────── Numeración ───────────── */

    pub fn sequences(&self) -> AppResult<Vec<SequenceRow>> {
        self.require("config.ver")?;
        Ok(dbcore::sequences(self.db.conn())?)
    }

    pub fn update_sequence(
        &mut self,
        doc_type: &str,
        prefix: &str,
        next_number: i64,
        width: i64,
    ) -> AppResult<SequenceRow> {
        let by = self.require("config.editar")?.username.clone();
        let prefix = prefix.trim().to_uppercase();
        if prefix.is_empty()
            || prefix.len() > 6
            || !prefix.chars().all(|c| c.is_ascii_alphanumeric())
        {
            return Err(AppError::Validation(
                "el prefijo debe tener de 1 a 6 letras o números, sin tildes".into(),
            ));
        }
        if !(3..=12).contains(&width) {
            return Err(AppError::Validation(
                "el largo del número debe estar entre 3 y 12 dígitos".into(),
            ));
        }
        if next_number < 1 || next_number >= 10_i64.pow(width as u32) {
            return Err(AppError::Validation(
                "el siguiente número no cabe en el largo elegido".into(),
            ));
        }
        let tx = self.db.conn_mut().transaction()?;
        let before = dbcore::sequences(&tx)?
            .into_iter()
            .find(|s| s.doc_type == doc_type)
            .ok_or_else(|| AppError::NotFound("el tipo de documento".into()))?;
        dbcore::update_sequence(&tx, doc_type, &prefix, next_number, width)?;
        let after = dbcore::sequences(&tx)?
            .into_iter()
            .find(|s| s.doc_type == doc_type)
            .ok_or_else(|| AppError::NotFound("el tipo de documento".into()))?;
        audit::append(
            &tx,
            &AuditEntry {
                user_name: &by,
                action: "numeracion.editar",
                entity: "numeracion",
                entity_id: Some(doc_type),
                before_json: serde_json::to_string(&before).ok(),
                after_json: serde_json::to_string(&after).ok(),
                ..Default::default()
            },
        )?;
        tx.commit()?;
        Ok(after)
    }

    /* ───────────── Monedas ───────────── */

    pub fn currencies(&self) -> AppResult<Vec<CurrencyRow>> {
        self.actor()?;
        Ok(dbcore::currencies(self.db.conn())?)
    }

    pub fn rates(&self, currency: &str) -> AppResult<Vec<RateRow>> {
        self.actor()?;
        Ok(dbcore::rates(self.db.conn(), currency, 60)?)
    }

    pub fn set_rate(
        &mut self,
        currency: &str,
        date: &str,
        rate_e6: i64,
        note: Option<&str>,
    ) -> AppResult<()> {
        let by = self.require("config.editar")?.username.clone();
        if currency == "CLP" {
            return Err(AppError::Validation(
                "el peso chileno es la moneda base: no lleva tipo de cambio".into(),
            ));
        }
        if rate_e6 <= 0 || rate_e6 > 1_000_000 * 1_000_000 {
            return Err(AppError::Validation(
                "el tipo de cambio debe ser mayor que cero".into(),
            ));
        }
        if time::Date::parse(date, &time::format_description::well_known::Iso8601::DATE).is_err() {
            return Err(AppError::Validation("la fecha no es válida".into()));
        }
        let tx = self.db.conn_mut().transaction()?;
        let exists: bool = tx.query_row(
            "SELECT EXISTS (SELECT 1 FROM currencies WHERE code = ?1)",
            [currency],
            |r| r.get(0),
        )?;
        if !exists {
            return Err(AppError::NotFound(format!("la moneda {currency}")));
        }
        dbcore::upsert_rate(&tx, currency, date, rate_e6, note)?;
        audit::append(
            &tx,
            &AuditEntry {
                user_name: &by,
                action: "moneda.tasa",
                entity: "moneda",
                entity_id: Some(currency),
                after_json: Some(
                    serde_json::json!({ "fecha": date, "rate_e6": rate_e6 }).to_string(),
                ),
                ..Default::default()
            },
        )?;
        tx.commit()?;
        Ok(())
    }

    /* ───────────── Documentos adjuntos ───────────── */

    fn documents_dir(&self) -> std::path::PathBuf {
        self.dir.join("documents")
    }

    /// Adjunta un archivo del computador: se guarda cifrado en la carpeta del negocio.
    pub fn add_attachment(
        &mut self,
        path: &Path,
        description: Option<&str>,
        link: Option<&EntityRef>,
    ) -> AppResult<AttachmentRow> {
        let meta = std::fs::metadata(path)?;
        if !meta.is_file() {
            return Err(AppError::Validation(
                "elige un archivo, no una carpeta".into(),
            ));
        }
        if meta.len() > vault::MAX_BYTES {
            return Err(AppError::Vault(vault::VaultError::TooLarge));
        }
        let bytes = std::fs::read(path)?;
        let name = path
            .file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_default();
        self.add_attachment_bytes(&name, &bytes, description, link)
    }

    pub fn add_attachment_bytes(
        &mut self,
        file_name: &str,
        bytes: &[u8],
        description: Option<&str>,
        link: Option<&EntityRef>,
    ) -> AppResult<AttachmentRow> {
        let actor = self.require("documentos.subir")?.clone();
        let name = safe_file_name(file_name);
        let description = description.map(str::trim).filter(|d| !d.is_empty());
        if description.is_some_and(|d| d.chars().count() > MAX_TEXT) {
            return Err(AppError::Validation(format!(
                "la descripción no puede superar {MAX_TEXT} caracteres"
            )));
        }
        let sha = vault::store(&self.documents_dir(), self.key.expose_bytes(), bytes)?;
        let uid = uuid::Uuid::now_v7().to_string();
        let tx = self.db.conn_mut().transaction()?;
        let id = dbcore::insert_attachment(
            &tx,
            &NewAttachment {
                uid: &uid,
                sha256: &sha,
                file_name: &name,
                mime_type: mime_for(&name),
                size_bytes: bytes.len() as i64,
                description,
                created_by: Some(actor.user_id),
            },
        )?;
        if let Some(l) = link {
            let eid = entity_id(&tx, &l.entity, &l.uid)?;
            dbcore::link_attachment(&tx, id, &l.entity, eid)?;
        }
        let row = dbcore::attachment(&tx, &uid)?
            .ok_or_else(|| AppError::NotFound("el documento".into()))?;
        audit::append(&tx, &AuditEntry {
            user_name: &actor.username, action: "documento.adjuntar", entity: "documento", entity_id: Some(&uid),
            after_json: Some(serde_json::json!({ "archivo": name, "bytes": bytes.len(), "sha256": sha, "vinculo": link.map(|l| format!("{}:{}", l.entity, l.uid)) }).to_string()),
            ..Default::default()
        })?;
        tx.commit()?;
        Ok(row)
    }

    pub fn list_attachments(
        &self,
        query: &str,
        link: Option<&EntityRef>,
    ) -> AppResult<Vec<AttachmentRow>> {
        self.require("documentos.ver")?;
        let conn = self.db.conn();
        Ok(match link {
            Some(l) => {
                let eid = entity_id(conn, &l.entity, &l.uid)?;
                dbcore::attachments(conn, query, Some((&l.entity, eid)), 500)?
            }
            None => dbcore::attachments(conn, query, None, 500)?,
        })
    }

    /// Descifra el documento y lo guarda donde la persona eligió (diálogo "Guardar como").
    pub fn export_attachment(&mut self, uid: &str, dest: &Path) -> AppResult<()> {
        let by = self.require("documentos.ver")?.username.clone();
        let a = dbcore::attachment(self.db.conn(), uid)?
            .ok_or_else(|| AppError::NotFound("el documento".into()))?;
        let plain = vault::load(&self.documents_dir(), self.key.expose_bytes(), &a.sha256)?;
        std::fs::write(dest, plain)?;
        let tx = self.db.conn_mut().transaction()?;
        audit::append(
            &tx,
            &AuditEntry {
                user_name: &by,
                action: "documento.exportar",
                entity: "documento",
                entity_id: Some(uid),
                ..Default::default()
            },
        )?;
        tx.commit()?;
        Ok(())
    }

    /// Contenido descifrado en memoria (vista previa de imágenes y PDF dentro de la aplicación).
    pub fn attachment_bytes(&self, uid: &str) -> AppResult<(AttachmentRow, Vec<u8>)> {
        self.require("documentos.ver")?;
        let a = dbcore::attachment(self.db.conn(), uid)?
            .ok_or_else(|| AppError::NotFound("el documento".into()))?;
        let plain = vault::load(&self.documents_dir(), self.key.expose_bytes(), &a.sha256)?;
        Ok((a, plain))
    }

    pub fn archive_attachment(&mut self, uid: &str, reason: &str) -> AppResult<()> {
        let by = self.require("documentos.quitar")?.username.clone();
        if reason.trim().is_empty() {
            return Err(AppError::Validation(
                "escribe por qué quitas el documento: queda en la auditoría".into(),
            ));
        }
        let tx = self.db.conn_mut().transaction()?;
        if !dbcore::archive_attachment(&tx, uid, &by)? {
            return Err(AppError::NotFound("el documento".into()));
        }
        audit::append(
            &tx,
            &AuditEntry {
                user_name: &by,
                action: "documento.quitar",
                entity: "documento",
                entity_id: Some(uid),
                reason: Some(reason.trim()),
                ..Default::default()
            },
        )?;
        tx.commit()?;
        Ok(())
    }

    /* ───────────── Búsqueda y auditoría ───────────── */

    /// Búsqueda global (Ctrl+K). Solo devuelve lo que la persona tiene permiso de ver.
    pub fn global_search(&self, query: &str) -> AppResult<Vec<SearchHit>> {
        let a = self.actor()?;
        let hits = dbcore::global_search(self.db.conn(), query, 8)?;
        Ok(hits
            .into_iter()
            .filter(|h| {
                let perm = match h.kind {
                    "cliente" => "clientes.ver",
                    "proveedor" => "proveedores.ver",
                    "producto" => "productos.ver",
                    "cotizacion" | "venta" => "ventas.ver",
                    "orden_compra" => "compras.ver",
                    "documento" => "documentos.ver",
                    _ => "config.ver",
                };
                a.can(perm)
            })
            .collect())
    }

    pub fn audit_log(&self, query: &str, before_id: Option<i64>) -> AppResult<Vec<AuditRow>> {
        self.require("auditoria.ver")?;
        Ok(audit::recent(self.db.conn(), query, before_id, 100)?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nombres_de_archivo_seguros() {
        assert_eq!(safe_file_name(r"C:\Users\x\factura:1.pdf"), "factura_1.pdf");
        assert_eq!(safe_file_name("../../etc/passwd"), "passwd");
        assert_eq!(safe_file_name("..."), "documento");
        assert_eq!(mime_for("Foto.JPG"), "image/jpeg");
    }

    #[test]
    fn entidades_permitidas() {
        assert!(entity_table("venta").is_ok());
        assert!(entity_table("sqlite_master").is_err());
    }
}
