//! Inteligencia del dueño (Fase 12 B y C): alertas de «Requiere tu atención» con sus reglas
//! configurables, análisis de productos (qué se vende, qué deja margen, qué está detenido) y de
//! clientes (quién compra, quién está en riesgo de irse). Todo se calcula desde los documentos y
//! siempre se explica con los datos que lo justifican (Inteligencia comercial §37).

use crate::company::CompanySession;
use crate::inventory_ops::{date_ord, date_str};
use crate::sales_ops::{local_today, log};
use crate::{AppError, AppResult};
use nucleo_db::core as dbcore;
use nucleo_db::finance as fdb;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Ventas vigentes: efectuadas o cerradas.
const LIVE: &str = "s.commercial_state IN ('efectuada', 'cerrada')";

/* ───────────────────────────── Alertas ───────────────────────────── */

/// Reglas de las alertas (Configuración → Alertas). Se guardan por negocio.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AlertSettings {
    /// Tipos de alerta apagados (ej. "documentar").
    pub disabled: Vec<String>,
    /// Días sin vender para considerar un producto detenido.
    pub idle_days: i64,
    /// Días hacia adelante para avisar pagos por vencer.
    pub due_soon_days: i64,
    /// Alza mínima (%) del precio de compra para avisar.
    pub price_rise_pct: i64,
    /// Margen sobre la venta (%) bajo el cual un producto se marca con margen bajo.
    pub low_margin_pct: i64,
}

impl Default for AlertSettings {
    fn default() -> Self {
        AlertSettings {
            disabled: Vec::new(),
            idle_days: 90,
            due_soon_days: 7,
            price_rise_pct: 5,
            low_margin_pct: 10,
        }
    }
}

/// Tipos de alerta, en el orden en que se muestran en Configuración.
pub const ALERT_KINDS: &[(&str, &str)] = &[
    ("caja_negativa", "La caja proyectada queda en negativo"),
    ("cobros_vencidos", "Clientes con pagos atrasados"),
    ("pagos_vencidos", "Pagos atrasados a proveedores o gastos"),
    ("pagos_proximos", "Pagos por vencer"),
    ("sin_stock", "Productos agotados que se venden"),
    ("bajo_minimo", "Productos bajo el stock mínimo"),
    (
        "margen_bajo",
        "Productos que se venden con margen bajo o pérdida",
    ),
    ("alza_precios", "Proveedores que subieron precios"),
    ("detenidos", "Productos detenidos (sin vender)"),
    ("clientes_riesgo", "Clientes que dejaron de comprar"),
    ("importaciones", "Importaciones en camino"),
    ("presupuesto", "Gastos sobre el presupuesto del mes"),
    ("documentar", "Ventas pendientes de documentar"),
];

#[derive(Debug, Clone, Serialize)]
pub struct AlertLine {
    pub label: String,
    pub value: String,
    pub href: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AlertItem {
    pub kind: String,
    /// "alta", "media" o "info".
    pub severity: String,
    pub title: String,
    /// Por qué aparece: los datos que la justifican.
    pub detail: String,
    pub count: i64,
    pub amount_minor: Option<i64>,
    pub href: String,
    pub action: String,
    /// Hasta 5 ejemplos concretos.
    pub lines: Vec<AlertLine>,
}

/* ───────────────────────────── Análisis de productos ───────────────────────────── */

#[derive(Debug, Clone, Serialize)]
pub struct ProductInsight {
    pub uid: String,
    pub sku: String,
    pub name: String,
    pub category: Option<String>,
    pub unit: String,
    pub is_service: bool,
    pub qty_milli: i64,
    pub net_minor: i64,
    /// Cero sin permiso para ver costos.
    pub cost_minor: i64,
    pub margin_minor: i64,
    /// Margen sobre la venta (ppm), si hubo ventas y se ven los costos.
    pub margin_ppm: Option<i64>,
    pub prev_net_minor: i64,
    /// Variación de la venta contra el período anterior (ppm), si hubo venta antes.
    pub growth_ppm: Option<i64>,
    pub sales_count: i64,
    pub last_sale: Option<String>,
    pub days_since_sale: Option<i64>,
    pub on_hand_milli: i64,
    pub stock_value_minor: i64,
    /// "A", "B", "C" o "" (sin ventas en el período).
    pub abc: String,
    /// "estrella", "volumen", "oportunidad", "revisar", "sin_ventas" o "sin_datos".
    pub quadrant: String,
    pub idle: bool,
    pub low_margin: bool,
    pub growing: bool,
    pub falling: bool,
    pub explanation: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProductInsights {
    pub from: String,
    pub to: String,
    pub window_days: i64,
    pub costs_visible: bool,
    pub idle_days: i64,
    pub low_margin_pct: i64,
    pub total_net_minor: i64,
    pub total_margin_minor: i64,
    pub idle_value_minor: i64,
    pub rows: Vec<ProductInsight>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TrendPoint {
    pub month: String,
    pub qty_milli: i64,
    pub net_minor: i64,
    pub cost_minor: i64,
}

/* ───────────────────────────── Análisis de clientes ───────────────────────────── */

#[derive(Debug, Clone, Serialize)]
pub struct CustomerInsight {
    pub uid: String,
    pub name: String,
    pub rut: Option<String>,
    pub purchases: i64,
    pub first_purchase: Option<String>,
    pub last_purchase: Option<String>,
    pub days_since: Option<i64>,
    /// Días promedio entre compras (con 2 o más compras).
    pub avg_interval_days: Option<i64>,
    pub net_12m_minor: i64,
    pub margin_12m_minor: i64,
    pub purchases_12m: i64,
    pub avg_ticket_minor: i64,
    pub pending_minor: i64,
    pub overdue_minor: i64,
    /// "A", "B", "C" o "" (sin compras en 12 meses).
    pub abc: String,
    /// "nuevo", "activo", "en_riesgo", "perdido", "ocasional" o "sin_compras".
    pub state: String,
    pub explanation: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct CustomerInsights {
    pub costs_visible: bool,
    pub total_net_12m_minor: i64,
    /// Parte de la venta de 12 meses que hacen los clientes A (ppm).
    pub top_share_ppm: i64,
    pub rows: Vec<CustomerInsight>,
}

/* ───────────────────────────── Utilidades ───────────────────────────── */

fn ppm(part: i64, whole: i64) -> Option<i64> {
    (whole != 0).then(|| ((part as i128 * 1_000_000) / whole as i128) as i64)
}

fn pct_text(v: i64) -> String {
    let x = v as f64 / 10_000.0;
    format!("{:.1} %", x).replace('.', ",")
}

/// Pesos con separador de miles («$1.250.000»).
pub(crate) fn money(n: i64) -> String {
    let digits = n.unsigned_abs().to_string();
    let mut out = String::new();
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push('.');
        }
        out.push(c);
    }
    format!("{}${out}", if n < 0 { "-" } else { "" })
}

/// «2026-10-17» → «17-10-2026».
fn fecha(d: &str) -> String {
    if d.len() == 10 {
        format!("{}-{}-{}", &d[8..10], &d[5..7], &d[..4])
    } else {
        d.to_string()
    }
}

fn qty(milli: i64) -> String {
    let whole = milli / 1000;
    let frac = (milli % 1000).abs();
    let mut s = money(whole).replacen('$', "", 1);
    if frac != 0 {
        let f = format!("{frac:03}");
        s.push(',');
        s.push_str(f.trim_end_matches('0'));
    }
    s
}

/// Clasificación ABC por aporte acumulado: A hasta el 80 %, B hasta el 95 %, C el resto.
fn abc_classes(values: &[i64]) -> Vec<String> {
    let total: i64 = values.iter().filter(|v| **v > 0).sum();
    let mut idx: Vec<usize> = (0..values.len()).collect();
    idx.sort_by(|a, b| values[*b].cmp(&values[*a]));
    let mut out = vec![String::new(); values.len()];
    let mut acc: i64 = 0;
    for i in idx {
        let v = values[i];
        if v <= 0 || total <= 0 {
            continue;
        }
        let before = acc;
        acc += v;
        // Se clasifica por dónde empieza su aporte: el que cruza el 80 % sigue siendo A.
        out[i] = if before * 100 < total * 80 {
            "A"
        } else if before * 100 < total * 95 {
            "B"
        } else {
            "C"
        }
        .into();
    }
    out
}

fn median(mut v: Vec<i64>) -> i64 {
    if v.is_empty() {
        return 0;
    }
    v.sort_unstable();
    let n = v.len();
    if n % 2 == 1 {
        v[n / 2]
    } else {
        (v[n / 2 - 1] + v[n / 2]) / 2
    }
}

fn count(conn: &Connection, sql: &str, p: &[&dyn rusqlite::ToSql]) -> AppResult<i64> {
    Ok(conn
        .query_row(sql, p, |r| r.get::<_, Option<i64>>(0))?
        .unwrap_or(0))
}

impl CompanySession {
    /* ───────────── Reglas de alertas ───────────── */

