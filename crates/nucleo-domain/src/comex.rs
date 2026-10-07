//! NÚCLEO COMEX: costo de importación puesto en bodega ("landed cost") y margen de exportación.
//!
//! Cálculo puro y determinista, en enteros (pesos chilenos y unidades mínimas de la moneda
//! extranjera), con redondeo half away from zero y prorrateos que siempre suman exacto
//! (método del resto mayor). **Sin tasas escritas aquí**: arancel e IVA de importación llegan
//! como parámetros (los ingresa el usuario o vienen de un paquete normativo con fuente).
//!
//! Orden del cálculo (COMEX_RULES.md):
//! 1. Valor de la mercadería (según el Incoterm de la factura) en la moneda de la importación → CLP.
//! 2. Valor aduanero (CIF) = mercadería + flete + seguro, prorrateados a cada producto. Si no se
//!    contrató seguro, puede usarse un **seguro teórico** (% de la mercadería) que solo cuenta para
//!    el valor aduanero: no es un costo pagado y no se suma al costo en bodega.
//! 3. Derechos: los montos ingresados (de la declaración real) o, si no hay, el arancel de cada
//!    producto sobre su valor aduanero.
//! 4. IVA de importación: los montos ingresados o, si no hay, la tasa sobre (valor aduanero +
//!    derechos). Si es recuperable como crédito, **no** se suma al costo.
//! 5. Gastos locales (agente, puerto, almacenaje, transporte, banco, otros) prorrateados.
//! 6. Costo final unitario = total del producto ÷ cantidad.
//!
//! Los casos de prueba de `golden/comex.json` están pendientes de revisión por un contador o
//! agente de aduana (decisión D-07); hasta entonces los resultados se rotulan como simulación.

use serde::{Deserialize, Serialize};

/// Criterio para repartir un costo entre los productos de la importación.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Basis {
    Valor,
    Peso,
    Volumen,
    Unidades,
}

impl Basis {
    pub fn parse(s: &str) -> Option<Basis> {
        Some(match s {
            "valor" => Basis::Valor,
            "peso" => Basis::Peso,
            "volumen" => Basis::Volumen,
            "unidades" => Basis::Unidades,
            _ => return None,
        })
    }
    pub fn code(self) -> &'static str {
        match self {
            Basis::Valor => "valor",
            Basis::Peso => "peso",
            Basis::Volumen => "volumen",
            Basis::Unidades => "unidades",
        }
    }
    fn label(self) -> &'static str {
        match self {
            Basis::Valor => "valor",
            Basis::Peso => "peso",
            Basis::Volumen => "volumen",
            Basis::Unidades => "unidades",
        }
    }
}

/// Tipo de costo de una importación (mismos códigos que `import_costs.kind`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CostKind {
    Flete,
    Seguro,
    Derechos,
    IvaImportacion,
    AgenteAduana,
    GastosPortuarios,
    Almacenaje,
    TransporteInterno,
    GastosBancarios,
    Otros,
}

