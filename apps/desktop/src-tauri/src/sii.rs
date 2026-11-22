//! Comandos de la facturación electrónica propia con el SII. Los archivos (certificado .pfx y folios
//! CAF) los elige la persona con el selector de archivos y se leen aquí; la clave del certificado la
//! escribe ella en NÚCLEO. La red se usa sin tener tomada la sesión (preparar → SII → aplicar).

use crate::commands::{AppState, CommandError};
use nucleo_app::sii_ops::{self, SiiDocument, SiiIssueInput, SiiSetup, SiiStatus, UreqSii};
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

fn read_small(path: &str, what: &str) -> CmdResult<Vec<u8>> {
    let meta = std::fs::metadata(path).map_err(|e| err(format!("no se pudo leer {what}: {e}")))?;
    if meta.len() > 256 * 1024 {
        return Err(err(format!("el archivo de {what} es demasiado grande")));
    }
    std::fs::read(path).map_err(|e| err(format!("no se pudo leer {what}: {e}")))
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, AppError> + Send + 'static,
) -> CmdResult<T> {
    Ok(tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| err(e.to_string()))??)
}

#[tauri::command]
pub fn sii_status(state: State<'_, AppState>) -> CmdResult<SiiStatus> {
    with(&state, |s| s.sii_status())
}

#[tauri::command]
pub fn sii_save_setup(state: State<'_, AppState>, setup: SiiSetup) -> CmdResult<SiiStatus> {
    with(&state, |s| s.sii_save_setup(&setup))
}

#[tauri::command]
pub fn sii_load_certificate(
    state: State<'_, AppState>,
    path: String,
    password: String,
) -> CmdResult<SiiStatus> {
    let p12 = read_small(&path, "el certificado")?;
    with(&state, |s| s.sii_load_certificate(&p12, &password))
}

#[tauri::command]
pub fn sii_load_caf(state: State<'_, AppState>, path: String) -> CmdResult<SiiStatus> {
    let xml = read_small(&path, "los folios")?;
    with(&state, |s| s.sii_load_caf(&xml))
}

/// Pide semilla y token al SII con el certificado: comprueba conexión y certificado sin emitir nada.
#[tauri::command]
pub async fn sii_test_connection(state: State<'_, AppState>) -> CmdResult<String> {
    let cred = with(&state, |s| s.sii_connection_plan())?;
    let amb = cred.ambiente;
    blocking(move || {
        let cert = cred.certificate()?;
        sii_ops::get_token(&UreqSii::default(), amb, &cert)?;
        Ok(())
    })
    .await?;
    Ok(format!(
        "Conexión correcta con el SII ({}): el certificado fue aceptado.",
        amb.host()
    ))
}

#[tauri::command]
pub fn sii_issue(state: State<'_, AppState>, input: SiiIssueInput) -> CmdResult<SiiDocument> {
    with(&state, |s| s.sii_issue(&input))
}

#[tauri::command]
pub fn sii_documents(
    state: State<'_, AppState>,
    limit: Option<i64>,
) -> CmdResult<Vec<SiiDocument>> {
    with(&state, |s| s.sii_documents(limit))
}

/// Envía al SII los documentos firmados (irreversible: la interfaz pide confirmar antes).
#[tauri::command]
pub async fn sii_send(state: State<'_, AppState>, ids: Vec<i64>) -> CmdResult<Vec<SiiDocument>> {
    let plan = with(&state, |s| s.sii_send_plan(&ids))?;
    let (plan, track) = tauri::async_runtime::spawn_blocking(move || {
        let r = sii_ops::send(&UreqSii::default(), &plan);
        (plan, r)
    })
    .await
    .map_err(|e| err(e.to_string()))?;
    let track = track?;
    with(&state, |s| s.sii_send_apply(&plan, &track))
}

#[tauri::command]
pub async fn sii_check(state: State<'_, AppState>, id: i64) -> CmdResult<Vec<SiiDocument>> {
    let (cred, track) = with(&state, |s| s.sii_status_plan(id))?;
    let t = track.clone();
    let estado = blocking(move || sii_ops::check(&UreqSii::default(), &cred, &t)).await?;
    with(&state, |s| s.sii_status_apply(&track, &estado))
}

/// Guarda el XML firmado de un documento donde la persona elija.
#[tauri::command]
pub fn sii_export_xml(state: State<'_, AppState>, id: i64, path: String) -> CmdResult<()> {
    let xml = with(&state, |s| s.sii_document_xml(id))?;
    std::fs::write(&path, xml).map_err(|e| err(format!("no se pudo guardar: {e}")))
}
