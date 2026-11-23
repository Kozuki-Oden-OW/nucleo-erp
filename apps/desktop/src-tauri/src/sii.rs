//! Comandos de la facturación electrónica propia con el SII. Los archivos (certificado .pfx y folios
//! CAF) los elige la persona con el selector de archivos y se leen aquí; la clave del certificado la
//! escribe ella en NÚCLEO. La red se usa sin tener tomada la sesión (preparar → SII → aplicar).

use crate::commands::{AppState, CommandError};
use nucleo_app::sii_intercambio::{IntercambioInput, IntercambioResumen};
use nucleo_app::sii_ops::{
    self, SiiDocument, SiiIssueInput, SiiLibro, SiiLibroInput, SiiSetup, SiiStatus, UreqSii,
};
use nucleo_app::sii_print::SiiPrintDoc;
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

/* ───────────── Libros de compras y ventas (IECV) ───────────── */

#[tauri::command]
pub fn sii_libro_create(state: State<'_, AppState>, input: SiiLibroInput) -> CmdResult<SiiLibro> {
    with(&state, |s| s.sii_libro_create(&input))
}

#[tauri::command]
pub fn sii_libros(state: State<'_, AppState>) -> CmdResult<Vec<SiiLibro>> {
    with(&state, |s| s.sii_libros())
}

/// Sube el libro firmado al SII (irreversible: la interfaz pide confirmar antes).
#[tauri::command]
pub async fn sii_libro_send(state: State<'_, AppState>, id: i64) -> CmdResult<SiiLibro> {
    let plan = with(&state, |s| s.sii_libro_send_plan(id))?;
    let track = blocking(move || sii_ops::send(&UreqSii::default(), &plan)).await?;
    with(&state, |s| s.sii_libro_send_apply(id, &track))
}

#[tauri::command]
pub async fn sii_libro_check(state: State<'_, AppState>, id: i64) -> CmdResult<SiiLibro> {
    let (cred, track) = with(&state, |s| s.sii_libro_status_plan(id))?;
    let estado = blocking(move || sii_ops::check(&UreqSii::default(), &cred, &track)).await?;
    with(&state, |s| s.sii_libro_status_apply(id, &estado))
}

#[tauri::command]
pub fn sii_libro_export_xml(state: State<'_, AppState>, id: i64, path: String) -> CmdResult<()> {
    let xml = with(&state, |s| s.sii_libro_xml(id))?;
    std::fs::write(&path, xml).map_err(|e| err(format!("no se pudo guardar: {e}")))
}

/// Datos del documento para imprimirlo (ejemplar tributario y cedible, con el timbre PDF417).
#[tauri::command]
pub fn sii_document_print(state: State<'_, AppState>, id: i64) -> CmdResult<SiiPrintDoc> {
    with(&state, |s| s.sii_document_print(id))
}

/* ───────────── Intercambio con otros contribuyentes ───────────── */

fn read_envio(path: &str) -> CmdResult<Vec<u8>> {
    let meta =
        std::fs::metadata(path).map_err(|e| err(format!("no se pudo leer el envío: {e}")))?;
    if meta.len() > 20 * 1024 * 1024 {
        return Err(err("el archivo del envío es demasiado grande"));
    }
    std::fs::read(path).map_err(|e| err(format!("no se pudo leer el envío: {e}")))
}

/// Lee un sobre recibido (EnvioDTE) y muestra qué trae y cómo se respondería.
#[tauri::command]
pub fn sii_intercambio_leer(
    state: State<'_, AppState>,
    path: String,
) -> CmdResult<IntercambioResumen> {
    let xml = read_envio(&path)?;
    with(&state, |s| s.sii_intercambio_leer(&xml))
}

#[derive(serde::Serialize)]
pub struct IntercambioGuardado {
    pub resumen: IntercambioResumen,
    pub archivos: Vec<String>,
}

/// Arma y firma las respuestas a un sobre recibido y las guarda en la carpeta indicada.
#[tauri::command]
pub fn sii_intercambio_responder(
    state: State<'_, AppState>,
    path: String,
    carpeta: String,
    input: IntercambioInput,
) -> CmdResult<IntercambioGuardado> {
    let xml = read_envio(&path)?;
    let dir = std::path::PathBuf::from(&carpeta);
    if !dir.is_dir() {
        return Err(err("la carpeta de destino no existe"));
    }
    let nombre = std::path::Path::new(&path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "envio.xml".into());
    let out = with(&state, |s| {
        s.sii_intercambio_responder(&xml, &nombre, &input)
    })?;
    let base: String = nombre
        .trim_end_matches(".xml")
        .trim_end_matches(".XML")
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .take(60)
        .collect();
    let mut archivos = Vec::new();
    let mut guardar = |prefijo: &str, bytes: &[u8]| -> CmdResult<()> {
        let p = dir.join(format!("{prefijo}_{base}.xml"));
        std::fs::write(&p, bytes).map_err(|e| err(format!("no se pudo guardar: {e}")))?;
        archivos.push(p.to_string_lossy().to_string());
        Ok(())
    };
    guardar("1_RecepcionEnvio", &out.recepcion)?;
    if let Some(b) = &out.resultado {
        guardar("2_ResultadoDTE", b)?;
    }
    if let Some(b) = &out.recibos {
        guardar("3_EnvioRecibos", b)?;
    }
    Ok(IntercambioGuardado {
        resumen: out.resumen,
        archivos,
    })
}

/// Borrador del documento tributario de una venta efectuada (para revisarlo antes de timbrar).
#[tauri::command]
pub fn sii_sale_draft(state: State<'_, AppState>, sale_uid: String) -> CmdResult<SiiIssueInput> {
    with(&state, |s| s.sii_sale_draft(&sale_uid))
}
