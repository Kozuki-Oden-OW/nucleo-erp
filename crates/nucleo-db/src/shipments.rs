//! Envíos: agencia, número de seguimiento, destinatario, fechas y estado.

use crate::DbResult;
use rusqlite::{Connection, OptionalExtension, Row};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct ShipmentRow {
    #[serde(skip)]
    pub id: i64,
    pub uid: String,
    pub number: String,
    pub sale_uid: Option<String>,
    pub sale_number: Option<String>,
    pub customer_uid: Option<String>,
    pub customer_name: Option<String>,
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
    /// "no_despachado", "en_camino", "entregado" o "no_entregado".
    pub status: String,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: Option<String>,
}

/// Datos que se guardan (ya validados).
pub struct ShipmentWrite<'a> {
    pub sale_id: Option<i64>,
    pub customer_id: Option<i64>,
    pub carrier: Option<&'a str>,
    pub tracking: Option<&'a str>,
    pub first_name: Option<&'a str>,
    pub last_name: Option<&'a str>,
    pub phone: Option<&'a str>,
    pub address: Option<&'a str>,
    pub commune: Option<&'a str>,
    pub city: Option<&'a str>,
    pub region: Option<&'a str>,
    pub shipped_on: Option<&'a str>,
    pub delivered_on: Option<&'a str>,
    pub status: &'a str,
    pub notes: Option<&'a str>,
    pub now: &'a str,
}

const SELECT: &str = "SELECT e.id, e.uid, e.number, s.uid, s.number, c.uid, c.name, e.carrier, e.tracking, e.first_name,
        e.last_name, e.phone, e.address, e.commune, e.city, e.region, e.shipped_on, e.delivered_on, e.status, e.notes,
        e.created_at, e.updated_at
    FROM shipments e LEFT JOIN sales s ON s.id = e.sale_id LEFT JOIN customers c ON c.id = e.customer_id";

fn map(r: &Row<'_>) -> rusqlite::Result<ShipmentRow> {
    Ok(ShipmentRow {
        id: r.get(0)?,
        uid: r.get(1)?,
        number: r.get(2)?,
        sale_uid: r.get(3)?,
        sale_number: r.get(4)?,
        customer_uid: r.get(5)?,
        customer_name: r.get(6)?,
        carrier: r.get(7)?,
        tracking: r.get(8)?,
        first_name: r.get(9)?,
        last_name: r.get(10)?,
        phone: r.get(11)?,
        address: r.get(12)?,
        commune: r.get(13)?,
        city: r.get(14)?,
        region: r.get(15)?,
        shipped_on: r.get(16)?,
        delivered_on: r.get(17)?,
        status: r.get(18)?,
        notes: r.get(19)?,
        created_at: r.get(20)?,
        updated_at: r.get(21)?,
    })
}

/// Envíos, los más nuevos primero (opcionalmente de una venta).
pub fn list(conn: &Connection, sale_id: Option<i64>) -> DbResult<Vec<ShipmentRow>> {
    let mut stmt = conn.prepare(&format!(
        "{SELECT} WHERE (?1 IS NULL OR e.sale_id = ?1) ORDER BY e.id DESC"
    ))?;
    Ok(stmt
        .query_map([sale_id], map)?
        .collect::<Result<Vec<_>, _>>()?)
}

pub fn by_uid(conn: &Connection, uid: &str) -> DbResult<Option<ShipmentRow>> {
    Ok(conn
        .query_row(&format!("{SELECT} WHERE e.uid = ?1"), [uid], map)
        .optional()?)
}

pub fn insert(conn: &Connection, uid: &str, number: &str, w: &ShipmentWrite<'_>) -> DbResult<()> {
    conn.execute(
        "INSERT INTO shipments (uid, number, sale_id, customer_id, carrier, tracking, first_name, last_name, phone,
            address, commune, city, region, shipped_on, delivered_on, status, notes, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
        rusqlite::params![
            uid, number, w.sale_id, w.customer_id, w.carrier, w.tracking, w.first_name, w.last_name, w.phone,
            w.address, w.commune, w.city, w.region, w.shipped_on, w.delivered_on, w.status, w.notes, w.now
        ],
    )?;
    Ok(())
}

pub fn update(conn: &Connection, id: i64, w: &ShipmentWrite<'_>) -> DbResult<()> {
    conn.execute(
        "UPDATE shipments SET sale_id = ?2, customer_id = ?3, carrier = ?4, tracking = ?5, first_name = ?6,
            last_name = ?7, phone = ?8, address = ?9, commune = ?10, city = ?11, region = ?12, shipped_on = ?13,
            delivered_on = ?14, status = ?15, notes = ?16, updated_at = ?17 WHERE id = ?1",
        rusqlite::params![
            id, w.sale_id, w.customer_id, w.carrier, w.tracking, w.first_name, w.last_name, w.phone, w.address,
            w.commune, w.city, w.region, w.shipped_on, w.delivered_on, w.status, w.notes, w.now
        ],
    )?;
    Ok(())
}
