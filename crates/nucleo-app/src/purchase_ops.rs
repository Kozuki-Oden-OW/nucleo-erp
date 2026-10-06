//! Casos de uso de Compras (Fase 6): proveedores, órdenes de compra, recepción de mercadería
//! (stock y costo promedio), documentos de compra del proveedor, cuentas por pagar y pagos.

use crate::company::CompanySession;
use crate::sales_ops::{
    DocLink, MAX_LINES, MAX_PRICE_MINOR, MAX_QTY_MILLI, Payment, TimelineItem, compute,
    local_today, log, method_code, method_label, opt_text, parse_date,
};
use crate::{AppError, AppResult};
use nucleo_db::audit::{self, AuditEntry};
use nucleo_db::products::{self, Movement};
use nucleo_db::purchases::{
    self as db, BuyLine, PoRow, PoWrite, PriceHistoryRow, PurchaseRow, PurchaseView, PurchaseWrite,
};
use nucleo_db::sales::{self as sdb, Totals};
use nucleo_db::suppliers::{self, SupplierRow, SupplierWrite};
use nucleo_db::{core as dbcore, now_utc};
use nucleo_domain::Rut;
use nucleo_domain::sales_state::{self, PaymentState};
use rusqlite::Connection;
use rust_decimal::Decimal;
use rust_decimal::prelude::ToPrimitive;
use serde::{Deserialize, Serialize};

/* ───────────────────────────── Tipos de la interfaz ───────────────────────────── */

