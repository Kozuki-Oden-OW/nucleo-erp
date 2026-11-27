//! Navegador de NÚCLEO: una ventana propia con perfil separado del navegador de la persona, para
//! revisar el SII, el banco y otros sitios del negocio. Las reglas (sitios permitidos, permiso de
//! ingreso por el día, nombres de archivo) viven en `nucleo_app::browser_ops`; aquí está la ventana.
//!
//! - Solo navega a los sitios permitidos; lo demás se bloquea y queda anotado para informarlo.
//! - Cada página lleva el guion `browser.js` en todos sus marcos: con él NÚCLEO lee el texto (también
//!   el de marcos de otro origen), actúa sobre los controles, trae archivos y rellena un ingreso.
//! - La página no puede llamar a NÚCLEO: una dirección remota no tiene permisos en Tauri. NÚCLEO
//!   lanza la orden y recoge el resultado evaluando en la página.
//! - La clave de un acceso va de la base cifrada a la página del mismo sitio; no pasa por la
//!   interfaz ni por el asistente, y exige el permiso que la persona dio hoy.
//! - Las descargas y los archivos que se guardan van a la carpeta configurada, con nombre sano y
//!   extensión de documento, sin sobrescribir.

use crate::commands::{AppState, CommandError};
use nucleo_app::browser_ops::{
    BrowserInfo, BrowserSettings, host_allowed, host_of, safe_file_name, site_of,
};
use nucleo_app::{AppError, CompanySession};
use serde::Serialize;
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::time::{Duration, Instant};
use tauri::webview::{DownloadEvent, NewWindowResponse, PageLoadEvent};
use tauri::{
    AppHandle, Manager, Runtime, State, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

const LABEL: &str = "navegador";
const SCRIPT: &str = include_str!("browser.js");
const PART: usize = 200_000;

type CmdResult<T> = Result<T, CommandError>;

fn err(msg: impl Into<String>) -> CommandError {
    AppError::Validation(msg.into()).into()
}

#[derive(Debug, Clone, Serialize)]
pub struct Download {
    pub name: String,
    pub path: String,
    pub ok: bool,
    pub note: Option<String>,
}

#[derive(Default)]
pub struct BrowserShared {
    next: AtomicU64,
    loading: AtomicBool,
    allowed: Mutex<Vec<String>>,
    download_dir: Mutex<PathBuf>,
    blocked: Mutex<Option<String>>,
    downloads: Mutex<Vec<Download>>,
}

pub type BrowserState = Arc<BrowserShared>;

impl BrowserShared {
    fn note_download(&self, d: Download) {
        if let Ok(mut l) = self.downloads.lock() {
            l.push(d);
            let extra = l.len().saturating_sub(30);
            l.drain(..extra);
        }
    }
    fn dir(&self) -> PathBuf {
        self.download_dir
            .lock()
            .map(|d| d.clone())
            .unwrap_or_default()
    }
}

/// Lo que ve la pantalla de configuración.
#[derive(Debug, Serialize)]
pub struct BrowserView {
    #[serde(flatten)]
    pub info: BrowserInfo,
    /// Carpeta donde caen las descargas, ya resuelta.
    pub folder: String,
    pub open: bool,
}

/// Estado de la ventana, sin contenido de la página.
#[derive(Debug, Serialize)]
pub struct PageState {
    pub open: bool,
    pub url: String,
    pub loading: bool,
    /// Sitio al que la página quiso ir y no está permitido (se informa una vez).
    pub blocked: Option<String>,
    pub downloads: Vec<Download>,
    pub folder: String,
}

fn with<T>(
    state: &State<'_, AppState>,
    f: impl FnOnce(&mut CompanySession) -> Result<T, AppError>,
) -> CmdResult<T> {
    let mut g = state.session.lock().map_err(|_| err("sesión bloqueada"))?;
    let s = g.as_mut().ok_or_else(|| err("no hay un negocio abierto"))?;
    Ok(f(s)?)
}

/// Vuelve a leer de la base los sitios permitidos y la carpeta de descargas.
fn refresh<R: Runtime>(
    app: &AppHandle<R>,
    state: &State<'_, AppState>,
    shared: &BrowserShared,
) -> CmdResult<BrowserInfo> {
    let info = with(state, |s| s.browser_info())?;
    let dir = if info.settings.download_dir.is_empty() {
        app.path()
            .document_dir()
            .or_else(|_| app.path().download_dir())
            .or_else(|_| app.path().local_data_dir())
            .unwrap_or_else(|_| std::env::temp_dir())
            .join("NUCLEO ERP Descargas")
    } else {
        PathBuf::from(&info.settings.download_dir)
    };
    if let Ok(mut a) = shared.allowed.lock() {
        *a = info.allowed.clone();
    }
    if let Ok(mut d) = shared.download_dir.lock() {
        *d = dir;
    }
    Ok(info)
}

fn view<R: Runtime>(app: &AppHandle<R>, shared: &BrowserShared, info: BrowserInfo) -> BrowserView {
    BrowserView {
        info,
        folder: shared.dir().to_string_lossy().into_owned(),
        open: app.get_webview_window(LABEL).is_some(),
    }
}

fn page_state<R: Runtime>(app: &AppHandle<R>, shared: &BrowserShared) -> PageState {
    let w = app.get_webview_window(LABEL);
    PageState {
        open: w.is_some(),
        url: w
            .and_then(|w| w.url().ok())
            .map(|u| u.to_string())
            .unwrap_or_default(),
        loading: shared.loading.load(Ordering::SeqCst),
        blocked: shared.blocked.lock().ok().and_then(|mut b| b.take()),
        downloads: shared
            .downloads
            .lock()
            .map(|d| d.clone())
            .unwrap_or_default(),
        folder: shared.dir().to_string_lossy().into_owned(),
    }
}

/// ¿Se puede navegar a esta dirección? https y de un sitio permitido.
fn nav_allowed(shared: &BrowserShared, url: &Url) -> bool {
    if url.as_str() == "about:blank" {
        return true;
    }
    let ok = host_of(url.as_str()).is_some_and(|h| {
        shared
            .allowed
            .lock()
            .map(|a| host_allowed(&h, &a))
            .unwrap_or(false)
    });
    if !ok && let Ok(mut b) = shared.blocked.lock() {
        *b = Some(
            url.host_str()
                .map(str::to_string)
                .unwrap_or_else(|| url.scheme().to_string()),
        );
    }
    ok
}

/// Un lugar libre en la carpeta: «nombre.pdf», «nombre (2).pdf»…
fn free_path(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let (stem, ext) = name.rsplit_once('.').unwrap_or((name, ""));
    (2..1000)
        .map(|i| dir.join(format!("{stem} ({i}).{ext}")))
        .find(|p| !p.exists())
        .unwrap_or(first)
}

fn window<R: Runtime>(app: &AppHandle<R>) -> Result<WebviewWindow<R>, String> {
    app.get_webview_window(LABEL).ok_or_else(|| {
        "El navegador de NÚCLEO está cerrado: ábrelo primero con una dirección o un acceso.".into()
    })
}

/// Abre la ventana (o navega en la que ya está). No la trae al frente si ya existía: la persona
/// puede estar trabajando en otra cosa.
fn open_window<R: Runtime>(
    app: &AppHandle<R>,
    shared: &BrowserState,
    url: Url,
) -> Result<WebviewWindow<R>, String> {
    shared.loading.store(true, Ordering::SeqCst);
    if let Some(w) = app.get_webview_window(LABEL) {
        w.navigate(url).map_err(|e| e.to_string())?;
        return Ok(w);
    }
    let profile = app
        .path()
        .local_data_dir()
        .map_err(|e| e.to_string())?
        .join("NucleoERP")
        .join("navegador");
    let (nav, pop, dl, load) = (
        shared.clone(),
        shared.clone(),
        shared.clone(),
        shared.clone(),
    );
    let pop_app = app.clone();
    WebviewWindowBuilder::new(app, LABEL, WebviewUrl::External(url))
        .title("Navegador NÚCLEO")
        .inner_size(1280.0, 860.0)
        .min_inner_size(820.0, 520.0)
        .data_directory(profile)
        .initialization_script_for_all_frames(SCRIPT)
        .on_navigation(move |u| nav_allowed(&nav, u))
        // Una sola ventana: lo que la página quiera abrir aparte se abre aquí mismo, si está permitido.
        .on_new_window(move |u, _features| {
            if nav_allowed(&pop, &u) {
                let app = pop_app.clone();
                let shared = pop.clone();
                tauri::async_runtime::spawn(async move {
                    if let Some(w) = app.get_webview_window(LABEL) {
                        shared.loading.store(true, Ordering::SeqCst);
                        let _ = w.navigate(u);
                    }
                });
            }
            NewWindowResponse::Deny
        })
        .on_download(move |_webview, event| match event {
            DownloadEvent::Requested { destination, .. } => {
                let suggested = destination
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default();
                match safe_file_name(&suggested) {
                    Ok(name) => {
                        let dir = dl.dir();
                        if std::fs::create_dir_all(&dir).is_err() {
                            dl.note_download(Download {
                                name,
                                path: String::new(),
                                ok: false,
                                note: Some("no se pudo usar la carpeta de descargas".into()),
                            });
                            return false;
                        }
                        *destination = free_path(&dir, &name);
                        true
                    }
                    Err(e) => {
                        dl.note_download(Download {
                            name: suggested,
                            path: String::new(),
                            ok: false,
                            note: Some(format!("descarga rechazada: {e}")),
                        });
                        false
                    }
                }
            }
            DownloadEvent::Finished { path, success, .. } => {
                let path = path.unwrap_or_default();
                dl.note_download(Download {
                    name: path
                        .file_name()
                        .map(|n| n.to_string_lossy().into_owned())
                        .unwrap_or_default(),
                    path: path.to_string_lossy().into_owned(),
                    ok: success,
                    note: (!success).then(|| "la descarga no terminó".to_string()),
                });
                true
            }
            _ => true,
        })
        .on_page_load(move |w, payload| match payload.event() {
            PageLoadEvent::Started => load.loading.store(true, Ordering::SeqCst),
            PageLoadEvent::Finished => {
                load.loading.store(false, Ordering::SeqCst);
                let host = payload.url().host_str().unwrap_or_default().to_string();
                let _ = w.set_title(&format!("Navegador NÚCLEO — {host}"));
            }
        })
        .build()
        .map_err(|e| format!("No se pudo abrir el navegador de NÚCLEO: {e}"))
}

/// Espera a que la página termine de cargar (con un mínimo para que arranque la navegación).
fn wait_load(shared: &BrowserShared, settle: Duration, max: Duration) {
    std::thread::sleep(settle);
    let t0 = Instant::now();
    while shared.loading.load(Ordering::SeqCst) && t0.elapsed() < max {
        std::thread::sleep(Duration::from_millis(100));
    }
    std::thread::sleep(Duration::from_millis(250));
}

/// Evalúa en la página y devuelve el resultado (JSON).
fn eval_json<R: Runtime>(
    w: &WebviewWindow<R>,
    js: String,
    wait: Duration,
) -> Result<Value, String> {
    let (tx, rx) = mpsc::channel::<String>();
    w.eval_with_callback(js, move |s| {
        let _ = tx.send(s);
    })
    .map_err(|e| e.to_string())?;
    let s = rx
        .recv_timeout(wait)
        .map_err(|_| "la página no respondió".to_string())?;
    serde_json::from_str(&s).map_err(|_| "la página respondió algo que no se entiende".to_string())
}

/// Lanza una orden del guion y recoge su resultado. Si la página navega antes de responder
/// (un clic, un ingreso), devuelve `{"navego": true}`.
fn run_op<R: Runtime>(
    w: &WebviewWindow<R>,
    shared: &BrowserShared,
    mut cmd: Value,
    wait: Duration,
) -> Result<Value, String> {
    let id = format!("n{}", shared.next.fetch_add(1, Ordering::Relaxed) + 1);
    cmd["id"] = json!(id);
    let before = w.url().map(|u| u.to_string()).unwrap_or_default();
    let start = format!(
        "(function(){{try{{return window.__nucleoWeb?window.__nucleoWeb.run({cmd}):'sin-guion'}}catch(e){{return 'error'}}}})()"
    );
    drop(cmd);
    match eval_json(w, start, Duration::from_secs(8))? {
        Value::String(s) if s == "ok" => {}
        Value::String(s) if s == "sin-guion" => {
            return Err(
                "La página todavía no termina de cargar (o no es una página web): espera un \
                 momento y vuelve a leerla."
                    .into(),
            );
        }
        _ => return Err("la página no aceptó la orden".into()),
    }
    let t0 = Instant::now();
    let size = loop {
        std::thread::sleep(Duration::from_millis(80));
        let v = eval_json(
            w,
            format!("window.__nucleoWeb?window.__nucleoWeb.size('{id}'):-2"),
            Duration::from_secs(5),
        );
        if let Ok(n) = v.as_ref().map(|v| v.as_i64().unwrap_or(-1)) {
            if n >= 0 {
                break n as usize;
            }
            let now = w.url().map(|u| u.to_string()).unwrap_or_default();
            if n == -2 || now != before {
                return Ok(json!({ "navego": true }));
            }
        }
        if t0.elapsed() > wait {
            return Err("la página no respondió a tiempo".into());
        }
    };
    let mut body = String::with_capacity(size);
    let mut a = 0;
    while a < size {
        let b = (a + PART).min(size);
        match eval_json(
            w,
            format!("window.__nucleoWeb.part('{id}',{a},{b})"),
            Duration::from_secs(20),
        )? {
            Value::String(s) => body.push_str(&s),
            _ => return Err("la página dejó de responder a mitad de la lectura".into()),
        }
        a = b;
    }
    let _ = w.eval(format!(
        "window.__nucleoWeb&&window.__nucleoWeb.done('{id}')"
    ));
    serde_json::from_str(&body).map_err(|_| "no se pudo leer lo que devolvió la página".into())
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> CmdResult<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| err(e.to_string()))?
        .map_err(err)
}

