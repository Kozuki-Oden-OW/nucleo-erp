//! WooCommerce: conexión con la tienda de la empresa por su API REST (llaves propias, creadas en la
//! tienda o con el plugin «NÚCLEO ERP»), lectura de los pedidos pagados y su paso a NÚCLEO:
//! cliente con sus datos, venta que descuenta stock y envío anotado para la orden de transporte.
//! En el otro sentido, NÚCLEO envía a la tienda el stock disponible y el precio de lista por SKU.
//!
//! Igual que Mercado Libre, la red se usa **fuera** de la sesión (preparar con la sesión, consultar
//! sin ella, aplicar con ella) y el acceso HTTP está detrás de [`WooHttp`] para probar con pedidos de
//! ejemplo.
//!
//! Reglas: un pedido = una venta; nada se registra dos veces; lo que no calza sin duda (producto sin
//! el mismo SKU, stock insuficiente, otra moneda) queda en borrador «por revisar»; un pedido
//! cancelado después de importado solo se avisa (la persona anula la venta). Cambiar precios en la
//! tienda es público: siempre se muestra primero qué cambiaría.

use crate::company::CompanySession;
use crate::history_ops::HistoricalCustomer;
use crate::sale_terms::{Receiver, SaleReference, SaleTerms};
use crate::sales_ops::{EffectInput, LineInput, SaleInput, log};
use crate::ship_ops::ShipmentInput;
use crate::{AppError, AppResult};
use nucleo_db::integrations::{self as db, IntegrationRow, WooOrderRow, WooOrderWrite};
use nucleo_db::now_utc;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::HashMap;

pub const PROVIDER: &str = "woocommerce";
/// Días hacia atrás que se revisan si no se indica otra fecha.
pub const DEFAULT_DAYS: i64 = 30;
/// Prefijo del código de conexión que entrega el plugin de WordPress.
pub const CODE_PREFIX: &str = "nucleo-woo:";
/// Dato del pedido donde NÚCLEO anota el número de su venta (lo muestra el plugin).
pub const META_SALE: &str = "_nucleo_venta";
const PER_PAGE: usize = 100;
const MAX_PAGES: usize = 30;
const BATCH: usize = 50;

/* ─────────────────────────────── Configuración ─────────────────────────────── */

/// Lo que se guarda (cifrado, en la base de la empresa).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct WooConfig {
    /// Dirección de la tienda, sin barra final: `https://datalogger.cl`.
    pub url: String,
    pub consumer_key: String,
    pub consumer_secret: String,
    pub store_name: Option<String>,
    pub currency: Option<String>,
    /// Versión del plugin «NÚCLEO ERP» si está instalado en la tienda.
    pub plugin_version: Option<String>,
    /// Anotar en el pedido de la tienda el número de la venta de NÚCLEO.
    pub write_back: bool,
}

impl Default for WooConfig {
    fn default() -> Self {
        Self {
            url: String::new(),
            consumer_key: String::new(),
            consumer_secret: String::new(),
            store_name: None,
            currency: None,
            plugin_version: None,
            write_back: true,
        }
    }
}

impl WooConfig {
    pub fn configured(&self) -> bool {
        !self.url.is_empty() && !self.consumer_key.is_empty() && !self.consumer_secret.is_empty()
    }
    fn api(&self, path: &str) -> String {
        format!("{}/wp-json/wc/v3/{path}", self.url)
    }
}

/// Lo que ve la interfaz (sin las llaves).
#[derive(Debug, Clone, Serialize)]
pub struct WooStatus {
    pub configured: bool,
    pub connected: bool,
    pub url: Option<String>,
    /// Últimos caracteres de la llave, para reconocerla.
    pub key_hint: Option<String>,
    pub store_name: Option<String>,
    pub currency: Option<String>,
    pub plugin_version: Option<String>,
    pub write_back: bool,
    pub connected_at: Option<String>,
    pub last_sync_at: Option<String>,
}

/// Datos de conexión tal como los escribe la persona. `code` es el código que entrega el plugin
/// (trae dirección y llaves); si viene, reemplaza a los otros campos. Llaves vacías conservan las
/// guardadas.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct WooConnectInput {
    pub url: String,
    pub consumer_key: String,
    pub consumer_secret: String,
    pub code: String,
    pub write_back: Option<bool>,
}

/// Dirección de la tienda normalizada (https, sin barra final ni `/wp-json`).
pub fn clean_url(input: &str) -> AppResult<String> {
    let mut u = input.trim().trim_end_matches('/').to_string();
    for tail in ["/wp-json/wc/v3", "/wp-json", "/wp-admin"] {
        if let Some(s) = u.strip_suffix(tail) {
            u = s.to_string();
        }
    }
    let local = u.starts_with("http://127.0.0.1") || u.starts_with("http://localhost");
    if !(u.starts_with("https://") || local) {
        return Err(AppError::Validation(
            "la dirección de la tienda debe empezar con https:// (ej. https://mitienda.cl)".into(),
        ));
    }
    if u.len() > 200 || u.contains(['?', '#', '@', ' ']) || u.len() < 12 {
        return Err(AppError::Validation(
            "escribe solo la dirección de la tienda, sin parámetros (ej. https://mitienda.cl)"
                .into(),
        ));
    }
    Ok(u)
}

/// Lee el código de conexión del plugin: `nucleo-woo:` + base64url de `{"u","k","s"}`.
pub fn parse_code(code: &str) -> AppResult<(String, String, String)> {
    let bad = || {
        AppError::Validation(
            "el código de conexión no es válido: cópialo completo desde WooCommerce → NÚCLEO ERP"
                .into(),
        )
    };
    let body = code.trim().strip_prefix(CODE_PREFIX).ok_or_else(bad)?;
    let raw = data_encoding::BASE64URL_NOPAD
        .decode(body.trim_end_matches('=').as_bytes())
        .map_err(|_| bad())?;
    let v: Value = serde_json::from_slice(&raw).map_err(|_| bad())?;
    let s = |k: &str| v.get(k).and_then(Value::as_str).map(str::to_string);
    match (s("u"), s("k"), s("s")) {
        (Some(u), Some(k), Some(sec)) => Ok((u, k, sec)),
        _ => Err(bad()),
    }
}

/* ─────────────────────────────── Acceso HTTP ─────────────────────────────── */

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WooError {
    /// Respuesta con código de error (estado, cuerpo).
    Status(u16, String),
    /// Sin conexión, DNS, TLS…
    Network(String),
    /// La tienda respondió algo que NÚCLEO no puede usar.
    Other(String),
}

impl std::fmt::Display for WooError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            WooError::Status(401 | 403, _) => write!(
                f,
                "la tienda no aceptó las llaves: revisa que sean de un usuario administrador y con permiso de lectura y escritura"
            ),
            WooError::Status(404, _) => write!(
                f,
                "la tienda no tiene la API de WooCommerce en esa dirección (¿WooCommerce activo y enlaces permanentes distintos de «Simple»?)"
            ),
            WooError::Status(c, b) => write!(f, "la tienda respondió {c}: {}", short(b)),
            WooError::Network(e) => write!(f, "no se pudo conectar con la tienda: {e}"),
            WooError::Other(e) => write!(f, "{e}"),
        }
    }
}

