//! Inteligencia de clientes: frecuencia de compra y riesgo de pérdida (§19.8).

use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

/// Mínimo de compras para calcular una frecuencia confiable.
pub const MIN_PURCHASES_FOR_FREQUENCY: usize = 3;

/// Intervalo promedio (días) entre compras, a partir de los días de cada compra
/// (por ejemplo, días desde una fecha base). Requiere al menos 3 compras.
pub fn average_interval_days(purchase_days: &[i64]) -> Option<Decimal> {
    if purchase_days.len() < MIN_PURCHASES_FOR_FREQUENCY {
        return None;
    }
    let mut days = purchase_days.to_vec();
    days.sort_unstable();
    let span = days[days.len() - 1] - days[0];
    if span <= 0 {
        return None;
    }
    Some(Decimal::from(span) / Decimal::from(days.len() as i64 - 1))
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChurnSignal {
    /// Cuántas veces su intervalo habitual lleva sin comprar (ej. 2,9).
    pub ratio: Decimal,
    pub explanation: String,
}

/// "Cliente en riesgo de pérdida": días sin comprar > factor × intervalo habitual.
pub fn churn_risk(
    avg_interval_days: Decimal,
    days_since_last: i64,
    factor: Decimal,
) -> Option<ChurnSignal> {
    if avg_interval_days <= Decimal::ZERO {
        return None;
    }
    let since = Decimal::from(days_since_last);
    if since <= factor * avg_interval_days {
        return None;
    }
    let ratio = (since / avg_interval_days).round_dp(1);
    Some(ChurnSignal {
        ratio,
        explanation: format!(
            "Compraba cada {} días en promedio y lleva {days_since_last} días sin comprar ({ratio} veces su intervalo habitual; umbral {factor}×).",
            avg_interval_days.round_dp(0)
        ),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    #[test]
    fn intervalo_promedio() {
        assert_eq!(average_interval_days(&[0, 25, 50, 75]), Some(dec!(25)));
        assert_eq!(average_interval_days(&[0, 25]), None); // pocas compras
    }

    #[test]
    fn golden_8_juan_perez_en_riesgo() {
        // "Juan Pérez compraba cada 25 días y lleva 72 días sin comprar".
        let s = churn_risk(dec!(25), 72, dec!(2)).expect("debe alertar");
        assert_eq!(s.ratio, dec!(2.9));
        assert!(s.explanation.contains("72 días"));
    }

    #[test]
    fn no_alerta_dentro_del_umbral() {
        assert_eq!(churn_risk(dec!(25), 40, dec!(2)), None);
    }
}
