//! Inventario: costo promedio ponderado, stock real, stock futuro, velocidad de venta,
//! cobertura, riesgo de quiebre y punto de reorden (Blueprint §19.4–§19.6).
//!
//! Todo es determinista y explicable: cada resultado puede mostrarse con su cálculo.

use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

// ───────────────────────────── Costo promedio ─────────────────────────────

/// Nuevo costo promedio ponderado tras una entrada de mercadería.
///
/// `costo = (stock_actual × costo_actual + cantidad_entrada × costo_entrada) / (stock_actual + cantidad_entrada)`
///
/// Si el stock actual es negativo o cero, el costo pasa a ser el de la entrada.
pub fn weighted_average_cost(
    current_qty: Decimal,
    current_cost: Decimal,
    in_qty: Decimal,
    in_unit_cost: Decimal,
) -> Decimal {
    if in_qty <= Decimal::ZERO {
        return current_cost;
    }
    if current_qty <= Decimal::ZERO {
        return in_unit_cost;
    }
    (current_qty * current_cost + in_qty * in_unit_cost) / (current_qty + in_qty)
}

// ───────────────────────────── Stock real ─────────────────────────────

/// Estados del stock de un producto. Cada unidad está en un solo estado (§19.4).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct StockPosition {
    /// Disponible físico en bodega.
    pub on_hand: Decimal,
    /// Comprometido en notas de venta / pedidos no despachados.
    pub reserved: Decimal,
    /// Pendiente de órdenes de compra nacionales.
    pub in_purchase: Decimal,
    /// Pendiente de importaciones (incluye lo que está en tránsito).
    pub in_import: Decimal,
    /// Recibido, pendiente de confirmar ingreso.
    pub in_receiving: Decimal,
}

impl StockPosition {
    /// Disponible real = disponible − reservado.
    pub fn available_real(&self) -> Decimal {
        self.on_hand - self.reserved
    }

    /// Todo lo que el negocio tendrá si llega lo pendiente, sin restar ventas futuras.
    pub fn future_without_sales(&self) -> Decimal {
        self.available_real() + self.in_receiving + self.in_purchase + self.in_import
    }

    /// Posición de inventario para reorden.
    pub fn inventory_position(&self) -> Decimal {
        self.future_without_sales()
    }
}

/// Llegada pendiente (compra o importación) a cierta cantidad de días desde hoy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Arrival {
    pub days_from_today: u32,
    pub quantity: Decimal,
}

/// Stock futuro a `horizon_days`: disponible real + en recepción + llegadas con ETA ≤ horizonte
/// − ventas proyectadas (velocidad diaria × días). Con `daily_velocity = 0` se obtiene la versión
/// "sin ventas".
pub fn future_stock_at(
    position: &StockPosition,
    arrivals: &[Arrival],
    horizon_days: u32,
    daily_velocity: Decimal,
) -> Decimal {
    let arriving: Decimal = arrivals
        .iter()
        .filter(|a| a.days_from_today <= horizon_days)
        .map(|a| a.quantity)
        .sum();
    position.available_real() + position.in_receiving + arriving
        - daily_velocity * Decimal::from(horizon_days)
}

// ───────────────────────── Velocidad y cobertura ─────────────────────────

/// Velocidad diaria = unidades vendidas ÷ días **con stock** en la ventana (§19.5).
/// Devuelve `None` si no hay datos suficientes.
pub fn daily_velocity(units_sold: Decimal, days_with_stock: u32, min_days: u32) -> Option<Decimal> {
    if days_with_stock == 0 || days_with_stock < min_days {
        return None;
    }
    Some(units_sold / Decimal::from(days_with_stock))
}

/// Cobertura en días = disponible real ÷ velocidad diaria.
pub fn coverage_days(available_real: Decimal, velocity: Decimal) -> Option<Decimal> {
    if velocity <= Decimal::ZERO {
        return None;
    }
    Some((available_real.max(Decimal::ZERO)) / velocity)
}