    pub fn alert_settings(&self) -> AppResult<AlertSettings> {
        self.actor()?;
        let v = dbcore::get_setting(self.db.conn(), "alertas")?;
        Ok(v.and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default())
    }

    pub fn update_alert_settings(&mut self, s: &AlertSettings) -> AppResult<AlertSettings> {
        self.require("config.editar")?;
        if !(15..=730).contains(&s.idle_days) {
            return Err(AppError::Validation(
                "los días sin vender deben estar entre 15 y 730".into(),
            ));
        }
        if !(1..=60).contains(&s.due_soon_days) {
            return Err(AppError::Validation(
                "el aviso de pagos debe ser entre 1 y 60 días antes".into(),
            ));
        }
        if !(1..=100).contains(&s.price_rise_pct) {
            return Err(AppError::Validation(
                "el alza de precio debe estar entre 1 % y 100 %".into(),
            ));
        }
        if !(0..=90).contains(&s.low_margin_pct) {
            return Err(AppError::Validation(
                "el margen bajo debe estar entre 0 % y 90 %".into(),
            ));
        }
        let mut disabled: Vec<String> = s
            .disabled
            .iter()
            .filter(|k| ALERT_KINDS.iter().any(|(x, _)| x == k))
            .cloned()
            .collect();
        disabled.sort();
        disabled.dedup();
        let clean = AlertSettings {
            disabled,
            ..s.clone()
        };
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        dbcore::set_setting(
            &tx,
            "alertas",
            &serde_json::to_value(&clean).unwrap_or_default(),
        )?;
        log(
            &tx,
            &user,
            "alertas.config",
            "negocio",
            "alertas",
            &format!(
                "Reglas de alertas: {} apagadas, detenido a los {} días",
                clean.disabled.len(),
                clean.idle_days
            ),
            None,
        )?;
        tx.commit()?;
        Ok(clean)
    }

    /* ───────────── Alertas ───────────── */

