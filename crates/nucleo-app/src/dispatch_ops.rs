//! Qué hacer cuando un producto no tiene stock y productos por despachar.
//!
//! Cada producto elige su regla: la general del negocio, no vender sin stock, vender igual o tomar
//! reservas. Con reservas, la venta no descuenta stock al efectuarse: aparta lo que hay (en orden de
//! llegada) y deja como pedido pendiente lo que falta; el stock se descuenta al despachar.

use crate::company::CompanySession;
use crate::sales_ops::{local_today, log, parse_date};
use crate::{AppError, AppResult};
use nucleo_db::dispatch::{self as db, PendingRow};
use nucleo_db::now_utc;
use nucleo_db::products::{self, Movement, ProductRow};
use serde::Serialize;
use std::collections::HashMap;

pub const STOCK_POLICIES: &[&str] = &["general", "bloquear", "vender", "reservar"];

/// Valida una regla de stock ("" o ausente = la general).
pub fn check_policy(p: Option<&str>) -> AppResult<Option<&'static str>> {
    match p.map(str::trim).filter(|s| !s.is_empty()) {
        None => Ok(None),
        Some(v) => STOCK_POLICIES
            .iter()
            .find(|x| **x == v)
            .copied()
            .map(Some)
            .ok_or_else(|| AppError::Validation("regla de stock no válida".into())),
    }
}

/// Una línea vendida que falta despachar.
#[derive(Debug, Clone, Serialize)]
pub struct PendingDispatch {
    pub id: i64,
    pub sale_uid: String,
    pub sale_number: String,
    pub issue_date: String,
    pub customer: Option<String>,
    pub product_uid: String,
    pub product_name: String,
    pub sku: String,
    pub unit: String,
    pub ordered_milli: i64,
    pub dispatched_milli: i64,
    pub pending_milli: i64,
    /// Lo que hay en bodega para este pedido (en orden de llegada de los pedidos).
    pub reserved_milli: i64,
    /// Lo que falta conseguir.
    pub missing_milli: i64,
    /// Stock del producto en la bodega.
    pub on_hand_milli: i64,
}

/// Stock de un producto en una bodega (para realizar inventario).
#[derive(Debug, Clone, Serialize)]
pub struct WarehouseStockRow {
    pub product: ProductRow,
    pub on_hand_milli: i64,
}

/// Reparte el stock de cada producto entre sus pedidos pendientes, del más antiguo al más nuevo.
fn allocate(conn: &rusqlite::Connection, rows: &[PendingRow]) -> AppResult<Vec<PendingDispatch>> {
    let mut free: HashMap<(i64, i64), i64> = HashMap::new();
    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        let key = (r.product_id, r.warehouse_id);
        let on_hand = products::balance(conn, r.product_id, r.warehouse_id)?.0;
        let left = free.entry(key).or_insert(on_hand.max(0));
        let pending = r.qty_milli - r.dispatched_milli;
        let reserved = pending.min(*left).max(0);
        *left -= reserved;
        out.push(PendingDispatch {
            id: r.id,
            sale_uid: r.sale_uid.clone(),
            sale_number: r.sale_number.clone(),
            issue_date: r.issue_date.clone(),
            customer: r.customer.clone(),
            product_uid: r.product_uid.clone(),
            product_name: r.product_name.clone(),
            sku: r.sku.clone(),
            unit: r.unit.clone(),
            ordered_milli: r.qty_milli,
            dispatched_milli: r.dispatched_milli,
            pending_milli: pending,
            reserved_milli: reserved,
            missing_milli: pending - reserved,
            on_hand_milli: on_hand,
        });
    }
    Ok(out)
}

impl CompanySession {
    /// Ventas con productos por despachar, de la más antigua a la más nueva.
    pub fn pending_dispatches(&self) -> AppResult<Vec<PendingDispatch>> {
        self.require("inventario.ver")?;
        let conn = self.db.conn();
        allocate(conn, &db::pending(conn)?)
    }

    /// Lo que falta despachar de una venta.
    pub(crate) fn sale_dispatch(&self, sale_id: i64) -> AppResult<Vec<PendingDispatch>> {
        let conn = self.db.conn();
        let all = db::pending(conn)?;
        let mine: Vec<i64> = db::of_sale(conn, sale_id)?.iter().map(|r| r.id).collect();
        Ok(allocate(conn, &all)?
            .into_iter()
            .filter(|d| mine.contains(&d.id))
            .collect())
    }

    /// Despacha (entrega) unidades de una venta: descuenta el stock. El costo y el margen de la venta
    /// quedaron fijos al efectuarla (ADR-008).
    pub fn dispatch_items(
        &mut self,
        id: i64,
        qty_milli: i64,
        date: Option<&str>,
    ) -> AppResult<Vec<PendingDispatch>> {
        self.require("ventas.efectuar")?;
        let r = db::by_id(self.db.conn(), id)?
            .ok_or_else(|| AppError::NotFound("el pedido por despachar".into()))?;
        let pending = r.qty_milli - r.dispatched_milli;
        if qty_milli <= 0 || qty_milli > pending {
            return Err(AppError::Validation(
                "la cantidad a despachar debe ser mayor que cero y no superar lo pendiente".into(),
            ));
        }
        let now = now_utc();
        let user_id = self.user_id();
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        let date = match date.filter(|d| !d.is_empty()) {
            Some(d) => parse_date("la fecha del despacho", d)?,
            None => local_today(&tx)?,
        };
        let (on_hand, avg) = products::balance(&tx, r.product_id, r.warehouse_id)?;
        if on_hand < qty_milli {
            return Err(AppError::Validation(format!(
                "no hay stock suficiente de {} para despachar: registra la compra o la recepción primero",
                r.product_name
            )));
        }
        products::insert_movement(
            &tx,
            &Movement {
                product_id: r.product_id,
                warehouse_id: r.warehouse_id,
                date: &date,
                kind: "salida",
                qty_milli: -qty_milli,
                unit_cost_e4: avg,
                avg_cost_after_e4: avg,
                source_type: &r.doc_type,
                source_id: r.sale_id,
                source_line_id: r.line_id,
                reason: Some("Despacho"),
                created_by: user_id,
                created_at: &now,
            },
        )?;
        db::add_dispatched(&tx, r.id, qty_milli, &now)?;
        let left = pending - qty_milli;
        let qty = rust_decimal::Decimal::new(qty_milli, 3).normalize();
        let text = if left == 0 {
            format!(
                "Despachado {qty} {} de {} (completo)",
                r.unit, r.product_name
            )
        } else {
            format!(
                "Despachado {qty} {} de {}; quedan {} por despachar",
                r.unit,
                r.product_name,
                rust_decimal::Decimal::new(left, 3).normalize()
            )
        };
        log(
            &tx,
            &user,
            "venta.despachar",
            "venta",
            &r.sale_uid,
            &text,
            None,
        )?;
        tx.commit()?;
        self.pending_dispatches()
    }

    /// Productos con stock y su saldo en una bodega, para realizar inventario.
    pub fn warehouse_stock(&self, warehouse_uid: &str) -> AppResult<Vec<WarehouseStockRow>> {
        self.require("inventario.ver")?;
        let w = self.warehouse(warehouse_uid)?;
        let costs = self.can("costos.ver");
        Ok(products::warehouse_stock(self.db.conn(), w.id)?
            .into_iter()
            .map(|(mut p, on_hand)| {
                if !costs {
                    p.cost_e4 = 0;
                }
                WarehouseStockRow {
                    product: p,
                    on_hand_milli: on_hand,
                }
            })
            .collect())
    }
}
