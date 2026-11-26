//! Cobros recurrentes: una venta que se repite sola (mensual, trimestral, anual…), como el monitoreo
//! por suscripción.
//!
//! Cada vez que toca, NÚCLEO crea la venta con las líneas guardadas, la deja **por cobrar** con su
//! vencimiento y, si el dueño lo pidió, le envía al cliente el aviso de cobro con el detalle y los
//! datos de pago. Si NÚCLEO estuvo cerrado el día que tocaba, el cobro se genera al abrirlo (uno por
//! cada período pendiente, con un tope). La boleta o factura la emite la persona: emitir ante el SII
//! es irreversible y se confirma documento por documento.
//!
//! Crear, cambiar, pausar o eliminar un cobro recurrente lo hace la persona, nunca Claude.

use crate::company::CompanySession;
use crate::insight_ops::money;
use crate::inventory_ops::{date_ord, date_str};
use crate::mail_ops::{MailDraft, OutgoingMail};
use crate::sales_ops::{
    EffectInput, LineInput, SaleDetail, SaleInput, local_today, log, opt_text, parse_date,
};
use crate::{AppError, AppResult};
use nucleo_db::customers;
use nucleo_db::now_utc;
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};

pub const FREQUENCIES: [(&str, u8); 5] = [
    ("mensual", 1),
    ("bimestral", 2),
    ("trimestral", 3),
    ("semestral", 6),
    ("anual", 12),
];
/// Períodos atrasados que se generan de una vez por cobro (si NÚCLEO estuvo cerrado mucho tiempo).
const MAX_CATCH_UP: usize = 6;
const MONTHS: [&str; 12] = [
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
];

#[derive(Debug, Clone, Deserialize)]
pub struct RecurringSaleInput {
    pub name: String,
    pub customer_uid: String,
    pub lines: Vec<LineInput>,
    #[serde(default)]
    pub notes: Option<String>,
    pub frequency: String,
    /// Fecha del próximo cobro.
    pub next_date: String,
    #[serde(default)]
    pub end_date: Option<String>,
    /// Días de plazo para pagar (0 = vence el mismo día).
    #[serde(default)]
    pub credit_days: i64,
    /// true: la venta queda efectuada y por cobrar. false: queda en borrador para revisarla.
    #[serde(default = "yes")]
    pub confirm: bool,
    /// Enviar el aviso de cobro al cliente por correo.
    #[serde(default = "yes")]
    pub send_mail: bool,
    #[serde(default = "yes")]
    pub active: bool,
}

fn yes() -> bool {
    true
}

#[derive(Debug, Clone, Serialize)]
pub struct RecurringSale {
    pub uid: String,
    pub name: String,
    pub customer_uid: String,
    pub customer_name: String,
    pub customer_email: Option<String>,
    pub lines: Vec<LineInput>,
    pub notes: Option<String>,
    pub frequency: String,
    pub next_date: String,
    pub end_date: Option<String>,
    pub credit_days: i64,
    pub confirm: bool,
    pub send_mail: bool,
    pub active: bool,
    pub last_run_date: Option<String>,
    pub last_sale_uid: Option<String>,
    pub last_sale_number: Option<String>,
    pub runs: i64,
    /// Total de cada cobro con los precios guardados (None si alguna línea ya no es válida).
    pub total_minor: Option<i64>,
    /// Toca generarlo (la fecha llegó y está activo).
    pub due_now: bool,
}

/// Lo que generó una pasada.
#[derive(Debug, Clone, Default)]
pub struct RecurringRun {
    pub created: i64,
    pub sales: Vec<String>,
    pub mails: Vec<OutgoingMail>,
    pub skipped: Vec<String>,
}

/// Suma meses manteniendo el día de cobro (31 → último día en meses más cortos).
pub fn add_months(date: &str, months: u8, anchor_day: u8) -> String {
    let (y, m): (i32, i32) = (
        date.get(..4).and_then(|s| s.parse().ok()).unwrap_or(2000),
        date.get(5..7).and_then(|s| s.parse().ok()).unwrap_or(1),
    );
    let total = y * 12 + (m - 1) + months as i32;
    let (ny, nm) = (total.div_euclid(12), total.rem_euclid(12) + 1);
    let month = time::Month::try_from(nm as u8).unwrap_or(time::Month::January);
    let last = month.length(ny);
    format!("{ny:04}-{nm:02}-{:02}", anchor_day.clamp(1, last))
}

