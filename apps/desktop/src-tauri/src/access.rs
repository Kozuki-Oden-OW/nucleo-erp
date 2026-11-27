//! Comandos del gestor de contraseñas (accesos de solo lectura). Ninguno devuelve la clave: lo que
//! lee la interfaz es el sitio, el usuario y si hay clave guardada.

use crate::commands::{AppState, CommandError};
use nucleo_app::access_ops::{AccessInput, AccessRow};
use nucleo_app::signing_ops::SigningKeyStatus;
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
pub fn accesses(state: State<'_, AppState>) -> CmdResult<Vec<AccessRow>> {
    with(&state, |s| s.accesses())
}

#[tauri::command]
pub fn save_access(
    state: State<'_, AppState>,
    uid: Option<String>,
    input: AccessInput,
) -> CmdResult<AccessRow> {
    with(&state, |s| s.save_access(uid.as_deref(), &input))
}

#[tauri::command]
pub fn delete_access(state: State<'_, AppState>, uid: String) -> CmdResult<Vec<AccessRow>> {
    with(&state, |s| s.delete_access(&uid))
}

/// ¿Hay clave de firma de documentos guardada? Nunca devuelve la clave.
#[tauri::command]
pub fn signing_key_status(state: State<'_, AppState>) -> CmdResult<SigningKeyStatus> {
    with(&state, |s| s.signing_key_status())
}

/// Guarda la clave de firma. Solo la persona (el asistente recibe un rechazo).
#[tauri::command]
pub fn save_signing_key(
    state: State<'_, AppState>,
    key: String,
    declared: bool,
) -> CmdResult<SigningKeyStatus> {
    with(&state, |s| s.save_signing_key(&key, declared))
}

#[tauri::command]
pub fn delete_signing_key(state: State<'_, AppState>) -> CmdResult<SigningKeyStatus> {
    with(&state, |s| s.delete_signing_key())
}
