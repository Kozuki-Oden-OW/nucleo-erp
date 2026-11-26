//! Informe periódico por correo: un resumen del negocio que llega a la casilla del dueño los días que
//! él elige (todos los días hábiles, una vez por semana…), mientras NÚCLEO está abierto ese día.
//!
//! Sale de los mismos números del tablero (ventas, resultado del mes, dinero, lo que requiere
//! atención) y agrega el avance contra la **meta de ventas del mes**, si el dueño fijó una. El texto
//! se arma en este computador y se envía por la casilla de la empresa: nada pasa por un servidor de
//! NÚCLEO.

use crate::collect_ops::{clean_weekdays, due_at, local_clock};
use crate::company::CompanySession;
use crate::insight_ops::money;
use crate::inventory_ops::{date_ord, date_str};
use crate::mail_ops::{MailDraft, OutgoingMail};
use crate::sales_ops::{local_today, log};
use crate::{AppError, AppResult};
use nucleo_db::core as dbcore;
use nucleo_db::now_utc;
use serde::{Deserialize, Serialize};
use serde_json::json;

const SETTING: &str = "informe";
const STATE: &str = "informe.estado";
const DAYS: [&str; 7] = [
    "lunes",
    "martes",
    "miércoles",
    "jueves",
    "viernes",
    "sábado",
    "domingo",
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct DigestSettings {
    pub enabled: bool,
    /// Días en que sale: 1 = lunes … 7 = domingo.
    pub weekdays: Vec<u8>,
    /// Desde qué hora (0–23, hora del computador).
    pub hour: u8,
    /// A quién le llega. Vacío = la casilla de la empresa.
    pub to: String,
    /// Meta de ventas del mes (total con impuesto, igual que «Ventas del mes» en Inicio). 0 = sin meta.
    pub goal_minor: i64,
}

impl Default for DigestSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            weekdays: vec![1, 2, 3, 4, 5],
            hour: 8,
            to: String::new(),
            goal_minor: 0,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct DigestState {
    pub last_run_date: Option<String>,
    pub last_run_at: Option<String>,
    pub last_ok: bool,
    pub last_error: Option<String>,
}

/// Avance contra la meta del mes.
#[derive(Debug, Clone, Serialize)]
pub struct GoalProgress {
    pub goal_minor: i64,
    pub sold_minor: i64,
    pub remaining_minor: i64,
    /// Avance en partes por millón.
    pub progress_ppm: i64,
    /// Días hábiles (lunes a viernes) que quedan en el mes, contando hoy.
    pub workdays_left: i64,
    pub per_workday_minor: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct DigestPreview {
    pub settings: DigestSettings,
    pub last: DigestState,
    pub mail_ready: bool,
    pub to: String,
    pub subject: String,
    pub body: String,
    pub goal: Option<GoalProgress>,
}

/// Días de lunes a viernes entre `from` y el fin de su mes (ambos incluidos). Sin feriados.
pub fn workdays_left(from: &str) -> i64 {
    let Some(start) = date_ord(from) else {
        return 0;
    };
    let month = &from[..7];
    let mut n = 0;
    let mut d = start;
    loop {
        let s = date_str(d);
        if &s[..7] != month {
            break;
        }
        // El día juliano 0 fue lunes: resto 0..=4 son días de semana.
        if d.rem_euclid(7) < 5 {
            n += 1;
        }
        d += 1;
    }
    n
}

fn weekday_of(iso: &str) -> usize {
    date_ord(iso).map(|d| d.rem_euclid(7) as usize).unwrap_or(0)
}

fn dmy(d: &str) -> String {
    if d.len() >= 10 {
        format!("{}-{}-{}", &d[8..10], &d[5..7], &d[..4])
    } else {
        d.to_string()
    }
}

fn pct(ppm: i64) -> String {
    format!("{} %", (ppm as f64 / 10_000.0).round() as i64)
}

impl CompanySession {
    fn digest_settings_raw(&self) -> AppResult<DigestSettings> {
        Ok(dbcore::get_setting(self.db.conn(), SETTING)?
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default())
    }

    fn digest_state(&self) -> AppResult<DigestState> {
        Ok(dbcore::get_setting(self.db.conn(), STATE)?
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default())
    }

    /// Guarda los días, la hora, el destinatario y la meta. Solo la persona.
    pub fn digest_save_settings(&mut self, v: &DigestSettings) -> AppResult<DigestSettings> {
        let user = self.require("config.editar")?.username.clone();
        if self.via_agent {
            return Err(AppError::Validation(
                "el informe por correo lo programa la persona en Configuración → Informe por correo"
                    .into(),
            ));
        }
        let weekdays = clean_weekdays(&v.weekdays)?;
        if v.enabled && weekdays.is_empty() {
            return Err(AppError::Validation(
                "elige al menos un día para el informe".into(),
            ));
        }
        if v.hour > 23 {
            return Err(AppError::Validation("la hora va de 0 a 23".into()));
        }
        let to = v.to.trim().to_lowercase();
        let addrs = crate::mail_ops::split_addrs(&to);
        if addrs.len() > 5 || addrs.iter().any(|a| a.parse::<lettre::Address>().is_err()) {
            return Err(AppError::Validation(
                "el destinatario del informe no es una dirección válida (hasta 5, separadas por coma)"
                    .into(),
            ));
        }
        if !(0..=1_000_000_000_000).contains(&v.goal_minor) {
            return Err(AppError::Validation("la meta no es válida".into()));
        }
        let clean = DigestSettings {
            enabled: v.enabled,
            weekdays,
            hour: v.hour,
            to: addrs.join(", "),
            goal_minor: v.goal_minor,
        };
        dbcore::set_setting(self.db.conn(), SETTING, &json!(clean))?;
        log(
            self.db.conn(),
            &user,
            "update",
            "informe",
            "correo",
            if clean.enabled {
                "Programó el informe por correo"
            } else {
                "Cambió los ajustes del informe por correo (sin programar)"
            },
            None,
        )?;
        Ok(clean)
    }

    /// Avance del mes contra la meta (None si no hay meta).
    pub fn sales_goal(&self) -> AppResult<Option<GoalProgress>> {
        self.require("ventas.ver")?;
        let cfg = self.digest_settings_raw()?;
        if cfg.goal_minor <= 0 {
            return Ok(None);
        }
        let conn = self.db.conn();
        let today = local_today(conn)?;
        let sold: i64 = conn.query_row(
            "SELECT coalesce(sum(total_minor), 0) FROM sales
             WHERE commercial_state IN ('efectuada', 'cerrada') AND issue_date >= ?1",
            [format!("{}-01", &today[..7])],
            |r| r.get(0),
        )?;
        let remaining = (cfg.goal_minor - sold).max(0);
        let left = workdays_left(&today);
        Ok(Some(GoalProgress {
            goal_minor: cfg.goal_minor,
            sold_minor: sold,
            remaining_minor: remaining,
            progress_ppm: sold.saturating_mul(1_000_000) / cfg.goal_minor,
            workdays_left: left,
            per_workday_minor: if left > 0 {
                remaining / left
            } else {
                remaining
            },
        }))
    }

    /// El informe tal como saldría ahora, con los ajustes.
    pub fn digest_preview(&self) -> AppResult<DigestPreview> {
        self.require("ventas.ver")?;
        self.require("dinero.ver")?;
        let conn = self.db.conn();
        let cfg = self.digest_settings_raw()?;
        let today = local_today(conn)?;
        let t = date_ord(&today).unwrap_or(0);
        let yesterday = date_str(t - 1);
        let week_start = date_str(t - 7);
        let d = self.dashboard()?;
        let b = self.business()?;
        let range = |from: &str, to: &str| -> AppResult<(i64, i64)> {
            Ok(conn.query_row(
                "SELECT coalesce(sum(total_minor), 0), count(*) FROM sales
                 WHERE commercial_state IN ('efectuada', 'cerrada') AND issue_date BETWEEN ?1 AND ?2",
                [from, to],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )?)
        };
        let (y_total, y_count) = range(&yesterday, &yesterday)?;
        let (w_total, w_count) = range(&week_start, &yesterday)?;
        let goal = self.sales_goal()?;
        let ventas = |n: i64| if n == 1 { "venta" } else { "ventas" };

        let mut out: Vec<String> = Vec::new();
        out.push(format!(
            "Informe de {} — {} {}",
            b.name,
            DAYS[weekday_of(&today)],
            dmy(&today)
        ));
        out.push(String::new());
        out.push("VENTAS".into());
        out.push(format!(
            "Hoy, hasta ahora: {} en {} {}",
            money(d.today_sales_minor),
            d.today_sales_count,
            ventas(d.today_sales_count)
        ));
        out.push(format!(
            "Ayer ({}): {} en {} {}",
            dmy(&yesterday),
            money(y_total),
            y_count,
            ventas(y_count)
        ));
        out.push(format!(
            "Últimos 7 días: {} en {} {}",
            money(w_total),
            w_count,
            ventas(w_count)
        ));
        out.push(format!(
            "Este mes: {} (el mes anterior, a la misma fecha: {})",
            money(d.month_sales_minor),
            money(d.month_prev_same_minor)
        ));
        if let Some(g) = &goal {
            out.push(if g.remaining_minor == 0 {
                format!(
                    "Meta del mes: {} · cumplida ({})",
                    money(g.goal_minor),
                    pct(g.progress_ppm)
                )
            } else {
                format!(
                    "Meta del mes: {} · llevas {} · faltan {} ({} por día hábil; quedan {})",
                    money(g.goal_minor),
                    pct(g.progress_ppm),
                    money(g.remaining_minor),
                    money(g.per_workday_minor),
                    g.workdays_left
                )
            });
        }
        out.push(String::new());
        out.push("RESULTADO DEL MES".into());
        out.push(format!(
            "Compras: {} · Gastos: {}",
            money(d.month_purchases_minor),
            money(d.month_expenses_minor)
        ));
        if self.can("costos.ver") {
            out.push(format!(
                "Utilidad estimada: {}{}",
                money(d.month_profit_minor),
                d.month_margin_ppm
                    .map(|m| format!(" · margen bruto {}", pct(m)))
                    .unwrap_or_default()
            ));
        }
        out.push(String::new());
        out.push("DINERO".into());
        out.push(format!("Disponible: {}", money(d.cash_minor)));
        out.push(format!(
            "Te deben: {}{}",
            money(d.receivable_minor),
            if d.receivable_overdue_minor > 0 {
                format!(" (atrasado: {})", money(d.receivable_overdue_minor))
            } else {
                String::new()
            }
        ));
        out.push(format!("Debes: {}", money(d.payable_minor)));
        if let Some(tax) = d.tax_estimate_minor {
            out.push(format!("IVA estimado del mes: {}", money(tax)));
        }
        if !d.upcoming_payments.is_empty() {
            out.push(String::new());
            out.push("PRÓXIMOS VENCIMIENTOS".into());
            for u in &d.upcoming_payments {
                out.push(format!(
                    "- {} · {} · {} · {}",
                    dmy(&u.date),
                    if u.kind == "cobro" {
                        "te pagan"
                    } else {
                        "pagas"
                    },
                    u.label,
                    money(u.amount_minor)
                ));
            }
        }
        if !d.alerts.is_empty() {
            out.push(String::new());
            out.push("REQUIERE TU ATENCIÓN".into());
            for a in &d.alerts {
                out.push(format!("- {}: {}", a.title, a.detail));
            }
        }
        if !d.low_stock.is_empty() {
            out.push(String::new());
            out.push("POCO STOCK".into());
            for p in d.low_stock.iter().take(12) {
                out.push(format!(
                    "- {}: quedan {} (mínimo {})",
                    p.name,
                    p.on_hand_milli / 1000,
                    p.min_milli / 1000
                ));
            }
        }
        if d.pending_documentation > 0 {
            out.push(String::new());
            out.push(format!(
                "Ventas sin boleta o factura: {}",
                d.pending_documentation
            ));
        }
        out.push(String::new());
        out.push("—".into());
        out.push("Enviado por NÚCLEO desde tu computador. Para cambiar los días o dejar de recibirlo: Configuración → Informe por correo.".into());

        let from = self.mail_from()?;
        let (mail_ready, _) = self.mail_config_public()?;
        Ok(DigestPreview {
            to: if cfg.to.is_empty() {
                from
            } else {
                cfg.to.clone()
            },
            subject: format!(
                "Informe de {} — {} · ventas del mes {}",
                b.name,
                dmy(&today),
                money(d.month_sales_minor)
            ),
            body: out.join("\n"),
            mail_ready,
            last: self.digest_state()?,
            settings: cfg,
            goal,
        })
    }

    /// ¿Toca enviar el informe ahora?
    pub(crate) fn digest_due(&self) -> AppResult<bool> {
        let cfg = self.digest_settings_raw()?;
        if !cfg.enabled {
            return Ok(false);
        }
        let conn = self.db.conn();
        let (weekday, hour) = local_clock(conn)?;
        Ok(due_at(
            &cfg.weekdays,
            cfg.hour,
            self.digest_state()?.last_run_date.as_deref(),
            &local_today(conn)?,
            weekday,
            hour,
        ))
    }

    /// El informe listo para salir por la casilla de la empresa.
    pub fn digest_plan(&self) -> AppResult<OutgoingMail> {
        let p = self.digest_preview()?;
        self.mail_plan(&MailDraft {
            kind: "informe".into(),
            to: p.to,
            subject: p.subject,
            body: p.body,
            ..Default::default()
        })
    }

    /// Anota el resultado del envío programado (para no repetirlo el mismo día).
    pub fn digest_finish(&mut self, result: &Result<(), String>) -> AppResult<DigestState> {
        let conn = self.db.conn();
        let st = DigestState {
            last_run_date: Some(local_today(conn)?),
            last_run_at: Some(now_utc()),
            last_ok: result.is_ok(),
            last_error: result.as_ref().err().cloned(),
        };
        dbcore::set_setting(conn, STATE, &json!(st))?;
        Ok(st)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dias_habiles_que_quedan() {
        // Noviembre de 2026: el 26 es jueves; quedan jueves 26, viernes 27 y lunes 30.
        assert_eq!(weekday_of("2026-11-26"), 3);
        assert_eq!(workdays_left("2026-11-26"), 3);
        assert_eq!(workdays_left("2026-11-28"), 1);
        assert_eq!(workdays_left("2026-11-02"), 21);
        assert_eq!(pct(604_000), "60 %");
    }
}
