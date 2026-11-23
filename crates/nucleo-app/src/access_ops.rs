//! Accesos a sitios web: el gestor de contraseñas de NÚCLEO. Guarda el usuario y la clave de cuentas
//! de **solo lectura** (colaborador de Mercado Libre, operador de consulta del banco…) en la base
//! cifrada de la empresa.
//!
//! Reglas (docs/AGENTE_CLAUDE.md §7):
//! - La clave la escribe la persona en NÚCLEO y nunca vuelve a la interfaz ni al asistente: lo que se
//!   lista es el sitio, el usuario y si hay clave guardada.
//! - Solo se guardan cuentas que no pueden pagar ni transferir, y la persona lo confirma al guardar.
//! - Quien usa la clave es NÚCLEO (su robot o su extensión de navegador), con la autorización de la
//!   persona para cada ingreso. [`CompanySession::access_credentials`] es para ese uso interno y no
//!   se expone como comando de la interfaz.

use crate::company::CompanySession;
use crate::sales_ops::{log, opt_text};
use crate::{AppError, AppResult};
use nucleo_db::now_utc;
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};

pub const KINDS: &[&str] = &["lectura", "operador"];

/// Lo que ve la interfaz (sin la clave).
#[derive(Debug, Clone, Serialize)]
pub struct AccessRow {
    pub uid: String,
    pub name: String,
    pub login_url: String,
    pub username: String,
    /// «lectura» u «operador».
    pub kind: String,
    pub notes: Option<String>,
    pub has_password: bool,
    pub updated_at: String,
}

/// Lo que escribe la persona. Al cambiar un acceso, la clave vacía conserva la guardada.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct AccessInput {
    pub name: String,
    pub login_url: String,
    pub username: String,
    pub password: String,
    pub kind: String,
    pub notes: Option<String>,
    /// La persona declara que esta cuenta no puede pagar ni transferir.
    pub no_payments: bool,
}

/// Nombres de sitios cuya clave no se guarda: con ellas se puede mover dinero o firmar ante el SII.
fn forbidden(name: &str, url: &str) -> Option<&'static str> {
    let t = format!("{} {}", name.to_lowercase(), url.to_lowercase());
    if t.contains("accounts.google") || t.contains("google.com") {
        Some("la cuenta de Google no se guarda: inicia sesión tú en el navegador")
    } else if t.contains("sii.cl") || t.contains("clave tributaria") {
        Some("la Clave Tributaria del SII no se guarda: entra tú con tu certificado o tu clave")
    } else {
        None
    }
}

