//! Condiciones de una venta o factura interna: forma de pago con su detalle (tarjeta de débito o
//! crédito, banco y fecha de la transferencia, días de crédito), referencias como en el facturador
//! del SII (orden de compra, HES, nota de venta, guía de despacho…) y los datos del receptor tal
//! como quedan en el documento. Son datos del documento interno: no cambian montos ni estados.

use crate::sales_ops::parse_date;
use crate::{AppError, AppResult};
use serde::{Deserialize, Serialize};

/// Tipos de referencia (códigos del SII cuando existen).
pub const REFERENCE_KINDS: &[(&str, &str)] = &[
    ("801", "Orden de compra"),
    ("HES", "Hoja de entrada de servicio (HES)"),
    ("HEM", "Hoja de entrada de materiales (HEM)"),
    ("802", "Nota de pedido"),
    ("NV", "Nota de venta"),
    ("52", "Guía de despacho"),
    ("803", "Contrato"),
    ("805", "Proceso ChileCompra"),
    ("OTRO", "Otro"),
];

pub const PAYMENTS: &[&str] = &[
    "efectivo",
    "tarjeta",
    "transferencia",
    "credito",
    "cheque",
    "otro",
];

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct SaleReference {
    pub kind: String,
    pub folio: String,
    pub date: Option<String>,
    pub note: Option<String>,
}

/// Datos del receptor en el documento (se copian de la ficha del cliente y se pueden ajustar).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Receiver {
    pub rut: Option<String>,
    pub name: Option<String>,
    pub trade_name: Option<String>,
    pub activity: Option<String>,
    pub address: Option<String>,
    pub commune: Option<String>,
    pub city: Option<String>,
    pub region: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub contact: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct SaleTerms {
    /// "", "efectivo", "tarjeta", "transferencia", "credito", "cheque" u "otro".
    pub payment: String,
    /// Tarjeta: "debito" o "credito".
    pub card: Option<String>,
    /// Crédito: días de plazo.
    pub credit_days: Option<i64>,
    /// Crédito: vencimiento (si no viene, fecha del documento + días).
    pub due_date: Option<String>,
    /// Transferencia o cheque: banco.
    pub bank: Option<String>,
    /// Transferencia: fecha en que se hizo.
    pub transfer_date: Option<String>,
    /// N.º de operación, voucher o cheque.
    pub operation: Option<String>,
    pub references: Vec<SaleReference>,
    pub receiver: Option<Receiver>,
}

fn text(v: &Option<String>, max: usize, label: &str) -> AppResult<Option<String>> {
    match v.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        None => Ok(None),
        Some(s) if s.chars().count() > max => Err(AppError::Validation(format!(
            "{label} admite hasta {max} caracteres"
        ))),
        Some(s) => Ok(Some(s.to_string())),
    }
}

fn add_days(date: &str, days: i64) -> String {
    let d = crate::inventory_ops::date_ord(date).unwrap_or(0);
    crate::inventory_ops::date_str(d + days)
}

