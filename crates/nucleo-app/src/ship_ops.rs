//! Envíos: agencia, número de orden de transporte o seguimiento, destinatario, dirección, fechas y
//! estado (no despachado, en camino, entregado, no entregado por problemas).

use crate::company::CompanySession;
use crate::sales_ops::{local_today, log, opt_text, parse_date};
use crate::{AppError, AppResult};
use nucleo_db::core as dbcore;
use nucleo_db::now_utc;
use nucleo_db::shipments::{self as db, ShipmentRow, ShipmentWrite};
use serde::Deserialize;

pub const STATUSES: &[&str] = &["no_despachado", "en_camino", "entregado", "no_entregado"];

fn status_label(s: &str) -> &'static str {
    match s {
        "en_camino" => "En camino",
        "entregado" => "Entregado",
        "no_entregado" => "No entregado (problemas)",
        _ => "No despachado",
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct ShipmentInput {
    pub sale_uid: Option<String>,
    pub customer_uid: Option<String>,
    pub carrier: Option<String>,
    pub tracking: Option<String>,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub phone: Option<String>,
    pub address: Option<String>,
    pub commune: Option<String>,
    pub city: Option<String>,
    pub region: Option<String>,
    pub shipped_on: Option<String>,
    pub delivered_on: Option<String>,
    pub status: String,
    pub notes: Option<String>,
}

impl CompanySession {
    pub fn shipments(&self, sale_uid: Option<&str>) -> AppResult<Vec<ShipmentRow>> {
        self.require("ventas.ver")?;
        let conn = self.db.conn();
        let sale_id = match sale_uid {
            Some(u) => Some(
                nucleo_db::sales::sale_by_uid(conn, u)?
                    .ok_or_else(|| AppError::NotFound("la venta".into()))?
                    .id,
            ),
            None => None,
        };
        Ok(db::list(conn, sale_id)?)
    }

    /// Crea (sin `uid`) o cambia un envío.
    pub fn save_shipment(
        &mut self,
        uid: Option<&str>,
        input: &ShipmentInput,
    ) -> AppResult<ShipmentRow> {
        self.require("ventas.crear")?;
        let conn = self.db.conn();
        let status = if input.status.is_empty() {
            "no_despachado"
        } else {
            input.status.as_str()
        };
        if !STATUSES.contains(&status) {
            return Err(AppError::Validation("estado del envío no válido".into()));
        }
        let sale = match input.sale_uid.as_deref().filter(|u| !u.is_empty()) {
            Some(u) => Some(
                nucleo_db::sales::sale_by_uid(conn, u)?
                    .ok_or_else(|| AppError::NotFound("la venta".into()))?,
            ),
            None => None,
        };
        let customer_id = match input.customer_uid.as_deref().filter(|u| !u.is_empty()) {
            Some(u) => Some(
                nucleo_db::customers::by_uid(conn, u)?
                    .ok_or_else(|| AppError::NotFound("el cliente".into()))?
                    .id,
            ),
            None => sale.as_ref().and_then(|s| s.customer_id),
        };
        let today = local_today(conn)?;
        let date = |v: &Option<String>, l: &str| -> AppResult<Option<String>> {
            match v.as_deref().filter(|d| !d.is_empty()) {
                Some(d) => Ok(Some(parse_date(l, d)?)),
                None => Ok(None),
            }
        };
        let mut shipped = date(&input.shipped_on, "la fecha de envío")?;
        let mut delivered = date(&input.delivered_on, "la fecha de recepción")?;
        // Al marcar en camino o entregado sin fecha, se usa la de hoy.
        if matches!(status, "en_camino" | "entregado" | "no_entregado") && shipped.is_none() {
            shipped = Some(today.clone());
        }
        if status == "entregado" && delivered.is_none() {
            delivered = Some(today.clone());
        }
        if status != "entregado" {
            delivered = delivered.filter(|_| status == "no_entregado");
        }
        if let (Some(s), Some(d)) = (&shipped, &delivered)
            && d < s
        {
            return Err(AppError::Validation(
                "la fecha de recepción no puede ser anterior al envío".into(),
            ));
        }
        let carrier = opt_text(&input.carrier, 80, "la agencia")?;
        let tracking = opt_text(&input.tracking, 80, "el número de seguimiento")?;
        let first = opt_text(&input.first_name, 80, "el nombre")?;
        let last = opt_text(&input.last_name, 80, "el apellido")?;
        let phone = opt_text(&input.phone, 40, "el celular")?;
        let address = opt_text(&input.address, 200, "la dirección")?;
        let commune = opt_text(&input.commune, 80, "la comuna")?;
        let city = opt_text(&input.city, 80, "la ciudad")?;
        let region = opt_text(&input.region, 80, "la región")?;
        let notes = opt_text(&input.notes, 1000, "las notas")?;
        let now = now_utc();
        let user = self.actor_name()?;
        let w = ShipmentWrite {
            sale_id: sale.as_ref().map(|s| s.id),
            customer_id,
            carrier: carrier.as_deref(),
            tracking: tracking.as_deref(),
            first_name: first.as_deref(),
            last_name: last.as_deref(),
            phone: phone.as_deref(),
            address: address.as_deref(),
            commune: commune.as_deref(),
            city: city.as_deref(),
            region: region.as_deref(),
            shipped_on: shipped.as_deref(),
            delivered_on: delivered.as_deref(),
            status,
            notes: notes.as_deref(),
            now: &now,
        };
        let tx = self.db.conn_mut().transaction()?;
        let (uid, number, before) = match uid {
            Some(u) => {
                let r = db::by_uid(&tx, u)?.ok_or_else(|| AppError::NotFound("el envío".into()))?;
                db::update(&tx, r.id, &w)?;
                (u.to_string(), r.number.clone(), Some(r.status))
            }
            None => {
                let u = uuid::Uuid::now_v7().to_string();
                let n = dbcore::take_number(&tx, "ENV")?;
                db::insert(&tx, &u, &n, &w)?;
                (u, n, None)
            }
        };
        let text = match &before {
            None => format!("{number} creado · {}", status_label(status)),
            Some(b) if b != status => {
                format!("{number}: {} → {}", status_label(b), status_label(status))
            }
            Some(_) => format!("{number} actualizado"),
        };
        log(&tx, &user, "envio.guardar", "envio", &uid, &text, None)?;
        if let Some(s) = &sale {
            // También queda en el historial de la venta.
            log(&tx, &user, "envio.guardar", "venta", &s.uid, &text, None)?;
        }
        tx.commit()?;
        db::by_uid(self.db.conn(), &uid)?.ok_or_else(|| AppError::NotFound("el envío".into()))
    }
}