/* ───────────── Configuración (la persona) ───────────── */

#[tauri::command]
pub fn browser_info<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    shared: State<'_, BrowserState>,
) -> CmdResult<BrowserView> {
    let info = refresh(&app, &state, &shared)?;
    Ok(view(&app, &shared, info))
}

#[tauri::command]
pub fn browser_save_settings<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    shared: State<'_, BrowserState>,
    input: BrowserSettings,
) -> CmdResult<BrowserView> {
    let dir = input.download_dir.trim();
    if !dir.is_empty() && !Path::new(dir).is_dir() {
        return Err(err(format!(
            "No encuentro la carpeta «{dir}»: escribe una carpeta que exista, por ejemplo D:\\Facturas"
        )));
    }
    with(&state, |s| s.browser_save_settings(&input))?;
    let info = refresh(&app, &state, &shared)?;
    Ok(view(&app, &shared, info))
}

#[tauri::command]
pub fn browser_grant<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    shared: State<'_, BrowserState>,
    uid: String,
    on: bool,
) -> CmdResult<BrowserView> {
    with(&state, |s| s.browser_grant(&uid, on))?;
    let info = refresh(&app, &state, &shared)?;
    Ok(view(&app, &shared, info))
}

/* ───────────── Navegar, leer y actuar ───────────── */

