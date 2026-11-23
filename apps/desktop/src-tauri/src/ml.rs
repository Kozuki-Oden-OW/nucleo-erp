//! Comandos de Mercado Libre. La red se usa **sin** tener tomada la sesión: se prepara con la sesión,
//! se consulta a Mercado Libre fuera de ella y se aplica con la sesión.
//!
//! Conexión: «Conectar» abre el navegador en Mercado Libre y deja a NÚCLEO esperando en
//! `127.0.0.1:<puerto>` (el puerto va en `state`). La página de retorno `www.nucleoerp.cl/ml/`
//! redirige ahí con el código. Si eso falla, la persona pega el código o la dirección.

use crate::commands::{AppState, CommandError};
use nucleo_app::ml_ops::{self, MlManualOrder, MlStatus, MlSyncReport, UreqHttp};
use nucleo_app::nucleo_db::integrations::MlOrderRow;
use nucleo_app::{AppError, CompanySession};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::Mutex;
use std::sync::mpsc;
use std::time::{Duration, Instant};
use tauri::State;

type CmdResult<T> = Result<T, CommandError>;

/// Código recibido en `127.0.0.1` esperando a que la interfaz lo recoja.
/// Código y `state` que devolvió Mercado Libre.
type Code = (String, Option<String>);

static PENDING: Mutex<Option<mpsc::Receiver<Code>>> = Mutex::new(None);
/// Cuánto se espera la vuelta desde Mercado Libre.
const WAIT: Duration = Duration::from_secs(300);

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
pub fn ml_status(state: State<'_, AppState>) -> CmdResult<MlStatus> {
    with(&state, |s| s.ml_status())
}

#[tauri::command]
pub fn ml_save_app(
    state: State<'_, AppState>,
    client_id: String,
    client_secret: String,
    redirect_uri: Option<String>,
) -> CmdResult<MlStatus> {
    with(&state, |s| {
        s.ml_save_app(&client_id, &client_secret, redirect_uri.as_deref())
    })
}

/// Abre el navegador predeterminado.
fn open_browser(url: &str) -> std::io::Result<()> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", url])
            .creation_flags(0x0800_0000)
            .spawn()
            .map(|_| ())
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(url)
            .spawn()
            .map(|_| ())
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(url)
            .spawn()
            .map(|_| ())
    }
}

/// Lee `code` y `state` de la primera línea de la petición (`GET /ml?code=…&state=… HTTP/1.1`).
fn parse_request(req: &str) -> Option<(String, Option<String>)> {
    let path = req.lines().next()?.split_whitespace().nth(1)?;
    if !path.contains("code=") {
        return None;
    }
    ml_ops::code_from_input(&format!("http://127.0.0.1{path}"))
}

const PAGE: &str = "<!doctype html><meta charset=utf-8><title>NÚCLEO ERP</title>\
<body style=\"font-family:system-ui;margin:3rem;max-width:32rem\"><h2>Mercado Libre conectado</h2>\
<p>Ya puedes cerrar esta pestaña y volver a NÚCLEO.</p></body>";

/// Inicia la conexión: deja a NÚCLEO esperando la respuesta y abre Mercado Libre en el navegador.
/// Devuelve la dirección (por si el navegador no se abre, para copiarla).
#[tauri::command]
pub fn ml_connect(state: State<'_, AppState>) -> CmdResult<String> {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|e| err(format!("no se pudo esperar la respuesta: {e}")))?;
    let port = listener
        .local_addr()
        .map_err(|e| err(e.to_string()))?
        .port();
    let url = with(&state, |s| s.ml_auth_url(Some(port)))?;
    let (tx, rx) = mpsc::channel();
    *PENDING.lock().map_err(|_| err("bloqueado"))? = Some(rx);
    std::thread::spawn(move || {
        let _ = listener.set_nonblocking(true);
        let start = Instant::now();
        while start.elapsed() < WAIT {
            match listener.accept() {
                Ok((mut stream, _)) => {
                    let _ = stream.set_nonblocking(false);
                    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
                    let mut buf = [0u8; 4096];
                    let n = stream.read(&mut buf).unwrap_or(0);
                    let req = String::from_utf8_lossy(&buf[..n]).to_string();
                    let found = parse_request(&req);
                    let body = if found.is_some() {
                        PAGE
                    } else {
                        "Esperando a Mercado Libre…"
                    };
                    let _ = write!(
                        stream,
                        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    );
                    if let Some(f) = found {
                        let _ = tx.send(f);
                        return;
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(200));
                }
                Err(_) => return,
            }
        }
    });
    let _ = open_browser(&url);
    Ok(url)
}