impl CompanySession {
    pub fn accesses(&self) -> AppResult<Vec<AccessRow>> {
        self.require("config.ver")?;
        let mut st = self.db.conn().prepare(
            "SELECT uid, name, login_url, username, kind, notes, length(secret) > 0, updated_at
             FROM site_accesses ORDER BY name COLLATE NOCASE",
        )?;
        let rows = st.query_map([], |r| {
            Ok(AccessRow {
                uid: r.get(0)?,
                name: r.get(1)?,
                login_url: r.get(2)?,
                username: r.get(3)?,
                kind: r.get(4)?,
                notes: r.get(5)?,
                has_password: r.get::<_, i64>(6)? == 1,
                updated_at: r.get(7)?,
            })
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// Crea (sin `uid`) o cambia un acceso.
    pub fn save_access(&mut self, uid: Option<&str>, input: &AccessInput) -> AppResult<AccessRow> {
        self.require("config.editar")?;
        let v = |m: &str| Err(AppError::Validation(m.into()));
        let name = opt_text(&Some(input.name.clone()), 60, "el nombre del sitio")?;
        let Some(name) = name else {
            return v("escribe el nombre del sitio (ej. «Mercado Libre»)");
        };
        let url = input.login_url.trim().to_string();
        if !url.starts_with("https://") || url.len() > 300 || url.contains([' ', '@']) {
            return v(
                "la dirección de ingreso debe empezar con https:// (cópiala de la página donde inicias sesión)",
            );
        }
        if let Some(m) = forbidden(&name, &url) {
            return v(m);
        }
        let username = opt_text(&Some(input.username.clone()), 120, "el usuario")?;
        let Some(username) = username else {
            return v("escribe el usuario o correo con que se inicia sesión");
        };
        let kind = if input.kind.is_empty() {
            "lectura"
        } else {
            input.kind.as_str()
        };
        if !KINDS.contains(&kind) {
            return v("el tipo de acceso es «lectura» u «operador»");
        }
        if !input.no_payments {
            return v(
                "confirma que esta cuenta no puede pagar ni transferir: NÚCLEO solo guarda accesos de consulta",
            );
        }
        if input.password.chars().count() > 200 {
            return v("la clave admite hasta 200 caracteres");
        }
        let notes = opt_text(&input.notes, 300, "las notas")?;
        let now = now_utc();
        let user = self.actor_name()?;
        let conn = self.db.conn();
        let (uid, text) = match uid.filter(|u| !u.is_empty()) {
            Some(u) => {
                let found: Option<i64> = conn
                    .query_row("SELECT id FROM site_accesses WHERE uid = ?1", [u], |r| {
                        r.get(0)
                    })
                    .optional()?;
                let id = found.ok_or_else(|| AppError::NotFound("el acceso".into()))?;
                conn.execute(
                    "UPDATE site_accesses SET name = ?1, login_url = ?2, username = ?3, kind = ?4, notes = ?5, updated_at = ?6 WHERE id = ?7",
                    params![name, url, username, kind, notes, now, id],
                )
                .map_err(dup)?;
                let changed = !input.password.is_empty();
                if changed {
                    conn.execute(
                        "UPDATE site_accesses SET secret = ?1 WHERE id = ?2",
                        params![input.password, id],
                    )?;
                }
                (
                    u.to_string(),
                    format!(
                        "Cambió el acceso a {name} ({username}){}",
                        if changed { "; clave nueva" } else { "" }
                    ),
                )
            }
            None => {
                if input.password.is_empty() {
                    return v("escribe la clave de la cuenta");
                }
                let u = uuid::Uuid::now_v7().to_string();
                conn.execute(
                    "INSERT INTO site_accesses (uid, name, login_url, username, secret, kind, notes, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
                    params![u, name, url, username, input.password, kind, notes, now],
                )
                .map_err(dup)?;
                (u, format!("Guardó el acceso a {name} ({username}, {kind})"))
            }
        };
        log(conn, &user, "update", "acceso", &uid, &text, None)?;
        self.accesses()?
            .into_iter()
            .find(|a| a.uid == uid)
            .ok_or_else(|| AppError::NotFound("el acceso".into()))
    }

    /// Borra un acceso (y su clave).
    pub fn delete_access(&mut self, uid: &str) -> AppResult<Vec<AccessRow>> {
        self.require("config.editar")?;
        let user = self.actor_name()?;
        let conn = self.db.conn();
        let name: Option<String> = conn
            .query_row(
                "SELECT name FROM site_accesses WHERE uid = ?1",
                [uid],
                |r| r.get(0),
            )
            .optional()?;
        let name = name.ok_or_else(|| AppError::NotFound("el acceso".into()))?;
        conn.execute("DELETE FROM site_accesses WHERE uid = ?1", [uid])?;
        log(
            conn,
            &user,
            "delete",
            "acceso",
            uid,
            &format!("Borró el acceso a {name} y su clave"),
            None,
        )?;
        self.accesses()
    }

    /// Dirección, usuario y clave para iniciar sesión. Solo para NÚCLEO (robot o extensión de
    /// navegador), después de que la persona autorizó ese ingreso: no es un comando de la interfaz ni
    /// una herramienta del asistente. Cada lectura queda en la auditoría.
    pub fn access_credentials(
        &mut self,
        uid: &str,
        purpose: &str,
    ) -> AppResult<(String, String, String)> {
        self.require("config.editar")?;
        let user = self.actor_name()?;
        let conn = self.db.conn();
        let row: Option<(String, String, String, String)> = conn
            .query_row(
                "SELECT name, login_url, username, secret FROM site_accesses WHERE uid = ?1",
                [uid],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .optional()?;
        let (name, url, username, secret) =
            row.ok_or_else(|| AppError::NotFound("el acceso".into()))?;
        log(
            conn,
            &user,
            "read",
            "acceso",
            uid,
            &format!(
                "Usó el acceso a {name} ({username}) para iniciar sesión: {}",
                purpose.chars().take(200).collect::<String>()
            ),
            None,
        )?;
        Ok((url, username, secret))
    }
}

fn dup(e: rusqlite::Error) -> AppError {
    if e.to_string().contains("UNIQUE") {
        AppError::Validation("ya hay un acceso con ese nombre".into())
    } else {
        e.into()
    }
}
