//! Comandos de lo que NÚCLEO hace solo y de las funciones que lo rodean: ronda de cobranza, informe
//! por correo, cobros recurrentes, reglas de conciliación, números de serie y el inicio con los
//! registros del SII.
//!
//! Los envíos de correo ocurren sin tener tomada la sesión (preparar → enviar → registrar), igual que
//! en `mail.rs`.

use crate::commands::{AppState, CommandError};
use nucleo_app::auto_ops::AutoDone;
use nucleo_app::bank_rules::{BankRule, BankRuleInput};
use nucleo_app::collect_ops::{CollectResult, CollectRound, CollectSettings};
use nucleo_app::digest_ops::{DigestPreview, DigestSettings, GoalProgress};
use nucleo_app::mail_ops::{MailTransport, OutgoingMail, SmtpMail};
use nucleo_app::recurring_ops::{RecurringSale, RecurringSaleInput};
use nucleo_app::serial_ops::{Serial, SerialBulkReport, SerialFilter, SerialInput};
use nucleo_app::sii_start_ops::{StartFile, StartReport};
use nucleo_app::{AppError, CompanySession};
use serde::Serialize;
use tauri::State;

type CmdResult<T> = Result<T, CommandError>;

fn err(msg: impl Into<String>) -> CommandError {
    AppError::Validation(msg.into()).into()
}

fn with<T>(
    state: &State<'_, AppState>,
    f: impl FnOnce(&mut CompanySession) -> Result<T, AppError>,
) -> CmdResult<T> {
    let mut g = state.session.lock().map_err(|_| err("sesión bloqueada"))?;
    let s = g.as_mut().ok_or_else(|| err("no hay un negocio abierto"))?;
    Ok(f(s)?)
}

/// Envía una tanda de correos fuera de la sesión y devuelve cada uno con su resultado.
async fn send_all(mails: Vec<OutgoingMail>) -> CmdResult<Vec<(OutgoingMail, Result<(), String>)>> {
    if mails.is_empty() {
        return Ok(Vec::new());
    }
    tauri::async_runtime::spawn_blocking(move || {
        mails
            .into_iter()
            .map(|m| {
                let r = SmtpMail.send(&m);
                (m, r)
            })
            .collect()
    })
    .await
    .map_err(|e| err(e.to_string()))
}

/* ───────────── Tareas programadas ───────────── */

/// «¿Toca algo?» La aplicación lo pregunta cada pocos minutos mientras está abierta.
#[tauri::command]
pub async fn auto_run(state: State<'_, AppState>) -> CmdResult<Vec<AutoDone>> {
    let jobs = {
        let mut g = state.session.lock().map_err(|_| err("sesión bloqueada"))?;
        match g.as_mut() {
            // Sin negocio abierto o sin sesión iniciada no hay nada que hacer (no es un error).
            Some(s) if s.current_user().is_some() => s.auto_plan()?,
            _ => return Ok(Vec::new()),
        }
    };
    let mut out = Vec::new();
    for mut job in jobs {
        let sent = send_all(std::mem::take(&mut job.mails)).await?;
        let (mails, results): (Vec<_>, Vec<_>) = sent.into_iter().unzip();
        job.mails = mails;
        if let Some(done) = with(&state, |s| s.auto_finish(&job, &results))? {
            out.push(done);
        }
    }
    Ok(out)
}

/* ───────────── Cobranza ───────────── */

#[tauri::command]
pub fn collect_round(state: State<'_, AppState>) -> CmdResult<CollectRound> {
    with(&state, |s| s.collect_round())
}

#[tauri::command]
pub fn collect_save_settings(
    state: State<'_, AppState>,
    settings: CollectSettings,
) -> CmdResult<CollectSettings> {
    with(&state, |s| s.collect_save_settings(&settings))
}

/// Envía la ronda (todos los listos) o los recordatorios de los clientes indicados.
#[tauri::command]
pub async fn collect_send(
    state: State<'_, AppState>,
    customer_uids: Option<Vec<String>>,
) -> CmdResult<CollectResult> {
    let mails = with(&state, |s| s.collect_plan(customer_uids.as_deref()))?;
    let sent = send_all(mails).await?;
    let mut out = CollectResult {
        sent: 0,
        failed: 0,
        errors: Vec::new(),
    };
    with(&state, |s| {
        for (m, r) in &sent {
            s.mail_record(m, r)?;
            match r {
                Ok(()) => out.sent += 1,
                Err(e) => {
                    out.failed += 1;
                    out.errors.push(format!("{}: {e}", m.draft.to));
                }
            }
        }
        s.collect_finish("manual", out.sent, out.failed)?;
        Ok(())
    })?;
    Ok(out)
}

/* ───────────── Informe por correo ───────────── */

#[tauri::command]
pub fn digest_preview(state: State<'_, AppState>) -> CmdResult<DigestPreview> {
    with(&state, |s| s.digest_preview())
}

#[tauri::command]
pub fn digest_save_settings(
    state: State<'_, AppState>,
    settings: DigestSettings,
) -> CmdResult<DigestPreview> {
    with(&state, |s| {
        s.digest_save_settings(&settings)?;
        s.digest_preview()
    })
}