/// Abre una dirección permitida o la página de ingreso de un acceso guardado.
#[tauri::command]
pub async fn browser_open<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    shared: State<'_, BrowserState>,
    url: Option<String>,
    access: Option<String>,
) -> CmdResult<PageState> {
    refresh(&app, &state, &shared)?;
    let target = match (
        url.as_deref().map(str::trim),
        access.as_deref().map(str::trim),
    ) {
        (Some(u), _) if !u.is_empty() => u.to_string(),
        (_, Some(a)) if !a.is_empty() => with(&state, |s| s.browser_find_access(a))?.login_url,
        _ => {
            return Err(err(
                "indica una dirección https:// o el nombre de un acceso guardado",
            ));
        }
    };
    with(&state, |s| s.browser_check_url(&target))?;
    let parsed = Url::parse(&target).map_err(|_| err("esa dirección no es válida"))?;
    let shared = shared.inner().clone();
    blocking(move || {
        open_window(&app, &shared, parsed)?;
        wait_load(&shared, Duration::from_millis(600), Duration::from_secs(25));
        Ok(page_state(&app, &shared))
    })
    .await
}

#[tauri::command]
pub async fn browser_state<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    shared: State<'_, BrowserState>,
) -> CmdResult<PageState> {
    refresh(&app, &state, &shared)?;
    Ok(page_state(&app, &shared))
}

