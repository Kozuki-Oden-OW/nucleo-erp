//! Sincronización celular ⇄ computador, fase S0 (docs/SINCRONIZACION.md): un **paquete** con los
//! cambios de fichas y las operaciones del celular, que hoy viaja como archivo y en la fase S1 por
//! WiFi o cable con TLS mutuo. Reglas (D-SYNC-01):
//!
//! * Fichas (categorías, clientes, proveedores, productos): campo por campo, gana el cambio más
//!   reciente según el reloj lógico híbrido.
//! * El computador es la autoridad de los documentos: el celular **pide** una venta rápida, un gasto o
//!   un cobro; el computador los crea con sus reglas, numeración y auditoría, y confirma cada uno.
//!   Aplicar dos veces el mismo paquete no duplica nada (`sync_applied`).
//! * Cada paquete confirma lo recibido del otro lado (`ack_hlc`, `ack_ops`): lo confirmado deja de
//!   enviarse y las operaciones confirmadas salen de la cola del celular.

use crate::finance_ops::ExpenseInput;
use crate::sales_ops::{EffectInput, LineInput, SaleInput};
use crate::{AppError, AppResult, CompanySession};
use nucleo_db::finance as db;
use nucleo_db::sync::{self, ApplyReport, Change, Op, Peer};
use nucleo_db::{audit, now_utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

pub const FORMAT: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncPackage {
    pub format: u32,
    pub from_device: String,
    pub from_role: String,
    pub to_device: String,
    pub created_at: String,
    /// Fotografía completa (primer intercambio con ese dispositivo) o solo lo nuevo.
    pub full: bool,
    pub changes: Vec<Change>,
    pub ops: Vec<Op>,
    /// Hasta qué marca de reloj se recibió lo del otro dispositivo.
    pub ack_hlc: String,
    /// Operaciones del otro dispositivo ya aplicadas aquí.
    pub ack_ops: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct SyncReport {
    pub changes: ApplyReport,
    pub ops_applied: usize,
    pub ops_repeated: usize,
    /// (operación, motivo): quedan en la cola del celular y se reintentan en la próxima sincronización.
    pub ops_failed: Vec<(String, String)>,
    pub ops_confirmed: usize,
}

/// Venta rápida pedida desde el celular.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuickSaleOp {
    pub customer_uid: Option<String>,
    pub issue_date: String,
    pub lines: Vec<OpLine>,
    /// "contado" o "credito".
    pub mode: String,
    /// Medio de pago si es al contado (Efectivo, Transferencia…).
    pub method: String,
    pub due_date: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpLine {
    pub product_uid: Option<String>,
    pub description: String,
    pub qty_milli: i64,
    pub unit_price_minor: i64,
    pub discount_ppm: i64,
    pub taxable: bool,
}

/// Gasto registrado en el celular. La categoría viaja por nombre (es igual en ambos equipos).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExpenseOp {
    pub category: String,
    pub date: String,
    pub description: String,
    pub total_minor: i64,
    pub tax_included: bool,
    pub paid_method: Option<String>,
    pub due_date: Option<String>,
    pub notes: Option<String>,
}

/// Cobro registrado en el celular: `sale_ref` es el uid de una venta o el de una venta rápida
/// pedida en la misma cola (el computador sabe qué venta creó para ella).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollectionOp {
    pub sale_ref: String,
    pub amount_minor: i64,
    pub method: String,
    pub date: String,
}

impl CompanySession {
    /// (uid de este dispositivo, rol).
    pub fn sync_device(&self) -> AppResult<(String, String)> {
        Ok(sync::device(self.db.conn())?)
    }

    pub fn sync_set_role(&mut self, role: &str) -> AppResult<()> {
        self.require("config.editar")?;
        Ok(sync::set_role(self.db.conn(), role)?)
    }

    /// Empareja un dispositivo (en la fase S1, tras escanear el QR).
    pub fn sync_pair(&mut self, device_uid: &str, name: &str, role: &str) -> AppResult<()> {
        let user = self.require("config.editar")?.username.clone();
        let name = name.trim();
        if device_uid.trim().is_empty()
            || name.is_empty()
            || !matches!(role, "escritorio" | "celular")
        {
            return Err(AppError::Validation(
                "faltan los datos del dispositivo".into(),
            ));
        }
        let conn = self.db.conn();
        sync::pair(conn, device_uid, name, role)?;
        audit::append(
            conn,
            &audit::AuditEntry {
                user_name: &user,
                action: "sync.emparejar",
                entity: "dispositivo",
                entity_id: Some(device_uid),
                after_json: Some(json!({ "name": name, "role": role }).to_string()),
                ..Default::default()
            },
        )?;
        Ok(())
    }

