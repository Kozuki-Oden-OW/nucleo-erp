//! Integraciones externas: configuración por proveedor, pedidos de Mercado Libre ya vistos y
//! publicaciones enlazadas a productos.

use crate::DbResult;
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;

#[derive(Debug, Clone, Default)]
pub struct IntegrationRow {
    pub provider: String,
    pub config_json: String,
    pub account_id: Option<String>,
    pub account_name: Option<String>,
    pub connected_at: Option<String>,
    pub last_sync_at: Option<String>,
}

pub fn get(conn: &Connection, provider: &str) -> DbResult<Option<IntegrationRow>> {
    Ok(conn
        .query_row(
            "SELECT provider, config_json, account_id, account_name, connected_at, last_sync_at
             FROM integrations WHERE provider = ?1",
            [provider],
            |r| {
                Ok(IntegrationRow {
                    provider: r.get(0)?,
                    config_json: r.get(1)?,
                    account_id: r.get(2)?,
                    account_name: r.get(3)?,
                    connected_at: r.get(4)?,
                    last_sync_at: r.get(5)?,
                })
            },
        )
        .optional()?)
}

pub fn upsert(conn: &Connection, row: &IntegrationRow, now: &str) -> DbResult<()> {
    conn.execute(
        "INSERT INTO integrations (provider, config_json, account_id, account_name, connected_at, last_sync_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT (provider) DO UPDATE SET config_json = excluded.config_json, account_id = excluded.account_id,
            account_name = excluded.account_name, connected_at = excluded.connected_at,
            last_sync_at = excluded.last_sync_at, updated_at = excluded.updated_at",
        params![
            row.provider,
            row.config_json,
            row.account_id,
            row.account_name,
            row.connected_at,
            row.last_sync_at,
            now
        ],
    )?;
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
pub struct MlOrderRow {
    pub order_id: String,
    pub pack_id: Option<String>,
    pub sale_uid: Option<String>,
    pub sale_number: Option<String>,
    pub sale_state: Option<String>,
    pub date_created: String,
    pub buyer: Option<String>,
    pub ml_status: String,
    /// «importada», «por_revisar» o «cancelada».
    pub status: String,
    pub total_minor: i64,
    pub sale_fee_minor: i64,
    pub shipping_cost_minor: i64,
    pub net_minor: i64,
    pub needs_invoice: bool,
    pub billing: Option<serde_json::Value>,
    pub issue: Option<String>,
}

pub struct MlOrderWrite<'a> {
    pub order_id: &'a str,
    pub pack_id: Option<&'a str>,
    pub sale_id: Option<i64>,
    pub date_created: &'a str,
    pub buyer: Option<&'a str>,
    pub ml_status: &'a str,
    pub status: &'a str,
    pub total_minor: i64,
    pub sale_fee_minor: i64,
    pub shipping_cost_minor: i64,
    pub needs_invoice: bool,
    pub billing_json: Option<&'a str>,
    pub issue: Option<&'a str>,
    pub now: &'a str,
}

pub fn upsert_order(conn: &Connection, w: &MlOrderWrite<'_>) -> DbResult<()> {
    conn.execute(
        "INSERT INTO ml_orders (order_id, pack_id, sale_id, date_created, buyer, ml_status, status, total_minor,
            sale_fee_minor, shipping_cost_minor, needs_invoice, billing_json, issue, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
         ON CONFLICT (order_id) DO UPDATE SET pack_id = excluded.pack_id, sale_id = excluded.sale_id,
            buyer = excluded.buyer, ml_status = excluded.ml_status, status = excluded.status,
            total_minor = excluded.total_minor, sale_fee_minor = excluded.sale_fee_minor,
            shipping_cost_minor = excluded.shipping_cost_minor, needs_invoice = excluded.needs_invoice,
            billing_json = excluded.billing_json, issue = excluded.issue, updated_at = excluded.updated_at",
        params![
            w.order_id,
            w.pack_id,
            w.sale_id,
            w.date_created,
            w.buyer,
            w.ml_status,
            w.status,
            w.total_minor,
            w.sale_fee_minor,
            w.shipping_cost_minor,
            w.needs_invoice as i64,
            w.billing_json,
            w.issue,
            w.now
        ],
    )?;
    Ok(())
}