/// Texto y controles de la página, con todos sus marcos.
#[tauri::command]
pub async fn browser_read<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    shared: State<'_, BrowserState>,
) -> CmdResult<Value> {
    refresh(&app, &state, &shared)?;
    let shared = shared.inner().clone();
    blocking(move || {
        let w = window(&app)?;
        wait_load(&shared, Duration::ZERO, Duration::from_secs(15));
        let page = run_op(
            &w,
            &shared,
            json!({ "op": "leer" }),
            Duration::from_secs(15),
        )?;
        Ok(json!({ "state": page_state(&app, &shared), "page": page }))
    })
    .await
}

/// Una acción sobre la página: `target` es el número del control en la última lectura.
#[derive(Debug, serde::Deserialize)]
pub struct BrowserAction {
    pub op: String,
    pub target: Option<u32>,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub enter: bool,
    #[serde(default)]
    pub option: Option<String>,
}

/// Clic, escribir, elegir o volver. Después espera a que la página se asiente.
#[tauri::command]
pub async fn browser_act<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    shared: State<'_, BrowserState>,
    action: BrowserAction,
) -> CmdResult<Value> {
    refresh(&app, &state, &shared)?;
    if !["clic", "escribir", "elegir", "volver"].contains(&action.op.as_str()) {
        return Err(err("acción desconocida"));
    }
    if action.op != "volver" && action.target.is_none() {
        return Err(err(
            "indica el control (por ejemplo w12) de la última lectura",
        ));
    }
    let shared = shared.inner().clone();
    blocking(move || {
        let w = window(&app)?;
        let cmd = json!({
            "op": action.op, "ref": action.target, "texto": action.text, "enter": action.enter,
            "opcion": action.option,
        });
        let result = run_op(&w, &shared, cmd, Duration::from_secs(12))?;
        if result.get("error").is_none() {
            wait_load(&shared, Duration::from_millis(700), Duration::from_secs(20));
        }
        Ok(json!({ "state": page_state(&app, &shared), "result": result }))
    })
    .await
}