/// «2026-11-05» → «noviembre de 2026».
pub fn period_label(date: &str) -> String {
    let m: usize = date.get(5..7).and_then(|s| s.parse().ok()).unwrap_or(1);
    format!(
        "{} de {}",
        MONTHS[(m.clamp(1, 12)) - 1],
        date.get(..4).unwrap_or("")
    )
}

fn months_of(freq: &str) -> AppResult<u8> {
    FREQUENCIES
        .iter()
        .find(|(k, _)| *k == freq)
        .map(|(_, n)| *n)
        .ok_or_else(|| {
            AppError::Validation(
                "frecuencia: mensual, bimestral, trimestral, semestral o anual".into(),
            )
        })
}

fn dmy(d: &str) -> String {
    if d.len() >= 10 {
        format!("{}-{}-{}", &d[8..10], &d[5..7], &d[..4])
    } else {
        d.to_string()
    }
}

struct Row {
    id: i64,
    uid: String,
    name: String,
    customer_id: i64,
    lines_json: String,
    notes: Option<String>,
    frequency: String,
    anchor_day: u8,
    next_date: String,
    end_date: Option<String>,
    credit_days: i64,
    confirm: bool,
    send_mail: bool,
    active: bool,
    last_run_date: Option<String>,
    last_sale_id: Option<i64>,
    runs: i64,
}

const COLS: &str = "id, uid, name, customer_id, lines_json, notes, frequency, anchor_day, next_date, end_date, credit_days, confirm, send_mail, active, last_run_date, last_sale_id, runs";

fn read(r: &rusqlite::Row<'_>) -> rusqlite::Result<Row> {
    Ok(Row {
        id: r.get(0)?,
        uid: r.get(1)?,
        name: r.get(2)?,
        customer_id: r.get(3)?,
        lines_json: r.get(4)?,
        notes: r.get(5)?,
        frequency: r.get(6)?,
        anchor_day: r.get(7)?,
        next_date: r.get(8)?,
        end_date: r.get(9)?,
        credit_days: r.get(10)?,
        confirm: r.get(11)?,
        send_mail: r.get(12)?,
        active: r.get(13)?,
        last_run_date: r.get(14)?,
        last_sale_id: r.get(15)?,
        runs: r.get(16)?,
    })
}

impl CompanySession {
    fn recurring_rows(&self, filter: &str, p: impl rusqlite::Params) -> AppResult<Vec<Row>> {
        let mut st = self.db.conn().prepare(&format!(
            "SELECT {COLS} FROM recurring_sales {filter} ORDER BY active DESC, next_date, id"
        ))?;
        Ok(st.query_map(p, read)?.collect::<Result<_, _>>()?)
    }

    fn recurring_view(&self, r: Row, today: &str) -> AppResult<RecurringSale> {
        let conn = self.db.conn();
        let (customer_uid, customer_name, customer_email): (String, String, Option<String>) = conn
            .query_row(
                "SELECT uid, name, email FROM customers WHERE id = ?1",
                [r.customer_id],
                |x| Ok((x.get(0)?, x.get(1)?, x.get(2)?)),
            )?;
        let last: Option<(String, String)> = match r.last_sale_id {
            Some(id) => conn
                .query_row("SELECT uid, number FROM sales WHERE id = ?1", [id], |x| {
                    Ok((x.get(0)?, x.get(1)?))
                })
                .optional()?,
            None => None,
        };
        let lines: Vec<LineInput> = serde_json::from_str(&r.lines_json).unwrap_or_default();
        let total_minor = self.lines_totals(&lines).ok().map(|t| t.total_minor);
        Ok(RecurringSale {
            due_now: r.active && r.next_date.as_str() <= today,
            uid: r.uid,
            name: r.name,
            customer_uid,
            customer_name,
            customer_email: customer_email.filter(|e| !e.trim().is_empty()),
            lines,
            notes: r.notes,
            frequency: r.frequency,
            next_date: r.next_date,
            end_date: r.end_date,
            credit_days: r.credit_days,
            confirm: r.confirm,
            send_mail: r.send_mail,
            active: r.active,
            last_run_date: r.last_run_date,
            last_sale_uid: last.as_ref().map(|l| l.0.clone()),
            last_sale_number: last.map(|l| l.1),
            runs: r.runs,
            total_minor,
        })
    }

    pub fn recurring_sales(&self) -> AppResult<Vec<RecurringSale>> {
        self.require("ventas.ver")?;
        let today = local_today(self.db.conn())?;
        self.recurring_rows("", [])?
            .into_iter()
            .map(|r| self.recurring_view(r, &today))
            .collect()
    }

