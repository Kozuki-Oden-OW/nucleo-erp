//! Paquetes normativos firmados (`.nucleo-rules`).
//!
//! ```json
//! { "format": "nucleo-rules", "format_version": 1,
//!   "key_id": "…", "signature": "<hex Ed25519>", "package": { …RuleSet… } }
//! ```
//!
//! La firma cubre la serialización canónica de `package` (la que produce `serde_json` a partir
//! de la estructura), así que espacios o saltos de línea en el archivo no la invalidan, pero
//! cualquier cambio en un valor, vigencia o fuente sí.

use crate::{RuleError, RuleSet};
use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const FORMAT: &str = "nucleo-rules";

/// Claves públicas de confianza (hex) que acepta esta versión de NÚCLEO.
/// Vacío hasta que el mantenedor genere la clave oficial (`rules keygen`, Fase 11). La clave
/// privada se guarda fuera del repositorio.
pub const TRUSTED_KEYS_HEX: &[&str] = &[];

/// Claves de confianza listas para `verify`.
pub fn trusted_keys() -> Vec<VerifyingKey> {
    TRUSTED_KEYS_HEX
        .iter()
        .filter_map(|h| hex::decode(h).ok())
        .filter_map(|b| <[u8; 32]>::try_from(b).ok())
        .filter_map(|b| VerifyingKey::from_bytes(&b).ok())
        .collect()
}
pub const FORMAT_VERSION: u16 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignedPackage {
    pub format: String,
    pub format_version: u16,
    pub key_id: String,
    pub signature: String,
    pub package: RuleSet,
}

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum SignatureError {
    #[error("el archivo no es un paquete normativo de NÚCLEO")]
    NotAPackage,
    #[error("el paquete usa un formato más nuevo ({0})")]
    NewerFormat(u16),
    #[error("el paquete está firmado con una clave que esta versión no reconoce ({0})")]
    UnknownKey(String),
    #[error("la firma no es válida: el paquete fue modificado o está dañado")]
    InvalidSignature,
    #[error(transparent)]
    Rules(#[from] RuleError),
}

/// Identificador corto de una clave pública: primeros 16 hex de su SHA-256.
pub fn key_id(key: &VerifyingKey) -> String {
    hex::encode(Sha256::digest(key.as_bytes()))[..16].to_string()
}

fn canonical(set: &RuleSet) -> Vec<u8> {
    serde_json::to_vec(set).unwrap_or_default()
}

/// Firma un paquete (herramienta del mantenedor; la clave privada nunca va en la aplicación).
pub fn sign(set: RuleSet, key: &SigningKey) -> SignedPackage {
    let signature = key.sign(&canonical(&set));
    SignedPackage {
        format: FORMAT.into(),
        format_version: FORMAT_VERSION,
        key_id: key_id(&key.verifying_key()),
        signature: hex::encode(signature.to_bytes()),
        package: set,
    }
}

/// Verifica formato, clave de confianza y firma. Devuelve el paquete listo para `RuleBook::add`.
pub fn verify(json: &str, trusted: &[VerifyingKey]) -> Result<RuleSet, SignatureError> {
    let pkg: SignedPackage = serde_json::from_str(json).map_err(|_| SignatureError::NotAPackage)?;
    if pkg.format != FORMAT {
        return Err(SignatureError::NotAPackage);
    }
    if pkg.format_version > FORMAT_VERSION {
        return Err(SignatureError::NewerFormat(pkg.format_version));
    }
    let key = trusted
        .iter()
        .find(|k| key_id(k) == pkg.key_id)
        .ok_or_else(|| SignatureError::UnknownKey(pkg.key_id.clone()))?;
    let sig_bytes: [u8; 64] = hex::decode(&pkg.signature)
        .ok()
        .and_then(|b| b.try_into().ok())
        .ok_or(SignatureError::InvalidSignature)?;
    key.verify_strict(&canonical(&pkg.package), &Signature::from_bytes(&sig_bytes))
        .map_err(|_| SignatureError::InvalidSignature)?;
    Ok(pkg.package)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{RuleBook, RuleData, RuleValue};
    use time::macros::date;

    fn key(seed: u8) -> SigningKey {
        SigningKey::from_bytes(&[seed; 32])
    }

    fn set() -> RuleSet {
        RuleSet {
            code: "EJEMPLO-2026.1".into(),
            publisher: "pruebas".into(),
            values: vec![RuleValue {
                code: "TASA_EJEMPLO".into(),
                data: RuleData::Decimal("0.10".parse().unwrap()),
                valid_from: date!(2026 - 01 - 01),
                valid_until: None,
                source: "Fuente ficticia de prueba".into(),
                notes: None,
            }],
        }
    }

    #[test]
    fn firma_y_verifica() {
        let k = key(1);
        let json = serde_json::to_string_pretty(&sign(set(), &k)).unwrap();
        let verified = verify(&json, &[k.verifying_key()]).unwrap();
        let mut book = RuleBook::new();
        book.add(verified).unwrap();
        assert!(book.decimal("TASA_EJEMPLO", date!(2026 - 10 - 05)).is_ok());
    }

    #[test]
    fn detecta_valor_alterado() {
        let k = key(1);
        let json = serde_json::to_string(&sign(set(), &k))
            .unwrap()
            .replace("0.10", "0.11");
        assert_eq!(
            verify(&json, &[k.verifying_key()]).unwrap_err(),
            SignatureError::InvalidSignature
        );
    }

    #[test]
    fn rechaza_clave_desconocida_y_basura() {
        let json = serde_json::to_string(&sign(set(), &key(1))).unwrap();
        assert!(matches!(
            verify(&json, &[key(2).verifying_key()]),
            Err(SignatureError::UnknownKey(_))
        ));
        assert_eq!(
            verify("{}", &[key(1).verifying_key()]).unwrap_err(),
            SignatureError::NotAPackage
        );
    }

    #[test]
    fn el_formato_del_archivo_no_afecta_la_firma() {
        let k = key(3);
        let compact = serde_json::to_string(&sign(set(), &k)).unwrap();
        let pretty = serde_json::to_string_pretty(
            &serde_json::from_str::<serde_json::Value>(&compact).unwrap(),
        )
        .unwrap();
        assert!(verify(&pretty, &[k.verifying_key()]).is_ok());
    }
}
