//! Casos de uso de NÚCLEO COMEX (Fase 9): carpetas de importación con etapas, ETA e historial,
//! costos estimados y reales (con cuentas por pagar), costo puesto en bodega por producto,
//! recepción a stock al costo final, cierre con comparación estimado vs. real, e Incoterms.
//!
//! Ningún arancel ni tasa está escrito aquí: los ingresa el usuario (COMEX_RULES.md). Los
//! resultados se rotulan como simulación hasta que un contador o agente de aduana firme los
//! casos golden (D-07).

use crate::company::CompanySession;
use crate::purchase_ops::{stock_in, timeline};
use crate::sales_ops::{
    MAX_LINES, MAX_PRICE_MINOR, MAX_QTY_MILLI, Payment, TimelineItem, local_today, log,
    method_code, method_label, opt_text, parse_date,
};
use crate::{AppError, AppResult};
use nucleo_db::comex::{
    self as db, CostWrite, EtaChange, ImportCostRow, ImportItemRow, ImportRow, ImportSummary,
    ImportWrite, IncotermRow, ItemWrite, StageChange,
};
use nucleo_db::finance as fdb;
use nucleo_db::products;
use nucleo_db::purchases as pdb;
use nucleo_db::sales as sdb;
use nucleo_db::{core as dbcore, now_utc};
use nucleo_domain::comex::{
    Basis, CostKind, LandedCost, LandedInput, LandedItem, LandedResult, landed_cost, to_clp,
};
use serde::{Deserialize, Serialize};

/// Etapas que se eligen a mano (recibida, cerrada y anulada tienen su propia acción).
const MANUAL_STAGES: [&str; 10] = [
    "cotizacion",
    "ordenada",
    "pagada",
    "produccion",
    "lista_despacho",
    "embarcada",
    "en_transito",
    "arribada",
    "internacion",
    "transporte_local",
];

pub fn stage_label(s: &str) -> &'static str {
    match s {
        "cotizacion" => "Cotización",
        "ordenada" => "Ordenada",
        "pagada" => "Pagada al proveedor",
        "produccion" => "En producción",
        "lista_despacho" => "Lista para despacho",
        "embarcada" => "Embarcada",
        "en_transito" => "En tránsito",
        "arribada" => "Arribada",
        "internacion" => "En internación",
        "transporte_local" => "Transporte local",
        "recibida" => "Recibida",
        "cerrada" => "Cerrada",
        "anulada" => "Anulada",
        _ => "Etapa",
    }
}

fn cost_label(k: &str) -> &'static str {
    match k {
        "flete" => "Flete internacional",
        "seguro" => "Seguro",
        "derechos" => "Derechos de aduana",
        "iva_importacion" => "IVA de importación",
        "agente_aduana" => "Agente de aduana",
        "gastos_portuarios" => "Gastos portuarios",
        "almacenaje" => "Almacenaje",
        "transporte_interno" => "Transporte local",
        "gastos_bancarios" => "Gastos bancarios",
        _ => "Otros",
    }
}

/* ───────────────────────────── Tipos de la interfaz ───────────────────────────── */

