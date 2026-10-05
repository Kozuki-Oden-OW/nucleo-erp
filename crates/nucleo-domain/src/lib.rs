//! # nucleo-domain
//!
//! Núcleo de dominio de NÚCLEO ERP: tipos y cálculos **puros** (sin base de datos,
//! sin archivos, sin red). Todo cálculo con efecto contable, tributario o comercial
//! vive aquí y se prueba aquí.
//!
//! Regla de oro (Blueprint §5.4): este crate **no contiene valores normativos**
//! (tasas, topes, tablas). Los recibe como parámetros desde `nucleo-rules`.

pub mod customers;
pub mod inventory;
pub mod money;
pub mod numbering;
pub mod pricing;
pub mod rut;
pub mod sales_state;

pub use money::{CurrencyCode, Money, MoneyError, RoundingMode};
pub use rut::{Rut, RutError};