    /// Quita un dispositivo: deja de aceptarse su información.
    pub fn sync_revoke(&mut self, device_uid: &str) -> AppResult<()> {
        let user = self.require("config.editar")?.username.clone();
        let conn = self.db.conn();
        if sync::revoke(conn, device_uid)? == 0 {
            return Err(AppError::NotFound("el dispositivo".into()));
        }
        audit::append(
            conn,
            &audit::AuditEntry {
                user_name: &user,
                action: "sync.quitar",
                entity: "dispositivo",
                entity_id: Some(device_uid),
                ..Default::default()
            },
        )?;
        Ok(())
    }

    pub fn sync_peers(&self) -> AppResult<Vec<Peer>> {
        Ok(sync::peers(self.db.conn())?)
    }

    /// Contenido de las fichas sincronizables, ordenado y sin marcas de reloj: dos dispositivos
    /// sincronizados tienen exactamente la misma lista.
    pub fn sync_digest(&self) -> AppResult<Vec<(String, String, String, Value)>> {
        let mut v: Vec<_> = sync::snapshot(self.db.conn())?
            .into_iter()
            .map(|c| (c.entity, c.uid, c.field, c.value))
            .collect();
        v.sort_by(|a, b| (&a.0, &a.1, &a.2).cmp(&(&b.0, &b.1, &b.2)));
        Ok(v)
    }

    pub fn sync_outbox(&self) -> AppResult<Vec<Op>> {
        Ok(sync::outbox(self.db.conn())?)
    }

    pub fn sync_conflicts(&self) -> AppResult<Vec<(String, String, String, String)>> {
        Ok(sync::open_conflicts(self.db.conn())?)
    }

    fn paired(&self, device_uid: &str) -> AppResult<Peer> {
        match sync::peer(self.db.conn(), device_uid)? {
            Some(p) if !p.revoked => Ok(p),
            Some(_) => Err(AppError::Validation(
                "ese dispositivo fue quitado: vuelve a emparejarlo".into(),
            )),
            None => Err(AppError::Validation(
                "ese dispositivo no está emparejado con este negocio".into(),
            )),
        }
    }

    /// Arma el paquete para un dispositivo emparejado.
    pub fn sync_export(&mut self, to_device: &str) -> AppResult<SyncPackage> {
        self.require("config.ver")?;
        let peer = self.paired(to_device)?;
        let conn = self.db.conn();
        let (me, role) = sync::device(conn)?;
        let full = peer.sent_hlc.is_empty();
        let changes = if full {
            sync::snapshot(conn)?
        } else {
            sync::changes_since(conn, &peer.sent_hlc)?
        };
        let ops = if role == "celular" {
            sync::outbox(conn)?
        } else {
            Vec::new()
        };
        Ok(SyncPackage {
            format: FORMAT,
            from_device: me,
            from_role: role,
            to_device: to_device.into(),
            created_at: now_utc(),
            full,
            changes,
            ops,
            ack_hlc: peer.received_hlc,
            ack_ops: sync::applied_from(conn, to_device)?,
        })
    }

    /// Recibe el paquete de un dispositivo emparejado.
    pub fn sync_import(&mut self, pkg: &SyncPackage) -> AppResult<SyncReport> {
        self.require("config.ver")?;
        if pkg.format != FORMAT {
            return Err(AppError::Validation(
                "el paquete es de otra versión de NÚCLEO: actualiza ambos equipos".into(),
            ));
        }
        let (me, role) = sync::device(self.db.conn())?;
        if pkg.to_device != me {
            return Err(AppError::Validation(
                "este paquete es para otro dispositivo".into(),
            ));
        }
        self.paired(&pkg.from_device)?;
        let mut report = SyncReport {
            changes: sync::apply_changes(self.db.conn_mut(), &pkg.changes)?,
            ..Default::default()
        };
        let received = pkg.changes.iter().map(|c| c.hlc.as_str()).max();
        sync::mark_progress(
            self.db.conn(),
            &pkg.from_device,
            Some(&pkg.ack_hlc),
            received,
        )?;

        if role == "escritorio" && pkg.from_role == "celular" {
            for op in &pkg.ops {
                if sync::applied(self.db.conn(), &op.op_uid)?.is_some() {
                    report.ops_repeated += 1;
                    continue;
                }
                match self.apply_op(op) {
                    Ok(result) => {
                        sync::mark_applied(self.db.conn(), op, &pkg.from_device, &result)?;
                        report.ops_applied += 1;
                    }
                    Err(e) => report.ops_failed.push((op.op_uid.clone(), e.to_string())),
                }
            }
        }
        if role == "celular" {
            report.ops_confirmed = sync::outbox_ack(self.db.conn(), &pkg.ack_ops)?;
        }
        Ok(report)
    }