fn short(s: &str) -> String {
    let t: String = s.chars().take(200).collect();
    t.replace(['\n', '\r'], " ")
}

pub trait WooHttp {
    fn get(&self, url: &str, cfg: &WooConfig) -> Result<Value, WooError>;
    /// `method`: «POST» o «PUT».
    fn send(
        &self,
        method: &str,
        url: &str,
        cfg: &WooConfig,
        body: &Value,
    ) -> Result<Value, WooError>;
}

/// Cliente real (HTTPS con las raíces de Mozilla; las llaves van en la cabecera, nunca en la dirección).
pub struct UreqHttp {
    agent: ureq::Agent,
}

impl Default for UreqHttp {
    fn default() -> Self {
        Self {
            agent: ureq::AgentBuilder::new()
                .timeout(std::time::Duration::from_secs(45))
                .user_agent(concat!("NucleoERP/", env!("CARGO_PKG_VERSION")))
                .build(),
        }
    }
}

fn basic(cfg: &WooConfig) -> String {
    format!(
        "Basic {}",
        data_encoding::BASE64
            .encode(format!("{}:{}", cfg.consumer_key, cfg.consumer_secret).as_bytes())
    )
}

fn ureq_result(r: Result<ureq::Response, ureq::Error>) -> Result<Value, WooError> {
    match r {
        Ok(resp) => resp
            .into_json::<Value>()
            .map_err(|e| WooError::Network(e.to_string())),
        Err(ureq::Error::Status(code, resp)) => Err(WooError::Status(
            code,
            resp.into_string().unwrap_or_default(),
        )),
        Err(e) => Err(WooError::Network(e.to_string())),
    }
}

impl WooHttp for UreqHttp {
    fn get(&self, url: &str, cfg: &WooConfig) -> Result<Value, WooError> {
        ureq_result(
            self.agent
                .get(url)
                .set("Authorization", &basic(cfg))
                .set("Accept", "application/json")
                .call(),
        )
    }
    fn send(
        &self,
        method: &str,
        url: &str,
        cfg: &WooConfig,
        body: &Value,
    ) -> Result<Value, WooError> {
        ureq_result(
            self.agent
                .request(method, url)
                .set("Authorization", &basic(cfg))
                .set("Accept", "application/json")
                .send_json(body.clone()),
        )
    }
}

/* ─────────────────────────────── Datos de la tienda ─────────────────────────────── */

/// Lo que NÚCLEO necesita saber de la tienda.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct WooInfo {
    pub store_name: Option<String>,
    pub currency: Option<String>,
    pub plugin_version: Option<String>,
    /// La tienda calcula impuestos.
    pub calc_taxes: Option<bool>,
    /// Los precios de la tienda se escriben con el impuesto incluido.
    pub prices_include_tax: Option<bool>,
}

fn yes(v: Option<&Value>) -> Option<bool> {
    match v? {
        Value::Bool(b) => Some(*b),
        Value::String(s) => Some(s == "yes" || s == "true" || s == "1"),
        _ => None,
    }
}

fn setting(http: &dyn WooHttp, cfg: &WooConfig, group: &str, id: &str) -> Option<Value> {
    http.get(&cfg.api(&format!("settings/{group}/{id}")), cfg)
        .ok()
        .and_then(|v| v.get("value").cloned())
}

/// Prueba las llaves y lee moneda, impuestos y si está el plugin de NÚCLEO.
pub fn check(http: &dyn WooHttp, cfg: &WooConfig) -> Result<WooInfo, WooError> {
    // Con el plugin, una sola consulta trae todo.
    match http.get(&format!("{}/wp-json/nucleo-erp/v1/status", cfg.url), cfg) {
        Ok(v) if v.get("plugin").is_some() => {
            let s = |k: &str| {
                v.get(k)
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .filter(|x| !x.is_empty())
            };
            return Ok(WooInfo {
                store_name: s("store"),
                currency: s("currency"),
                plugin_version: s("version"),
                calc_taxes: yes(v.get("calc_taxes")),
                prices_include_tax: yes(v.get("prices_include_tax")),
            });
        }
        Err(WooError::Network(e)) => return Err(WooError::Network(e)),
        _ => {}
    }
    // Sin el plugin: una consulta mínima valida las llaves; el resto sale de los ajustes.
    http.get(&cfg.api("orders?per_page=1&_fields=id"), cfg)?;
    let currency = setting(http, cfg, "general", "woocommerce_currency")
        .and_then(|v| v.as_str().map(str::to_string));
    let calc = yes(setting(http, cfg, "general", "woocommerce_calc_taxes").as_ref());
    let incl = match calc {
        Some(true) => yes(setting(http, cfg, "tax", "woocommerce_prices_include_tax").as_ref()),
        _ => None,
    };
    let store_name = http
        .get(&format!("{}/wp-json/?_fields=name", cfg.url), cfg)
        .ok()
        .and_then(|v| v.get("name").and_then(Value::as_str).map(str::to_string))
        .filter(|n| !n.is_empty());
    Ok(WooInfo {
        store_name,
        currency,
        plugin_version: None,
        calc_taxes: calc,
        prices_include_tax: incl,
    })
}

/* ─────────────────────────────── Pedidos ─────────────────────────────── */

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct WooAddress {
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub company: Option<String>,
    pub address_1: Option<String>,
    pub address_2: Option<String>,
    pub city: Option<String>,
    pub state: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
}