/// Días que el producto estará sin stock antes del próximo arribo.
/// `Some(d)` con d > 0 indica riesgo de quiebre de `d` días.
pub fn stockout_gap_days(coverage_days: Decimal, next_arrival_days: Decimal) -> Option<Decimal> {
    let gap = next_arrival_days - coverage_days;
    if gap > Decimal::ZERO { Some(gap) } else { None }
}

// ───────────────────────────── Reorden ─────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReorderParams {
    /// Plazo de reposición L en días (proveedor + transporte).
    pub lead_time_days: u32,
    /// Días de seguridad para el stock de seguridad.
    pub safety_days: u32,
    /// Días de cobertura objetivo después de recibir.
    pub target_coverage_days: u32,
    /// Umbral de exceso de inventario (cobertura en días).
    pub excess_coverage_days: u32,
    /// Mínimo de compra del proveedor (unidades).
    pub min_order_qty: Decimal,
    /// Múltiplo de compra (caja, pack). 1 si no aplica.
    pub order_multiple: Decimal,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ReorderAdvice {
    Buy {
        quantity: Decimal,
        explanation: String,
    },
    DontBuy {
        explanation: String,
    },
    Excess {
        coverage_days: Decimal,
        explanation: String,
    },
    InsufficientData,
}

fn round_up_to_multiple(qty: Decimal, multiple: Decimal) -> Decimal {
    if multiple <= Decimal::ONE {
        return qty.ceil();
    }
    (qty / multiple).ceil() * multiple
}

