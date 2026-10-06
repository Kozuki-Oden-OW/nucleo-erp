use nucleo_db::DbError;
use nucleo_io::erpbackup::BackupError;
use nucleo_io::vault::VaultError;

/// Errores de la aplicación, con mensajes pensados para el usuario final.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Validation(String),
    #[error("no se encontró {0}")]
    NotFound(String),
    #[error(transparent)]
    Db(#[from] DbError),
    #[error(transparent)]
    Backup(#[from] BackupError),
    #[error("no se pudo acceder al almacén seguro de claves: {0}")]
    KeyStore(String),
    #[error("error de archivo: {0}")]
    Io(#[from] std::io::Error),
    #[error("no tienes permiso para {0}")]
    Forbidden(String),
    #[error("inicia sesión para continuar")]
    LoginRequired,
    #[error("usuario o contraseña incorrectos")]
    BadCredentials,
    #[error("demasiados intentos fallidos: espera {0} minutos y vuelve a intentar")]
    Locked(i64),
    #[error(transparent)]
    Vault(#[from] VaultError),
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        AppError::Db(DbError::Sqlite(e))
    }
}

impl AppError {
    /// Código estable para la interfaz (no cambia aunque cambie el texto).
    pub fn code(&self) -> &'static str {
        match self {
            AppError::Validation(_) => "validacion",
            AppError::NotFound(_) => "no_encontrado",
            AppError::Db(DbError::WrongKeyOrNotEncrypted) => "clave_incorrecta",
            AppError::Db(DbError::Duplicate(_)) => "duplicado",
            AppError::Db(DbError::NetworkPath) => "ruta_de_red",
            AppError::Db(DbError::NewerSchema { .. }) => "version_mas_nueva",
            AppError::Db(DbError::Rule(_)) => "validacion",
            AppError::Db(_) => "base_de_datos",
            AppError::Backup(BackupError::WrongPasswordOrCorrupt) => "respaldo_clave_incorrecta",
            AppError::Backup(BackupError::WeakPassword) => "respaldo_clave_debil",
            AppError::Backup(_) => "respaldo",
            AppError::KeyStore(_) => "almacen_claves",
            AppError::Io(_) => "archivo",
            AppError::Forbidden(_) => "sin_permiso",
            AppError::LoginRequired => "inicio_sesion",
            AppError::BadCredentials => "credenciales",
            AppError::Locked(_) => "bloqueado",
            AppError::Vault(_) => "documento",
        }
    }
}

pub type AppResult<T> = Result<T, AppError>;
