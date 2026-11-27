//! Clave de firma de documentos del SII.
//!
//! Es la clave del certificado que el SII pide en la página «Firma de documento tributario
//! electrónico» al emitir una factura, una guía o una nota desde su portal. Firmar es emitir, y
//! emitir no se puede deshacer, así que esta clave tiene reglas propias (distintas de los accesos):
//!
//! - La escribe y la borra **solo la persona**, en Configuración → Integraciones → Accesos. El
//!   asistente no puede guardarla, cambiarla ni leerla, y ningún comando la devuelve.
//! - No sirve para iniciar sesión: no aparece entre los accesos ni tiene «Autorizar por hoy».
//! - NÚCLEO la escribe únicamente en la página de firma del SII y únicamente después de que la
//!   persona aprueba **ese documento** en un aviso de NÚCLEO (un clic por documento). La aprobación
//!   ocurre en la aplicación de escritorio, fuera del alcance del asistente.
//! - Cada uso queda en la auditoría, con lo que se firmó.
//!
//! Ver docs/DECISIONS.md, D-NAV-08.

use crate::company::CompanySession;
use crate::sales_ops::log;
use crate::{AppError, AppResult};
use nucleo_db::now_utc;
use rusqlite::{OptionalExtension, params};
use serde::Serialize;

/// Sitio donde vale la clave de firma (el portal del SII y sus servidores).
pub const SIGNING_SITE: &str = "sii.cl";

/// Lo que ve la interfaz y el asistente: si hay clave guardada, nunca la clave.
#[derive(Debug, Clone, Serialize)]
pub struct SigningKeyStatus {
    pub saved: bool,
    pub updated_at: Option<String>,
    pub updated_by: Option<String>,
}

/// ¿La página (por su host) es del SII? Solo ahí se escribe la clave de firma.
pub fn is_signing_host(host: &str) -> bool {
    let h = host.trim().to_lowercase();
    h == SIGNING_SITE || h.ends_with(&format!(".{SIGNING_SITE}"))
}

