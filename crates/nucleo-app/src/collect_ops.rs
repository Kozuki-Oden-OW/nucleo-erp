//! Cobranza por correo: la **ronda** junta a los clientes con documentos vencidos (o por vencer),
//! primero lo más atrasado, y a cada uno le va un solo recordatorio con todo lo que debe, los datos
//! de transferencia y el enlace de pago con tarjeta del negocio.
//!
//! La ronda se puede enviar a mano (la persona, o Claude con el permiso de correo) o dejar
//! **programada**: ciertos días a cierta hora, mientras NÚCLEO está abierto. Programada tiene dos
//! modos: «avisar» (NÚCLEO la deja lista y avisa) o «enviar» (salen solos). No se le escribe dos veces
//! al mismo cliente antes de los días de espera, y hay clientes que el dueño puede dejar fuera.
//! Programar, cambiar el modo o excluir clientes lo hace la persona, nunca Claude.

use crate::company::CompanySession;
use crate::inventory_ops::date_ord;
use crate::mail_ops::OutgoingMail;
use crate::sales_ops::{local_today, log};
use crate::{AppError, AppResult};
use nucleo_db::core as dbcore;
use nucleo_db::now_utc;
use serde::{Deserialize, Serialize};
use serde_json::json;

const SETTING: &str = "cobranza";
const STATE: &str = "cobranza.estado";
pub const MODES: [&str; 2] = ["avisar", "enviar"];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct CollectSettings {
    /// Ronda programada.
    pub enabled: bool,
    /// "avisar": queda lista y NÚCLEO avisa. "enviar": los recordatorios salen solos.
    pub mode: String,
    /// Días de la ronda: 1 = lunes … 7 = domingo.
    pub weekdays: Vec<u8>,
    /// Desde qué hora (0–23, hora del computador).
    pub hour: u8,
    /// Días de atraso desde los que se cobra un documento.
    pub min_days: i64,
    /// Avisar también esta cantidad de días **antes** del vencimiento (0 = solo lo vencido).
    pub before_days: i64,
    /// Días de espera antes de volver a escribirle al mismo cliente.
    pub repeat_days: i64,
    /// Tope de correos por ronda.
    pub max_per_run: i64,
    /// Clientes a los que no se les envía recordatorio (uid).
    pub excluded: Vec<String>,
}

impl Default for CollectSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            mode: "avisar".into(),
            weekdays: vec![1, 4],
            hour: 10,
            min_days: 1,
            before_days: 0,
            repeat_days: 7,
            max_per_run: 20,
            excluded: Vec::new(),
        }
    }
}