impl SaleTerms {
    /// Valida y limpia las condiciones. `issue_date` es la fecha del documento (AAAA-MM-DD).
    pub fn validated(&self, issue_date: &str) -> AppResult<SaleTerms> {
        let payment = self.payment.trim().to_lowercase();
        if !payment.is_empty() && !PAYMENTS.contains(&payment.as_str()) {
            return Err(AppError::Validation("forma de pago no válida".into()));
        }
        let card = match (payment.as_str(), self.card.as_deref()) {
            ("tarjeta", Some("credito")) => Some("credito".to_string()),
            ("tarjeta", _) => Some("debito".to_string()),
            _ => None,
        };
        let (credit_days, due_date) = if payment == "credito" {
            let days = self.credit_days.unwrap_or(30);
            if !(1..=365).contains(&days) {
                return Err(AppError::Validation(
                    "los días de crédito van de 1 a 365".into(),
                ));
            }
            let due = match self.due_date.as_deref().filter(|d| !d.is_empty()) {
                Some(d) => parse_date("el vencimiento", d)?,
                None => add_days(issue_date, days),
            };
            if due.as_str() < issue_date {
                return Err(AppError::Validation(
                    "el vencimiento no puede ser anterior al documento".into(),
                ));
            }
            (Some(days), Some(due))
        } else {
            (None, None)
        };
        let transfer_date = match (payment.as_str(), self.transfer_date.as_deref()) {
            ("transferencia", Some(d)) if !d.is_empty() => {
                Some(parse_date("la fecha de la transferencia", d)?)
            }
            _ => None,
        };
        let bank = if matches!(payment.as_str(), "transferencia" | "cheque") {
            text(&self.bank, 80, "el banco")?
        } else {
            None
        };
        let operation = if matches!(
            payment.as_str(),
            "tarjeta" | "transferencia" | "cheque" | "otro"
        ) {
            text(&self.operation, 60, "el número de operación")?
        } else {
            None
        };
        if self.references.len() > 20 {
            return Err(AppError::Validation(
                "un documento admite hasta 20 referencias".into(),
            ));
        }
        let mut references = Vec::new();
        for r in &self.references {
            let folio = r.folio.trim();
            if folio.is_empty() && r.date.as_deref().unwrap_or("").is_empty() {
                continue;
            }
            if !REFERENCE_KINDS.iter().any(|(k, _)| *k == r.kind) {
                return Err(AppError::Validation("tipo de referencia no válido".into()));
            }
            if folio.is_empty() || folio.chars().count() > 40 {
                return Err(AppError::Validation(
                    "cada referencia necesita su número o folio (hasta 40 caracteres)".into(),
                ));
            }
            references.push(SaleReference {
                kind: r.kind.clone(),
                folio: folio.to_string(),
                date: match r.date.as_deref().filter(|d| !d.is_empty()) {
                    Some(d) => Some(parse_date("la fecha de la referencia", d)?),
                    None => None,
                },
                note: text(&r.note, 120, "el detalle de la referencia")?,
            });
        }
        let receiver = match &self.receiver {
            None => None,
            Some(v) => {
                let rut = match v.rut.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
                    Some(r) => Some(
                        nucleo_domain::Rut::parse(r)
                            .map_err(|e| AppError::Validation(format!("RUT del receptor: {e}")))?
                            .compact(),
                    ),
                    None => None,
                };
                let r = Receiver {
                    rut,
                    name: text(&v.name, 200, "la razón social")?,
                    trade_name: text(&v.trade_name, 200, "el nombre de fantasía")?,
                    activity: text(&v.activity, 200, "el giro")?,
                    address: text(&v.address, 200, "la dirección")?,
                    commune: text(&v.commune, 80, "la comuna")?,
                    city: text(&v.city, 80, "la ciudad")?,
                    region: text(&v.region, 80, "la región")?,
                    email: text(&v.email, 254, "el correo")?,
                    phone: text(&v.phone, 40, "el teléfono")?,
                    contact: text(&v.contact, 120, "el contacto")?,
                };
                (r != Receiver::default()).then_some(r)
            }
        };
        Ok(SaleTerms {
            payment,
            card,
            credit_days,
            due_date,
            bank,
            transfer_date,
            operation,
            references,
            receiver,
        })
    }

    /// Medio de pago en palabras para un cobro al contado ("Tarjeta de débito"…).
    pub fn method_label(&self) -> Option<&'static str> {
        match (self.payment.as_str(), self.card.as_deref()) {
            ("efectivo", _) => Some("Efectivo"),
            ("tarjeta", Some("credito")) => Some("Tarjeta de crédito"),
            ("tarjeta", _) => Some("Tarjeta de débito"),
            ("transferencia", _) => Some("Transferencia"),
            ("cheque", _) => Some("Cheque"),
            ("otro", _) => Some("Otro"),
            _ => None,
        }
    }

    /// Referencia para el cobro: banco y número de operación.
    pub fn payment_reference(&self) -> Option<String> {
        let parts: Vec<&str> = [self.bank.as_deref(), self.operation.as_deref()]
            .into_iter()
            .flatten()
            .collect();
        (!parts.is_empty()).then(|| parts.join(" · "))
    }

    pub fn is_empty(&self) -> bool {
        *self == SaleTerms::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credito_calcula_vencimiento_y_limpia() {
        let t = SaleTerms {
            payment: "credito".into(),
            credit_days: Some(30),
            bank: Some("No aplica".into()),
            references: vec![
                SaleReference {
                    kind: "801".into(),
                    folio: " 4500123 ".into(),
                    date: Some("2026-10-01".into()),
                    note: None,
                },
                SaleReference {
                    kind: "HES".into(),
                    folio: "".into(),
                    date: None,
                    note: None,
                },
            ],
            ..Default::default()
        }
        .validated("2026-10-10")
        .unwrap();
        assert_eq!(t.due_date.as_deref(), Some("2026-11-09"));
        assert_eq!(t.bank, None);
        assert_eq!(t.references.len(), 1);
        assert_eq!(t.references[0].folio, "4500123");
    }

    #[test]
    fn tarjeta_y_transferencia() {
        let t = SaleTerms {
            payment: "tarjeta".into(),
            card: Some("credito".into()),
            operation: Some("A1".into()),
            ..Default::default()
        }
        .validated("2026-10-10")
        .unwrap();
        assert_eq!(t.method_label(), Some("Tarjeta de crédito"));
        let t = SaleTerms {
            payment: "transferencia".into(),
            bank: Some("Banco Estado".into()),
            transfer_date: Some("2026-10-09".into()),
            operation: Some("998".into()),
            ..Default::default()
        }
        .validated("2026-10-10")
        .unwrap();
        assert_eq!(t.payment_reference().as_deref(), Some("Banco Estado · 998"));
        assert!(
            SaleTerms {
                payment: "trueque".into(),
                ..Default::default()
            }
            .validated("2026-10-10")
            .is_err()
        );
    }
}
