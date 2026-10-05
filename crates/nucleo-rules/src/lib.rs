//! # nucleo-rules
//!
//! Normativa como **datos**, no como código (ADR-009, Blueprint §5.4).
//!
//! - Cada valor tiene `code`, `valid_from`, `valid_until` y **`source` obligatoria**.
//! - Consultar un parámetro sin valor vigente para la fecha es un **error explícito**:
//!   nunca hay un valor por defecto escondido en el código.
//! - Cada consulta devuelve también el paquete (`rule_set`) usado, para guardarlo junto
//!   al cálculo y poder reproducirlo años después.
//!
//! Los paquetes se distribuyen **firmados** (Ed25519, módulo [`signed`]) y antes de activarse se
//! muestra al usuario un **diff legible** (módulo [`diff`]).

pub mod diff;
pub mod signed;

use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use time::Date;

time::serde::format_description!(iso_date, Date, "[year]-[month]-[day]");

mod opt_iso_date {
    #[allow(unused_imports)] // usado dentro de la macro
    use time::Date;
    time::serde::format_description!(inner, Date, "[year]-[month]-[day]");
    pub use inner::option::{deserialize, serialize};
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "value", rename_all = "snake_case")]
pub enum RuleData {
    Decimal(Decimal),
    Integer(i64),
    Text(String),
    /// Tablas (tramos, listas) como JSON estructurado.
    Table(serde_json::Value),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RuleValue {
    pub code: String,
    pub data: RuleData,
    #[serde(with = "iso_date")]
    pub valid_from: Date,
    #[serde(default, with = "opt_iso_date")]
    pub valid_until: Option<Date>,
    /// Norma, circular o URL oficial que respalda el valor. Obligatoria.
    pub source: String,
    #[serde(default)]
    pub notes: Option<String>,
}

impl RuleValue {
    pub fn is_valid_on(&self, date: Date) -> bool {
        date >= self.valid_from && self.valid_until.is_none_or(|until| date <= until)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RuleSet {
    /// Ej. "CL-2026.1".
    pub code: String,
    pub publisher: String,
    pub values: Vec<RuleValue>,
}

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum RuleError {
    #[error("el parámetro {code} no está configurado para la fecha {date}")]
    NotConfigured { code: String, date: Date },
    #[error("el parámetro {code} tiene el tipo {found}, se esperaba {expected}")]
    WrongType {
        code: String,
        expected: &'static str,
        found: &'static str,
    },
    #[error("el parámetro {code} no tiene fuente; la fuente es obligatoria")]
    MissingSource { code: String },
    #[error("el parámetro {code} tiene vigencias superpuestas ({a} y {b})")]
    Overlap { code: String, a: String, b: String },
    #[error("vigencia inválida en {code}: termina antes de empezar")]
    InvalidRange { code: String },
    #[error("paquete normativo mal formado: {0}")]
    Malformed(String),
}

/// Resultado de una consulta: el valor y la versión normativa usada.
#[derive(Debug, Clone, PartialEq)]
pub struct Resolved<'a> {
    pub value: &'a RuleValue,
    pub rule_set: &'a str,
}

#[derive(Debug, Default, Clone)]
pub struct RuleBook {
    sets: Vec<RuleSet>,
}

fn kind(d: &RuleData) -> &'static str {
    match d {
        RuleData::Decimal(_) => "decimal",
        RuleData::Integer(_) => "integer",
        RuleData::Text(_) => "text",
        RuleData::Table(_) => "table",
    }
}

impl RuleBook {
    pub fn new() -> Self {
        Self::default()
    }

    /// Carga y valida un paquete en JSON. Rechaza valores sin fuente o con vigencias superpuestas.
    pub fn load_json(&mut self, json: &str) -> Result<(), RuleError> {
        let set: RuleSet =
            serde_json::from_str(json).map_err(|e| RuleError::Malformed(e.to_string()))?;
        self.add(set)
    }

    pub fn add(&mut self, set: RuleSet) -> Result<(), RuleError> {
        for v in &set.values {
            if v.source.trim().is_empty() {
                return Err(RuleError::MissingSource {
                    code: v.code.clone(),
                });
            }
            if v.valid_until.is_some_and(|u| u < v.valid_from) {
                return Err(RuleError::InvalidRange {
                    code: v.code.clone(),
                });
            }
        }
        let mut candidate = self.sets.clone();
        candidate.push(set);
        Self::check_overlaps(&candidate)?;
        self.sets = candidate;
        Ok(())
    }

