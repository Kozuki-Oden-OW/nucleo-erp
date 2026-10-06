//! Casos de uso de Ventas (Fase 5): productos base, cotizaciones, ventas y facturas internas,
//! efectuar (stock y costo), cobros, documentación externa y anulación.
//!
//! Recordatorio permanente (ADR-003): NÚCLEO **no emite documentos tributarios**. La venta y la
//! factura interna son documentos internos; la documentación tributaria se hace fuera de NÚCLEO y
//! aquí solo se anota su referencia.

use crate::company::CompanySession;
use crate::{AppError, AppResult};
use nucleo_db::audit::{self, AuditEntry};
use nucleo_db::customers::{self, CustomerRow};
use nucleo_db::products::{self, Movement, NewProductRow, ProductRow};
use nucleo_db::sales::{
    self as db, ExternalRefRow, LineRow, NewLine, PaymentWrite, QuoteRow, QuoteWrite, SaleRow,
    SaleView, SaleWrite, Totals,
};
use nucleo_db::{core as dbcore, now_utc};
use nucleo_domain::RoundingMode;
use nucleo_domain::pricing::{self, TaxParams, TaxRoundingScope};
use nucleo_domain::sales_state::{self, CommercialState, DocumentationState, PaymentState};
use rusqlite::Connection;
use rust_decimal::Decimal;
use rust_decimal::prelude::ToPrimitive;
use serde::{Deserialize, Serialize};

pub(crate) const MAX_LINES: usize = 500;
pub(crate) const MAX_QTY_MILLI: i64 = 1_000_000_000_000;
pub(crate) const MAX_PRICE_MINOR: i64 = 10_000_000_000_000;

/* ───────────────────────────── Tipos de la interfaz ───────────────────────────── */

#[derive(Debug, Clone, Deserialize)]
pub struct NewProduct {
    pub sku: Option<String>,
    pub name: String,
    pub unit: Option<String>,
    /// "producto" o "servicio".
    pub kind: String,
    pub price_minor: i64,
    pub cost_minor: Option<i64>,
    pub taxable: Option<bool>,
    /// Stock con que parte el producto (milésimas). Solo productos, no servicios.
    pub initial_stock_milli: Option<i64>,
}