    fn recurring_guard(&self) -> AppResult<String> {
        let user = self.require("ventas.crear")?.username.clone();
        if self.via_agent {
            return Err(AppError::Validation(
                "los cobros recurrentes los crea y cambia la persona en Ventas → Cobros recurrentes"
                    .into(),
            ));
        }
        Ok(user)
    }

    /// Crea (sin `uid`) o cambia un cobro recurrente.
    pub fn save_recurring_sale(
        &mut self,
        input: &RecurringSaleInput,
        uid: Option<&str>,
    ) -> AppResult<RecurringSale> {
        let user = self.recurring_guard()?;
        let name = input.name.trim();
        if name.is_empty() || name.chars().count() > 120 {
            return Err(AppError::Validation(
                "ponle un nombre al cobro (hasta 120 caracteres), por ejemplo «Monitoreo mensual»"
                    .into(),
            ));
        }
        let customer = customers::by_uid(self.db.conn(), &input.customer_uid)?
            .ok_or_else(|| AppError::Validation("elige el cliente al que se le cobra".into()))?;
        months_of(&input.frequency)?;
        let next = parse_date("la fecha del próximo cobro", &input.next_date)?;
        let end = match input.end_date.as_deref().filter(|d| !d.trim().is_empty()) {
            Some(d) => Some(parse_date("la fecha de término", d)?),
            None => None,
        };
        if end.as_deref().is_some_and(|e| e < next.as_str()) {
            return Err(AppError::Validation(
                "la fecha de término es anterior al próximo cobro".into(),
            ));
        }
        if !(0..=365).contains(&input.credit_days) {
            return Err(AppError::Validation(
                "los días de plazo van de 0 a 365".into(),
            ));
        }
        let notes = opt_text(&input.notes, 1000, "las notas")?;
        self.lines_totals(&input.lines)?;
        let lines_json =
            serde_json::to_string(&input.lines).map_err(|e| AppError::Validation(e.to_string()))?;
        let anchor: u8 = next[8..10].parse().unwrap_or(1);
        let now = now_utc();
        let user_id = self.user_id();
        let conn = self.db.conn();
        let out_uid = match uid {
            Some(u) => {
                let n = conn.execute(
                    "UPDATE recurring_sales SET name = ?2, customer_id = ?3, lines_json = ?4, notes = ?5, frequency = ?6,
                        anchor_day = ?7, next_date = ?8, end_date = ?9, credit_days = ?10, confirm = ?11, send_mail = ?12,
                        active = ?13, updated_at = ?14 WHERE uid = ?1",
                    params![u, name, customer.id, lines_json, notes, input.frequency, anchor, next, end,
                        input.credit_days, input.confirm, input.send_mail, input.active, now],
                )?;
                if n == 0 {
                    return Err(AppError::NotFound("el cobro recurrente".into()));
                }
                u.to_string()
            }
            None => {
                let new_uid = uuid::Uuid::now_v7().to_string();
                conn.execute(
                    "INSERT INTO recurring_sales (uid, name, customer_id, lines_json, notes, frequency, anchor_day, next_date,
                        end_date, credit_days, confirm, send_mail, active, created_by, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15)",
                    params![new_uid, name, customer.id, lines_json, notes, input.frequency, anchor, next, end,
                        input.credit_days, input.confirm, input.send_mail, input.active, user_id, now],
                )?;
                new_uid
            }
        };
        log(
            conn,
            &user,
            if uid.is_some() { "update" } else { "create" },
            "cobro_recurrente",
            &out_uid,
            &format!(
                "{} el cobro recurrente «{name}» para {} ({}, próximo {})",
                if uid.is_some() { "Cambió" } else { "Creó" },
                customer.name,
                input.frequency,
                dmy(&next)
            ),
            None,
        )?;
        self.recurring_one(&out_uid)
    }

    fn recurring_one(&self, uid: &str) -> AppResult<RecurringSale> {
        let today = local_today(self.db.conn())?;
        let r = self
            .recurring_rows("WHERE uid = ?1", [uid])?
            .pop()
            .ok_or_else(|| AppError::NotFound("el cobro recurrente".into()))?;
        self.recurring_view(r, &today)
    }

    /// Elimina el cobro recurrente. Las ventas que ya generó no se tocan.
    pub fn delete_recurring_sale(&mut self, uid: &str) -> AppResult<()> {
        let user = self.recurring_guard()?;
        let r = self.recurring_one(uid)?;
        self.db
            .conn()
            .execute("DELETE FROM recurring_sales WHERE uid = ?1", [uid])?;
        log(
            self.db.conn(),
            &user,
            "delete",
            "cobro_recurrente",
            uid,
            &format!(
                "Eliminó el cobro recurrente «{}» de {}",
                r.name, r.customer_name
            ),
            None,
        )?;
        Ok(())
    }

    /// Genera el cobro de un período: la venta, su vencimiento y (si corresponde) el correo al cliente.
    fn recurring_generate(
        &mut self,
        r: &Row,
        today: &str,
        run: &mut RecurringRun,
    ) -> AppResult<()> {
        let lines: Vec<LineInput> = serde_json::from_str(&r.lines_json)
            .map_err(|_| AppError::Validation("las líneas guardadas no son válidas".into()))?;
        let customer_uid: String = self.db.conn().query_row(
            "SELECT uid FROM customers WHERE id = ?1",
            [r.customer_id],
            |x| x.get(0),
        )?;
        let period = period_label(&r.next_date);
        let note = format!(
            "{} · {period}{}",
            r.name,
            r.notes
                .as_deref()
                .map(|n| format!("\n{n}"))
                .unwrap_or_default()
        );
        let draft = self.save_sale(
            &SaleInput {
                doc_type: "VEN".into(),
                customer_uid: Some(customer_uid.clone()),
                issue_date: today.to_string(),
                lines,
                notes: Some(note),
                terms: None,
            },
            None,
        )?;
        // La fecha avanza apenas existe la venta: un problema posterior no debe duplicar el cobro.
        let months = months_of(&r.frequency)?;
        let next = add_months(&r.next_date, months, r.anchor_day);
        let still = r.end_date.as_deref().is_none_or(|e| next.as_str() <= e);
        self.db.conn().execute(
            "UPDATE recurring_sales SET next_date = ?2, active = ?3, last_run_date = ?4,
                last_sale_id = (SELECT id FROM sales WHERE uid = ?5), runs = runs + 1, updated_at = ?6 WHERE id = ?1",
            params![r.id, next, still, today, draft.summary.uid, now_utc()],
        )?;
        run.created += 1;

        let mut sale: SaleDetail = draft;
        if r.confirm {
            if !self.can("ventas.efectuar") {
                run.skipped.push(format!(
                    "{}: quedó en borrador ({}), tu usuario no puede efectuar ventas",
                    r.name, sale.summary.number
                ));
            } else {
                let due = date_str(date_ord(today).unwrap_or(0) + r.credit_days);
                match self.effect_sale(
                    &sale.summary.uid,
                    &EffectInput {
                        mode: "credito".into(),
                        method: String::new(),
                        due_date: Some(due),
                        account_uid: None,
                    },
                ) {
                    Ok(s) => sale = s,
                    Err(e) => run.skipped.push(format!(
                        "{}: quedó en borrador ({}): {e}",
                        r.name, sale.summary.number
                    )),
                }
            }
        }
        let user = self.actor_name()?;
        log(
            self.db.conn(),
            &user,
            "create",
            "cobro_recurrente",
            &r.uid,
            &format!("Generó {} por «{}» ({period})", sale.summary.number, r.name),
            None,
        )?;
        run.sales.push(sale.summary.number.clone());

        let effected = sale.summary.commercial_state != "borrador";
        if r.send_mail && effected {
            match self.recurring_mail(r, &sale, &period, &customer_uid) {
                Ok(m) => run.mails.push(m),
                Err(e) => run.skipped.push(format!(
                    "{}: la venta {} quedó por cobrar, pero el aviso no salió: {e}",
                    r.name, sale.summary.number
                )),
            }
        }
        Ok(())
    }

    fn recurring_mail(
        &self,
        r: &Row,
        sale: &SaleDetail,
        period: &str,
        customer_uid: &str,
    ) -> AppResult<OutgoingMail> {
        let c = customers::by_uid(self.db.conn(), customer_uid)?
            .ok_or_else(|| AppError::NotFound("el cliente".into()))?;
        let to = c.email.clone().unwrap_or_default();
        if to.trim().is_empty() {
            return Err(AppError::Validation(
                "el cliente no tiene correo en su ficha".into(),
            ));
        }
        let b = self.business()?;
        let empresa = b
            .legal_name
            .clone()
            .filter(|s| !s.is_empty())
            .unwrap_or(b.name.clone());
        let mut firma = vec![b.name.clone()];
        firma.extend(b.phone.clone().filter(|s| !s.is_empty()));
        firma.extend(b.email.clone().filter(|s| !s.is_empty()));
        let mut body = vec![
            format!("Hola {}:", c.name),
            String::new(),
            format!(
                "Te enviamos el cobro de {} correspondiente a {period}:",
                r.name
            ),
            String::new(),
        ];
        for l in &sale.lines {
            let qty = l.qty_milli as f64 / 1000.0;
            body.push(format!(
                "• {}{} — {}",
                l.description,
                if (qty - 1.0).abs() > f64::EPSILON {
                    format!(" × {qty}")
                } else {
                    String::new()
                },
                money(l.net_minor)
            ));
        }
        body.push(String::new());
        let t = &sale.totals;
        if t.tax_minor > 0 {
            body.push(format!(
                "Neto: {} · IVA: {}",
                money(t.net_minor + t.exempt_minor),
                money(t.tax_minor)
            ));
        }
        body.push(format!("Total a pagar: {}", money(t.total_minor)));
        body.push(format!(
            "Documento {}{}",
            sale.summary.number,
            sale.summary
                .due_date
                .as_deref()
                .map(|d| format!(" · vence el {}", dmy(d)))
                .unwrap_or_default()
        ));
        body.push(String::new());
        let pago = crate::quote_doc_ops::payment_block(self.db.conn())?;
        if !pago.is_empty() {
            body.push(pago.trim_end().to_string());
            body.push(String::new());
        }
        body.push(
            "Si ya pagaste, por favor responde este correo con el comprobante. ¡Gracias!".into(),
        );
        body.push(String::new());
        body.push("Saludos,".into());
        body.push(firma.join("\n"));
        self.mail_plan(&MailDraft {
            kind: "cobro".into(),
            to,
            subject: format!("{} — {period} · {empresa}", r.name),
            body: body.join("\n"),
            customer_uid: Some(customer_uid.to_string()),
            reference: Some(sale.summary.number.clone()),
            quote_uids: Vec::new(),
        })
    }

    /// Genera todos los cobros cuya fecha ya llegó.
    pub(crate) fn recurring_run_due(&mut self) -> AppResult<RecurringRun> {
        let today = local_today(self.db.conn())?;
        let mut run = RecurringRun::default();
        let due = self.recurring_rows("WHERE active = 1 AND next_date <= ?1", [&today])?;
        for first in due {
            let id = first.id;
            let name = first.name.clone();
            let mut row = Some(first);
            for _ in 0..MAX_CATCH_UP {
                let Some(r) = row.take() else { break };
                if !r.active || r.next_date.as_str() > today.as_str() {
                    break;
                }
                if let Err(e) = self.recurring_generate(&r, &today, &mut run) {
                    run.skipped.push(format!("{name}: no se generó ({e})"));
                    break;
                }
                row = self.recurring_rows("WHERE id = ?1", [id])?.pop();
            }
        }
        Ok(run)
    }

    /// Genera ahora el próximo cobro de uno (aunque su fecha no haya llegado). Lo pide la persona.
    pub fn recurring_run_one(&mut self, uid: &str) -> AppResult<RecurringRun> {
        self.recurring_guard()?;
        let today = local_today(self.db.conn())?;
        let r = self
            .recurring_rows("WHERE uid = ?1", [uid])?
            .pop()
            .ok_or_else(|| AppError::NotFound("el cobro recurrente".into()))?;
        let mut run = RecurringRun::default();
        self.recurring_generate(&r, &today, &mut run)?;
        Ok(run)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fechas_y_periodos() {
        assert_eq!(add_months("2026-11-05", 1, 5), "2026-12-05");
        assert_eq!(add_months("2026-12-05", 1, 5), "2027-01-05");
        // Día 31: último día en meses cortos, y vuelve al 31 cuando el mes lo tiene.
        assert_eq!(add_months("2027-01-31", 1, 31), "2027-02-28");
        assert_eq!(add_months("2027-02-28", 1, 31), "2027-03-31");
        assert_eq!(add_months("2028-01-31", 1, 31), "2028-02-29");
        assert_eq!(add_months("2026-11-30", 3, 30), "2027-02-28");
        assert_eq!(add_months("2026-03-15", 12, 15), "2027-03-15");
        assert_eq!(period_label("2026-11-05"), "noviembre de 2026");
        assert!(months_of("semanal").is_err());
    }
}
