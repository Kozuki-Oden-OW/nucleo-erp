//! Casos de uso de Inventario (Fase 7): bodegas, kárdex, ajustes y conteos, transferencias,
//! configuración de stock negativo y análisis de stock (real y futuro, velocidad de venta,
//! cobertura, riesgo de quiebre, sin movimiento y sugerencia de compra explicada).

use crate::company::CompanySession;
use crate::sales_ops::{MAX_LINES, MAX_QTY_MILLI, local_today, log, opt_text, parse_date};
use crate::{AppError, AppResult};
use nucleo_db::core as dbcore;
use nucleo_db::inventory::{
    self as db, KardexRow, ReorderSettingsRow, StockByWarehouse, StockDocRow, WarehouseRow,
};
use nucleo_db::now_utc;
use nucleo_db::products::{self, Movement, ProductRow};
use nucleo_domain::inventory::{self as inv, ReorderAdvice, ReorderParams, StockPosition};
use rust_decimal::Decimal;
use rust_decimal::prelude::ToPrimitive;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Días que se miran hacia atrás para calcular la velocidad de venta.
pub const WINDOW_DAYS: i64 = 90;
/// Mínimo de días con stock para que la velocidad sea confiable.
pub const MIN_DAYS_WITH_STOCK: u32 = 14;
/// Plazo de reposición supuesto cuando el producto no tiene uno configurado.
pub const DEFAULT_LEAD_TIME_DAYS: i64 = 7;

