//! Comandos de la cotización como documento: plantilla y carpeta del negocio, condiciones de cada
//! cotización y guardado del PDF emitido.

use crate::commands::{AppState, CommandError};
use nucleo_app::quote_doc_ops::{QuoteDocSettings, QuoteEmitted, QuoteTerms};
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
pub fn quote_doc_settings(state: State<'_, AppState>) -> CmdResult<QuoteDocSettings> {
    with(&state, |s| s.quote_doc_settings())
}

#[tauri::command]
pub fn save_quote_doc_settings(
    state: State<'_, AppState>,
    settings: QuoteDocSettings,
) -> CmdResult<QuoteDocSettings> {
    with(&state, |s| s.save_quote_doc_settings(&settings))
}

#[tauri::command]
pub fn quote_terms(state: State<'_, AppState>, uid: String) -> CmdResult<QuoteTerms> {
    with(&state, |s| s.quote_terms(&uid))
}

#[tauri::command]
pub fn save_quote_terms(
    state: State<'_, AppState>,
    uid: String,
    terms: QuoteTerms,
) -> CmdResult<QuoteTerms> {
    with(&state, |s| s.save_quote_terms(&uid, &terms))
}

/// Guarda el PDF (en base64) en la carpeta de cotizaciones y devuelve dónde quedó.
#[tauri::command]
pub fn save_quote_pdf(
    state: State<'_, AppState>,
    uid: String,
    data: String,
) -> CmdResult<QuoteEmitted> {
    with(&state, |s| s.save_quote_pdf(&uid, &data))
}