/// Lo que se guardó en la carpeta de descargas.
#[derive(Debug, Serialize)]
pub struct SavedFile {
    pub name: String,
    pub path: String,
    pub bytes: usize,
    pub pdf: bool,
    /// Texto leído del PDF, cuando se puede (documentos del SII): para anotarlo sin abrir el archivo.
    pub text: Option<String>,
}

/// Trae un archivo con la sesión de la página (el documento incrustado, un enlace o una dirección)
/// y lo guarda en la carpeta de descargas con el nombre indicado. No sobrescribe.
#[tauri::command]
pub async fn browser_save_file<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    shared: State<'_, BrowserState>,
    target: Option<u32>,
    url: Option<String>,
    name: String,
) -> CmdResult<SavedFile> {
    refresh(&app, &state, &shared)?;
    let name = safe_file_name(&name).map_err(CommandError::from)?;
    let url = url.map(|u| u.trim().to_string()).filter(|u| !u.is_empty());
    if let Some(u) = &url {
        with(&state, |s| s.browser_check_url(u))?;
    }
    let shared = shared.inner().clone();
    blocking(move || {
        let w = window(&app)?;
        let cmd = json!({ "op": "guardar", "ref": target, "url": url });
        let r = run_op(&w, &shared, cmd, Duration::from_secs(90))?;
        if let Some(e) = r.get("error").and_then(Value::as_str) {
            return Err(e.to_string());
        }
        let file = r.get("file").ok_or("la página no entregó el archivo")?;
        let pdf = file.get("pdf").and_then(Value::as_bool).unwrap_or(false);
        if file.get("html").and_then(Value::as_bool).unwrap_or(false) {
            return Err(
                "El sitio devolvió una página y no un archivo (¿se venció la sesión?). No guardé nada."
                    .into(),
            );
        }
        if name.to_lowercase().ends_with(".pdf") && !pdf {
            return Err("Lo que entregó el sitio no es un PDF. No guardé nada.".into());
        }
        let b64 = file.get("b64").and_then(Value::as_str).unwrap_or_default();
        let bytes = data_encoding::BASE64
            .decode(b64.as_bytes())
            .map_err(|_| "el archivo llegó dañado".to_string())?;
        if bytes.is_empty() {
            return Err("el archivo llegó vacío".into());
        }
        let dir = shared.dir();
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("No se pudo usar la carpeta {}: {e}", dir.display()))?;
        let path = dir.join(&name);
        let mut f = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::AlreadyExists {
                    format!("Ya existe {name} en {}: no lo sobrescribo.", dir.display())
                } else {
                    format!("No se pudo guardar {name}: {e}")
                }
            })?;
        std::io::Write::write_all(&mut f, &bytes).map_err(|e| e.to_string())?;
        let saved = SavedFile {
            name: name.clone(),
            path: path.to_string_lossy().into_owned(),
            bytes: bytes.len(),
            pdf,
            text: file
                .get("text")
                .and_then(Value::as_str)
                .filter(|t| !t.trim().is_empty())
                .map(str::to_string),
        };
        shared.note_download(Download {
            name,
            path: saved.path.clone(),
            ok: true,
            note: None,
        });
        Ok(saved)
    })
    .await
}

