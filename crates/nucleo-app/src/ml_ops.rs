//! Mercado Libre: conexión con la aplicación propia de la empresa (OAuth con PKCE), lectura de los
//! pedidos pagados y su paso a ventas de NÚCLEO (descuentan stock), con los datos de facturación y lo
//! que cobra Mercado Libre (comisión y envío) para cuadrar los depósitos de Mercado Pago.
//!
//! La conversación con Mercado Libre ocurre **fuera** de la sesión (en tres pasos: preparar con la
//! sesión, consultar sin ella, aplicar con ella) para no bloquear NÚCLEO mientras se espera la red.
//! El acceso HTTP está detrás de [`MlHttp`] para probar con pedidos de ejemplo.
//!
//! Reglas: un pedido (o un carrito, `pack_id`) = una venta; nada se registra dos veces; lo que no
//! calza sin duda (publicación sin producto, stock insuficiente) queda en borrador «por revisar»;
//! un pedido cancelado después de importado solo se avisa (la persona anula la venta).

use crate::company::CompanySession;
use crate::history_ops::HistoricalCustomer;
use crate::sale_terms::{Receiver, SaleReference, SaleTerms};
use crate::sales_ops::{EffectInput, LineInput, SaleInput, log};
use crate::{AppError, AppResult};
use nucleo_db::integrations::{self as db, IntegrationRow, MlOrderRow, MlOrderWrite};
use nucleo_db::now_utc;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};

pub const PROVIDER: &str = "mercadolibre";
pub const AUTH_URL: &str = "https://auth.mercadolibre.cl/authorization";
pub const API_URL: &str = "https://api.mercadolibre.com";
pub const DEFAULT_REDIRECT: &str = "https://www.nucleoerp.cl/ml/";
/// Días hacia atrás que se revisan si no se indica otra fecha.
pub const DEFAULT_DAYS: i64 = 15;
/// Margen antes del vencimiento del token para renovarlo.
const REFRESH_MARGIN_SECS: i64 = 300;

/* ─────────────────────────────── Configuración ─────────────────────────────── */

/// Lo que se guarda (cifrado, en la base de la empresa).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct MlConfig {
    pub client_id: String,
    pub client_secret: String,
    pub redirect_uri: String,
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    /// Segundos Unix en que vence el token de acceso.
    pub expires_at: Option<i64>,
    pub user_id: Option<String>,
    pub nickname: Option<String>,
    /// Autorización en curso: `state` y verificador PKCE.
    pub pending_state: Option<String>,
    pub pending_verifier: Option<String>,
}

impl MlConfig {
    pub fn connected(&self) -> bool {
        self.refresh_token.is_some() && self.user_id.is_some()
    }
}

/// Lo que ve la interfaz (sin secretos).
#[derive(Debug, Clone, Serialize)]
pub struct MlStatus {
    pub configured: bool,
    pub connected: bool,
    pub client_id: Option<String>,
    pub redirect_uri: String,
    pub has_secret: bool,
    pub user_id: Option<String>,
    pub nickname: Option<String>,
    pub connected_at: Option<String>,
    pub last_sync_at: Option<String>,
}

/// Tokens recibidos de `/oauth/token`.
#[derive(Debug, Clone)]
pub struct Tokens {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: i64,
}

/* ─────────────────────────────── Acceso HTTP ─────────────────────────────── */

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HttpError {
    /// Respuesta con código de error (estado, cuerpo).
    Status(u16, String),
    /// Sin conexión, DNS, TLS…
    Network(String),
}

impl std::fmt::Display for HttpError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            HttpError::Status(c, b) => write!(f, "Mercado Libre respondió {c}: {}", short(b)),
            HttpError::Network(e) => write!(f, "no se pudo conectar con Mercado Libre: {e}"),
        }
    }
}

fn short(s: &str) -> String {
    let t: String = s.chars().take(200).collect();
    t.replace(['\n', '\r'], " ")
}

pub trait MlHttp {
    fn get(&self, url: &str, token: &str) -> Result<Value, HttpError>;
    fn post_form(&self, url: &str, form: &[(&str, &str)]) -> Result<Value, HttpError>;
}

/// Cliente real (HTTPS con las raíces de Mozilla).
pub struct UreqHttp {
    agent: ureq::Agent,
}

impl Default for UreqHttp {
    fn default() -> Self {
        Self {
            agent: ureq::AgentBuilder::new()
                .timeout(std::time::Duration::from_secs(30))
                .user_agent(concat!("NucleoERP/", env!("CARGO_PKG_VERSION")))
                .build(),
        }
    }
}

fn ureq_result(r: Result<ureq::Response, ureq::Error>) -> Result<Value, HttpError> {
    match r {
        Ok(resp) => resp
            .into_json::<Value>()
            .map_err(|e| HttpError::Network(e.to_string())),
        Err(ureq::Error::Status(code, resp)) => Err(HttpError::Status(
            code,
            resp.into_string().unwrap_or_default(),
        )),
        Err(e) => Err(HttpError::Network(e.to_string())),
    }
}

impl MlHttp for UreqHttp {
    fn get(&self, url: &str, token: &str) -> Result<Value, HttpError> {
        ureq_result(
            self.agent
                .get(url)
                .set("Authorization", &format!("Bearer {token}"))
                .set("x-format-new", "true")
                .call(),
        )
    }
    fn post_form(&self, url: &str, form: &[(&str, &str)]) -> Result<Value, HttpError> {
        ureq_result(
            self.agent
                .post(url)
                .set("Accept", "application/json")
                .send_form(form),
        )
    }
}

/* ─────────────────────────────── OAuth ─────────────────────────────── */

fn random_token(bytes: usize) -> AppResult<String> {
    let mut b = vec![0u8; bytes];
    getrandom::fill(&mut b).map_err(|e| AppError::Validation(format!("azar del sistema: {e}")))?;
    Ok(data_encoding::BASE64URL_NOPAD.encode(&b))
}

/// Desafío PKCE (S256) de un verificador.
pub fn pkce_challenge(verifier: &str) -> String {
    use sha2::{Digest, Sha256};
    data_encoding::BASE64URL_NOPAD.encode(&Sha256::digest(verifier.as_bytes()))
}

