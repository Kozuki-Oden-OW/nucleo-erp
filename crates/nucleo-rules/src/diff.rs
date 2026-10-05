//! Diferencias legibles entre la normativa vigente y un paquete nuevo, para que el usuario
//! confirme antes de activarlo (Blueprint §5.4).

use crate::{RuleBook, RuleData, RuleSet};
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RuleChange {
    Nuevo {
        code: String,
        valid_from: String,
        value: String,
        source: String,
    },
    Cambiado {
        code: String,
        valid_from: String,
        before: String,
        after: String,
        source: String,
    },
    SinCambios {
        code: String,
    },
}

impl RuleChange {
    /// Texto para mostrar: "IVA_TASA_GENERAL: 0.10 → 0.12 desde 2026-01-01 (fuente: …)".
    pub fn describe(&self) -> String {
        match self {
            Self::Nuevo {
                code,
                valid_from,
                value,
                source,
            } => {
                format!("{code}: nuevo valor {value} desde {valid_from} (fuente: {source})")
            }
            Self::Cambiado {
                code,
                valid_from,
                before,
                after,
                source,
            } => {
                format!("{code}: {before} → {after} desde {valid_from} (fuente: {source})")
            }
            Self::SinCambios { code } => format!("{code}: sin cambios"),
        }
    }
}

fn show(d: &RuleData) -> String {
    match d {
        RuleData::Decimal(v) => v.to_string(),
        RuleData::Integer(v) => v.to_string(),
        RuleData::Text(v) => v.clone(),
        RuleData::Table(_) => "tabla".into(),
    }
}

/// Compara cada valor del paquete con el vigente en el libro a la misma fecha de inicio.
pub fn diff(book: &RuleBook, incoming: &RuleSet) -> Vec<RuleChange> {
    incoming
        .values
        .iter()
        .map(|v| {
            let from = v.valid_from.to_string();
            match book.get(&v.code, v.valid_from) {
                Ok(current) if current.value.data == v.data => RuleChange::SinCambios {
                    code: v.code.clone(),
                },
                Ok(current) => RuleChange::Cambiado {
                    code: v.code.clone(),
                    valid_from: from,
                    before: show(&current.value.data),
                    after: show(&v.data),
                    source: v.source.clone(),
                },
                Err(_) => RuleChange::Nuevo {
                    code: v.code.clone(),
                    valid_from: from,
                    value: show(&v.data),
                    source: v.source.clone(),
                },
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::RuleValue;
    use time::macros::date;

    fn value(code: &str, v: &str, from: time::Date) -> RuleValue {
        RuleValue {
            code: code.into(),
            data: RuleData::Decimal(v.parse().unwrap()),
            valid_from: from,
            valid_until: None,
            source: "Fuente ficticia".into(),
            notes: None,
        }
    }

    #[test]
    fn muestra_nuevos_cambiados_y_sin_cambios() {
        let mut book = RuleBook::new();
        book.add(RuleSet {
            code: "A".into(),
            publisher: "p".into(),
            values: vec![
                value("TASA_A", "0.10", date!(2025 - 01 - 01)),
                value("TASA_B", "5", date!(2025 - 01 - 01)),
            ],
        })
        .unwrap();
        let incoming = RuleSet {
            code: "B".into(),
            publisher: "p".into(),
            values: vec![
                value("TASA_A", "0.12", date!(2026 - 01 - 01)),
                value("TASA_B", "5", date!(2026 - 01 - 01)),
                value("TASA_C", "1", date!(2026 - 01 - 01)),
            ],
        };
        let d = diff(&book, &incoming);
        assert_eq!(
            d[0].describe(),
            "TASA_A: 0.10 → 0.12 desde 2026-01-01 (fuente: Fuente ficticia)"
        );
        assert_eq!(
            d[1],
            RuleChange::SinCambios {
                code: "TASA_B".into()
            }
        );
        assert!(matches!(d[2], RuleChange::Nuevo { .. }));
    }
}
