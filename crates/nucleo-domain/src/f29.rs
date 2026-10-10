//! Borrador del Formulario 29 (declaración mensual de IVA y otros impuestos).
//!
//! NÚCLEO **no declara**: arma el borrador código por código para que la persona lo copie en
//! sii.cl, y explica de dónde sale cada monto. Cálculo puro y entero (pesos), sin tasas escritas
//! aquí: la tasa de PPM es la de la empresa, el reajuste del remanente usa la UTM de cada mes y las
//! retenciones e impuesto único se reciben como montos (fuente: instrucciones del F29 del SII,
//! nov-2024; ver `docs/F29.md`).
//!
//! Entrada: los documentos tributarios del período (registro de compras y ventas importado del SII
//! o derivado de NÚCLEO), el remanente del mes anterior, la tasa de PPM y los montos manuales.
//! Salida: el valor de cada código del formulario y avisos en lenguaje claro.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::comex::div_round;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Direction {
    Venta,
    Compra,
}

/// Clasificación de una compra para el crédito fiscal (columna "Tipo Compra" del registro del SII).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PurchaseKind {
    /// Compra del giro con derecho a crédito.
    Giro,
    /// Supermercados y comercios similares (art. 23 N°4 DL 825).
    Supermercado,
    ActivoFijo,
    /// IVA de uso común: se acredita en la proporción que se indique.
    UsoComun,
    SinDerecho,
    BienRaiz,
}

/// Un documento (o un resumen de documentos del mismo tipo, como las boletas) del período.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TaxDoc {
    pub direction: Direction,
    /// Código de tipo de documento del SII (33 factura electrónica, 39 boleta, 61 nota de
    /// crédito, 914 declaración de ingreso…).
    pub sii_type: u32,
    /// Cantidad de documentos que representa la fila (1 para un documento; n para un resumen).
    #[serde(default = "one")]
    pub count: i64,
    #[serde(default)]
    pub exempt: i64,
    #[serde(default)]
    pub net: i64,
    /// IVA del documento (ventas: débito; compras: IVA recuperable).
    #[serde(default)]
    pub tax: i64,
    /// Compras: IVA no recuperable.
    #[serde(default)]
    pub tax_non_recoverable: i64,
    /// Compras: IVA de uso común.
    #[serde(default)]
    pub common_use_tax: i64,
    #[serde(default)]
    pub kind: Option<PurchaseKind>,
    /// Ventas: operación no del giro (por ejemplo, venta de un activo fijo).
    #[serde(default)]
    pub not_of_business: bool,
}

fn one() -> i64 {
    1
}

/// Remanente de crédito fiscal declarado el mes anterior (código 77) y las UTM para reajustarlo.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Remnant {
    pub amount: i64,
    /// UTM del mes en que se produjo el remanente (0 = falta).
    pub utm_prev: i64,
    /// UTM del mes que se declara (0 = falta).
    pub utm_cur: i64,
    /// Decimales al convertir a UTM; `None` = sin redondeo intermedio.
    #[serde(default)]
    pub utm_decimals: Option<u32>,
}