impl CompanySession {
    pub fn signing_key_status(&self) -> AppResult<SigningKeyStatus> {
        self.require("config.ver")?;
        let row: Option<(String, String)> = self
            .db
            .conn()
            .query_row(
                "SELECT updated_at, updated_by FROM sii_signing_key WHERE id = 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        Ok(match row {
            Some((at, by)) => SigningKeyStatus {
                saved: true,
                updated_at: Some(at),
                updated_by: Some(by),
            },
            None => SigningKeyStatus {
                saved: false,
                updated_at: None,
                updated_by: None,
            },
        })
    }

    fn signing_person_only(&self) -> AppResult<String> {
        let user = self.require("config.editar")?.username.clone();
        if self.via_agent {
            return Err(AppError::Validation(
                "la clave de firma la guarda y la borra la persona en Configuración → \
                 Integraciones → Accesos"
                    .into(),
            ));
        }
        Ok(user)
    }

    /// Guarda (o reemplaza) la clave de firma. Solo la persona, y declarando que entiende su uso.
    pub fn save_signing_key(&mut self, key: &str, declared: bool) -> AppResult<SigningKeyStatus> {
        let user = self.signing_person_only()?;
        let n = key.chars().count();
        if n == 0 {
            return Err(AppError::Validation("escribe la clave de firma".into()));
        }
        if n > 200 || key.chars().any(|c| c.is_control()) {
            return Err(AppError::Validation(
                "la clave de firma admite hasta 200 caracteres, sin saltos de línea".into(),
            ));
        }
        if !declared {
            return Err(AppError::Validation(
                "confirma que es la clave con que firmas documentos en el SII y que NÚCLEO la \
                 usará solo en la página de firma, con tu aprobación por cada documento"
                    .into(),
            ));
        }
        let conn = self.db.conn();
        conn.execute(
            "INSERT INTO sii_signing_key (id, secret, updated_by, updated_at) VALUES (1, ?1, ?2, ?3)
             ON CONFLICT (id) DO UPDATE SET secret = excluded.secret, updated_by = excluded.updated_by,
                                            updated_at = excluded.updated_at",
            params![key, user, now_utc()],
        )?;
        log(
            conn,
            &user,
            "update",
            "clave_firma",
            "sii",
            "Guardó la clave de firma de documentos del SII",
            None,
        )?;
        self.signing_key_status()
    }

    /// Borra la clave de firma. Solo la persona.
    pub fn delete_signing_key(&mut self) -> AppResult<SigningKeyStatus> {
        let user = self.signing_person_only()?;
        let conn = self.db.conn();
        if conn.execute("DELETE FROM sii_signing_key WHERE id = 1", [])? > 0 {
            log(
                conn,
                &user,
                "delete",
                "clave_firma",
                "sii",
                "Borró la clave de firma de documentos del SII",
                None,
            )?;
        }
        self.signing_key_status()
    }

    /// La clave, para escribirla en la página de firma. Solo para NÚCLEO (el navegador propio),
    /// **después** de que la persona aprobó ese documento en el aviso de la aplicación y solo si la
    /// página es del SII: no es un comando de la interfaz ni una herramienta del asistente. Cada
    /// lectura queda en la auditoría con lo que se firma.
    pub fn signing_secret(&mut self, page_host: &str, what: &str) -> AppResult<String> {
        self.require("config.editar")?;
        if !is_signing_host(page_host) {
            return Err(AppError::Validation(format!(
                "La página abierta es de {page_host}: la clave de firma solo se escribe en el SII."
            )));
        }
        let user = self.actor_name()?;
        let conn = self.db.conn();
        let secret: Option<String> = conn
            .query_row("SELECT secret FROM sii_signing_key WHERE id = 1", [], |r| {
                r.get(0)
            })
            .optional()?;
        let secret = secret.ok_or_else(|| {
            AppError::Validation(
                "Aún no hay clave de firma guardada: la persona la escribe en Configuración → \
                 Integraciones → Accesos, «Clave de firma de documentos (SII)»."
                    .into(),
            )
        })?;
        log(
            conn,
            &user,
            "read",
            "clave_firma",
            "sii",
            &format!(
                "Firmó en el SII con la clave guardada, con la aprobación de la persona: {}",
                what.chars().take(300).collect::<String>()
            ),
            None,
        )?;
        Ok(secret)
    }

    /// Una línea con la venta que se va a firmar (número, cliente y total), para el aviso de
    /// aprobación. Sale de la base, no de lo que diga el asistente.
    pub fn signing_sale_brief(&self, reference: &str) -> AppResult<String> {
        self.require("ventas.ver")?;
        let wanted = reference.trim();
        let row: Option<(String, Option<String>, i64)> = self
            .db
            .conn()
            .query_row(
                "SELECT s.number, c.name, s.total_minor
                 FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
                 WHERE upper(s.number) = upper(?1) OR s.uid = ?1
                 ORDER BY s.id DESC LIMIT 1",
                [wanted],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?;
        let (number, customer, total) =
            row.ok_or_else(|| AppError::NotFound(format!("la venta «{wanted}»")))?;
        Ok(format!(
            "{number} · {} · total $ {}",
            customer.unwrap_or_else(|| "cliente ocasional".into()),
            thousands(total)
        ))
    }
}

fn thousands(n: i64) -> String {
    let digits = n.unsigned_abs().to_string();
    let mut out = String::new();
    for (i, ch) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push('.');
        }
        out.push(ch);
    }
    if n < 0 { format!("-{out}") } else { out }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn solo_el_sii_recibe_la_clave_y_los_montos_se_leen() {
        assert!(is_signing_host("www1.sii.cl"));
        assert!(is_signing_host("SII.cl"));
        assert!(!is_signing_host("sii.cl.entrar.com"));
        assert!(!is_signing_host("misii.cl"));
        assert_eq!(thousands(0), "0");
        assert_eq!(thousands(37900), "37.900");
        assert_eq!(thousands(1234567), "1.234.567");
        assert_eq!(thousands(-500), "-500");
    }
}
