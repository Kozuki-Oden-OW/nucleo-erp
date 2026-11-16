//! Acceso para Claude (agentes): NÚCLEO abre un servidor local, solo en 127.0.0.1 y con una llave al
//! azar, que recibe pedidos de herramientas y los pasa a la ventana para que los ejecute con la misma
//! interfaz y las mismas reglas que usa la persona. El servidor solo existe mientras la persona lo
//! tiene activado en Configuración → Claude.
//!
//! La app de Claude del computador se conecta lanzando `nucleo-erp.exe --mcp` (ver [`bridge`]): ese
//! proceso habla MCP por la entrada y salida estándar, entrega la lista de herramientas y reenvía cada
//! llamada al servidor local.

use crate::commands::AppState;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

/// Lista de herramientas compartida con la interfaz (`src/agent/tools.json`).
pub const TOOLS_JSON: &str = include_str!("../../src/agent/tools.json");
pub const SERVER_NAME: &str = "nucleo-erp";
const CONFIG_FILE: &str = "claude.json";
const ENDPOINT_FILE: &str = "agent-endpoint.json";
const CALL_TIMEOUT: Duration = Duration::from_secs(120);
const LEVELS: [&str; 3] = ["ver", "borradores", "completo"];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentConfig {
    pub enabled: bool,
    pub level: String,
}

impl Default for AgentConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            level: "ver".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Endpoint {
    pub port: u16,
    pub token: String,
}

struct Server {
    stop: Arc<AtomicBool>,
    endpoint: Endpoint,
}

pub struct AgentState {
    data_dir: PathBuf,
    config: Mutex<AgentConfig>,
    server: Mutex<Option<Server>>,
    pending: Mutex<HashMap<u64, Sender<String>>>,
    next: AtomicU64,
    calls: AtomicU64,
    last_call: Mutex<Option<String>>,
}

/// Lo que muestra la pantalla Configuración → Claude.
#[derive(Debug, Serialize)]
pub struct AgentView {
    pub enabled: bool,
    pub level: String,
    pub running: bool,
    pub calls: u64,
    pub last_call: Option<String>,
    pub exe_path: String,
    pub claude_config_path: Option<String>,
    pub claude_configured: bool,
}

impl AgentState {
    pub fn load(data_dir: &Path) -> Self {
        let config = std::fs::read(data_dir.join(CONFIG_FILE))
            .ok()
            .and_then(|b| serde_json::from_slice::<AgentConfig>(&b).ok())
            .unwrap_or_default();
        // Un archivo de un cierre anterior ya no sirve: el puerto y la llave cambian cada vez.
        let _ = std::fs::remove_file(data_dir.join(ENDPOINT_FILE));
        Self {
            data_dir: data_dir.to_path_buf(),
            config: Mutex::new(config),
            server: Mutex::new(None),
            pending: Mutex::new(HashMap::new()),
            next: AtomicU64::new(1),
            calls: AtomicU64::new(0),
            last_call: Mutex::new(None),
        }
    }

    pub fn config(&self) -> AgentConfig {
        self.config.lock().map(|c| c.clone()).unwrap_or_default()
    }

    fn view(&self) -> AgentView {
        let c = self.config();
        let exe = current_exe();
        let claude = claude_config_path();
        AgentView {
            enabled: c.enabled,
            level: c.level,
            running: self.server.lock().map(|s| s.is_some()).unwrap_or(false),
            calls: self.calls.load(Ordering::Relaxed),
            last_call: self.last_call.lock().ok().and_then(|l| l.clone()),
            claude_configured: claude
                .as_deref()
                .map(|p| claude_has_entry(p, &exe))
                .unwrap_or(false),
            claude_config_path: claude.map(|p| p.display().to_string()),
            exe_path: exe,
        }
    }

