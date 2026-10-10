//! Precio neto o con IVA y hoja de costo de un producto.
//!
//! - El precio de lista se guarda **neto**; si la persona lo escribe con IVA, se convierte con la
//!   tasa vigente del negocio (que llega como parámetro: este módulo no conoce ninguna tasa).
//! - La hoja de costo suma lo que cuesta poner una unidad a la venta: compra (en pesos o en otra
//!   moneda con su tipo de cambio), transporte, envío, mano de obra y otros, todo opcional, y lo
//!   reparte entre las unidades del lote.
//!
//! Enteros: montos en unidad mínima, tipo de cambio en millonésimas (`_e6`), cantidades en
//! milésimas (`_milli`), costo unitario en diezmilésimas (`_e4`). Redondeo half away from zero.

use crate::comex::div_round;
use serde::{Deserialize, Serialize};

const PPM: i128 = 1_000_000;

/// Neto a partir de un precio con impuesto. Sin tasa (o tasa 0) devuelve el mismo monto.
pub fn net_from_gross(gross_minor: i64, tax_ppm: Option<i64>) -> i64 {
    match tax_ppm {
        Some(t) if t > 0 => div_round(gross_minor as i128 * PPM, PPM + t as i128) as i64,
        _ => gross_minor,
    }
}

/// Precio con impuesto a partir del neto (mismo redondeo que el total de un documento).
pub fn gross_from_net(net_minor: i64, tax_ppm: Option<i64>) -> i64 {
    match tax_ppm {
        Some(t) if t > 0 => net_minor + div_round(net_minor as i128 * t as i128, PPM) as i64,
        _ => net_minor,
    }
}

/// Lo que la persona anota para calcular el costo. Todo es opcional (0 = no aplica).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct CostSheet {
    /// Valor de compra del lote en la moneda indicada (unidad mínima de esa moneda).
    pub purchase_minor: i64,
    /// Código de la moneda de compra ("CLP", "USD"…).
    pub currency: String,
    /// Decimales de la unidad mínima de esa moneda (CLP 0, USD 2).
    pub currency_digits: u32,
    /// Pesos por una unidad de la moneda, en millonésimas. Se ignora si la moneda es CLP.
    pub fx_rate_e6: i64,
    /// Transporte o flete hasta tu bodega (CLP).
    pub freight_minor: i64,
    /// Envío o despacho (CLP).
    pub shipping_minor: i64,
    /// Trabajo humano: armado, fabricación, horas propias o de terceros (CLP).
    pub labor_minor: i64,
    /// Otros: embalaje, etiquetas, comisiones, aduana… (CLP).
    pub other_minor: i64,
    /// Unidades que salen de este lote, en milésimas (0 = una unidad).
    pub units_milli: i64,
    /// `true` = los montos en pesos (compra en CLP, transporte, envío y otros) incluyen IVA y se
    /// llevan a neto. La mano de obra no lleva IVA.
    pub pesos_include_tax: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct CostSheetResult {
    /// Compra convertida a pesos y neta.
    pub purchase_clp: i64,
    pub freight: i64,
    pub shipping: i64,
    pub labor: i64,
    pub other: i64,
    /// Total del lote en pesos netos.
    pub total: i64,
    pub units_milli: i64,
    /// Costo por unidad en diezmilésimas de peso (como el costo promedio).
    pub unit_cost_e4: i64,
    /// Costo por unidad redondeado a peso.
    pub unit_cost: i64,
    /// Avisos en lenguaje claro.
    pub notes: Vec<String>,
}

pub fn compute_cost_sheet(s: &CostSheet, tax_ppm: Option<i64>) -> CostSheetResult {
    let mut notes = Vec::new();
    let tax = if s.pesos_include_tax { tax_ppm } else { None };
    if s.pesos_include_tax && tax_ppm.is_none() {
        notes.push("El negocio no tiene tasa de IVA: los montos en pesos se usan tal cual.".into());
    }
    let net = |x: i64| net_from_gross(x.max(0), tax);
    let is_clp = s.currency.is_empty() || s.currency.eq_ignore_ascii_case("CLP");
    let purchase_clp = if is_clp {
        net(s.purchase_minor)
    } else if s.purchase_minor > 0 && s.fx_rate_e6 <= 0 {
        notes.push(format!(
            "Falta el tipo de cambio de {}: la compra no se sumó.",
            s.currency
        ));
        0
    } else {
        let scale = 10i128.pow(s.currency_digits) * PPM;
        div_round(
            s.purchase_minor.max(0) as i128 * s.fx_rate_e6 as i128,
            scale,
        ) as i64
    };
    let freight = net(s.freight_minor);
    let shipping = net(s.shipping_minor);
    let labor = s.labor_minor.max(0);
    let other = net(s.other_minor);
    let total = purchase_clp + freight + shipping + labor + other;
    let units_milli = if s.units_milli > 0 {
        s.units_milli
    } else {
        1000
    };
    let unit_cost_e4 = div_round(total as i128 * 10_000 * 1000, units_milli as i128) as i64;
    CostSheetResult {
        purchase_clp,
        freight,
        shipping,
        labor,
        other,
        total,
        units_milli,
        unit_cost_e4,
        unit_cost: div_round(unit_cost_e4 as i128, 10_000) as i64,
        notes,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn neto_y_con_iva_ida_y_vuelta() {
        let t = Some(190_000);
        assert_eq!(net_from_gross(9_990, t), 8_395);
        assert_eq!(gross_from_net(8_395, t), 9_990);
        assert_eq!(gross_from_net(32_900, t), 39_151);
        assert_eq!(net_from_gross(1_000, None), 1_000);
    }

    #[test]
    fn hoja_en_dolares_con_lote() {
        let s = CostSheet {
            purchase_minor: 150_000, // USD 1.500,00
            currency: "USD".into(),
            currency_digits: 2,
            fx_rate_e6: 950_500_000, // $950,5
            freight_minor: 119_000,
            shipping_minor: 0,
            labor_minor: 50_000,
            other_minor: 0,
            units_milli: 100_000,
            pesos_include_tax: true,
        };
        let r = compute_cost_sheet(&s, Some(190_000));
        assert_eq!(r.purchase_clp, 1_425_750);
        assert_eq!(r.freight, 100_000);
        assert_eq!(r.total, 1_575_750);
        assert_eq!(r.unit_cost_e4, 157_575_000);
        assert_eq!(r.unit_cost, 15_758);
    }

    #[test]
    fn falta_tipo_de_cambio() {
        let s = CostSheet {
            purchase_minor: 1_000,
            currency: "EUR".into(),
            currency_digits: 2,
            ..Default::default()
        };
        let r = compute_cost_sheet(&s, None);
        assert_eq!(r.total, 0);
        assert_eq!(r.notes.len(), 1);
    }
}
