//! Formato de respaldo `.erpbackup` v1.
//!
//! ```text
//! ┌──────────────┬─────────┬────────────┬────────────┬──────────────────────────────────┐
//! │ "NUCLEOBK"   │ versión │ sal        │ nonce      │ AES-256-GCM( tar del contenido ) │
//! │ 8 bytes      │ u16 LE  │ 16 bytes   │ 12 bytes   │ (el encabezado va como AAD)       │
//! └──────────────┴─────────┴────────────┴────────────┴──────────────────────────────────┘
//! ```
//!
//! - La clave del contenedor se deriva de la **contraseña del respaldo** con Argon2id.
//! - El contenido (tar) incluye `manifest.json` con el SHA-256 de cada archivo.
//! - La clave de datos de la empresa viaja **dentro** del contenedor cifrado, para poder
//!   restaurar en otro computador solo con la contraseña del respaldo.
//! - Limitación conocida de la Fase 1: el contenedor se arma en memoria. El cifrado por
//!   bloques (streaming) para respaldos grandes queda para la Fase 13 (ver SECURITY.md).

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use argon2::{Algorithm, Argon2, Params, Version};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::io::Read;
use std::path::{Component, Path, PathBuf};

pub const MAGIC: &[u8; 8] = b"NUCLEOBK";
pub const FORMAT_VERSION: u16 = 1;
pub const FORMAT_NAME: &str = "nucleo-erpbackup";
pub const MIN_PASSWORD_LEN: usize = 8;
const HEADER_LEN: usize = 8 + 2 + 16 + 12;

/// Ruta interna del archivo de la base y de la clave dentro del respaldo.
pub const DB_ENTRY: &str = "company.db";
pub const KEY_ENTRY: &str = "keys/data.key";

#[derive(Debug, thiserror::Error)]
pub enum BackupError {
    #[error("la contraseña del respaldo debe tener al menos {MIN_PASSWORD_LEN} caracteres")]
    WeakPassword,
    #[error("el archivo no es un respaldo de NÚCLEO")]
    NotABackup,
    #[error("este respaldo usa el formato {0}, más nuevo que el que soporta esta versión")]
    NewerFormat(u16),
    #[error("contraseña incorrecta o archivo dañado")]
    WrongPasswordOrCorrupt,
    #[error("el respaldo está dañado: {0}")]
    Corrupt(String),
    #[error("error de archivo: {0}")]
    Io(#[from] std::io::Error),
}

pub type BackupResult<T> = Result<T, BackupError>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileEntry {
    pub path: String,
    pub sha256: String,
    pub size: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Manifest {
    pub format: String,
    pub format_version: u16,
    pub app_version: String,
    pub schema_version: i64,
    pub company_uid: String,
    pub company_name: String,
    pub created_at: String,
    /// Conteo de filas por tabla al momento del respaldo.
    pub counts: BTreeMap<String, i64>,
    pub files: Vec<FileEntry>,
}

/// Datos para crear un respaldo. Los archivos ya deben existir en disco.
pub struct BackupInput<'a> {
    pub db_snapshot: &'a Path,
    pub data_key: &'a [u8; 32],
    /// Carpeta de documentos adjuntos (opcional).
    pub documents_dir: Option<&'a Path>,
    pub settings_json: Option<String>,
    pub app_version: &'a str,
    pub schema_version: i64,
    pub company_uid: &'a str,
    pub company_name: &'a str,
    pub created_at: &'a str,
    pub counts: BTreeMap<String, i64>,
}

fn random<const N: usize>() -> BackupResult<[u8; N]> {
    let mut b = [0u8; N];
    getrandom::fill(&mut b).map_err(|e| BackupError::Io(std::io::Error::other(e.to_string())))?;
    Ok(b)
}

fn derive_key(password: &str, salt: &[u8; 16]) -> BackupResult<[u8; 32]> {
    // Argon2id: 64 MiB, 3 pasadas, 1 hilo.
    let params =
        Params::new(64 * 1024, 3, 1, Some(32)).map_err(|e| BackupError::Corrupt(e.to_string()))?;
    let mut out = [0u8; 32];
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(password.as_bytes(), salt, &mut out)
        .map_err(|e| BackupError::Corrupt(e.to_string()))?;
    Ok(out)
}

fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn collect_files(
    base: &Path,
    dir: &Path,
    prefix: &str,
    out: &mut Vec<(String, PathBuf)>,
) -> std::io::Result<()> {
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let rel = path
            .strip_prefix(base)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");
        if entry.file_type()?.is_dir() {
            collect_files(base, &path, prefix, out)?;
        } else {
            out.push((format!("{prefix}/{rel}"), path));
        }
    }
    Ok(())
}