    fn save(&self) {
        let c = self.config();
        let _ = std::fs::create_dir_all(&self.data_dir);
        if let Ok(b) = serde_json::to_vec_pretty(&c) {
            let _ = std::fs::write(self.data_dir.join(CONFIG_FILE), b);
        }
    }

    /// Enciende o apaga el servidor según la configuración.
    pub fn apply<R: tauri::Runtime>(self: &Arc<Self>, app: &AppHandle<R>) {
        let want = self.config().enabled;
        let mut guard = match self.server.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        match (want, guard.is_some()) {
            (true, false) => match start_server(self.clone(), app.clone()) {
                Ok(s) => {
                    let _ = std::fs::create_dir_all(&self.data_dir);
                    if let Ok(b) = serde_json::to_vec(&s.endpoint) {
                        let _ = std::fs::write(self.data_dir.join(ENDPOINT_FILE), b);
                    }
                    *guard = Some(s);
                }
                Err(e) => eprintln!("acceso para Claude: no se pudo abrir el servidor local: {e}"),
            },
            (false, true) => {
                if let Some(s) = guard.take() {
                    s.stop.store(true, Ordering::SeqCst);
                }
                let _ = std::fs::remove_file(self.data_dir.join(ENDPOINT_FILE));
                // Llamadas en espera: se responden como canceladas.
                if let Ok(mut p) = self.pending.lock() {
                    p.clear();
                }
            }
            _ => {}
        }
    }
}

fn random_token() -> String {
    let mut b = [0u8; 24];
    if getrandom::fill(&mut b).is_err() {
        // Sin fuente de azar no se abre el acceso: la llave quedaría adivinable.
        return String::new();
    }
    hex::encode(b)
}

fn start_server<R: tauri::Runtime>(
    state: Arc<AgentState>,
    app: AppHandle<R>,
) -> std::io::Result<Server> {
    let token = random_token();
    if token.is_empty() {
        return Err(std::io::Error::other("sin fuente de azar"));
    }
    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    listener.set_nonblocking(true)?;
    let port = listener.local_addr()?.port();
    let stop = Arc::new(AtomicBool::new(false));
    let endpoint = Endpoint { port, token };
    let (stop2, ep) = (stop.clone(), endpoint.clone());
    std::thread::Builder::new()
        .name("nucleo-agent".into())
        .spawn(move || {
            while !stop2.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((stream, _)) => {
                        // De a una llamada a la vez: Claude trabaja paso a paso sobre la misma pantalla.
                        let _ = handle(stream, &state, &app, &ep, &stop2);
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(40));
                    }
                    Err(_) => std::thread::sleep(Duration::from_millis(200)),
                }
            }
        })?;
    Ok(Server { stop, endpoint })
}

struct Request {
    method: String,
    path: String,
    auth: Option<String>,
    body: Vec<u8>,
}

fn read_request(stream: &mut TcpStream) -> std::io::Result<Request> {
    stream.set_nonblocking(false)?;
    stream.set_read_timeout(Some(Duration::from_secs(15)))?;
    let mut buf = Vec::with_capacity(4096);
    let mut chunk = [0u8; 4096];
    let head_end = loop {
        let n = stream.read(&mut chunk)?;
        if n == 0 {
            return Err(std::io::Error::other("conexión cerrada"));
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break i;
        }
        if buf.len() > 64 * 1024 {
            return Err(std::io::Error::other("encabezado demasiado grande"));
        }
    };
    let head = String::from_utf8_lossy(&buf[..head_end]).to_string();
    let mut lines = head.split("\r\n");
    let first = lines.next().unwrap_or_default();
    let mut parts = first.split(' ');
    let method = parts.next().unwrap_or_default().to_string();
    let path = parts.next().unwrap_or_default().to_string();
    let mut len = 0usize;
    let mut auth = None;
    for l in lines {
        if let Some((k, v)) = l.split_once(':') {
            match k.trim().to_ascii_lowercase().as_str() {
                "content-length" => len = v.trim().parse().unwrap_or(0),
                "authorization" => auth = Some(v.trim().to_string()),
                _ => {}
            }
        }
    }
    if len > 4 * 1024 * 1024 {
        return Err(std::io::Error::other("pedido demasiado grande"));
    }
    let mut body = buf[head_end + 4..].to_vec();
    while body.len() < len {
        let n = stream.read(&mut chunk)?;
        if n == 0 {
            break;
        }
        body.extend_from_slice(&chunk[..n]);
    }
    body.truncate(len);
    Ok(Request {
        method,
        path,
        auth,
        body,
    })
}

