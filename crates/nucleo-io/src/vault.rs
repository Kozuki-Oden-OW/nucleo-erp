//! Bóveda de documentos adjuntos (Blueprint §10.1): cada archivo se guarda cifrado con la
//! clave de datos de la empresa, con cifrado autenticado AES-256-GCM.
//!
//! Formato de cada archivo en disco:
//! `NUCLEOAT` (8 bytes) · versión (1 byte = 1) · nonce (12 bytes) · texto cifrado + etiqueta (16 bytes).
//! El encabezado se autentica como datos adicionales: cambiar cualquier byte invalida el archivo.
//!
//! La bóveda no usa la clave de la base directamente: deriva dos subclaves (cifrado y nombres).
//! El nombre del archivo en disco es una huella **con clave** del contenido, de modo que quien
//! vea la carpeta no puede comprobar si un archivo conocido está guardado ahí.

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

const MAGIC: &[u8; 8] = b"NUCLEOAT";
const VERSION: u8 = 1;
const HEADER: usize = 8 + 1 + 12;
/// Tamaño máximo de un adjunto (los documentos de una pyme rara vez superan unos pocos MB).
pub const MAX_BYTES: u64 = 50 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum VaultError {
    #[error("el archivo supera el máximo de 50 MB")]
    TooLarge,
    #[error("el documento guardado está dañado o no corresponde a esta empresa")]
    Corrupt,
    #[error("error de archivo: {0}")]
    Io(#[from] std::io::Error),
}

pub type VaultResult<T> = Result<T, VaultError>;

/// Huella SHA-256 en hexadecimal (identifica el contenido y permite no guardar duplicados).
pub fn sha256_hex(data: &[u8]) -> String {
    hex::encode(Sha256::digest(data))
}

pub fn encrypt(key: &[u8; 32], plain: &[u8]) -> VaultResult<Vec<u8>> {
    let mut nonce = [0u8; 12];
    getrandom::fill(&mut nonce)
        .map_err(|e| VaultError::Io(std::io::Error::other(e.to_string())))?;
    let mut header = Vec::with_capacity(HEADER);
    header.extend_from_slice(MAGIC);
    header.push(VERSION);
    header.extend_from_slice(&nonce);
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| VaultError::Corrupt)?;
    let ct = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: plain,
                aad: &header,
            },
        )
        .map_err(|_| VaultError::Corrupt)?;
    let mut out = header;
    out.extend_from_slice(&ct);
    Ok(out)
}

pub fn decrypt(key: &[u8; 32], blob: &[u8]) -> VaultResult<Vec<u8>> {
    if blob.len() < HEADER + 16 || &blob[..8] != MAGIC || blob[8] != VERSION {
        return Err(VaultError::Corrupt);
    }
    let (header, ct) = blob.split_at(HEADER);
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| VaultError::Corrupt)?;
    cipher
        .decrypt(
            Nonce::from_slice(&header[9..]),
            Payload {
                msg: ct,
                aad: header,
            },
        )
        .map_err(|_| VaultError::Corrupt)
}

/// Subclave de 32 bytes para un uso específico (separación de dominios). La clave de datos ya
/// es aleatoria y uniforme, por lo que SHA-256 con una etiqueta basta como derivación.
fn subkey(key: &[u8; 32], label: &str) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(b"NUCLEO/");
    h.update(label.as_bytes());
    h.update(b"/v1\0");
    h.update(key);
    h.finalize().into()
}

/// Nombre en disco del contenido con huella `sha256` (no revela la huella).
fn stored_name(key: &[u8; 32], sha256: &str) -> String {
    let mut h = Sha256::new();
    h.update(subkey(key, "vault-name"));
    h.update(sha256.as_bytes());
    hex::encode(h.finalize())
}

/// Ruta del archivo cifrado dentro de la carpeta de documentos: `ab/abcdef….bin`.
pub fn blob_path(documents_dir: &Path, name: &str) -> PathBuf {
    documents_dir.join(&name[..2]).join(format!("{name}.bin"))
}

/// Guarda el contenido cifrado (si ya existe el mismo contenido, no lo duplica).
/// Escritura atómica: archivo temporal y luego renombrado.
pub fn store(documents_dir: &Path, key: &[u8; 32], plain: &[u8]) -> VaultResult<String> {
    if plain.len() as u64 > MAX_BYTES {
        return Err(VaultError::TooLarge);
    }
    let sha = sha256_hex(plain);
    let path = blob_path(documents_dir, &stored_name(key, &sha));
    if path.exists() {
        return Ok(sha);
    }
    let dir = path.parent().ok_or(VaultError::Corrupt)?;
    std::fs::create_dir_all(dir)?;
    let blob = encrypt(&subkey(key, "vault-enc"), plain)?;
    let mut tmp = tempfile::NamedTempFile::new_in(dir)?;
    std::io::Write::write_all(&mut tmp, &blob)?;
    tmp.as_file().sync_all()?;
    tmp.persist(&path).map_err(|e| VaultError::Io(e.error))?;
    Ok(sha)
}

/// Lee y descifra; verifica además que el contenido coincida con su huella.
pub fn load(documents_dir: &Path, key: &[u8; 32], sha256: &str) -> VaultResult<Vec<u8>> {
    if sha256.len() != 64 || !sha256.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(VaultError::Corrupt);
    }
    let blob = std::fs::read(blob_path(documents_dir, &stored_name(key, sha256)))?;
    let plain = decrypt(&subkey(key, "vault-enc"), &blob)?;
    if sha256_hex(&plain) != sha256 {
        return Err(VaultError::Corrupt);
    }
    Ok(plain)
}

#[cfg(test)]
mod tests {
    use super::*;

    const K: [u8; 32] = [9; 32];

    #[test]
    fn cifra_y_descifra() {
        let blob = encrypt(&K, b"factura proveedor").unwrap();
        assert!(
            !blob.windows(7).any(|w| w == b"factura"),
            "no debe verse en claro"
        );
        assert_eq!(decrypt(&K, &blob).unwrap(), b"factura proveedor");
    }

    #[test]
    fn clave_o_bytes_alterados_fallan() {
        let mut blob = encrypt(&K, b"hola").unwrap();
        assert!(matches!(decrypt(&[1; 32], &blob), Err(VaultError::Corrupt)));
        let last = blob.len() - 1;
        blob[last] ^= 1;
        assert!(matches!(decrypt(&K, &blob), Err(VaultError::Corrupt)));
        blob[last] ^= 1;
        blob[9] ^= 1; // nonce (autenticado)
        assert!(matches!(decrypt(&K, &blob), Err(VaultError::Corrupt)));
    }

    #[test]
    fn guarda_sin_duplicar_y_recupera() {
        let dir = tempfile::tempdir().unwrap();
        let a = store(dir.path(), &K, b"contrato").unwrap();
        let b = store(dir.path(), &K, b"contrato").unwrap();
        assert_eq!(a, b);
        assert_eq!(load(dir.path(), &K, &a).unwrap(), b"contrato");
        assert!(
            !blob_path(dir.path(), &a).exists(),
            "el nombre en disco no es la huella del contenido"
        );
        assert!(
            matches!(load(dir.path(), &[1; 32], &a), Err(VaultError::Io(_))),
            "otra empresa no encuentra ni descifra el archivo"
        );
        assert!(
            load(dir.path(), &K, "../../etc").is_err(),
            "huella inválida rechazada"
        );
    }
}
