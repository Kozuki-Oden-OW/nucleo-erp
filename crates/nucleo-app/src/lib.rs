//! # nucleo-app
//!
//! Casos de uso de NÚCLEO ERP. Cada operación que modifica datos corre en **una sola
//! transacción** que incluye el cambio y su registro de auditoría (Blueprint §2.3).

pub mod accounting_ops;
pub mod auth;
pub mod bank_ops;
pub mod catalog_ops;
pub mod comex_ops;
pub mod company;
pub mod core_ops;
pub mod credit_ops;
pub mod dispatch_ops;
pub mod error;
pub mod f22_ops;
pub mod f29_ops;
pub mod finance_ops;
pub mod gastos_ops;
pub mod insight_ops;
pub mod inventory_ops;
pub mod keys;
pub mod payroll_ops;
pub mod promo_ops;
pub mod purchase_ops;
pub mod registry;
pub mod report_ops;
pub mod sale_terms;
pub mod sales_ops;
pub mod ship_ops;
pub mod sync_ops;

pub use company::{CompanySession, NewCustomer};
pub use error::{AppError, AppResult};
pub use keys::{KeyStore, MemoryKeyStore};
/// Reexportado para la capa de escritorio (tipos de filas e informes).
pub use nucleo_db;
pub use registry::{AppService, BusinessProfile, CompanyInfo, CreatedCompany};

/// Versión de la aplicación (se guarda en cada respaldo).
pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