fn respond(stream: &mut TcpStream, status: &str, body: &str) -> std::io::Result<()> {
    let msg = format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream.write_all(msg.as_bytes())?;
    stream.flush()
}

fn tool_error(text: &str) -> String {
    json!({ "content": [{ "type": "text", "text": text }], "isError": true }).to_string()
}

/// Compara la llave sin cortar en el primer carácter distinto.
fn same(a: &str, b: &str) -> bool {
    a.len() == b.len()
        && a.bytes()
            .zip(b.bytes())
            .fold(0u8, |acc, (x, y)| acc | (x ^ y))
            == 0
}

fn handle<R: tauri::Runtime>(
    mut stream: TcpStream,
    state: &AgentState,
    app: &AppHandle<R>,
    ep: &Endpoint,
    stop: &AtomicBool,
) -> std::io::Result<()> {
    let req = read_request(&mut stream)?;
    let ok_auth = req
        .auth
        .as_deref()
        .and_then(|a| a.strip_prefix("Bearer "))
        .is_some_and(|t| same(t, &ep.token));
    if !ok_auth {
        return respond(
            &mut stream,
            "401 Unauthorized",
            r#"{"error":"llave inválida"}"#,
        );
    }
    match (req.method.as_str(), req.path.as_str()) {
        ("GET", "/ping") => respond(
            &mut stream,
            "200 OK",
            &json!({ "ok": true, "level": state.config().level }).to_string(),
        ),
        ("POST", "/call") => {
            let call: Value = serde_json::from_slice(&req.body).unwrap_or(Value::Null);
            let name = call.get("name").and_then(Value::as_str).unwrap_or_default();
            let args = call.get("arguments").cloned().unwrap_or_else(|| json!({}));
            if name.is_empty() {
                return respond(&mut stream, "400 Bad Request", r#"{"error":"falta name"}"#);
            }
            let result = dispatch(state, app, name, args, stop);
            respond(&mut stream, "200 OK", &result)
        }
        _ => respond(&mut stream, "404 Not Found", r#"{"error":"no existe"}"#),
    }
}

fn mark_session<R: tauri::Runtime>(app: &AppHandle<R>, on: bool) {
    if let Some(s) = app.try_state::<AppState>()
        && let Ok(mut g) = s.session.lock()
        && let Some(sess) = g.as_mut()
    {
        sess.set_via_agent(on);
    }
}

fn dispatch<R: tauri::Runtime>(
    state: &AgentState,
    app: &AppHandle<R>,
    name: &str,
    args: Value,
    stop: &AtomicBool,
) -> String {
    if !state.config().enabled || stop.load(Ordering::SeqCst) {
        return tool_error(
            "El acceso de Claude a NÚCLEO está desactivado. Actívalo en Configuración → Claude.",
        );
    }
    let id = state.next.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = mpsc::channel();
    if let Ok(mut p) = state.pending.lock() {
        p.insert(id, tx);
    }
    state.calls.fetch_add(1, Ordering::Relaxed);
    if let Ok(mut l) = state.last_call.lock() {
        *l = Some(format!("{} · {name}", now_local()));
    }
    let payload = json!({ "id": id, "name": name, "arguments": args });
    let target = if app.get_webview_window("main").is_some() {
        "main".to_string()
    } else {
        app.webview_windows()
            .keys()
            .next()
            .cloned()
            .unwrap_or_default()
    };
    mark_session(app, true);
    let sent = app
        .emit_to(target.as_str(), "agent://call", payload)
        .is_ok();
    let out = if sent {
        match rx.recv_timeout(CALL_TIMEOUT) {
            Ok(r) => r,
            Err(mpsc::RecvTimeoutError::Timeout) => tool_error(
                "NÚCLEO no respondió a tiempo. Revisa que la ventana esté abierta y sin un diálogo del sistema encima.",
            ),
            Err(_) => {
                tool_error("La llamada se canceló (se desactivó el acceso o se cerró la ventana).")
            }
        }
    } else {
        tool_error("No hay una ventana de NÚCLEO abierta para atender la llamada.")
    };
    mark_session(app, false);
    if let Ok(mut p) = state.pending.lock() {
        p.remove(&id);
    }
    out
}

fn now_local() -> String {
    // Hora UTC en formato corto; la pantalla la muestra tal cual (basta para saber si hubo actividad).
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let (h, m, s) = ((secs / 3600) % 24, (secs / 60) % 60, secs % 60);
    format!("{h:02}:{m:02}:{s:02} UTC")
}

fn current_exe() -> String {
    std::env::current_exe()
        .map(|p| p.display().to_string())
        .unwrap_or_default()
}

/* ───────────── Configuración de la app de Claude ───────────── */

/// Archivo de configuración de la app de Claude para el computador.
pub fn claude_config_path() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    let base = std::env::var_os("APPDATA").map(PathBuf::from);
    #[cfg(target_os = "macos")]
    let base =
        std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Application Support"));
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let base = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")));
    base.map(|b| b.join("Claude").join("claude_desktop_config.json"))
}

fn claude_has_entry(path: &Path, exe: &str) -> bool {
    std::fs::read(path)
        .ok()
        .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
        .and_then(|v| {
            v.get("mcpServers")?
                .get(SERVER_NAME)?
                .get("command")?
                .as_str()
                .map(|c| c == exe)
        })
        .unwrap_or(false)
}

/// Agrega (o actualiza) NÚCLEO en la configuración de Claude sin tocar el resto. Guarda una copia del
/// archivo anterior junto a él.
pub fn write_claude_entry(path: &Path, exe: &str) -> Result<(), String> {
    let mut root: Value = match std::fs::read(path) {
        Ok(b) if !b.iter().all(u8::is_ascii_whitespace) => serde_json::from_slice(&b)
            .map_err(|e| format!("El archivo de configuración de Claude no es JSON válido ({e}); revísalo antes de conectar."))?,
        _ => json!({}),
    };
    if !root.is_object() {
        return Err("El archivo de configuración de Claude tiene un formato inesperado.".into());
    }
    if path.exists() {
        let _ = std::fs::copy(path, path.with_extension("json.bak"));
    }
    let servers = root
        .as_object_mut()
        .expect("objeto")
        .entry("mcpServers")
        .or_insert_with(|| json!({}));
    if !servers.is_object() {
        *servers = json!({});
    }
    servers.as_object_mut().expect("objeto").insert(
        SERVER_NAME.into(),
        json!({ "command": exe, "args": ["--mcp"] }),
    );
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    std::fs::write(path, text).map_err(|e| format!("No se pudo escribir {}: {e}", path.display()))
}

/* ───────────── Comandos IPC ───────────── */

#[tauri::command]
pub fn agent_settings(agent: State<'_, Arc<AgentState>>) -> AgentView {
    agent.view()
}

#[tauri::command]
pub fn agent_update<R: tauri::Runtime>(
    app: AppHandle<R>,
    agent: State<'_, Arc<AgentState>>,
    enabled: bool,
    level: String,
) -> Result<AgentView, String> {
    if !LEVELS.contains(&level.as_str()) {
        return Err(format!("Nivel desconocido: {level}"));
    }
    if let Ok(mut c) = agent.config.lock() {
        c.enabled = enabled;
        c.level = level;
    }
    agent.save();
    agent.inner().apply(&app);
    Ok(agent.view())
}

#[tauri::command]
pub fn agent_reply(agent: State<'_, Arc<AgentState>>, id: u64, result: String) {
    if let Ok(p) = agent.pending.lock()
        && let Some(tx) = p.get(&id)
    {
        let _ = tx.send(result);
    }
}

#[tauri::command]
pub fn agent_connect_claude(agent: State<'_, Arc<AgentState>>) -> Result<AgentView, String> {
    let path =
        claude_config_path().ok_or("No se encontró la carpeta de configuración de Claude.")?;
    write_claude_entry(&path, &current_exe())?;
    Ok(agent.view())
}

/* ───────────── Puente MCP (nucleo-erp.exe --mcp) ───────────── */

pub mod bridge {
    //! Proceso que lanza la app de Claude: habla MCP (JSON-RPC, un mensaje por línea) por la entrada y
    //! salida estándar. Responde la lista de herramientas por sí mismo, así Claude las conoce aunque
    //! NÚCLEO esté cerrado, y reenvía cada llamada al servidor local de la ventana abierta.
    use super::{ENDPOINT_FILE, Endpoint, SERVER_NAME, TOOLS_JSON, tool_error};
    use serde_json::{Value, json};
    use std::io::{BufRead, Read, Write};
    use std::net::TcpStream;
    use std::path::PathBuf;
    use std::time::Duration;

    const INSTRUCTIONS: &str = "NÚCLEO ERP es el sistema de gestión del negocio (ventas, clientes, productos, inventario, gastos, dinero e impuestos). \
Para trabajar en la pantalla: usa ver_pantalla, luego clic, escribir o elegir con los identificadores [eN] que entrega; cada acción devuelve la pantalla nueva. \
Para datos usa las herramientas directas (buscar_*, crear_*, registrar_gasto, crear_venta_borrador). Los montos están en pesos chilenos; los precios de productos son netos (sin IVA). \
No inventes RUT ni datos de clientes: si falta algo, pregúntalo. Nunca escribas contraseñas.";

    /// Carpeta de datos de NÚCLEO (la misma que usa la ventana: %LOCALAPPDATA%\NucleoERP en Windows).
    pub fn data_dir() -> Option<PathBuf> {
        #[cfg(target_os = "windows")]
        let base = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
        #[cfg(target_os = "macos")]
        let base =
            std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Application Support"));
        #[cfg(not(any(target_os = "windows", target_os = "macos")))]
        let base = std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")));
        base.map(|b| b.join("NucleoERP"))
    }

    pub fn tools_list() -> Value {
        let defs: Vec<Value> = serde_json::from_str(TOOLS_JSON).unwrap_or_default();
        let tools: Vec<Value> = defs
            .into_iter()
            .map(|d| {
                let nivel = d.get("nivel").and_then(Value::as_str).unwrap_or("ver").to_string();
                let need = match nivel.as_str() {
                    "completo" => " Requiere «Acceso completo».",
                    "borradores" => " Requiere «Crear borradores» o «Acceso completo».",
                    _ => "",
                };
                json!({
                    "name": d["name"],
                    "description": format!("{}{need}", d["description"].as_str().unwrap_or_default()),
                    "inputSchema": d["inputSchema"],
                    "annotations": { "readOnlyHint": nivel == "ver" },
                })
            })
            .collect();
        json!({ "tools": tools })
    }

    fn endpoint() -> Option<Endpoint> {
        let p = data_dir()?.join(ENDPOINT_FILE);
        serde_json::from_slice(&std::fs::read(p).ok()?).ok()
    }

    /// Reenvía la llamada a la ventana; devuelve el resultado MCP de la herramienta.
    pub fn forward(name: &str, args: &Value) -> Value {
        let closed = "NÚCLEO no está abierto o el acceso para Claude está desactivado. Abre NÚCLEO ERP y activa Configuración → Claude → «Permitir que Claude use NÚCLEO».";
        let Some(ep) = endpoint() else {
            return serde_json::from_str(&tool_error(closed)).unwrap_or(Value::Null);
        };
        match post(&ep, &json!({ "name": name, "arguments": args }).to_string()) {
            Ok((200, body)) => serde_json::from_str(&body).unwrap_or_else(|_| {
                serde_json::from_str(&tool_error("Respuesta inválida de NÚCLEO."))
                    .unwrap_or(Value::Null)
            }),
            Ok((401, _)) => {
                serde_json::from_str(&tool_error("NÚCLEO se reinició; vuelve a intentarlo."))
                    .unwrap_or(Value::Null)
            }
            Ok((code, body)) => {
                serde_json::from_str(&tool_error(&format!("NÚCLEO respondió {code}: {body}")))
                    .unwrap_or(Value::Null)
            }
            Err(_) => serde_json::from_str(&tool_error(closed)).unwrap_or(Value::Null),
        }
    }

    fn post(ep: &Endpoint, body: &str) -> std::io::Result<(u16, String)> {
        let mut s =
            TcpStream::connect_timeout(&([127, 0, 0, 1], ep.port).into(), Duration::from_secs(3))?;
        s.set_read_timeout(Some(Duration::from_secs(150)))?;
        let req = format!(
            "POST /call HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            ep.token,
            body.len()
        );
        s.write_all(req.as_bytes())?;
        let mut raw = Vec::new();
        s.read_to_end(&mut raw)?;
        let text = String::from_utf8_lossy(&raw).to_string();
        let (head, body) = text.split_once("\r\n\r\n").unwrap_or((&text, ""));
        let code = head
            .split(' ')
            .nth(1)
            .and_then(|c| c.parse().ok())
            .unwrap_or(0);
        Ok((code, body.to_string()))
    }

    /// Respuesta a un mensaje JSON-RPC (None para notificaciones).
    pub fn answer(msg: &Value) -> Option<Value> {
        let id = msg.get("id").cloned()?;
        let method = msg
            .get("method")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let params = msg.get("params").cloned().unwrap_or(Value::Null);
        let result = match method {
            "initialize" => json!({
                "protocolVersion": params.get("protocolVersion").and_then(Value::as_str).unwrap_or("2025-06-18"),
                "capabilities": { "tools": { "listChanged": false } },
                "serverInfo": { "name": SERVER_NAME, "title": "NÚCLEO ERP", "version": env!("CARGO_PKG_VERSION") },
                "instructions": INSTRUCTIONS,
            }),
            "ping" => json!({}),
            "tools/list" => tools_list(),
            "tools/call" => {
                let name = params
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let args = params
                    .get("arguments")
                    .cloned()
                    .unwrap_or_else(|| json!({}));
                forward(name, &args)
            }
            "resources/list" => json!({ "resources": [] }),
            "prompts/list" => json!({ "prompts": [] }),
            _ => {
                return Some(
                    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32601, "message": format!("Método no disponible: {method}") } }),
                );
            }
        };
        Some(json!({ "jsonrpc": "2.0", "id": id, "result": result }))
    }

    pub fn run() {
        let stdin = std::io::stdin();
        let mut out = std::io::stdout();
        for line in stdin.lock().lines() {
            let Ok(line) = line else { break };
            if line.trim().is_empty() {
                continue;
            }
            let reply = match serde_json::from_str::<Value>(&line) {
                Ok(msg) => answer(&msg),
                Err(_) => Some(
                    json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32700, "message": "JSON inválido" } }),
                ),
            };
            if let Some(r) = reply {
                if writeln!(out, "{r}").is_err() {
                    break;
                }
                let _ = out.flush();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tools_list_has_every_tool_with_schema() {
        let list = bridge::tools_list();
        let tools = list["tools"].as_array().unwrap();
        assert!(tools.len() >= 20);
        for t in tools {
            assert!(t["name"].is_string());
            assert_eq!(t["inputSchema"]["type"], "object");
        }
        assert!(tools.iter().any(|t| t["name"] == "ver_pantalla"));
    }

    #[test]
    fn bridge_answers_initialize_and_ignores_notifications() {
        let init = bridge::answer(&json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26"}})).unwrap();
        assert_eq!(init["result"]["protocolVersion"], "2025-03-26");
        assert_eq!(init["result"]["serverInfo"]["name"], SERVER_NAME);
        assert!(
            bridge::answer(&json!({"jsonrpc":"2.0","method":"notifications/initialized"}))
                .is_none()
        );
        let unknown = bridge::answer(&json!({"jsonrpc":"2.0","id":2,"method":"x/y"})).unwrap();
        assert_eq!(unknown["error"]["code"], -32601);
    }

    #[test]
    fn claude_config_is_merged_and_backed_up() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("Claude").join("claude_desktop_config.json");
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(
            &p,
            r#"{"mcpServers":{"otro":{"command":"x"}},"theme":"dark"}"#,
        )
        .unwrap();
        write_claude_entry(&p, "C:\\NucleoERP\\nucleo-erp.exe").unwrap();
        let v: Value = serde_json::from_slice(&std::fs::read(&p).unwrap()).unwrap();
        assert_eq!(v["theme"], "dark");
        assert_eq!(v["mcpServers"]["otro"]["command"], "x");
        assert_eq!(v["mcpServers"][SERVER_NAME]["args"][0], "--mcp");
        assert!(claude_has_entry(&p, "C:\\NucleoERP\\nucleo-erp.exe"));
        assert!(p.with_extension("json.bak").exists());
        // Un archivo dañado no se pisa.
        std::fs::write(&p, "{ roto").unwrap();
        assert!(write_claude_entry(&p, "x").is_err());
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "{ roto");
    }

    #[test]
    fn server_requires_token_and_relays_calls() {
        // Servidor sin ventana: con la llave correcta responde /ping; sin ella, 401.
        let (port, token) = {
            let l = TcpListener::bind(("127.0.0.1", 0)).unwrap();
            let port = l.local_addr().unwrap().port();
            let token = random_token();
            let t2 = token.clone();
            std::thread::spawn(move || {
                for _ in 0..2 {
                    let (mut s, _) = l.accept().unwrap();
                    let req = read_request(&mut s).unwrap();
                    let ok = req
                        .auth
                        .as_deref()
                        .and_then(|a| a.strip_prefix("Bearer "))
                        .is_some_and(|t| same(t, &t2));
                    if ok {
                        respond(&mut s, "200 OK", "{\"ok\":true}").unwrap()
                    } else {
                        respond(&mut s, "401 Unauthorized", "{}").unwrap()
                    }
                }
            });
            (port, token)
        };
        let good = Endpoint {
            port,
            token: token.clone(),
        };
        let bad = Endpoint {
            port,
            token: "0".repeat(token.len()),
        };
        let get = |ep: &Endpoint| {
            let mut s = TcpStream::connect(("127.0.0.1", ep.port)).unwrap();
            write!(
                s,
                "GET /ping HTTP/1.1\r\nAuthorization: Bearer {}\r\nContent-Length: 0\r\n\r\n",
                ep.token
            )
            .unwrap();
            let mut r = String::new();
            s.read_to_string(&mut r).unwrap();
            r
        };
        assert!(get(&bad).starts_with("HTTP/1.1 401"));
        assert!(get(&good).starts_with("HTTP/1.1 200"));
        assert_eq!(token.len(), 48);
    }
}
