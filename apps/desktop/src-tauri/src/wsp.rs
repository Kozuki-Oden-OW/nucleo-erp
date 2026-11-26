//! Comandos de WhatsApp por el puente local (`integraciones/whatsapp`). La llave la escribe la
//! persona en NÚCLEO; las llamadas al puente ocurren sin tener tomada la sesión.

use crate::commands::{AppState, CommandError};
use nucleo_app::wsp_ops::{
    self, UreqBridge, WspBridgeState, WspChat, WspConversation, WspDraft, WspLink, WspSent,
    WspSetup, WspStatus,
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

/// Ejecuta una consulta al puente en otro hilo (puede tardar: WhatsApp carga los chats al momento).
async fn bridge<T: Send + 'static>(
    link: WspLink,
    f: impl FnOnce(&UreqBridge, &WspLink) -> Result<T, String> + Send + 'static,
) -> CmdResult<T> {
    tauri::async_runtime::spawn_blocking(move || f(&UreqBridge::default(), &link))
        .await
        .map_err(|e| err(e.to_string()))?
        .map_err(err)
}

#[tauri::command]
pub fn wsp_status(state: State<'_, AppState>) -> CmdResult<WspStatus> {
    with(&state, |s| s.wsp_status())
}

#[tauri::command]
pub fn wsp_save(state: State<'_, AppState>, setup: WspSetup) -> CmdResult<WspStatus> {
    with(&state, |s| s.wsp_save(&setup))
}

#[tauri::command]
pub fn wsp_disconnect(state: State<'_, AppState>) -> CmdResult<WspStatus> {
    with(&state, |s| s.wsp_disconnect())
}

/// Estado del puente: iniciando, con el código QR por escanear, listo o desconectado.
#[tauri::command]
pub async fn wsp_state(state: State<'_, AppState>) -> CmdResult<WspBridgeState> {
    let link = with(&state, |s| s.wsp_link())?;
    bridge(link, |h, l| wsp_ops::state(h, l)).await
}

#[tauri::command]
pub async fn wsp_chats(
    state: State<'_, AppState>,
    limit: Option<i64>,
    unread: Option<bool>,
) -> CmdResult<Vec<WspChat>> {
    let link = with(&state, |s| s.wsp_link())?;
    bridge(link, move |h, l| {
        wsp_ops::chats(h, l, limit.unwrap_or(30), unread.unwrap_or(false))
    })
    .await
}

#[tauri::command]
pub async fn wsp_conversation(
    state: State<'_, AppState>,
    chat: String,
    limit: Option<i64>,
) -> CmdResult<WspConversation> {
    let link = with(&state, |s| s.wsp_link())?;
    bridge(link, move |h, l| {
        wsp_ops::conversation(h, l, &chat, limit.unwrap_or(30))
    })
    .await
}

/// Envía el mensaje ya aprobado por la persona y lo deja en la auditoría.
#[tauri::command]
pub async fn wsp_send(state: State<'_, AppState>, draft: WspDraft) -> CmdResult<WspSent> {
    let out = with(&state, |s| s.wsp_plan(&draft))?;
    let (out, result) = tauri::async_runtime::spawn_blocking(move || {
        let r = wsp_ops::send(&UreqBridge::default(), &out);
        (out, r)
    })
    .await
    .map_err(|e| err(e.to_string()))?;
    with(&state, |s| s.wsp_record(&out, &result))?;
    result.map_err(err)
}