/// Cambia el código por los tokens (la red va fuera de la sesión) y guarda la cuenta.
fn finish(state: &State<'_, AppState>, code: &str, st: Option<&str>) -> CmdResult<MlStatus> {
    let cfg = with(state, |s| s.ml_check_state(st))?;
    let http = UreqHttp::default();
    let tokens = ml_ops::exchange_code(&http, &cfg, code).map_err(|e| err(e.to_string()))?;
    let (id, nick) = ml_ops::me(&http, &tokens.access_token).map_err(|e| err(e.to_string()))?;
    with(state, |s| s.ml_connected(&tokens, &id, nick.as_deref()))
}

/// Espera (hasta 5 minutos) a que el navegador vuelva con el código y termina la conexión.
#[tauri::command]
pub async fn ml_wait(state: State<'_, AppState>) -> CmdResult<MlStatus> {
    let rx = PENDING
        .lock()
        .map_err(|_| err("bloqueado"))?
        .take()
        .ok_or_else(|| err("primero presiona «Conectar»"))?;
    let got = tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(WAIT))
        .await
        .map_err(|e| err(e.to_string()))?
        .map_err(|_| {
            err("no llegó la respuesta de Mercado Libre: pega el código que te muestra la página")
        })?;
    finish(&state, &got.0, got.1.as_deref())
}

/// Termina la conexión con el código (o la dirección completa) que pegó la persona.
#[tauri::command]
pub async fn ml_finish(state: State<'_, AppState>, input: String) -> CmdResult<MlStatus> {
    let (code, st) = ml_ops::code_from_input(&input)
        .ok_or_else(|| err("pega el código que te mostró la página"))?;
    finish(&state, &code, st.as_deref())
}

#[tauri::command]
pub fn ml_disconnect(state: State<'_, AppState>) -> CmdResult<MlStatus> {
    with(&state, |s| s.ml_disconnect())
}

/// Trae los pedidos desde `from` (AAAA-MM-DD; vacío = últimos 15 días) y los pasa a ventas.
#[tauri::command]
pub async fn ml_sync(state: State<'_, AppState>, from: Option<String>) -> CmdResult<MlSyncReport> {
    let mut plan = with(&state, |s| s.ml_sync_plan(from.as_deref()))?;
    let (plan, orders) = tauri::async_runtime::spawn_blocking(move || {
        let r = ml_ops::fetch(&UreqHttp::default(), &mut plan);
        (plan, r)
    })
    .await
    .map_err(|e| err(e.to_string()))?;
    let orders = orders.map_err(|e| err(e.to_string()))?;
    with(&state, |s| s.ml_apply(&plan, &orders))
}

/// Registra ventas leídas en el portal de vendedores (sin la conexión por API): no usa la red.
#[tauri::command]
pub fn ml_register_manual(
    state: State<'_, AppState>,
    orders: Vec<MlManualOrder>,
) -> CmdResult<MlSyncReport> {
    with(&state, |s| s.ml_register_manual(&orders))
}

#[tauri::command]
pub fn ml_orders(state: State<'_, AppState>, limit: Option<i64>) -> CmdResult<Vec<MlOrderRow>> {
    with(&state, |s| s.ml_orders(limit))
}

#[tauri::command]
pub fn ml_link_item(
    state: State<'_, AppState>,
    item_id: String,
    variation_id: Option<String>,
    product_uid: String,
    title: Option<String>,
) -> CmdResult<()> {
    with(&state, |s| {
        s.ml_link_item(
            &item_id,
            variation_id.as_deref(),
            &product_uid,
            title.as_deref(),
        )
    })
}

#[cfg(test)]
mod tests {
    use super::parse_request;

    #[test]
    fn lee_codigo_de_la_peticion() {
        assert_eq!(
            parse_request("GET /ml?code=TG-1-2&state=5000.ab HTTP/1.1\r\nHost: x\r\n\r\n"),
            Some(("TG-1-2".into(), Some("5000.ab".into())))
        );
        assert_eq!(parse_request("GET /favicon.ico HTTP/1.1\r\n\r\n"), None);
    }
}