impl CostKind {
    pub fn parse(s: &str) -> Option<CostKind> {
        Some(match s {
            "flete" => CostKind::Flete,
            "seguro" => CostKind::Seguro,
            "derechos" => CostKind::Derechos,
            "iva_importacion" => CostKind::IvaImportacion,
            "agente_aduana" => CostKind::AgenteAduana,
            "gastos_portuarios" => CostKind::GastosPortuarios,
            "almacenaje" => CostKind::Almacenaje,
            "transporte_interno" => CostKind::TransporteInterno,
            "gastos_bancarios" => CostKind::GastosBancarios,
            "otros" => CostKind::Otros,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LandedItem {
    pub qty_milli: i64,
    /// Precio unitario en unidades mínimas de la moneda de la importación (ej. centavos de USD).
    pub unit_price_minor: i64,
    /// Peso de UNA unidad, en gramos.
    #[serde(default)]
    pub weight_g: Option<i64>,
    /// Volumen de UNA unidad, en cm³.
    #[serde(default)]
    pub volume_cm3: Option<i64>,
    /// Arancel del producto en partes por millón (lo ingresa el usuario).
    #[serde(default)]
    pub duty_ppm: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LandedCost {
    pub kind: CostKind,
    /// Monto ya convertido a pesos con el tipo de cambio de ese costo.
    pub amount_clp: i64,
    /// Criterio de reparto propio; si falta, se usa el de la importación (el seguro, por valor).
    #[serde(default)]
    pub basis: Option<Basis>,
    /// Impuesto recuperable como crédito: se informa pero no se suma al costo.
    #[serde(default)]
    pub recoverable: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LandedInput {
    /// Decimales de la moneda de la importación (USD = 2, CLP = 0).
    pub currency_decimals: u32,
    /// Pesos por 1 unidad de la moneda × 1.000.000.
    pub rate_e6: i64,
    pub basis: Basis,
    /// Tasa de IVA de importación a usar si no se ingresó el monto real.
    #[serde(default)]
    pub vat_ppm: Option<i64>,
    /// El IVA calculado se recupera como crédito (no va al costo).
    #[serde(default = "yes")]
    pub vat_recoverable: bool,
    /// Seguro teórico para el valor aduanero cuando no se contrató seguro, en partes por millón
    /// del valor de la mercadería. No es un costo pagado. Se ignora si hay costos de seguro.
    #[serde(default)]
    pub notional_insurance_ppm: Option<i64>,
    pub items: Vec<LandedItem>,
    #[serde(default)]
    pub costs: Vec<LandedCost>,
}

fn yes() -> bool {
    true
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ItemBreakdown {
    pub fob_clp: i64,
    pub freight_clp: i64,
    pub insurance_clp: i64,
    /// Seguro teórico: solo valor aduanero, no es costo.
    pub notional_insurance_clp: i64,
    pub customs_value_clp: i64,
    pub duty_clp: i64,
    /// IVA de importación asignado al producto (recuperable o no).
    pub vat_clp: i64,
    /// Parte del IVA que sí es costo (no recuperable).
    pub vat_in_cost_clp: i64,
    /// Gastos locales que son costo.
    pub local_clp: i64,
    pub landed_clp: i64,
    /// Costo final unitario en pesos × 10.000.
    pub unit_cost_e4: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LandedResult {
    /// Valor de la mercadería en la moneda de la importación (unidades mínimas).
    pub fob_minor: i64,
    pub fob_clp: i64,
    pub freight_clp: i64,
    pub insurance_clp: i64,
    /// Seguro teórico (solo valor aduanero, no es costo).
    pub notional_insurance_clp: i64,
    pub customs_value_clp: i64,
    pub duty_clp: i64,
    /// Los derechos vienen de montos ingresados (no de la tasa).
    pub duty_entered: bool,
    pub vat_clp: i64,
    pub vat_entered: bool,
    pub vat_in_cost_clp: i64,
    /// Impuestos recuperables como crédito (no son costo).
    pub recoverable_clp: i64,
    pub local_clp: i64,
    pub landed_clp: i64,
    pub items: Vec<ItemBreakdown>,
    /// Avisos en lenguaje claro sobre supuestos aplicados.
    pub notes: Vec<String>,
}

/// División entera con redondeo half away from zero.
pub fn div_round(n: i128, d: i128) -> i128 {
    assert!(d != 0, "división por cero");
    let (n, d) = if d < 0 { (-n, -d) } else { (n, d) };
    if n >= 0 {
        (n + d / 2) / d
    } else {
        -((-n + d / 2) / d)
    }
}

/// Monto en unidades mínimas de una moneda → pesos, con el tipo de cambio × 1.000.000.
pub fn to_clp(amount_minor: i64, decimals: u32, rate_e6: i64) -> i64 {
    let scale = 10i128.pow(decimals) * 1_000_000;
    div_round(amount_minor as i128 * rate_e6 as i128, scale) as i64
}

/// Reparte `total` en proporción a `weights` (método del resto mayor): la suma es exacta.
/// Si todos los pesos son cero, reparte en partes iguales.
pub fn allocate(total: i64, weights: &[i128]) -> Vec<i64> {
    let n = weights.len();
    if n == 0 {
        return Vec::new();
    }
    let sum: i128 = weights.iter().map(|w| (*w).max(0)).sum();
    let ws: Vec<i128> = if sum > 0 {
        weights.iter().map(|w| (*w).max(0)).collect()
    } else {
        vec![1; n]
    };
    let sum: i128 = ws.iter().sum();
    let t = total as i128;
    let mut out: Vec<i128> = Vec::with_capacity(n);
    let mut rems: Vec<(i128, usize)> = Vec::with_capacity(n);
    for (i, w) in ws.iter().enumerate() {
        let p = t * w;
        let q = p.div_euclid(sum);
        out.push(q);
        rems.push((p.rem_euclid(sum), i));
    }
    let mut left = t - out.iter().sum::<i128>();
    // Mayor resto primero; en empate, el primero de la lista.
    rems.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
    let mut k = 0;
    while left > 0 {
        out[rems[k % n].1] += 1;
        left -= 1;
        k += 1;
    }
    out.into_iter().map(|x| x as i64).collect()
}

/// Valor en pesos de cada producto (cantidad × precio unitario).
fn item_fob_clp(input: &LandedInput) -> Vec<i64> {
    input
        .items
        .iter()
        .map(|it| {
            let line_minor = div_round(it.qty_milli as i128 * it.unit_price_minor as i128, 1000);
            to_clp(line_minor as i64, input.currency_decimals, input.rate_e6)
        })
        .collect()
}

fn weights_for(
    input: &LandedInput,
    basis: Basis,
    fob: &[i64],
    notes: &mut Vec<String>,
    what: &str,
) -> Vec<i128> {
    let value = || fob.iter().map(|v| *v as i128).collect::<Vec<_>>();
    match basis {
        Basis::Valor => value(),
        Basis::Unidades => input.items.iter().map(|i| i.qty_milli as i128).collect(),
        Basis::Peso | Basis::Volumen => {
            let per: Vec<Option<i64>> = input
                .items
                .iter()
                .map(|i| {
                    if basis == Basis::Peso {
                        i.weight_g
                    } else {
                        i.volume_cm3
                    }
                })
                .collect();
            if per.iter().any(|p| p.is_none_or(|v| v <= 0)) {
                let note = format!(
                    "Falta el {} de algún producto: {what} se repartió por valor.",
                    basis.label()
                );
                if !notes.contains(&note) {
                    notes.push(note);
                }
                return value();
            }
            input
                .items
                .iter()
                .zip(per)
                .map(|(i, p)| p.unwrap_or(0) as i128 * i.qty_milli as i128)
                .collect()
        }
    }
}

fn cost_label(k: CostKind) -> &'static str {
    match k {
        CostKind::Flete => "el flete",
        CostKind::Seguro => "el seguro",
        CostKind::Derechos => "los derechos",
        CostKind::IvaImportacion => "el IVA de importación",
        CostKind::AgenteAduana => "el agente de aduana",
        CostKind::GastosPortuarios => "los gastos portuarios",
        CostKind::Almacenaje => "el almacenaje",
        CostKind::TransporteInterno => "el transporte local",
        CostKind::GastosBancarios => "los gastos bancarios",
        CostKind::Otros => "otros gastos",
    }
}

fn add(into: &mut [i64], part: &[i64]) {
    for (a, b) in into.iter_mut().zip(part) {
        *a += b;
    }
}

/// Costo de una importación puesto en bodega, total y por producto.
pub fn landed_cost(input: &LandedInput) -> LandedResult {
    let n = input.items.len();
    let mut notes = Vec::new();
    let fob = item_fob_clp(input);
    let fob_minor: i64 = input
        .items
        .iter()
        .map(|it| div_round(it.qty_milli as i128 * it.unit_price_minor as i128, 1000) as i64)
        .sum();
    if input.rate_e6 <= 0 && fob_minor > 0 {
        notes.push("Falta el tipo de cambio: la mercadería quedó en $0.".into());
    }
    let mut freight = vec![0i64; n];
    let mut insurance = vec![0i64; n];
    let mut local = vec![0i64; n];
    let mut recoverable = 0i64;
    // 1-2. Flete y seguro forman el valor aduanero.
    for c in input
        .costs
        .iter()
        .filter(|c| matches!(c.kind, CostKind::Flete | CostKind::Seguro))
    {
        let basis = c.basis.unwrap_or(if c.kind == CostKind::Seguro {
            Basis::Valor
        } else {
            input.basis
        });
        let w = weights_for(input, basis, &fob, &mut notes, cost_label(c.kind));
        let part = allocate(c.amount_clp, &w);
        if c.kind == CostKind::Flete {
            add(&mut freight, &part);
        } else {
            add(&mut insurance, &part);
        }
    }
    // Seguro teórico: solo si no hay seguro contratado.
    let mut notional = vec![0i64; n];
    let has_insurance = input.costs.iter().any(|c| c.kind == CostKind::Seguro);
    if let Some(ppm) = input.notional_insurance_ppm.filter(|p| *p > 0) {
        if has_insurance {
            notes.push("Hay un seguro contratado: no se usó el seguro teórico.".into());
        } else {
            let fob_total: i64 = fob.iter().sum();
            let total = div_round(fob_total as i128 * ppm as i128, 1_000_000) as i64;
            let w: Vec<i128> = fob.iter().map(|v| *v as i128).collect();
            notional = allocate(total, &w);
        }
    }
    let cv: Vec<i64> = (0..n)
        .map(|i| fob[i] + freight[i] + insurance[i] + notional[i])
        .collect();
    // 3. Derechos.
    let duty_lines: Vec<&LandedCost> = input
        .costs
        .iter()
        .filter(|c| c.kind == CostKind::Derechos)
        .collect();
    let duty_entered = !duty_lines.is_empty();
    let mut duty = vec![0i64; n];
    let mut duty_cost = vec![0i64; n];
    if duty_entered {
        let any_rate = input.items.iter().any(|i| i.duty_ppm.unwrap_or(0) > 0);
        let w: Vec<i128> = (0..n)
            .map(|i| {
                if any_rate {
                    cv[i] as i128 * input.items[i].duty_ppm.unwrap_or(0) as i128
                } else {
                    cv[i] as i128
                }
            })
            .collect();
        for c in duty_lines {
            let part = allocate(c.amount_clp, &w);
            add(&mut duty, &part);
            if c.recoverable {
                recoverable += c.amount_clp;
            } else {
                add(&mut duty_cost, &part);
            }
        }
    } else {
        for i in 0..n {
            let d = div_round(
                cv[i] as i128 * input.items[i].duty_ppm.unwrap_or(0) as i128,
                1_000_000,
            ) as i64;
            duty[i] = d;
            duty_cost[i] = d;
        }
    }
    // 4. IVA de importación.
    let vat_lines: Vec<&LandedCost> = input
        .costs
        .iter()
        .filter(|c| c.kind == CostKind::IvaImportacion)
        .collect();
    let vat_entered = !vat_lines.is_empty();
    let mut vat = vec![0i64; n];
    let mut vat_cost = vec![0i64; n];
    if vat_entered {
        let w: Vec<i128> = (0..n).map(|i| (cv[i] + duty[i]) as i128).collect();
        for c in vat_lines {
            let part = allocate(c.amount_clp, &w);
            add(&mut vat, &part);
            if c.recoverable {
                recoverable += c.amount_clp;
            } else {
                add(&mut vat_cost, &part);
            }
        }
    } else if let Some(ppm) = input.vat_ppm {
        for i in 0..n {
            let v = div_round((cv[i] + duty[i]) as i128 * ppm as i128, 1_000_000) as i64;
            vat[i] = v;
            if input.vat_recoverable {
                recoverable += v;
            } else {
                vat_cost[i] = v;
            }
        }
    } else if fob_minor > 0 {
        notes.push("Sin tasa de IVA de importación: no se calculó.".into());
    }
    // 5. Gastos locales.
    for c in input.costs.iter().filter(|c| {
        !matches!(
            c.kind,
            CostKind::Flete | CostKind::Seguro | CostKind::Derechos | CostKind::IvaImportacion
        )
    }) {
        if c.recoverable {
            recoverable += c.amount_clp;
            continue;
        }
        let basis = c.basis.unwrap_or(input.basis);
        let w = weights_for(input, basis, &fob, &mut notes, cost_label(c.kind));
        add(&mut local, &allocate(c.amount_clp, &w));
    }
    // 6. Totales por producto.
    let items: Vec<ItemBreakdown> = (0..n)
        .map(|i| {
            let landed = cv[i] - notional[i] + duty_cost[i] + vat_cost[i] + local[i];
            let q = input.items[i].qty_milli;
            ItemBreakdown {
                fob_clp: fob[i],
                freight_clp: freight[i],
                insurance_clp: insurance[i],
                notional_insurance_clp: notional[i],
                customs_value_clp: cv[i],
                duty_clp: duty[i],
                vat_clp: vat[i],
                vat_in_cost_clp: vat_cost[i],
                local_clp: local[i],
                landed_clp: landed,
                unit_cost_e4: if q > 0 {
                    div_round(landed as i128 * 10_000_000, q as i128) as i64
                } else {
                    0
                },
            }
        })
        .collect();
    let sum = |f: fn(&ItemBreakdown) -> i64| items.iter().map(f).sum::<i64>();
    let duty_total = if duty_entered {
        input
            .costs
            .iter()
            .filter(|c| c.kind == CostKind::Derechos)
            .map(|c| c.amount_clp)
            .sum()
    } else {
        sum(|x| x.duty_clp)
    };
    LandedResult {
        fob_minor,
        fob_clp: sum(|x| x.fob_clp),
        freight_clp: sum(|x| x.freight_clp),
        insurance_clp: sum(|x| x.insurance_clp),
        notional_insurance_clp: sum(|x| x.notional_insurance_clp),
        customs_value_clp: sum(|x| x.customs_value_clp),
        duty_clp: duty_total,
        duty_entered,
        vat_clp: sum(|x| x.vat_clp),
        vat_entered,
        vat_in_cost_clp: sum(|x| x.vat_in_cost_clp),
        recoverable_clp: recoverable,
        local_clp: sum(|x| x.local_clp),
        landed_clp: sum(|x| x.landed_clp),
        items,
        notes,
    }
}

/* ───────────────────────────── Exportación ───────────────────────────── */

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExportItem {
    pub qty_milli: i64,
    /// Precio unitario de venta en la moneda de la exportación (unidades mínimas).
    pub unit_price_minor: i64,
    /// Costo unitario del producto en pesos × 10.000.
    pub unit_cost_e4: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExportInput {
    pub currency_decimals: u32,
    pub rate_e6: i64,
    pub items: Vec<ExportItem>,
    /// Costos de la exportación ya convertidos a pesos (flete, documentos, comisiones…).
    #[serde(default)]
    pub costs_clp: Vec<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExportResult {
    pub revenue_minor: i64,
    pub revenue_clp: i64,
    pub goods_cost_clp: i64,
    pub costs_clp: i64,
    /// Ingreso − costo de la mercadería.
    pub contribution_clp: i64,
    /// Contribución − costos de la exportación.
    pub profit_clp: i64,
    /// Utilidad sobre el ingreso, en partes por millón.
    pub margin_ppm: Option<i64>,
    /// Ingreso necesario (misma mezcla de productos) para cubrir los costos de la exportación.
    pub breakeven_revenue_clp: Option<i64>,
}

pub fn export_margin(input: &ExportInput) -> ExportResult {
    let revenue_minor: i64 = input
        .items
        .iter()
        .map(|i| div_round(i.qty_milli as i128 * i.unit_price_minor as i128, 1000) as i64)
        .sum();
    let revenue_clp: i64 = input
        .items
        .iter()
        .map(|i| {
            let line = div_round(i.qty_milli as i128 * i.unit_price_minor as i128, 1000) as i64;
            to_clp(line, input.currency_decimals, input.rate_e6)
        })
        .sum();
    let goods: i64 = input
        .items
        .iter()
        .map(|i| div_round(i.qty_milli as i128 * i.unit_cost_e4 as i128, 10_000_000) as i64)
        .sum();
    let costs: i64 = input.costs_clp.iter().sum();
    let contribution = revenue_clp - goods;
    let profit = contribution - costs;
    ExportResult {
        revenue_minor,
        revenue_clp,
        goods_cost_clp: goods,
        costs_clp: costs,
        contribution_clp: contribution,
        profit_clp: profit,
        margin_ppm: (revenue_clp > 0)
            .then(|| div_round(profit as i128 * 1_000_000, revenue_clp as i128) as i64),
        breakeven_revenue_clp: (contribution > 0)
            .then(|| div_round(costs as i128 * revenue_clp as i128, contribution as i128) as i64),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reparto_exacto_por_resto_mayor() {
        assert_eq!(allocate(100_000, &[100_000, 50_000]), vec![66_667, 33_333]);
        assert_eq!(allocate(10, &[1, 1, 1]), vec![4, 3, 3]);
        assert_eq!(allocate(7, &[0, 0]), vec![4, 3]);
        assert_eq!(allocate(0, &[5, 5]), vec![0, 0]);
        let v = allocate(999_999, &[3, 7, 11, 13]);
        assert_eq!(v.iter().sum::<i64>(), 999_999);
    }

    #[test]
    fn conversion_y_redondeo() {
        assert_eq!(div_round(5, 2), 3);
        assert_eq!(div_round(-5, 2), -3);
        // US$ 10,50 a $950,5 → $9.980,25 → $9.980
        assert_eq!(to_clp(1_050, 2, 950_500_000), 9_980);
        assert_eq!(to_clp(1_000, 0, 1_000_000), 1_000);
    }

    fn base() -> LandedInput {
        LandedInput {
            currency_decimals: 2,
            rate_e6: 950_000_000,
            basis: Basis::Unidades,
            vat_ppm: Some(150_000), // tasa de EJEMPLO
            vat_recoverable: true,
            notional_insurance_ppm: None,
            items: vec![
                LandedItem {
                    qty_milli: 100_000,
                    unit_price_minor: 1_000,
                    weight_g: Some(500),
                    volume_cm3: None,
                    duty_ppm: Some(50_000),
                },
                LandedItem {
                    qty_milli: 50_000,
                    unit_price_minor: 2_000,
                    weight_g: Some(3_000),
                    volume_cm3: None,
                    duty_ppm: None,
                },
            ],
            costs: vec![
                LandedCost {
                    kind: CostKind::Flete,
                    amount_clp: 190_000,
                    basis: Some(Basis::Valor),
                    recoverable: false,
                },
                LandedCost {
                    kind: CostKind::Seguro,
                    amount_clp: 19_000,
                    basis: None,
                    recoverable: false,
                },
                LandedCost {
                    kind: CostKind::AgenteAduana,
                    amount_clp: 100_000,
                    basis: None,
                    recoverable: false,
                },
            ],
        }
    }

    #[test]
    fn costo_puesto_en_bodega_con_tasas() {
        let r = landed_cost(&base());
        assert_eq!(r.fob_minor, 200_000);
        assert_eq!(r.fob_clp, 1_900_000);
        assert_eq!(r.customs_value_clp, 2_109_000);
        assert_eq!(r.items[0].customs_value_clp, 1_054_500);
        assert_eq!(r.duty_clp, 52_725);
        assert_eq!(r.items[0].vat_clp, 166_084);
        assert_eq!(r.items[1].vat_clp, 158_175);
        assert_eq!(r.recoverable_clp, 324_259);
        assert_eq!(r.items[0].local_clp, 66_667);
        assert_eq!(r.items[0].landed_clp, 1_173_892);
        assert_eq!(r.items[0].unit_cost_e4, 117_389_200);
        assert_eq!(r.items[1].landed_clp, 1_087_833);
        assert_eq!(r.landed_clp, 2_261_725);
        assert!(r.notes.is_empty());
    }

    #[test]
    fn montos_reales_reemplazan_las_tasas_y_peso_sin_datos_cae_a_valor() {
        let mut i = base();
        i.basis = Basis::Volumen;
        i.costs.push(LandedCost {
            kind: CostKind::Derechos,
            amount_clp: 50_000,
            basis: None,
            recoverable: false,
        });
        i.costs.push(LandedCost {
            kind: CostKind::IvaImportacion,
            amount_clp: 300_000,
            basis: None,
            recoverable: false,
        });
        let r = landed_cost(&i);
        assert!(r.duty_entered && r.vat_entered);
        // Solo el producto con arancel recibe los derechos ingresados.
        assert_eq!((r.items[0].duty_clp, r.items[1].duty_clp), (50_000, 0));
        assert_eq!(r.vat_in_cost_clp, 300_000);
        assert_eq!(r.recoverable_clp, 0);
        assert_eq!(
            r.notes.len(),
            1,
            "sin volumen: el agente se reparte por valor"
        );
        assert_eq!(
            r.landed_clp,
            1_900_000 + 190_000 + 19_000 + 50_000 + 300_000 + 100_000
        );
    }

    #[test]
    fn seguro_teorico_suma_al_valor_aduanero_pero_no_al_costo() {
        let mut i = base();
        // Sin seguro contratado: seguro teórico de EJEMPLO (2 %) sobre la mercadería ($1.900.000).
        i.costs.retain(|c| c.kind != CostKind::Seguro);
        i.notional_insurance_ppm = Some(20_000);
        let r = landed_cost(&i);
        assert_eq!(r.notional_insurance_clp, 38_000);
        assert_eq!(r.insurance_clp, 0);
        assert_eq!(r.customs_value_clp, 1_900_000 + 190_000 + 38_000);
        // El IVA (recuperable) se calcula sobre el valor aduanero con seguro teórico…
        assert_eq!(
            r.vat_clp,
            div_round((2_128_000 + r.duty_clp) as i128 * 150_000, 1_000_000) as i64
        );
        // …pero el costo en bodega no incluye el seguro teórico.
        assert_eq!(r.landed_clp, 1_900_000 + 190_000 + r.duty_clp + 100_000);
        assert_eq!(
            r.items
                .iter()
                .map(|x| x.notional_insurance_clp)
                .sum::<i64>(),
            38_000
        );
        // Con seguro contratado, el teórico se ignora y se avisa.
        let mut j = base();
        j.notional_insurance_ppm = Some(20_000);
        let r2 = landed_cost(&j);
        assert_eq!(r2.notional_insurance_clp, 0);
        assert!(r2.notes.iter().any(|n| n.contains("seguro teórico")));
    }

    #[test]
    fn margen_y_punto_de_equilibrio_de_exportacion() {
        let r = export_margin(&ExportInput {
            currency_decimals: 2,
            rate_e6: 900_000_000,
            items: vec![ExportItem {
                qty_milli: 1_000_000,
                unit_price_minor: 500,
                unit_cost_e4: 25_000_000,
            }],
            costs_clp: vec![600_000, 150_000],
        });
        assert_eq!(r.revenue_clp, 4_500_000);
        assert_eq!(r.goods_cost_clp, 2_500_000);
        assert_eq!(r.profit_clp, 1_250_000);
        assert_eq!(r.margin_ppm, Some(277_778));
        assert_eq!(r.breakeven_revenue_clp, Some(1_687_500));
    }
}
