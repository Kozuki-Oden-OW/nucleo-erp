//! Estados de una venta en tres ejes independientes (ADR-015, Blueprint §7.2):
//! comercial, pago y documentación externa.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CommercialState {
    Borrador,
    Cotizada,
    Aceptada,
    Efectuada,
    Cerrada,
    Anulada,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PaymentState {
    SinPago,
    Abonada,
    Pagada,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DocumentationState {
    NoAplica,
    Pendiente,
    Documentada,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
#[error("no se puede pasar de {from:?} a {to:?}")]
pub struct InvalidTransition {
    pub from: CommercialState,
    pub to: CommercialState,
}

impl CommercialState {
    /// Transiciones permitidas del eje comercial.
    pub fn can_transition_to(self, to: Self) -> bool {
        use CommercialState::*;
        matches!(
            (self, to),
            (Borrador, Cotizada | Aceptada | Efectuada | Anulada)
                | (Cotizada, Aceptada | Anulada)
                | (Aceptada, Efectuada | Anulada)
                | (Efectuada, Cerrada | Anulada)
        )
    }

    pub fn transition(self, to: Self) -> Result<Self, InvalidTransition> {
        if self.can_transition_to(to) {
            Ok(to)
        } else {
            Err(InvalidTransition { from: self, to })
        }
    }

    /// Una venta efectuada mueve stock, caja y cuentas por cobrar.
    pub fn affects_inventory_and_finance(self) -> bool {
        matches!(self, Self::Efectuada | Self::Cerrada)
    }
}

/// Estado de pago derivado de lo pagado vs. el total (en unidades mínimas).
pub fn payment_state(total_minor: i64, paid_minor: i64) -> PaymentState {
    if paid_minor <= 0 {
        PaymentState::SinPago
    } else if paid_minor < total_minor {
        PaymentState::Abonada
    } else {
        PaymentState::Pagada
    }
}

/// CERRADA automática: efectuada + pagada + (documentada o no aplica).
pub fn should_auto_close(c: CommercialState, p: PaymentState, d: DocumentationState) -> bool {
    c == CommercialState::Efectuada
        && p == PaymentState::Pagada
        && matches!(
            d,
            DocumentationState::Documentada | DocumentationState::NoAplica
        )
}

/// Etiqueta única para mostrar en pantalla, ej. "Pagada · Pendiente de documentación".
pub fn display_label(c: CommercialState, p: PaymentState, d: DocumentationState) -> String {
    use CommercialState::*;
    let base = match c {
        Borrador => "Borrador",
        Cotizada => "Cotizada",
        Aceptada => "Aceptada",
        Anulada => return "Anulada".into(),
        Cerrada => return "Cerrada".into(),
        Efectuada => match p {
            PaymentState::SinPago => "Efectuada",
            PaymentState::Abonada => "Abonada",
            PaymentState::Pagada => "Pagada",
        },
    };
    match (c, d) {
        (Efectuada, DocumentationState::Pendiente) => {
            format!("{base} · Pendiente de documentación")
        }
        (Efectuada, DocumentationState::Documentada) => format!("{base} · Documentada"),
        _ => base.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use CommercialState::*;

    #[test]
    fn flujo_normal() {
        let s = Borrador.transition(Cotizada).unwrap();
        let s = s.transition(Aceptada).unwrap();
        let s = s.transition(Efectuada).unwrap();
        assert!(s.affects_inventory_and_finance());
        assert_eq!(s.transition(Cerrada).unwrap(), Cerrada);
    }

    #[test]
    fn no_retrocede_ni_revive() {
        assert!(Efectuada.transition(Borrador).is_err());
        assert!(Anulada.transition(Efectuada).is_err());
        assert!(Cerrada.transition(Anulada).is_err());
    }

    #[test]
    fn pago_derivado() {
        assert_eq!(payment_state(1000, 0), PaymentState::SinPago);
        assert_eq!(payment_state(1000, 400), PaymentState::Abonada);
        assert_eq!(payment_state(1000, 1000), PaymentState::Pagada);
    }

    #[test]
    fn ejes_combinados_y_cierre() {
        assert_eq!(
            display_label(
                Efectuada,
                PaymentState::Pagada,
                DocumentationState::Pendiente
            ),
            "Pagada · Pendiente de documentación"
        );
        assert!(!should_auto_close(
            Efectuada,
            PaymentState::Pagada,
            DocumentationState::Pendiente
        ));
        assert!(should_auto_close(
            Efectuada,
            PaymentState::Pagada,
            DocumentationState::Documentada
        ));
        assert!(should_auto_close(
            Efectuada,
            PaymentState::Pagada,
            DocumentationState::NoAplica
        ));
    }
}