    /// «Requiere tu atención»: alertas ordenadas por gravedad, solo de lo que el usuario puede ver.
    pub fn alerts(&self) -> AppResult<Vec<AlertItem>> {
        self.actor()?;
        let cfg = self.alert_settings()?;
        let on = |k: &str| !cfg.disabled.iter().any(|d| d == k);
        let conn = self.db.conn();
        let today = local_today(conn)?;
        let t = date_ord(&today).unwrap_or(0);
        let money_ok = self.can("dinero.ver");
        let sales_ok = self.can("ventas.ver");
        let costs_ok = self.can("costos.ver");
        let stock_ok = self.can("inventario.ver") || self.can("productos.ver");
        let mut out: Vec<AlertItem> = Vec::new();

        if money_ok && on("caja_negativa") {
            let o = self.money_overview()?;
            if let Some(week) = &o.shortfall_week {
                out.push(AlertItem {
                    kind: "caja_negativa".into(),
                    severity: "alta".into(),
                    title: "Tu caja proyectada queda en negativo".into(),
                    detail: format!(
                        "Con lo que tienes hoy ({}), lo que te deben y lo que debes pagar, la semana del {} quedarías en {}.",
                        money(o.cash_minor),
                        fecha(week),
                        money(o.lowest_minor)
                    ),
                    count: 1,
                    amount_minor: Some(o.lowest_minor),
                    href: "/dinero".into(),
                    action: "Ver el flujo de caja".into(),
                    lines: vec![],
                });
            }
        }

        if (money_ok || sales_ok) && on("cobros_vencidos") {
            let rows: Vec<fdb::DueRow> = fdb::open_receivables(conn)?
                .into_iter()
                .filter(|r| r.due_date < today)
                .collect();
            if !rows.is_empty() {
                let mut by: Vec<(String, i64, i64)> = Vec::new();
                for r in &rows {
                    let late = t - date_ord(&r.due_date).unwrap_or(t);
                    match by.iter_mut().find(|x| x.0 == r.party) {
                        Some(x) => {
                            x.1 += r.pending_minor;
                            x.2 = x.2.max(late);
                        }
                        None => by.push((r.party.clone(), r.pending_minor, late)),
                    }
                }
                by.sort_by_key(|x| std::cmp::Reverse(x.1));
                let total: i64 = by.iter().map(|x| x.1).sum();
                out.push(AlertItem {
                    kind: "cobros_vencidos".into(),
                    severity: "alta".into(),
                    title: format!(
                        "{} {} te {} dinero atrasado",
                        by.len(),
                        if by.len() == 1 { "cliente" } else { "clientes" },
                        if by.len() == 1 { "debe" } else { "deben" }
                    ),
                    detail: format!(
                        "{} vencido en {} {}.",
                        money(total),
                        rows.len(),
                        if rows.len() == 1 { "venta" } else { "ventas" }
                    ),
                    count: by.len() as i64,
                    amount_minor: Some(total),
                    href: "/dinero?tab=por_cobrar".into(),
                    action: "Ver quién te debe".into(),
                    lines: by
                        .iter()
                        .take(5)
                        .map(|(p, a, late)| AlertLine {
                            label: p.clone(),
                            value: format!("{} · {late} d", money(*a)),
                            href: None,
                        })
                        .collect(),
                });
            }
        }

        if money_ok && (on("pagos_vencidos") || on("pagos_proximos")) {
            let payables = fdb::open_payables(conn)?;
            let limit = date_str(t + cfg.due_soon_days);
            let late: Vec<&fdb::DueRow> = payables.iter().filter(|p| p.due_date < today).collect();
            let soon: Vec<&fdb::DueRow> = payables
                .iter()
                .filter(|p| p.due_date >= today && p.due_date <= limit)
                .collect();
            let line = |p: &&fdb::DueRow| AlertLine {
                label: format!("{} · {}", p.party, p.document),
                value: format!("{} · {}", money(p.pending_minor), fecha(&p.due_date)),
                href: Some(p.link.clone()),
            };
            if on("pagos_vencidos") && !late.is_empty() {
                let total: i64 = late.iter().map(|p| p.pending_minor).sum();
                out.push(AlertItem {
                    kind: "pagos_vencidos".into(),
                    severity: "alta".into(),
                    title: format!(
                        "{} {} atrasado{}",
                        late.len(),
                        if late.len() == 1 { "pago" } else { "pagos" },
                        if late.len() == 1 { "" } else { "s" }
                    ),
                    detail: format!(
                        "Debes {} que ya vencieron a proveedores o en gastos.",
                        money(total)
                    ),
                    count: late.len() as i64,
                    amount_minor: Some(total),
                    href: "/dinero?tab=por_pagar".into(),
                    action: "Ver qué debes".into(),
                    lines: late.iter().take(5).map(line).collect(),
                });
            }
            if on("pagos_proximos") && !soon.is_empty() {
                let total: i64 = soon.iter().map(|p| p.pending_minor).sum();
                out.push(AlertItem {
                    kind: "pagos_proximos".into(),
                    severity: "media".into(),
                    title: format!(
                        "{} {} en los próximos {} días",
                        soon.len(),
                        if soon.len() == 1 {
                            "pago vence"
                        } else {
                            "pagos vencen"
                        },
                        cfg.due_soon_days
                    ),
                    detail: format!("Necesitas {} para cubrirlos.", money(total)),
                    count: soon.len() as i64,
                    amount_minor: Some(total),
                    href: "/dinero?tab=calendario".into(),
                    action: "Ver el calendario".into(),
                    lines: soon.iter().take(5).map(line).collect(),
                });
            }
        }

        if stock_ok && on("sin_stock") {
            let from = date_str(t - 89);
            let mut stmt = conn.prepare(&format!(
                "SELECT p.uid, p.name, sum(i.qty_milli) AS sold, p.unit_code
                 FROM products p JOIN sale_items i ON i.product_id = p.id JOIN sales s ON s.id = i.sale_id
                 WHERE p.track_stock = 1 AND p.archived_at IS NULL AND {LIVE} AND s.issue_date >= ?1
                   AND coalesce((SELECT sum(on_hand_milli) FROM stock_balances b WHERE b.product_id = p.id), 0) <= 0
                 GROUP BY p.id ORDER BY sold DESC"
            ))?;
            let rows = stmt
                .query_map([&from], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, i64>(2)?,
                        r.get::<_, String>(3)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            if !rows.is_empty() {
                out.push(AlertItem {
                    kind: "sin_stock".into(),
                    severity: "alta".into(),
                    title: format!(
                        "{} {} sin stock",
                        rows.len(),
                        if rows.len() == 1 {
                            "producto que se vende está"
                        } else {
                            "productos que se venden están"
                        }
                    ),
                    detail: "Se vendieron en los últimos 90 días y hoy no tienes unidades: podrías estar perdiendo ventas.".into(),
                    count: rows.len() as i64,
                    amount_minor: None,
                    href: "/inventario?filtro=sin_stock".into(),
                    action: "Ver en inventario".into(),
                    lines: rows
                        .iter()
                        .take(5)
                        .map(|(uid, name, sold, unit)| AlertLine {
                            label: name.clone(),
                            value: format!("vendió {} {} en 90 d", qty(*sold), unit.to_lowercase()),
                            href: Some(format!("/inventario/producto/{uid}")),
                        })
                        .collect(),
                });
            }
        }

        if stock_ok && on("bajo_minimo") {
            let mut stmt = conn.prepare(
                "SELECT p.uid, p.name, q, p.min_stock_milli FROM (
                    SELECT p.*, coalesce((SELECT sum(on_hand_milli) FROM stock_balances b WHERE b.product_id = p.id), 0) AS q
                    FROM products p WHERE p.track_stock = 1 AND p.archived_at IS NULL AND p.min_stock_milli > 0) p
                 WHERE q > 0 AND q <= p.min_stock_milli ORDER BY q * 1.0 / p.min_stock_milli",
            )?;
            let rows = stmt
                .query_map([], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, i64>(2)?,
                        r.get::<_, i64>(3)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            if !rows.is_empty() {
                out.push(AlertItem {
                    kind: "bajo_minimo".into(),
                    severity: "media".into(),
                    title: format!(
                        "{} {} por agotarse",
                        rows.len(),
                        if rows.len() == 1 {
                            "producto está"
                        } else {
                            "productos están"
                        }
                    ),
                    detail: "Quedan en o bajo el stock mínimo que definiste.".into(),
                    count: rows.len() as i64,
                    amount_minor: None,
                    href: "/inventario?filtro=bajo_minimo".into(),
                    action: "Ver qué reponer".into(),
                    lines: rows
                        .iter()
                        .take(5)
                        .map(|(uid, name, q, min)| AlertLine {
                            label: name.clone(),
                            value: format!("quedan {} · mín. {}", qty(*q), qty(*min)),
                            href: Some(format!("/inventario/producto/{uid}")),
                        })
                        .collect(),
                });
            }
        }

        if sales_ok && costs_ok && on("margen_bajo") {
            let from = date_str(t - 29);
            let mut stmt = conn.prepare(&format!(
                "SELECT p.uid, coalesce(p.name, i.description), sum(i.net_minor) AS net, sum(coalesce(i.cost_minor, 0)) AS cost
                 FROM sale_items i JOIN sales s ON s.id = i.sale_id JOIN products p ON p.id = i.product_id
                 WHERE {LIVE} AND s.issue_date >= ?1 GROUP BY p.id
                 HAVING net > 0 AND cost > 0 AND (net - cost) * 100 < net * ?2
                 ORDER BY (net - cost) * 1.0 / net"
            ))?;
            let rows = stmt
                .query_map(rusqlite::params![from, cfg.low_margin_pct], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, i64>(2)?,
                        r.get::<_, i64>(3)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            if !rows.is_empty() {
                let losing = rows.iter().filter(|r| r.3 > r.2).count();
                out.push(AlertItem {
                    kind: "margen_bajo".into(),
                    severity: if losing > 0 { "alta" } else { "media" }.into(),
                    title: format!(
                        "{} {} con margen bajo{}",
                        rows.len(),
                        if rows.len() == 1 {
                            "producto se vende"
                        } else {
                            "productos se venden"
                        },
                        if losing > 0 {
                            format!(" ({losing} con pérdida)")
                        } else {
                            String::new()
                        }
                    ),
                    detail: format!(
                        "En los últimos 30 días dejaron menos de {} % sobre la venta. Revisa el precio o el costo.",
                        cfg.low_margin_pct
                    ),
                    count: rows.len() as i64,
                    amount_minor: None,
                    href: "/analisis?tab=productos&filtro=margen_bajo".into(),
                    action: "Ver el análisis".into(),
                    lines: rows
                        .iter()
                        .take(5)
                        .map(|(uid, name, net, cost)| AlertLine {
                            label: name.clone(),
                            value: format!(
                                "margen {}",
                                pct_text(ppm(net - cost, *net).unwrap_or(0))
                            ),
                            href: Some(format!("/inventario/producto/{uid}")),
                        })
                        .collect(),
                });
            }
        }

        if self.can("compras.ver") && on("alza_precios") {
            let from = date_str(t - 29);
            let mut stmt = conn.prepare(
                "WITH p AS (
                    SELECT i.product_id, c.supplier_id, c.issue_date AS d, i.unit_price_minor AS price,
                        row_number() OVER (PARTITION BY i.product_id ORDER BY c.issue_date DESC, c.id DESC, i.id DESC) AS rn
                    FROM purchase_items i JOIN purchases c ON c.id = i.purchase_id
                    WHERE c.status = 'registrada' AND i.product_id IS NOT NULL AND i.unit_price_minor > 0)
                 SELECT pr.uid, pr.name, coalesce(s.name, 'Proveedor'), a.price, b.price
                 FROM p a JOIN p b ON b.product_id = a.product_id AND b.rn = 2
                 JOIN products pr ON pr.id = a.product_id LEFT JOIN suppliers s ON s.id = a.supplier_id
                 WHERE a.rn = 1 AND a.d >= ?1 AND a.price * 100 > b.price * (100 + ?2)
                 ORDER BY (a.price - b.price) * 1.0 / b.price DESC",
            )?;
            let rows = stmt
                .query_map(rusqlite::params![from, cfg.price_rise_pct], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, i64>(3)?,
                        r.get::<_, i64>(4)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            if !rows.is_empty() {
                let mut suppliers: Vec<&str> = rows.iter().map(|r| r.2.as_str()).collect();
                suppliers.sort_unstable();
                suppliers.dedup();
                out.push(AlertItem {
                    kind: "alza_precios".into(),
                    severity: "media".into(),
                    title: format!(
                        "{} {} subi{} precios",
                        suppliers.len(),
                        if suppliers.len() == 1 { "proveedor" } else { "proveedores" },
                        if suppliers.len() == 1 { "ó" } else { "eron" }
                    ),
                    detail: format!(
                        "{} {} con un alza de más de {} % en la última compra (30 días). Revisa tu precio de venta.",
                        rows.len(),
                        if rows.len() == 1 { "producto" } else { "productos" },
                        cfg.price_rise_pct
                    ),
                    count: rows.len() as i64,
                    amount_minor: None,
                    href: "/compras".into(),
                    action: "Ver compras".into(),
                    lines: rows
                        .iter()
                        .take(5)
                        .map(|(uid, name, sup, now, before)| AlertLine {
                            label: format!("{name} · {sup}"),
                            value: format!(
                                "{} → {} (+{})",
                                money(*before),
                                money(*now),
                                pct_text(ppm(now - before, *before).unwrap_or(0))
                            ),
                            href: Some(format!("/inventario/producto/{uid}")),
                        })
                        .collect(),
                });
            }
        }

        if stock_ok && on("detenidos") {
            let (n, value, lines) = self.idle_products(conn, t, cfg.idle_days, costs_ok)?;
            if n > 0 {
                out.push(AlertItem {
                    kind: "detenidos".into(),
                    severity: "info".into(),
                    title: format!(
                        "{n} {} más de {} días sin venderse",
                        if n == 1 { "producto lleva" } else { "productos llevan" },
                        cfg.idle_days
                    ),
                    detail: if costs_ok {
                        format!("Tienes {} invertido en ese stock detenido. Considera una promoción o liquidarlo.", money(value))
                    } else {
                        "Tienen stock y no se venden. Considera una promoción o liquidarlos.".into()
                    },
                    count: n,
                    amount_minor: costs_ok.then_some(value),
                    href: "/analisis?tab=productos&filtro=detenidos".into(),
                    action: "Ver los productos".into(),
                    lines,
                });
            }
        }

        if (sales_ok || self.can("clientes.ver")) && on("clientes_riesgo") {
            let risk: Vec<CustomerInsight> = self
                .customer_rows(conn, &today, false)?
                .into_iter()
                .filter(|c| c.state == "en_riesgo")
                .collect();
            if !risk.is_empty() {
                out.push(AlertItem {
                    kind: "clientes_riesgo".into(),
                    severity: "info".into(),
                    title: format!(
                        "{} {} de comprar",
                        risk.len(),
                        if risk.len() == 1 {
                            "cliente frecuente dejó"
                        } else {
                            "clientes frecuentes dejaron"
                        }
                    ),
                    detail: "Compraban con regularidad y ya pasó más del doble de su tiempo habitual entre compras.".into(),
                    count: risk.len() as i64,
                    amount_minor: None,
                    href: "/analisis?tab=clientes&filtro=en_riesgo".into(),
                    action: "Ver los clientes".into(),
                    lines: risk
                        .iter()
                        .take(5)
                        .map(|c| AlertLine {
                            label: c.name.clone(),
                            value: format!("hace {} d", c.days_since.unwrap_or(0)),
                            href: Some(format!("/clientes/{}", c.uid)),
                        })
                        .collect(),
                });
            }
        }

        if self.can("comex.ver") && on("importaciones") {
            let mut stmt = conn.prepare(
                "SELECT uid, number, stage, eta FROM imports
                 WHERE is_scenario = 0 AND stage IN ('ordenada', 'pagada', 'produccion', 'lista_despacho', 'embarcada', 'en_transito', 'arribada', 'internacion', 'transporte_local')
                 ORDER BY eta IS NULL, eta",
            )?;
            let rows = stmt
                .query_map([], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, Option<String>>(3)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            if !rows.is_empty() {
                let next = rows.iter().find_map(|r| r.3.clone());
                out.push(AlertItem {
                    kind: "importaciones".into(),
                    severity: "info".into(),
                    title: format!(
                        "{} {} en camino",
                        rows.len(),
                        if rows.len() == 1 {
                            "importación"
                        } else {
                            "importaciones"
                        }
                    ),
                    detail: match &next {
                        Some(d) => {
                            let days = date_ord(d).unwrap_or(t) - t;
                            if days >= 0 {
                                format!("La próxima llega en {days} días ({}).", fecha(d))
                            } else {
                                format!(
                                    "La próxima tenía llegada el {}: revisa su estado.",
                                    fecha(d)
                                )
                            }
                        }
                        None => "Aún sin fecha estimada de llegada.".into(),
                    },
                    count: rows.len() as i64,
                    amount_minor: None,
                    href: "/comex".into(),
                    action: "Ver importaciones".into(),
                    lines: rows
                        .iter()
                        .take(5)
                        .map(|(uid, number, stage, eta)| AlertLine {
                            label: format!("{number} · {}", stage.replace('_', " ")),
                            value: eta
                                .as_deref()
                                .map(fecha)
                                .unwrap_or_else(|| "sin ETA".into()),
                            href: Some(format!("/comex/importacion/{uid}")),
                        })
                        .collect(),
                });
            }
        }

        if money_ok && on("presupuesto") {
            let month_start = format!("{}-01", &today[..7]);
            let mut spent: HashMap<i64, i64> = HashMap::new();
            for (_, cat, _, total) in fdb::expenses_by_month_category(conn, &month_start, &today)? {
                *spent.entry(cat).or_default() += total;
            }
            let mut over: Vec<(String, i64, i64)> = fdb::categories(conn)?
                .into_iter()
                .filter_map(|c| {
                    let b = c.monthly_budget_minor.filter(|b| *b > 0)?;
                    let s = spent.get(&c.id).copied().unwrap_or(0);
                    (s > b).then_some((c.name, s, b))
                })
                .collect();
            over.sort_by_key(|x| std::cmp::Reverse(x.1 - x.2));
            if !over.is_empty() {
                let extra: i64 = over.iter().map(|o| o.1 - o.2).sum();
                out.push(AlertItem {
                    kind: "presupuesto".into(),
                    severity: "media".into(),
                    title: format!(
                        "{} {} sobre el presupuesto del mes",
                        over.len(),
                        if over.len() == 1 {
                            "categoría de gastos va"
                        } else {
                            "categorías de gastos van"
                        }
                    ),
                    detail: format!("En total, {} más de lo presupuestado.", money(extra)),
                    count: over.len() as i64,
                    amount_minor: Some(extra),
                    href: "/gastos".into(),
                    action: "Ver gastos".into(),
                    lines: over
                        .iter()
                        .take(5)
                        .map(|(n, s, b)| AlertLine {
                            label: n.clone(),
                            value: format!("{} de {}", money(*s), money(*b)),
                            href: None,
                        })
                        .collect(),
                });
            }
        }

        if sales_ok && on("documentar") {
            let n = count(
                conn,
                "SELECT count(*) FROM sales WHERE documentation_state = 'pendiente' AND commercial_state <> 'anulada'",
                &[],
            )?;
            if n > 0 {
                out.push(AlertItem {
                    kind: "documentar".into(),
                    severity: "media".into(),
                    title: format!(
                        "{n} {} de documentar",
                        if n == 1 { "venta pendiente" } else { "ventas pendientes" }
                    ),
                    detail: "Aún no anotas el documento tributario (boleta o factura) con que las respaldaste.".into(),
                    count: n,
                    amount_minor: None,
                    href: "/ventas?tab=pendientes_doc".into(),
                    action: "Revisar y marcar".into(),
                    lines: vec![],
                });
            }
        }

        let rank = |s: &str| match s {
            "alta" => 0,
            "media" => 1,
            _ => 2,
        };
        out.sort_by_key(|a| rank(&a.severity));
        Ok(out)
    }

    /// Productos con stock que no se venden hace `idle_days` días (y existen hace más que eso).
    fn idle_products(
        &self,
        conn: &Connection,
        t: i64,
        idle_days: i64,
        costs: bool,
    ) -> AppResult<(i64, i64, Vec<AlertLine>)> {
        let cut = date_str(t - idle_days);
        let mut stmt = conn.prepare(&format!(
            "SELECT p.uid, p.name, q, CAST(q * p.avg_cost_e4 / 10000000.0 AS INTEGER) AS value,
                (SELECT max(s.issue_date) FROM sale_items i JOIN sales s ON s.id = i.sale_id WHERE i.product_id = p.id AND {LIVE}) AS last
             FROM (SELECT p.*, coalesce((SELECT sum(on_hand_milli) FROM stock_balances b WHERE b.product_id = p.id), 0) AS q
                   FROM products p WHERE p.track_stock = 1 AND p.archived_at IS NULL AND substr(p.created_at, 1, 10) <= ?1) p
             WHERE q > 0 AND coalesce(last, '0000-00-00') <= ?1
             ORDER BY value DESC"
        ))?;
        let rows = stmt
            .query_map([&cut], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2)?,
                    r.get::<_, i64>(3)?,
                    r.get::<_, Option<String>>(4)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let value: i64 = rows.iter().map(|r| r.3).sum();
        let lines = rows
            .iter()
            .take(5)
            .map(|(uid, name, q, v, last)| AlertLine {
                label: name.clone(),
                value: {
                    let since = match last {
                        Some(l) => format!("{} d", t - date_ord(l).unwrap_or(t)),
                        None => "nunca vendido".into(),
                    };
                    if costs {
                        format!("{} · {since}", money(*v))
                    } else {
                        format!("{} u · {since}", qty(*q))
                    }
                },
                href: Some(format!("/inventario/producto/{uid}")),
            })
            .collect();
        Ok((rows.len() as i64, value, lines))
    }

    /* ───────────── Análisis de productos ───────────── */

    /// Análisis de productos en una ventana de días (30, 90, 180 o 365) contra la ventana anterior.
    pub fn product_insights(&self, window_days: i64) -> AppResult<ProductInsights> {
        self.require("reportes.ver")?;
        self.require("ventas.ver")?;
        let w = match window_days {
            30 | 90 | 180 | 365 => window_days,
            _ => 90,
        };
        let cfg = self.alert_settings()?;
        let costs = self.can("costos.ver");
        let conn = self.db.conn();
        let today = local_today(conn)?;
        let t = date_ord(&today).unwrap_or(0);
        let from = date_str(t - w + 1);
        let prev_from = date_str(t - 2 * w + 1);
        let prev_to = date_str(t - w);
        let cut = date_str(t - cfg.idle_days);

        let mut stmt = conn.prepare(&format!(
            "SELECT p.uid, coalesce(p.sku, ''), p.name, k.name, lower(p.unit_code), p.kind = 'servicio', p.track_stock,
                coalesce(cur.q, 0), coalesce(cur.net, 0), coalesce(cur.cost, 0), coalesce(cur.n, 0),
                coalesce(prev.net, 0), last.d,
                coalesce((SELECT sum(on_hand_milli) FROM stock_balances b WHERE b.product_id = p.id), 0),
                p.avg_cost_e4, substr(p.created_at, 1, 10)
             FROM products p
             LEFT JOIN categories k ON k.id = p.category_id
             LEFT JOIN (SELECT i.product_id, sum(i.qty_milli) AS q, sum(i.net_minor) AS net,
                            sum(coalesce(i.cost_minor, 0)) AS cost, count(DISTINCT s.id) AS n
                        FROM sale_items i JOIN sales s ON s.id = i.sale_id
                        WHERE {LIVE} AND s.issue_date BETWEEN ?1 AND ?2 GROUP BY i.product_id) cur ON cur.product_id = p.id
             LEFT JOIN (SELECT i.product_id, sum(i.net_minor) AS net
                        FROM sale_items i JOIN sales s ON s.id = i.sale_id
                        WHERE {LIVE} AND s.issue_date BETWEEN ?3 AND ?4 GROUP BY i.product_id) prev ON prev.product_id = p.id
             LEFT JOIN (SELECT i.product_id, max(s.issue_date) AS d
                        FROM sale_items i JOIN sales s ON s.id = i.sale_id WHERE {LIVE} GROUP BY i.product_id) last ON last.product_id = p.id
             WHERE p.archived_at IS NULL OR cur.net IS NOT NULL
             ORDER BY coalesce(cur.net, 0) DESC, p.name COLLATE NOCASE"
        ))?;
        type Raw = (
            String,
            String,
            String,
            Option<String>,
            String,
            bool,
            bool,
            (i64, i64, i64, i64, i64),
            Option<String>,
            i64,
            i64,
            String,
        );
        let raw: Vec<Raw> = stmt
            .query_map(rusqlite::params![from, today, prev_from, prev_to], |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                    (r.get(7)?, r.get(8)?, r.get(9)?, r.get(10)?, r.get(11)?),
                    r.get(12)?,
                    r.get(13)?,
                    r.get(14)?,
                    r.get(15)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let margins: Vec<i64> = raw
            .iter()
            .map(|r| {
                let (_, net, cost, _, _) = r.7;
                if costs { net - cost } else { net }
            })
            .collect();
        let abc = abc_classes(&margins);
        let sold: Vec<&Raw> = raw.iter().filter(|r| r.7.1 > 0).collect();
        let med_net = median(sold.iter().map(|r| r.7.1).collect());
        let med_margin = median(
            sold.iter()
                .filter_map(|r| ppm(r.7.1 - r.7.2, r.7.1))
                .collect(),
        );

        let mut rows = Vec::with_capacity(raw.len());
        let (mut total_net, mut total_margin, mut idle_value) = (0, 0, 0);
        for (i, r) in raw.into_iter().enumerate() {
            let (
                uid,
                sku,
                name,
                category,
                unit,
                is_service,
                track,
                (q, net, cost, n, prev),
                last,
                on_hand,
                avg_e4,
                created,
            ) = r;
            let cost = if costs { cost } else { 0 };
            let margin = net - cost;
            let margin_ppm = if costs { ppm(margin, net) } else { None };
            let growth = (prev > 0).then(|| ppm(net - prev, prev).unwrap_or(0));
            let days_since = last.as_deref().and_then(date_ord).map(|d| t - d);
            let stock_value = if costs && on_hand > 0 {
                ((on_hand as i128 * avg_e4 as i128) / 10_000_000) as i64
            } else {
                0
            };
            let idle = track
                && on_hand > 0
                && last.as_deref().unwrap_or("0000-00-00") <= cut.as_str()
                && created.as_str() <= cut.as_str();
            let low = margin_ppm.is_some_and(|m| m < cfg.low_margin_pct * 10_000);
            let growing = growth.is_some_and(|g| g >= 200_000);
            let falling = growth.is_some_and(|g| g <= -200_000);
            let quadrant = if net <= 0 {
                "sin_ventas"
            } else if !costs {
                "sin_datos"
            } else {
                let m = margin_ppm.unwrap_or(0);
                match (net >= med_net, m >= med_margin) {
                    (true, true) => "estrella",
                    (true, false) => "volumen",
                    (false, true) => "oportunidad",
                    (false, false) => "revisar",
                }
            };
            let mut why: Vec<String> = Vec::new();
            if net > 0 {
                why.push(format!(
                    "Vendió {} {unit} por {} en {} {}",
                    qty(q),
                    money(net),
                    n,
                    if n == 1 { "venta" } else { "ventas" }
                ));
                if let Some(m) = margin_ppm {
                    why.push(format!(
                        "deja {} de margen ({})",
                        money(margin),
                        pct_text(m)
                    ));
                }
                if let Some(g) = growth {
                    why.push(format!(
                        "{} {} contra los {w} días anteriores",
                        if g >= 0 { "sube" } else { "baja" },
                        pct_text(g.abs())
                    ));
                } else if prev == 0 {
                    why.push(format!("sin ventas en los {w} días anteriores"));
                }
            } else {
                why.push(match days_since {
                    Some(d) => format!("Sin ventas en {w} días; la última fue hace {d} días"),
                    None => "Nunca se ha vendido".into(),
                });
            }
            if idle && costs {
                why.push(format!(
                    "tiene {} inmovilizado en stock",
                    money(stock_value)
                ));
            }
            total_net += net;
            total_margin += margin;
            if idle {
                idle_value += stock_value;
            }
            rows.push(ProductInsight {
                uid,
                sku,
                name,
                category,
                unit,
                is_service,
                qty_milli: q,
                net_minor: net,
                cost_minor: cost,
                margin_minor: if costs { margin } else { 0 },
                margin_ppm,
                prev_net_minor: prev,
                growth_ppm: growth,
                sales_count: n,
                last_sale: last,
                days_since_sale: days_since,
                on_hand_milli: on_hand,
                stock_value_minor: stock_value,
                abc: abc[i].clone(),
                quadrant: quadrant.into(),
                idle,
                low_margin: low,
                growing,
                falling,
                explanation: why.join("; ") + ".",
            });
        }
        Ok(ProductInsights {
            from,
            to: today,
            window_days: w,
            costs_visible: costs,
            idle_days: cfg.idle_days,
            low_margin_pct: cfg.low_margin_pct,
            total_net_minor: total_net,
            total_margin_minor: if costs { total_margin } else { 0 },
            idle_value_minor: idle_value,
            rows,
        })
    }

    /// Evolución de 12 meses de un producto (cantidad, neto y costo por mes).
    pub fn product_trend(&self, uid: &str) -> AppResult<Vec<TrendPoint>> {
        self.require("ventas.ver")?;
        let costs = self.can("costos.ver");
        let conn = self.db.conn();
        let pid: i64 = conn
            .query_row("SELECT id FROM products WHERE uid = ?1", [uid], |r| {
                r.get(0)
            })
            .map_err(|_| AppError::NotFound("el producto".into()))?;
        let today = local_today(conn)?;
        let (mut y, mut m): (i32, i32) = (
            today[..4].parse().unwrap_or(2026),
            today[5..7].parse().unwrap_or(1),
        );
        let mut months = Vec::new();
        for _ in 0..12 {
            months.push(format!("{y:04}-{m:02}"));
            m -= 1;
            if m == 0 {
                m = 12;
                y -= 1;
            }
        }
        months.reverse();
        let mut stmt = conn.prepare(&format!(
            "SELECT substr(s.issue_date, 1, 7), sum(i.qty_milli), sum(i.net_minor), sum(coalesce(i.cost_minor, 0))
             FROM sale_items i JOIN sales s ON s.id = i.sale_id
             WHERE i.product_id = ?1 AND {LIVE} AND s.issue_date >= ?2 GROUP BY 1"
        ))?;
        let by: HashMap<String, (i64, i64, i64)> = stmt
            .query_map(rusqlite::params![pid, format!("{}-01", months[0])], |r| {
                Ok((r.get::<_, String>(0)?, (r.get(1)?, r.get(2)?, r.get(3)?)))
            })?
            .collect::<Result<_, _>>()?;
        Ok(months
            .into_iter()
            .map(|mo| {
                let (q, n, c) = by.get(&mo).copied().unwrap_or((0, 0, 0));
                TrendPoint {
                    month: mo,
                    qty_milli: q,
                    net_minor: n,
                    cost_minor: if costs { c } else { 0 },
                }
            })
            .collect())
    }

    /* ───────────── Análisis de clientes ───────────── */

    pub fn customer_insights(&self) -> AppResult<CustomerInsights> {
        self.require("reportes.ver")?;
        self.require("ventas.ver")?;
        let conn = self.db.conn();
        let today = local_today(conn)?;
        let costs = self.can("costos.ver");
        let rows = self.customer_rows(conn, &today, costs)?;
        let total: i64 = rows.iter().map(|r| r.net_12m_minor).sum();
        let top: i64 = rows
            .iter()
            .filter(|r| r.abc == "A")
            .map(|r| r.net_12m_minor)
            .sum();
        Ok(CustomerInsights {
            costs_visible: costs,
            total_net_12m_minor: total,
            top_share_ppm: ppm(top, total).unwrap_or(0),
            rows,
        })
    }

    fn customer_rows(
        &self,
        conn: &Connection,
        today: &str,
        costs: bool,
    ) -> AppResult<Vec<CustomerInsight>> {
        let t = date_ord(today).unwrap_or(0);
        let y_from = date_str(t - 364);
        let mut stmt = conn.prepare(&format!(
            "SELECT c.uid, c.name, c.rut,
                count(s.id), min(s.issue_date), max(s.issue_date),
                coalesce(sum(CASE WHEN s.issue_date >= ?1 THEN s.net_minor + s.exempt_minor END), 0),
                coalesce(sum(CASE WHEN s.issue_date >= ?1 THEN s.net_minor + s.exempt_minor - s.cost_minor END), 0),
                coalesce(sum(CASE WHEN s.issue_date >= ?1 THEN 1 END), 0),
                coalesce((SELECT sum(r.amount_minor - r.paid_minor) FROM receivables r JOIN sales x ON x.id = r.sale_id
                          WHERE x.customer_id = c.id AND r.status = 'abierta'), 0),
                coalesce((SELECT sum(r.amount_minor - r.paid_minor) FROM receivables r JOIN sales x ON x.id = r.sale_id
                          WHERE x.customer_id = c.id AND r.status = 'abierta' AND r.due_date < ?2), 0)
             FROM customers c LEFT JOIN sales s ON s.customer_id = c.id AND {LIVE}
             WHERE c.archived_at IS NULL
             GROUP BY c.id
             ORDER BY 7 DESC, c.name COLLATE NOCASE"
        ))?;
        type Raw = (
            String,
            String,
            Option<String>,
            i64,
            Option<String>,
            Option<String>,
            (i64, i64, i64, i64, i64),
        );
        let raw: Vec<Raw> = stmt
            .query_map(rusqlite::params![y_from, today], |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    (r.get(6)?, r.get(7)?, r.get(8)?, r.get(9)?, r.get(10)?),
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let abc = abc_classes(&raw.iter().map(|r| r.6.0).collect::<Vec<_>>());
        let mut out = Vec::with_capacity(raw.len());
        for (i, (uid, name, rut, n, first, last, (net, margin, n12, pending, overdue))) in
            raw.into_iter().enumerate()
        {
            let fo = first.as_deref().and_then(date_ord);
            let lo = last.as_deref().and_then(date_ord);
            let days_since = lo.map(|l| t - l);
            let avg = match (fo, lo) {
                (Some(f), Some(l)) if n >= 2 => Some(((l - f) / (n - 1)).max(1)),
                _ => None,
            };
            let (state, why) = match (n, days_since, avg) {
                (0, _, _) | (_, None, _) => (
                    "sin_compras",
                    "Aún no tiene compras registradas.".to_string(),
                ),
                (1, Some(d), _) => {
                    if d <= 30 {
                        ("nuevo", format!("Hizo su primera compra hace {d} días."))
                    } else if d > 180 {
                        ("perdido", format!("Compró una sola vez, hace {d} días."))
                    } else {
                        ("ocasional", format!("Compró una sola vez, hace {d} días."))
                    }
                }
                (_, Some(d), Some(a)) => {
                    let risk = (2 * a).max(30);
                    let lost = (4 * a).max(180);
                    let base = format!(
                        "Compra cada {a} días en promedio ({n} compras); la última fue hace {d} días"
                    );
                    if d > lost {
                        ("perdido", format!("{base}: más de {lost} días sin volver."))
                    } else if d > risk {
                        (
                            "en_riesgo",
                            format!("{base}: ya pasó más del doble de lo habitual."),
                        )
                    } else if fo.is_some_and(|f| t - f <= 30) {
                        ("nuevo", format!("{base}."))
                    } else {
                        ("activo", format!("{base}."))
                    }
                }
                _ => ("activo", String::new()),
            };
            out.push(CustomerInsight {
                uid,
                name,
                rut,
                purchases: n,
                first_purchase: first,
                last_purchase: last,
                days_since,
                avg_interval_days: avg,
                net_12m_minor: net,
                margin_12m_minor: if costs { margin } else { 0 },
                purchases_12m: n12,
                avg_ticket_minor: if n12 > 0 { net / n12 } else { 0 },
                pending_minor: pending,
                overdue_minor: overdue,
                abc: abc[i].clone(),
                state: state.into(),
                explanation: why,
            });
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clasificacion_abc() {
        let c = abc_classes(&[500, 300, 100, 60, 40, 0]);
        assert_eq!(c, ["A", "A", "B", "B", "C", ""]);
        assert!(abc_classes(&[]).is_empty());
        assert_eq!(abc_classes(&[10]), ["A"]);
    }

    #[test]
    fn textos() {
        assert_eq!(money(1_250_000), "$1.250.000");
        assert_eq!(money(-900), "-$900");
        assert_eq!(qty(12_500), "12,5");
        assert_eq!(qty(1_000_000), "1.000");
        assert_eq!(pct_text(125_000), "12,5 %");
        assert_eq!(median(vec![3, 1, 2]), 2);
        assert_eq!(median(vec![4, 1, 2, 3]), 2);
    }
}