fn append(tar: &mut tar::Builder<Vec<u8>>, name: &str, data: &[u8]) -> BackupResult<()> {
    let mut h = tar::Header::new_gnu();
    h.set_size(data.len() as u64);
    h.set_mode(0o600);
    h.set_cksum();
    tar.append_data(&mut h, name, data)?;
    Ok(())
}

/// Crea el respaldo en `out_path`. Devuelve el manifiesto escrito.
pub fn create(input: &BackupInput<'_>, password: &str, out_path: &Path) -> BackupResult<Manifest> {
    if password.chars().count() < MIN_PASSWORD_LEN {
        return Err(BackupError::WeakPassword);
    }
    let mut contents: Vec<(String, Vec<u8>)> = vec![
        (DB_ENTRY.into(), std::fs::read(input.db_snapshot)?),
        (KEY_ENTRY.into(), hex::encode(input.data_key).into_bytes()),
    ];
    if let Some(s) = &input.settings_json {
        contents.push(("settings.json".into(), s.clone().into_bytes()));
    }
    if let Some(dir) = input.documents_dir.filter(|d| d.exists()) {
        let mut files = Vec::new();
        collect_files(dir, dir, "documents", &mut files)?;
        files.sort();
        for (name, path) in files {
            contents.push((name, std::fs::read(path)?));
        }
    }
    let manifest = Manifest {
        format: FORMAT_NAME.into(),
        format_version: FORMAT_VERSION,
        app_version: input.app_version.into(),
        schema_version: input.schema_version,
        company_uid: input.company_uid.into(),
        company_name: input.company_name.into(),
        created_at: input.created_at.into(),
        counts: input.counts.clone(),
        files: contents
            .iter()
            .map(|(p, d)| FileEntry {
                path: p.clone(),
                sha256: sha256_hex(d),
                size: d.len() as u64,
            })
            .collect(),
    };
    let mut tar = tar::Builder::new(Vec::new());
    let manifest_json =
        serde_json::to_vec_pretty(&manifest).map_err(|e| BackupError::Corrupt(e.to_string()))?;
    append(&mut tar, "manifest.json", &manifest_json)?;
    for (name, data) in &contents {
        append(&mut tar, name, data)?;
    }
    let plain = tar.into_inner()?;

    let salt: [u8; 16] = random()?;
    let nonce: [u8; 12] = random()?;
    let mut header = Vec::with_capacity(HEADER_LEN);
    header.extend_from_slice(MAGIC);
    header.extend_from_slice(&FORMAT_VERSION.to_le_bytes());
    header.extend_from_slice(&salt);
    header.extend_from_slice(&nonce);

    let key = derive_key(password, &salt)?;
    let cipher =
        Aes256Gcm::new_from_slice(&key).map_err(|e| BackupError::Corrupt(e.to_string()))?;
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: &plain,
                aad: &header,
            },
        )
        .map_err(|_| BackupError::Corrupt("no se pudo cifrar".into()))?;

    // Escritura atómica: archivo temporal en la misma carpeta y luego renombrar.
    let parent = out_path.parent().unwrap_or(Path::new("."));
    let mut tmp = tempfile::NamedTempFile::new_in(parent)?;
    std::io::Write::write_all(&mut tmp, &header)?;
    std::io::Write::write_all(&mut tmp, &ciphertext)?;
    tmp.as_file().sync_all()?;
    tmp.persist(out_path)
        .map_err(|e| BackupError::Io(e.error))?;
    Ok(manifest)
}

/// Respaldo abierto y verificado, extraído en una carpeta temporal.
pub struct OpenedBackup {
    pub manifest: Manifest,
    pub dir: tempfile::TempDir,
}

