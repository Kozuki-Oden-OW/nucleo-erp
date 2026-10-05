//! Cálculo de líneas y totales de un documento (neto, exento, descuentos, impuesto, total).
//!
//! La tasa de impuesto y la regla de redondeo **llegan como parámetros** desde la
//! normativa versionada (`nucleo-rules`). Este módulo no conoce ninguna tasa.

use crate::money::RoundingMode;
use rust_decimal::Decimal;
use rust_decimal::prelude::ToPrimitive;
use serde::{Deserialize, Serialize};

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum PricingError {
    #[error("la cantidad debe ser mayor que cero")]
    InvalidQuantity,
    #[error("el precio no puede ser negativo")]
    NegativePrice,
    #[error("el descuento porcentual debe estar entre 0 y 100")]
    InvalidDiscountPct,
    #[error("el descuento no puede superar el valor de la línea")]
    DiscountExceedsLine,
    #[error("la tasa de impuesto no es válida")]
    InvalidTaxRate,
    #[error("el monto excede el rango permitido")]
    Overflow,
}

/// Dónde se redondea el impuesto: en cada línea o una vez sobre el neto total.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaxRoundingScope {
    PerLine,
    PerDocument,
}

/// Parámetros que vienen de la normativa vigente a la fecha del documento.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct TaxParams {
    /// Tasa como fracción (ej. 0,10 = 10 %). Viene de `nucleo-rules`.
    pub rate: Decimal,
    pub rounding: RoundingMode,
    pub scope: TaxRoundingScope,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LineInput {
    pub quantity: Decimal,
    /// Precio unitario neto en unidades mínimas.
    pub unit_price_minor: i64,
    /// Descuento porcentual (0 a 100).
    pub discount_pct: Decimal,
    /// Descuento adicional en monto, unidades mínimas.
    pub discount_minor: i64,
    /// `false` = exento (no afecto a impuesto).
    pub taxable: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct LineTotals {
    pub gross_minor: i64,
    pub discount_minor: i64,
    pub net_minor: i64,
    /// Impuesto de la línea (solo con `TaxRoundingScope::PerLine`).
    pub tax_minor: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct DocumentTotals {
    pub gross_minor: i64,
    pub discount_minor: i64,
    /// Neto afecto.
    pub net_taxable_minor: i64,
    pub exempt_minor: i64,
    pub tax_minor: i64,
    pub total_minor: i64,
}

/// Redondea un valor ya expresado en unidades mínimas.
fn to_minor(value: Decimal, mode: RoundingMode) -> Result<i64, PricingError> {
    value
        .round_dp_with_strategy(0, mode.strategy())
        .to_i64()
        .ok_or(PricingError::Overflow)
}

pub fn line_totals(line: &LineInput, tax: &TaxParams) -> Result<LineTotals, PricingError> {
    if line.quantity <= Decimal::ZERO {
        return Err(PricingError::InvalidQuantity);
    }
    if line.unit_price_minor < 0 || line.discount_minor < 0 {
        return Err(PricingError::NegativePrice);
    }
    if line.discount_pct < Decimal::ZERO || line.discount_pct > Decimal::ONE_HUNDRED {
        return Err(PricingError::InvalidDiscountPct);
    }
    if tax.rate < Decimal::ZERO || tax.rate >= Decimal::ONE {
        return Err(PricingError::InvalidTaxRate);
    }
    let gross_exact = Decimal::from(line.unit_price_minor)
        .checked_mul(line.quantity)
        .ok_or(PricingError::Overflow)?;
    let gross = to_minor(gross_exact, tax.rounding)?;
    let pct_discount = to_minor(
        Decimal::from(gross) * line.discount_pct / Decimal::ONE_HUNDRED,
        tax.rounding,
    )?;
    let discount = pct_discount
        .checked_add(line.discount_minor)
        .ok_or(PricingError::Overflow)?;
    if discount > gross {
        return Err(PricingError::DiscountExceedsLine);
    }
    let net = gross - discount;
    let tax_minor = if line.taxable && tax.scope == TaxRoundingScope::PerLine {
        to_minor(Decimal::from(net) * tax.rate, tax.rounding)?
    } else {
        0
    };
    Ok(LineTotals {
        gross_minor: gross,
        discount_minor: discount,
        net_minor: net,
        tax_minor,
    })
}

pub fn document_totals(
    lines: &[LineInput],
    tax: &TaxParams,
) -> Result<DocumentTotals, PricingError> {
    let mut t = DocumentTotals::default();
    let mut tax_per_line: i64 = 0;
    for line in lines {
        let lt = line_totals(line, tax)?;
        t.gross_minor = t
            .gross_minor
            .checked_add(lt.gross_minor)
            .ok_or(PricingError::Overflow)?;
        t.discount_minor += lt.discount_minor;
        if line.taxable {
            t.net_taxable_minor += lt.net_minor;
            tax_per_line += lt.tax_minor;
        } else {
            t.exempt_minor += lt.net_minor;
        }
    }
    t.tax_minor = match tax.scope {
        TaxRoundingScope::PerLine => tax_per_line,
        TaxRoundingScope::PerDocument => {
            to_minor(Decimal::from(t.net_taxable_minor) * tax.rate, tax.rounding)?
        }
    };
    t.total_minor = t.net_taxable_minor + t.exempt_minor + t.tax_minor;
    Ok(t)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    // Tasa de EJEMPLO para pruebas (no es un valor normativo real).
    fn params(scope: TaxRoundingScope) -> TaxParams {
        TaxParams {
            rate: dec!(0.10),
            rounding: RoundingMode::HalfAwayFromZero,
            scope,
        }
    }

    fn line(qty: Decimal, price: i64, pct: Decimal, taxable: bool) -> LineInput {
        LineInput {
            quantity: qty,
            unit_price_minor: price,
            discount_pct: pct,
            discount_minor: 0,
            taxable,
        }
    }

    #[test]
    fn linea_simple_con_descuento() {
        let l = line(dec!(3), 10_000, dec!(10), true);
        let t = line_totals(&l, &params(TaxRoundingScope::PerLine)).unwrap();
        assert_eq!(t.gross_minor, 30_000);
        assert_eq!(t.discount_minor, 3_000);
        assert_eq!(t.net_minor, 27_000);
        assert_eq!(t.tax_minor, 2_700);
    }

    #[test]
    fn documento_con_afecto_y_exento() {
        let lines = [
            line(dec!(1), 15_000, dec!(0), true),
            line(dec!(2), 5_000, dec!(0), false),
        ];
        let t = document_totals(&lines, &params(TaxRoundingScope::PerDocument)).unwrap();
        assert_eq!(t.net_taxable_minor, 15_000);
        assert_eq!(t.exempt_minor, 10_000);
        assert_eq!(t.tax_minor, 1_500);
        assert_eq!(t.total_minor, 26_500);
    }

    #[test]
    fn redondeo_por_linea_vs_por_documento_puede_diferir() {
        // Tres líneas de $5: impuesto 0,5 cada una.
        let lines = [
            line(dec!(1), 5, dec!(0), true),
            line(dec!(1), 5, dec!(0), true),
            line(dec!(1), 5, dec!(0), true),
        ];
        let per_line = document_totals(&lines, &params(TaxRoundingScope::PerLine)).unwrap();
        let per_doc = document_totals(&lines, &params(TaxRoundingScope::PerDocument)).unwrap();
        assert_eq!(per_line.tax_minor, 3); // 1 + 1 + 1
        assert_eq!(per_doc.tax_minor, 2); // 1,5 → 2
        // Por eso el alcance del redondeo es un parámetro (riesgo T-06).
    }

    #[test]
    fn cantidades_fraccionarias() {
        let l = line(dec!(2.5), 1_000, dec!(0), true);
        let t = line_totals(&l, &params(TaxRoundingScope::PerLine)).unwrap();
        assert_eq!(t.net_minor, 2_500);
    }

    #[test]
    fn validaciones() {
        let p = params(TaxRoundingScope::PerLine);
        assert_eq!(
            line_totals(&line(dec!(0), 1, dec!(0), true), &p),
            Err(PricingError::InvalidQuantity)
        );
        assert_eq!(
            line_totals(&line(dec!(1), 1, dec!(101), true), &p),
            Err(PricingError::InvalidDiscountPct)
        );
        let mut l = line(dec!(1), 100, dec!(0), true);
        l.discount_minor = 101;
        assert_eq!(line_totals(&l, &p), Err(PricingError::DiscountExceedsLine));
    }
}