/// Pago provisional mensual (PPM) obligatorio.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Ppm {
    /// Tasa de la empresa en partes por millón de los ingresos (0,25 % = 2.500).
    pub rate_ppm: i64,
    /// Código 68: crédito imputable al PPM (PPV reajustado, etc.).
    #[serde(default)]
    pub credit: i64,
    /// Código 30: pérdida tributaria del ejercicio anterior, que suspende el PPM.
    #[serde(default)]
    pub loss: bool,
    /// Base distinta a la calculada desde las ventas (si el contador lo indica).
    #[serde(default)]
    pub base_override: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct F29Input {
    #[serde(default)]
    pub docs: Vec<TaxDoc>,
    #[serde(default)]
    pub remnant: Option<Remnant>,
    #[serde(default)]
    pub ppm: Option<Ppm>,
    /// Proporción del IVA de uso común que da derecho a crédito, en partes por millón.
    #[serde(default)]
    pub common_use_ppm: Option<i64>,
    /// Montos que se ingresan a mano (48 impuesto único, 151 retención de honorarios, 49, 155,
    /// 50, 153, 156…).
    #[serde(default)]
    pub manual: BTreeMap<u32, i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    Info,
    Aviso,
    /// Falta un dato para completar el borrador.
    Falta,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Note {
    pub code: Option<u32>,
    pub severity: Severity,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct F29Result {
    /// Valor de cada código con contenido (los vacíos no aparecen).
    pub codes: BTreeMap<u32, i64>,
    pub notes: Vec<Note>,
    /// `false` si falta algún dato (UTM, tasa de PPM, proporción de uso común).
    pub complete: bool,
}

/// Códigos que se ingresan a mano y suman al subtotal (código 595).
pub const MANUAL_CODES: [u32; 7] = [48, 151, 49, 155, 50, 153, 156];

/// Tipos de documento de venta que forman la base del PPM (suman; las notas de crédito restan).
fn ppm_sign(t: u32) -> i64 {
    match t {
        30 | 33 | 32 | 34 | 35 | 38 | 39 | 41 | 48 | 55 | 56 | 110 | 111 => 1,
        60 | 61 | 112 => -1,
        _ => 0,
    }
}

struct Acc {
    codes: BTreeMap<u32, i64>,
}

impl Acc {
    fn add(&mut self, code: u32, v: i64) {
        *self.codes.entry(code).or_insert(0) += v;
    }
    fn get(&self, code: u32) -> i64 {
        self.codes.get(&code).copied().unwrap_or(0)
    }
}

pub fn compute(input: &F29Input) -> F29Result {
    let mut a = Acc {
        codes: BTreeMap::new(),
    };
    let mut notes: Vec<Note> = Vec::new();
    let mut complete = true;
    let mut note = |code: Option<u32>, severity: Severity, text: String| {
        if !notes.iter().any(|n| n.text == text) {
            notes.push(Note {
                code,
                severity,
                text,
            });
        }
    };
    let mut common_use_tax = 0i64;
    let mut common_use_docs = 0i64;
    let mut ppm_base = 0i64;
    let mut unsupported: BTreeMap<u32, i64> = BTreeMap::new();

    for d in &input.docs {
        let n = d.count;
        match d.direction {
            Direction::Venta => {
                if !d.not_of_business {
                    ppm_base += ppm_sign(d.sii_type) * (d.net + d.exempt);
                }
                match (d.sii_type, d.not_of_business) {
                    (30 | 33, false) => {
                        a.add(503, n);
                        a.add(502, d.tax);
                    }
                    (30 | 33, true) => {
                        a.add(716, n);
                        a.add(717, d.tax);
                    }
                    (32 | 34 | 38 | 41, false) => {
                        a.add(586, n);
                        a.add(142, d.exempt + d.net);
                    }
                    (32 | 34 | 38 | 41, true) => {
                        a.add(714, n);
                        a.add(715, d.exempt + d.net);
                    }
                    (35 | 39, _) => {
                        a.add(110, n);
                        a.add(111, d.tax);
                    }
                    (48, _) => {
                        a.add(758, n);
                        a.add(759, d.tax);
                    }
                    (55 | 56, _) => {
                        a.add(512, n);
                        a.add(513, d.tax);
                    }
                    (60 | 61, false) => {
                        a.add(509, n);
                        a.add(510, d.tax);
                    }
                    (60 | 61, true) => {
                        a.add(733, n);
                        a.add(734, d.tax);
                    }
                    (110 | 111, _) => {
                        a.add(585, n);
                        a.add(20, d.exempt + d.net);
                    }
                    (112, _) => {
                        a.add(585, n);
                        a.add(20, -(d.exempt + d.net));
                    }
                    (t, _) => *unsupported.entry(t).or_insert(0) += n,
                }
            }
            Direction::Compra => match d.sii_type {
                30 | 33 => match d.kind.unwrap_or(PurchaseKind::Giro) {
                    PurchaseKind::Giro => {
                        a.add(519, n);
                        a.add(520, d.tax);
                        if d.tax_non_recoverable > 0 && d.tax == 0 {
                            note(
                                Some(520),
                                Severity::Aviso,
                                "Hay facturas con IVA no recuperable marcadas como del giro: revisa su clasificación.".into(),
                            );
                        }
                    }
                    PurchaseKind::Supermercado => {
                        a.add(761, n);
                        a.add(762, d.tax);
                    }
                    PurchaseKind::ActivoFijo => {
                        a.add(524, n);
                        a.add(525, d.tax);
                    }
                    PurchaseKind::UsoComun => {
                        a.add(519, n);
                        a.add(520, d.tax);
                        common_use_tax += d.common_use_tax;
                        common_use_docs += n;
                    }
                    PurchaseKind::SinDerecho => {
                        a.add(564, n);
                        a.add(521, d.net + d.exempt);
                    }
                    PurchaseKind::BienRaiz => *unsupported.entry(d.sii_type).or_insert(0) += n,
                },
                32 | 34 => {
                    a.add(584, n);
                    a.add(562, d.exempt + d.net);
                }
                55 | 56 => {
                    a.add(531, n);
                    a.add(532, d.tax);
                }
                60 | 61 => {
                    a.add(527, n);
                    a.add(528, d.tax);
                }
                914 => match d.kind.unwrap_or(PurchaseKind::Giro) {
                    PurchaseKind::ActivoFijo => {
                        a.add(536, n);
                        a.add(553, d.tax);
                    }
                    PurchaseKind::SinDerecho => {
                        a.add(566, n);
                        a.add(560, d.net + d.exempt);
                    }
                    _ => {
                        a.add(534, n);
                        a.add(535, d.tax);
                    }
                },
                // Boletas recibidas: no dan crédito fiscal ni van al F29.
                35 | 38 | 39 | 41 => {}
                t => *unsupported.entry(t).or_insert(0) += n,
            },
        }
    }
    for (t, n) in &unsupported {
        note(
            None,
            Severity::Aviso,
            format!(
                "{n} documento(s) de tipo {t} no se incluyen en el borrador: complétalos tú en sii.cl."
            ),
        );
    }

    // IVA de uso común: solo la proporción con derecho a crédito.
    if common_use_tax > 0 {
        match input.common_use_ppm {
            Some(p) => {
                let credit = div_round(common_use_tax as i128 * p as i128, 1_000_000) as i64;
                a.add(520, credit);
                note(
                    Some(520),
                    Severity::Info,
                    format!(
                        "IVA de uso común de {common_use_docs} documento(s): se acreditan ${credit} de ${common_use_tax} según la proporción indicada."
                    ),
                );
            }
            None => {
                complete = false;
                note(
                    Some(520),
                    Severity::Falta,
                    format!(
                        "Hay ${common_use_tax} de IVA de uso común: indica la proporción con derecho a crédito (la define tu contador)."
                    ),
                );
            }
        }
    }

    // Remanente del mes anterior, reajustado por la variación de la UTM (art. 27 DL 825).
    if let Some(r) = &input.remnant
        && r.amount > 0
    {
        if r.utm_prev <= 0 || r.utm_cur <= 0 {
            complete = false;
            note(
                Some(504),
                Severity::Falta,
                "Falta la UTM del mes anterior o la de este mes para reajustar el remanente."
                    .into(),
            );
        } else {
            let v = match r.utm_decimals {
                None => div_round(r.amount as i128 * r.utm_cur as i128, r.utm_prev as i128),
                Some(d) => {
                    let s = 10i128.pow(d);
                    let utm_scaled = div_round(r.amount as i128 * s, r.utm_prev as i128);
                    div_round(utm_scaled * r.utm_cur as i128, s)
                }
            } as i64;
            a.add(504, v);
        }
    }

    // Débitos y créditos (líneas 23 y 49).
    let debit =
        a.get(502) + a.get(717) + a.get(111) + a.get(759) + a.get(513) - a.get(510) - a.get(734);
    let credit = a.get(520) + a.get(762) + a.get(525) - a.get(528)
        + a.get(532)
        + a.get(535)
        + a.get(553)
        + a.get(504);
    a.codes.insert(538, debit);
    a.codes.insert(537, credit);
    if credit > debit {
        a.codes.insert(77, credit - debit);
        a.codes.insert(89, 0);
    } else {
        a.codes.insert(77, 0);
        a.codes.insert(89, debit - credit);
    }

    // PPM obligatorio (línea 69).
    let mut ppm_amount = 0i64;
    match &input.ppm {
        Some(p) if p.loss => {
            a.codes.insert(30, 1);
            note(
                Some(62),
                Severity::Info,
                "Pérdida tributaria declarada: el PPM queda suspendido este mes.".into(),
            );
        }
        Some(p) => {
            let base = p.base_override.unwrap_or(ppm_base).max(0);
            let gross = div_round(base as i128 * p.rate_ppm as i128, 1_000_000) as i64;
            ppm_amount = (gross - p.credit).max(0);
            a.codes.insert(563, base);
            a.codes.insert(115, p.rate_ppm);
            if p.credit > 0 {
                a.codes.insert(68, p.credit);
            }
            a.codes.insert(62, ppm_amount);
        }
        None => {
            if ppm_base > 0 {
                complete = false;
                note(
                    Some(62),
                    Severity::Falta,
                    "Falta la tasa de PPM de la empresa (la ves en sii.cl o te la indica tu contador).".into(),
                );
            }
        }
    }

    // Retenciones, impuesto único y otros montos manuales (líneas 59–70).
    let mut manual_sum = 0i64;
    for code in MANUAL_CODES {
        if let Some(v) = input.manual.get(&code).copied()
            && v != 0
        {
            a.codes.insert(code, v);
            manual_sum += v;
        }
    }

    let subtotal = a.get(89) + manual_sum + ppm_amount;
    a.codes.insert(595, subtotal);
    a.codes.insert(547, subtotal);
    a.codes.insert(91, subtotal.max(0));
    a.codes
        .retain(|k, v| *v != 0 || matches!(k, 538 | 537 | 89 | 77 | 595 | 547 | 91));

    F29Result {
        codes: a.codes,
        notes,
        complete,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn venta(t: u32, count: i64, net: i64, exempt: i64, tax: i64) -> TaxDoc {
        TaxDoc {
            direction: Direction::Venta,
            sii_type: t,
            count,
            exempt,
            net,
            tax,
            tax_non_recoverable: 0,
            common_use_tax: 0,
            kind: None,
            not_of_business: false,
        }
    }
    fn compra(t: u32, kind: Option<PurchaseKind>, net: i64, tax: i64) -> TaxDoc {
        TaxDoc {
            direction: Direction::Compra,
            kind,
            ..venta(t, 1, net, 0, tax)
        }
    }

    #[test]
    fn debito_credito_y_resultado() {
        let r = compute(&F29Input {
            docs: vec![
                venta(33, 2, 1_000_000, 0, 190_000),
                venta(61, 1, 100_000, 0, 19_000),
                compra(33, None, 500_000, 95_000),
                compra(33, Some(PurchaseKind::SinDerecho), 10_000, 0),
                compra(39, None, 20_000, 0),
            ],
            ppm: Some(Ppm {
                rate_ppm: 2_500, // tasa de EJEMPLO
                credit: 0,
                loss: false,
                base_override: None,
            }),
            ..Default::default()
        });
        assert_eq!(r.codes[&538], 171_000);
        assert_eq!(r.codes[&537], 95_000);
        assert_eq!(r.codes[&89], 76_000);
        assert_eq!(r.codes[&521], 10_000);
        assert_eq!(r.codes[&563], 900_000);
        assert_eq!(r.codes[&62], 2_250);
        assert_eq!(r.codes[&91], 78_250);
        assert!(r.complete);
    }

    #[test]
    fn falta_la_tasa_de_ppm_y_la_utm() {
        let r = compute(&F29Input {
            docs: vec![venta(33, 1, 100_000, 0, 19_000)],
            remnant: Some(Remnant {
                amount: 5_000,
                utm_prev: 0,
                utm_cur: 69_000,
                utm_decimals: None,
            }),
            ..Default::default()
        });
        assert!(!r.complete);
        assert_eq!(
            r.notes
                .iter()
                .filter(|n| n.severity == Severity::Falta)
                .count(),
            2
        );
    }
}