#[derive(Debug, Clone, Default, Deserialize)]
pub struct NewSupplier {
    pub name: String,
    pub rut: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub payment_terms_days: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SupplierDetail {
    #[serde(flatten)]
    pub supplier: SupplierRow,
    pub purchases_count: i64,
    pub purchased_minor: i64,
    pub payable_minor: i64,
    pub last_purchase_date: Option<String>,
    pub orders: Vec<PoSummary>,
    pub purchases: Vec<PurchaseSummary>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BuyLineInput {
    pub product_uid: Option<String>,
    pub description: String,
    pub qty_milli: i64,
    pub unit_cost_minor: i64,
    pub taxable: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct PoSummary {
    pub uid: String,
    pub number: String,
    pub supplier_name: String,
    pub issue_date: String,
    pub expected_date: Option<String>,
    pub status: String,
    pub total_minor: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct PoLine {
    pub line_no: i64,
    pub product_uid: Option<String>,
    pub description: String,
    pub qty_milli: i64,
    pub received_milli: i64,
    pub unit_cost_minor: i64,
    pub taxable: bool,
    pub net_minor: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReceiptRef {
    pub number: String,
    pub date: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PoDetail {
    #[serde(flatten)]
    pub summary: PoSummary,
    pub supplier_uid: String,
    pub lines: Vec<PoLine>,
    pub totals: Totals,
    pub notes: Option<String>,
    pub void_reason: Option<String>,
    pub receipts: Vec<ReceiptRef>,
    pub purchases: Vec<DocLink>,
    pub timeline: Vec<TimelineItem>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PoInput {
    pub supplier_uid: String,
    pub issue_date: String,
    pub expected_date: Option<String>,
    pub lines: Vec<BuyLineInput>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ReceiveLine {
    pub line_no: i64,
    pub qty_milli: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct PurchaseSummary {
    pub uid: String,
    pub number: String,
    pub supplier_name: String,
    pub doc_kind: Option<String>,
    pub doc_number: Option<String>,
    pub issue_date: String,
    pub due_date: Option<String>,
    pub status: String,
    pub payment_state: String,
    pub total_minor: i64,
    pub paid_minor: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct PurchaseLine {
    pub line_no: i64,
    pub product_uid: Option<String>,
    pub description: String,
    pub qty_milli: i64,
    pub unit_cost_minor: i64,
    pub taxable: bool,
    pub net_minor: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct PurchaseDetail {
    #[serde(flatten)]
    pub summary: PurchaseSummary,
    pub supplier_uid: String,
    pub lines: Vec<PurchaseLine>,
    pub totals: Totals,
    pub order_uid: Option<String>,
    pub order_number: Option<String>,
    pub payments: Vec<Payment>,
    pub received_stock: bool,
    pub notes: Option<String>,
    pub void_reason: Option<String>,
    pub timeline: Vec<TimelineItem>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PurchaseInput {
    pub supplier_uid: String,
    pub doc_kind: Option<String>,
    pub doc_number: Option<String>,
    pub issue_date: String,
    pub due_date: Option<String>,
    pub order_uid: Option<String>,
    /// La mercadería entra a bodega con este documento (compras sin orden).
    pub receive_stock: bool,
    pub lines: Vec<BuyLineInput>,
    pub notes: Option<String>,
    /// Si se pagó al momento, el medio de pago.
    pub paid_method: Option<String>,
    /// Cuenta de donde salió el dinero (si no se indica, se sugiere según el medio).
    #[serde(default)]
    pub paid_account_uid: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct PurchaseFilter {
    pub query: Option<String>,
    pub view: Option<String>,
}

/* ───────────────────────────── Funciones auxiliares ───────────────────────────── */

fn po_summary(o: &PoRow) -> PoSummary {
    PoSummary {
        uid: o.uid.clone(),
        number: o.number.clone(),
        supplier_name: o.supplier_name.clone(),
        issue_date: o.order_date.clone(),
        expected_date: o.expected_date.clone(),
        status: o.status.clone(),
        total_minor: o.totals.total_minor,
    }
}

fn purchase_summary(c: &PurchaseRow) -> PurchaseSummary {
    PurchaseSummary {
        uid: c.uid.clone(),
        number: c.number.clone(),
        supplier_name: c.supplier_name.clone(),
        doc_kind: c.doc_kind.clone(),
        doc_number: c.doc_number.clone(),
        issue_date: c.issue_date.clone(),
        due_date: c.due_date.clone(),
        status: c.status.clone(),
        payment_state: c.payment_state.clone(),
        total_minor: c.totals.total_minor,
        paid_minor: c.paid_minor,
    }
}

fn timeline(conn: &Connection, entity: &str, uid: &str) -> AppResult<Vec<TimelineItem>> {
    let mut stmt = conn.prepare(
        "SELECT ts_utc, json_extract(after_json, '$.texto') FROM audit_log WHERE entity = ?1 AND entity_id = ?2 ORDER BY id",
    )?;
    let rows = stmt
        .query_map((entity, uid), |r| {
            Ok(TimelineItem {
                at: r.get(0)?,
                text: r
                    .get::<_, Option<String>>(1)?
                    .unwrap_or_else(|| "Modificado".into()),
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn add_days(date: &str, days: i64) -> AppResult<String> {
    let fmt = time::macros::format_description!("[year]-[month]-[day]");
    let d = time::Date::parse(date, &fmt)
        .map_err(|_| AppError::Validation("fecha no válida".into()))?;
    (d + time::Duration::days(days))
        .format(&fmt)
        .map_err(|_| AppError::Validation("fecha no válida".into()))
}

/// Entrada de mercadería: recalcula el costo promedio ponderado y registra el movimiento.
#[allow(clippy::too_many_arguments)]
fn stock_in(
    conn: &Connection,
    product_id: i64,
    warehouse_id: i64,
    qty_milli: i64,
    cost_e4: i64,
    date: &str,
    source: (&str, i64, Option<i64>),
    by: Option<i64>,
    now: &str,
) -> AppResult<()> {
    let (on_hand, avg) = products::balance(conn, product_id, warehouse_id)?;
    let new_avg = nucleo_domain::inventory::weighted_average_cost(
        Decimal::from(on_hand),
        Decimal::from(avg),
        Decimal::from(qty_milli),
        Decimal::from(cost_e4),
    )
    .round()
    .to_i64()
    .unwrap_or(cost_e4);
    products::insert_movement(
        conn,
        &Movement {
            product_id,
            warehouse_id,
            date,
            kind: "entrada",
            qty_milli,
            unit_cost_e4: cost_e4,
            avg_cost_after_e4: new_avg,
            source_type: source.0,
            source_id: source.1,
            source_line_id: source.2,
            reason: None,
            created_by: by,
            created_at: now,
        },
    )?;
    Ok(())
}

/// Revierte una entrada (al anular una compra con recepción directa).
#[allow(clippy::too_many_arguments)]
fn stock_out_reversal(
    conn: &Connection,
    product_id: i64,
    warehouse_id: i64,
    qty_milli: i64,
    cost_e4: i64,
    date: &str,
    source: (&str, i64),
    reason: &str,
    by: Option<i64>,
    now: &str,
) -> AppResult<()> {
    let (on_hand, avg) = products::balance(conn, product_id, warehouse_id)?;
    let remaining = on_hand - qty_milli;
    let new_avg = if remaining > 0 {
        let v = (Decimal::from(on_hand) * Decimal::from(avg)
            - Decimal::from(qty_milli) * Decimal::from(cost_e4))
            / Decimal::from(remaining);
        v.round().to_i64().filter(|x| *x >= 0).unwrap_or(avg)
    } else {
        avg
    };
    products::insert_movement(
        conn,
        &Movement {
            product_id,
            warehouse_id,
            date,
            kind: "ajuste",
            qty_milli: -qty_milli,
            unit_cost_e4: cost_e4,
            avg_cost_after_e4: new_avg,
            source_type: source.0,
            source_id: source.1,
            source_line_id: None,
            reason: Some(reason),
            created_by: by,
            created_at: now,
        },
    )?;
    Ok(())
}

/// Datos validados de un proveedor: (nombre, RUT, correo, teléfono, plazo en días).
type SupplierFields = (String, Option<String>, Option<String>, Option<String>, i64);

struct PreparedBuy {
    lines: Vec<BuyLine>,
    totals: Totals,
}

impl CompanySession {
    fn prepare_buy(&self, input: &[BuyLineInput]) -> AppResult<PreparedBuy> {
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
            if !(0..=MAX_PRICE_MINOR).contains(&l.unit_cost_minor) {
                return Err(AppError::Validation(format!(
                    "revisa la línea {n}: el costo no es válido"
                )));
            }
            let product_id = match l.product_uid.as_deref().filter(|u| !u.is_empty()) {
                Some(u) => Some(
                    products::by_uid(self.db.conn(), u)?
                        .ok_or_else(|| AppError::NotFound(format!("el producto de la línea {n}")))?
                        .id,
                ),
                None => None,
            };
            raw.push((l.qty_milli, l.unit_cost_minor, 0, l.taxable));
            lines.push(BuyLine {
                product_id,
                description: desc.to_string(),
                qty_milli: l.qty_milli,
                unit_price_minor: l.unit_cost_minor,
                taxable: l.taxable,
                net_minor: 0,
            });
        }
        let (per_line, totals) = compute(&raw, self.tax_ppm()?)?;
        for (l, (net, _)) in lines.iter_mut().zip(per_line) {
            l.net_minor = net;
        }
        Ok(PreparedBuy { lines, totals })
    }

    fn supplier_row(&self, uid: &str) -> AppResult<SupplierRow> {
        suppliers::by_uid(self.db.conn(), uid)?
            .ok_or_else(|| AppError::NotFound("el proveedor".into()))
    }

    /* ───────────── Proveedores ───────────── */

    fn supplier_fields(input: &NewSupplier) -> AppResult<SupplierFields> {
        let name = crate::registry::validate_name(&input.name)?;
        let rut = match opt_text(&input.rut, 20, "el RUT")? {
            Some(r) => Some(
                Rut::parse(&r)
                    .map_err(|e| AppError::Validation(format!("RUT: {e}")))?
                    .compact(),
            ),
            None => None,
        };
        let email = opt_text(&input.email, 254, "el correo")?;
        if email.as_ref().is_some_and(|e| !e.contains('@')) {
            return Err(AppError::Validation(
                "el correo no tiene un formato válido".into(),
            ));
        }
        let phone = opt_text(&input.phone, 40, "el teléfono")?;
        let terms = input.payment_terms_days.unwrap_or(0);
        if !(0..=365).contains(&terms) {
            return Err(AppError::Validation(
                "el plazo de pago debe estar entre 0 y 365 días".into(),
            ));
        }
        Ok((name, rut, email, phone, terms))
    }

    pub fn search_suppliers(&self, query: &str, limit: u32) -> AppResult<Vec<SupplierRow>> {
        self.require("proveedores.ver")?;
        Ok(suppliers::search(
            self.db.conn(),
            query,
            limit.clamp(1, 500),
        )?)
    }

    pub fn add_supplier(&mut self, input: &NewSupplier) -> AppResult<SupplierRow> {
        self.require("proveedores.editar")?;
        let (name, rut, email, phone, terms) = Self::supplier_fields(input)?;
        let uid = uuid::Uuid::now_v7().to_string();
        let now = now_utc();
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        let row = suppliers::insert(
            &tx,
            &uid,
            &SupplierWrite {
                name: &name,
                rut: rut.as_deref(),
                email: email.as_deref(),
                phone: phone.as_deref(),
                payment_terms_days: terms,
            },
            &now,
        )?;
        audit::append(
            &tx,
            &AuditEntry {
                user_name: &user,
                action: "proveedor.crear",
                entity: "proveedor",
                entity_id: Some(&uid),
                after_json: serde_json::to_string(&row).ok(),
                ..Default::default()
            },
        )?;
        tx.commit()?;
        Ok(row)
    }

    pub fn update_supplier(&mut self, uid: &str, input: &NewSupplier) -> AppResult<SupplierRow> {
        self.require("proveedores.editar")?;
        let before = self.supplier_row(uid)?;
        let (name, rut, email, phone, terms) = Self::supplier_fields(input)?;
        let now = now_utc();
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        suppliers::update(
            &tx,
            before.id,
            &SupplierWrite {
                name: &name,
                rut: rut.as_deref(),
                email: email.as_deref(),
                phone: phone.as_deref(),
                payment_terms_days: terms,
            },
            &now,
        )?;
        let after = suppliers::by_uid(&tx, uid)?
            .ok_or_else(|| AppError::NotFound("el proveedor".into()))?;
        audit::append(
            &tx,
            &AuditEntry {
                user_name: &user,
                action: "proveedor.editar",
                entity: "proveedor",
                entity_id: Some(uid),
                before_json: serde_json::to_string(&before).ok(),
                after_json: serde_json::to_string(&after).ok(),
                ..Default::default()
            },
        )?;
        tx.commit()?;
        Ok(after)
    }

    pub fn supplier_detail(&self, uid: &str) -> AppResult<SupplierDetail> {
        self.require("proveedores.ver")?;
        let s = self.supplier_row(uid)?;
        let see = self.can("compras.ver");
        let stats = if see {
            suppliers::stats(self.db.conn(), s.id)?
        } else {
            Default::default()
        };
        let (orders, purchases) = if see {
            (
                db::list_pos(self.db.conn(), "", Some(s.id), 8)?
                    .iter()
                    .map(po_summary)
                    .collect(),
                db::list_purchases(self.db.conn(), "", PurchaseView::Todas, Some(s.id), 8)?
                    .iter()
                    .map(purchase_summary)
                    .collect(),
            )
        } else {
            (Vec::new(), Vec::new())
        };
        Ok(SupplierDetail {
            supplier: s,
            purchases_count: stats.purchases_count,
            purchased_minor: stats.purchased_minor,
            payable_minor: stats.payable_minor,
            last_purchase_date: stats.last_purchase_date,
            orders,
            purchases,
        })
    }

    pub fn price_history(&self, product_uid: &str) -> AppResult<Vec<PriceHistoryRow>> {
        self.require("compras.ver")?;
        let p = products::by_uid(self.db.conn(), product_uid)?
            .ok_or_else(|| AppError::NotFound("el producto".into()))?;
        Ok(db::price_history(self.db.conn(), p.id, 20)?)
    }

    /* ───────────── Órdenes de compra ───────────── */

    fn po_row(&self, uid: &str) -> AppResult<PoRow> {
        db::po_by_uid(self.db.conn(), uid)?
            .ok_or_else(|| AppError::NotFound("esa orden de compra".into()))
    }

    pub fn list_purchase_orders(&self, query: &str) -> AppResult<Vec<PoSummary>> {
        self.require("compras.ver")?;
        Ok(db::list_pos(self.db.conn(), query, None, 2000)?
            .iter()
            .map(po_summary)
            .collect())
    }

    pub fn purchase_order(&self, uid: &str) -> AppResult<PoDetail> {
        self.require("compras.ver")?;
        let o = self.po_row(uid)?;
        let conn = self.db.conn();
        let lines = db::po_lines(conn, o.id)?
            .into_iter()
            .map(|l| PoLine {
                line_no: l.line_no,
                product_uid: l.product_uid,
                description: l.description,
                qty_milli: l.qty_milli,
                received_milli: l.received_milli,
                unit_cost_minor: l.unit_price_minor,
                taxable: l.taxable,
                net_minor: l.net_minor,
            })
            .collect();
        let receipts = db::po_receipts(conn, o.id)?
            .into_iter()
            .map(|(number, date)| ReceiptRef { number, date })
            .collect();
        let purchases = db::purchases_of_po(conn, o.id)?
            .into_iter()
            .map(|(uid, number)| DocLink {
                number,
                kind: "COM".into(),
                uid: Some(uid),
                label: "Documento de compra".into(),
            })
            .collect();
        Ok(PoDetail {
            summary: po_summary(&o),
            supplier_uid: o.supplier_uid.clone(),
            lines,
            totals: o.totals,
            notes: o.notes.clone(),
            void_reason: o.void_reason.clone(),
            receipts,
            purchases,
            timeline: timeline(conn, "orden_compra", &o.uid)?,
        })
    }

    pub fn save_purchase_order(
        &mut self,
        input: &PoInput,
        uid: Option<&str>,
    ) -> AppResult<PoDetail> {
        self.require("compras.crear")?;
        let supplier = self.supplier_row(&input.supplier_uid)?;
        let date = parse_date("la fecha", &input.issue_date)?;
        let expected = match input.expected_date.as_deref().filter(|d| !d.is_empty()) {
            Some(d) => Some(parse_date("la fecha de llegada", d)?),
            None => None,
        };
        if expected.as_deref().is_some_and(|e| e < date.as_str()) {
            return Err(AppError::Validation(
                "la fecha de llegada no puede ser anterior a la orden".into(),
            ));
        }
        let notes = opt_text(&input.notes, 2000, "las notas")?;
        let p = self.prepare_buy(&input.lines)?;
        let existing = match uid {
            Some(u) => {
                let o = self.po_row(u)?;
                if o.status != "borrador" {
                    return Err(AppError::Validation(
                        "una orden emitida no se modifica: anúlala con motivo y crea otra".into(),
                    ));
                }
                Some(o)
            }
            None => None,
        };
        let w = PoWrite {
            supplier_id: supplier.id,
            order_date: &date,
            expected_date: expected.as_deref(),
            totals: p.totals,
            notes: notes.as_deref(),
        };
        let now = now_utc();
        let by = self.user_id();
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        let (id, ouid, text) = match &existing {
            Some(o) => {
                db::update_po(&tx, o.id, &w)?;
                (o.id, o.uid.clone(), "Borrador modificado".to_string())
            }
            None => {
                let ouid = uuid::Uuid::now_v7().to_string();
                let number = dbcore::take_number(&tx, "OC")?;
                (
                    db::insert_po(&tx, &ouid, &number, &w, by, &now)?,
                    ouid,
                    format!("Orden {number} creada como borrador"),
                )
            }
        };
        db::replace_po_items(&tx, id, &p.lines)?;
        log(
            &tx,
            &user,
            if existing.is_some() {
                "oc.editar"
            } else {
                "oc.crear"
            },
            "orden_compra",
            &ouid,
            &text,
            None,
        )?;
        tx.commit()?;
        self.purchase_order(&ouid)
    }

    /// Emite la orden: queda enviada al proveedor y pendiente de recepción.
    pub fn issue_purchase_order(&mut self, uid: &str) -> AppResult<PoDetail> {
        self.require("compras.crear")?;
        let o = self.po_row(uid)?;
        if o.status != "borrador" {
            return Err(AppError::Validation(
                "solo se emite una orden en borrador".into(),
            ));
        }
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        db::set_po_status(&tx, o.id, "emitida")?;
        log(
            &tx,
            &user,
            "oc.emitir",
            "orden_compra",
            &o.uid,
            "Emitida: pendiente de recepción",
            None,
        )?;
        tx.commit()?;
        self.purchase_order(uid)
    }

    pub fn void_purchase_order(&mut self, uid: &str, reason: &str) -> AppResult<PoDetail> {
        self.require("compras.crear")?;
        let reason = reason.trim();
        if reason.is_empty() || reason.chars().count() > 500 {
            return Err(AppError::Validation(
                "escribe el motivo de la anulación".into(),
            ));
        }
        let o = self.po_row(uid)?;
        if !matches!(o.status.as_str(), "borrador" | "emitida") {
            return Err(AppError::Validation(
                "una orden con mercadería recibida no se anula: registra el documento de compra de lo recibido".into(),
            ));
        }
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        db::void_po(&tx, o.id, reason)?;
        log(
            &tx,
            &user,
            "oc.anular",
            "orden_compra",
            &o.uid,
            &format!("Anulada: {reason}"),
            Some(reason),
        )?;
        tx.commit()?;
        self.purchase_order(uid)
    }

    /// Recibe mercadería de una orden (todo lo pendiente si `lines` viene vacío). Suma stock al
    /// costo de la orden y recalcula el costo promedio ponderado.
    pub fn receive_purchase_order(
        &mut self,
        uid: &str,
        lines: &[ReceiveLine],
        date: &str,
    ) -> AppResult<PoDetail> {
        self.require("compras.recibir")?;
        let o = self.po_row(uid)?;
        if !matches!(o.status.as_str(), "emitida" | "parcial") {
            return Err(AppError::Validation(match o.status.as_str() {
                "borrador" => "emite la orden antes de recibir mercadería".into(),
                "recibida" => "esta orden ya fue recibida completa".into(),
                _ => "esta orden no admite recepciones".into(),
            }));
        }
        let date = parse_date("la fecha de recepción", date)?;
        let items = db::po_lines(self.db.conn(), o.id)?;
        let mut plan: Vec<(i64, Option<i64>, i64, i64)> = Vec::new(); // (item, producto, cantidad, costo e4)
        if lines.is_empty() {
            for i in &items {
                let pending = i.qty_milli - i.received_milli;
                if pending > 0 {
                    plan.push((i.id, i.product_id, pending, i.unit_price_minor * 10_000));
                }
            }
        } else {
            for r in lines {
                if r.qty_milli == 0 {
                    continue;
                }
                let i = items
                    .iter()
                    .find(|i| i.line_no == r.line_no)
                    .ok_or_else(|| {
                        AppError::Validation(format!(
                            "la línea {} no existe en la orden",
                            r.line_no
                        ))
                    })?;
                let pending = i.qty_milli - i.received_milli;
                if r.qty_milli < 0 || r.qty_milli > pending {
                    return Err(AppError::Validation(format!(
                        "línea {}: puedes recibir hasta lo pendiente de la orden",
                        r.line_no
                    )));
                }
                plan.push((i.id, i.product_id, r.qty_milli, i.unit_price_minor * 10_000));
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
        let tx = self.db.conn_mut().transaction()?;
        let wh = products::default_warehouse(&tx, &now)?;
        let rnum = dbcore::take_number(&tx, "REC")?;
        let ruid = uuid::Uuid::now_v7().to_string();
        let rid = db::insert_receipt(
            &tx,
            &ruid,
            &rnum,
            o.supplier_id,
            Some(o.id),
            wh,
            &date,
            by,
            &now,
        )?;
        for (item, product, qty, cost) in &plan {
            db::add_received(&tx, *item, *qty)?;
            if let Some(pid) = product
                && products::by_id(&tx, *pid)?.is_some_and(|p| p.track_stock)
            {
                db::insert_receipt_item(&tx, rid, Some(*item), *pid, *qty, *cost)?;
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
        let complete = db::po_lines(&tx, o.id)?
            .iter()
            .all(|i| i.received_milli >= i.qty_milli);
        db::set_po_status(&tx, o.id, if complete { "recibida" } else { "parcial" })?;
        sdb::insert_link(&tx, ("REC", rid), ("OC", o.id), "recibe", &now)?;
        let text = if complete {
            format!("Recibida completa ({rnum}): stock y costo promedio actualizados")
        } else {
            format!("Recepción parcial ({rnum}): stock y costo promedio actualizados")
        };
        log(
            &tx,
            &user,
            "oc.recibir",
            "orden_compra",
            &o.uid,
            &text,
            None,
        )?;
        tx.commit()?;
        self.purchase_order(uid)
    }

    /* ───────────── Documentos de compra ───────────── */

    fn purchase_row(&self, uid: &str) -> AppResult<PurchaseRow> {
        db::purchase_by_uid(self.db.conn(), uid)?
            .ok_or_else(|| AppError::NotFound("ese documento de compra".into()))
    }

    fn direct_receipt(conn: &Connection, purchase_id: i64) -> AppResult<Option<i64>> {
        Ok(conn
            .query_row(
                "SELECT r.id FROM document_links l JOIN receipts r ON r.id = l.target_id
                 WHERE l.source_type = 'COM' AND l.source_id = ?1 AND l.target_type = 'REC' AND l.relation = 'origina'
                   AND r.status = 'confirmada'",
                [purchase_id],
                |r| r.get(0),
            )
            .ok())
    }

    pub fn list_purchases(&self, filter: &PurchaseFilter) -> AppResult<Vec<PurchaseSummary>> {
        self.require("compras.ver")?;
        let view = match filter.view.as_deref() {
            Some("por_pagar") => PurchaseView::PorPagar,
            Some("anuladas") => PurchaseView::Anuladas,
            _ => PurchaseView::Todas,
        };
        Ok(db::list_purchases(
            self.db.conn(),
            filter.query.as_deref().unwrap_or(""),
            view,
            None,
            2000,
        )?
        .iter()
        .map(purchase_summary)
        .collect())
    }

    pub fn purchase(&self, uid: &str) -> AppResult<PurchaseDetail> {
        self.require("compras.ver")?;
        let c = self.purchase_row(uid)?;
        let conn = self.db.conn();
        let lines = db::purchase_lines(conn, c.id)?
            .into_iter()
            .map(|l| PurchaseLine {
                line_no: l.line_no,
                product_uid: l.product_uid,
                description: l.description,
                qty_milli: l.qty_milli,
                unit_cost_minor: l.unit_price_minor,
                taxable: l.taxable,
                net_minor: l.net_minor,
            })
            .collect();
        let order = match c.po_id {
            Some(id) => db::po_by_id(conn, id)?,
            None => None,
        };
        let payments = db::purchase_payments(conn, c.id)?
            .into_iter()
            .map(|(number, date, amount_minor, method)| Payment {
                number,
                date,
                amount_minor,
                method: method_label(&method).into(),
            })
            .collect();
        let received: bool = conn.query_row(
            "SELECT count(*) > 0 FROM document_links WHERE source_type = 'COM' AND source_id = ?1 AND target_type = 'REC'",
            [c.id],
            |r| r.get(0),
        )?;
        Ok(PurchaseDetail {
            summary: purchase_summary(&c),
            supplier_uid: c.supplier_uid.clone(),
            lines,
            totals: c.totals,
            order_uid: order.as_ref().map(|o| o.uid.clone()),
            order_number: order.map(|o| o.number),
            payments,
            received_stock: received,
            notes: c.notes.clone(),
            void_reason: c.void_reason.clone(),
            timeline: timeline(conn, "compra", &c.uid)?,
        })
    }

    /// Registra el documento del proveedor (factura, boleta…). Crea la cuenta por pagar y, si se
    /// indica, ingresa la mercadería a bodega y registra el pago al contado.
    pub fn register_purchase(&mut self, input: &PurchaseInput) -> AppResult<PurchaseDetail> {
        self.require("compras.crear")?;
        let supplier = self.supplier_row(&input.supplier_uid)?;
        let date = parse_date("la fecha del documento", &input.issue_date)?;
        let kind = opt_text(&input.doc_kind, 60, "el tipo de documento")?;
        let number = opt_text(&input.doc_number, 40, "el número del documento")?;
        let notes = opt_text(&input.notes, 2000, "las notas")?;
        let order = match input.order_uid.as_deref().filter(|u| !u.is_empty()) {
            Some(u) => {
                let o = self.po_row(u)?;
                if o.supplier_id != supplier.id {
                    return Err(AppError::Validation(
                        "la orden de compra es de otro proveedor".into(),
                    ));
                }
                if matches!(o.status.as_str(), "borrador" | "anulada") {
                    return Err(AppError::Validation(
                        "la orden de compra no está emitida".into(),
                    ));
                }
                Some(o)
            }
            None => None,
        };
        if order.is_some() && input.receive_stock {
            return Err(AppError::Validation(
                "la mercadería de una orden de compra se recibe desde la orden".into(),
            ));
        }
        if input.receive_stock && !self.can("compras.recibir") {
            return Err(AppError::Forbidden(
                crate::auth::permission_label("compras.recibir").into(),
            ));
        }
        if input.paid_method.is_some() && !self.can("dinero.registrar") {
            return Err(AppError::Forbidden(
                crate::auth::permission_label("dinero.registrar").into(),
            ));
        }
        let due = match input.due_date.as_deref().filter(|d| !d.is_empty()) {
            Some(d) => parse_date("el vencimiento", d)?,
            None => add_days(&date, supplier.payment_terms_days)?,
        };
        if due < date {
            return Err(AppError::Validation(
                "el vencimiento no puede ser anterior al documento".into(),
            ));
        }
        let p = self.prepare_buy(&input.lines)?;
        let now = now_utc();
        let by = self.user_id();
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        let cuid = uuid::Uuid::now_v7().to_string();
        let cnum = dbcore::take_number(&tx, "COM")?;
        let cid = db::insert_purchase(
            &tx,
            &cuid,
            &cnum,
            &PurchaseWrite {
                supplier_id: supplier.id,
                doc_kind: kind.as_deref(),
                doc_number: number.as_deref(),
                po_id: order.as_ref().map(|o| o.id),
                issue_date: &date,
                due_date: Some(&due),
                totals: p.totals,
                notes: notes.as_deref(),
            },
            by,
            &now,
        )?
        .ok_or_else(|| {
            AppError::Validation("ya registraste ese documento de este proveedor".into())
        })?;
        db::insert_purchase_items(&tx, cid, &p.lines)?;
        let mut texts = vec![
            format!(
                "Registrado {}",
                [kind.clone(), number.as_ref().map(|n| format!("Nº {n}"))]
                    .into_iter()
                    .flatten()
                    .collect::<Vec<_>>()
                    .join(" ")
            )
            .trim()
            .to_string(),
        ];
        if let Some(o) = &order {
            sdb::insert_link(&tx, ("OC", o.id), ("COM", cid), "origina", &now)?;
            log(
                &tx,
                &user,
                "oc.documento",
                "orden_compra",
                &o.uid,
                &format!("Documento de compra {cnum} registrado"),
                None,
            )?;
            texts.push(format!("Asociado a la orden {}", o.number));
        }
        if input.receive_stock {
            let wh = products::default_warehouse(&tx, &now)?;
            let rnum = dbcore::take_number(&tx, "REC")?;
            let ruid = uuid::Uuid::now_v7().to_string();
            let rid =
                db::insert_receipt(&tx, &ruid, &rnum, supplier.id, None, wh, &date, by, &now)?;
            let mut any = false;
            for l in &p.lines {
                if let Some(pid) = l.product_id
                    && products::by_id(&tx, pid)?.is_some_and(|p| p.track_stock)
                {
                    let cost = l.unit_price_minor * 10_000;
                    db::insert_receipt_item(&tx, rid, None, pid, l.qty_milli, cost)?;
                    stock_in(
                        &tx,
                        pid,
                        wh,
                        l.qty_milli,
                        cost,
                        &date,
                        ("REC", rid, None),
                        by,
                        &now,
                    )?;
                    any = true;
                }
            }
            if any {
                sdb::insert_link(&tx, ("COM", cid), ("REC", rid), "origina", &now)?;
                texts.push(format!(
                    "Mercadería ingresada a bodega ({rnum}): stock y costo promedio actualizados"
                ));
            } else {
                db::void_receipt(&tx, rid)?;
            }
        }
        let total = p.totals.total_minor;
        if total > 0 {
            let pay = db::insert_payable(&tx, cid, supplier.id, &due, total)?;
            if let Some(m) = &input.paid_method {
                let code = method_code(m);
                let acc = crate::finance_ops::account_for(
                    &tx,
                    input.paid_account_uid.as_deref(),
                    code,
                    &now,
                )?;
                let pnum = dbcore::take_number(&tx, "EGR")?;
                db::insert_supplier_payment(
                    &tx,
                    &uuid::Uuid::now_v7().to_string(),
                    &pnum,
                    supplier.id,
                    acc,
                    &date,
                    code,
                    total,
                    pay,
                    by,
                    &now,
                )?;
                db::set_purchase_payment(&tx, cid, total, "pagada")?;
                texts.push(format!(
                    "Pagado al contado ({}) · {pnum}",
                    method_label(code)
                ));
            } else {
                texts.push(format!("Queda en Dinero que debes (vence {due})"));
            }
        } else {
            db::set_purchase_payment(&tx, cid, 0, "pagada")?;
        }
        for t in &texts {
            log(&tx, &user, "compra.registrar", "compra", &cuid, t, None)?;
        }
        tx.commit()?;
        self.purchase(&cuid)
    }

    pub fn pay_purchase(
        &mut self,
        uid: &str,
        amount_minor: i64,
        method: &str,
        date: &str,
        account_uid: Option<&str>,
    ) -> AppResult<PurchaseDetail> {
        self.require("dinero.registrar")?;
        let c = self.purchase_row(uid)?;
        if c.status != "registrada" {
            return Err(AppError::Validation(
                "solo se pagan documentos registrados".into(),
            ));
        }
        let due = c.totals.total_minor - c.paid_minor;
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
        let by = self.user_id();
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        let pay = db::open_payable(&tx, c.id)?
            .ok_or_else(|| AppError::Validation("el documento no tiene saldo por pagar".into()))?;
        let code = method_code(method);
        let acc = crate::finance_ops::account_for(&tx, account_uid, code, &now)?;
        let pnum = dbcore::take_number(&tx, "EGR")?;
        db::insert_supplier_payment(
            &tx,
            &uuid::Uuid::now_v7().to_string(),
            &pnum,
            c.supplier_id,
            acc,
            &date,
            code,
            amount_minor,
            pay,
            by,
            &now,
        )?;
        let paid = c.paid_minor + amount_minor;
        let state = match sales_state::payment_state(c.totals.total_minor, paid) {
            PaymentState::SinPago => "sin_pago",
            PaymentState::Abonada => "abonada",
            PaymentState::Pagada => "pagada",
        };
        db::set_purchase_payment(&tx, c.id, paid, state)?;
        let text = if amount_minor == due {
            format!("Pago final al proveedor ({}) · {pnum}", method_label(code))
        } else {
            format!("Abono al proveedor ({}) · {pnum}", method_label(code))
        };
        log(&tx, &user, "compra.pagar", "compra", &c.uid, &text, None)?;
        tx.commit()?;
        self.purchase(uid)
    }

    /// Anula con motivo: anula pagos y cuenta por pagar y, si ingresó mercadería directa, la saca.
    pub fn void_purchase(&mut self, uid: &str, reason: &str) -> AppResult<PurchaseDetail> {
        self.require("compras.crear")?;
        let reason = reason.trim();
        if reason.is_empty() || reason.chars().count() > 500 {
            return Err(AppError::Validation(
                "escribe el motivo de la anulación".into(),
            ));
        }
        let c = self.purchase_row(uid)?;
        if c.status == "anulada" {
            return Err(AppError::Validation("el documento ya está anulado".into()));
        }
        let now = now_utc();
        let by = self.user_id();
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        let today = local_today(&tx)?;
        let mut texts = vec![format!("Anulado: {reason}")];
        if let Some(rid) = Self::direct_receipt(&tx, c.id)? {
            let note = format!("Anulación de {}", c.number);
            for (pid, qty, cost, wh) in db::receipt_items(&tx, rid)? {
                stock_out_reversal(
                    &tx,
                    pid,
                    wh,
                    qty,
                    cost,
                    &today,
                    ("REC", rid),
                    &note,
                    by,
                    &now,
                )?;
            }
            db::void_receipt(&tx, rid)?;
            texts.push("Mercadería retirada del stock".into());
        }
        if db::void_payments_of_purchase(&tx, c.id, &format!("Compra anulada: {reason}"))? > 0 {
            texts.push("Pagos anulados: si pagaste, pide la devolución al proveedor".into());
        }
        db::void_payables(&tx, c.id)?;
        db::void_purchase(&tx, c.id, reason)?;
        log(
            &tx,
            &user,
            "compra.anular",
            "compra",
            &c.uid,
            &texts[0],
            Some(reason),
        )?;
        for t in &texts[1..] {
            log(&tx, &user, "compra.anular", "compra", &c.uid, t, None)?;
        }
        tx.commit()?;
        self.purchase(uid)
    }
}