/// "¿Qué debo comprar?" para un producto (§19.6). Siempre explica el cálculo.
pub fn reorder_advice(
    position: &StockPosition,
    velocity: Option<Decimal>,
    p: &ReorderParams,
) -> ReorderAdvice {
    let Some(v) = velocity.filter(|v| *v > Decimal::ZERO) else {
        return ReorderAdvice::InsufficientData;
    };
    let lead = Decimal::from(p.lead_time_days);
    let safety_stock = v * Decimal::from(p.safety_days);
    let rop = v * lead + safety_stock;
    let pos = position.inventory_position();
    let coverage = pos / v;

    if coverage > Decimal::from(p.excess_coverage_days) {
        return ReorderAdvice::Excess {
            coverage_days: coverage.round_dp(1),
            explanation: format!(
                "Posición {pos} u ÷ velocidad {v} u/día = {} días de cobertura, sobre el umbral de {} días.",
                coverage.round_dp(1),
                p.excess_coverage_days
            ),
        };
    }
    if pos > rop {
        return ReorderAdvice::DontBuy {
            explanation: format!(
                "Posición {pos} u > punto de reorden {} u (velocidad {v} × plazo {} d + seguridad {}).",
                rop.round_dp(2),
                p.lead_time_days,
                safety_stock.round_dp(2)
            ),
        };
    }
    let raw = v * (lead + Decimal::from(p.target_coverage_days)) + safety_stock - pos;
    let qty = round_up_to_multiple(raw.max(p.min_order_qty), p.order_multiple);
    ReorderAdvice::Buy {
        quantity: qty,
        explanation: format!(
            "Velocidad {v} u/día × (plazo {} d + cobertura objetivo {} d) + seguridad {} − posición {pos} = {} u; ajustado a mínimo/múltiplo → {qty} u.",
            p.lead_time_days,
            p.target_coverage_days,
            safety_stock.round_dp(2),
            raw.round_dp(2)
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    #[test]
    fn costo_promedio_ponderado() {
        // 10 u a $1.000 + 30 u a $1.400 → (10.000 + 42.000) / 40 = $1.300
        assert_eq!(
            weighted_average_cost(dec!(10), dec!(1000), dec!(30), dec!(1400)),
            dec!(1300)
        );
        assert_eq!(
            weighted_average_cost(dec!(0), dec!(999), dec!(5), dec!(1200)),
            dec!(1200)
        );
        assert_eq!(
            weighted_average_cost(dec!(-2), dec!(999), dec!(5), dec!(1200)),
            dec!(1200)
        );
    }

    // ── Casos golden tomados literalmente de 02_INTELIGENCIA_COMERCIAL.md ──

    #[test]
    fn golden_17_inventario_de_compras() {
        let p = StockPosition {
            on_hand: dec!(20),
            in_purchase: dec!(100),
            ..Default::default()
        };
        assert_eq!(p.available_real(), dec!(20));
        assert_eq!(p.future_without_sales(), dec!(120));
    }

    #[test]
    fn golden_18_inventario_de_importacion() {
        let p = StockPosition {
            on_hand: dec!(23),
            reserved: dec!(5),
            in_import: dec!(500),
            ..Default::default()
        };
        assert_eq!(p.available_real(), dec!(18));
        assert_eq!(p.future_without_sales(), dec!(518));
    }

    #[test]
    fn golden_24_cobertura() {
        assert_eq!(coverage_days(dec!(150), dec!(5)), Some(dec!(30)));
    }

    #[test]
    fn golden_23_riesgo_de_quiebre() {
        assert_eq!(stockout_gap_days(dec!(18), dec!(43)), Some(dec!(25)));
        assert_eq!(stockout_gap_days(dec!(50), dec!(43)), None);
    }

    #[test]
    fn velocidad_excluye_dias_sin_stock() {
        // 60 u vendidas en una ventana de 30 días, pero solo hubo stock 20 días → 3 u/día (no 2).
        assert_eq!(daily_velocity(dec!(60), 20, 7), Some(dec!(3)));
        assert_eq!(daily_velocity(dec!(60), 0, 7), None);
        assert_eq!(daily_velocity(dec!(3), 5, 7), None); // datos insuficientes
    }

    #[test]
    fn stock_futuro_por_horizonte() {
        let p = StockPosition {
            on_hand: dec!(23),
            reserved: dec!(5),
            in_import: dec!(500),
            ..Default::default()
        };
        let arrivals = [Arrival {
            days_from_today: 43,
            quantity: dec!(500),
        }];
        // Sin ventas: a 30 días todavía no llega la importación; a 60 sí.
        assert_eq!(future_stock_at(&p, &arrivals, 30, Decimal::ZERO), dec!(18));
        assert_eq!(future_stock_at(&p, &arrivals, 60, Decimal::ZERO), dec!(518));
        // Con 1 u/día de venta proyectada a 60 días: 518 − 60 = 458.
        assert_eq!(future_stock_at(&p, &arrivals, 60, dec!(1)), dec!(458));
    }

    fn params() -> ReorderParams {
        ReorderParams {
            lead_time_days: 10,
            safety_days: 5,
            target_coverage_days: 30,
            excess_coverage_days: 180,
            min_order_qty: dec!(1),
            order_multiple: dec!(12),
        }
    }

    #[test]
    fn reorden_compra_redondeando_a_multiplo() {
        let p = StockPosition {
            on_hand: dec!(40),
            ..Default::default()
        };
        // v=5; seguridad=25; ROP=75; posición 40 ≤ 75 → comprar 5×40+25−40 = 185 → múltiplo de 12 → 192.
        match reorder_advice(&p, Some(dec!(5)), &params()) {
            ReorderAdvice::Buy {
                quantity,
                explanation,
            } => {
                assert_eq!(quantity, dec!(192));
                assert!(explanation.contains("185"));
            }
            other => panic!("se esperaba comprar, se obtuvo {other:?}"),
        }
    }

    #[test]
    fn reorden_no_comprar_y_exceso() {
        let ok = StockPosition {
            on_hand: dec!(100),
            ..Default::default()
        };
        assert!(matches!(
            reorder_advice(&ok, Some(dec!(5)), &params()),
            ReorderAdvice::DontBuy { .. }
        ));
        let mucho = StockPosition {
            on_hand: dec!(1000),
            ..Default::default()
        };
        assert!(matches!(
            reorder_advice(&mucho, Some(dec!(5)), &params()),
            ReorderAdvice::Excess { .. }
        ));
        assert_eq!(
            reorder_advice(&ok, None, &params()),
            ReorderAdvice::InsufficientData
        );
    }
}