/// NÚCLEO rellena el ingreso con un acceso guardado. Exige el permiso que la persona dio hoy; la
/// clave va de la base a la página del mismo sitio y no vuelve en la respuesta.
#[tauri::command]
pub async fn browser_login<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    shared: State<'_, BrowserState>,
    access: String,
    submit: Option<bool>,
) -> CmdResult<Value> {
    refresh(&app, &state, &shared)?;
    let found = with(&state, |s| s.browser_find_access(&access))?;
    let login_host =
        host_of(&found.login_url).ok_or_else(|| err("la dirección del acceso no es https"))?;
    // El sitio donde vale la clave: el del acceso o, para e-Boleta, solo ese servidor.
    let site = nucleo_app::CompanySession::login_scope(&found.login_url)
        .unwrap_or_else(|| site_of(&login_host));
    let in_scope = |h: &str| h == site || h.ends_with(&format!(".{site}"));
    // Sin el permiso de hoy no se abre nada: el error explica dónde darlo.
    if !found.granted_today {
        with(&state, |s| {
            s.browser_login_data(&found.uid, None).map(|_| ())
        })?;
    }
    // Si la ventana no está en el sitio del acceso, primero va a su página de ingreso.
    let current = app
        .get_webview_window(LABEL)
        .and_then(|w| w.url().ok())
        .and_then(|u| host_of(u.as_str()));
    if !current.as_deref().is_some_and(in_scope) {
        let parsed = Url::parse(&found.login_url)
            .map_err(|_| err("la dirección del acceso no es válida"))?;
        let (a, sh) = (app.clone(), shared.inner().clone());
        blocking(move || {
            open_window(&a, &sh, parsed)?;
            wait_load(&sh, Duration::from_millis(600), Duration::from_secs(25));
            Ok(())
        })
        .await?;
    }
    let page_host = app
        .get_webview_window(LABEL)
        .and_then(|w| w.url().ok())
        .and_then(|u| host_of(u.as_str()))
        .ok_or_else(|| err("el navegador no está en una página https"))?;
    let data = with(&state, |s| {
        s.browser_login_data(&found.uid, Some(&page_host))
    })?;
    let shared = shared.inner().clone();
    let name = data.name.clone();
    blocking(move || {
        let w = window(&app)?;
        let cmd = json!({
            "op": "rellenar", "site": site, "usuario": data.username, "clave": data.secret,
            "enviar": submit.unwrap_or(true),
        });
        drop(data);
        let result = run_op(&w, &shared, cmd, Duration::from_secs(12))?;
        if result.get("error").is_none() {
            wait_load(&shared, Duration::from_millis(900), Duration::from_secs(25));
        }
        Ok(json!({ "state": page_state(&app, &shared), "result": result, "access": name }))
    })
    .await
}

/// Cierra la ventana si está abierta (al cerrar NÚCLEO o al salir de la sesión).
pub fn close<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.close();
    }
}

#[tauri::command]
pub async fn browser_close<R: Runtime>(app: AppHandle<R>) -> CmdResult<()> {
    close(&app);
    Ok(())
}