fn enc(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn tokens_of(v: &Value) -> Result<Tokens, HttpError> {
    let access = v["access_token"]
        .as_str()
        .ok_or_else(|| HttpError::Status(200, "respuesta sin access_token".into()))?;
    Ok(Tokens {
        access_token: access.to_string(),
        refresh_token: v["refresh_token"].as_str().map(str::to_string),
        expires_at: now_secs() + v["expires_in"].as_i64().unwrap_or(21_600),
    })
}

/// Cambia el código de autorización por los tokens.
pub fn exchange_code(http: &dyn MlHttp, cfg: &MlConfig, code: &str) -> Result<Tokens, HttpError> {
    let verifier = cfg.pending_verifier.clone().unwrap_or_default();
    let mut form = vec![
        ("grant_type", "authorization_code"),
        ("client_id", cfg.client_id.as_str()),
        ("client_secret", cfg.client_secret.as_str()),
        ("code", code),
        ("redirect_uri", cfg.redirect_uri.as_str()),
    ];
    if !verifier.is_empty() {
        form.push(("code_verifier", verifier.as_str()));
    }
    tokens_of(&http.post_form(&format!("{API_URL}/oauth/token"), &form)?)
}

/// Renueva el token de acceso (el de renovación es de un solo uso y viene uno nuevo).
pub fn refresh(http: &dyn MlHttp, cfg: &MlConfig) -> Result<Tokens, HttpError> {
    let rt = cfg.refresh_token.clone().unwrap_or_default();
    let form = [
        ("grant_type", "refresh_token"),
        ("client_id", cfg.client_id.as_str()),
        ("client_secret", cfg.client_secret.as_str()),
        ("refresh_token", rt.as_str()),
    ];
    tokens_of(&http.post_form(&format!("{API_URL}/oauth/token"), &form)?)
}

/// Usuario dueño de los tokens: (id, apodo).
pub fn me(http: &dyn MlHttp, token: &str) -> Result<(String, Option<String>), HttpError> {
    let v = http.get(&format!("{API_URL}/users/me"), token)?;
    let id = match &v["id"] {
        Value::Number(n) => n.to_string(),
        Value::String(s) => s.clone(),
        _ => return Err(HttpError::Status(200, "respuesta sin id de usuario".into())),
    };
    Ok((id, v["nickname"].as_str().map(str::to_string)))
}

/// Separa el código de lo que la persona pega: el código solo o la dirección completa con `?code=`.
pub fn code_from_input(input: &str) -> Option<(String, Option<String>)> {
    let t = input.trim();
    if t.is_empty() {
        return None;
    }
    if let Some(q) = t.split_once('?').map(|(_, q)| q) {
        let mut code = None;
        let mut state = None;
        for kv in q.split(['&', '#']) {
            if let Some((k, v)) = kv.split_once('=') {
                let v = v.replace("%2F", "/").replace("%2D", "-");
                match k {
                    "code" => code = Some(v),
                    "state" => state = Some(v),
                    _ => {}
                }
            }
        }
        return code.map(|c| (c, state));
    }
    Some((t.to_string(), None))
}

/* ─────────────────────────────── Pedidos ─────────────────────────────── */

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct MlItem {
    pub item_id: String,
    pub variation_id: String,
    pub title: String,
    pub seller_sku: Option<String>,
    pub qty: i64,
    /// Precio unitario con IVA, en pesos.
    pub unit_price_minor: i64,
    pub sale_fee_minor: i64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct MlBilling {
    pub doc_type: Option<String>,
    pub doc_number: Option<String>,
    pub name: Option<String>,
    pub business_name: Option<String>,
    pub activity: Option<String>,
    pub address: Option<String>,
    pub commune: Option<String>,
    pub city: Option<String>,
    pub region: Option<String>,
}

impl MlBilling {
    /// El comprador pidió factura: razón social o RUT de empresa.
    pub fn wants_invoice(&self) -> bool {
        if self
            .business_name
            .as_deref()
            .is_some_and(|b| !b.trim().is_empty())
        {
            return true;
        }
        let digits: String = self
            .doc_number
            .as_deref()
            .unwrap_or("")
            .chars()
            .filter(|c| c.is_ascii_alphanumeric())
            .collect();
        digits
            .get(..digits.len().saturating_sub(1))
            .and_then(|b| b.parse::<u64>().ok())
            .is_some_and(|n| n >= 50_000_000)
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct MlOrder {
    pub id: String,
    pub pack_id: Option<String>,
    /// «paid», «cancelled», «partially_refunded»…
    pub status: String,
    /// AAAA-MM-DD (hora de Chile según Mercado Libre).
    pub date: String,
    pub buyer_nickname: Option<String>,
    pub buyer_name: Option<String>,
    pub items: Vec<MlItem>,
    pub total_minor: i64,
    /// Envío pagado por el comprador (con IVA).
    pub shipping_paid_minor: i64,
    pub payment_id: Option<String>,
    pub shipping_id: Option<String>,
    /// Costo de envío que paga el vendedor.
    pub shipping_cost_minor: i64,
    pub billing: Option<MlBilling>,
}

impl MlOrder {
    pub fn group_key(&self) -> String {
        self.pack_id.clone().unwrap_or_else(|| self.id.clone())
    }
    pub fn sale_fee_minor(&self) -> i64 {
        self.items.iter().map(|i| i.sale_fee_minor).sum()
    }
}

fn id_str(v: &Value) -> Option<String> {
    match v {
        Value::Number(n) => Some(n.to_string()),
        Value::String(s) if !s.is_empty() => Some(s.clone()),
        _ => None,
    }
}

fn money(v: &Value) -> i64 {
    v.as_f64().map(|f| f.round() as i64).unwrap_or(0)
}

/// Lee un pedido de `/orders/search` o `/orders/{id}`.
pub fn parse_order(v: &Value) -> Option<MlOrder> {
    let id = id_str(&v["id"])?;
    let items = v["order_items"]
        .as_array()
        .map(|a| {
            a.iter()
                .map(|it| {
                    let qty = it["quantity"].as_i64().unwrap_or(1).max(1);
                    let fee = money(&it["sale_fee"]);
                    MlItem {
                        item_id: id_str(&it["item"]["id"]).unwrap_or_default(),
                        variation_id: id_str(&it["item"]["variation_id"]).unwrap_or_default(),
                        title: it["item"]["title"].as_str().unwrap_or("").to_string(),
                        seller_sku: it["item"]["seller_sku"]
                            .as_str()
                            .or(it["item"]["seller_custom_field"].as_str())
                            .map(str::trim)
                            .filter(|s| !s.is_empty())
                            .map(str::to_string),
                        qty,
                        unit_price_minor: money(&it["unit_price"]),
                        // `sale_fee` es por unidad.
                        sale_fee_minor: fee * qty,
                    }
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let payments = v["payments"].as_array().cloned().unwrap_or_default();
    let approved: Vec<&Value> = payments
        .iter()
        .filter(|p| p["status"].as_str().is_none_or(|s| s == "approved"))
        .collect();
    let shipping_paid = approved.iter().map(|p| money(&p["shipping_cost"])).sum();
    let first = |s: &str| {
        v["buyer"][s]
            .as_str()
            .map(str::trim)
            .filter(|x| !x.is_empty())
    };
    let buyer_name = match (first("first_name"), first("last_name")) {
        (Some(a), Some(b)) => Some(format!("{a} {b}")),
        (Some(a), None) => Some(a.to_string()),
        (None, Some(b)) => Some(b.to_string()),
        _ => None,
    };
    Some(MlOrder {
        id,
        pack_id: id_str(&v["pack_id"]),
        status: v["status"].as_str().unwrap_or("").to_string(),
        date: v["date_created"]
            .as_str()
            .unwrap_or("")
            .chars()
            .take(10)
            .collect(),
        buyer_nickname: v["buyer"]["nickname"].as_str().map(str::to_string),
        buyer_name,
        items,
        total_minor: money(&v["total_amount"]),
        shipping_paid_minor: shipping_paid,
        payment_id: approved.first().and_then(|p| id_str(&p["id"])),
        shipping_id: id_str(&v["shipping"]["id"]),
        shipping_cost_minor: 0,
        billing: None,
    })
}

/// Lee los datos de facturación (`/orders/{id}/billing_info`).
pub fn parse_billing(v: &Value) -> Option<MlBilling> {
    let b = if v["billing_info"].is_object() {
        &v["billing_info"]
    } else {
        v
    };
    let mut out = MlBilling {
        doc_type: b["doc_type"].as_str().map(str::to_string),
        doc_number: b["doc_number"].as_str().map(str::to_string),
        ..Default::default()
    };
    let mut first = None;
    let mut last = None;
    let mut street = None;
    let mut number = None;
    for kv in b["additional_info"].as_array().into_iter().flatten() {
        let k = kv["type"].as_str().unwrap_or("").to_uppercase();
        let Some(val) = kv["value"]
            .as_str()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        else {
            continue;
        };
        let val = val.to_string();
        match k.as_str() {
            "FIRST_NAME" => first = Some(val),
            "LAST_NAME" => last = Some(val),
            "BUSINESS_NAME" | "SOCIAL_REASON" | "RAZON_SOCIAL" => out.business_name = Some(val),
            "STREET_NAME" => street = Some(val),
            "STREET_NUMBER" => number = Some(val),
            "CITY_NAME" | "CITY" => out.city = Some(val),
            "STATE_NAME" | "STATE" => out.region = Some(val),
            "NEIGHBORHOOD" | "COMUNA" | "MUNICIPALITY" => out.commune = Some(val),
            k if k.contains("ACTIVITY") || k == "GIRO" => out.activity = Some(val),
            _ => {}
        }
    }
    out.name = match (first, last) {
        (Some(a), Some(b)) => Some(format!("{a} {b}")),
        (a, b) => a.or(b),
    };
    out.address = match (street, number) {
        (Some(s), Some(n)) => Some(format!("{s} {n}")),
        (s, _) => s,
    };
    (out.doc_number.is_some() || out.business_name.is_some() || out.name.is_some()).then_some(out)
}

/// Pedido ya visto en NÚCLEO.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Known {
    pub status: String,
    pub ml_status: String,
}

/// Lo que se necesita para consultar sin la sesión.
#[derive(Debug, Clone)]
pub struct SyncPlan {
    pub config: MlConfig,
    pub from: String,
    pub known: HashMap<String, Known>,
    /// Los tokens cambiaron durante la consulta (hay que guardarlos).
    pub tokens_changed: bool,
}

/// Consulta a Mercado Libre (sin la sesión): renueva el token si hace falta, busca los pedidos desde
/// `plan.from` y trae facturación y costo de envío de los que hay que procesar.
pub fn fetch(http: &dyn MlHttp, plan: &mut SyncPlan) -> Result<Vec<MlOrder>, HttpError> {
    let expired = plan
        .config
        .expires_at
        .is_none_or(|e| e - REFRESH_MARGIN_SECS <= now_secs());
    if expired || plan.config.access_token.is_none() {
        let t = refresh(http, &plan.config)?;
        plan.config.access_token = Some(t.access_token);
        if t.refresh_token.is_some() {
            plan.config.refresh_token = t.refresh_token;
        }
        plan.config.expires_at = Some(t.expires_at);
        plan.tokens_changed = true;
    }
    let token = plan.config.access_token.clone().unwrap_or_default();
    let seller = plan.config.user_id.clone().unwrap_or_default();
    let mut out = Vec::new();
    let mut offset = 0;
    loop {
        let url = format!(
            "{API_URL}/orders/search?seller={}&order.date_created.from={}&sort=date_asc&limit=50&offset={offset}",
            enc(&seller),
            enc(&format!("{}T00:00:00.000-00:00", plan.from)),
        );
        let v = http.get(&url, &token)?;
        let results = v["results"].as_array().cloned().unwrap_or_default();
        let total = v["paging"]["total"].as_i64().unwrap_or(0);
        for r in &results {
            let Some(mut o) = parse_order(r) else {
                continue;
            };
            let known = plan.known.get(&o.id);
            let needs_detail =
                o.status == "paid" && known.is_none_or(|k| k.status == "por_revisar");
            if needs_detail {
                if let Ok(b) = http.get(&format!("{API_URL}/orders/{}/billing_info", o.id), &token)
                {
                    o.billing = parse_billing(&b);
                }
                if let Some(sid) = &o.shipping_id
                    && let Ok(c) = http.get(&format!("{API_URL}/shipments/{sid}/costs"), &token)
                {
                    o.shipping_cost_minor = c["senders"]
                        .as_array()
                        .map(|a| a.iter().map(|s| money(&s["cost"])).sum())
                        .unwrap_or(0);
                }
            }
            out.push(o);
        }
        offset += results.len() as i64;
        if results.is_empty() || offset >= total || offset >= 2_000 {
            break;
        }
    }
    Ok(out)
}

/* ─────────────────────────────── Ventas leídas en el portal ─────────────────────────────── */

/// Línea de una venta leída en el portal de vendedores.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct MlManualLine {
    /// Código (SKU) del producto **en NÚCLEO**.
    pub sku: String,
    pub title: String,
    pub qty: i64,
    /// Precio unitario con IVA, en pesos.
    pub unit_price_minor: i64,
}

/// Venta de Mercado Libre leída en el portal de vendedores (por el asistente o por la persona), para
/// registrarla sin la conexión por API. `move_stock` indica si lo despachado todavía no está
/// descontado del stock de NÚCLEO.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct MlManualOrder {
    pub order_id: String,
    /// AAAA-MM-DD.
    pub date: String,
    pub cancelled: bool,
    pub buyer: Option<String>,
    pub buyer_rut: Option<String>,
    pub business_name: Option<String>,
    pub activity: Option<String>,
    pub address: Option<String>,
    pub commune: Option<String>,
    pub lines: Vec<MlManualLine>,
    /// Cargos por venta (comisión) y envío que cobra Mercado Libre, en pesos.
    pub sale_fee_minor: i64,
    pub shipping_cost_minor: i64,
    /// Reembolsos o anulaciones.
    pub refunded_minor: i64,
    pub payment_id: Option<String>,
    /// Folio de la factura electrónica ya emitida por esta venta (si la hay).
    pub invoice_folio: Option<String>,
    pub move_stock: bool,
}

/* ─────────────────────────────── Resultado ─────────────────────────────── */

#[derive(Debug, Clone, Default, Serialize)]
pub struct MlSyncReport {
    /// Ventas creadas y efectuadas.
    pub imported: usize,
    /// Ventas que quedaron en borrador por revisar.
    pub to_review: usize,
    /// Ventas por revisar que ahora se efectuaron.
    pub completed: usize,
    /// Pedidos cancelados en Mercado Libre después de importados.
    pub cancelled: usize,
    /// Pedidos ya importados sin cambios.
    pub unchanged: usize,
    /// Pedidos que piden factura.
    pub to_invoice: usize,
    pub messages: Vec<String>,
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

impl CompanySession {
    fn ml_row(&self) -> AppResult<IntegrationRow> {
        Ok(
            db::get(self.db.conn(), PROVIDER)?.unwrap_or(IntegrationRow {
                provider: PROVIDER.into(),
                config_json: "{}".into(),
                ..Default::default()
            }),
        )
    }

    pub fn ml_config(&self) -> AppResult<MlConfig> {
        let row = self.ml_row()?;
        let mut c: MlConfig = serde_json::from_str(&row.config_json).unwrap_or_default();
        if c.redirect_uri.is_empty() {
            c.redirect_uri = DEFAULT_REDIRECT.into();
        }
        Ok(c)
    }

    fn ml_save(&mut self, cfg: &MlConfig, f: impl FnOnce(&mut IntegrationRow)) -> AppResult<()> {
        let mut row = self.ml_row()?;
        row.config_json =
            serde_json::to_string(cfg).map_err(|e| AppError::Validation(e.to_string()))?;
        f(&mut row);
        db::upsert(self.db.conn(), &row, &now_utc())?;
        Ok(())
    }

    pub fn ml_status(&self) -> AppResult<MlStatus> {
        self.require("ventas.ver")?;
        let row = self.ml_row()?;
        let c = self.ml_config()?;
        Ok(MlStatus {
            configured: !c.client_id.is_empty() && !c.client_secret.is_empty(),
            connected: c.connected(),
            client_id: Some(c.client_id.clone()).filter(|s| !s.is_empty()),
            redirect_uri: c.redirect_uri.clone(),
            has_secret: !c.client_secret.is_empty(),
            user_id: c.user_id.clone(),
            nickname: c.nickname.clone(),
            connected_at: row.connected_at,
            last_sync_at: row.last_sync_at,
        })
    }

    /// Guarda la aplicación de la empresa (App ID, clave secreta, dirección de retorno).
    /// Una clave vacía conserva la guardada.
    pub fn ml_save_app(
        &mut self,
        client_id: &str,
        client_secret: &str,
        redirect_uri: Option<&str>,
    ) -> AppResult<MlStatus> {
        self.require("config.editar")?;
        let id = client_id.trim();
        if id.is_empty() || id.len() > 40 || !id.chars().all(|c| c.is_ascii_digit()) {
            return Err(AppError::Validation(
                "el App ID de Mercado Libre es un número (lo ves en developers.mercadolibre.cl → Mis aplicaciones)".into(),
            ));
        }
        let mut c = self.ml_config()?;
        if c.client_id != id {
            // Otra aplicación: los tokens anteriores ya no sirven.
            c = MlConfig {
                redirect_uri: c.redirect_uri,
                ..Default::default()
            };
        }
        c.client_id = id.to_string();
        let secret = client_secret.trim();
        if !secret.is_empty() {
            if secret.len() > 100 {
                return Err(AppError::Validation(
                    "la clave secreta es demasiado larga".into(),
                ));
            }
            c.client_secret = secret.to_string();
        }
        if c.client_secret.is_empty() {
            return Err(AppError::Validation(
                "falta la clave secreta de la aplicación".into(),
            ));
        }
        if let Some(r) = redirect_uri.map(str::trim).filter(|r| !r.is_empty()) {
            if !r.starts_with("https://") || r.len() > 200 {
                return Err(AppError::Validation(
                    "la dirección de retorno debe empezar con https:// (por defecto https://www.nucleoerp.cl/ml/)".into(),
                ));
            }
            c.redirect_uri = r.to_string();
        }
        let user = self.actor_name()?;
        self.ml_save(&c, |_| {})?;
        log(
            self.db.conn(),
            &user,
            "update",
            "integracion",
            PROVIDER,
            "Configuró la aplicación de Mercado Libre",
            None,
        )?;
        self.ml_status()
    }

    /// Dirección para autorizar en Mercado Libre. `port`: NÚCLEO espera la respuesta en
    /// `127.0.0.1:<port>` (va en `state` para que la página de retorno lo encuentre).
    pub fn ml_auth_url(&mut self, port: Option<u16>) -> AppResult<String> {
        self.require("config.editar")?;
        let mut c = self.ml_config()?;
        if c.client_id.is_empty() || c.client_secret.is_empty() {
            return Err(AppError::Validation(
                "primero guarda el App ID y la clave secreta de tu aplicación".into(),
            ));
        }
        let nonce = random_token(12)?;
        let state = match port {
            Some(p) => format!("{p}.{nonce}"),
            None => nonce,
        };
        let verifier = random_token(48)?;
        let url = format!(
            "{AUTH_URL}?response_type=code&client_id={}&redirect_uri={}&state={}&code_challenge={}&code_challenge_method=S256",
            enc(&c.client_id),
            enc(&c.redirect_uri),
            enc(&state),
            pkce_challenge(&verifier),
        );
        c.pending_state = Some(state);
        c.pending_verifier = Some(verifier);
        self.ml_save(&c, |_| {})?;
        Ok(url)
    }

    /// Revisa que el `state` devuelto sea el de la autorización en curso.
    pub fn ml_check_state(&self, state: Option<&str>) -> AppResult<MlConfig> {
        let c = self.ml_config()?;
        if let (Some(s), Some(p)) = (state, c.pending_state.as_deref())
            && s != p
        {
            return Err(AppError::Validation(
                "la respuesta de Mercado Libre no corresponde a esta conexión: vuelve a presionar «Conectar»".into(),
            ));
        }
        Ok(c)
    }

    /// Guarda los tokens y la cuenta después de autorizar.
    pub fn ml_connected(
        &mut self,
        tokens: &Tokens,
        user_id: &str,
        nickname: Option<&str>,
    ) -> AppResult<MlStatus> {
        self.require("config.editar")?;
        let mut c = self.ml_config()?;
        c.access_token = Some(tokens.access_token.clone());
        c.refresh_token = tokens.refresh_token.clone();
        c.expires_at = Some(tokens.expires_at);
        c.user_id = Some(user_id.to_string());
        c.nickname = nickname.map(str::to_string);
        c.pending_state = None;
        c.pending_verifier = None;
        let now = now_utc();
        let nick = nickname.unwrap_or(user_id).to_string();
        let user = self.actor_name()?;
        self.ml_save(&c, |r| {
            r.account_id = Some(user_id.to_string());
            r.account_name = Some(nick.clone());
            r.connected_at = Some(now.clone());
        })?;
        log(
            self.db.conn(),
            &user,
            "update",
            "integracion",
            PROVIDER,
            &format!("Conectó Mercado Libre ({nick})"),
            None,
        )?;
        self.ml_status()
    }

    pub fn ml_disconnect(&mut self) -> AppResult<MlStatus> {
        self.require("config.editar")?;
        let c = self.ml_config()?;
        let keep = MlConfig {
            client_id: c.client_id,
            client_secret: c.client_secret,
            redirect_uri: c.redirect_uri,
            ..Default::default()
        };
        let user = self.actor_name()?;
        self.ml_save(&keep, |r| {
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
            "Desconectó Mercado Libre",
            None,
        )?;
        self.ml_status()
    }

    /// Paso 1 de la sincronización: datos para consultar sin la sesión.
    pub fn ml_sync_plan(&self, from: Option<&str>) -> AppResult<SyncPlan> {
        self.require("ventas.crear")?;
        let c = self.ml_config()?;
        if !c.connected() {
            return Err(AppError::Validation(
                "Mercado Libre no está conectado: Configuración → Integraciones".into(),
            ));
        }
        let from = match from.map(str::trim).filter(|f| !f.is_empty()) {
            Some(f) => crate::sales_ops::parse_date("la fecha desde", f)?,
            None => {
                let today = crate::sales_ops::local_today(self.db.conn())?;
                let d = crate::inventory_ops::date_ord(&today).unwrap_or(0);
                crate::inventory_ops::date_str(d - DEFAULT_DAYS)
            }
        };
        let conn = self.db.conn();
        let mut st = conn.prepare("SELECT order_id, status, ml_status FROM ml_orders")?;
        let known = st
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    Known {
                        status: r.get(1)?,
                        ml_status: r.get(2)?,
                    },
                ))
            })?
            .collect::<Result<HashMap<_, _>, _>>()?;
        Ok(SyncPlan {
            config: c,
            from,
            known,
            tokens_changed: false,
        })
    }

    /// Paso 3: guarda tokens renovados y pasa los pedidos a ventas.
    pub fn ml_apply(&mut self, plan: &SyncPlan, orders: &[MlOrder]) -> AppResult<MlSyncReport> {
        self.require("ventas.crear")?;
        if plan.tokens_changed {
            let mut c = self.ml_config()?;
            c.access_token = plan.config.access_token.clone();
            c.refresh_token = plan.config.refresh_token.clone();
            c.expires_at = plan.config.expires_at;
            self.ml_save(&c, |_| {})?;
        }
        let mut report = MlSyncReport::default();
        let mut groups: BTreeMap<String, Vec<&MlOrder>> = BTreeMap::new();
        for o in orders {
            groups.entry(o.group_key()).or_default().push(o);
        }
        for (key, group) in groups {
            if let Err(e) = self.ml_apply_group(&key, &group, &mut report) {
                report.messages.push(format!("Pedido {key}: {e}"));
            }
        }
        let now = now_utc();
        self.ml_save(&self.ml_config()?, |r| r.last_sync_at = Some(now))?;
        Ok(report)
    }

    fn ml_apply_group(
        &mut self,
        key: &str,
        group: &[&MlOrder],
        report: &mut MlSyncReport,
    ) -> AppResult<()> {
        let now = now_utc();
        let states: Vec<Option<(Option<i64>, String)>> = group
            .iter()
            .map(|o| db::order_state(self.db.conn(), &o.id))
            .collect::<Result<_, _>>()?;
        let existing_sale = states.iter().flatten().find_map(|(s, _)| *s);
        let all_imported = states.iter().all(|s| {
            s.as_ref()
                .is_some_and(|(_, st)| st == "importada" || st == "cancelada")
        });
        let any_cancelled = group.iter().any(|o| o.status == "cancelled");

        // Ya importado: solo avisar si se canceló en Mercado Libre.
        if all_imported {
            for (o, st) in group.iter().zip(&states) {
                let (sale_id, status) = st.clone().unwrap_or((None, String::new()));
                if o.status == "cancelled" && status != "cancelada" {
                    let number = self.ml_sale_number(sale_id)?;
                    let issue = format!(
                        "Cancelado en Mercado Libre: anula la venta {}",
                        number.as_deref().unwrap_or("enlazada")
                    );
                    self.ml_mark(o, sale_id, "cancelada", Some(&issue), &now)?;
                    report.cancelled += 1;
                    report.messages.push(format!("Pedido {}: {issue}", o.id));
                } else {
                    report.unchanged += 1;
                }
            }
            return Ok(());
        }
        // Nuevo y ya cancelado (o sin pagar): no se registra.
        if existing_sale.is_none() && (any_cancelled || group.iter().any(|o| o.status != "paid")) {
            return Ok(());
        }
        if existing_sale.is_some() && any_cancelled {
            for o in group {
                self.ml_mark(
                    o,
                    existing_sale,
                    "cancelada",
                    Some("Cancelado en Mercado Libre antes de confirmar: anula el borrador"),
                    &now,
                )?;
            }
            report.cancelled += 1;
            return Ok(());
        }

        // Productos de cada línea.
        let tax = self.tax_ppm()?;
        let mut lines = Vec::new();
        let mut missing = Vec::new();
        for o in group {
            for it in &o.items {
                let product = self.ml_product_for(it)?;
                if product.is_none() {
                    missing.push(format!("«{}» ({})", it.title, it.item_id));
                }
                lines.push(LineInput {
                    product_uid: product,
                    description: it.title.chars().take(200).collect(),
                    qty_milli: it.qty * 1000,
                    unit_price_minor: net_of(it.unit_price_minor, tax),
                    discount_ppm: 0,
                    taxable: true,
                    detail: None,
                });
            }
        }
        let shipping_paid: i64 = group.iter().map(|o| o.shipping_paid_minor).sum();
        if shipping_paid > 0 {
            lines.push(LineInput {
                product_uid: None,
                description: "Envío Mercado Libre".into(),
                qty_milli: 1000,
                unit_price_minor: net_of(shipping_paid, tax),
                discount_ppm: 0,
                taxable: true,
                detail: None,
            });
        }
        let billing = group.iter().find_map(|o| o.billing.clone());
        let wants_invoice = billing.as_ref().is_some_and(MlBilling::wants_invoice);
        let first = group[0];
        let customer_uid = self.ml_customer(first, billing.as_ref())?;
        let total: i64 = group.iter().map(|o| o.total_minor).sum::<i64>() + shipping_paid;
        let fee: i64 = group.iter().map(|o| o.sale_fee_minor()).sum();
        let ship_cost: i64 = group.iter().map(|o| o.shipping_cost_minor).sum();
        let ids: Vec<&str> = group.iter().map(|o| o.id.as_str()).collect();
        let notes = format!(
            "Mercado Libre · pedido {}{} · comprador {} · total ML ${} · comisión ${} · envío vendedor ${} · neto a recibir ${}",
            ids.join(", "),
            first
                .pack_id
                .as_ref()
                .map(|p| format!(" (carrito {p})"))
                .unwrap_or_default(),
            first.buyer_nickname.as_deref().unwrap_or("—"),
            total,
            fee,
            ship_cost,
            total - fee - ship_cost
        );
        let receiver = billing
            .as_ref()
            .filter(|_| wants_invoice)
            .map(|b| Receiver {
                rut: b.doc_number.clone(),
                name: b.business_name.clone().or(b.name.clone()),
                activity: b.activity.clone(),
                address: b.address.clone(),
                commune: b.commune.clone(),
                city: b.city.clone(),
                region: None,
                ..Default::default()
            });
        let terms = SaleTerms {
            payment: "transferencia".into(),
            operation: first
                .payment_id
                .as_ref()
                .map(|p| format!("Mercado Pago {p}")),
            references: vec![SaleReference {
                kind: "ML".into(),
                folio: key.to_string(),
                date: Some(first.date.clone()).filter(|d| d.len() == 10),
                note: None,
            }],
            receiver,
            ..Default::default()
        };
        let input = SaleInput {
            doc_type: if wants_invoice { "FV" } else { "VEN" }.into(),
            customer_uid,
            issue_date: first.date.clone(),
            lines,
            notes: Some(notes),
            terms: Some(terms),
        };
        let draft_uid = match existing_sale {
            Some(id) => {
                let uid = self.ml_sale_uid(id)?;
                self.save_sale(&input, Some(&uid))?;
                uid
            }
            None => self.save_sale(&input, None)?.summary.uid,
        };
        let sale_id = nucleo_db::sales::sale_by_uid(self.db.conn(), &draft_uid)?.map(|s| s.id);

        let (status, issue) = if !missing.is_empty() {
            (
                "por_revisar",
                Some(format!(
                    "Enlaza la publicación {} con un producto de NÚCLEO",
                    missing.join(", ")
                )),
            )
        } else {
            match self.effect_sale(
                &draft_uid,
                &EffectInput {
                    mode: "contado".into(),
                    method: "Transferencia".into(),
                    due_date: None,
                    account_uid: None,
                },
            ) {
                Ok(_) => ("importada", None),
                Err(e) => ("por_revisar", Some(format!("No se pudo confirmar: {e}"))),
            }
        };
        for o in group {
            let bjson = o
                .billing
                .as_ref()
                .or(billing.as_ref())
                .and_then(|b| serde_json::to_string(b).ok());
            db::upsert_order(
                self.db.conn(),
                &MlOrderWrite {
                    order_id: &o.id,
                    pack_id: o.pack_id.as_deref(),
                    sale_id,
                    date_created: &o.date,
                    buyer: o.buyer_name.as_deref().or(o.buyer_nickname.as_deref()),
                    ml_status: &o.status,
                    status,
                    total_minor: o.total_minor + o.shipping_paid_minor,
                    sale_fee_minor: o.sale_fee_minor(),
                    shipping_cost_minor: o.shipping_cost_minor,
                    needs_invoice: wants_invoice,
                    billing_json: bjson.as_deref(),
                    issue: issue.as_deref(),
                    now: &now,
                },
            )?;
        }
        if wants_invoice {
            report.to_invoice += 1;
        }
        match (status, existing_sale.is_some()) {
            ("importada", true) => report.completed += 1,
            ("importada", false) => report.imported += 1,
            _ => {
                report.to_review += 1;
                if let Some(i) = &issue {
                    report.messages.push(format!("Pedido {key}: {i}"));
                }
            }
        }
        Ok(())
    }

    fn ml_mark(
        &mut self,
        o: &MlOrder,
        sale_id: Option<i64>,
        status: &str,
        issue: Option<&str>,
        now: &str,
    ) -> AppResult<()> {
        let conn = self.db.conn();
        let prev: Option<(i64, i64, i64, i64, Option<String>)> = conn
            .query_row(
                "SELECT total_minor, sale_fee_minor, shipping_cost_minor, needs_invoice, billing_json FROM ml_orders WHERE order_id = ?1",
                [&o.id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )
            .optional()?;
        let (total, fee, ship, inv, bj) = prev.unwrap_or((
            o.total_minor,
            o.sale_fee_minor(),
            o.shipping_cost_minor,
            0,
            None,
        ));
        db::upsert_order(
            conn,
            &MlOrderWrite {
                order_id: &o.id,
                pack_id: o.pack_id.as_deref(),
                sale_id,
                date_created: &o.date,
                buyer: o.buyer_name.as_deref().or(o.buyer_nickname.as_deref()),
                ml_status: &o.status,
                status,
                total_minor: total,
                sale_fee_minor: fee,
                shipping_cost_minor: ship,
                needs_invoice: inv == 1,
                billing_json: bj.as_deref(),
                issue,
                now,
            },
        )?;
        Ok(())
    }

    fn ml_sale_uid(&self, id: i64) -> AppResult<String> {
        Ok(self
            .db
            .conn()
            .query_row("SELECT uid FROM sales WHERE id = ?1", [id], |r| r.get(0))?)
    }

    fn ml_sale_number(&self, id: Option<i64>) -> AppResult<Option<String>> {
        let Some(id) = id else { return Ok(None) };
        Ok(self
            .db
            .conn()
            .query_row("SELECT number FROM sales WHERE id = ?1", [id], |r| r.get(0))
            .optional()?
            .flatten())
    }

    /// Producto de NÚCLEO de una línea: enlace guardado o SKU del vendedor.
    fn ml_product_for(&self, it: &MlItem) -> AppResult<Option<String>> {
        let conn = self.db.conn();
        if let Some(pid) = db::linked_product(conn, &it.item_id, &it.variation_id)? {
            return Ok(conn
                .query_row(
                    "SELECT uid FROM products WHERE id = ?1 AND archived_at IS NULL",
                    [pid],
                    |r| r.get(0),
                )
                .optional()?);
        }
        let Some(sku) = it.seller_sku.as_deref() else {
            return Ok(None);
        };
        Ok(conn
            .query_row(
                "SELECT uid FROM products WHERE lower(sku) = lower(?1) AND archived_at IS NULL",
                [sku],
                |r| r.get(0),
            )
            .optional()?)
    }

    fn ml_customer(
        &mut self,
        o: &MlOrder,
        billing: Option<&MlBilling>,
    ) -> AppResult<Option<String>> {
        let rut = billing
            .and_then(|b| b.doc_number.clone())
            .filter(|d| nucleo_domain::rut::Rut::parse(d).is_ok());
        let name = billing
            .and_then(|b| b.business_name.clone().or(b.name.clone()))
            .or(o.buyer_name.clone())
            .or(o.buyer_nickname.clone());
        let Some(name) = name else { return Ok(None) };
        let c = HistoricalCustomer {
            name,
            rut,
            business_activity: billing.and_then(|b| b.activity.clone()),
            address: billing.and_then(|b| b.address.clone()),
            commune: billing.and_then(|b| b.commune.clone()),
            city: billing.and_then(|b| b.city.clone()),
            email: None,
        };
        let mut created = 0;
        let id = self.historical_customer(&c, &mut created)?;
        Ok(Some(self.db.conn().query_row(
            "SELECT uid FROM customers WHERE id = ?1",
            [id],
            |r| r.get(0),
        )?))
    }

    /// Registra ventas leídas en el portal de vendedores, sin la conexión por API. Tres casos:
    /// - con factura ya emitida: se enlaza a esa venta de NÚCLEO (no se crea otra) y, si corresponde,
    ///   se descuenta el stock con un ajuste;
    /// - sin factura y con stock por descontar: venta al contado que descuenta stock (como la
    ///   sincronización), factura «por facturar» si el comprador es empresa;
    /// - sin factura y sin stock por descontar: queda anotada «por revisar» para cuadrar el cobro,
    ///   sin crear una venta.
    ///
    /// No duplica: una venta ya registrada no cambia.
    pub fn ml_register_manual(&mut self, orders: &[MlManualOrder]) -> AppResult<MlSyncReport> {
        self.require("ventas.crear")?;
        let mut report = MlSyncReport::default();
        for o in orders {
            if let Err(e) = self.ml_register_one(o, &mut report) {
                report
                    .messages
                    .push(format!("Venta {}: {e}", o.order_id.trim()));
            }
        }
        Ok(report)
    }

    fn ml_register_one(&mut self, o: &MlManualOrder, report: &mut MlSyncReport) -> AppResult<()> {
        let id = o.order_id.trim().trim_start_matches('#').to_string();
        if id.is_empty() || id.len() > 30 || !id.chars().all(|c| c.is_ascii_digit()) {
            return Err(AppError::Validation(
                "el número de venta de Mercado Libre son solo dígitos".into(),
            ));
        }
        let date = crate::sales_ops::parse_date("la fecha de la venta", o.date.trim())?;
        if o.lines.is_empty()
            || o.lines
                .iter()
                .any(|l| l.qty <= 0 || l.unit_price_minor < 0 || l.sku.trim().is_empty())
        {
            return Err(AppError::Validation(
                "cada línea necesita el código del producto en NÚCLEO, la cantidad y el precio"
                    .into(),
            ));
        }
        let now = now_utc();
        let state = db::order_state(self.db.conn(), &id)?;
        if matches!(&state, Some((_, st)) if st == "importada" || st == "cancelada") {
            report.unchanged += 1;
            return Ok(());
        }
        let total: i64 = o.lines.iter().map(|l| l.qty * l.unit_price_minor).sum();
        let billing = MlBilling {
            doc_type: o.buyer_rut.as_ref().map(|_| "RUT".to_string()),
            doc_number: o.buyer_rut.clone(),
            name: o.buyer.clone(),
            business_name: o.business_name.clone(),
            activity: o.activity.clone(),
            address: o.address.clone(),
            commune: o.commune.clone(),
            city: None,
            region: None,
        };
        let order = MlOrder {
            id: id.clone(),
            pack_id: None,
            status: if o.cancelled { "cancelled" } else { "paid" }.into(),
            date: date.clone(),
            buyer_nickname: None,
            buyer_name: o.buyer.clone().or(o.business_name.clone()),
            items: o
                .lines
                .iter()
                .enumerate()
                .map(|(i, l)| MlItem {
                    item_id: format!("PORTAL-{}", l.sku.trim().to_uppercase()),
                    variation_id: String::new(),
                    title: if l.title.trim().is_empty() {
                        l.sku.trim().to_string()
                    } else {
                        l.title.trim().to_string()
                    },
                    seller_sku: Some(l.sku.trim().to_string()),
                    qty: l.qty,
                    unit_price_minor: l.unit_price_minor,
                    // La comisión viene por venta: se anota en la primera línea.
                    sale_fee_minor: if i == 0 { o.sale_fee_minor.max(0) } else { 0 },
                })
                .collect(),
            total_minor: total,
            shipping_paid_minor: 0,
            payment_id: o.payment_id.clone(),
            shipping_id: None,
            shipping_cost_minor: o.shipping_cost_minor.max(0),
            billing: Some(billing.clone()),
        };
        if o.cancelled {
            if state.is_some() {
                self.ml_mark(
                    &order,
                    state.and_then(|(s, _)| s),
                    "cancelada",
                    Some("Cancelada en Mercado Libre"),
                    &now,
                )?;
                report.cancelled += 1;
            }
            return Ok(());
        }
        let refund_note = (o.refunded_minor > 0)
            .then(|| format!("Mercado Libre anuló o reembolsó ${}", o.refunded_minor));
        let folio = o
            .invoice_folio
            .as_deref()
            .map(|f| f.trim().trim_start_matches("FE-").to_string())
            .filter(|f| !f.is_empty());

        // Sin factura y con stock por descontar: venta nueva, igual que la sincronización.
        if folio.is_none() && o.move_stock {
            self.ml_apply_group(&id, &[&order], report)?;
            // Con reembolso parcial, la venta queda señalada para que la persona la revise.
            if let (Some(n), Some((sale_id, _))) =
                (&refund_note, db::order_state(self.db.conn(), &id)?)
            {
                let issue = format!("{n}: revisa la venta");
                self.ml_mark(&order, sale_id, "por_revisar", Some(&issue), &now)?;
                report.messages.push(format!("Venta {id}: {issue}"));
            }
            return Ok(());
        }

        let write = |s: &mut Self,
                     sale_id: Option<i64>,
                     status: &str,
                     issue: Option<&str>|
         -> AppResult<()> {
            let bjson = serde_json::to_string(&billing).ok();
            db::upsert_order(
                s.db.conn(),
                &MlOrderWrite {
                    order_id: &id,
                    pack_id: None,
                    sale_id,
                    date_created: &date,
                    buyer: order.buyer_name.as_deref(),
                    ml_status: "paid",
                    status,
                    total_minor: total - o.refunded_minor.max(0),
                    sale_fee_minor: o.sale_fee_minor.max(0),
                    shipping_cost_minor: o.shipping_cost_minor.max(0),
                    needs_invoice: billing.wants_invoice(),
                    billing_json: bjson.as_deref(),
                    issue,
                    now: &now,
                },
            )?;
            Ok(())
        };

        let Some(folio) = folio else {
            // Sin factura y sin stock por descontar: solo queda anotada para cuadrar el cobro.
            let issue = format!(
                "Sin venta en NÚCLEO: falta anotar su {}{}",
                if billing.wants_invoice() {
                    "factura"
                } else {
                    "boleta o factura"
                },
                refund_note
                    .as_ref()
                    .map(|n| format!(". {n}"))
                    .unwrap_or_default()
            );
            write(self, None, "por_revisar", Some(&issue))?;
            report.to_review += 1;
            if billing.wants_invoice() {
                report.to_invoice += 1;
            }
            return Ok(());
        };

        // Con factura: se enlaza a la venta que ya existe.
        let found =
            nucleo_db::sales::sale_with_external(self.db.conn(), "Factura electrónica", &folio)?;
        let Some(sale_uid) = found else {
            let issue = format!(
                "La factura N° {folio} no está en NÚCLEO: impórtala (o corrige el folio) y registra la venta otra vez"
            );
            write(self, None, "por_revisar", Some(&issue))?;
            report.to_review += 1;
            report.messages.push(format!("Venta {id}: {issue}"));
            return Ok(());
        };
        let sale_id = nucleo_db::sales::sale_by_uid(self.db.conn(), &sale_uid)?.map(|s| s.id);
        let mut issue = refund_note.clone();
        if o.move_stock {
            // La factura histórica no movió stock: se descuenta con un ajuste que la nombra.
            match self.ml_stock_exit(o, &id, &folio, &date) {
                Ok(()) => {}
                Err(e) => {
                    let m = format!("El stock no se descontó ({e})");
                    report.messages.push(format!("Venta {id}: {m}"));
                    issue = Some(match issue {
                        Some(n) => format!("{m}. {n}"),
                        None => m,
                    });
                }
            }
        }
        let status = if issue.is_some() {
            "por_revisar"
        } else {
            "importada"
        };
        write(self, sale_id, status, issue.as_deref())?;
        if status == "importada" {
            report.imported += 1;
        } else {
            report.to_review += 1;
        }
        Ok(())
    }

    /// Descuenta del stock lo despachado por una venta que ya tenía su factura en NÚCLEO.
    fn ml_stock_exit(
        &mut self,
        o: &MlManualOrder,
        order_id: &str,
        folio: &str,
        date: &str,
    ) -> AppResult<()> {
        use crate::inventory_ops::{AdjustmentInput, StockLineInput};
        let warehouse = self
            .warehouses()?
            .into_iter()
            .find(|w| w.is_default && !w.archived)
            .ok_or_else(|| AppError::Validation("no hay una bodega principal".into()))?;
        let mut lines = Vec::new();
        for l in &o.lines {
            let uid: Option<String> = self
                .db
                .conn()
                .query_row(
                    "SELECT uid FROM products WHERE lower(sku) = lower(?1) AND archived_at IS NULL",
                    [l.sku.trim()],
                    |r| r.get(0),
                )
                .optional()?;
            let uid = uid.ok_or_else(|| {
                AppError::Validation(format!("no hay un producto con el código {}", l.sku.trim()))
            })?;
            lines.push(StockLineInput {
                product_uid: uid,
                qty_milli: -l.qty * 1000,
            });
        }
        self.adjust_stock(&AdjustmentInput {
            warehouse_uid: warehouse.uid,
            date: date.to_string(),
            kind: "ajuste".into(),
            reason: format!(
                "Despacho de la venta de Mercado Libre {order_id} (factura N° {folio}, ya registrada)"
            ),
            lines,
        })?;
        Ok(())
    }

    pub fn ml_orders(&self, limit: Option<i64>) -> AppResult<Vec<MlOrderRow>> {
        self.require("ventas.ver")?;
        Ok(db::list_orders(
            self.db.conn(),
            limit.unwrap_or(200).clamp(1, 2_000),
        )?)
    }

    /// Enlaza una publicación (y variación) con un producto de NÚCLEO.
    pub fn ml_link_item(
        &mut self,
        item_id: &str,
        variation_id: Option<&str>,
        product_uid: &str,
        title: Option<&str>,
    ) -> AppResult<()> {
        self.require("ventas.crear")?;
        let item = item_id.trim().to_uppercase();
        if item.is_empty() || item.len() > 30 {
            return Err(AppError::Validation(
                "código de publicación no válido (ej. MLC123456789)".into(),
            ));
        }
        let conn = self.db.conn();
        let pid: i64 = conn
            .query_row(
                "SELECT id FROM products WHERE uid = ?1 AND archived_at IS NULL",
                [product_uid],
                |r| r.get(0),
            )
            .optional()?
            .ok_or_else(|| AppError::NotFound("el producto".into()))?;
        let user = self.actor_name()?;
        let conn = self.db.conn();
        db::link_item(
            conn,
            &item,
            variation_id.unwrap_or("").trim(),
            pid,
            title,
            &now_utc(),
        )?;
        log(
            conn,
            &user,
            "update",
            "integracion",
            PROVIDER,
            &format!("Enlazó la publicación {item} con un producto"),
            None,
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_conocido() {
        // RFC 7636, apéndice B.
        assert_eq!(
            pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn neto_desde_bruto() {
        assert_eq!(net_of(11_900, Some(190_000)), 10_000);
        assert_eq!(net_of(9_990, Some(190_000)), 8_395);
        assert_eq!(net_of(9_990, None), 9_990);
    }

    #[test]
    fn codigo_pegado() {
        assert_eq!(
            code_from_input("TG-abc-123"),
            Some(("TG-abc-123".into(), None))
        );
        assert_eq!(
            code_from_input("https://www.nucleoerp.cl/ml/?code=TG-xyz&state=5000.n0"),
            Some(("TG-xyz".into(), Some("5000.n0".into())))
        );
        assert_eq!(code_from_input("  "), None);
    }

    #[test]
    fn lee_pedido_y_factura() {
        let v: Value = serde_json::json!({
            "id": 2000001, "pack_id": null, "status": "paid", "date_created": "2026-11-20T10:00:00.000-03:00",
            "total_amount": 27900.0,
            "buyer": {"id": 9, "nickname": "COMPRADOR1", "first_name": "Ana", "last_name": "Pérez"},
            "order_items": [{"item": {"id": "MLC1", "title": "RC-5+", "seller_sku": "P-00004", "variation_id": null},
                             "quantity": 1, "unit_price": 27900.0, "sale_fee": 3906.0}],
            "payments": [{"id": 555, "status": "approved", "shipping_cost": 0}],
            "shipping": {"id": 777}
        });
        let o = parse_order(&v).unwrap();
        assert_eq!(o.id, "2000001");
        assert_eq!(o.date, "2026-11-20");
        assert_eq!(o.items[0].seller_sku.as_deref(), Some("P-00004"));
        assert_eq!(o.sale_fee_minor(), 3906);
        assert_eq!(o.payment_id.as_deref(), Some("555"));
        let b = parse_billing(&serde_json::json!({"billing_info": {"doc_type": "RUT", "doc_number": "76123456-0",
            "additional_info": [{"type": "BUSINESS_NAME", "value": "Panadería SpA"}, {"type": "STREET_NAME", "value": "Merced"},
                                {"type": "STREET_NUMBER", "value": "838"}]}}))
        .unwrap();
        assert!(b.wants_invoice());
        assert_eq!(b.address.as_deref(), Some("Merced 838"));
        let p = parse_billing(
            &serde_json::json!({"billing_info": {"doc_type": "RUT", "doc_number": "12345678-5"}}),
        )
        .unwrap();
        assert!(!p.wants_invoice());
    }
}
