//! Descuentos y promociones: packs a precio fijo o con %, descuento por cantidad (por tramos y
//! opcionalmente sumando varios productos), lleva X paga Y, descuento por cliente y para clientes
//! preferenciales. Se aplican en la venta como descuento por línea (el cálculo vive en la interfaz,
//! `data/promos.ts`); aquí se guardan y validan.

use crate::company::CompanySession;
use crate::sales_ops::{local_today, log, opt_text, parse_date};
use crate::{AppError, AppResult};
use nucleo_db::now_utc;
use nucleo_db::promotions::{self as db, PromotionRow, PromotionWrite};
use nucleo_db::{customers, products};
use serde::{Deserialize, Serialize};

pub const KINDS: &[&str] = &["pack", "cantidad", "lleva_paga", "cliente", "preferencial"];
const PPM: i64 = 1_000_000;

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct PromoItem {
    pub product_uid: String,
    /// Cantidad del producto dentro del pack (milésimas). En otros tipos no se usa.
    pub qty_milli: i64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct Tier {
    pub min_milli: i64,
    pub pct_ppm: i64,
}

/// Regla de la promoción; cada tipo usa sus campos.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct PromoRule {
    /// Productos del pack (con cantidad) o productos a los que aplica.
    pub items: Vec<PromoItem>,
    /// Alcance por categoría (en lugar de productos).
    pub category_uid: Option<String>,
    /// Aplica a todos los productos y servicios.
    pub all_products: bool,
    /// Pack: precio total neto del pack.
    pub pack_price_minor: Option<i64>,
    /// Pack, cliente y preferencial: porcentaje (ppm).
    pub pct_ppm: Option<i64>,
    /// Por cantidad: tramos.
    pub tiers: Vec<Tier>,
    /// Por cantidad: suma las unidades de todos los productos del alcance.
    pub mixed: bool,
    /// Lleva X paga Y.
    pub buy: i64,
    pub pay: i64,
    /// Por cliente: clientes elegidos.
    pub customer_uids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PromotionInput {
    pub name: String,
    pub kind: String,
    pub rule: PromoRule,
    #[serde(default)]
    pub starts_on: Option<String>,
    #[serde(default)]
    pub ends_on: Option<String>,
    #[serde(default = "yes")]
    pub active: bool,
    #[serde(default)]
    pub notes: Option<String>,
}
fn yes() -> bool {
    true
}

#[derive(Debug, Clone, Serialize)]
pub struct PromoProduct {
    pub uid: String,
    pub sku: String,
    pub name: String,
    pub unit: String,
    pub price_minor: i64,
    pub cost_e4: i64,
    pub qty_milli: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Promotion {
    pub uid: String,
    pub name: String,
    pub kind: String,
    pub rule: PromoRule,
    pub starts_on: Option<String>,
    pub ends_on: Option<String>,
    pub active: bool,
    /// "activa", "programada", "vencida" o "pausada".
    pub status: String,
    pub notes: Option<String>,
    pub created_at: String,
    /// Productos de la regla con su precio y costo (para mostrar y revisar el margen).
    pub products: Vec<PromoProduct>,
    pub category: Option<String>,
    /// Productos de la categoría del alcance (para aplicar la promoción en la venta).
    pub category_product_uids: Vec<String>,
    pub customers: Vec<PromoCustomer>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PromoCustomer {
    pub uid: String,
    pub name: String,
}

fn pct_ok(p: Option<i64>, label: &str) -> AppResult<i64> {
    match p {
        Some(v) if v > 0 && v < PPM => Ok(v),
        _ => Err(AppError::Validation(format!(
            "{label}: el porcentaje debe ser mayor que 0 y menor que 100"
        ))),
    }
}

impl CompanySession {
    fn promo_view(&self, r: &PromotionRow, today: &str) -> AppResult<Promotion> {
        let conn = self.db.conn();
        let rule: PromoRule = serde_json::from_str(&r.rule_json).unwrap_or_default();
        let costs = self.can("costos.ver");
        let mut prods = Vec::new();
        for it in &rule.items {
            if let Some(p) = products::by_uid(conn, &it.product_uid)? {
                prods.push(PromoProduct {
                    uid: p.uid,
                    sku: p.sku,
                    name: p.name,
                    unit: p.unit,
                    price_minor: p.price_minor,
                    cost_e4: if costs { p.cost_e4 } else { 0 },
                    qty_milli: it.qty_milli,
                });
            }
        }
        let category = match &rule.category_uid {
            Some(u) => nucleo_db::categories::list(conn)?
                .into_iter()
                .find(|c| &c.uid == u)
                .map(|c| c.name),
            None => None,
        };
        let category_product_uids = match &rule.category_uid {
            Some(u) => {
                let mut st = conn.prepare(
                    "SELECT p.uid FROM products p JOIN categories c ON c.id = p.category_id
                     WHERE c.uid = ?1 AND p.archived_at IS NULL",
                )?;
                st.query_map([u], |r| r.get::<_, String>(0))?
                    .collect::<Result<Vec<_>, _>>()?
            }
            None => Vec::new(),
        };
        let mut custs = Vec::new();
        for u in &rule.customer_uids {
            if let Some(c) = customers::by_uid(conn, u)? {
                custs.push(PromoCustomer {
                    uid: c.uid,
                    name: c.name,
                });
            }
        }
        let status = if !r.active {
            "pausada"
        } else if r.starts_on.as_deref().is_some_and(|s| s > today) {
            "programada"
        } else if r.ends_on.as_deref().is_some_and(|e| e < today) {
            "vencida"
        } else {
            "activa"
        };
        Ok(Promotion {
            uid: r.uid.clone(),
            name: r.name.clone(),
            kind: r.kind.clone(),
            rule,
            starts_on: r.starts_on.clone(),
            ends_on: r.ends_on.clone(),
            active: r.active,
            status: status.into(),
            notes: r.notes.clone(),
            created_at: r.created_at.clone(),
            products: prods,
            category,
            category_product_uids,
            customers: custs,
        })
    }

    pub fn promotions(&self) -> AppResult<Vec<Promotion>> {
        self.actor()?;
        let conn = self.db.conn();
        let today = local_today(conn)?;
        db::list(conn)?
            .iter()
            .map(|r| self.promo_view(r, &today))
            .collect()
    }

    fn check_rule(&self, kind: &str, rule: &PromoRule) -> AppResult<PromoRule> {
        let conn = self.db.conn();
        let mut rule = rule.clone();
        // Productos existentes y sin repetir.
        let mut seen = Vec::new();
        for it in &rule.items {
            if products::by_uid(conn, &it.product_uid)?.is_none() {
                return Err(AppError::NotFound("un producto de la promoción".into()));
            }
            if seen.contains(&it.product_uid) {
                return Err(AppError::Validation(
                    "un producto aparece dos veces en la promoción".into(),
                ));
            }
            seen.push(it.product_uid.clone());
        }
        if let Some(c) = rule.category_uid.as_deref().filter(|c| !c.is_empty()) {
            if !nucleo_db::categories::list(conn)?
                .iter()
                .any(|x| x.uid == c)
            {
                return Err(AppError::NotFound("la categoría".into()));
            }
        } else {
            rule.category_uid = None;
        }
        let scoped = rule.all_products || rule.category_uid.is_some() || !rule.items.is_empty();
        match kind {
            "pack" => {
                if rule.items.len() < 2
                    && rule.items.iter().map(|i| i.qty_milli).sum::<i64>() < 2_000
                {
                    return Err(AppError::Validation(
                        "un pack necesita al menos dos productos o dos unidades".into(),
                    ));
                }
                if rule.items.iter().any(|i| i.qty_milli <= 0) {
                    return Err(AppError::Validation(
                        "cada producto del pack necesita una cantidad".into(),
                    ));
                }
                match (rule.pack_price_minor, rule.pct_ppm) {
                    (Some(p), None) if p > 0 => {}
                    (None, Some(_)) => {
                        pct_ok(rule.pct_ppm, "el pack")?;
                    }
                    _ => {
                        return Err(AppError::Validation(
                            "indica el precio del pack o el porcentaje de descuento (uno de los dos)"
                                .into(),
                        ));
                    }
                }
                rule.all_products = false;
                rule.category_uid = None;
            }
            "cantidad" => {
                if !scoped {
                    return Err(AppError::Validation(
                        "elige los productos, una categoría o todos los productos".into(),
                    ));
                }
                if rule.tiers.is_empty() || rule.tiers.len() > 10 {
                    return Err(AppError::Validation(
                        "agrega entre 1 y 10 tramos de cantidad".into(),
                    ));
                }
                rule.tiers.sort_by_key(|t| t.min_milli);
                for (i, t) in rule.tiers.iter().enumerate() {
                    if t.min_milli <= 0 {
                        return Err(AppError::Validation(
                            "cada tramo necesita una cantidad mínima".into(),
                        ));
                    }
                    pct_ok(Some(t.pct_ppm), "el tramo")?;
                    if i > 0 && rule.tiers[i - 1].min_milli == t.min_milli {
                        return Err(AppError::Validation(
                            "hay dos tramos con la misma cantidad".into(),
                        ));
                    }
                }
            }
            "lleva_paga" => {
                if !scoped {
                    return Err(AppError::Validation(
                        "elige los productos, una categoría o todos los productos".into(),
                    ));
                }
                if !(2..=100).contains(&rule.buy) || rule.pay < 1 || rule.pay >= rule.buy {
                    return Err(AppError::Validation(
                        "en «lleva X paga Y», Y debe ser menor que X (ej. lleva 3 paga 2)".into(),
                    ));
                }
            }
            "cliente" | "preferencial" => {
                if !scoped {
                    rule.all_products = true;
                }
                pct_ok(rule.pct_ppm, "el descuento")?;
                if kind == "cliente" {
                    if rule.customer_uids.is_empty() {
                        return Err(AppError::Validation("elige al menos un cliente".into()));
                    }
                    for u in &rule.customer_uids {
                        if customers::by_uid(conn, u)?.is_none() {
                            return Err(AppError::NotFound("un cliente de la promoción".into()));
                        }
                    }
                } else {
                    rule.customer_uids.clear();
                }
            }
            _ => return Err(AppError::Validation("tipo de promoción no válido".into())),
        }
        Ok(rule)
    }

    /// Crea (sin `uid`) o cambia una promoción.
    pub fn save_promotion(
        &mut self,
        uid: Option<&str>,
        input: &PromotionInput,
    ) -> AppResult<Vec<Promotion>> {
        self.require("productos.editar")?;
        let name = input.name.trim();
        if name.is_empty() || name.chars().count() > 120 {
            return Err(AppError::Validation(
                "el nombre de la promoción es obligatorio (hasta 120 caracteres)".into(),
            ));
        }
        if !KINDS.contains(&input.kind.as_str()) {
            return Err(AppError::Validation("tipo de promoción no válido".into()));
        }
        let rule = self.check_rule(&input.kind, &input.rule)?;
        let date = |v: &Option<String>, l: &str| -> AppResult<Option<String>> {
            match v.as_deref().filter(|d| !d.is_empty()) {
                Some(d) => Ok(Some(parse_date(l, d)?)),
                None => Ok(None),
            }
        };
        let starts = date(&input.starts_on, "la fecha de inicio")?;
        let ends = date(&input.ends_on, "la fecha de término")?;
        if let (Some(s), Some(e)) = (&starts, &ends)
            && e < s
        {
            return Err(AppError::Validation(
                "la promoción termina antes de empezar".into(),
            ));
        }
        let notes = opt_text(&input.notes, 500, "las notas")?;
        let json = serde_json::to_string(&rule).map_err(|e| AppError::Validation(e.to_string()))?;
        let now = now_utc();
        let user = self.actor_name()?;
        let w = PromotionWrite {
            name,
            kind: &input.kind,
            rule_json: &json,
            starts_on: starts.as_deref(),
            ends_on: ends.as_deref(),
            active: input.active,
            notes: notes.as_deref(),
            now: &now,
        };
        let tx = self.db.conn_mut().transaction()?;
        let id = match uid {
            Some(u) => {
                let r =
                    db::by_uid(&tx, u)?.ok_or_else(|| AppError::NotFound("la promoción".into()))?;
                db::update(&tx, r.id, &w)?;
                u.to_string()
            }
            None => {
                let u = uuid::Uuid::now_v7().to_string();
                db::insert(&tx, &u, &w)?;
                u
            }
        };
        log(
            &tx,
            &user,
            if uid.is_some() {
                "promocion.editar"
            } else {
                "promocion.crear"
            },
            "promocion",
            &id,
            &format!("{name} ({})", input.kind),
            None,
        )?;
        tx.commit()?;
        self.promotions()
    }

    pub fn set_promotion_active(&mut self, uid: &str, active: bool) -> AppResult<Vec<Promotion>> {
        self.require("productos.editar")?;
        let r = db::by_uid(self.db.conn(), uid)?
            .ok_or_else(|| AppError::NotFound("la promoción".into()))?;
        let now = now_utc();
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        db::set_active(&tx, r.id, active, &now)?;
        log(
            &tx,
            &user,
            "promocion.estado",
            "promocion",
            uid,
            if active { "Activada" } else { "Pausada" },
            None,
        )?;
        tx.commit()?;
        self.promotions()
    }

    pub fn delete_promotion(&mut self, uid: &str) -> AppResult<Vec<Promotion>> {
        self.require("productos.editar")?;
        let r = db::by_uid(self.db.conn(), uid)?
            .ok_or_else(|| AppError::NotFound("la promoción".into()))?;
        let now = now_utc();
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        db::archive(&tx, r.id, &now)?;
        log(
            &tx,
            &user,
            "promocion.eliminar",
            "promocion",
            uid,
            &r.name,
            None,
        )?;
        tx.commit()?;
        self.promotions()
    }
}