/// Estado guardado de un pedido: (venta enlazada, estado en NÚCLEO).
pub fn order_state(conn: &Connection, order_id: &str) -> DbResult<Option<(Option<i64>, String)>> {
    Ok(conn
        .query_row(
            "SELECT sale_id, status FROM ml_orders WHERE order_id = ?1",
            [order_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?)
}

pub fn list_orders(conn: &Connection, limit: i64) -> DbResult<Vec<MlOrderRow>> {
    let mut st = conn.prepare(
        "SELECT o.order_id, o.pack_id, s.uid, s.number, s.commercial_state, o.date_created, o.buyer, o.ml_status,
                o.status, o.total_minor, o.sale_fee_minor, o.shipping_cost_minor, o.needs_invoice, o.billing_json, o.issue
         FROM ml_orders o LEFT JOIN sales s ON s.id = o.sale_id
         ORDER BY o.date_created DESC, o.order_id DESC LIMIT ?1",
    )?;
    let rows = st.query_map([limit], |r| {
        let total: i64 = r.get(9)?;
        let fee: i64 = r.get(10)?;
        let ship: i64 = r.get(11)?;
        let billing: Option<String> = r.get(13)?;
        Ok(MlOrderRow {
            order_id: r.get(0)?,
            pack_id: r.get(1)?,
            sale_uid: r.get(2)?,
            sale_number: r.get(3)?,
            sale_state: r.get(4)?,
            date_created: r.get(5)?,
            buyer: r.get(6)?,
            ml_status: r.get(7)?,
            status: r.get(8)?,
            total_minor: total,
            sale_fee_minor: fee,
            shipping_cost_minor: ship,
            net_minor: total - fee - ship,
            needs_invoice: r.get::<_, i64>(12)? == 1,
            billing: billing.and_then(|b| serde_json::from_str(&b).ok()),
            issue: r.get(14)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Producto enlazado a una publicación (primero la variación exacta, luego la publicación sin variación).
pub fn linked_product(
    conn: &Connection,
    item_id: &str,
    variation_id: &str,
) -> DbResult<Option<i64>> {
    Ok(conn
        .query_row(
            "SELECT product_id FROM ml_item_links WHERE item_id = ?1 AND variation_id IN (?2, '')
             ORDER BY variation_id = ?2 DESC LIMIT 1",
            [item_id, variation_id],
            |r| r.get(0),
        )
        .optional()?)
}

pub fn link_item(
    conn: &Connection,
    item_id: &str,
    variation_id: &str,
    product_id: i64,
    title: Option<&str>,
    now: &str,
) -> DbResult<()> {
    conn.execute(
        "INSERT INTO ml_item_links (item_id, variation_id, product_id, title, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT (item_id, variation_id) DO UPDATE SET product_id = excluded.product_id, title = excluded.title",
        params![item_id, variation_id, product_id, title, now],
    )?;
    Ok(())
}

/* ─────────────────────────────── WooCommerce ─────────────────────────────── */

#[derive(Debug, Clone, Serialize)]
pub struct WooOrderRow {
    pub order_id: String,
    pub number: String,
    pub sale_uid: Option<String>,
    pub sale_number: Option<String>,
    pub sale_state: Option<String>,
    pub shipment_uid: Option<String>,
    pub shipment_number: Option<String>,
    pub date_created: String,
    pub buyer: Option<String>,
    pub email: Option<String>,
    pub woo_status: String,
    /// «importada», «por_revisar» o «cancelada».
    pub status: String,
    pub total_minor: i64,
    pub shipping_minor: i64,
    pub payment_method: Option<String>,
    pub shipping_method: Option<String>,
    pub needs_invoice: bool,
    pub issue: Option<String>,
}

pub struct WooOrderWrite<'a> {
    pub order_id: &'a str,
    pub number: &'a str,
    pub sale_id: Option<i64>,
    pub date_created: &'a str,
    pub buyer: Option<&'a str>,
    pub email: Option<&'a str>,
    pub woo_status: &'a str,
    pub status: &'a str,
    pub total_minor: i64,
    pub shipping_minor: i64,
    pub payment_method: Option<&'a str>,
    pub shipping_method: Option<&'a str>,
    pub needs_invoice: bool,
    pub issue: Option<&'a str>,
    pub now: &'a str,
}

/// Guarda el pedido de la tienda (el envío enlazado se conserva).
pub fn woo_upsert_order(conn: &Connection, w: &WooOrderWrite<'_>) -> DbResult<()> {
    conn.execute(
        "INSERT INTO woo_orders (order_id, number, sale_id, date_created, buyer, email, woo_status, status,
            total_minor, shipping_minor, payment_method, shipping_method, needs_invoice, issue, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
         ON CONFLICT (order_id) DO UPDATE SET number = excluded.number, sale_id = excluded.sale_id,
            date_created = excluded.date_created, buyer = excluded.buyer, email = excluded.email,
            woo_status = excluded.woo_status, status = excluded.status, total_minor = excluded.total_minor,
            shipping_minor = excluded.shipping_minor, payment_method = excluded.payment_method,
            shipping_method = excluded.shipping_method, needs_invoice = excluded.needs_invoice,
            issue = excluded.issue, updated_at = excluded.updated_at",
        params![
            w.order_id,
            w.number,
            w.sale_id,
            w.date_created,
            w.buyer,
            w.email,
            w.woo_status,
            w.status,
            w.total_minor,
            w.shipping_minor,
            w.payment_method,
            w.shipping_method,
            w.needs_invoice as i64,
            w.issue,
            w.now
        ],
    )?;
    Ok(())
}

/// Venta, envío y estado con que quedó un pedido ya visto.
pub type WooOrderState = (Option<i64>, Option<i64>, String);

pub fn woo_order_state(conn: &Connection, order_id: &str) -> DbResult<Option<WooOrderState>> {
    Ok(conn
        .query_row(
            "SELECT sale_id, shipment_id, status FROM woo_orders WHERE order_id = ?1",
            [order_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?)
}

pub fn woo_set_shipment(conn: &Connection, order_id: &str, shipment_id: i64) -> DbResult<()> {
    conn.execute(
        "UPDATE woo_orders SET shipment_id = ?2 WHERE order_id = ?1",
        params![order_id, shipment_id],
    )?;
    Ok(())
}

pub fn woo_list_orders(conn: &Connection, limit: i64) -> DbResult<Vec<WooOrderRow>> {
    let mut st = conn.prepare(
        "SELECT o.order_id, o.number, s.uid, s.number, s.commercial_state, h.uid, h.number, o.date_created,
                o.buyer, o.email, o.woo_status, o.status, o.total_minor, o.shipping_minor, o.payment_method,
                o.shipping_method, o.needs_invoice, o.issue
         FROM woo_orders o LEFT JOIN sales s ON s.id = o.sale_id LEFT JOIN shipments h ON h.id = o.shipment_id
         ORDER BY o.date_created DESC, CAST(o.order_id AS INTEGER) DESC LIMIT ?1",
    )?;
    let rows = st.query_map([limit], |r| {
        Ok(WooOrderRow {
            order_id: r.get(0)?,
            number: r.get(1)?,
            sale_uid: r.get(2)?,
            sale_number: r.get(3)?,
            sale_state: r.get(4)?,
            shipment_uid: r.get(5)?,
            shipment_number: r.get(6)?,
            date_created: r.get(7)?,
            buyer: r.get(8)?,
            email: r.get(9)?,
            woo_status: r.get(10)?,
            status: r.get(11)?,
            total_minor: r.get(12)?,
            shipping_minor: r.get(13)?,
            payment_method: r.get(14)?,
            shipping_method: r.get(15)?,
            needs_invoice: r.get::<_, i64>(16)? == 1,
            issue: r.get(17)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Producto de NÚCLEO con código (SKU) para enviar a la tienda: stock disponible y precio de lista.
#[derive(Debug, Clone)]
pub struct WooPushProduct {
    pub sku: String,
    pub name: String,
    pub price_minor: i64,
    pub taxable: bool,
    pub track_stock: bool,
    pub on_hand_milli: i64,
    pub reserved_milli: i64,
}

/// Equivalencia guardada: producto de la tienda, variación («» = todas), nombre y componentes (JSON).
pub type WooMapRow = (String, String, String, String);

pub fn woo_map_all(conn: &Connection) -> DbResult<Vec<WooMapRow>> {
    let mut st = conn.prepare(
        "SELECT store_product_id, store_variation_id, store_name, items_json FROM woo_product_map
         ORDER BY store_name COLLATE NOCASE, store_variation_id",
    )?;
    let rows = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Componentes de un producto de la tienda: los de su variación o, si no hay, los del producto.
pub fn woo_map_get(
    conn: &Connection,
    product_id: &str,
    variation_id: &str,
) -> DbResult<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT items_json FROM woo_product_map
             WHERE store_product_id = ?1 AND store_variation_id IN (?2, '')
             ORDER BY store_variation_id = '' LIMIT 1",
            [product_id, variation_id],
            |r| r.get(0),
        )
        .optional()?)
}

pub fn woo_map_set(
    conn: &Connection,
    product_id: &str,
    variation_id: &str,
    name: &str,
    items_json: &str,
    now: &str,
) -> DbResult<()> {
    conn.execute(
        "INSERT INTO woo_product_map (store_product_id, store_variation_id, store_name, items_json, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT (store_product_id, store_variation_id) DO UPDATE SET
            store_name = excluded.store_name, items_json = excluded.items_json, updated_at = excluded.updated_at",
        [product_id, variation_id, name, items_json, now],
    )?;
    Ok(())
}

pub fn woo_map_delete(conn: &Connection, product_id: &str, variation_id: &str) -> DbResult<bool> {
    Ok(conn.execute(
        "DELETE FROM woo_product_map WHERE store_product_id = ?1 AND store_variation_id = ?2",
        [product_id, variation_id],
    )? > 0)
}

pub fn woo_push_products(conn: &Connection) -> DbResult<Vec<WooPushProduct>> {
    let mut st = conn.prepare(
        "SELECT p.sku, p.name, p.price_minor, p.taxable, p.track_stock,
                coalesce(v.on_hand_milli, 0), coalesce(v.reserved_milli, 0)
         FROM products p LEFT JOIN v_stock_position v ON v.product_id = p.id
         WHERE p.archived_at IS NULL AND coalesce(p.sku, '') <> '' AND p.kind <> 'servicio'",
    )?;
    let rows = st.query_map([], |r| {
        Ok(WooPushProduct {
            sku: r.get(0)?,
            name: r.get(1)?,
            price_minor: r.get(2)?,
            taxable: r.get::<_, i64>(3)? == 1,
            track_stock: r.get::<_, i64>(4)? == 1,
            on_hand_milli: r.get(5)?,
            reserved_milli: r.get(6)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}