    fn check_overlaps(sets: &[RuleSet]) -> Result<(), RuleError> {
        let all: Vec<&RuleValue> = sets.iter().flat_map(|s| s.values.iter()).collect();
        for (i, a) in all.iter().enumerate() {
            for b in &all[i + 1..] {
                if a.code != b.code {
                    continue;
                }
                let a_end = a.valid_until.unwrap_or(Date::MAX);
                let b_end = b.valid_until.unwrap_or(Date::MAX);
                if a.valid_from <= b_end && b.valid_from <= a_end {
                    return Err(RuleError::Overlap {
                        code: a.code.clone(),
                        a: a.valid_from.to_string(),
                        b: b.valid_from.to_string(),
                    });
                }
            }
        }
        Ok(())
    }

    pub fn get(&self, code: &str, date: Date) -> Result<Resolved<'_>, RuleError> {
        self.sets
            .iter()
            .flat_map(|s| s.values.iter().map(move |v| (s, v)))
            .find(|(_, v)| v.code == code && v.is_valid_on(date))
            .map(|(s, v)| Resolved {
                value: v,
                rule_set: &s.code,
            })
            .ok_or_else(|| RuleError::NotConfigured {
                code: code.to_string(),
                date,
            })
    }

    /// Paquetes cargados, en orden de carga.
    pub fn sets(&self) -> &[RuleSet] {
        &self.sets
    }

    pub fn decimal(&self, code: &str, date: Date) -> Result<(Decimal, &str), RuleError> {
        let r = self.get(code, date)?;
        match &r.value.data {
            RuleData::Decimal(d) => Ok((*d, r.rule_set)),
            other => Err(RuleError::WrongType {
                code: code.into(),
                expected: "decimal",
                found: kind(other),
            }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::date;

    // Paquete de EJEMPLO: códigos y valores ficticios, solo para probar el motor.
    const EJEMPLO: &str = r#"{
        "code": "EJEMPLO-1",
        "publisher": "pruebas",
        "values": [
            { "code": "TASA_EJEMPLO", "data": { "type": "decimal", "value": "0.10" },
              "valid_from": "2020-01-01", "valid_until": "2025-12-31",
              "source": "Fuente ficticia de prueba" },
            { "code": "TASA_EJEMPLO", "data": { "type": "decimal", "value": "0.12" },
              "valid_from": "2026-01-01",
              "source": "Fuente ficticia de prueba" }
        ]
    }"#;

    #[test]
    fn consulta_por_fecha_devuelve_valor_y_version() {
        let mut b = RuleBook::new();
        b.load_json(EJEMPLO).unwrap();
        let (v, set) = b.decimal("TASA_EJEMPLO", date!(2024 - 06 - 01)).unwrap();
        assert_eq!(v.to_string(), "0.10");
        assert_eq!(set, "EJEMPLO-1");
        let (v, _) = b.decimal("TASA_EJEMPLO", date!(2026 - 10 - 05)).unwrap();
        assert_eq!(v.to_string(), "0.12");
    }

    #[test]
    fn sin_valor_vigente_es_error_explicito() {
        let mut b = RuleBook::new();
        b.load_json(EJEMPLO).unwrap();
        assert!(matches!(
            b.decimal("TASA_EJEMPLO", date!(2019 - 12 - 31)),
            Err(RuleError::NotConfigured { .. })
        ));
        assert!(matches!(
            b.decimal("NO_EXISTE", date!(2026 - 01 - 01)),
            Err(RuleError::NotConfigured { .. })
        ));
    }

    #[test]
    fn rechaza_valor_sin_fuente() {
        let json = EJEMPLO.replace("Fuente ficticia de prueba", " ");
        assert!(matches!(
            RuleBook::new().load_json(&json),
            Err(RuleError::MissingSource { .. })
        ));
    }

    #[test]
    fn rechaza_vigencias_superpuestas() {
        let json = EJEMPLO.replace("2026-01-01", "2025-06-01");
        assert!(matches!(
            RuleBook::new().load_json(&json),
            Err(RuleError::Overlap { .. })
        ));
    }

    #[test]
    fn rechaza_tipo_incorrecto() {
        let json = EJEMPLO.replace(
            r#"{ "type": "decimal", "value": "0.12" }"#,
            r#"{ "type": "integer", "value": 12 }"#,
        );
        let mut b = RuleBook::new();
        b.load_json(&json).unwrap();
        assert!(matches!(
            b.decimal("TASA_EJEMPLO", date!(2026 - 10 - 05)),
            Err(RuleError::WrongType { .. })
        ));
    }
}
