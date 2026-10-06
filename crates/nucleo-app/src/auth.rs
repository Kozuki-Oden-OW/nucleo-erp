//! Usuarios locales: contraseñas (Argon2id) e identidad de quien opera (Blueprint §10.2, §10.4).
//!
//! Modo de un solo usuario: mientras ningún usuario tenga contraseña, el negocio abre directo
//! con el dueño. Al activar la primera contraseña, NÚCLEO pide iniciar sesión.

use crate::{AppError, AppResult};
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::{Algorithm, Argon2, Params, Version};
use nucleo_db::users::UserRow;
use serde::Serialize;
use std::collections::BTreeSet;

/// Intentos fallidos antes de bloquear temporalmente al usuario.
pub const MAX_FAILED: i64 = 5;
/// Minutos de bloqueo tras `MAX_FAILED` intentos.
pub const LOCK_MINUTES: i64 = 5;

/// Quién está operando: se usa para la auditoría y para verificar permisos en cada caso de uso.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Actor {
    pub user_id: i64,
    pub uid: String,
    pub username: String,
    pub display_name: String,
    pub roles: Vec<String>,
    pub permissions: BTreeSet<String>,
}

impl Actor {
    pub fn from_user(u: &UserRow, permissions: Vec<String>) -> Self {
        Self {
            user_id: u.id,
            uid: u.uid.clone(),
            username: u.username.clone(),
            display_name: u.display_name.clone(),
            roles: u.roles.clone(),
            permissions: permissions.into_iter().collect(),
        }
    }

    pub fn can(&self, perm: &str) -> bool {
        self.permissions.contains(perm)
    }

    pub fn require(&self, perm: &str) -> AppResult<()> {
        if self.can(perm) {
            Ok(())
        } else {
            Err(AppError::Forbidden(permission_label(perm).to_string()))
        }
    }
}

/// Descripción breve para el mensaje "No tienes permiso para …".
pub fn permission_label(perm: &str) -> &'static str {
    match perm {
        "usuarios.gestionar" => "gestionar usuarios",
        "config.ver" => "ver la configuración",
        "config.editar" => "cambiar la configuración",
        "auditoria.ver" => "ver la auditoría",
        "respaldos.crear" => "crear respaldos",
        "respaldos.restaurar" => "restaurar respaldos",
        "clientes.ver" => "ver clientes",
        "clientes.editar" => "crear o editar clientes",
        "productos.ver" => "ver productos",
        "productos.editar" => "crear o editar productos",
        "costos.ver" => "ver costos y márgenes",
        "ventas.ver" => "ver ventas",
        "ventas.crear" => "crear cotizaciones o ventas",
        "ventas.efectuar" => "efectuar ventas",
        "ventas.anular" => "anular ventas",
        "ventas.documentar" => "marcar ventas como documentadas",
        "cobros.registrar" => "registrar cobros",
        "documentos.ver" => "ver documentos",
        "documentos.subir" => "adjuntar documentos",
        "documentos.quitar" => "quitar documentos",
        _ => "realizar esta acción",
    }
}

fn argon() -> Argon2<'static> {
    // 19 MiB, 2 pasadas: parámetros mínimos recomendados por OWASP para Argon2id.
    let params = Params::new(19 * 1024, 2, 1, None).expect("parámetros Argon2 válidos");
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
}

pub fn validate_password(pw: &str) -> AppResult<()> {
    if pw.chars().count() < 8 {
        return Err(AppError::Validation(
            "la contraseña debe tener al menos 8 caracteres".into(),
        ));
    }
    if pw.len() > 256 {
        return Err(AppError::Validation(
            "la contraseña es demasiado larga".into(),
        ));
    }
    Ok(())
}

pub fn hash_password(pw: &str) -> AppResult<String> {
    validate_password(pw)?;
    let mut salt = [0u8; 16];
    getrandom::fill(&mut salt).map_err(|e| AppError::Validation(e.to_string()))?;
    let salt = SaltString::encode_b64(&salt).map_err(|e| AppError::Validation(e.to_string()))?;
    Ok(argon()
        .hash_password(pw.as_bytes(), &salt)
        .map_err(|e| AppError::Validation(e.to_string()))?
        .to_string())
}

pub fn verify_password(pw: &str, phc: &str) -> bool {
    PasswordHash::new(phc)
        .map(|h| argon().verify_password(pw.as_bytes(), &h).is_ok())
        .unwrap_or(false)
}

/// Nombre de usuario: 2 a 60 caracteres, letras, números, punto, guion o guion bajo.
pub fn validate_username(name: &str) -> AppResult<String> {
    let n = name.trim().to_lowercase();
    let ok = (2..=60).contains(&n.chars().count())
        && n.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'));
    if !ok {
        return Err(AppError::Validation(
            "el usuario debe tener entre 2 y 60 caracteres: letras sin tilde, números, punto o guion".into(),
        ));
    }
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_y_verificacion() {
        let h = hash_password("clave-segura-1").unwrap();
        assert!(h.starts_with("$argon2id$"));
        assert!(verify_password("clave-segura-1", &h));
        assert!(!verify_password("otra-clave", &h));
        assert!(!verify_password("x", "no-es-phc"));
        assert_ne!(h, hash_password("clave-segura-1").unwrap(), "sal aleatoria");
    }

    #[test]
    fn reglas_de_contrasena_y_usuario() {
        assert!(hash_password("corta").is_err());
        assert_eq!(validate_username(" Maria.Lopez ").unwrap(), "maria.lopez");
        assert!(validate_username("maría").is_err());
        assert!(validate_username("a").is_err());
    }

    #[test]
    fn permisos_del_actor() {
        let a = Actor {
            user_id: 1,
            uid: "u".into(),
            username: "v".into(),
            display_name: "V".into(),
            roles: vec!["ventas".into()],
            permissions: ["ventas.crear".to_string()].into_iter().collect(),
        };
        assert!(a.require("ventas.crear").is_ok());
        let e = a.require("usuarios.gestionar").unwrap_err();
        assert_eq!(e.to_string(), "no tienes permiso para gestionar usuarios");
    }
}