/// Envía el informe ahora (no cuenta como el envío programado del día).
#[tauri::command]
pub async fn digest_send(state: State<'_, AppState>) -> CmdResult<String> {
    let mail = with(&state, |s| s.digest_plan())?;
    let to = mail.draft.to.clone();
    let mut sent = send_all(vec![mail]).await?;
    let (m, r) = sent.pop().ok_or_else(|| err("no se pudo enviar"))?;
    with(&state, |s| s.mail_record(&m, &r).map(|_| ()))?;
    r.map_err(err)?;
    Ok(to)
}

#[tauri::command]
pub fn sales_goal(state: State<'_, AppState>) -> CmdResult<Option<GoalProgress>> {
    with(&state, |s| s.sales_goal())
}

/* ───────────── Cobros recurrentes ───────────── */

#[tauri::command]
pub fn recurring_sales(state: State<'_, AppState>) -> CmdResult<Vec<RecurringSale>> {
    with(&state, |s| s.recurring_sales())
}

#[tauri::command]
pub fn save_recurring_sale(
    state: State<'_, AppState>,
    input: RecurringSaleInput,
    uid: Option<String>,
) -> CmdResult<RecurringSale> {
    with(&state, |s| s.save_recurring_sale(&input, uid.as_deref()))
}

#[tauri::command]
pub fn delete_recurring_sale(state: State<'_, AppState>, uid: String) -> CmdResult<()> {
    with(&state, |s| s.delete_recurring_sale(&uid))
}

#[derive(Debug, Serialize)]
pub struct RecurringNow {
    pub sales: Vec<String>,
    pub mails_sent: i64,
    pub notes: Vec<String>,
}

/// Genera ahora el próximo cobro de uno y envía su aviso.
#[tauri::command]
pub async fn recurring_run_now(state: State<'_, AppState>, uid: String) -> CmdResult<RecurringNow> {
    let mut run = with(&state, |s| s.recurring_run_one(&uid))?;
    let sent = send_all(std::mem::take(&mut run.mails)).await?;
    let mut out = RecurringNow {
        sales: run.sales,
        mails_sent: 0,
        notes: run.skipped,
    };
    with(&state, |s| {
        for (m, r) in &sent {
            s.mail_record(m, r)?;
            match r {
                Ok(()) => out.mails_sent += 1,
                Err(e) => out
                    .notes
                    .push(format!("El aviso a {} no salió: {e}", m.draft.to)),
            }
        }
        Ok(())
    })?;
    Ok(out)
}

/* ───────────── Reglas de conciliación ───────────── */

#[tauri::command]
pub fn bank_rules(state: State<'_, AppState>) -> CmdResult<Vec<BankRule>> {
    with(&state, |s| s.bank_rules())
}

#[tauri::command]
pub fn save_bank_rule(
    state: State<'_, AppState>,
    input: BankRuleInput,
    uid: Option<String>,
) -> CmdResult<Vec<BankRule>> {
    with(&state, |s| s.save_bank_rule(&input, uid.as_deref()))
}

#[tauri::command]
pub fn delete_bank_rule(state: State<'_, AppState>, uid: String) -> CmdResult<Vec<BankRule>> {
    with(&state, |s| s.delete_bank_rule(&uid))
}

/* ───────────── Números de serie ───────────── */

#[tauri::command]
pub fn serials(state: State<'_, AppState>, filter: SerialFilter) -> CmdResult<Vec<Serial>> {
    with(&state, |s| s.serials(&filter))
}

#[tauri::command]
pub fn save_serial(
    state: State<'_, AppState>,
    input: SerialInput,
    uid: Option<String>,
) -> CmdResult<Serial> {
    with(&state, |s| s.save_serial(&input, uid.as_deref()))
}

#[tauri::command]
pub fn add_serials(
    state: State<'_, AppState>,
    product_uid: String,
    serials: Vec<String>,
) -> CmdResult<SerialBulkReport> {
    with(&state, |s| s.add_serials(&product_uid, &serials))
}

#[tauri::command]
pub fn assign_serials(
    state: State<'_, AppState>,
    sale_uid: String,
    serial_uids: Vec<String>,
) -> CmdResult<Vec<Serial>> {
    with(&state, |s| s.assign_serials(&sale_uid, &serial_uids))
}

#[tauri::command]
pub fn release_serial(state: State<'_, AppState>, uid: String) -> CmdResult<Serial> {
    with(&state, |s| s.release_serial(&uid))
}

#[tauri::command]
pub fn delete_serial(state: State<'_, AppState>, uid: String) -> CmdResult<()> {
    with(&state, |s| s.delete_serial(&uid))
}

/* ───────────── Inicio con los registros del SII ───────────── */

#[tauri::command]
pub fn sii_start_import(
    state: State<'_, AppState>,
    files: Vec<StartFile>,
) -> CmdResult<StartReport> {
    with(&state, |s| s.sii_start_import(&files))
}