impl OpenedBackup {
    pub fn db_path(&self) -> PathBuf {
        self.dir.path().join(DB_ENTRY)
    }
    pub fn data_key_hex(&self) -> BackupResult<String> {
        Ok(std::fs::read_to_string(self.dir.path().join(KEY_ENTRY))?)
    }
    pub fn documents_dir(&self) -> PathBuf {
        self.dir.path().join("documents")
    }
}

/// Solo rutas relativas simples: protege contra respaldos manipulados ("../../Windows").
fn safe_relative(name: &Path) -> bool {
    !name.as_os_str().is_empty() && name.components().all(|c| matches!(c, Component::Normal(_)))
}

/// Descifra, valida formato, versión, rutas y checksums, y extrae en una carpeta temporal.
pub fn open(path: &Path, password: &str) -> BackupResult<OpenedBackup> {
    let bytes = std::fs::read(path)?;
    if bytes.len() < HEADER_LEN || &bytes[..8] != MAGIC {
        return Err(BackupError::NotABackup);
    }
    let version = u16::from_le_bytes([bytes[8], bytes[9]]);
    if version > FORMAT_VERSION {
        return Err(BackupError::NewerFormat(version));
    }
    let header = &bytes[..HEADER_LEN];
    let salt: [u8; 16] = bytes[10..26]
        .try_into()
        .map_err(|_| BackupError::NotABackup)?;
    let nonce = &bytes[26..38];
    let key = derive_key(password, &salt)?;
    let cipher =
        Aes256Gcm::new_from_slice(&key).map_err(|e| BackupError::Corrupt(e.to_string()))?;
    let plain = cipher
        .decrypt(
            Nonce::from_slice(nonce),
            Payload {
                msg: &bytes[HEADER_LEN..],
                aad: header,
            },
        )
        .map_err(|_| BackupError::WrongPasswordOrCorrupt)?;

    let dir = tempfile::tempdir()?;
    let mut archive = tar::Archive::new(plain.as_slice());
    let mut manifest: Option<Manifest> = None;
    let mut seen: BTreeMap<String, (String, u64)> = BTreeMap::new();
    for entry in archive.entries()? {
        let mut entry = entry?;
        let name = entry.path()?.into_owned();
        if !safe_relative(&name) {
            return Err(BackupError::Corrupt(format!(
                "ruta no permitida: {}",
                name.display()
            )));
        }
        let mut data = Vec::new();
        entry.read_to_end(&mut data)?;
        let key = name.to_string_lossy().replace('\\', "/");
        if key == "manifest.json" {
            manifest = Some(
                serde_json::from_slice(&data).map_err(|e| BackupError::Corrupt(e.to_string()))?,
            );
            continue;
        }
        seen.insert(key, (sha256_hex(&data), data.len() as u64));
        let dest = dir.path().join(&name);
        if let Some(p) = dest.parent() {
            std::fs::create_dir_all(p)?;
        }
        std::fs::write(dest, &data)?;
    }
    let manifest = manifest.ok_or_else(|| BackupError::Corrupt("falta manifest.json".into()))?;
    if manifest.format != FORMAT_NAME {
        return Err(BackupError::NotABackup);
    }
    if manifest.files.len() != seen.len() {
        return Err(BackupError::Corrupt(
            "la cantidad de archivos no coincide con el manifiesto".into(),
        ));
    }
    for f in &manifest.files {
        match seen.get(&f.path) {
            Some((h, s)) if *h == f.sha256 && *s == f.size => {}
            _ => {
                return Err(BackupError::Corrupt(format!(
                    "checksum inválido en {}",
                    f.path
                )));
            }
        }
    }
    for required in [DB_ENTRY, KEY_ENTRY] {
        if !seen.contains_key(required) {
            return Err(BackupError::Corrupt(format!("falta {required}")));
        }
    }
    Ok(OpenedBackup { manifest, dir })
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture {
        dir: tempfile::TempDir,
        snap: PathBuf,
        docs: PathBuf,
    }

    impl Fixture {
        fn new() -> Self {
            let dir = tempfile::tempdir().unwrap();
            std::fs::write(dir.path().join("snap.db"), b"contenido-de-base-simulado").unwrap();
            let docs = dir.path().join("docs/ab");
            std::fs::create_dir_all(&docs).unwrap();
            std::fs::write(docs.join("factura.pdf"), b"%PDF-1.7 simulado").unwrap();
            let snap = dir.path().join("snap.db");
            let docs = dir.path().join("docs");
            Self { dir, snap, docs }
        }
        fn input(&self) -> BackupInput<'_> {
            BackupInput {
                db_snapshot: &self.snap,
                data_key: &[9u8; 32],
                documents_dir: Some(&self.docs),
                settings_json: Some("{\"tema\":\"oscuro\"}".into()),
                app_version: "0.1.0",
                schema_version: 2,
                company_uid: "uid-1",
                company_name: "Mi Negocio",
                created_at: "2026-10-05T12:00:00Z",
                counts: BTreeMap::from([("customers".into(), 3)]),
            }
        }
        fn out(&self) -> PathBuf {
            self.dir.path().join("empresa_2026-10-05.erpbackup")
        }
    }

    #[test]
    fn ida_y_vuelta() {
        let f = Fixture::new();
        let m = create(&f.input(), "clave-segura", &f.out()).unwrap();
        assert_eq!(m.files.len(), 4); // base, clave, settings, 1 documento
        let opened = open(&f.out(), "clave-segura").unwrap();
        assert_eq!(opened.manifest, m);
        assert_eq!(
            std::fs::read(opened.db_path()).unwrap(),
            b"contenido-de-base-simulado"
        );
        assert_eq!(opened.data_key_hex().unwrap(), hex::encode([9u8; 32]));
        assert!(opened.documents_dir().join("ab/factura.pdf").exists());
    }

    #[test]
    fn el_contenido_no_se_ve_en_claro() {
        let f = Fixture::new();
        create(&f.input(), "clave-segura", &f.out()).unwrap();
        let bytes = std::fs::read(f.out()).unwrap();
        assert!(bytes.starts_with(MAGIC));
        for needle in [b"Mi Negocio".as_slice(), b"contenido-de-base", b"%PDF"] {
            assert!(!bytes.windows(needle.len()).any(|w| w == needle));
        }
    }

    #[test]
    fn contrasena_incorrecta_y_debil() {
        let f = Fixture::new();
        assert!(matches!(
            create(&f.input(), "corta", &f.out()),
            Err(BackupError::WeakPassword)
        ));
        create(&f.input(), "clave-segura", &f.out()).unwrap();
        assert!(matches!(
            open(&f.out(), "otra-clave"),
            Err(BackupError::WrongPasswordOrCorrupt)
        ));
    }

    #[test]
    fn detecta_archivo_alterado() {
        let f = Fixture::new();
        create(&f.input(), "clave-segura", &f.out()).unwrap();
        let mut bytes = std::fs::read(f.out()).unwrap();
        let last = bytes.len() - 1;
        bytes[last] ^= 0xFF;
        std::fs::write(f.out(), &bytes).unwrap();
        assert!(matches!(
            open(&f.out(), "clave-segura"),
            Err(BackupError::WrongPasswordOrCorrupt)
        ));
    }

    #[test]
    fn rechaza_archivos_ajenos_y_formatos_futuros() {
        let f = Fixture::new();
        std::fs::write(f.out(), b"no soy un respaldo").unwrap();
        assert!(matches!(
            open(&f.out(), "clave-segura"),
            Err(BackupError::NotABackup)
        ));
        create(&f.input(), "clave-segura", &f.out()).unwrap();
        let mut bytes = std::fs::read(f.out()).unwrap();
        bytes[8..10].copy_from_slice(&99u16.to_le_bytes());
        std::fs::write(f.out(), &bytes).unwrap();
        assert!(matches!(
            open(&f.out(), "clave-segura"),
            Err(BackupError::NewerFormat(99))
        ));
    }

    #[test]
    fn rutas_peligrosas() {
        assert!(safe_relative(Path::new("documents/ab/x.pdf")));
        assert!(!safe_relative(Path::new("../x")));
        assert!(!safe_relative(Path::new("/etc/passwd")));
    }
}