/* ───────────────────────────── Tipos de la interfaz ───────────────────────────── */

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct InventorySettings {
    /// Permite efectuar ventas aunque el stock quede bajo cero.
    pub allow_negative: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Advice {
    /// "comprar", "no_comprar", "exceso" o "sin_datos".
    pub kind: String,
    pub quantity_milli: Option<i64>,
    pub explanation: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct StockAnalysis {
    pub uid: String,
    pub sku: String,
    pub name: String,
    pub unit: String,
    pub on_hand_milli: i64,
    pub reserved_milli: i64,
    pub in_purchase_milli: i64,
    /// Disponible + por recibir (sin descontar ventas futuras).
    pub future_milli: i64,
    pub min_milli: i64,
    pub avg_cost_e4: i64,
    pub stock_value_minor: i64,
    pub sold_milli: i64,
    pub days_with_stock: i64,
    /// Unidades por día (milésimas), si hay datos suficientes.
    pub velocity_milli: Option<i64>,
    pub coverage_days: Option<i64>,
    pub next_arrival: Option<String>,
    pub last_movement: Option<String>,
    /// "sin_stock", "riesgo_quiebre", "bajo_minimo", "exceso", "sin_movimiento" u "ok".
    pub status: String,
    pub advice: Advice,
}

#[derive(Debug, Clone, Serialize)]
pub struct InventoryOverview {
    pub window_days: i64,
    pub total_value_minor: i64,
    pub rows: Vec<StockAnalysis>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProductInventory {
    pub product: ProductRow,
    pub by_warehouse: Vec<StockByWarehouse>,
    pub kardex: Vec<KardexRow>,
    pub analysis: Option<StockAnalysis>,
    pub settings: ReorderSettingsRow,
}

#[derive(Debug, Clone, Deserialize)]
pub struct StockLineInput {
    pub product_uid: String,
    /// Ajuste: diferencia (+/−). Conteo: cantidad contada.
    pub qty_milli: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AdjustmentInput {
    pub warehouse_uid: String,
    pub date: String,
    /// "ajuste" (diferencia) o "conteo" (cantidad contada).
    pub kind: String,
    pub reason: String,
    pub lines: Vec<StockLineInput>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TransferInput {
    pub from_uid: String,
    pub to_uid: String,
    pub date: String,
    pub notes: Option<String>,
    pub lines: Vec<StockLineInput>,
}

#[derive(Debug, Clone, Serialize)]
pub struct StockDocDone {
    pub number: String,
    pub moved_lines: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ReorderInput {
    pub min_milli: i64,
    pub safety_days: i64,
    pub target_coverage_days: i64,
    pub excess_coverage_days: i64,
    pub lead_time_days: Option<i64>,
}

/* ───────────────────────────── Cálculos ───────────────────────────── */

pub(crate) fn date_ord(s: &str) -> Option<i64> {
    let fmt = time::macros::format_description!("[year]-[month]-[day]");
    time::Date::parse(s, &fmt)
        .ok()
        .map(|d| d.to_julian_day() as i64)
}

pub(crate) fn date_str(julian: i64) -> String {
    let fmt = time::macros::format_description!("[year]-[month]-[day]");
    time::Date::from_julian_day(julian as i32)
        .ok()
        .and_then(|d| d.format(&fmt).ok())
        .unwrap_or_default()
}

fn milli(d: Decimal) -> i64 {
    (d * Decimal::from(1000)).round().to_i64().unwrap_or(0)
}

fn units(m: i64) -> Decimal {
    Decimal::new(m, 3)
}

impl CompanySession {
    /* ───────────── Configuración ───────────── */

    pub fn inventory_settings(&self) -> AppResult<InventorySettings> {
        self.actor()?;
        let v = dbcore::get_setting(self.db.conn(), "inventario")?.unwrap_or_default();
        Ok(InventorySettings {
            allow_negative: v
                .get("allow_negative")
                .and_then(|x| x.as_bool())
                .unwrap_or(true),
        })
    }

    pub fn update_inventory_settings(
        &mut self,
        s: &InventorySettings,
    ) -> AppResult<InventorySettings> {
        self.require("config.editar")?;
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        dbcore::set_setting(
            &tx,
            "inventario",
            &serde_json::json!({ "allow_negative": s.allow_negative }),
        )?;
        let text = if s.allow_negative {
            "Se permite vender sin stock"
        } else {
            "No se permite vender sin stock"
        };
        log(
            &tx,
            &user,
            "inventario.config",
            "negocio",
            "inventario",
            text,
            None,
        )?;
        tx.commit()?;
        self.inventory_settings()
    }

    /// Verifica que una venta no deje stock negativo cuando el negocio no lo permite.
    pub(crate) fn check_stock_for_sale(&self, sale_id: i64) -> AppResult<()> {
        if self.inventory_settings()?.allow_negative {
            return Ok(());
        }
        let conn = self.db.conn();
        let wh = conn
            .query_row("SELECT id FROM warehouses WHERE is_default = 1", [], |r| {
                r.get::<_, i64>(0)
            })
            .ok();
        let Some(wh) = wh else { return Ok(()) };
        let mut stmt = conn.prepare(
            "SELECT p.id, p.name, sum(i.qty_milli) FROM sale_items i JOIN products p ON p.id = i.product_id
             WHERE i.sale_id = ?1 AND p.track_stock = 1 GROUP BY p.id",
        )?;
        let need = stmt
            .query_map([sale_id], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let mut short = Vec::new();
        for (pid, name, qty) in need {
            let (on_hand, _) = products::balance(conn, pid, wh)?;
            if on_hand < qty {
                short.push(format!(
                    "{name} (hay {}, se venden {})",
                    units(on_hand).normalize(),
                    units(qty).normalize()
                ));
            }
        }
        if short.is_empty() {
            Ok(())
        } else {
            Err(AppError::Validation(format!(
                "no hay stock suficiente en la bodega principal: {}. Registra la compra o un ajuste, o permite vender sin stock en Configuración",
                short.join("; ")
            )))
        }
    }

    /* ───────────── Bodegas ───────────── */

    pub fn warehouses(&self) -> AppResult<Vec<WarehouseRow>> {
        self.require("inventario.ver")?;
        let mut rows = db::warehouses(self.db.conn())?;
        if !self.can("costos.ver") {
            rows.iter_mut().for_each(|w| w.stock_value_minor = 0);
        }
        Ok(rows)
    }

    fn warehouse(&self, uid: &str) -> AppResult<WarehouseRow> {
        db::warehouse_by_uid(self.db.conn(), uid)?
            .ok_or_else(|| AppError::NotFound("la bodega".into()))
    }

    pub fn create_warehouse(&mut self, name: &str) -> AppResult<Vec<WarehouseRow>> {
        self.require("inventario.ajustar")?;
        let name = name.trim();
        if name.is_empty() || name.chars().count() > 80 {
            return Err(AppError::Validation(
                "el nombre de la bodega es obligatorio (hasta 80 caracteres)".into(),
            ));
        }
        let now = now_utc();
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        // Garantiza que exista la bodega principal antes de crear otras.
        products::default_warehouse(&tx, &now)?;
        let code = db::next_warehouse_code(&tx)?;
        let uid = uuid::Uuid::now_v7().to_string();
        db::insert_warehouse(&tx, &uid, &code, name, &now)?;
        log(
            &tx,
            &user,
            "bodega.crear",
            "bodega",
            &uid,
            &format!("Bodega {name} creada"),
            None,
        )?;
        tx.commit()?;
        self.warehouses()
    }

    pub fn rename_warehouse(&mut self, uid: &str, name: &str) -> AppResult<Vec<WarehouseRow>> {
        self.require("inventario.ajustar")?;
        let w = self.warehouse(uid)?;
        let name = name.trim();
        if name.is_empty() || name.chars().count() > 80 {
            return Err(AppError::Validation(
                "el nombre de la bodega es obligatorio (hasta 80 caracteres)".into(),
            ));
        }
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        db::rename_warehouse(&tx, w.id, name)?;
        log(
            &tx,
            &user,
            "bodega.editar",
            "bodega",
            uid,
            &format!("Renombrada: {} → {name}", w.name),
            None,
        )?;
        tx.commit()?;
        self.warehouses()
    }

    pub fn set_default_warehouse(&mut self, uid: &str) -> AppResult<Vec<WarehouseRow>> {
        self.require("inventario.ajustar")?;
        let w = self.warehouse(uid)?;
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        db::set_default_warehouse(&tx, w.id)?;
        log(
            &tx,
            &user,
            "bodega.principal",
            "bodega",
            uid,
            &format!("{} es ahora la bodega principal", w.name),
            None,
        )?;
        tx.commit()?;
        self.warehouses()
    }

    pub fn archive_warehouse(&mut self, uid: &str) -> AppResult<Vec<WarehouseRow>> {
        self.require("inventario.ajustar")?;
        let w = self.warehouse(uid)?;
        if w.is_default {
            return Err(AppError::Validation(
                "la bodega principal no se archiva: elige otra como principal primero".into(),
            ));
        }
        if w.products_with_stock > 0 {
            return Err(AppError::Validation(
                "la bodega tiene stock: transfiérelo antes de archivarla".into(),
            ));
        }
        let now = now_utc();
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        db::archive_warehouse(&tx, w.id, &now)?;
        log(
            &tx,
            &user,
            "bodega.archivar",
            "bodega",
            uid,
            &format!("Bodega {} archivada", w.name),
            None,
        )?;
        tx.commit()?;
        self.warehouses()
    }

    /* ───────────── Ajustes, conteos y transferencias ───────────── */

    fn stock_lines(&self, lines: &[StockLineInput]) -> AppResult<Vec<(ProductRow, i64)>> {
        if lines.is_empty() {
            return Err(AppError::Validation("agrega al menos un producto".into()));
        }
        if lines.len() > MAX_LINES {
            return Err(AppError::Validation(format!(
                "hasta {MAX_LINES} productos por documento"
            )));
        }
        let mut out: Vec<(ProductRow, i64)> = Vec::new();
        for (i, l) in lines.iter().enumerate() {
            let p = products::by_uid(self.db.conn(), &l.product_uid)?
                .ok_or_else(|| AppError::NotFound(format!("el producto de la línea {}", i + 1)))?;
            if !p.track_stock {
                return Err(AppError::Validation(format!(
                    "{} es un servicio: no lleva stock",
                    p.name
                )));
            }
            if l.qty_milli.abs() > MAX_QTY_MILLI {
                return Err(AppError::Validation(format!(
                    "revisa la cantidad de {}",
                    p.name
                )));
            }
            if out.iter().any(|(x, _)| x.id == p.id) {
                return Err(AppError::Validation(format!("{} está repetido", p.name)));
            }
            out.push((p, l.qty_milli));
        }
        Ok(out)
    }

    /// Ajuste (diferencias) o conteo (cantidades contadas) en una bodega, con motivo obligatorio.
    pub fn adjust_stock(&mut self, input: &AdjustmentInput) -> AppResult<StockDocDone> {
        self.require("inventario.ajustar")?;
        let w = self.warehouse(&input.warehouse_uid)?;
        if w.archived {
            return Err(AppError::Validation("la bodega está archivada".into()));
        }
        let counting = match input.kind.as_str() {
            "conteo" => true,
            "ajuste" => false,
            _ => return Err(AppError::Validation("tipo de ajuste no válido".into())),
        };
        let reason = input.reason.trim();
        if reason.is_empty() || reason.chars().count() > 300 {
            return Err(AppError::Validation(
                "escribe el motivo del ajuste (queda en el kárdex y la auditoría)".into(),
            ));
        }
        let date = parse_date("la fecha", &input.date)?;
        let lines = self.stock_lines(&input.lines)?;
        if counting && lines.iter().any(|(_, q)| *q < 0) {
            return Err(AppError::Validation(
                "una cantidad contada no puede ser negativa".into(),
            ));
        }
        let now = now_utc();
        let by = self.user_id();
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        let number = dbcore::take_number(&tx, "AJU")?;
        let auid = uuid::Uuid::now_v7().to_string();
        let aid = db::insert_adjustment(
            &tx,
            &auid,
            &number,
            w.id,
            &date,
            &input.kind,
            reason,
            by,
            &now,
        )?;
        let mut moved = 0;
        for (p, q) in &lines {
            let (on_hand, avg) = products::balance(&tx, p.id, w.id)?;
            let delta = if counting { q - on_hand } else { *q };
            if delta == 0 {
                continue;
            }
            products::insert_movement(
                &tx,
                &Movement {
                    product_id: p.id,
                    warehouse_id: w.id,
                    date: &date,
                    kind: "ajuste",
                    qty_milli: delta,
                    unit_cost_e4: avg,
                    avg_cost_after_e4: avg,
                    source_type: "AJU",
                    source_id: aid,
                    source_line_id: None,
                    reason: Some(reason),
                    created_by: by,
                    created_at: &now,
                },
            )?;
            moved += 1;
        }
        if moved == 0 {
            return Err(AppError::Validation(if counting {
                "lo contado coincide con el stock registrado: no hay nada que ajustar".into()
            } else {
                "indica al menos una diferencia distinta de cero".into()
            }));
        }
        let text = format!("{number} en {}: {moved} productos · {reason}", w.name);
        log(
            &tx,
            &user,
            if counting {
                "inventario.conteo"
            } else {
                "inventario.ajuste"
            },
            "ajuste",
            &auid,
            &text,
            Some(reason),
        )?;
        tx.commit()?;
        Ok(StockDocDone {
            number,
            moved_lines: moved,
        })
    }

    /// Transferencia entre bodegas al costo promedio de la bodega de origen.
    pub fn transfer_stock(&mut self, input: &TransferInput) -> AppResult<StockDocDone> {
        self.require("inventario.ajustar")?;
        let from = self.warehouse(&input.from_uid)?;
        let to = self.warehouse(&input.to_uid)?;
        if from.id == to.id {
            return Err(AppError::Validation(
                "elige bodegas de origen y destino distintas".into(),
            ));
        }
        if to.archived || from.archived {
            return Err(AppError::Validation(
                "una de las bodegas está archivada".into(),
            ));
        }
        let date = parse_date("la fecha", &input.date)?;
        let notes = opt_text(&input.notes, 500, "las notas")?;
        let lines = self.stock_lines(&input.lines)?;
        if lines.iter().any(|(_, q)| *q <= 0) {
            return Err(AppError::Validation(
                "las cantidades a transferir deben ser mayores que cero".into(),
            ));
        }
        for (p, q) in &lines {
            let (on_hand, _) = products::balance(self.db.conn(), p.id, from.id)?;
            if on_hand < *q {
                return Err(AppError::Validation(format!(
                    "{}: en {} hay {} y quieres mover {}",
                    p.name,
                    from.name,
                    units(on_hand).normalize(),
                    units(*q).normalize()
                )));
            }
        }
        let now = now_utc();
        let by = self.user_id();
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        let number = dbcore::take_number(&tx, "TRA")?;
        let tuid = uuid::Uuid::now_v7().to_string();
        let tid = db::insert_transfer(
            &tx,
            &tuid,
            &number,
            from.id,
            to.id,
            &date,
            notes.as_deref(),
            by,
            &now,
        )?;
        for (p, q) in &lines {
            let (_, avg_from) = products::balance(&tx, p.id, from.id)?;
            products::insert_movement(
                &tx,
                &Movement {
                    product_id: p.id,
                    warehouse_id: from.id,
                    date: &date,
                    kind: "transferencia_salida",
                    qty_milli: -q,
                    unit_cost_e4: avg_from,
                    avg_cost_after_e4: avg_from,
                    source_type: "TRA",
                    source_id: tid,
                    source_line_id: None,
                    reason: Some(&format!("A {}", to.name)),
                    created_by: by,
                    created_at: &now,
                },
            )?;
            let (on_to, avg_to) = products::balance(&tx, p.id, to.id)?;
            let new_avg = inv::weighted_average_cost(
                Decimal::from(on_to),
                Decimal::from(avg_to),
                Decimal::from(*q),
                Decimal::from(avg_from),
            )
            .round()
            .to_i64()
            .unwrap_or(avg_from);
            products::insert_movement(
                &tx,
                &Movement {
                    product_id: p.id,
                    warehouse_id: to.id,
                    date: &date,
                    kind: "transferencia_entrada",
                    qty_milli: *q,
                    unit_cost_e4: avg_from,
                    avg_cost_after_e4: new_avg,
                    source_type: "TRA",
                    source_id: tid,
                    source_line_id: None,
                    reason: Some(&format!("Desde {}", from.name)),
                    created_by: by,
                    created_at: &now,
                },
            )?;
        }
        let text = format!(
            "{number}: {} → {} ({} productos)",
            from.name,
            to.name,
            lines.len()
        );
        log(
            &tx,
            &user,
            "inventario.transferir",
            "transferencia",
            &tuid,
            &text,
            None,
        )?;
        tx.commit()?;
        Ok(StockDocDone {
            number,
            moved_lines: lines.len() as i64,
        })
    }

    pub fn stock_documents(&self) -> AppResult<Vec<StockDocRow>> {
        self.require("inventario.ver")?;
        Ok(db::stock_documents(self.db.conn(), 200)?)
    }

    /* ───────────── Análisis ───────────── */

    /// Análisis de stock de todos los productos con inventario (o de uno, si se indica).
    fn analyze(&self, only: Option<i64>) -> AppResult<(i64, Vec<StockAnalysis>)> {
        let conn = self.db.conn();
        let today_s = local_today(conn)?;
        let today = date_ord(&today_s).unwrap_or(0);
        let start = today - WINDOW_DAYS + 1;
        let start_s = date_str(start);
        let costs = self.can("costos.ver");

        let mut stmt = conn.prepare(
            "SELECT p.id FROM products p WHERE p.track_stock = 1 AND p.archived_at IS NULL AND (?1 IS NULL OR p.id = ?1)
             ORDER BY p.name COLLATE NOCASE",
        )?;
        let ids = stmt
            .query_map([only], |r| r.get::<_, i64>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        let positions: HashMap<i64, db::PositionRow> = db::positions(conn)?
            .into_iter()
            .map(|p| (p.product_id, p))
            .collect();
        let before: HashMap<i64, i64> = db::balances_before(conn, &start_s)?.into_iter().collect();
        let mut moves: HashMap<i64, Vec<(i64, i64, i64)>> = HashMap::new();
        for (pid, d, q, sold) in db::daily_moves_since(conn, &start_s)? {
            if let Some(o) = date_ord(&d) {
                moves.entry(pid).or_default().push((o, q, sold));
            }
        }
        let returns: HashMap<i64, i64> = db::voided_sales_returns_since(conn, &start_s)?
            .into_iter()
            .collect();
        let last: HashMap<i64, String> = db::last_movement_dates(conn)?.into_iter().collect();
        let arrivals: HashMap<i64, (String, i64)> = db::next_arrivals(conn)?
            .into_iter()
            .map(|(p, d, q)| (p, (d, q)))
            .collect();
        let settings: HashMap<i64, ReorderSettingsRow> =
            db::reorder_settings_all(conn)?.into_iter().collect();

        let mut total_value: i64 = 0;
        let mut out = Vec::with_capacity(ids.len());
        for pid in ids {
            let Some(p) = products::by_id(conn, pid)? else {
                continue;
            };
            let pos = positions.get(&pid).cloned().unwrap_or_default();
            // Días con stock en la ventana (reconstruidos desde el libro) y unidades vendidas.
            let mut balance = before.get(&pid).copied().unwrap_or(0);
            let empty = Vec::new();
            let day_moves = moves.get(&pid).unwrap_or(&empty);
            let mut idx = 0;
            let mut days_with_stock = 0i64;
            let mut sold = 0i64;
            for day in start..=today {
                let opening = balance;
                let mut sold_today = 0;
                while idx < day_moves.len() && day_moves[idx].0 == day {
                    balance += day_moves[idx].1;
                    sold_today += day_moves[idx].2;
                    idx += 1;
                }
                sold += sold_today;
                if opening > 0 || sold_today > 0 {
                    days_with_stock += 1;
                }
            }
            sold = (sold - returns.get(&pid).copied().unwrap_or(0)).max(0);
            let velocity =
                inv::daily_velocity(units(sold), days_with_stock as u32, MIN_DAYS_WITH_STOCK);
            let position = StockPosition {
                on_hand: units(pos.on_hand_milli),
                reserved: units(pos.reserved_milli),
                in_purchase: units(pos.in_purchase_milli),
                in_import: units(pos.in_import_milli),
                in_receiving: units(pos.in_receiving_milli),
            };
            let coverage = velocity.and_then(|v| inv::coverage_days(position.available_real(), v));
            let s = settings.get(&pid).cloned().unwrap_or_default();
            let lead = s.lead_time_days.unwrap_or(DEFAULT_LEAD_TIME_DAYS);
            let params = ReorderParams {
                lead_time_days: lead as u32,
                safety_days: s.safety_days as u32,
                target_coverage_days: s.target_coverage_days as u32,
                excess_coverage_days: s.excess_coverage_days as u32,
                min_order_qty: Decimal::ZERO,
                order_multiple: Decimal::ONE,
            };
            let advice = match inv::reorder_advice(&position, velocity, &params) {
                ReorderAdvice::Buy {
                    quantity,
                    explanation,
                } => Advice {
                    kind: "comprar".into(),
                    quantity_milli: Some(milli(quantity)),
                    explanation,
                },
                ReorderAdvice::DontBuy { explanation } => Advice {
                    kind: "no_comprar".into(),
                    quantity_milli: None,
                    explanation,
                },
                ReorderAdvice::Excess { explanation, .. } => Advice {
                    kind: "exceso".into(),
                    quantity_milli: None,
                    explanation,
                },
                ReorderAdvice::InsufficientData => Advice {
                    kind: "sin_datos".into(),
                    quantity_milli: None,
                    explanation: format!(
                        "Faltan datos: se necesitan ventas en al menos {MIN_DAYS_WITH_STOCK} días con stock dentro de los últimos {WINDOW_DAYS} días."
                    ),
                },
            };
            let arrival = arrivals.get(&pid);
            let last_move = last.get(&pid).cloned();
            let idle = last_move
                .as_deref()
                .and_then(date_ord)
                .map(|d| today - d)
                .unwrap_or(i64::MAX);
            let cov_days = coverage.and_then(|c| c.round().to_i64());
            let arrival_days = arrival
                .and_then(|(d, _)| date_ord(d))
                .map(|d| (d - today).max(0));
            let risk = match (cov_days, arrival_days) {
                (Some(c), Some(a)) => {
                    inv::stockout_gap_days(Decimal::from(c), Decimal::from(a)).is_some()
                        && c < lead + s.safety_days
                }
                (Some(c), None) => c < lead + s.safety_days,
                _ => false,
            };
            let min = p.min_milli;
            let status = if pos.on_hand_milli <= 0 {
                "sin_stock"
            } else if risk {
                "riesgo_quiebre"
            } else if min > 0 && pos.on_hand_milli <= min {
                "bajo_minimo"
            } else if advice.kind == "exceso" {
                "exceso"
            } else if idle >= WINDOW_DAYS && sold == 0 {
                "sin_movimiento"
            } else {
                "ok"
            };
            let value = if pos.on_hand_milli > 0 {
                (Decimal::from(pos.on_hand_milli) * Decimal::from(p.cost_e4)
                    / Decimal::from(10_000_000))
                .round()
                .to_i64()
                .unwrap_or(0)
            } else {
                0
            };
            total_value += value;
            out.push(StockAnalysis {
                uid: p.uid.clone(),
                sku: p.sku.clone(),
                name: p.name.clone(),
                unit: p.unit.clone(),
                on_hand_milli: pos.on_hand_milli,
                reserved_milli: pos.reserved_milli,
                in_purchase_milli: pos.in_purchase_milli,
                future_milli: milli(position.future_without_sales()),
                min_milli: min,
                avg_cost_e4: if costs { p.cost_e4 } else { 0 },
                stock_value_minor: if costs { value } else { 0 },
                sold_milli: sold,
                days_with_stock,
                velocity_milli: velocity.map(milli),
                coverage_days: cov_days,
                next_arrival: arrival.map(|(d, _)| d.clone()),
                last_movement: last_move,
                status: status.into(),
                advice,
            });
        }
        Ok((if costs { total_value } else { 0 }, out))
    }

    pub fn inventory_overview(&self) -> AppResult<InventoryOverview> {
        self.require("inventario.ver")?;
        let (total, rows) = self.analyze(None)?;
        Ok(InventoryOverview {
            window_days: WINDOW_DAYS,
            total_value_minor: total,
            rows,
        })
    }

    pub fn product_inventory(
        &self,
        uid: &str,
        warehouse_uid: Option<&str>,
    ) -> AppResult<ProductInventory> {
        self.require("inventario.ver")?;
        let p = products::by_uid(self.db.conn(), uid)?
            .ok_or_else(|| AppError::NotFound("el producto".into()))?;
        let wh = match warehouse_uid.filter(|w| !w.is_empty()) {
            Some(w) => Some(self.warehouse(w)?.id),
            None => None,
        };
        let costs = self.can("costos.ver");
        let mut kardex = db::kardex(self.db.conn(), p.id, wh, 300)?;
        let mut by_wh = db::stock_by_warehouse(self.db.conn(), p.id)?;
        if !costs {
            kardex.iter_mut().for_each(|k| {
                k.unit_cost_e4 = 0;
                k.avg_cost_after_e4 = 0;
            });
            by_wh.iter_mut().for_each(|b| b.avg_cost_e4 = 0);
        }
        let analysis = if p.track_stock {
            self.analyze(Some(p.id))?.1.into_iter().next()
        } else {
            None
        };
        let settings = db::reorder_settings(self.db.conn(), p.id)?;
        let mut product = p;
        if !costs {
            product.cost_e4 = 0;
        }
        Ok(ProductInventory {
            product,
            by_warehouse: by_wh,
            kardex,
            analysis,
            settings,
        })
    }

    pub fn update_reorder_settings(
        &mut self,
        uid: &str,
        input: &ReorderInput,
    ) -> AppResult<ProductInventory> {
        self.require("inventario.ajustar")?;
        let p = products::by_uid(self.db.conn(), uid)?
            .ok_or_else(|| AppError::NotFound("el producto".into()))?;
        let ok = |v: i64| (0..=3650).contains(&v);
        if !(0..=MAX_QTY_MILLI).contains(&input.min_milli)
            || !ok(input.safety_days)
            || !ok(input.target_coverage_days)
            || !(1..=3650).contains(&input.excess_coverage_days)
            || input.lead_time_days.is_some_and(|l| !ok(l))
        {
            return Err(AppError::Validation(
                "revisa los valores: deben ser días entre 0 y 3.650".into(),
            ));
        }
        if input.excess_coverage_days <= input.target_coverage_days {
            return Err(AppError::Validation(
                "el umbral de exceso debe ser mayor que la cobertura objetivo".into(),
            ));
        }
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        db::set_min_stock(&tx, p.id, (input.min_milli > 0).then_some(input.min_milli))?;
        db::save_reorder_settings(
            &tx,
            p.id,
            &ReorderSettingsRow {
                safety_days: input.safety_days,
                target_coverage_days: input.target_coverage_days,
                excess_coverage_days: input.excess_coverage_days,
                lead_time_days: input.lead_time_days,
            },
        )?;
        log(
            &tx,
            &user,
            "producto.reorden",
            "producto",
            uid,
            "Parámetros de stock y reposición actualizados",
            None,
        )?;
        tx.commit()?;
        self.product_inventory(uid, None)
    }
}