impl WooAddress {
    fn full_name(&self) -> Option<String> {
        let n = [self.first_name.as_deref(), self.last_name.as_deref()]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
            .join(" ");
        Some(n).filter(|n| !n.trim().is_empty())
    }
    fn has_address(&self) -> bool {
        self.address_1.is_some()
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct WooItem {
    pub name: String,
    pub sku: Option<String>,
    pub product_id: String,
    pub variation_id: String,
    pub qty_milli: i64,
    /// Antes y después de cupones, sin impuesto (como lo informa la tienda).
    pub subtotal_minor: i64,
    pub total_minor: i64,
}

/// Datos de facturación chilenos (RUT, razón social, giro) que agregan el plugin de NÚCLEO u otros.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct WooDoc {
    pub wants_invoice: bool,
    pub rut: Option<String>,
    pub business_name: Option<String>,
    pub activity: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct WooOrder {
    pub id: String,
    pub number: String,
    pub status: String,
    /// AAAA-MM-DD (hora de la tienda).
    pub date: String,
    pub currency: String,
    pub total_minor: i64,
    pub total_tax_minor: i64,
    /// Envío sin impuesto y su impuesto.
    pub shipping_minor: i64,
    pub shipping_tax_minor: i64,
    pub payment_method: Option<String>,
    pub transaction_id: Option<String>,
    pub note: Option<String>,
    pub billing: WooAddress,
    pub shipping: WooAddress,
    pub items: Vec<WooItem>,
    pub shipping_method: Option<String>,
    /// Cargos extra (nombre, monto sin impuesto).
    pub fees: Vec<(String, i64)>,
    pub doc: WooDoc,
}

impl WooOrder {
    /// Pagado: se registra como venta.
    pub fn paid(&self) -> bool {
        matches!(self.status.as_str(), "processing" | "completed")
    }
    pub fn cancelled(&self) -> bool {
        matches!(self.status.as_str(), "cancelled" | "refunded" | "failed")
    }
    /// Retiro en la tienda: no lleva envío.
    fn pickup(&self) -> bool {
        self.shipping_method.as_deref().is_some_and(|m| {
            let m = m.to_lowercase();
            m.contains("retiro") || m.contains("pickup") || m.contains("recogida")
        })
    }
}

fn text(v: Option<&Value>) -> Option<String> {
    match v? {
        Value::String(s) => Some(s.trim().to_string()).filter(|s| !s.is_empty()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

/// Monto de la tienda («12990», «12990.00» o número) en pesos.
fn money(v: Option<&Value>) -> i64 {
    match v {
        Some(Value::String(s)) => s
            .trim()
            .parse::<f64>()
            .map(|f| f.round() as i64)
            .unwrap_or(0),
        Some(Value::Number(n)) => n.as_f64().map(|f| f.round() as i64).unwrap_or(0),
        _ => 0,
    }
}

fn address(v: Option<&Value>) -> WooAddress {
    let g = |k: &str| text(v.and_then(|a| a.get(k)));
    WooAddress {
        first_name: g("first_name"),
        last_name: g("last_name"),
        company: g("company"),
        address_1: g("address_1"),
        address_2: g("address_2"),
        city: g("city"),
        state: g("state"),
        email: g("email").filter(|e| e.contains('@') && !e.contains(' ')),
        phone: g("phone"),
    }
}

fn doc_of(meta: Option<&Value>, billing: &WooAddress) -> WooDoc {
    let mut d = WooDoc::default();
    let mut flag: Option<bool> = None;
    for m in meta.and_then(Value::as_array).into_iter().flatten() {
        let key = m
            .get("key")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_lowercase();
        let Some(val) = text(m.get("value")) else {
            continue;
        };
        if key.contains("rut") && d.rut.is_none() {
            d.rut = Some(val).filter(|r| nucleo_domain::rut::Rut::parse(r).is_ok());
        } else if key.contains("giro") && d.activity.is_none() {
            d.activity = Some(val);
        } else if (key.contains("razon") || key.contains("razón")) && d.business_name.is_none() {
            d.business_name = Some(val);
        } else if key.contains("documento") || key.contains("tipo_doc") || key.contains("factura") {
            let v = val.to_lowercase();
            if v.contains("factura") || v == "yes" || v == "1" || v == "si" || v == "sí" {
                flag = Some(true);
            } else if v.contains("boleta") || v == "no" || v == "0" {
                flag = Some(false);
            }
        }
    }
    if d.business_name.is_none() {
        d.business_name = billing.company.clone();
    }
    // Sin una elección explícita: pide factura quien dejó RUT y además giro o razón social.
    d.wants_invoice = flag
        .unwrap_or(d.rut.is_some() && (d.activity.is_some() || d.business_name.is_some()))
        && d.rut.is_some();
    d
}

/// Lee un pedido de `/wc/v3/orders`.
pub fn parse_order(v: &Value) -> Option<WooOrder> {
    let id = text(v.get("id"))?;
    let date = text(v.get("date_created"))?;
    if date.len() < 10 {
        return None;
    }
    let billing = address(v.get("billing"));
    let items = v
        .get("line_items")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|i| {
                    let qty = i.get("quantity").and_then(Value::as_f64)?;
                    if qty <= 0.0 {
                        return None;
                    }
                    Some(WooItem {
                        name: text(i.get("name")).unwrap_or_else(|| "Producto".into()),
                        sku: text(i.get("sku")),
                        product_id: text(i.get("product_id")).unwrap_or_default(),
                        variation_id: text(i.get("variation_id"))
                            .filter(|x| x != "0")
                            .unwrap_or_default(),
                        qty_milli: (qty * 1000.0).round() as i64,
                        subtotal_minor: money(i.get("subtotal")),
                        total_minor: money(i.get("total")),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let first_line = |k: &str| v.get(k).and_then(Value::as_array).and_then(|a| a.first());
    Some(WooOrder {
        number: text(v.get("number")).unwrap_or_else(|| id.clone()),
        status: text(v.get("status")).unwrap_or_default(),
        date: date[..10].to_string(),
        currency: text(v.get("currency")).unwrap_or_default(),
        total_minor: money(v.get("total")),
        total_tax_minor: money(v.get("total_tax")),
        shipping_minor: money(v.get("shipping_total")),
        shipping_tax_minor: money(v.get("shipping_tax")),
        payment_method: text(v.get("payment_method_title")).or(text(v.get("payment_method"))),
        transaction_id: text(v.get("transaction_id")),
        note: text(v.get("customer_note")),
        doc: doc_of(v.get("meta_data"), &billing),
        shipping: address(v.get("shipping")),
        billing,
        items,
        shipping_method: first_line("shipping_lines").and_then(|l| text(l.get("method_title"))),
        fees: v
            .get("fee_lines")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .map(|f| {
                        (
                            text(f.get("name")).unwrap_or_else(|| "Cargo".into()),
                            money(f.get("total")),
                        )
                    })
                    .filter(|(_, m)| *m != 0)
                    .collect()
            })
            .unwrap_or_default(),
        id,
    })
}

#[derive(Debug, Clone)]
pub struct Known {
    pub status: String,
    pub woo_status: String,
}

/// Lo que se necesita para consultar la tienda sin la sesión.
#[derive(Debug, Clone)]
pub struct SyncPlan {
    pub config: WooConfig,
    /// Fecha desde (AAAA-MM-DD).
    pub from: String,
    pub known: HashMap<String, Known>,
}

fn pages(http: &dyn WooHttp, cfg: &WooConfig, path: &str) -> Result<Vec<Value>, WooError> {
    let mut out = Vec::new();
    let sep = if path.contains('?') { '&' } else { '?' };
    for page in 1..=MAX_PAGES {
        let v = http.get(
            &cfg.api(&format!("{path}{sep}per_page={PER_PAGE}&page={page}")),
            cfg,
        )?;
        let list = v.as_array().cloned().ok_or_else(|| {
            WooError::Other("la tienda respondió algo que no es una lista".into())
        })?;
        let n = list.len();
        out.extend(list);
        if n < PER_PAGE {
            break;
        }
    }
    Ok(out)
}

/// Paso 2 de la sincronización (sin la sesión): pedidos creados desde la fecha.
pub fn fetch(http: &dyn WooHttp, plan: &SyncPlan) -> Result<Vec<WooOrder>, WooError> {
    let list = pages(
        http,
        &plan.config,
        &format!("orders?after={}T00:00:00&orderby=date&order=asc", plan.from),
    )?;
    Ok(list.iter().filter_map(parse_order).collect())
}

/// Anota en cada pedido de la tienda el número de la venta de NÚCLEO. Devuelve los que fallaron.
pub fn write_back(http: &dyn WooHttp, cfg: &WooConfig, items: &[(String, String)]) -> Vec<String> {
    let mut failed = Vec::new();
    for (order_id, number) in items {
        let body = json!({ "meta_data": [{ "key": META_SALE, "value": number }] });
        if let Err(e) = http.send("PUT", &cfg.api(&format!("orders/{order_id}")), cfg, &body) {
            failed.push(format!(
                "Pedido {order_id}: no se pudo anotar la venta en la tienda ({e})"
            ));
        }
    }
    failed
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct WooSyncReport {
    /// Ventas creadas y efectuadas.
    pub imported: usize,
    /// Ventas que quedaron en borrador por revisar.
    pub to_review: usize,
    /// Ventas por revisar que ahora se efectuaron.
    pub completed: usize,
    /// Pedidos cancelados en la tienda después de importados.
    pub cancelled: usize,
    /// Pedidos ya importados sin cambios.
    pub unchanged: usize,
    /// Pedidos aún sin pagar (no se registran).
    pub waiting_payment: usize,
    /// Pedidos que piden factura.
    pub to_invoice: usize,
    /// Envíos anotados.
    pub shipments: usize,
    pub messages: Vec<String>,
    /// Pedido y n.º de venta para anotar en la tienda.
    #[serde(skip)]
    pub to_write_back: Vec<(String, String)>,
}

/* ─────────────────────────────── Stock y precios hacia la tienda ─────────────────────────────── */

#[derive(Debug, Clone)]
pub struct PushItem {
    pub sku: String,
    pub name: String,
    /// Unidades disponibles (en bodega menos lo reservado); `None` si el producto no lleva stock.
    pub stock_units: Option<i64>,
    pub price_net_minor: i64,
    pub taxable: bool,
}

/// Lo que se necesita para comparar con la tienda sin la sesión.
#[derive(Debug, Clone)]
pub struct PushPlan {
    pub config: WooConfig,
    /// Por SKU en minúsculas.
    pub items: HashMap<String, PushItem>,
    pub tax_ppm: Option<i64>,
    pub stock: bool,
    pub prices: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct PushChange {
    pub sku: String,
    pub name: String,
    #[serde(skip)]
    pub store_id: String,
    /// Producto con variaciones al que pertenece (si es una variación).
    #[serde(skip)]
    pub parent_id: Option<String>,
    pub stock_from: Option<i64>,
    pub stock_to: Option<i64>,
    pub price_from: Option<i64>,
    pub price_to: Option<i64>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct WooPushReport {
    pub changes: Vec<PushChange>,
    /// `true` si los cambios ya se enviaron a la tienda.
    pub applied: bool,
    /// Productos que calzan por SKU.
    pub matched: usize,
    /// Productos de NÚCLEO con SKU que no están en la tienda.
    pub not_in_store: usize,
    /// Productos de la tienda sin SKU o con un SKU que NÚCLEO no tiene.
    pub not_in_nucleo: usize,
    /// Los precios de la tienda llevan el IVA incluido.
    pub prices_with_tax: Option<bool>,
    pub messages: Vec<String>,
}

struct StoreProduct {
    id: String,
    parent_id: Option<String>,
    sku: Option<String>,
    manage_stock: bool,
    stock: Option<i64>,
    price: Option<i64>,
}

fn store_product(v: &Value, parent: Option<&str>) -> Option<StoreProduct> {
    Some(StoreProduct {
        id: text(v.get("id"))?,
        parent_id: parent.map(str::to_string),
        sku: text(v.get("sku")),
        manage_stock: v.get("manage_stock").and_then(Value::as_bool) == Some(true),
        stock: v
            .get("stock_quantity")
            .and_then(Value::as_f64)
            .map(|f| f.round() as i64),
        price: text(v.get("regular_price"))
            .and_then(|p| p.parse::<f64>().ok())
            .map(|f| f.round() as i64),
    })
}

fn gross_of(net: i64, tax_ppm: Option<i64>) -> i64 {
    match tax_ppm {
        Some(p) if p > 0 => net + ((net as i128 * p as i128 + 500_000) / 1_000_000) as i64,
        _ => net,
    }
}

/// Compara NÚCLEO con la tienda y, con `apply`, envía los cambios. Sin la sesión.
pub fn push(http: &dyn WooHttp, plan: &PushPlan, apply: bool) -> Result<WooPushReport, WooError> {
    let cfg = &plan.config;
    let mut report = WooPushReport::default();
    // Cómo se escriben los precios en la tienda: sin saberlo no se tocan.
    let mut with_tax = None;
    if plan.prices {
        let info = check(http, cfg)?;
        with_tax = match (info.calc_taxes, info.prices_include_tax) {
            (Some(false), _) => Some(true),
            (Some(true), Some(i)) => Some(i),
            _ => None,
        };
        if with_tax.is_none() {
            return Err(WooError::Other(
                "no se pudo saber si los precios de la tienda llevan el IVA incluido (WooCommerce → Ajustes → Impuestos): los precios no se cambian".into(),
            ));
        }
        report.prices_with_tax = with_tax;
    }
    let fields = "_fields=id,type,sku,name,manage_stock,stock_quantity,regular_price";
    let mut store = Vec::new();
    for p in pages(http, cfg, &format!("products?{fields}"))? {
        let is_variable = p.get("type").and_then(Value::as_str) == Some("variable");
        if let Some(sp) = store_product(&p, None) {
            if is_variable {
                for v in pages(
                    http,
                    cfg,
                    &format!("products/{}/variations?{fields}", sp.id),
                )? {
                    store.extend(store_product(&v, Some(&sp.id)));
                }
            } else {
                store.push(sp);
            }
        }
    }
    let mut seen = std::collections::HashSet::new();
    for sp in &store {
        let Some(item) = sp
            .sku
            .as_ref()
            .and_then(|s| plan.items.get(&s.to_lowercase()))
        else {
            report.not_in_nucleo += 1;
            continue;
        };
        seen.insert(item.sku.to_lowercase());
        report.matched += 1;
        let stock_to = match (plan.stock, item.stock_units) {
            (true, Some(u)) if !sp.manage_stock || sp.stock != Some(u) => Some(u),
            _ => None,
        };
        let price_to = match (plan.prices, with_tax) {
            (true, Some(gross)) if item.price_net_minor > 0 => {
                let p = if gross && item.taxable {
                    gross_of(item.price_net_minor, plan.tax_ppm)
                } else {
                    item.price_net_minor
                };
                Some(p).filter(|p| sp.price != Some(*p))
            }
            _ => None,
        };
        if stock_to.is_some() || price_to.is_some() {
            report.changes.push(PushChange {
                sku: item.sku.clone(),
                name: item.name.clone(),
                store_id: sp.id.clone(),
                parent_id: sp.parent_id.clone(),
                stock_from: sp.stock.filter(|_| sp.manage_stock),
                stock_to,
                price_from: sp.price,
                price_to,
            });
        }
    }
    report.not_in_store = plan.items.len() - seen.len();
    report.changes.sort_by(|a, b| a.sku.cmp(&b.sku));
    if apply && !report.changes.is_empty() {
        let mut groups: HashMap<Option<String>, Vec<Value>> = HashMap::new();
        for c in &report.changes {
            let mut u = serde_json::Map::new();
            u.insert(
                "id".into(),
                c.store_id
                    .parse::<i64>()
                    .map(Value::from)
                    .unwrap_or_else(|_| Value::from(c.store_id.clone())),
            );
            if let Some(s) = c.stock_to {
                u.insert("manage_stock".into(), Value::Bool(true));
                u.insert("stock_quantity".into(), Value::from(s));
            }
            if let Some(p) = c.price_to {
                u.insert("regular_price".into(), Value::from(p.to_string()));
            }
            groups
                .entry(c.parent_id.clone())
                .or_default()
                .push(Value::Object(u));
        }
        for (parent, updates) in groups {
            let path = match &parent {
                Some(p) => format!("products/{p}/variations/batch"),
                None => "products/batch".to_string(),
            };
            for chunk in updates.chunks(BATCH) {
                http.send("POST", &cfg.api(&path), cfg, &json!({ "update": chunk }))?;
            }
        }
        report.applied = true;
    }
    Ok(report)
}

/* ─────────────────────────────── Sesión ─────────────────────────────── */

fn net_of(gross: i64, tax_ppm: Option<i64>) -> i64 {
    match tax_ppm {
        Some(p) if p > 0 => {
            let n = gross as i128 * 1_000_000;
            let d = 1_000_000 + p as i128;
            ((n + d / 2) / d) as i64
        }
        _ => gross,
    }
}

fn clip(v: &Option<String>, max: usize) -> Option<String> {
    v.as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.chars().take(max).collect())
}

/// Courier según el nombre del método de envío de la tienda.
fn carrier_of(method: &str) -> Option<&'static str> {
    let m = method.to_lowercase();
    [
        ("blue", "Bluexpress"),
        ("starken", "Starken"),
        ("chilexpress", "Chilexpress"),
        ("correos", "Correos de Chile"),
    ]
    .into_iter()
    .find(|(k, _)| m.contains(k))
    .map(|(_, n)| n)
}

/// Medio de pago de NÚCLEO según el de la tienda: (condición de la venta, medio del cobro).
fn payment_of(method: Option<&str>) -> (&'static str, &'static str) {
    let m = method.unwrap_or("").to_lowercase();
    if m.contains("transfer") || m.contains("depósito") || m.contains("deposito") {
        ("transferencia", "Transferencia")
    } else if m.contains("webpay")
        || m.contains("tarjeta")
        || m.contains("transbank")
        || m.contains("card")
        || m.contains("flow")
        || m.contains("mercado pago")
    {
        ("tarjeta", "Tarjeta de débito")
    } else {
        ("otro", "Otro")
    }
}

impl CompanySession {
    fn woo_row(&self) -> AppResult<IntegrationRow> {
        Ok(
            db::get(self.db.conn(), PROVIDER)?.unwrap_or(IntegrationRow {
                provider: PROVIDER.into(),
                config_json: "{}".into(),
                ..Default::default()
            }),
        )
    }

    pub fn woo_config(&self) -> AppResult<WooConfig> {
        let row = self.woo_row()?;
        Ok(serde_json::from_str(&row.config_json).unwrap_or_default())
    }

    fn woo_save(&mut self, cfg: &WooConfig, f: impl FnOnce(&mut IntegrationRow)) -> AppResult<()> {
        let mut row = self.woo_row()?;
        row.config_json =
            serde_json::to_string(cfg).map_err(|e| AppError::Validation(e.to_string()))?;
        f(&mut row);
        db::upsert(self.db.conn(), &row, &now_utc())?;
        Ok(())
    }

    pub fn woo_status(&self) -> AppResult<WooStatus> {
        self.require("ventas.ver")?;
        let row = self.woo_row()?;
        let c = self.woo_config()?;
        let hint = c.consumer_key.chars().rev().take(4).collect::<Vec<_>>();
        Ok(WooStatus {
            configured: c.configured(),
            connected: c.configured() && row.connected_at.is_some(),
            url: Some(c.url.clone()).filter(|u| !u.is_empty()),
            key_hint: (!c.consumer_key.is_empty())
                .then(|| format!("…{}", hint.into_iter().rev().collect::<String>())),
            store_name: c.store_name,
            currency: c.currency,
            plugin_version: c.plugin_version,
            write_back: c.write_back,
            connected_at: row.connected_at,
            last_sync_at: row.last_sync_at,
        })
    }

    /// Valida lo escrito y devuelve la configuración a probar (aún no se guarda).
    pub fn woo_connect_plan(&self, input: &WooConnectInput) -> AppResult<WooConfig> {
        self.require("config.editar")?;
        let mut c = self.woo_config()?;
        let (url, key, secret) = if input.code.trim().is_empty() {
            (
                input.url.clone(),
                input.consumer_key.trim().to_string(),
                input.consumer_secret.trim().to_string(),
            )
        } else {
            parse_code(&input.code)?
        };
        let url = if url.trim().is_empty() && !c.url.is_empty() {
            c.url.clone()
        } else {
            clean_url(&url)?
        };
        if url != c.url {
            // Otra tienda: las llaves anteriores no sirven.
            c = WooConfig::default();
        }
        c.url = url;
        if !key.is_empty() {
            if !key.starts_with("ck_") || key.len() > 80 {
                return Err(AppError::Validation(
                    "la clave del cliente de WooCommerce empieza con ck_".into(),
                ));
            }
            c.consumer_key = key;
        }
        if !secret.is_empty() {
            if !secret.starts_with("cs_") || secret.len() > 80 {
                return Err(AppError::Validation(
                    "la clave secreta de WooCommerce empieza con cs_".into(),
                ));
            }
            c.consumer_secret = secret;
        }
        if !c.configured() {
            return Err(AppError::Validation(
                "faltan las llaves de la tienda (clave del cliente ck_… y clave secreta cs_…)"
                    .into(),
            ));
        }
        if let Some(w) = input.write_back {
            c.write_back = w;
        }
        Ok(c)
    }

    /// Guarda la conexión ya probada con lo que informó la tienda.
    pub fn woo_connected(&mut self, cfg: &WooConfig, info: &WooInfo) -> AppResult<WooStatus> {
        self.require("config.editar")?;
        let mut c = cfg.clone();
        c.store_name = info.store_name.clone();
        c.currency = info.currency.clone();
        c.plugin_version = info.plugin_version.clone();
        let now = now_utc();
        let name = c.store_name.clone().unwrap_or_else(|| c.url.clone());
        let user = self.actor_name()?;
        self.woo_save(&c, |r| {
            r.account_id = Some(c.url.clone());
            r.account_name = Some(name.clone());
            r.connected_at.get_or_insert(now);
        })?;
        log(
            self.db.conn(),
            &user,
            "update",
            "integracion",
            PROVIDER,
            &format!("Conectó la tienda WooCommerce {name}"),
            None,
        )?;
        self.woo_status()
    }

    pub fn woo_disconnect(&mut self) -> AppResult<WooStatus> {
        self.require("config.editar")?;
        let user = self.actor_name()?;
        self.woo_save(&WooConfig::default(), |r| {
            r.account_id = None;
            r.account_name = None;
            r.connected_at = None;
        })?;
        log(
            self.db.conn(),
            &user,
            "update",
            "integracion",
            PROVIDER,
            "Desconectó la tienda WooCommerce (se borraron las llaves guardadas)",
            None,
        )?;
        self.woo_status()
    }

    fn woo_ready(&self) -> AppResult<WooConfig> {
        let c = self.woo_config()?;
        if !c.configured() || self.woo_row()?.connected_at.is_none() {
            return Err(AppError::Validation(
                "la tienda WooCommerce no está conectada: Configuración → Integraciones".into(),
            ));
        }
        Ok(c)
    }

    /// Paso 1 de la sincronización: datos para consultar sin la sesión.
    pub fn woo_sync_plan(&self, from: Option<&str>) -> AppResult<SyncPlan> {
        self.require("ventas.crear")?;
        let config = self.woo_ready()?;
        let from = match from.map(str::trim).filter(|f| !f.is_empty()) {
            Some(f) => crate::sales_ops::parse_date("la fecha desde", f)?,
            None => {
                let today = crate::sales_ops::local_today(self.db.conn())?;
                let d = crate::inventory_ops::date_ord(&today).unwrap_or(0);
                crate::inventory_ops::date_str(d - DEFAULT_DAYS)
            }
        };
        let mut st = self
            .db
            .conn()
            .prepare("SELECT order_id, status, woo_status FROM woo_orders")?;
        let known = st
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    Known {
                        status: r.get(1)?,
                        woo_status: r.get(2)?,
                    },
                ))
            })?
            .collect::<Result<HashMap<_, _>, _>>()?;
        Ok(SyncPlan {
            config,
            from,
            known,
        })
    }

    /// Paso 3: pasa los pedidos a clientes, ventas y envíos.
    pub fn woo_apply(&mut self, orders: &[WooOrder]) -> AppResult<WooSyncReport> {
        self.require("ventas.crear")?;
        let mut report = WooSyncReport::default();
        for o in orders {
            if let Err(e) = self.woo_apply_order(o, &mut report) {
                report.messages.push(format!("Pedido #{}: {e}", o.number));
            }
        }
        let now = now_utc();
        self.woo_save(&self.woo_config()?, |r| r.last_sync_at = Some(now))?;
        Ok(report)
    }

    fn woo_apply_order(&mut self, o: &WooOrder, report: &mut WooSyncReport) -> AppResult<()> {
        let now = now_utc();
        let state = db::woo_order_state(self.db.conn(), &o.id)?;
        let existing_sale = state.as_ref().and_then(|(s, _, _)| *s);
        let had_shipment = state.as_ref().is_some_and(|(_, h, _)| h.is_some());
        let prev = state.as_ref().map(|(_, _, st)| st.as_str());

        // Ya importado: solo avisar si se canceló en la tienda.
        if matches!(prev, Some("importada" | "cancelada")) {
            if o.cancelled() && prev != Some("cancelada") {
                let number = self.woo_sale_number(existing_sale)?;
                let issue = format!(
                    "Cancelado o reembolsado en la tienda: anula la venta {}",
                    number.as_deref().unwrap_or("enlazada")
                );
                self.woo_mark(o, existing_sale, "cancelada", Some(&issue), false, &now)?;
                report.cancelled += 1;
                report
                    .messages
                    .push(format!("Pedido #{}: {issue}", o.number));
            } else {
                report.unchanged += 1;
            }
            return Ok(());
        }
        if existing_sale.is_some() && o.cancelled() {
            self.woo_mark(
                o,
                existing_sale,
                "cancelada",
                Some("Cancelado en la tienda antes de confirmar: anula el borrador"),
                false,
                &now,
            )?;
            report.cancelled += 1;
            return Ok(());
        }
        // Nuevo y sin pagar o cancelado: no se registra.
        if !o.paid() {
            if existing_sale.is_none() && !o.cancelled() {
                report.waiting_payment += 1;
            }
            return Ok(());
        }
        if o.items.is_empty() {
            return Ok(());
        }

        let tax = self.tax_ppm()?;
        // Si la tienda no calcula impuestos, sus montos ya llevan el IVA: se pasan a neto.
        let gross_amounts = o.total_tax_minor == 0;
        let net = |amount: i64| {
            if gross_amounts {
                net_of(amount, tax)
            } else {
                amount
            }
        };
        let mut lines = Vec::new();
        let mut missing = Vec::new();
        for it in &o.items {
            let product = self.woo_product_for(it)?;
            if product.is_none() {
                missing.push(match &it.sku {
                    Some(s) => format!("«{}» (SKU {s})", it.name),
                    None => format!("«{}» (sin SKU en la tienda)", it.name),
                });
            }
            let base = it.subtotal_minor.max(it.total_minor);
            let unit =
                ((base as i128 * 1000 + it.qty_milli as i128 / 2) / it.qty_milli as i128) as i64;
            let discount_ppm = if base > 0 && it.total_minor < base {
                (((base - it.total_minor) as i128 * 1_000_000 + base as i128 / 2) / base as i128)
                    as i64
            } else {
                0
            };
            lines.push(LineInput {
                product_uid: product,
                description: it.name.chars().take(200).collect(),
                qty_milli: it.qty_milli,
                unit_price_minor: net(unit),
                discount_ppm,
                taxable: true,
            });
        }
        if o.shipping_minor > 0 {
            lines.push(LineInput {
                product_uid: None,
                description: match &o.shipping_method {
                    Some(m) => format!("Envío {m}").chars().take(200).collect(),
                    None => "Envío".into(),
                },
                qty_milli: 1000,
                unit_price_minor: net(o.shipping_minor),
                discount_ppm: 0,
                taxable: true,
            });
        }
        for (name, amount) in &o.fees {
            if *amount > 0 {
                lines.push(LineInput {
                    product_uid: None,
                    description: name.chars().take(200).collect(),
                    qty_milli: 1000,
                    unit_price_minor: net(*amount),
                    discount_ppm: 0,
                    taxable: true,
                });
            }
        }

        let customer_uid = self.woo_customer(o)?;
        let (payment, method) = payment_of(o.payment_method.as_deref());
        let notes = format!(
            "WooCommerce · pedido #{} · total en la tienda ${} · pago: {}{}{}",
            o.number,
            o.total_minor,
            o.payment_method.as_deref().unwrap_or("—"),
            o.transaction_id
                .as_ref()
                .map(|t| format!(" (transacción {t})"))
                .unwrap_or_default(),
            o.note
                .as_ref()
                .map(|n| format!(" · nota del cliente: {n}"))
                .unwrap_or_default(),
        );
        let receiver = o.doc.wants_invoice.then(|| Receiver {
            rut: o.doc.rut.clone(),
            name: o.doc.business_name.clone().or(o.billing.full_name()),
            activity: o.doc.activity.clone(),
            address: clip(&o.billing.address_1, 200),
            commune: clip(&o.billing.city, 100),
            city: None,
            region: None,
            ..Default::default()
        });
        let terms = SaleTerms {
            payment: payment.into(),
            operation: clip(&o.transaction_id, 60),
            references: vec![SaleReference {
                // «Pedido de internet», el tipo de referencia que ya existe para la tienda propia.
                kind: "WEB".into(),
                folio: o.number.chars().take(40).collect(),
                date: Some(o.date.clone()),
                note: None,
            }],
            receiver,
            ..Default::default()
        };
        let input = SaleInput {
            doc_type: if o.doc.wants_invoice { "FV" } else { "VEN" }.into(),
            customer_uid,
            issue_date: o.date.clone(),
            lines,
            notes: Some(notes.chars().take(1000).collect()),
            terms: Some(terms),
        };
        let draft_uid = match existing_sale {
            Some(id) => {
                let uid = self.woo_sale_uid(id)?;
                self.save_sale(&input, Some(&uid))?;
                uid
            }
            None => self.save_sale(&input, None)?.summary.uid,
        };
        let sale_id = nucleo_db::sales::sale_by_uid(self.db.conn(), &draft_uid)?.map(|s| s.id);

        let (status, issue) = if o.currency != "CLP" && !o.currency.is_empty() {
            (
                "por_revisar",
                Some(format!(
                    "El pedido está en {}: revisa los montos antes de confirmar",
                    o.currency
                )),
            )
        } else if !missing.is_empty() {
            (
                "por_revisar",
                Some(format!(
                    "No hay un producto de NÚCLEO con el mismo código: {}. Pon el mismo SKU en la tienda y en NÚCLEO y vuelve a sincronizar",
                    missing.join(", ")
                )),
            )
        } else {
            match self.effect_sale(
                &draft_uid,
                &EffectInput {
                    mode: "contado".into(),
                    method: method.into(),
                    due_date: None,
                    account_uid: None,
                },
            ) {
                Ok(_) => ("importada", None),
                Err(e) => ("por_revisar", Some(format!("No se pudo confirmar: {e}"))),
            }
        };
        self.woo_mark(
            o,
            sale_id,
            status,
            issue.as_deref(),
            o.doc.wants_invoice,
            &now,
        )?;

        // Envío para la orden de transporte (una sola vez por pedido).
        if status == "importada"
            && !had_shipment
            && !o.pickup()
            && (o.shipping.has_address() || o.billing.has_address())
        {
            match self.woo_shipment(o, &draft_uid) {
                Ok(id) => {
                    db::woo_set_shipment(self.db.conn(), &o.id, id)?;
                    report.shipments += 1;
                }
                Err(e) => report.messages.push(format!(
                    "Pedido #{}: la venta quedó registrada, pero el envío no se pudo anotar ({e})",
                    o.number
                )),
            }
        }
        if o.doc.wants_invoice {
            report.to_invoice += 1;
        }
        match (status, existing_sale.is_some()) {
            ("importada", again) => {
                if again {
                    report.completed += 1;
                } else {
                    report.imported += 1;
                }
                if let Some(n) = self.woo_sale_number(sale_id)? {
                    report.to_write_back.push((o.id.clone(), n));
                }
            }
            _ => {
                report.to_review += 1;
                if let Some(i) = &issue {
                    report.messages.push(format!("Pedido #{}: {i}", o.number));
                }
            }
        }
        Ok(())
    }

    fn woo_mark(
        &mut self,
        o: &WooOrder,
        sale_id: Option<i64>,
        status: &str,
        issue: Option<&str>,
        needs_invoice: bool,
        now: &str,
    ) -> AppResult<()> {
        let buyer = o
            .doc
            .business_name
            .clone()
            .filter(|_| o.doc.wants_invoice)
            .or(o.billing.full_name());
        db::woo_upsert_order(
            self.db.conn(),
            &WooOrderWrite {
                order_id: &o.id,
                number: &o.number,
                sale_id,
                date_created: &o.date,
                buyer: buyer.as_deref(),
                email: o.billing.email.as_deref(),
                woo_status: &o.status,
                status,
                total_minor: o.total_minor,
                shipping_minor: o.shipping_minor + o.shipping_tax_minor,
                payment_method: o.payment_method.as_deref(),
                shipping_method: o.shipping_method.as_deref(),
                needs_invoice,
                issue,
                now,
            },
        )?;
        Ok(())
    }

    fn woo_sale_uid(&self, id: i64) -> AppResult<String> {
        Ok(self
            .db
            .conn()
            .query_row("SELECT uid FROM sales WHERE id = ?1", [id], |r| r.get(0))?)
    }

    fn woo_sale_number(&self, id: Option<i64>) -> AppResult<Option<String>> {
        use rusqlite::OptionalExtension;
        let Some(id) = id else { return Ok(None) };
        Ok(self
            .db
            .conn()
            .query_row("SELECT number FROM sales WHERE id = ?1", [id], |r| r.get(0))
            .optional()?
            .flatten())
    }

    /// Producto de NÚCLEO de una línea: el que tiene el mismo SKU.
    fn woo_product_for(&self, it: &WooItem) -> AppResult<Option<String>> {
        use rusqlite::OptionalExtension;
        let Some(sku) = it.sku.as_deref() else {
            return Ok(None);
        };
        Ok(self
            .db
            .conn()
            .query_row(
                "SELECT uid FROM products WHERE lower(sku) = lower(?1) AND archived_at IS NULL",
                [sku],
                |r| r.get(0),
            )
            .optional()?)
    }

    /// Cliente de NÚCLEO del pedido (por RUT si lo dejó; si no, por nombre).
    fn woo_customer(&mut self, o: &WooOrder) -> AppResult<Option<String>> {
        let name = o
            .doc
            .business_name
            .clone()
            .filter(|_| o.doc.wants_invoice)
            .or(o.billing.full_name())
            .or(o.billing.company.clone())
            .or(o.shipping.full_name());
        let Some(name) = name else { return Ok(None) };
        let c = HistoricalCustomer {
            name,
            rut: o.doc.rut.clone(),
            business_activity: o.doc.activity.clone(),
            address: o.billing.address_1.clone(),
            commune: o.billing.city.clone(),
            city: None,
            email: o.billing.email.clone(),
        };
        let mut created = 0;
        let id = self.historical_customer(&c, &mut created)?;
        Ok(Some(self.db.conn().query_row(
            "SELECT uid FROM customers WHERE id = ?1",
            [id],
            |r| r.get(0),
        )?))
    }

    /// Anota el envío del pedido (sin despachar) con los datos que pide el courier.
    fn woo_shipment(&mut self, o: &WooOrder, sale_uid: &str) -> AppResult<i64> {
        let a = if o.shipping.has_address() {
            &o.shipping
        } else {
            &o.billing
        };
        let content = o
            .items
            .iter()
            .map(|i| format!("{} × {}", i.qty_milli / 1000, i.name))
            .collect::<Vec<_>>()
            .join(", ");
        let notes = format!(
            "Pedido WooCommerce #{}{}{}",
            o.number,
            o.shipping_method
                .as_ref()
                .map(|m| format!(" · envío elegido: {m}"))
                .unwrap_or_default(),
            o.note
                .as_ref()
                .map(|n| format!(" · nota del cliente: {n}"))
                .unwrap_or_default(),
        );
        let row = self.save_shipment(
            None,
            &ShipmentInput {
                sale_uid: Some(sale_uid.to_string()),
                carrier: o
                    .shipping_method
                    .as_deref()
                    .and_then(carrier_of)
                    .map(str::to_string),
                first_name: clip(&a.first_name.clone().or(o.billing.first_name.clone()), 80),
                last_name: clip(&a.last_name.clone().or(o.billing.last_name.clone()), 80),
                phone: clip(&a.phone.clone().or(o.billing.phone.clone()), 40),
                email: clip(&o.billing.email, 120),
                street: clip(&a.address_1, 120),
                unit: clip(&a.address_2, 40),
                commune: clip(&a.city, 80),
                region: clip(&a.state, 80),
                delivery_mode: Some("domicilio".into()),
                service: clip(&o.shipping_method, 60),
                content: clip(&Some(content), 200),
                declared_value_minor: Some(o.total_minor.max(0)),
                status: "no_despachado".into(),
                notes: clip(&Some(notes), 1000),
                ..Default::default()
            },
        )?;
        Ok(row.id)
    }

    pub fn woo_orders(&self, limit: Option<i64>) -> AppResult<Vec<WooOrderRow>> {
        self.require("ventas.ver")?;
        Ok(db::woo_list_orders(
            self.db.conn(),
            limit.unwrap_or(200).clamp(1, 2_000),
        )?)
    }

    /// Datos para comparar stock y precios con la tienda (sin la sesión).
    pub fn woo_push_plan(&self, stock: bool, prices: bool) -> AppResult<PushPlan> {
        self.require("config.editar")?;
        if !stock && !prices {
            return Err(AppError::Validation(
                "elige qué enviar a la tienda: stock, precios o ambos".into(),
            ));
        }
        let config = self.woo_ready()?;
        let mut items = HashMap::new();
        for p in db::woo_push_products(self.db.conn())? {
            let free = (p.on_hand_milli - p.reserved_milli).max(0) / 1000;
            items.insert(
                p.sku.to_lowercase(),
                PushItem {
                    sku: p.sku,
                    name: p.name,
                    stock_units: p.track_stock.then_some(free),
                    price_net_minor: p.price_minor,
                    taxable: p.taxable,
                },
            );
        }
        Ok(PushPlan {
            config,
            items,
            tax_ppm: self.tax_ppm()?,
            stock,
            prices,
        })
    }

    /// Deja en la auditoría lo que se envió a la tienda.
    pub fn woo_push_done(&mut self, report: &WooPushReport) -> AppResult<()> {
        if !report.applied {
            return Ok(());
        }
        let user = self.actor_name()?;
        let stock = report
            .changes
            .iter()
            .filter(|c| c.stock_to.is_some())
            .count();
        let prices = report
            .changes
            .iter()
            .filter(|c| c.price_to.is_some())
            .count();
        log(
            self.db.conn(),
            &user,
            "update",
            "integracion",
            PROVIDER,
            &format!(
                "Envió a la tienda WooCommerce el stock de {stock} producto(s) y el precio de {prices}"
            ),
            None,
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn direccion_de_la_tienda() {
        assert_eq!(
            clean_url(" https://datalogger.cl/wp-json/ ").unwrap(),
            "https://datalogger.cl"
        );
        assert_eq!(
            clean_url("https://tienda.cl/wp-admin").unwrap(),
            "https://tienda.cl"
        );
        assert!(clean_url("http://tienda.cl").is_err());
        assert!(clean_url("https://tienda.cl/?ck=1").is_err());
        assert!(clean_url("https://usuario:clave@tienda.cl").is_err());
    }

    #[test]
    fn codigo_del_plugin() {
        let raw = r#"{"u":"https://tienda.cl","k":"ck_abc","s":"cs_def"}"#;
        let code = format!(
            "{CODE_PREFIX}{}",
            data_encoding::BASE64URL_NOPAD.encode(raw.as_bytes())
        );
        assert_eq!(
            parse_code(&code).unwrap(),
            (
                "https://tienda.cl".to_string(),
                "ck_abc".to_string(),
                "cs_def".to_string()
            )
        );
        // Tal como lo arma el plugin de WordPress (PHP escapa las barras del JSON).
        assert_eq!(
            parse_code("nucleo-woo:eyJ1IjoiaHR0cHM6XC9cL3RpZW5kYS5jbCIsImsiOiJja19lamVtcGxvIiwicyI6ImNzX2VqZW1wbG8ifQ").unwrap(),
            (
                "https://tienda.cl".to_string(),
                "ck_ejemplo".to_string(),
                "cs_ejemplo".to_string()
            )
        );
        assert!(parse_code("otra cosa").is_err());
        assert!(parse_code("nucleo-woo:%%%").is_err());
    }

    #[test]
    fn montos_y_pago() {
        assert_eq!(money(Some(&json!("12990.00"))), 12_990);
        assert_eq!(money(Some(&json!(4990))), 4_990);
        assert_eq!(net_of(11_900, Some(190_000)), 10_000);
        assert_eq!(gross_of(10_000, Some(190_000)), 11_900);
        assert_eq!(gross_of(10_000, None), 10_000);
        assert_eq!(
            payment_of(Some("Transferencia bancaria directa")).0,
            "transferencia"
        );
        assert_eq!(payment_of(Some("Webpay Plus")).0, "tarjeta");
        assert_eq!(carrier_of("Blue Express a domicilio"), Some("Bluexpress"));
        assert_eq!(carrier_of("Tarifa plana"), None);
    }

    #[test]
    fn lee_un_pedido_con_factura() {
        let v = json!({
            "id": 1253, "number": "1253", "status": "processing",
            "date_created": "2026-11-20T10:15:00", "currency": "CLP",
            "total": "47850", "total_tax": "0", "shipping_total": "3920", "shipping_tax": "0",
            "payment_method_title": "Webpay Plus", "transaction_id": "MWS6",
            "customer_note": "",
            "billing": {"first_name": "Ana", "last_name": "Soto", "company": "Clínica Sur SpA",
                "address_1": "Av. Los Leones 123", "address_2": "Of. 4", "city": "Providencia",
                "state": "CL-RM", "email": "ana@clinica.cl", "phone": "+56911111111"},
            "shipping": {"first_name": "Ana", "last_name": "Soto", "address_1": "Av. Los Leones 123",
                "city": "Providencia", "state": "CL-RM"},
            "line_items": [{"id": 1, "name": "Registrador RC-5", "product_id": 10, "variation_id": 0,
                "quantity": 3, "subtotal": "45000", "total": "43930", "sku": "RC-5"}],
            "shipping_lines": [{"method_title": "Blue Express"}],
            "meta_data": [{"key": "_billing_rut", "value": "76.000.000-0"},
                {"key": "_billing_giro", "value": "Servicios médicos"},
                {"key": "_nucleo_documento", "value": "factura"}]
        });
        let o = parse_order(&v).unwrap();
        assert_eq!((o.id.as_str(), o.date.as_str()), ("1253", "2026-11-20"));
        assert!(o.paid() && !o.cancelled() && !o.pickup());
        assert_eq!(o.items[0].qty_milli, 3000);
        assert_eq!(
            (o.items[0].subtotal_minor, o.items[0].total_minor),
            (45_000, 43_930)
        );
        assert_eq!(o.items[0].variation_id, "");
        assert!(o.doc.wants_invoice);
        assert_eq!(o.doc.rut.as_deref(), Some("76.000.000-0"));
        assert_eq!(o.doc.business_name.as_deref(), Some("Clínica Sur SpA"));
        assert_eq!(o.shipping_method.as_deref(), Some("Blue Express"));
        // Sin RUT no hay factura aunque la pida.
        let mut sin = v.clone();
        sin["meta_data"] = json!([{"key": "_nucleo_documento", "value": "factura"}]);
        assert!(!parse_order(&sin).unwrap().doc.wants_invoice);
    }
}