/// Cambios a la ficha de un producto (el stock y el costo no se editan aquí).
#[derive(Debug, Clone, Deserialize)]
pub struct ProductPatch {
    pub name: String,
    pub sku: String,
    pub unit: String,
    pub price_minor: i64,
    pub taxable: bool,
    pub min_milli: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LineInput {
    pub product_uid: Option<String>,
    pub description: String,
    pub qty_milli: i64,
    pub unit_price_minor: i64,
    pub discount_ppm: i64,
    pub taxable: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Line {
    pub line_no: i64,
    pub product_uid: Option<String>,
    pub description: String,
    pub qty_milli: i64,
    pub unit_price_minor: i64,
    pub discount_ppm: i64,
    pub taxable: bool,
    pub net_minor: i64,
    pub discount_minor: i64,
    pub unit_cost_e4: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct QuoteSummary {
    pub uid: String,
    pub number: String,
    pub customer_name: String,
    pub issue_date: String,
    pub valid_until: Option<String>,
    pub status: String,
    pub total_minor: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct QuoteDetail {
    #[serde(flatten)]
    pub summary: QuoteSummary,
    pub customer_uid: Option<String>,
    pub lines: Vec<Line>,
    pub totals: Totals,
    pub notes: Option<String>,
    pub sale_uid: Option<String>,
    pub sale_number: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct QuoteInput {
    pub customer_uid: Option<String>,
    pub prospect_name: Option<String>,
    pub issue_date: String,
    pub valid_until: Option<String>,
    pub lines: Vec<LineInput>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SaleSummary {
    pub uid: String,
    pub doc_type: String,
    pub number: String,
    pub customer_name: String,
    pub issue_date: String,
    pub due_date: Option<String>,
    pub commercial_state: String,
    pub payment_state: String,
    pub documentation_state: String,
    pub total_minor: i64,
    pub paid_minor: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Payment {
    pub number: String,
    pub date: String,
    pub amount_minor: i64,
    pub method: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DocLink {
    pub number: String,
    pub kind: String,
    pub uid: Option<String>,
    pub label: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TimelineItem {
    pub at: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SaleDetail {
    #[serde(flatten)]
    pub summary: SaleSummary,
    pub customer_uid: Option<String>,
    pub lines: Vec<Line>,
    pub totals: Totals,
    pub cost_minor: i64,
    pub payment_method: Option<String>,
    pub notes: Option<String>,
    pub quote_uid: Option<String>,
    pub quote_number: Option<String>,
    pub payments: Vec<Payment>,
    pub external_ref: Option<ExternalRefRow>,
    pub void_reason: Option<String>,
    pub chain: Vec<DocLink>,
    pub timeline: Vec<TimelineItem>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SaleInput {
    pub doc_type: String,
    pub customer_uid: Option<String>,
    pub issue_date: String,
    pub lines: Vec<LineInput>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct EffectInput {
    /// "contado" o "credito".
    pub mode: String,
    pub method: String,
    pub due_date: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct ExternalRefInput {
    pub doc_kind: Option<String>,
    pub external_number: Option<String>,
    pub issue_date: Option<String>,
    pub observation: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct SaleFilter {
    pub query: Option<String>,
    pub view: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CustomerDetail {
    #[serde(flatten)]
    pub customer: CustomerRow,
    pub sales_count: i64,
    pub revenue_minor: i64,
    pub receivable_minor: i64,
    pub last_sale_date: Option<String>,
    pub avg_days_between: Option<i64>,
    pub recent: Vec<SaleSummary>,
}

/* ───────────────────────────── Funciones puras ───────────────────────────── */

/// Medios de pago: etiqueta de la interfaz ↔ código guardado.
pub fn method_code(label: &str) -> &'static str {
    let l = label.trim().to_lowercase();
    if l.starts_with("efectivo") {
        "efectivo"
    } else if l.starts_with("transferencia") {
        "transferencia"
    } else if l.contains("débito") || l.contains("debito") {
        "debito"
    } else if l.contains("crédito") || l.contains("credito") {
        "credito"
    } else if l.starts_with("cheque") {
        "cheque"
    } else {
        "otro"
    }
}

pub fn method_label(code: &str) -> &'static str {
    match code {
        "efectivo" => "Efectivo",
        "transferencia" => "Transferencia",
        "debito" => "Tarjeta de débito",
        "credito" => "Tarjeta de crédito",
        "cheque" => "Cheque",
        _ => "Otro",
    }
}

/// Calcula líneas y totales con la misma regla que la vista previa de la interfaz: redondeo
/// comercial e impuesto sobre el neto del documento. Sin tasa (`None`) todo queda exento.
pub fn compute(
    lines: &[(i64, i64, i64, bool)],
    tax_ppm: Option<i64>,
) -> AppResult<(Vec<(i64, i64)>, Totals)> {
    let tax = TaxParams {
        rate: tax_ppm.map(|p| Decimal::new(p, 6)).unwrap_or(Decimal::ZERO),
        rounding: RoundingMode::HalfAwayFromZero,
        scope: TaxRoundingScope::PerDocument,
    };
    let inputs: Vec<pricing::LineInput> = lines
        .iter()
        .map(|&(qty, price, ppm, taxable)| pricing::LineInput {
            quantity: Decimal::new(qty, 3),
            unit_price_minor: price,
            discount_pct: Decimal::new(ppm, 4),
            discount_minor: 0,
            taxable: taxable && tax_ppm.is_some(),
        })
        .collect();
    let per_line = inputs
        .iter()
        .map(|l| pricing::line_totals(l, &tax).map(|t| (t.net_minor, t.discount_minor)))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| AppError::Validation(e.to_string()))?;
    let d =
        pricing::document_totals(&inputs, &tax).map_err(|e| AppError::Validation(e.to_string()))?;
    Ok((
        per_line,
        Totals {
            net_minor: d.net_taxable_minor,
            exempt_minor: d.exempt_minor,
            discount_minor: d.discount_minor,
            tax_minor: d.tax_minor,
            total_minor: d.total_minor,
        },
    ))
}

/// Costo de una línea: costo unitario (diezmilésimas) × cantidad (milésimas), redondeado.
pub fn line_cost_minor(unit_cost_e4: i64, qty_milli: i64) -> i64 {
    let v = Decimal::from(unit_cost_e4) * Decimal::from(qty_milli) / Decimal::from(10_000_000);
    v.round_dp_with_strategy(0, rust_decimal::RoundingStrategy::MidpointAwayFromZero)
        .to_i64()
        .unwrap_or(i64::MAX)
}

pub(crate) fn parse_date(label: &str, s: &str) -> AppResult<String> {
    let fmt = time::macros::format_description!("[year]-[month]-[day]");
    time::Date::parse(s.trim(), &fmt)
        .map(|_| s.trim().to_string())
        .map_err(|_| AppError::Validation(format!("{label} no es una fecha válida")))
}

pub(crate) fn opt_text(v: &Option<String>, max: usize, label: &str) -> AppResult<Option<String>> {
    match v.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        None => Ok(None),
        Some(s) if s.chars().count() > max => Err(AppError::Validation(format!(
            "{label} admite hasta {max} caracteres"
        ))),
        Some(s) => Ok(Some(s.to_string())),
    }
}

pub(crate) fn local_today(conn: &Connection) -> AppResult<String> {
    Ok(conn.query_row("SELECT date('now', 'localtime')", [], |r| r.get(0))?)
}

fn commercial(s: &str) -> CommercialState {
    match s {
        "cotizada" => CommercialState::Cotizada,
        "aceptada" => CommercialState::Aceptada,
        "efectuada" => CommercialState::Efectuada,
        "cerrada" => CommercialState::Cerrada,
        "anulada" => CommercialState::Anulada,
        _ => CommercialState::Borrador,
    }
}

fn payment_str(p: PaymentState) -> &'static str {
    match p {
        PaymentState::SinPago => "sin_pago",
        PaymentState::Abonada => "abonada",
        PaymentState::Pagada => "pagada",
    }
}

fn documentation(s: &str) -> DocumentationState {
    match s {
        "pendiente" => DocumentationState::Pendiente,
        "documentada" => DocumentationState::Documentada,
        _ => DocumentationState::NoAplica,
    }
}

fn payment_of(s: &str) -> PaymentState {
    match s {
        "abonada" => PaymentState::Abonada,
        "pagada" => PaymentState::Pagada,
        _ => PaymentState::SinPago,
    }
}

fn is_draft(state: &str) -> bool {
    matches!(state, "borrador" | "cotizada" | "aceptada")
}

fn doc_label(doc_type: &str) -> &'static str {
    match doc_type {
        "FV" => "Factura interna",
        _ => "Venta",
    }
}

/* ───────────────────────────── Casos de uso ───────────────────────────── */

struct Prepared {
    lines: Vec<NewLine>,
    totals: Totals,
}

impl CompanySession {
    pub(crate) fn user_id(&self) -> Option<i64> {
        self.actor.as_ref().map(|a| a.user_id)
    }

    /// Tasa de impuesto aplicable (ppm) o `None` si el negocio no calcula impuesto.
    pub(crate) fn tax_ppm(&self) -> AppResult<Option<i64>> {
        let b = self.business()?;
        Ok(if b.tax_enabled { b.tax_rate_ppm } else { None })
    }

    fn customer_id(&self, uid: &Option<String>) -> AppResult<Option<i64>> {
        match uid.as_deref().filter(|u| !u.is_empty()) {
            None => Ok(None),
            Some(u) => Ok(Some(
                customers::by_uid(self.db.conn(), u)?
                    .ok_or_else(|| AppError::NotFound("el cliente".into()))?
                    .id,
            )),
        }
    }

    fn prepare_lines(&self, input: &[LineInput]) -> AppResult<Prepared> {
        if input.is_empty() {
            return Err(AppError::Validation(
                "agrega al menos un producto o servicio".into(),
            ));
        }
        if input.len() > MAX_LINES {
            return Err(AppError::Validation(format!(
                "un documento admite hasta {MAX_LINES} líneas"
            )));
        }
        let mut lines = Vec::with_capacity(input.len());
        let mut raw = Vec::with_capacity(input.len());
        for (i, l) in input.iter().enumerate() {
            let n = i + 1;
            let desc = l.description.trim();
            if desc.is_empty() || desc.chars().count() > 300 {
                return Err(AppError::Validation(format!(
                    "revisa la línea {n}: la descripción es obligatoria (hasta 300 caracteres)"
                )));
            }
            if l.qty_milli <= 0 || l.qty_milli > MAX_QTY_MILLI {
                return Err(AppError::Validation(format!(
                    "revisa la línea {n}: la cantidad debe ser mayor que cero"
                )));
            }
            if l.unit_price_minor < 0 || l.unit_price_minor > MAX_PRICE_MINOR {
                return Err(AppError::Validation(format!(
                    "revisa la línea {n}: el precio no es válido"
                )));
            }
            if !(0..=1_000_000).contains(&l.discount_ppm) {
                return Err(AppError::Validation(format!(
                    "revisa la línea {n}: el descuento debe estar entre 0 % y 100 %"
                )));
            }
            let product =
                match l.product_uid.as_deref().filter(|u| !u.is_empty()) {
                    Some(u) => Some(products::by_uid(self.db.conn(), u)?.ok_or_else(|| {
                        AppError::NotFound(format!("el producto de la línea {n}"))
                    })?),
                    None => None,
                };
            raw.push((l.qty_milli, l.unit_price_minor, l.discount_ppm, l.taxable));
            lines.push(NewLine {
                product_id: product.as_ref().map(|p| p.id),
                description: desc.to_string(),
                qty_milli: l.qty_milli,
                list_price_minor: product
                    .as_ref()
                    .map(|p| p.price_minor)
                    .unwrap_or(l.unit_price_minor),
                unit_price_minor: l.unit_price_minor,
                discount_ppm: l.discount_ppm,
                discount_minor: 0,
                taxable: l.taxable,
                net_minor: 0,
            });
        }
        let (per_line, totals) = compute(&raw, self.tax_ppm()?)?;
        for (l, (net, disc)) in lines.iter_mut().zip(per_line) {
            l.net_minor = net;
            l.discount_minor = disc;
        }
        Ok(Prepared { lines, totals })
    }

    fn to_lines(&self, rows: Vec<LineRow>) -> Vec<Line> {
        let costs = self.can("costos.ver");
        rows.into_iter()
            .map(|r| Line {
                line_no: r.line_no,
                product_uid: r.product_uid,
                description: r.description,
                qty_milli: r.qty_milli,
                unit_price_minor: r.unit_price_minor,
                discount_ppm: r.discount_ppm,
                taxable: r.taxable,
                net_minor: r.net_minor,
                discount_minor: r.discount_minor,
                unit_cost_e4: if costs { r.unit_cost_e4 } else { None },
            })
            .collect()
    }

    /* ───────────── Productos ───────────── */

    fn public_product(&self, mut p: ProductRow) -> ProductRow {
        if !self.can("costos.ver") {
            p.cost_e4 = 0;
        }
        p
    }

    pub fn search_products(&self, query: &str, limit: u32) -> AppResult<Vec<ProductRow>> {
        self.require("productos.ver")?;
        Ok(
            products::search(self.db.conn(), query, limit.clamp(1, 500))?
                .into_iter()
                .map(|p| self.public_product(p))
                .collect(),
        )
    }

    pub fn add_product(&mut self, input: &NewProduct) -> AppResult<ProductRow> {
        self.require("productos.editar")?;
        let name = input.name.trim();
        if name.is_empty() || name.chars().count() > 200 {
            return Err(AppError::Validation(
                "el nombre del producto es obligatorio (hasta 200 caracteres)".into(),
            ));
        }
        let kind = match input.kind.as_str() {
            "servicio" => "servicio",
            "producto" => "bien",
            _ => return Err(AppError::Validation("tipo de producto no válido".into())),
        };
        let sku = opt_text(&input.sku, 40, "el código")?;
        let unit = input
            .unit
            .as_deref()
            .map(|u| u.trim().to_uppercase())
            .filter(|u| !u.is_empty())
            .unwrap_or_else(|| {
                if kind == "servicio" {
                    "SV".into()
                } else {
                    "UN".into()
                }
            });
        if input.price_minor < 0 || input.price_minor > MAX_PRICE_MINOR {
            return Err(AppError::Validation("el precio no es válido".into()));
        }
        let cost = input.cost_minor.unwrap_or(0);
        if !(0..=MAX_PRICE_MINOR).contains(&cost) {
            return Err(AppError::Validation("el costo no es válido".into()));
        }
        let stock = input.initial_stock_milli.unwrap_or(0);
        if !(0..=MAX_QTY_MILLI).contains(&stock) || (stock > 0 && kind == "servicio") {
            return Err(AppError::Validation(
                "el stock inicial no es válido (los servicios no llevan stock)".into(),
            ));
        }
        let uid = uuid::Uuid::now_v7().to_string();
        let now = now_utc();
        let user_id = self.user_id();
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        let row = products::insert(
            &tx,
            &NewProductRow {
                uid: &uid,
                sku: sku.as_deref(),
                name,
                unit_code: &unit,
                kind,
                price_minor: input.price_minor,
                cost_e4: cost * 10_000,
                taxable: input.taxable.unwrap_or(true),
                created_at: &now,
            },
        )?;
        if stock > 0 {
            let wh = products::default_warehouse(&tx, &now)?;
            let today = local_today(&tx)?;
            products::insert_movement(
                &tx,
                &Movement {
                    product_id: row.id,
                    warehouse_id: wh,
                    date: &today,
                    kind: "inicial",
                    qty_milli: stock,
                    unit_cost_e4: cost * 10_000,
                    avg_cost_after_e4: cost * 10_000,
                    source_type: "AJU",
                    source_id: row.id,
                    source_line_id: None,
                    reason: Some("Stock inicial"),
                    created_by: user_id,
                    created_at: &now,
                },
            )?;
        }
        audit::append(
            &tx,
            &AuditEntry {
                user_name: &user,
                action: "producto.crear",
                entity: "producto",
                entity_id: Some(&uid),
                after_json: serde_json::to_string(&row).ok(),
                ..Default::default()
            },
        )?;
        tx.commit()?;
        let row = products::by_uid(self.db.conn(), &uid)?
            .ok_or_else(|| AppError::NotFound("el producto".into()))?;
        Ok(self.public_product(row))
    }

    pub fn update_product(&mut self, uid: &str, patch: &ProductPatch) -> AppResult<ProductRow> {
        self.require("productos.editar")?;
        let before = products::by_uid(self.db.conn(), uid)?
            .ok_or_else(|| AppError::NotFound("el producto".into()))?;
        let name = patch.name.trim();
        if name.is_empty() || name.chars().count() > 200 {
            return Err(AppError::Validation(
                "el nombre del producto es obligatorio (hasta 200 caracteres)".into(),
            ));
        }
        let sku = patch.sku.trim();
        if sku.is_empty() || sku.chars().count() > 40 {
            return Err(AppError::Validation(
                "el código es obligatorio (hasta 40 caracteres)".into(),
            ));
        }
        if !(0..=MAX_PRICE_MINOR).contains(&patch.price_minor) {
            return Err(AppError::Validation("el precio no es válido".into()));
        }
        if !(0..=MAX_QTY_MILLI).contains(&patch.min_milli) {
            return Err(AppError::Validation("el stock mínimo no es válido".into()));
        }
        let unit = patch.unit.trim().to_uppercase();
        let now = now_utc();
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        products::update(
            &tx,
            before.id,
            &products::ProductUpdate {
                name,
                sku,
                unit_code: &unit,
                price_minor: patch.price_minor,
                taxable: patch.taxable,
                min_stock_milli: (patch.min_milli > 0).then_some(patch.min_milli),
                updated_at: &now,
            },
        )?;
        let after = products::by_id(&tx, before.id)?
            .ok_or_else(|| AppError::NotFound("el producto".into()))?;
        audit::append(
            &tx,
            &AuditEntry {
                user_name: &user,
                action: "producto.editar",
                entity: "producto",
                entity_id: Some(uid),
                before_json: serde_json::to_string(&before).ok(),
                after_json: serde_json::to_string(&after).ok(),
                ..Default::default()
            },
        )?;
        tx.commit()?;
        Ok(self.public_product(after))
    }

    /* ───────────── Clientes ───────────── */

    pub fn update_customer(
        &mut self,
        uid: &str,
        input: &crate::NewCustomer,
    ) -> AppResult<CustomerRow> {
        self.require("clientes.editar")?;
        let before = customers::by_uid(self.db.conn(), uid)?
            .ok_or_else(|| AppError::NotFound("el cliente".into()))?;
        let (name, rut, email, phone) = crate::company::validate_customer(input)?;
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        customers::update(
            &tx,
            before.id,
            &name,
            rut.as_deref(),
            email.as_deref(),
            phone.as_deref(),
        )?;
        let after =
            customers::by_uid(&tx, uid)?.ok_or_else(|| AppError::NotFound("el cliente".into()))?;
        audit::append(
            &tx,
            &AuditEntry {
                user_name: &user,
                action: "cliente.editar",
                entity: "cliente",
                entity_id: Some(uid),
                before_json: serde_json::to_string(&before).ok(),
                after_json: serde_json::to_string(&after).ok(),
                ..Default::default()
            },
        )?;
        tx.commit()?;
        Ok(after)
    }

    pub fn customer_detail(&self, uid: &str) -> AppResult<CustomerDetail> {
        self.require("clientes.ver")?;
        let c = customers::by_uid(self.db.conn(), uid)?
            .ok_or_else(|| AppError::NotFound("el cliente".into()))?;
        let (stats, recent) = if self.can("ventas.ver") {
            (
                db::customer_stats(self.db.conn(), c.id)?,
                db::customer_recent_sales(self.db.conn(), c.id, 8)?
                    .into_iter()
                    .map(|s| sale_summary(&s))
                    .collect(),
            )
        } else {
            (Default::default(), Vec::new())
        };
        let avg = nucleo_domain::customers::average_interval_days(&stats.purchase_days)
            .and_then(|d| d.round().to_i64());
        Ok(CustomerDetail {
            customer: c,
            sales_count: stats.sales_count,
            revenue_minor: stats.revenue_minor,
            receivable_minor: stats.receivable_minor,
            last_sale_date: stats.last_sale_date,
            avg_days_between: avg,
            recent,
        })
    }

    /* ───────────── Cotizaciones ───────────── */

    fn quote_row(&self, uid: &str) -> AppResult<QuoteRow> {
        db::quote_by_uid(self.db.conn(), uid)?
            .ok_or_else(|| AppError::NotFound("esa cotización".into()))
    }

    fn quote_summary(&self, q: &QuoteRow, today: &str) -> QuoteSummary {
        let expired = matches!(q.status.as_str(), "borrador" | "enviada")
            && q.valid_until.as_deref().is_some_and(|v| v < today);
        QuoteSummary {
            uid: q.uid.clone(),
            number: q.number.clone(),
            customer_name: q.customer_name.clone(),
            issue_date: q.issue_date.clone(),
            valid_until: q.valid_until.clone(),
            status: if expired {
                "vencida".into()
            } else {
                q.status.clone()
            },
            total_minor: q.totals.total_minor,
        }
    }

    fn quote_detail(&self, q: QuoteRow) -> AppResult<QuoteDetail> {
        let today = local_today(self.db.conn())?;
        let lines = self.to_lines(db::quote_lines(self.db.conn(), q.id)?);
        let sale = db::sale_of_quote(self.db.conn(), q.id)?;
        Ok(QuoteDetail {
            summary: self.quote_summary(&q, &today),
            customer_uid: q.customer_uid.clone(),
            lines,
            totals: q.totals,
            notes: q.notes.clone(),
            sale_uid: sale.as_ref().map(|s| s.0.clone()),
            sale_number: sale.map(|s| s.1),
        })
    }

    pub fn list_quotes(&self, query: &str) -> AppResult<Vec<QuoteSummary>> {
        self.require("ventas.ver")?;
        let today = local_today(self.db.conn())?;
        Ok(db::list_quotes(self.db.conn(), query, 1000)?
            .iter()
            .map(|q| self.quote_summary(q, &today))
            .collect())
    }

    pub fn quote(&self, uid: &str) -> AppResult<QuoteDetail> {
        self.require("ventas.ver")?;
        let q = self.quote_row(uid)?;
        self.quote_detail(q)
    }

    pub fn save_quote(&mut self, input: &QuoteInput, uid: Option<&str>) -> AppResult<QuoteDetail> {
        self.require("ventas.crear")?;
        let customer_id = self.customer_id(&input.customer_uid)?;
        let prospect = opt_text(&input.prospect_name, 200, "el nombre del interesado")?;
        if customer_id.is_none() && prospect.is_none() {
            return Err(AppError::Validation(
                "elige un cliente o escribe el nombre del interesado".into(),
            ));
        }
        let issue = parse_date("la fecha", &input.issue_date)?;
        let valid = match input.valid_until.as_deref().filter(|v| !v.is_empty()) {
            Some(v) => Some(parse_date("la validez", v)?),
            None => None,
        };
        if valid.as_deref().is_some_and(|v| v < issue.as_str()) {
            return Err(AppError::Validation(
                "la validez no puede ser anterior a la fecha de la cotización".into(),
            ));
        }
        let notes = opt_text(&input.notes, 2000, "las notas")?;
        let p = self.prepare_lines(&input.lines)?;
        let existing = match uid {
            Some(u) => {
                let q = self.quote_row(u)?;
                if matches!(q.status.as_str(), "convertida" | "anulada") {
                    return Err(AppError::Validation(
                        "esta cotización ya no se puede modificar".into(),
                    ));
                }
                Some(q)
            }
            None => None,
        };
        let w = QuoteWrite {
            customer_id,
            prospect_name: if customer_id.is_some() {
                None
            } else {
                prospect.as_deref()
            },
            issue_date: &issue,
            valid_until: valid.as_deref(),
            totals: p.totals,
            notes: notes.as_deref(),
        };
        let now = now_utc();
        let user_id = self.user_id();
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        let (id, quid) = match &existing {
            Some(q) => {
                db::update_quote(&tx, q.id, &w, &now)?;
                (q.id, q.uid.clone())
            }
            None => {
                let quid = uuid::Uuid::now_v7().to_string();
                let number = dbcore::take_number(&tx, "COT")?;
                (
                    db::insert_quote(&tx, &quid, &number, &w, user_id, &now)?,
                    quid,
                )
            }
        };
        db::replace_quote_items(&tx, id, &p.lines)?;
        let number: String =
            tx.query_row("SELECT number FROM quotes WHERE id = ?1", [id], |r| {
                r.get(0)
            })?;
        let (action, text) = match existing {
            Some(_) => ("cotizacion.editar", "Cotización modificada".to_string()),
            None => ("cotizacion.crear", format!("Cotización {number} creada")),
        };
        log(&tx, &user, action, "cotizacion", &quid, &text, None)?;
        tx.commit()?;
        self.quote(&quid)
    }

    pub fn set_quote_status(&mut self, uid: &str, status: &str) -> AppResult<QuoteDetail> {
        self.require("ventas.crear")?;
        if !matches!(status, "enviada" | "aceptada" | "rechazada" | "anulada") {
            return Err(AppError::Validation(
                "estado de cotización no válido".into(),
            ));
        }
        let q = self.quote_row(uid)?;
        if matches!(q.status.as_str(), "convertida" | "anulada") {
            return Err(AppError::Validation(
                "esta cotización ya no cambia de estado".into(),
            ));
        }
        let now = now_utc();
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        db::set_quote_status(&tx, q.id, status, &now)?;
        log(
            &tx,
            &user,
            "cotizacion.estado",
            "cotizacion",
            &q.uid,
            &format!("Marcada como {status}"),
            None,
        )?;
        tx.commit()?;
        self.quote(uid)
    }

    /// Convierte la cotización en venta (aceptada) sin volver a digitar.
    pub fn convert_quote(&mut self, uid: &str) -> AppResult<SaleDetail> {
        self.require("ventas.crear")?;
        let q = self.quote_row(uid)?;
        match q.status.as_str() {
            "convertida" => {
                return Err(AppError::Validation(
                    "esta cotización ya se convirtió en venta".into(),
                ));
            }
            "anulada" | "rechazada" => {
                return Err(AppError::Validation(
                    "una cotización anulada o rechazada no se puede convertir".into(),
                ));
            }
            _ => {}
        }
        let input: Vec<LineInput> = db::quote_lines(self.db.conn(), q.id)?
            .into_iter()
            .map(|l| LineInput {
                product_uid: l.product_uid,
                description: l.description,
                qty_milli: l.qty_milli,
                unit_price_minor: l.unit_price_minor,
                discount_ppm: l.discount_ppm,
                taxable: l.taxable,
            })
            .collect();
        let p = self.prepare_lines(&input)?;
        let today = local_today(self.db.conn())?;
        let notes = match (&q.customer_id, &q.prospect_name) {
            (None, Some(name)) => Some(format!("Cliente: {name}")),
            _ => q.notes.clone(),
        };
        let now = now_utc();
        let user_id = self.user_id();
        let suid = uuid::Uuid::now_v7().to_string();
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        let number = dbcore::take_number(&tx, "VEN")?;
        let sid = db::insert_sale(
            &tx,
            &suid,
            "VEN",
            &number,
            "aceptada",
            &SaleWrite {
                customer_id: q.customer_id,
                issue_date: &today,
                totals: p.totals,
                notes: notes.as_deref(),
            },
            user_id,
            &now,
        )?;
        db::replace_sale_items(&tx, sid, &p.lines)?;
        db::insert_link(&tx, ("COT", q.id), ("VEN", sid), "convertido", &now)?;
        db::set_quote_status(&tx, q.id, "convertida", &now)?;
        log(
            &tx,
            &user,
            "cotizacion.convertir",
            "cotizacion",
            &q.uid,
            &format!("Convertida en {number}"),
            None,
        )?;
        log(
            &tx,
            &user,
            "venta.crear",
            "venta",
            &suid,
            &format!("Creada desde {} sin volver a digitar", q.number),
            None,
        )?;
        tx.commit()?;
        self.sale(&suid)
    }

    /* ───────────── Ventas ───────────── */

    fn sale_row(&self, uid: &str) -> AppResult<SaleRow> {
        db::sale_by_uid(self.db.conn(), uid)?.ok_or_else(|| AppError::NotFound("esa venta".into()))
    }

    pub fn list_sales(&self, filter: &SaleFilter) -> AppResult<Vec<SaleSummary>> {
        self.require("ventas.ver")?;
        let view = match filter.view.as_deref() {
            Some("por_cobrar") => SaleView::PorCobrar,
            Some("pendientes_doc") => SaleView::PendientesDoc,
            Some("borradores") => SaleView::Borradores,
            Some("anuladas") => SaleView::Anuladas,
            _ => SaleView::Todas,
        };
        Ok(db::list_sales(
            self.db.conn(),
            filter.query.as_deref().unwrap_or(""),
            view,
            2000,
        )?
        .iter()
        .map(sale_summary)
        .collect())
    }

    pub fn sale(&self, uid: &str) -> AppResult<SaleDetail> {
        self.require("ventas.ver")?;
        let s = self.sale_row(uid)?;
        let conn = self.db.conn();
        let lines = self.to_lines(db::sale_lines(conn, s.id)?);
        let quote = db::quote_of_sale(conn, s.id)?;
        let payments: Vec<Payment> = db::sale_payments(conn, s.id)?
            .into_iter()
            .filter(|p| p.status == "vigente")
            .map(|p| Payment {
                number: p.number,
                date: p.date,
                amount_minor: p.amount_minor,
                method: method_label(&p.method).into(),
            })
            .collect();
        let ext = db::external_ref(conn, s.id)?;
        let mut chain = Vec::new();
        if let Some((quid, qnum)) = &quote {
            chain.push(DocLink {
                number: qnum.clone(),
                kind: "COT".into(),
                uid: Some(quid.clone()),
                label: "Cotización".into(),
            });
        }
        chain.push(DocLink {
            number: s.number.clone(),
            kind: s.doc_type.clone(),
            uid: Some(s.uid.clone()),
            label: doc_label(&s.doc_type).into(),
        });
        for p in &payments {
            chain.push(DocLink {
                number: p.number.clone(),
                kind: "PAG".into(),
                uid: None,
                label: format!("Pago · {}", p.method),
            });
        }
        if let Some(r) = &ext {
            let mut parts = Vec::new();
            if let Some(k) = &r.doc_kind {
                parts.push(k.clone());
            }
            if let Some(n) = &r.external_number {
                parts.push(format!("Nº {n}"));
            }
            chain.push(DocLink {
                number: if parts.is_empty() {
                    "Documentada".into()
                } else {
                    parts.join(" ")
                },
                kind: "REF".into(),
                uid: None,
                label: "Referencia externa".into(),
            });
        }
        let mut stmt = conn.prepare(
            "SELECT ts_utc, json_extract(after_json, '$.texto'), reason FROM audit_log
             WHERE entity = 'venta' AND entity_id = ?1 ORDER BY id",
        )?;
        let timeline = stmt
            .query_map([&s.uid], |r| {
                let at: String = r.get(0)?;
                let text: Option<String> = r.get(1)?;
                Ok(TimelineItem {
                    at,
                    text: text.unwrap_or_else(|| "Modificada".into()),
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let costs = self.can("costos.ver");
        Ok(SaleDetail {
            summary: sale_summary(&s),
            customer_uid: s.customer_uid.clone(),
            lines,
            totals: s.totals,
            cost_minor: if costs { s.cost_minor } else { 0 },
            payment_method: s.payment_method.clone(),
            notes: s.notes.clone(),
            quote_uid: quote.as_ref().map(|q| q.0.clone()),
            quote_number: quote.map(|q| q.1),
            payments,
            external_ref: ext,
            void_reason: s.void_reason.clone(),
            chain,
            timeline,
        })
    }

    pub fn save_sale(&mut self, input: &SaleInput, uid: Option<&str>) -> AppResult<SaleDetail> {
        self.require("ventas.crear")?;
        if !matches!(input.doc_type.as_str(), "VEN" | "FV") {
            return Err(AppError::Validation(
                "tipo de documento de venta no válido".into(),
            ));
        }
        let customer_id = self.customer_id(&input.customer_uid)?;
        let issue = parse_date("la fecha", &input.issue_date)?;
        let notes = opt_text(&input.notes, 2000, "las notas")?;
        let p = self.prepare_lines(&input.lines)?;
        let existing = match uid {
            Some(u) => {
                let s = self.sale_row(u)?;
                if !is_draft(&s.commercial_state) {
                    return Err(AppError::Validation(
                        "una venta efectuada no se modifica: anúlala con motivo y crea una nueva"
                            .into(),
                    ));
                }
                Some(s)
            }
            None => None,
        };
        let w = SaleWrite {
            customer_id,
            issue_date: &issue,
            totals: p.totals,
            notes: notes.as_deref(),
        };
        let now = now_utc();
        let user_id = self.user_id();
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        let (id, suid) = match &existing {
            Some(s) => {
                db::update_sale_draft(&tx, s.id, &w, &now)?;
                (s.id, s.uid.clone())
            }
            None => {
                let suid = uuid::Uuid::now_v7().to_string();
                let number = dbcore::take_number(&tx, &input.doc_type)?;
                (
                    db::insert_sale(
                        &tx,
                        &suid,
                        &input.doc_type,
                        &number,
                        "borrador",
                        &w,
                        user_id,
                        &now,
                    )?,
                    suid,
                )
            }
        };
        db::replace_sale_items(&tx, id, &p.lines)?;
        let (action, text) = match existing {
            Some(_) => ("venta.editar", "Borrador modificado"),
            None => ("venta.crear", "Creada como borrador"),
        };
        log(&tx, &user, action, "venta", &suid, text, None)?;
        tx.commit()?;
        self.sale(&suid)
    }

    /// Efectúa la venta: descuenta stock al costo promedio, fija costo y margen, crea la cuenta
    /// por cobrar y, si es al contado, registra el pago. Todo en una transacción.
    pub fn effect_sale(&mut self, uid: &str, input: &EffectInput) -> AppResult<SaleDetail> {
        self.require("ventas.efectuar")?;
        let s = self.sale_row(uid)?;
        if !is_draft(&s.commercial_state) {
            return Err(AppError::Validation(
                "esta venta ya fue efectuada o anulada".into(),
            ));
        }
        let credit = match input.mode.as_str() {
            "contado" => false,
            "credito" => true,
            _ => return Err(AppError::Validation("forma de pago no válida".into())),
        };
        let due = if credit {
            if s.customer_id.is_none() {
                return Err(AppError::Validation(
                    "para vender a crédito elige un cliente: necesitamos saber quién te debe"
                        .into(),
                ));
            }
            let d = input
                .due_date
                .as_deref()
                .filter(|d| !d.is_empty())
                .ok_or_else(|| AppError::Validation("indica la fecha en que te pagarán".into()))?;
            let d = parse_date("la fecha de pago", d)?;
            if d < s.issue_date {
                return Err(AppError::Validation(
                    "la fecha de pago no puede ser anterior a la venta".into(),
                ));
            }
            Some(d)
        } else {
            None
        };
        let method = if credit {
            "Crédito".to_string()
        } else {
            method_label(method_code(&input.method)).to_string()
        };
        self.check_stock_for_sale(s.id)?;
        let reminder = self.business()?.documentation_reminder;
        let doc_state = if reminder { "pendiente" } else { "no_aplica" };
        let lines = db::sale_lines(self.db.conn(), s.id)?;
        let now = now_utc();
        let user_id = self.user_id();
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        let today = local_today(&tx)?;
        let wh = products::default_warehouse(&tx, &now)?;
        let mut cost_total: i64 = 0;
        for l in &lines {
            let Some(pid) = l.product_id else { continue };
            let Some(p) = products::by_id(&tx, pid)? else {
                continue;
            };
            if !p.track_stock {
                continue;
            }
            let (_, avg) = products::balance(&tx, pid, wh)?;
            let cost = line_cost_minor(avg, l.qty_milli);
            db::set_line_cost(&tx, l.id, avg, cost)?;
            cost_total += cost;
            products::insert_movement(
                &tx,
                &Movement {
                    product_id: pid,
                    warehouse_id: wh,
                    date: &s.issue_date,
                    kind: "salida",
                    qty_milli: -l.qty_milli,
                    unit_cost_e4: avg,
                    avg_cost_after_e4: avg,
                    source_type: &s.doc_type,
                    source_id: s.id,
                    source_line_id: Some(l.id),
                    reason: None,
                    created_by: user_id,
                    created_at: &now,
                },
            )?;
        }
        db::mark_effected(
            &tx,
            s.id,
            wh,
            due.as_deref(),
            &method,
            doc_state,
            cost_total,
            &now,
        )?;
        let total = s.totals.total_minor;
        let mut texts =
            vec!["Venta efectuada: se descontó stock y se fijaron costo y margen".to_string()];
        if total > 0 {
            let rec = db::insert_receivable(
                &tx,
                s.id,
                s.customer_id,
                due.as_deref().unwrap_or(&s.issue_date),
                total,
            )?;
            if !credit {
                let acc = db::default_cash_account(&tx, &now)?;
                let pnum = dbcore::take_number(&tx, "PAG")?;
                let puid = uuid::Uuid::now_v7().to_string();
                let pid = db::insert_payment(
                    &tx,
                    &PaymentWrite {
                        uid: &puid,
                        number: &pnum,
                        customer_id: s.customer_id,
                        money_account_id: acc,
                        date: &today,
                        method: method_code(&input.method),
                        amount_minor: total,
                        created_by: user_id,
                        created_at: &now,
                    },
                    rec,
                )?;
                db::insert_link(&tx, ("PAG", pid), (s.doc_type.as_str(), s.id), "paga", &now)?;
                db::set_payment(&tx, s.id, total, "pagada", &now)?;
                texts.push(format!("Pago registrado ({method})"));
            } else {
                texts.push("Queda en Dinero que te deben".into());
            }
        } else {
            db::set_payment(&tx, s.id, 0, "pagada", &now)?;
        }
        if reminder {
            texts.push("Pendiente de documentación tributaria".into());
        }
        for t in &texts {
            log(&tx, &user, "venta.efectuar", "venta", &s.uid, t, None)?;
        }
        auto_close(&tx, &user, s.id, &s.uid, &now)?;
        tx.commit()?;
        self.sale(uid)
    }

    pub fn register_payment(
        &mut self,
        uid: &str,
        amount_minor: i64,
        method: &str,
        date: &str,
    ) -> AppResult<SaleDetail> {
        self.require("cobros.registrar")?;
        let s = self.sale_row(uid)?;
        if s.commercial_state != "efectuada" {
            return Err(AppError::Validation(
                "solo se registran pagos de ventas efectuadas con saldo pendiente".into(),
            ));
        }
        let due = s.totals.total_minor - s.paid_minor;
        if amount_minor <= 0 {
            return Err(AppError::Validation(
                "el monto debe ser mayor que cero".into(),
            ));
        }
        if amount_minor > due {
            return Err(AppError::Validation(
                "el pago supera el saldo pendiente".into(),
            ));
        }
        let date = parse_date("la fecha del pago", date)?;
        let now = now_utc();
        let user_id = self.user_id();
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        let rec = db::open_receivable(&tx, s.id)?
            .ok_or_else(|| AppError::Validation("la venta no tiene saldo por cobrar".into()))?;
        let acc = db::default_cash_account(&tx, &now)?;
        let pnum = dbcore::take_number(&tx, "PAG")?;
        let puid = uuid::Uuid::now_v7().to_string();
        let code = method_code(method);
        let pid = db::insert_payment(
            &tx,
            &PaymentWrite {
                uid: &puid,
                number: &pnum,
                customer_id: s.customer_id,
                money_account_id: acc,
                date: &date,
                method: code,
                amount_minor,
                created_by: user_id,
                created_at: &now,
            },
            rec,
        )?;
        db::insert_link(&tx, ("PAG", pid), (s.doc_type.as_str(), s.id), "paga", &now)?;
        let paid = s.paid_minor + amount_minor;
        let state = sales_state::payment_state(s.totals.total_minor, paid);
        db::set_payment(&tx, s.id, paid, payment_str(state), &now)?;
        let label = method_label(code);
        let text = if amount_minor == due {
            format!("Pago final registrado ({label}) · {pnum}")
        } else {
            format!("Abono registrado ({label}) · {pnum}")
        };
        log(&tx, &user, "pago.registrar", "venta", &s.uid, &text, None)?;
        auto_close(&tx, &user, s.id, &s.uid, &now)?;
        tx.commit()?;
        self.sale(uid)
    }

    /// Anota la referencia del documento tributario hecho FUERA de NÚCLEO (todo opcional).
    pub fn mark_documented(&mut self, uid: &str, r: &ExternalRefInput) -> AppResult<SaleDetail> {
        self.require("ventas.documentar")?;
        let s = self.sale_row(uid)?;
        if !matches!(s.commercial_state.as_str(), "efectuada" | "cerrada") {
            return Err(AppError::Validation(
                "solo se documentan ventas efectuadas".into(),
            ));
        }
        let row = ExternalRefRow {
            doc_kind: opt_text(&r.doc_kind, 60, "el tipo de documento")?,
            external_number: opt_text(&r.external_number, 40, "el número")?,
            issue_date: match r.issue_date.as_deref().filter(|d| !d.is_empty()) {
                Some(d) => Some(parse_date("la fecha del documento", d)?),
                None => None,
            },
            observation: opt_text(&r.observation, 500, "la observación")?,
            marked_at: now_utc(),
        };
        let mut text = "Marcada como documentada".to_string();
        if let Some(k) = &row.doc_kind {
            text.push_str(&format!(" · {k}"));
        }
        if let Some(n) = &row.external_number {
            text.push_str(&format!(" Nº {n}"));
        }
        let now = row.marked_at.clone();
        let user_id = self.user_id();
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        db::upsert_external_ref(&tx, s.id, &row, user_id)?;
        db::set_documentation_state(&tx, s.id, "documentada", &now)?;
        log(&tx, &user, "venta.documentar", "venta", &s.uid, &text, None)?;
        auto_close(&tx, &user, s.id, &s.uid, &now)?;
        tx.commit()?;
        self.sale(uid)
    }

    pub fn set_documentation_not_applicable(&mut self, uid: &str) -> AppResult<SaleDetail> {
        self.require("ventas.documentar")?;
        let s = self.sale_row(uid)?;
        if !matches!(s.commercial_state.as_str(), "efectuada" | "cerrada") {
            return Err(AppError::Validation(
                "solo aplica a ventas efectuadas".into(),
            ));
        }
        let now = now_utc();
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        db::set_documentation_state(&tx, s.id, "no_aplica", &now)?;
        log(
            &tx,
            &user,
            "venta.no_aplica",
            "venta",
            &s.uid,
            "Documentación tributaria: no aplica",
            None,
        )?;
        auto_close(&tx, &user, s.id, &s.uid, &now)?;
        tx.commit()?;
        self.sale(uid)
    }

    /// Anula con motivo. Si estaba efectuada devuelve el stock y anula sus cobros: nada se borra.
    pub fn void_sale(&mut self, uid: &str, reason: &str) -> AppResult<SaleDetail> {
        self.require("ventas.anular")?;
        let reason = reason.trim();
        if reason.is_empty() || reason.chars().count() > 500 {
            return Err(AppError::Validation(
                "escribe el motivo de la anulación (queda en la auditoría)".into(),
            ));
        }
        let s = self.sale_row(uid)?;
        if s.commercial_state == "anulada" {
            return Err(AppError::Validation("la venta ya está anulada".into()));
        }
        let effected = matches!(s.commercial_state.as_str(), "efectuada" | "cerrada");
        let lines = db::sale_lines(self.db.conn(), s.id)?;
        let now = now_utc();
        let user_id = self.user_id();
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        let mut texts = vec![format!("Anulada: {reason}")];
        if effected {
            let today = local_today(&tx)?;
            let wh = s
                .warehouse_id
                .map(Ok)
                .unwrap_or_else(|| products::default_warehouse(&tx, &now))?;
            let note = format!("Anulación de {}", s.number);
            let mut moved = false;
            for l in &lines {
                let (Some(pid), Some(cost)) = (l.product_id, l.unit_cost_e4) else {
                    continue;
                };
                let (on_hand, avg) = products::balance(&tx, pid, wh)?;
                let new_avg = nucleo_domain::inventory::weighted_average_cost(
                    Decimal::from(on_hand),
                    Decimal::from(avg),
                    Decimal::from(l.qty_milli),
                    Decimal::from(cost),
                )
                .round()
                .to_i64()
                .unwrap_or(avg);
                products::insert_movement(
                    &tx,
                    &Movement {
                        product_id: pid,
                        warehouse_id: wh,
                        date: &today,
                        kind: "ajuste",
                        qty_milli: l.qty_milli,
                        unit_cost_e4: cost,
                        avg_cost_after_e4: new_avg,
                        source_type: &s.doc_type,
                        source_id: s.id,
                        source_line_id: Some(l.id),
                        reason: Some(&note),
                        created_by: user_id,
                        created_at: &now,
                    },
                )?;
                moved = true;
            }
            if moved {
                texts.push("Stock devuelto a bodega".into());
            }
            let voided = db::void_payments_of_sale(&tx, s.id, &format!("Venta anulada: {reason}"))?;
            db::void_receivables(&tx, s.id)?;
            if voided > 0 {
                texts.push("Pagos anulados: si recibiste dinero, devuélvelo al cliente".into());
            }
            if s.documentation_state == "documentada" {
                texts.push(
                    "Estaba documentada: anula o corrige también el documento tributario externo"
                        .into(),
                );
            }
        }
        db::void_sale(&tx, s.id, reason, &now)?;
        log(
            &tx,
            &user,
            "venta.anular",
            "venta",
            &s.uid,
            &texts[0],
            Some(reason),
        )?;
        for t in &texts[1..] {
            log(&tx, &user, "venta.anular", "venta", &s.uid, t, None)?;
        }
        tx.commit()?;
        self.sale(uid)
    }
}

pub(crate) fn log(
    conn: &Connection,
    user: &str,
    action: &str,
    entity: &str,
    id: &str,
    text: &str,
    reason: Option<&str>,
) -> AppResult<()> {
    audit::append(
        conn,
        &AuditEntry {
            user_name: user,
            action,
            entity,
            entity_id: Some(id),
            after_json: Some(serde_json::json!({ "texto": text }).to_string()),
            reason,
            ..Default::default()
        },
    )?;
    Ok(())
}

fn auto_close(conn: &Connection, user: &str, id: i64, uid: &str, now: &str) -> AppResult<()> {
    let s = db::sale_by_id(conn, id)?.ok_or_else(|| AppError::NotFound("esa venta".into()))?;
    if sales_state::should_auto_close(
        commercial(&s.commercial_state),
        payment_of(&s.payment_state),
        documentation(&s.documentation_state),
    ) {
        db::set_commercial_state(conn, id, "cerrada", now)?;
        log(
            conn,
            user,
            "venta.cerrar",
            "venta",
            uid,
            "Cerrada automáticamente: pagada y sin documentación pendiente",
            None,
        )?;
    }
    Ok(())
}

fn sale_summary(s: &SaleRow) -> SaleSummary {
    SaleSummary {
        uid: s.uid.clone(),
        doc_type: s.doc_type.clone(),
        number: s.number.clone(),
        customer_name: s.customer_name.clone(),
        issue_date: s.issue_date.clone(),
        due_date: s.due_date.clone(),
        commercial_state: s.commercial_state.clone(),
        payment_state: s.payment_state.clone(),
        documentation_state: s.documentation_state.clone(),
        total_minor: s.totals.total_minor,
        paid_minor: s.paid_minor,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn totales_igual_que_la_vista_previa() {
        // Tasa de EJEMPLO (no normativa): 10 %.
        let (lines, t) = compute(
            &[(3_000, 10_000, 100_000, true), (2_000, 5_000, 0, false)],
            Some(100_000),
        )
        .unwrap();
        assert_eq!(lines[0], (27_000, 3_000));
        assert_eq!(t.net_minor, 27_000);
        assert_eq!(t.exempt_minor, 10_000);
        assert_eq!(t.tax_minor, 2_700);
        assert_eq!(t.total_minor, 39_700);
    }

    #[test]
    fn sin_tasa_todo_exento() {
        let (_, t) = compute(&[(1_500, 999, 0, true)], None).unwrap();
        assert_eq!(t.net_minor, 0);
        assert_eq!(t.exempt_minor, 1_499); // 1,5 × 999 = 1498,5 → 1499
        assert_eq!(t.tax_minor, 0);
    }

    #[test]
    fn costo_de_linea_y_medios_de_pago() {
        assert_eq!(line_cost_minor(65_000_000, 2_500), 16_250); // 6.500 × 2,5
        assert_eq!(method_code("Tarjeta de débito"), "debito");
        assert_eq!(method_label(method_code("Transferencia")), "Transferencia");
        assert_eq!(method_code("vale vista"), "otro");
    }
}
