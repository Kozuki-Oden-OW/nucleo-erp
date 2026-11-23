//! # nucleo-dte
//!
//! Documentos tributarios electrónicos del SII: arma el XML (factura, factura exenta, guía de
//! despacho, notas de crédito y débito), el timbre electrónico con el CAF, la firma XML con el
//! certificado del emisor y el sobre de envío (`EnvioDTE`). No usa la red: el envío al SII lo hace
//! `nucleo-app`. Ver `docs/SII_FACTURACION_PROPIA.md`.

pub mod caf;
pub mod crypto;
pub mod dte;
pub mod envio;
pub mod libro;
mod pdf417_tabla;
pub mod sii;
pub mod timbre;
pub mod xml;

pub use caf::Caf;
pub use crypto::Certificate;
pub use dte::{DescuentoGlobal, Detalle, Dte, Emisor, Receptor, Referencia, SignedDte, TipoDte};

#[derive(Debug, thiserror::Error)]
pub enum DteError {
    #[error("{0}")]
    Validation(String),
    #[error("CAF: {0}")]
    Caf(String),
    #[error("certificado: {0}")]
    Certificate(String),
    #[error("respuesta del SII: {0}")]
    Sii(String),
    #[error("criptografía: {0}")]
    Crypto(#[from] openssl::error::ErrorStack),
}

pub type DteResult<T> = Result<T, DteError>;

pub const NS_SII: &str = "http://www.sii.cl/SiiDte";
pub const NS_XSI: &str = "http://www.w3.org/2001/XMLSchema-instance";
/// RUT del SII (receptor de los envíos).
pub const RUT_SII: &str = "60803000-K";
