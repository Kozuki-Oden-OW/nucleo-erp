//! Dinero exacto: enteros en la unidad mínima de cada moneda (ADR-006).
//! Prohibido usar `f64` para montos.

use rust_decimal::prelude::ToPrimitive;
use rust_decimal::{Decimal, RoundingStrategy};
use serde::{Deserialize, Serialize};
use std::fmt;

/// Código ISO 4217 de tres letras (CLP, USD, EUR, CNY…).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct CurrencyCode([u8; 3]);

impl CurrencyCode {
    pub fn new(code: &str) -> Result<Self, MoneyError> {
        let b = code.as_bytes();
        if b.len() != 3 || !b.iter().all(|c| c.is_ascii_uppercase()) {
            return Err(MoneyError::InvalidCurrency(code.to_string()));
        }
        Ok(Self([b[0], b[1], b[2]]))
    }
    pub fn as_str(&self) -> &str {
        // Siempre ASCII mayúsculas por construcción.
        std::str::from_utf8(&self.0).unwrap_or("???")
    }
}

impl TryFrom<String> for CurrencyCode {
    type Error = MoneyError;
    fn try_from(v: String) -> Result<Self, Self::Error> {
        Self::new(&v)
    }
}
impl From<CurrencyCode> for String {
    fn from(c: CurrencyCode) -> Self {
        c.as_str().to_string()
    }
}
impl fmt::Display for CurrencyCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Modo de redondeo. Es un **parámetro normativo/configurable**, no una constante.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RoundingMode {
    /// 0,5 se aleja de cero (redondeo comercial habitual).
    HalfAwayFromZero,
    /// 0,5 va al par más cercano (redondeo bancario).
    HalfEven,
    /// Trunca hacia cero.
    TowardZero,
}

impl RoundingMode {
    pub fn strategy(self) -> RoundingStrategy {
        match self {
            Self::HalfAwayFromZero => RoundingStrategy::MidpointAwayFromZero,
            Self::HalfEven => RoundingStrategy::MidpointNearestEven,
            Self::TowardZero => RoundingStrategy::ToZero,
        }
    }
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum MoneyError {
    #[error("código de moneda inválido: {0}")]
    InvalidCurrency(String),
    #[error("no se pueden operar montos en monedas distintas ({0} y {1})")]
    CurrencyMismatch(String, String),
    #[error("el monto excede el rango permitido")]
    Overflow,
}

/// Monto exacto: `minor` unidades mínimas de `currency` con `decimals` decimales.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Money {
    minor: i64,
    currency: CurrencyCode,
    decimals: u32,
}

impl Money {
    pub fn from_minor(minor: i64, currency: CurrencyCode, decimals: u32) -> Self {
        Self {
            minor,
            currency,
            decimals,
        }
    }

    pub fn zero(currency: CurrencyCode, decimals: u32) -> Self {
        Self::from_minor(0, currency, decimals)
    }

    /// Convierte un decimal exacto a dinero, redondeando según `mode`.
    pub fn from_decimal(
        value: Decimal,
        currency: CurrencyCode,
        decimals: u32,
        mode: RoundingMode,
    ) -> Result<Self, MoneyError> {
        let factor = Decimal::from(10i64.checked_pow(decimals).ok_or(MoneyError::Overflow)?);
        let scaled = value
            .checked_mul(factor)
            .ok_or(MoneyError::Overflow)?
            .round_dp_with_strategy(0, mode.strategy());
        let minor = scaled.to_i64().ok_or(MoneyError::Overflow)?;
        Ok(Self::from_minor(minor, currency, decimals))
    }

    pub fn minor(&self) -> i64 {
        self.minor
    }
    pub fn currency(&self) -> CurrencyCode {
        self.currency
    }
    pub fn decimals(&self) -> u32 {
        self.decimals
    }
    pub fn to_decimal(&self) -> Decimal {
        Decimal::new(self.minor, self.decimals)
    }

    fn same(&self, other: &Self) -> Result<(), MoneyError> {
        if self.currency != other.currency || self.decimals != other.decimals {
            return Err(MoneyError::CurrencyMismatch(
                self.currency.to_string(),
                other.currency.to_string(),
            ));
        }
        Ok(())
    }

    pub fn checked_add(&self, other: &Self) -> Result<Self, MoneyError> {
        self.same(other)?;
        let minor = self
            .minor
            .checked_add(other.minor)
            .ok_or(MoneyError::Overflow)?;
        Ok(Self { minor, ..*self })
    }

    pub fn checked_sub(&self, other: &Self) -> Result<Self, MoneyError> {
        self.same(other)?;
        let minor = self
            .minor
            .checked_sub(other.minor)
            .ok_or(MoneyError::Overflow)?;
        Ok(Self { minor, ..*self })
    }

    /// Multiplica por un factor exacto (cantidad, tasa) y redondea.
    pub fn mul_decimal(&self, factor: Decimal, mode: RoundingMode) -> Result<Self, MoneyError> {
        let value = self
            .to_decimal()
            .checked_mul(factor)
            .ok_or(MoneyError::Overflow)?;
        Self::from_decimal(value, self.currency, self.decimals, mode)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    fn clp() -> CurrencyCode {
        CurrencyCode::new("CLP").unwrap()
    }
    fn usd() -> CurrencyCode {
        CurrencyCode::new("USD").unwrap()
    }

    #[test]
    fn codigo_de_moneda_valida_formato() {
        assert!(CurrencyCode::new("CLP").is_ok());
        assert!(CurrencyCode::new("clp").is_err());
        assert!(CurrencyCode::new("PESO").is_err());
    }

    #[test]
    fn clp_sin_decimales_redondea_segun_modo() {
        let a =
            Money::from_decimal(dec!(1000.5), clp(), 0, RoundingMode::HalfAwayFromZero).unwrap();
        assert_eq!(a.minor(), 1001);
        let b = Money::from_decimal(dec!(1000.5), clp(), 0, RoundingMode::HalfEven).unwrap();
        assert_eq!(b.minor(), 1000);
        let c = Money::from_decimal(dec!(1000.9), clp(), 0, RoundingMode::TowardZero).unwrap();
        assert_eq!(c.minor(), 1000);
    }

    #[test]
    fn usd_en_centavos() {
        let m = Money::from_decimal(dec!(5.125), usd(), 2, RoundingMode::HalfAwayFromZero).unwrap();
        assert_eq!(m.minor(), 513);
        assert_eq!(m.to_decimal(), dec!(5.13));
    }

    #[test]
    fn no_mezcla_monedas() {
        let a = Money::from_minor(100, clp(), 0);
        let b = Money::from_minor(100, usd(), 2);
        assert!(matches!(
            a.checked_add(&b),
            Err(MoneyError::CurrencyMismatch(_, _))
        ));
    }

    #[test]
    fn detecta_desborde() {
        let a = Money::from_minor(i64::MAX, clp(), 0);
        let b = Money::from_minor(1, clp(), 0);
        assert_eq!(a.checked_add(&b), Err(MoneyError::Overflow));
    }

    #[test]
    fn multiplicacion_exacta_sin_flotantes() {
        // 0,1 + 0,2 en flotante no es 0,3; en decimal exacto sí.
        let m = Money::from_minor(10, usd(), 2); // 0,10
        let r = m
            .mul_decimal(dec!(3), RoundingMode::HalfAwayFromZero)
            .unwrap();
        assert_eq!(r.to_decimal(), dec!(0.30));
    }
}
