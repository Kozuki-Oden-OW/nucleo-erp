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
    pub email: Option<String>,
    pub street: Option<String>,
    pub street_number: Option<String>,
    pub unit: Option<String>,
    pub reference: Option<String>,
    /// "domicilio" o "punto" (retiro en un punto del courier).
    pub delivery_mode: Option<String>,
    pub origin_point: Option<String>,
    pub service: Option<String>,
    pub content: Option<String>,
    pub declared_value_minor: Option<i64>,
    /// Talla del courier: XS, S, M o L.
    pub size: Option<String>,
    pub weight_g: Option<i64>,
    pub length_cm: Option<i64>,
    pub width_cm: Option<i64>,
    pub height_cm: Option<i64>,
    /// Se declaró que no contiene mercancías peligrosas.
    pub no_dangerous: bool,
    /// Lo que cobró el courier y el n.º de transacción del pago.
    pub cost_minor: Option<i64>,
    pub payment_ref: Option<String>,
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
    pub email: Option<&'a str>,
    pub street: Option<&'a str>,
    pub street_number: Option<&'a str>,
    pub unit: Option<&'a str>,
    pub reference: Option<&'a str>,
    pub delivery_mode: Option<&'a str>,
    pub origin_point: Option<&'a str>,
    pub service: Option<&'a str>,
    pub content: Option<&'a str>,
    pub declared_value_minor: Option<i64>,
    pub size: Option<&'a str>,
    pub weight_g: Option<i64>,
    pub length_cm: Option<i64>,
    pub width_cm: Option<i64>,
    pub height_cm: Option<i64>,
    pub no_dangerous: bool,
    pub cost_minor: Option<i64>,
    pub payment_ref: Option<&'a str>,
    pub now: &'a str,
}

const SELECT: &str = "SELECT e.id, e.uid, e.number, s.uid, s.number, c.uid, c.name, e.carrier, e.tracking, e.first_name,
        e.last_name, e.phone, e.address, e.commune, e.city, e.region, e.shipped_on, e.delivered_on, e.status, e.notes,
        e.created_at, e.updated_at, e.email, e.street, e.street_number, e.unit, e.reference, e.delivery_mode,
        e.origin_point, e.service, e.content, e.declared_value_minor, e.size, e.weight_g, e.length_cm, e.width_cm,
        e.height_cm, e.no_dangerous, e.cost_minor, e.payment_ref
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
        email: r.get(22)?,
        street: r.get(23)?,
        street_number: r.get(24)?,
        unit: r.get(25)?,
        reference: r.get(26)?,
        delivery_mode: r.get(27)?,
        origin_point: r.get(28)?,
        service: r.get(29)?,
        content: r.get(30)?,
        declared_value_minor: r.get(31)?,
        size: r.get(32)?,
        weight_g: r.get(33)?,
        length_cm: r.get(34)?,
        width_cm: r.get(35)?,
        height_cm: r.get(36)?,
        no_dangerous: r.get::<_, i64>(37)? != 0,
        cost_minor: r.get(38)?,
        payment_ref: r.get(39)?,
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

/// Datos del courier (columnas de la migración 39).
fn write_courier(
    conn: &Connection,
    id_sql: &str,
    key: &dyn rusqlite::ToSql,
    w: &ShipmentWrite<'_>,
) -> DbResult<()> {
    conn.execute(
        &format!(
            "UPDATE shipments SET email = ?2, street = ?3, street_number = ?4, unit = ?5, reference = ?6,
                delivery_mode = ?7, origin_point = ?8, service = ?9, content = ?10, declared_value_minor = ?11,
                size = ?12, weight_g = ?13, length_cm = ?14, width_cm = ?15, height_cm = ?16, no_dangerous = ?17,
                cost_minor = ?18, payment_ref = ?19 WHERE {id_sql} = ?1"
        ),
        rusqlite::params![
            key, w.email, w.street, w.street_number, w.unit, w.reference, w.delivery_mode, w.origin_point,
            w.service, w.content, w.declared_value_minor, w.size, w.weight_g, w.length_cm, w.width_cm, w.height_cm,
            w.no_dangerous as i64, w.cost_minor, w.payment_ref
        ],
    )?;
    Ok(())
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
    write_courier(conn, "uid", &uid, w)
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
    write_courier(conn, "id", &id, w)
}
