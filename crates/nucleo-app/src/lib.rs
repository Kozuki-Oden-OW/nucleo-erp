//! # nucleo-app
//!
//! Casos de uso de NÚCLEO ERP. Cada operación que modifica datos corre en **una sola
//! transacción** que incluye el cambio y su registro de auditoría (Blueprint §2.3).

pub mod auth;
pub mod company;
pub mod core_ops;
pub mod error;
pub mod keys;
pub mod purchase_ops;
pub mod registry;
pub mod sales_ops;

pub use company::{CompanySession, NewCustomer};
pub use error::{AppError, AppResult};
pub use keys::{KeyStore, MemoryKeyStore};
/// Reexportado para la capa de escritorio (tipos de filas e informes).
pub use nucleo_db;
pub use registry::{AppService, BusinessProfile, CompanyInfo, CreatedCompany};

/// Versión de la aplicación (se guarda en cada respaldo).
pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
