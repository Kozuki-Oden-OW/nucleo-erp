//! Claves de datos por empresa (Blueprint §10.1).
//!
//! - Cada empresa tiene una clave aleatoria de 256 bits.
//! - Se guarda en el almacén seguro del sistema operativo (feature `os-keyring`).
//! - Al crear la empresa se entrega una **clave de recuperación** imprimible: sin ella,
//!   si se pierde el almacén (Windows reinstalado), los datos no se pueden recuperar.
//!
//! Pendiente Fase 13: envolver además la clave con la contraseña del administrador (Argon2id).

use crate::{AppError, AppResult};
use data_encoding::BASE32_NOPAD;
use nucleo_db::DataKey;
use std::collections::HashMap;
use std::sync::Mutex;

pub trait KeyStore: Send + Sync {
    fn put(&self, company_uid: &str, key: &DataKey) -> AppResult<()>;
    fn get(&self, company_uid: &str) -> AppResult<DataKey>;
    fn delete(&self, company_uid: &str) -> AppResult<()>;
}

pub fn generate_key() -> AppResult<DataKey> {
    let mut b = [0u8; 32];
    getrandom::fill(&mut b).map_err(|e| AppError::KeyStore(e.to_string()))?;
    Ok(DataKey::from_bytes(b))
}

/// Clave de recuperación legible: grupos de 4 caracteres base32 separados por guiones.
pub fn recovery_key(key: &DataKey) -> String {
    let s = BASE32_NOPAD.encode(key.expose_bytes());
    s.as_bytes()
        .chunks(4)
        .map(|c| std::str::from_utf8(c).unwrap_or_default())
        .collect::<Vec<_>>()
        .join("-")
}

pub fn key_from_recovery(input: &str) -> Option<DataKey> {
    let clean: String = input
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_uppercase())
        .collect();
    let bytes = BASE32_NOPAD.decode(clean.as_bytes()).ok()?;
    let arr: [u8; 32] = bytes.try_into().ok()?;
    Some(DataKey::from_bytes(arr))
}

/// Almacén en memoria (pruebas).
#[derive(Default)]
pub struct MemoryKeyStore(Mutex<HashMap<String, String>>);

impl KeyStore for MemoryKeyStore {
    fn put(&self, uid: &str, key: &DataKey) -> AppResult<()> {
        let encoded = BASE32_NOPAD.encode(key.expose_bytes());
        self.0
            .lock()
            .map_err(|e| AppError::KeyStore(e.to_string()))?
            .insert(uid.into(), encoded);
        Ok(())
    }
    fn get(&self, uid: &str) -> AppResult<DataKey> {
        let map = self
            .0
            .lock()
            .map_err(|e| AppError::KeyStore(e.to_string()))?;
        let s = map
            .get(uid)
            .ok_or_else(|| AppError::KeyStore("no hay clave para esta empresa".into()))?;
        key_from_recovery(s).ok_or_else(|| AppError::KeyStore("clave dañada".into()))
    }
    fn delete(&self, uid: &str) -> AppResult<()> {
        self.0
            .lock()
            .map_err(|e| AppError::KeyStore(e.to_string()))?
            .remove(uid);
        Ok(())
    }
}

#[cfg(feature = "os-keyring")]
pub use os::OsKeyStore;

#[cfg(feature = "os-keyring")]
mod os {
    use super::*;

    /// Almacén seguro del sistema operativo (Windows Credential Manager en Windows).
    pub struct OsKeyStore {
        service: String,
    }

    impl OsKeyStore {
        pub fn new(service: impl Into<String>) -> Self {
            Self {
                service: service.into(),
            }
        }
        fn entry(&self, uid: &str) -> AppResult<keyring::Entry> {
            keyring::Entry::new(&self.service, uid).map_err(|e| AppError::KeyStore(e.to_string()))
        }
    }

    impl KeyStore for OsKeyStore {
        fn put(&self, uid: &str, key: &DataKey) -> AppResult<()> {
            let s = BASE32_NOPAD.encode(key.expose_bytes());
            self.entry(uid)?
                .set_password(&s)
                .map_err(|e| AppError::KeyStore(e.to_string()))
        }
        fn get(&self, uid: &str) -> AppResult<DataKey> {
            let s = self
                .entry(uid)?
                .get_password()
                .map_err(|e| AppError::KeyStore(e.to_string()))?;
            key_from_recovery(&s).ok_or_else(|| AppError::KeyStore("clave dañada".into()))
        }
        fn delete(&self, uid: &str) -> AppResult<()> {
            self.entry(uid)?
                .delete_credential()
                .map_err(|e| AppError::KeyStore(e.to_string()))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recuperacion_ida_y_vuelta() {
        let k = DataKey::from_bytes([42u8; 32]);
        let r = recovery_key(&k);
        assert_eq!(r.split('-').count(), 13);
        let back = key_from_recovery(&r.to_lowercase().replace('-', " ")).unwrap();
        assert_eq!(back.expose_bytes(), k.expose_bytes());
        assert!(key_from_recovery("ABCD-EFGH").is_none());
    }

    #[test]
    fn claves_aleatorias_distintas() {
        let a = generate_key().unwrap();
        let b = generate_key().unwrap();
        assert_ne!(a.expose_bytes(), b.expose_bytes());
    }
}