/// Cómo terminó la última ronda.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct CollectState {
    /// Día (local) de la última ronda programada: evita repetirla el mismo día.
    pub last_run_date: Option<String>,
    pub last_run_at: Option<String>,
    pub last_sent: i64,
    pub last_failed: i64,
    /// "programada", "manual" o "aviso".
    pub last_kind: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct CollectDoc {
    pub number: String,
    pub sale_uid: String,
    pub due_date: String,
    pub pending_minor: i64,
    /// Días de atraso (negativo: faltan días para el vencimiento).
    pub days_late: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct CollectItem {
    pub customer_uid: String,
    pub customer_name: String,
    pub email: Option<String>,
    pub docs: Vec<CollectDoc>,
    pub total_minor: i64,
    pub overdue_minor: i64,
    pub max_days_late: i64,
    pub last_reminder_at: Option<String>,
    /// "listo", "sin_correo", "reciente" (ya se le escribió hace poco) o "excluido".
    pub state: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct CollectRound {
    pub today: String,
    pub mail_ready: bool,
    pub agent_send: bool,
    pub settings: CollectSettings,
    pub last: CollectState,
    pub items: Vec<CollectItem>,
    /// Clientes a los que hoy les saldría el recordatorio.
    pub ready: i64,
    pub total_minor: i64,
    pub overdue_minor: i64,
    /// La ronda programada toca hoy y aún no se hace.
    pub due_now: bool,
}

/// Lo que devuelve una ronda terminada.
#[derive(Debug, Clone, Serialize)]
pub struct CollectResult {
    pub sent: i64,
    pub failed: i64,
    pub errors: Vec<String>,
}

/// ¿Toca la ronda programada? (función pura, para probar sin reloj).
pub fn due_at(
    weekdays: &[u8],
    hour: u8,
    last_run_date: Option<&str>,
    today: &str,
    weekday: u8,
    now_hour: u8,
) -> bool {
    weekdays.contains(&weekday) && now_hour >= hour && last_run_date != Some(today)
}

/// Día de la semana (1 = lunes … 7 = domingo) y hora del computador.
pub(crate) fn local_clock(conn: &rusqlite::Connection) -> AppResult<(u8, u8)> {
    let (w, h): (String, String) = conn.query_row(
        "SELECT strftime('%w', 'now', 'localtime'), strftime('%H', 'now', 'localtime')",
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let w: u8 = w.parse().unwrap_or(0);
    Ok((if w == 0 { 7 } else { w }, h.parse().unwrap_or(0)))
}

pub(crate) fn clean_weekdays(days: &[u8]) -> AppResult<Vec<u8>> {
    let mut d: Vec<u8> = days.to_vec();
    d.sort_unstable();
    d.dedup();
    if d.iter().any(|x| !(1..=7).contains(x)) {
        return Err(AppError::Validation(
            "los días van de 1 (lunes) a 7 (domingo)".into(),
        ));
    }
    Ok(d)
}

impl CompanySession {
    pub(crate) fn collect_settings_raw(&self) -> AppResult<CollectSettings> {
        Ok(dbcore::get_setting(self.db.conn(), SETTING)?
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default())
    }

    fn collect_state(&self) -> AppResult<CollectState> {
        Ok(dbcore::get_setting(self.db.conn(), STATE)?
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default())
    }

    pub fn collect_settings(&self) -> AppResult<CollectSettings> {
        self.require("dinero.ver")?;
        self.collect_settings_raw()
    }

    /// Guarda cómo funciona la ronda. Solo la persona: Claude no programa envíos ni excluye clientes.
    pub fn collect_save_settings(&mut self, v: &CollectSettings) -> AppResult<CollectSettings> {
        let user = self.require("config.editar")?.username.clone();
        if self.via_agent {
            return Err(AppError::Validation(
                "la ronda de cobranza la programa la persona en Dinero → Cobranza".into(),
            ));
        }
        if !MODES.contains(&v.mode.as_str()) {
            return Err(AppError::Validation("modo: avisar o enviar".into()));
        }
        let weekdays = clean_weekdays(&v.weekdays)?;
        if v.enabled && weekdays.is_empty() {
            return Err(AppError::Validation(
                "elige al menos un día para la ronda programada".into(),
            ));
        }
        if v.hour > 23 {
            return Err(AppError::Validation("la hora va de 0 a 23".into()));
        }
        for (what, n, max) in [
            ("los días de atraso", v.min_days, 365),
            ("los días de anticipación", v.before_days, 60),
            ("los días de espera", v.repeat_days, 365),
        ] {
            if !(0..=max).contains(&n) {
                return Err(AppError::Validation(format!("{what}: entre 0 y {max}")));
            }
        }
        if !(1..=200).contains(&v.max_per_run) {
            return Err(AppError::Validation(
                "el tope de correos por ronda va de 1 a 200".into(),
            ));
        }
        let mut excluded = Vec::new();
        for uid in &v.excluded {
            if nucleo_db::customers::by_uid(self.db.conn(), uid)?.is_some()
                && !excluded.contains(uid)
            {
                excluded.push(uid.clone());
            }
        }
        let clean = CollectSettings {
            enabled: v.enabled,
            mode: v.mode.clone(),
            weekdays,
            hour: v.hour,
            min_days: v.min_days,
            before_days: v.before_days,
            repeat_days: v.repeat_days,
            max_per_run: v.max_per_run,
            excluded,
        };
        dbcore::set_setting(
            self.db.conn(),
            SETTING,
            &serde_json::to_value(&clean).map_err(|e| AppError::Validation(e.to_string()))?,
        )?;
        log(
            self.db.conn(),
            &user,
            "update",
            "cobranza",
            "ronda",
            &if clean.enabled {
                format!(
                    "Programó la ronda de cobranza ({})",
                    if clean.mode == "enviar" {
                        "envío automático"
                    } else {
                        "preparar y avisar"
                    }
                )
            } else {
                "Cambió los ajustes de cobranza (ronda sin programar)".into()
            },
            None,
        )?;
        Ok(clean)
    }

    /// La ronda de hoy: quién debe, cuánto, desde cuándo y si le saldría el recordatorio.
    pub fn collect_round(&self) -> AppResult<CollectRound> {
        self.require("dinero.ver")?;
        let conn = self.db.conn();
        let cfg = self.collect_settings_raw()?;
        let last = self.collect_state()?;
        let today = local_today(conn)?;
        let t = date_ord(&today).unwrap_or(0);
        let mail = self.mail_config_public()?;

        let mut st = conn.prepare(
            "SELECT c.id, c.uid, c.name, c.email, s.number, s.uid, r.due_date, r.amount_minor - r.paid_minor
             FROM receivables r JOIN sales s ON s.id = r.sale_id JOIN customers c ON c.id = s.customer_id
             WHERE r.status = 'abierta' AND r.amount_minor > r.paid_minor
             ORDER BY c.id, r.due_date, r.id",
        )?;
        type Row = (
            i64,
            String,
            String,
            Option<String>,
            String,
            String,
            String,
            i64,
        );
        let rows: Vec<Row> = st
            .query_map([], |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                    r.get(7)?,
                ))
            })?
            .collect::<Result<_, _>>()?;

        let mut items: Vec<(i64, CollectItem)> = Vec::new();
        for (cid, cuid, name, email, number, suid, due, pending) in rows {
            let days_late = t - date_ord(&due).unwrap_or(t);
            let doc = CollectDoc {
                number,
                sale_uid: suid,
                due_date: due,
                pending_minor: pending,
                days_late,
            };
            if items.last().is_none_or(|(id, _)| *id != cid) {
                items.push((
                    cid,
                    CollectItem {
                        customer_uid: cuid,
                        customer_name: name,
                        email: email.filter(|e| !e.trim().is_empty()),
                        docs: Vec::new(),
                        total_minor: 0,
                        overdue_minor: 0,
                        max_days_late: i64::MIN,
                        last_reminder_at: None,
                        state: String::new(),
                    },
                ));
            }
            let it = &mut items.last_mut().expect("recién agregado").1;
            it.total_minor += pending;
            if days_late > 0 {
                it.overdue_minor += pending;
            }
            it.max_days_late = it.max_days_late.max(days_late);
            it.docs.push(doc);
        }

        // Entra a la ronda quien tiene algo con el atraso mínimo, o por vencer dentro del aviso previo.
        let qualifies = |d: &CollectDoc| {
            d.days_late >= cfg.min_days.max(1)
                || (cfg.before_days > 0 && d.days_late <= 0 && -d.days_late <= cfg.before_days)
        };
        let mut out = Vec::new();
        for (cid, mut it) in items {
            if !it.docs.iter().any(qualifies) {
                continue;
            }
            let last_sent: Option<String> = conn.query_row(
                "SELECT max(sent_at) FROM email_log WHERE kind = 'cobro' AND status = 'enviado' AND customer_id = ?1",
                [cid],
                |r| r.get(0),
            )?;
            let recent = last_sent
                .as_deref()
                .and_then(|s| date_ord(s.get(..10).unwrap_or("")))
                .is_some_and(|d| t - d < cfg.repeat_days);
            it.state = if cfg.excluded.contains(&it.customer_uid) {
                "excluido"
            } else if it.email.is_none() {
                "sin_correo"
            } else if recent {
                "reciente"
            } else {
                "listo"
            }
            .into();
            it.last_reminder_at = last_sent;
            out.push(it);
        }
        // Primero lo más vencido; a igual atraso, el monto vencido mayor.
        out.sort_by(|a, b| {
            b.max_days_late
                .cmp(&a.max_days_late)
                .then(b.overdue_minor.cmp(&a.overdue_minor))
                .then(a.customer_name.cmp(&b.customer_name))
        });
        let (weekday, hour) = local_clock(conn)?;
        Ok(CollectRound {
            due_now: cfg.enabled
                && due_at(
                    &cfg.weekdays,
                    cfg.hour,
                    last.last_run_date.as_deref(),
                    &today,
                    weekday,
                    hour,
                ),
            ready: out.iter().filter(|i| i.state == "listo").count() as i64,
            total_minor: out.iter().map(|i| i.total_minor).sum(),
            overdue_minor: out.iter().map(|i| i.overdue_minor).sum(),
            today,
            mail_ready: mail.0,
            agent_send: mail.1,
            settings: cfg,
            last,
            items: out,
        })
    }

    /// Arma los correos de la ronda. Sin lista: todos los «listos», hasta el tope. Con lista: esos
    /// clientes (sirve para insistir a uno que ya recibió un recordatorio hace poco); nunca un excluido.
    pub fn collect_plan(&self, customer_uids: Option<&[String]>) -> AppResult<Vec<OutgoingMail>> {
        let round = self.collect_round()?;
        if !round.mail_ready {
            return Err(AppError::Validation("configura primero el correo de la empresa (Configuración → Integraciones → Correo)".into()));
        }
        let chosen: Vec<&CollectItem> = match customer_uids {
            None => round
                .items
                .iter()
                .filter(|i| i.state == "listo")
                .take(round.settings.max_per_run as usize)
                .collect(),
            Some(uids) => {
                let mut v = Vec::new();
                for u in uids {
                    let it = round
                        .items
                        .iter()
                        .find(|i| &i.customer_uid == u)
                        .ok_or_else(|| {
                            AppError::Validation(
                                "ese cliente no está en la ronda de cobranza de hoy".into(),
                            )
                        })?;
                    match it.state.as_str() {
                        "excluido" => {
                            return Err(AppError::Validation(format!(
                                "{} está marcado como «no enviar recordatorios»",
                                it.customer_name
                            )));
                        }
                        "sin_correo" => {
                            return Err(AppError::Validation(format!(
                                "{} no tiene correo en su ficha",
                                it.customer_name
                            )));
                        }
                        _ => v.push(it),
                    }
                }
                v
            }
        };
        let mut mails = Vec::new();
        for it in chosen {
            let draft = self.mail_draft_collection(&it.customer_uid)?;
            mails.push(self.mail_plan(&draft)?);
        }
        Ok(mails)
    }

    /// Deja anotado cómo terminó la ronda (los correos ya quedaron uno por uno en el registro).
    pub fn collect_finish(
        &mut self,
        kind: &str,
        sent: i64,
        failed: i64,
    ) -> AppResult<CollectState> {
        let user = self.actor_name()?;
        let conn = self.db.conn();
        let mut st = self.collect_state()?;
        if kind != "manual" {
            st.last_run_date = Some(local_today(conn)?);
        }
        st.last_run_at = Some(now_utc());
        st.last_sent = sent;
        st.last_failed = failed;
        st.last_kind = kind.into();
        dbcore::set_setting(conn, STATE, &json!(st))?;
        if sent + failed > 0 {
            log(
                conn,
                &user,
                "create",
                "cobranza",
                "ronda",
                &format!(
                    "Ronda de cobranza {kind}: {sent} recordatorio(s) enviados{}",
                    if failed > 0 {
                        format!(", {failed} sin salir")
                    } else {
                        String::new()
                    }
                ),
                None,
            )?;
        }
        Ok(st)
    }
}