    fn apply_op(&mut self, op: &Op) -> AppResult<Value> {
        let bad = |e: serde_json::Error| {
            AppError::Validation(format!("operación con datos inválidos: {e}"))
        };
        match op.kind.as_str() {
            "venta" => {
                let mut v: QuickSaleOp = serde_json::from_value(op.payload.clone()).map_err(bad)?;
                // Fichas que el celular creó y el computador unió con una propia (mismo RUT o código).
                if let Some(c) = &v.customer_uid {
                    v.customer_uid = Some(sync::resolve(self.db.conn(), "customers", c)?);
                }
                for l in &mut v.lines {
                    if let Some(p) = &l.product_uid {
                        l.product_uid = Some(sync::resolve(self.db.conn(), "products", p)?);
                    }
                }
                let sale = self.save_sale(
                    &SaleInput {
                        doc_type: "VEN".into(),
                        customer_uid: v.customer_uid.clone(),
                        issue_date: v.issue_date.clone(),
                        lines: v
                            .lines
                            .iter()
                            .map(|l| LineInput {
                                product_uid: l.product_uid.clone(),
                                description: l.description.clone(),
                                qty_milli: l.qty_milli,
                                unit_price_minor: l.unit_price_minor,
                                discount_ppm: l.discount_ppm,
                                taxable: l.taxable,
                            })
                            .collect(),
                        notes: Some(
                            v.notes
                                .clone()
                                .unwrap_or_else(|| "Venta rápida desde el celular".into()),
                        ),
                        terms: None,
                    },
                    None,
                )?;
                let done = self.effect_sale(
                    &sale.summary.uid,
                    &EffectInput {
                        mode: v.mode.clone(),
                        method: v.method.clone(),
                        due_date: v.due_date.clone(),
                        account_uid: None,
                    },
                )?;
                Ok(json!({ "sale_uid": done.summary.uid, "number": done.summary.number }))
            }
            "gasto" => {
                let g: ExpenseOp = serde_json::from_value(op.payload.clone()).map_err(bad)?;
                let cats = db::categories(self.db.conn())?;
                let cat = cats
                    .iter()
                    .find(|c| c.name.eq_ignore_ascii_case(g.category.trim()))
                    .or_else(|| {
                        cats.iter().find(|c| {
                            c.name.eq_ignore_ascii_case("Otros gastos")
                                || c.name.eq_ignore_ascii_case("Otros")
                        })
                    })
                    .or(cats.first())
                    .ok_or_else(|| AppError::Validation("no hay categorías de gasto".into()))?;
                let e = self.register_expense(&ExpenseInput {
                    category_id: cat.id,
                    supplier_uid: None,
                    date: g.date,
                    description: g.description,
                    total_minor: g.total_minor,
                    tax_included: g.tax_included,
                    due_date: g.due_date,
                    paid_method: g.paid_method,
                    paid_account_uid: None,
                    notes: Some(
                        g.notes
                            .unwrap_or_else(|| "Registrado desde el celular".into()),
                    ),
                    recurring_id: None,
                    quantity_milli: None,
                    unit_minor: None,
                })?;
                Ok(json!({ "expense_uid": e.summary.uid, "number": e.summary.number }))
            }
            "cobro" => {
                let p: CollectionOp = serde_json::from_value(op.payload.clone()).map_err(bad)?;
                let sale_uid = match sync::applied(self.db.conn(), &p.sale_ref)? {
                    Some(r) => r
                        .get("sale_uid")
                        .and_then(Value::as_str)
                        .map(String::from)
                        .unwrap_or(p.sale_ref.clone()),
                    None => p.sale_ref.clone(),
                };
                let s =
                    self.register_payment(&sale_uid, p.amount_minor, &p.method, &p.date, None)?;
                Ok(json!({ "sale_uid": s.summary.uid, "payment_state": s.summary.payment_state }))
            }
            other => Err(AppError::Validation(format!(
                "operación desconocida: {other}"
            ))),
        }
    }

    /// En el celular: pide una venta rápida (viaja al computador en la próxima sincronización).
    pub fn queue_quick_sale(&mut self, v: &QuickSaleOp) -> AppResult<String> {
        self.require("ventas.crear")?;
        if v.lines.is_empty() {
            return Err(AppError::Validation("agrega al menos un producto".into()));
        }
        if v.mode == "credito" && v.customer_uid.is_none() {
            return Err(AppError::Validation(
                "para vender a crédito elige el cliente".into(),
            ));
        }
        Ok(sync::outbox_add(
            self.db.conn(),
            "venta",
            &serde_json::to_value(v).unwrap_or_default(),
        )?
        .op_uid)
    }

    pub fn queue_expense(&mut self, g: &ExpenseOp) -> AppResult<String> {
        self.require("dinero.registrar")?;
        if g.total_minor <= 0 {
            return Err(AppError::Validation(
                "el monto debe ser mayor que cero".into(),
            ));
        }
        Ok(sync::outbox_add(
            self.db.conn(),
            "gasto",
            &serde_json::to_value(g).unwrap_or_default(),
        )?
        .op_uid)
    }

    pub fn queue_collection(&mut self, p: &CollectionOp) -> AppResult<String> {
        self.require("cobros.registrar")?;
        if p.amount_minor <= 0 {
            return Err(AppError::Validation(
                "el monto debe ser mayor que cero".into(),
            ));
        }
        Ok(sync::outbox_add(
            self.db.conn(),
            "cobro",
            &serde_json::to_value(p).unwrap_or_default(),
        )?
        .op_uid)
    }
}
