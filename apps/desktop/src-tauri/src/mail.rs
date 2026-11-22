//! Comandos del correo de la empresa (SMTP). La clave la escribe la persona en NÚCLEO; el envío ocurre
//! sin tener tomada la sesión (preparar → enviar → registrar).

use crate::commands::{AppState, CommandError};
use nucleo_app::mail_ops::{
    self, MailDraft, MailLogRow, MailPreset, MailSetup, MailStatus, MailTemplates, MailTransport,
    SmtpMail,
};
use nucleo_app::{AppError, CompanySession};
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

#[tauri::command]
pub fn mail_status(state: State<'_, AppState>) -> CmdResult<MailStatus> {
    with(&state, |s| s.mail_status())
}

#[tauri::command]
pub fn mail_presets() -> Vec<MailPreset> {
    mail_ops::presets()
}

#[tauri::command]
pub fn mail_save(state: State<'_, AppState>, setup: MailSetup) -> CmdResult<MailStatus> {
    with(&state, |s| s.mail_save(&setup))
}

#[tauri::command]
pub fn mail_disconnect(state: State<'_, AppState>) -> CmdResult<MailStatus> {
    with(&state, |s| s.mail_disconnect())
}

#[tauri::command]
pub fn mail_templates(state: State<'_, AppState>) -> CmdResult<MailTemplates> {
    with(&state, |s| s.mail_templates())
}

#[tauri::command]
pub fn mail_save_templates(
    state: State<'_, AppState>,
    templates: MailTemplates,
) -> CmdResult<MailTemplates> {
    with(&state, |s| s.mail_save_templates(&templates))
}

/// Borrador: `kind` = "envio" (ref = uid del envío), "cobro" o "promocion" (ref = uid del cliente).
#[tauri::command]
pub fn mail_draft(
    state: State<'_, AppState>,
    kind: String,
    reference: String,
) -> CmdResult<MailDraft> {
    with(&state, |s| match kind.as_str() {
        "envio" => s.mail_draft_shipment(&reference),
        "cobro" => s.mail_draft_collection(&reference),
        "promocion" => s.mail_draft_promotion(&reference),
        _ => Err(AppError::Validation("tipo de correo no válido".into())),
    })
}

async fn deliver(
    state: &State<'_, AppState>,
    mail: mail_ops::OutgoingMail,
) -> CmdResult<MailLogRow> {
    let (mail, result) = tauri::async_runtime::spawn_blocking(move || {
        let r = SmtpMail.send(&mail);
        (mail, r)
    })
    .await
    .map_err(|e| err(e.to_string()))?;
    let row = with(state, |s| s.mail_record(&mail, &result))?;
    result.map_err(err)?;
    Ok(row)
}

/// Envía el correo ya revisado por la persona.
#[tauri::command]
pub async fn mail_send(state: State<'_, AppState>, draft: MailDraft) -> CmdResult<MailLogRow> {
    let mail = with(&state, |s| s.mail_plan(&draft))?;
    deliver(&state, mail).await
}

#[tauri::command]
pub async fn mail_test(state: State<'_, AppState>, to: Option<String>) -> CmdResult<MailLogRow> {
    let mail = with(&state, |s| s.mail_test_plan(to.as_deref()))?;
    deliver(&state, mail).await
}

#[tauri::command]
pub fn mail_log(
    state: State<'_, AppState>,
    customer_uid: Option<String>,
    limit: Option<i64>,
) -> CmdResult<Vec<MailLogRow>> {
    with(&state, |s| s.mail_log(customer_uid.as_deref(), limit))
}