#[derive(Debug, Clone, Deserialize)]
pub struct ImportItemInput {
    pub product_uid: Option<String>,
    pub description: String,
    pub qty_milli: i64,
    pub unit_price_minor: i64,
    pub weight_g: Option<i64>,
    pub volume_cm3: Option<i64>,
    pub duty_ppm: Option<i64>,
    pub hs_code: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ImportInput {
    pub supplier_uid: Option<String>,
    pub incoterm: Option<String>,
    pub transport_mode: Option<String>,
    pub origin_country: Option<String>,
    pub origin_port: Option<String>,
    pub destination_port: Option<String>,
    pub currency_code: String,
    pub rate_e6: Option<i64>,
    pub purchase_date: Option<String>,
    pub production_eta: Option<String>,
    pub shipment_date: Option<String>,
    pub eta: Option<String>,
    pub arrival_date: Option<String>,
    pub allocation_basis: String,
    pub vat_ppm: Option<i64>,
    pub vat_recoverable: bool,
    /// Seguro teórico (% de la mercadería) para el valor aduanero si no se contrató seguro.
    #[serde(default)]
    pub notional_insurance_ppm: Option<i64>,
    pub notes: Option<String>,
    pub items: Vec<ImportItemInput>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ImportCostInput {
    pub kind: String,
    pub description: Option<String>,
    pub supplier_uid: Option<String>,
    pub currency_code: String,
    pub amount_minor: i64,
    pub rate_e6: Option<i64>,
    pub is_estimate: bool,
    #[serde(default)]
    pub recoverable_tax: bool,
    pub allocation_basis: Option<String>,
    pub document_ref: Option<String>,
    pub cost_date: Option<String>,
    /// Solo costos reales: "por_pagar" (crea cuenta por pagar), "pagado" o "no_registrar".
    #[serde(default)]
    pub payment: Option<String>,
    pub due_date: Option<String>,
    pub paid_method: Option<String>,
    pub paid_account_uid: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ImportReceiveLine {
    pub item_id: i64,
    pub qty_milli: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImportCostView {
    #[serde(flatten)]
    pub cost: ImportCostRow,
    /// Monto en pesos con su tipo de cambio (o el de la carpeta).
    pub amount_clp: i64,
    pub payments: Vec<Payment>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImportDetail {
    #[serde(flatten)]
    pub header: ImportRow,
    pub items: Vec<ImportItemRow>,
    pub costs: Vec<ImportCostView>,
    /// Cálculo con los costos vigentes (estimados y reales).
    pub calc: LandedResult,
    pub has_estimates: bool,
    pub editable: bool,
    pub receivable: bool,
    pub stage_history: Vec<StageChange>,
    pub eta_history: Vec<EtaChange>,
    pub receipts: Vec<ReceiptRef>,
    pub incoterm_info: Option<IncotermRow>,
    pub timeline: Vec<TimelineItem>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReceiptRef {
    pub number: String,
    pub date: String,
}

/* ───────────────────────────── Auxiliares ───────────────────────────── */

/// Cabecera, productos, ETA y partidas arancelarias validados de una carpeta.
type ImportFields<'a> = (
    ImportWrite<'a>,
    Vec<ItemWrite<'a>>,
    Option<String>,
    Vec<Option<String>>,
);

fn basis(s: &str) -> AppResult<Basis> {
    Basis::parse(s).ok_or_else(|| AppError::Validation("criterio de reparto no válido".into()))
}

fn opt_date(label: &str, v: &Option<String>) -> AppResult<Option<String>> {
    match v.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(d) => Ok(Some(parse_date(label, d)?)),
        None => Ok(None),
    }
}

/// Convierte un costo a pesos: con su tasa, la de la carpeta si es la misma moneda, o 1 si es CLP.
fn cost_clp(c: &ImportCostRow, h: &ImportRow) -> i64 {
    let rate = c.rate_e6.or(if c.currency_code == "CLP" {
        Some(1_000_000)
    } else if c.currency_code == h.currency_code {
        h.rate_e6
    } else {
        None
    });
    rate.map(|r| to_clp(c.amount_minor, c.currency_decimals, r))
        .unwrap_or(0)
}

fn landed_input(h: &ImportRow, items: &[ImportItemRow], costs: &[ImportCostView]) -> LandedInput {
    LandedInput {
        currency_decimals: h.currency_decimals,
        // Una importación en pesos no necesita tipo de cambio.
        rate_e6: h.rate_e6.unwrap_or(if h.currency_code == "CLP" {
            1_000_000
        } else {
            0
        }),
        basis: Basis::parse(&h.allocation_basis).unwrap_or(Basis::Valor),
        vat_ppm: h.vat_ppm,
        vat_recoverable: h.vat_recoverable,
        notional_insurance_ppm: h.notional_insurance_ppm,
        items: items
            .iter()
            .map(|i| LandedItem {
                qty_milli: i.qty_milli,
                unit_price_minor: i.unit_price_minor,
                weight_g: i.weight_g,
                volume_cm3: i.volume_cm3,
                duty_ppm: i.duty_ppm,
            })
            .collect(),
        costs: costs
            .iter()
            .filter(|c| c.cost.status == "vigente")
            .filter_map(|c| {
                Some(LandedCost {
                    kind: CostKind::parse(&c.cost.kind)?,
                    amount_clp: c.amount_clp,
                    basis: c.cost.allocation_basis.as_deref().and_then(Basis::parse),
                    recoverable: c.cost.recoverable_tax,
                })
            })
            .collect(),
    }
}

impl CompanySession {
    fn import_row(&self, uid: &str) -> AppResult<ImportRow> {
        db::import_by_uid(self.db.conn(), uid)?
            .ok_or_else(|| AppError::NotFound("esa importación".into()))
    }

    pub fn incoterms(&self) -> AppResult<Vec<IncotermRow>> {
        self.require("comex.ver")?;
        Ok(db::incoterms(self.db.conn())?)
    }

    pub fn list_imports(&self, view: &str, query: &str) -> AppResult<Vec<ImportSummary>> {
        self.require("comex.ver")?;
        Ok(db::list_imports(self.db.conn(), view, query, 500)?)
    }

    pub fn import(&self, uid: &str) -> AppResult<ImportDetail> {
        self.require("comex.ver")?;
        let conn = self.db.conn();
        let h = self.import_row(uid)?;
        let items = db::import_items(conn, h.id)?;
        let pays = db::cost_payments(conn, h.id)?;
        let costs: Vec<ImportCostView> = db::import_costs(conn, h.id)?
            .into_iter()
            .map(|c| ImportCostView {
                amount_clp: cost_clp(&c, &h),
                payments: pays
                    .iter()
                    .filter(|p| p.0 == c.id && p.5 == "vigente")
                    .map(|p| Payment {
                        number: p.1.clone(),
                        date: p.2.clone(),
                        amount_minor: p.3,
                        method: method_label(&p.4).into(),
                    })
                    .collect(),
                cost: c,
            })
            .collect();
        let mut calc = landed_cost(&landed_input(&h, &items, &costs));
        for c in costs
            .iter()
            .filter(|c| c.cost.status == "vigente" && c.amount_clp == 0 && c.cost.amount_minor > 0)
        {
            calc.notes.push(format!(
                "{} en {} no tiene tipo de cambio: no se sumó.",
                cost_label(&c.cost.kind),
                c.cost.currency_code
            ));
        }
        let has_estimates = costs
            .iter()
            .any(|c| c.cost.status == "vigente" && c.cost.is_estimate);
        let any_received = items.iter().any(|i| i.received_milli > 0);
        let open = !matches!(h.stage.as_str(), "cerrada" | "anulada");
        let incoterm_info = match &h.incoterm {
            Some(code) => db::incoterms(conn)?.into_iter().find(|i| &i.code == code),
            None => None,
        };
        Ok(ImportDetail {
            editable: open && h.stage != "recibida" && !any_received,
            receivable: open
                && h.stage != "cotizacion"
                && items
                    .iter()
                    .any(|i| i.received_milli < i.qty_milli && i.product_id.is_some()),
            stage_history: db::stage_history(conn, h.id)?,
            eta_history: db::eta_history(conn, h.id)?,
            receipts: db::import_receipts(conn, h.id)?
                .into_iter()
                .map(|(number, date)| ReceiptRef { number, date })
                .collect(),
            timeline: timeline(conn, "importacion", &h.uid)?,
            incoterm_info,
            has_estimates,
            calc,
            items,
            costs,
            header: h,
        })
    }

    fn import_fields<'a>(&self, input: &'a ImportInput) -> AppResult<ImportFields<'a>> {
        let conn = self.db.conn();
        let supplier_id = match input.supplier_uid.as_deref().filter(|u| !u.is_empty()) {
            Some(u) => Some(
                nucleo_db::suppliers::by_uid(conn, u)?
                    .ok_or_else(|| AppError::NotFound("el proveedor".into()))?
                    .id,
            ),
            None => None,
        };
        let currency = input.currency_code.trim();
        if db::currency_decimals(conn, currency)?.is_none() {
            return Err(AppError::Validation(
                "elige una moneda registrada en Configuración → Monedas".into(),
            ));
        }
        if input
            .rate_e6
            .is_some_and(|r| r <= 0 || r > 1_000_000_000_000)
        {
            return Err(AppError::Validation(
                "el tipo de cambio no es válido".into(),
            ));
        }
        let incoterm = input
            .incoterm
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty());
        if let Some(code) = incoterm
            && db::incoterm_exists(conn, code)?.is_none()
        {
            return Err(AppError::Validation(format!(
                "el Incoterm {code} no está en la guía"
            )));
        }
        let transport = input.transport_mode.as_deref().filter(|s| !s.is_empty());
        if transport.is_some_and(|t| {
            !matches!(
                t,
                "maritimo" | "aereo" | "terrestre" | "courier" | "multimodal"
            )
        }) {
            return Err(AppError::Validation("medio de transporte no válido".into()));
        }
        basis(&input.allocation_basis)?;
        if input.vat_ppm.is_some_and(|v| !(0..=1_000_000).contains(&v)) {
            return Err(AppError::Validation(
                "la tasa de IVA de importación debe estar entre 0 % y 100 %".into(),
            ));
        }
        if input
            .notional_insurance_ppm
            .is_some_and(|v| !(0..=1_000_000).contains(&v))
        {
            return Err(AppError::Validation(
                "el seguro teórico debe estar entre 0 % y 100 %".into(),
            ));
        }
        if input.items.is_empty() || input.items.len() > MAX_LINES {
            return Err(AppError::Validation(
                "agrega al menos un producto a la importación".into(),
            ));
        }
        let mut items = Vec::with_capacity(input.items.len());
        let mut hs = Vec::with_capacity(input.items.len());
        for (n, it) in input.items.iter().enumerate() {
            let line = n + 1;
            let product_id = match it.product_uid.as_deref().filter(|u| !u.is_empty()) {
                Some(u) => Some(
                    products::by_uid(conn, u)?
                        .ok_or_else(|| {
                            AppError::NotFound(format!("el producto de la línea {line}"))
                        })?
                        .id,
                ),
                None => None,
            };
            if it.description.trim().is_empty() || it.description.chars().count() > 300 {
                return Err(AppError::Validation(format!(
                    "línea {line}: escribe la descripción del producto"
                )));
            }
            if it.qty_milli <= 0 || it.qty_milli > MAX_QTY_MILLI {
                return Err(AppError::Validation(format!(
                    "línea {line}: la cantidad debe ser mayor que cero"
                )));
            }
            if it.unit_price_minor < 0 || it.unit_price_minor > MAX_PRICE_MINOR {
                return Err(AppError::Validation(format!(
                    "línea {line}: el precio no es válido"
                )));
            }
            if it.weight_g.is_some_and(|w| w < 0) || it.volume_cm3.is_some_and(|v| v < 0) {
                return Err(AppError::Validation(format!(
                    "línea {line}: peso y volumen no pueden ser negativos"
                )));
            }
            if it.duty_ppm.is_some_and(|d| !(0..=1_000_000).contains(&d)) {
                return Err(AppError::Validation(format!(
                    "línea {line}: el arancel debe estar entre 0 % y 100 %"
                )));
            }
            hs.push(opt_text(&it.hs_code, 20, "la partida arancelaria")?);
            items.push(ItemWrite {
                product_id,
                description: it.description.trim(),
                qty_milli: it.qty_milli,
                unit_price_minor: it.unit_price_minor,
                weight_g: it.weight_g,
                volume_cm3: it.volume_cm3,
                duty_ppm: it.duty_ppm,
                hs_code: None,
            });
        }
        let eta = opt_date("la fecha estimada de llegada", &input.eta)?;
        let w = ImportWrite {
            supplier_id,
            incoterm,
            incoterm_version: None,
            transport_mode: transport,
            origin_country: input
                .origin_country
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty()),
            origin_port: input
                .origin_port
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty()),
            destination_port: input
                .destination_port
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty()),
            currency_code: currency,
            rate_e6: input.rate_e6,
            purchase_date: None,
            production_eta: None,
            shipment_date: None,
            arrival_date: None,
            allocation_basis: &input.allocation_basis,
            vat_ppm: input.vat_ppm,
            vat_recoverable: input.vat_recoverable,
            notional_insurance_ppm: input.notional_insurance_ppm,
            notes: input
                .notes
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty()),
        };
        // Las fechas y la versión del Incoterm se resuelven en `save_import`.
        Ok((w, items, eta, hs))
    }

    /// Crea (sin `uid`) o actualiza una carpeta de importación.
    pub fn save_import(
        &mut self,
        input: &ImportInput,
        uid: Option<&str>,
    ) -> AppResult<ImportDetail> {
        self.require("comex.editar")?;
        let conn = self.db.conn();
        for (label, v) in [
            ("la fecha de compra", &input.purchase_date),
            ("la fecha de término de producción", &input.production_eta),
            ("la fecha de embarque", &input.shipment_date),
            ("la fecha de arribo", &input.arrival_date),
        ] {
            opt_date(label, v)?;
        }
        let incoterm_version = match input
            .incoterm
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            Some(code) => db::incoterm_exists(conn, code)?,
            None => None,
        };
        let existing = match uid {
            Some(u) => Some(self.import_row(u)?),
            None => None,
        };
        if let Some(h) = &existing {
            let items = db::import_items(conn, h.id)?;
            if matches!(h.stage.as_str(), "recibida" | "cerrada" | "anulada")
                || items.iter().any(|i| i.received_milli > 0)
            {
                return Err(AppError::Validation(
                    "esta importación ya tiene mercadería recibida o está cerrada: solo puedes cambiar costos".into(),
                ));
            }
        }
        let (mut w, items, eta, hs) = self.import_fields(input)?;
        let purchase = opt_date("la fecha de compra", &input.purchase_date)?;
        let production = opt_date("la fecha de término de producción", &input.production_eta)?;
        let shipment = opt_date("la fecha de embarque", &input.shipment_date)?;
        let arrival = opt_date("la fecha de arribo", &input.arrival_date)?;
        w.incoterm_version = incoterm_version.as_deref();
        w.purchase_date = purchase.as_deref();
        w.production_eta = production.as_deref();
        w.shipment_date = shipment.as_deref();
        w.arrival_date = arrival.as_deref();
        let items: Vec<ItemWrite<'_>> = items
            .into_iter()
            .zip(hs.iter())
            .map(|(mut i, h)| {
                i.hs_code = h.as_deref();
                i
            })
            .collect();
        let now = now_utc();
        let by = self.user_id();
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        let (id, iuid) = match &existing {
            Some(h) => {
                db::update_import(&tx, h.id, &w, &now)?;
                if let Some(e) = eta.as_deref() {
                    db::set_eta(&tx, h.id, e, None, by)?;
                }
                log(
                    &tx,
                    &user,
                    "importacion.editar",
                    "importacion",
                    &h.uid,
                    "Datos de la importación actualizados",
                    None,
                )?;
                (h.id, h.uid.clone())
            }
            None => {
                let number = dbcore::take_number(&tx, "IMP")?;
                let iuid = uuid::Uuid::now_v7().to_string();
                let id = db::insert_import(&tx, &iuid, &number, &w, eta.as_deref(), by, &now)?;
                log(
                    &tx,
                    &user,
                    "importacion.crear",
                    "importacion",
                    &iuid,
                    &format!("{number} creada como cotización"),
                    None,
                )?;
                (id, iuid)
            }
        };
        // Conserva el costo estimado por producto al editar una importación ya confirmada.
        let old = db::import_items(&tx, id)?;
        db::replace_items(&tx, id, &items)?;
        for new in db::import_items(&tx, id)? {
            if let Some(prev) = old
                .iter()
                .find(|o| o.product_id.is_some() && o.product_id == new.product_id)
                && let Some(est) = prev.estimated_unit_cost_e4
            {
                tx.execute(
                    "UPDATE import_items SET estimated_unit_cost_e4 = ?2 WHERE id = ?1",
                    (new.id, est),
                )?;
            }
        }
        tx.commit()?;
        self.import(&iuid)
    }

    /// Avanza o corrige la etapa. Al salir de "cotización" se guarda la foto del costo estimado.
    pub fn set_import_stage(
        &mut self,
        uid: &str,
        stage: &str,
        note: Option<&str>,
    ) -> AppResult<ImportDetail> {
        self.require("comex.editar")?;
        if !MANUAL_STAGES.contains(&stage) {
            return Err(AppError::Validation(match stage {
                "recibida" => {
                    "para pasar a Recibida, registra la recepción de la mercadería".into()
                }
                "cerrada" => "usa “Cerrar importación” para fijar el costo final".into(),
                "anulada" => "usa “Anular” e indica el motivo".into(),
                _ => "etapa no válida".into(),
            }));
        }
        let detail = self.import(uid)?;
        let h = &detail.header;
        if matches!(h.stage.as_str(), "recibida" | "cerrada" | "anulada") {
            return Err(AppError::Validation(format!(
                "la importación está {}: ya no cambia de etapa",
                stage_label(&h.stage).to_lowercase()
            )));
        }
        if detail.items.iter().any(|i| i.received_milli > 0) {
            return Err(AppError::Validation(
                "ya se recibió mercadería: completa la recepción".into(),
            ));
        }
        if h.stage == stage {
            return Ok(detail);
        }
        let leaving_quote = h.stage == "cotizacion" && stage != "cotizacion";
        if leaving_quote && h.rate_e6.is_none() && h.currency_code != "CLP" {
            return Err(AppError::Validation(
                "indica el tipo de cambio antes de confirmar la importación".into(),
            ));
        }
        let note = note.map(str::trim).filter(|s| !s.is_empty());
        let now = now_utc();
        let today = local_today(self.db.conn())?;
        let by = self.user_id();
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        db::set_stage(&tx, h.id, stage, by, note)?;
        match stage {
            "ordenada" => db::set_dates(&tx, h.id, "purchase_date", &today)?,
            "embarcada" | "en_transito" => db::set_dates(&tx, h.id, "shipment_date", &today)?,
            "arribada" | "internacion" | "transporte_local" => {
                db::set_dates(&tx, h.id, "arrival_date", &today)?
            }
            _ => {}
        }
        if leaving_quote && h.estimated_landed_clp.is_none() {
            let units: Vec<(i64, i64)> = detail
                .items
                .iter()
                .zip(&detail.calc.items)
                .map(|(i, c)| (i.id, c.unit_cost_e4))
                .collect();
            db::set_estimate(&tx, h.id, detail.calc.landed_clp, &units, &now)?;
        }
        let mut text = format!("Etapa: {}", stage_label(stage));
        if let Some(n) = note {
            text.push_str(&format!(" · {n}"));
        }
        if leaving_quote && h.estimated_landed_clp.is_none() {
            text.push_str(" · se guardó el costo estimado para compararlo al cerrar");
        }
        log(
            &tx,
            &user,
            "importacion.etapa",
            "importacion",
            uid,
            &text,
            None,
        )?;
        tx.commit()?;
        self.import(uid)
    }

    pub fn change_import_eta(
        &mut self,
        uid: &str,
        eta: &str,
        reason: Option<&str>,
    ) -> AppResult<ImportDetail> {
        self.require("comex.editar")?;
        let h = self.import_row(uid)?;
        if matches!(h.stage.as_str(), "recibida" | "cerrada" | "anulada") {
            return Err(AppError::Validation(
                "la mercadería ya llegó: la ETA no cambia".into(),
            ));
        }
        let eta = parse_date("la nueva fecha de llegada", eta)?;
        let reason = reason.map(str::trim).filter(|s| !s.is_empty());
        if h.eta.is_some() && reason.is_none() {
            return Err(AppError::Validation(
                "indica por qué cambió la fecha de llegada (queda en el historial)".into(),
            ));
        }
        let by = self.user_id();
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        if db::set_eta(&tx, h.id, &eta, reason, by)? {
            let text = match (&h.eta, reason) {
                (Some(old), Some(r)) => format!("ETA cambió de {old} a {eta}: {r}"),
                _ => format!("ETA: {eta}"),
            };
            log(
                &tx,
                &user,
                "importacion.eta",
                "importacion",
                uid,
                &text,
                reason,
            )?;
        }
        tx.commit()?;
        self.import(uid)
    }

    fn cost_fields<'a>(
        &self,
        h: &ImportRow,
        c: &'a ImportCostInput,
    ) -> AppResult<(CostWrite<'a>, Option<String>, Option<String>)> {
        let conn = self.db.conn();
        if CostKind::parse(&c.kind).is_none() {
            return Err(AppError::Validation("tipo de costo no válido".into()));
        }
        let currency = c.currency_code.trim();
        if db::currency_decimals(conn, currency)?.is_none() {
            return Err(AppError::Validation("moneda no registrada".into()));
        }
        if c.amount_minor <= 0 || c.amount_minor > MAX_PRICE_MINOR {
            return Err(AppError::Validation(
                "el monto debe ser mayor que cero".into(),
            ));
        }
        if c.rate_e6.is_some_and(|r| r <= 0) {
            return Err(AppError::Validation(
                "el tipo de cambio no es válido".into(),
            ));
        }
        if currency != "CLP" && currency != h.currency_code && c.rate_e6.is_none() {
            return Err(AppError::Validation(format!(
                "indica el tipo de cambio de {currency} para este costo"
            )));
        }
        if let Some(b) = c.allocation_basis.as_deref().filter(|b| !b.is_empty()) {
            basis(b)?;
        }
        let supplier_id = match c.supplier_uid.as_deref().filter(|u| !u.is_empty()) {
            Some(u) => Some(
                nucleo_db::suppliers::by_uid(conn, u)?
                    .ok_or_else(|| AppError::NotFound("el proveedor del costo".into()))?
                    .id,
            ),
            None => None,
        };
        let date = opt_date("la fecha del costo", &c.cost_date)?;
        let desc = opt_text(&c.description, 200, "la descripción")?;
        Ok((
            CostWrite {
                kind: &c.kind,
                description: None,
                supplier_id,
                currency_code: currency,
                amount_minor: c.amount_minor,
                rate_e6: c.rate_e6,
                is_estimate: c.is_estimate,
                recoverable_tax: c.recoverable_tax,
                allocation_basis: c.allocation_basis.as_deref().filter(|b| !b.is_empty()),
                document_ref: c
                    .document_ref
                    .as_deref()
                    .map(str::trim)
                    .filter(|s| !s.is_empty()),
                cost_date: None,
            },
            desc,
            date,
        ))
    }

    /// Agrega un costo. Si es real y se indica, crea la cuenta por pagar o registra el pago.
    pub fn add_import_cost(
        &mut self,
        uid: &str,
        input: &ImportCostInput,
    ) -> AppResult<ImportDetail> {
        self.require("comex.editar")?;
        let h = self.import_row(uid)?;
        if matches!(h.stage.as_str(), "cerrada" | "anulada") {
            return Err(AppError::Validation("la importación está cerrada".into()));
        }
        let (mut w, desc, date) = self.cost_fields(&h, input)?;
        w.description = desc.as_deref();
        w.cost_date = date.as_deref();
        let payment = if input.is_estimate {
            "no_registrar"
        } else {
            input.payment.as_deref().unwrap_or("no_registrar")
        };
        if !matches!(payment, "por_pagar" | "pagado" | "no_registrar") {
            return Err(AppError::Validation(
                "indica si el costo está pagado o por pagar".into(),
            ));
        }
        if payment != "no_registrar" {
            self.require("dinero.registrar")?;
        }
        let today = local_today(self.db.conn())?;
        let cost_date = date.clone().unwrap_or_else(|| today.clone());
        let due = match opt_date("el vencimiento", &input.due_date)? {
            Some(d) => d,
            None => cost_date.clone(),
        };
        let now = now_utc();
        let by = self.user_id();
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        let id = db::insert_cost(&tx, h.id, &w, &now)?;
        let row = db::import_costs(&tx, h.id)?
            .into_iter()
            .find(|c| c.id == id)
            .ok_or_else(|| AppError::NotFound("el costo".into()))?;
        let clp = cost_clp(&row, &h);
        let label = desc
            .clone()
            .unwrap_or_else(|| cost_label(&input.kind).into());
        let mut text = format!(
            "{} {}: {label}",
            if input.is_estimate {
                "Costo estimado"
            } else {
                "Costo real"
            },
            cost_label(&input.kind).to_lowercase()
        );
        if payment != "no_registrar" {
            if clp <= 0 {
                return Err(AppError::Validation(
                    "falta el tipo de cambio para llevar este costo a Dinero".into(),
                ));
            }
            let pay = db::insert_cost_payable(&tx, id, w.supplier_id, &due, clp)?;
            if payment == "pagado" {
                let m = input
                    .paid_method
                    .as_deref()
                    .ok_or_else(|| AppError::Validation("indica el medio de pago".into()))?;
                let code = method_code(m);
                let acc = crate::finance_ops::account_for(
                    &tx,
                    input.paid_account_uid.as_deref(),
                    code,
                    &now,
                )?;
                let pnum = dbcore::take_number(&tx, "EGR")?;
                fdb::insert_payable_payment(
                    &tx,
                    &uuid::Uuid::now_v7().to_string(),
                    &pnum,
                    w.supplier_id,
                    acc,
                    &cost_date,
                    code,
                    clp,
                    pay,
                    by,
                    &now,
                )?;
                text.push_str(&format!(" · pagado ({}) · {pnum}", method_label(code)));
            } else {
                text.push_str(&format!(" · queda en Dinero que debes (vence {due})"));
            }
        }
        log(
            &tx,
            &user,
            "importacion.costo",
            "importacion",
            uid,
            &text,
            None,
        )?;
        tx.commit()?;
        self.import(uid)
    }

    /// Edita un costo estimado o real sin cuenta por pagar.
    pub fn update_import_cost(
        &mut self,
        uid: &str,
        cost_id: i64,
        input: &ImportCostInput,
    ) -> AppResult<ImportDetail> {
        self.require("comex.editar")?;
        let h = self.import_row(uid)?;
        if matches!(h.stage.as_str(), "cerrada" | "anulada") {
            return Err(AppError::Validation("la importación está cerrada".into()));
        }
        let cur = db::import_costs(self.db.conn(), h.id)?
            .into_iter()
            .find(|c| c.id == cost_id)
            .ok_or_else(|| AppError::NotFound("ese costo".into()))?;
        if cur.status != "vigente" || cur.payable_amount_minor.is_some() {
            return Err(AppError::Validation(
                "este costo ya está en Dinero: anúlalo y regístralo de nuevo".into(),
            ));
        }
        let (mut w, desc, date) = self.cost_fields(&h, input)?;
        w.description = desc.as_deref();
        w.cost_date = date.as_deref();
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        db::update_cost(&tx, cost_id, &w)?;
        log(
            &tx,
            &user,
            "importacion.costo",
            "importacion",
            uid,
            &format!(
                "{} actualizado{}",
                cost_label(&input.kind),
                if cur.is_estimate && !input.is_estimate {
                    ": ahora es el monto real"
                } else {
                    ""
                }
            ),
            None,
        )?;
        tx.commit()?;
        self.import(uid)
    }

    /// Quita un costo: los estimados se eliminan; los reales se anulan con motivo (y su deuda y pagos).
    pub fn remove_import_cost(
        &mut self,
        uid: &str,
        cost_id: i64,
        reason: Option<&str>,
    ) -> AppResult<ImportDetail> {
        self.require("comex.editar")?;
        let h = self.import_row(uid)?;
        if matches!(h.stage.as_str(), "cerrada" | "anulada") {
            return Err(AppError::Validation("la importación está cerrada".into()));
        }
        let cur = db::import_costs(self.db.conn(), h.id)?
            .into_iter()
            .find(|c| c.id == cost_id && c.status == "vigente")
            .ok_or_else(|| AppError::NotFound("ese costo".into()))?;
        let user = self.actor_name()?;
        let reason = reason.map(str::trim).filter(|s| !s.is_empty());
        let tx = self.db.conn_mut().transaction()?;
        if cur.is_estimate {
            db::delete_cost(&tx, cost_id)?;
            log(
                &tx,
                &user,
                "importacion.costo",
                "importacion",
                uid,
                &format!("Estimado quitado: {}", cost_label(&cur.kind)),
                None,
            )?;
        } else {
            let r = reason.ok_or_else(|| {
                AppError::Validation(
                    "escribe el motivo: los costos reales se anulan, no se borran".into(),
                )
            })?;
            let n = db::void_cost(&tx, cost_id, &format!("Costo de importación anulado: {r}"))?;
            let mut text = format!("Costo anulado: {} · {r}", cost_label(&cur.kind));
            if n > 0 {
                text.push_str(" · sus pagos se anularon y el dinero vuelve a la cuenta");
            }
            log(
                &tx,
                &user,
                "importacion.costo",
                "importacion",
                uid,
                &text,
                Some(r),
            )?;
        }
        tx.commit()?;
        self.import(uid)
    }

    pub fn pay_import_cost(
        &mut self,
        uid: &str,
        cost_id: i64,
        amount_minor: i64,
        method: &str,
        date: &str,
        account_uid: Option<&str>,
    ) -> AppResult<ImportDetail> {
        self.require("dinero.registrar")?;
        let h = self.import_row(uid)?;
        let cur = db::import_costs(self.db.conn(), h.id)?
            .into_iter()
            .find(|c| c.id == cost_id && c.status == "vigente")
            .ok_or_else(|| AppError::NotFound("ese costo".into()))?;
        let due = cur.payable_amount_minor.unwrap_or(0) - cur.payable_paid_minor.unwrap_or(0);
        if due <= 0 {
            return Err(AppError::Validation(
                "este costo no tiene saldo por pagar".into(),
            ));
        }
        if amount_minor <= 0 || amount_minor > due {
            return Err(AppError::Validation(
                "el monto debe ser mayor que cero y no superar el saldo".into(),
            ));
        }
        let date = parse_date("la fecha del pago", date)?;
        let now = now_utc();
        let by = self.user_id();
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        let pay = db::open_cost_payable(&tx, cost_id)?
            .ok_or_else(|| AppError::Validation("este costo no tiene saldo por pagar".into()))?;
        let code = method_code(method);
        let acc = crate::finance_ops::account_for(&tx, account_uid, code, &now)?;
        let pnum = dbcore::take_number(&tx, "EGR")?;
        fdb::insert_payable_payment(
            &tx,
            &uuid::Uuid::now_v7().to_string(),
            &pnum,
            cur.supplier_id,
            acc,
            &date,
            code,
            amount_minor,
            pay,
            by,
            &now,
        )?;
        log(
            &tx,
            &user,
            "importacion.pagar",
            "importacion",
            uid,
            &format!(
                "{} de {} ({}) · {pnum}",
                if amount_minor == due {
                    "Pago final"
                } else {
                    "Abono"
                },
                cost_label(&cur.kind).to_lowercase(),
                method_label(code)
            ),
            None,
        )?;
        tx.commit()?;
        self.import(uid)
    }

    /// Recibe la mercadería en la bodega principal al costo puesto en bodega calculado hoy.
    /// `lines` vacío = todo lo pendiente.
    pub fn receive_import(
        &mut self,
        uid: &str,
        lines: &[ImportReceiveLine],
        date: &str,
    ) -> AppResult<ImportDetail> {
        self.require("comex.editar")?;
        let d = self.import(uid)?;
        let h = &d.header;
        if !d.receivable {
            return Err(AppError::Validation(match h.stage.as_str() {
                "cotizacion" => {
                    "confirma la importación (pásala a Ordenada) antes de recibir".into()
                }
                _ => "no hay mercadería pendiente de recibir".into(),
            }));
        }
        let supplier = h.supplier_id.ok_or_else(|| {
            AppError::Validation("indica el proveedor de la importación antes de recibir".into())
        })?;
        if h.rate_e6.is_none() && h.currency_code != "CLP" {
            return Err(AppError::Validation(
                "indica el tipo de cambio antes de recibir".into(),
            ));
        }
        let date = parse_date("la fecha de recepción", date)?;
        let mut plan: Vec<(i64, i64, i64, i64)> = Vec::new(); // (ítem, producto, cantidad, costo e4)
        for (i, c) in d.items.iter().zip(&d.calc.items) {
            let Some(pid) = i.product_id else { continue };
            let pending = i.qty_milli - i.received_milli;
            let qty = if lines.is_empty() {
                pending
            } else {
                match lines.iter().find(|l| l.item_id == i.id) {
                    Some(l) if l.qty_milli < 0 || l.qty_milli > pending => {
                        return Err(AppError::Validation(format!(
                            "{}: puedes recibir hasta lo pendiente",
                            i.description
                        )));
                    }
                    Some(l) => l.qty_milli,
                    None => 0,
                }
            };
            if qty > 0 {
                plan.push((i.id, pid, qty, c.unit_cost_e4));
            }
        }
        if plan.is_empty() {
            return Err(AppError::Validation(
                "indica qué cantidades llegaron".into(),
            ));
        }
        let now = now_utc();
        let by = self.user_id();
        let user = self.actor_name()?;
        let estimates = d.has_estimates;
        let units: Vec<(i64, i64)> = d
            .items
            .iter()
            .zip(&d.calc.items)
            .map(|(i, c)| (i.id, c.unit_cost_e4))
            .collect();
        let tx = self.db.conn_mut().transaction()?;
        let wh = products::default_warehouse(&tx, &now)?;
        let rnum = dbcore::take_number(&tx, "REC")?;
        let rid = pdb::insert_receipt(
            &tx,
            &uuid::Uuid::now_v7().to_string(),
            &rnum,
            supplier,
            None,
            wh,
            &date,
            by,
            &now,
        )?;
        tx.execute(
            "UPDATE receipts SET import_id = ?2 WHERE id = ?1",
            (rid, h.id),
        )?;
        for (item, pid, qty, cost) in &plan {
            db::add_received(&tx, *item, *qty)?;
            if products::by_id(&tx, *pid)?.is_some_and(|p| p.track_stock) {
                pdb::insert_receipt_item(&tx, rid, None, *pid, *qty, *cost)?;
                stock_in(
                    &tx,
                    *pid,
                    wh,
                    *qty,
                    *cost,
                    &date,
                    ("REC", rid, Some(*item)),
                    by,
                    &now,
                )?;
            }
        }
        db::set_landed(&tx, h.id, d.calc.fob_minor, d.calc.landed_clp, &units)?;
        let complete = db::import_items(&tx, h.id)?
            .iter()
            .filter(|i| i.product_id.is_some())
            .all(|i| i.received_milli >= i.qty_milli);
        if complete {
            db::set_stage(&tx, h.id, "recibida", by, Some(&rnum))?;
            tx.execute(
                "UPDATE imports SET reception_date = ?2 WHERE id = ?1",
                (h.id, &date),
            )?;
        }
        sdb::insert_link(&tx, ("REC", rid), ("IMP", h.id), "recibe", &now)?;
        let mut text = format!(
            "{} ({rnum}): stock y costo promedio actualizados al costo puesto en bodega",
            if complete {
                "Mercadería recibida completa"
            } else {
                "Recepción parcial"
            }
        );
        if estimates {
            text.push_str(" · incluye costos estimados");
        }
        log(
            &tx,
            &user,
            "importacion.recibir",
            "importacion",
            uid,
            &text,
            None,
        )?;
        tx.commit()?;
        self.import(uid)
    }

    /// Cierra la carpeta: fija el costo final y lo compara con el estimado.
    pub fn close_import(&mut self, uid: &str) -> AppResult<ImportDetail> {
        self.require("comex.editar")?;
        let d = self.import(uid)?;
        let h = &d.header;
        if h.stage != "recibida" {
            return Err(AppError::Validation(
                "solo se cierra una importación recibida completa".into(),
            ));
        }
        if d.has_estimates {
            return Err(AppError::Validation(
                "quedan costos estimados: reemplázalos por los montos reales (o quítalos) antes de cerrar".into(),
            ));
        }
        let by = self.user_id();
        let user = self.actor_name()?;
        let units: Vec<(i64, i64)> = d
            .items
            .iter()
            .zip(&d.calc.items)
            .map(|(i, c)| (i.id, c.unit_cost_e4))
            .collect();
        let tx = self.db.conn_mut().transaction()?;
        db::set_landed(&tx, h.id, d.calc.fob_minor, d.calc.landed_clp, &units)?;
        db::set_stage(&tx, h.id, "cerrada", by, None)?;
        let mut text = format!("Cerrada: costo final ${}", thousands(d.calc.landed_clp));
        if let Some(est) = h.estimated_landed_clp {
            let diff = d.calc.landed_clp - est;
            text.push_str(&format!(
                " · estimado ${} · diferencia {}${}",
                thousands(est),
                if diff < 0 { "−" } else { "+" },
                thousands(diff.abs())
            ));
        }
        log(
            &tx,
            &user,
            "importacion.cerrar",
            "importacion",
            uid,
            &text,
            None,
        )?;
        tx.commit()?;
        self.import(uid)
    }

    pub fn void_import(&mut self, uid: &str, reason: &str) -> AppResult<ImportDetail> {
        self.require("comex.editar")?;
        let reason = reason.trim();
        if reason.is_empty() || reason.chars().count() > 500 {
            return Err(AppError::Validation(
                "escribe el motivo de la anulación".into(),
            ));
        }
        let d = self.import(uid)?;
        let h = &d.header;
        if h.stage == "anulada" {
            return Err(AppError::Validation(
                "la importación ya está anulada".into(),
            ));
        }
        if d.items.iter().any(|i| i.received_milli > 0) {
            return Err(AppError::Validation(
                "ya se recibió mercadería: no se puede anular (corrige con un ajuste de inventario)".into(),
            ));
        }
        let by = self.user_id();
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        let mut paid = 0;
        for c in d
            .costs
            .iter()
            .filter(|c| c.cost.status == "vigente" && !c.cost.is_estimate)
        {
            paid += db::void_cost(&tx, c.cost.id, &format!("Importación anulada: {reason}"))?;
        }
        db::void_import(&tx, h.id, reason, by)?;
        let mut text = format!("Anulada: {reason}");
        if paid > 0 {
            text.push_str(" · los pagos de sus costos se anularon");
        }
        log(
            &tx,
            &user,
            "importacion.anular",
            "importacion",
            uid,
            &text,
            Some(reason),
        )?;
        tx.commit()?;
        self.import(uid)
    }
}

fn thousands(n: i64) -> String {
    let s = n.abs().to_string();
    let mut out = String::new();
    for (i, ch) in s.chars().enumerate() {
        if i > 0 && (s.len() - i).is_multiple_of(3) {
            out.push('.');
        }
        out.push(ch);
    }
    if n < 0 { format!("-{out}") } else { out }
}

#[cfg(test)]
mod tests {
    use super::thousands;

    #[test]
    fn miles_con_punto() {
        assert_eq!(thousands(0), "0");
        assert_eq!(thousands(1_234_567), "1.234.567");
        assert_eq!(thousands(-950), "-950");
    }
}
