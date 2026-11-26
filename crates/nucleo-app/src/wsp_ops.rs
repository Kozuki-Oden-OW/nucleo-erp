//! WhatsApp de la empresa (docs/INTEGRACIONES.md, I9): NÚCLEO lee los chats y envía mensajes por el
//! **puente de WhatsApp** (`integraciones/whatsapp`), un servicio que corre en este mismo computador
//! y está vinculado al número como «dispositivo vinculado» (QR una sola vez). No es la API de Meta.
//!
//! NÚCLEO no guarda las conversaciones: cada consulta va al puente en el momento. Aquí vive la
//! conexión (dirección y llave, que escribe la persona), los números que el agente no debe ver, el
//! permiso para que Claude envíe y el registro de lo enviado. Igual que el correo, las llamadas al
//! puente ocurren fuera de la sesión (preparar → llamar → registrar) y el transporte está detrás de
//! [`WspHttp`] para probar sin puente.

use crate::company::CompanySession;
use crate::sales_ops::log;
use crate::{AppError, AppResult};
use nucleo_db::integrations::{self as idb, IntegrationRow};
use nucleo_db::now_utc;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

pub const PROVIDER: &str = "whatsapp";
const MAX_TEXT: usize = 4000;
const MAX_FILE_BYTES: usize = 15 * 1024 * 1024;

/* ─────────────────────────────── Configuración ─────────────────────────────── */

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct WspConfig {
    /// Dirección del puente en este computador (http://127.0.0.1:47620).
    pub url: String,
    pub key: String,
    /// El dueño permite que Claude envíe los mensajes que él aprueba (apagado de fábrica).
    pub agent_send: bool,
    /// Teléfonos (solo dígitos) cuyos chats no se entregan a nadie por NÚCLEO: familia, personales.
    pub ignore: Vec<String>,
}

impl WspConfig {
    pub fn configured(&self) -> bool {
        !self.url.is_empty() && !self.key.is_empty()
    }
}

/// Lo que ve la interfaz (sin la llave).
#[derive(Debug, Clone, Serialize)]
pub struct WspStatus {
    pub configured: bool,
    pub url: String,
    pub has_key: bool,
    pub agent_send: bool,
    pub ignore: Vec<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct WspSetup {
    pub url: String,
    /// Vacía = conserva la guardada.
    pub key: String,
    pub agent_send: bool,
    pub ignore: Vec<String>,
}

/// Lo necesario para hablar con el puente sin tener tomada la sesión.
#[derive(Debug, Clone)]
pub struct WspLink {
    pub url: String,
    pub key: String,
    pub ignore: Vec<String>,
}

/* ─────────────────────────────── Lo que entrega el puente ─────────────────────────────── */

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct WspBridgeState {
    /// "iniciando", "qr", "listo" o "desconectado".
    pub estado: String,
    pub numero: Option<String>,
    pub nombre: Option<String>,
    /// Imagen `data:` del código QR mientras falta vincular el número.
    pub qr: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct WspLast {
    pub texto: String,
    pub de_mi: bool,
    pub fecha: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct WspChat {
    pub id: String,
    pub nombre: Option<String>,
    pub telefono: Option<String>,
    pub no_leidos: i64,
    pub grupo: bool,
    pub ultimo: Option<WspLast>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct WspMessage {
    pub id: String,
    pub de_mi: bool,
    pub texto: String,
    pub tipo: String,
    pub fecha: Option<String>,
    pub adjunto: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct WspConversation {
    pub chat: WspChat,
    pub mensajes: Vec<WspMessage>,
}

/// Mensaje a enviar: a un chat (su id) o a un teléfono; con texto y, si se pide, cotizaciones en PDF.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct WspDraft {
    pub chat: String,
    pub telefono: String,
    pub texto: String,
    pub quote_uids: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct WspFile {
    pub name: String,
    pub data: Vec<u8>,
}

/// Mensaje listo para salir (lo arma la sesión, lo envía el transporte).
#[derive(Debug, Clone)]
pub struct WspOutgoing {
    pub link: WspLink,
    pub chat: String,
    pub telefono: String,
    pub texto: String,
    pub files: Vec<WspFile>,
    /// Números de las cotizaciones adjuntas, para el registro.
    pub reference: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct WspSent {
    pub chat: String,
    pub mensajes: usize,
    pub reference: String,
}

/* ─────────────────────────────── Transporte ─────────────────────────────── */

pub trait WspHttp {
    fn get(&self, link: &WspLink, path: &str) -> Result<Value, String>;
    fn post(&self, link: &WspLink, path: &str, body: &Value) -> Result<Value, String>;
}

/// Cliente real: HTTP en este mismo computador, con la llave en la cabecera.
pub struct UreqBridge {
    agent: ureq::Agent,
}

impl Default for UreqBridge {
    fn default() -> Self {
        Self {
            agent: ureq::AgentBuilder::new()
                .timeout(std::time::Duration::from_secs(60))
                .user_agent(concat!("NucleoERP/", env!("CARGO_PKG_VERSION")))
                .build(),
        }
    }
}

fn bridge_result(r: Result<ureq::Response, ureq::Error>) -> Result<Value, String> {
    match r {
        Ok(resp) => resp
            .into_json::<Value>()
            .map_err(|e| format!("el puente respondió algo que no se entiende: {e}")),
        Err(ureq::Error::Status(401, _)) => Err(
            "el puente de WhatsApp rechazó la llave: revisa la que muestra Iniciar-WhatsApp.ps1"
                .into(),
        ),
        Err(ureq::Error::Status(_, resp)) => {
            let body: Value = resp.into_json().unwrap_or_default();
            Err(body["error"]
                .as_str()
                .unwrap_or("el puente de WhatsApp no pudo hacerlo")
                .to_string())
        }
        Err(_) => Err("no se pudo hablar con el puente de WhatsApp: ¿está abierto Docker y arrancado el puente (Iniciar-WhatsApp.ps1)?".into()),
    }
}

impl WspHttp for UreqBridge {
    fn get(&self, link: &WspLink, path: &str) -> Result<Value, String> {
        bridge_result(
            self.agent
                .get(&format!("{}{}", link.url, path))
                .set("Authorization", &format!("Bearer {}", link.key))
                .call(),
        )
    }
    fn post(&self, link: &WspLink, path: &str, body: &Value) -> Result<Value, String> {
        bridge_result(
            self.agent
                .post(&format!("{}{}", link.url, path))
                .set("Authorization", &format!("Bearer {}", link.key))
                .send_json(body.clone()),
        )
    }
}

fn digits(s: &str) -> String {
    s.chars().filter(char::is_ascii_digit).collect()
}

fn ignored(link: &WspLink, phone: Option<&str>) -> bool {
    let d = phone.map(digits).unwrap_or_default();
    !d.is_empty() && link.ignore.contains(&d)
}

/// Codifica el id de un chat para la ruta (`56911111111@c.us` → `56911111111%40c.us`).
fn path_id(id: &str) -> String {
    id.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

pub fn state(http: &dyn WspHttp, link: &WspLink) -> Result<WspBridgeState, String> {
    let v = http.get(link, "/estado")?;
    if v["puente"].as_str() != Some("nucleo-whatsapp") {
        return Err("en esa dirección no responde el puente de WhatsApp de NÚCLEO".into());
    }
    serde_json::from_value(v).map_err(|e| e.to_string())
}

/// Chats recientes, sin grupos y sin los números que el dueño dejó fuera.
pub fn chats(
    http: &dyn WspHttp,
    link: &WspLink,
    limit: i64,
    unread_only: bool,
) -> Result<Vec<WspChat>, String> {
    let limit = limit.clamp(1, 100);
    // Se piden algunos más por si parte de ellos queda fuera por la lista de números excluidos.
    let v = http.get(
        link,
        &format!(
            "/chats?limite={}{}",
            limit + link.ignore.len() as i64,
            if unread_only { "&no_leidos=1" } else { "" }
        ),
    )?;
    let all: Vec<WspChat> =
        serde_json::from_value(v["chats"].clone()).map_err(|e| e.to_string())?;
    Ok(all
        .into_iter()
        .filter(|c| !c.grupo && !ignored(link, c.telefono.as_deref()))
        .take(limit as usize)
        .collect())
}

pub fn conversation(
    http: &dyn WspHttp,
    link: &WspLink,
    chat: &str,
    limit: i64,
) -> Result<WspConversation, String> {
    if chat.trim().is_empty() {
        return Err("indica el chat".into());
    }
    let v = http.get(
        link,
        &format!(
            "/chats/{}/mensajes?limite={}",
            path_id(chat.trim()),
            limit.clamp(1, 100)
        ),
    )?;
    let c: WspConversation = serde_json::from_value(v).map_err(|e| e.to_string())?;
    if c.chat.grupo || ignored(link, c.chat.telefono.as_deref()) {
        return Err("ese chat está fuera de lo que NÚCLEO puede ver (grupo o número excluido en Configuración → Integraciones → WhatsApp)".into());
    }
    Ok(c)
}

/// Envía el texto y después cada archivo. Devuelve el chat donde quedó y cuántos mensajes salieron.
pub fn send(http: &dyn WspHttp, m: &WspOutgoing) -> Result<WspSent, String> {
    let target = |extra: Value| {
        let mut b = if m.chat.is_empty() {
            json!({ "telefono": m.telefono })
        } else {
            json!({ "chat": m.chat })
        };
        if let (Some(o), Some(e)) = (b.as_object_mut(), extra.as_object()) {
            o.extend(e.clone());
        }
        b
    };
    let mut chat = m.chat.clone();
    let mut sent = 0;
    if !m.texto.trim().is_empty() {
        let r = http.post(&m.link, "/enviar", &target(json!({ "texto": m.texto })))?;
        chat = r["chat"].as_str().unwrap_or(&chat).to_string();
        sent += 1;
    }
    for f in &m.files {
        let body = json!({ "texto": "", "archivo": { "nombre": f.name, "tipo": "application/pdf", "base64": data_encoding::BASE64.encode(&f.data) } });
        // Con el chat ya resuelto, los archivos van al mismo chat aunque se haya partido por teléfono.
        let body = if chat.is_empty() {
            target(body)
        } else {
            let mut b = body;
            b["chat"] = json!(chat);
            b
        };
        let r = http.post(&m.link, "/enviar", &body)?;
        chat = r["chat"].as_str().unwrap_or(&chat).to_string();
        sent += 1;
    }
    Ok(WspSent {
        chat,
        mensajes: sent,
        reference: m.reference.clone(),
    })
}

/* ─────────────────────────────── Sesión ─────────────────────────────── */

impl CompanySession {
    fn wsp_row(&self) -> AppResult<IntegrationRow> {
        Ok(
            idb::get(self.db.conn(), PROVIDER)?.unwrap_or(IntegrationRow {
                provider: PROVIDER.into(),
                config_json: "{}".into(),
                ..Default::default()
            }),
        )
    }

    fn wsp_config(&self) -> AppResult<WspConfig> {
        Ok(serde_json::from_str(&self.wsp_row()?.config_json).unwrap_or_default())
    }

    pub fn wsp_status(&self) -> AppResult<WspStatus> {
        self.require("config.ver")?;
        let c = self.wsp_config()?;
        Ok(WspStatus {
            configured: c.configured(),
            url: c.url.clone(),
            has_key: !c.key.is_empty(),
            agent_send: c.agent_send,
            ignore: c.ignore,
        })
    }

    /// Guarda la conexión con el puente. La llave la escribe la persona; vacía conserva la guardada.
    pub fn wsp_save(&mut self, s: &WspSetup) -> AppResult<WspStatus> {
        let user = self.require("config.editar")?.username.clone();
        let url = s.url.trim().trim_end_matches('/').to_lowercase();
        // El puente vive en este computador: no se aceptan direcciones de otra máquina ni de internet,
        // porque por ahí pasarían las conversaciones de los clientes.
        let local = ["http://127.0.0.1:", "http://localhost:"]
            .iter()
            .find_map(|p| url.strip_prefix(p))
            .is_some_and(|port| port.parse::<u16>().is_ok_and(|n| n > 0));
        if !local {
            return Err(AppError::Validation(
                "la dirección del puente debe ser la de este computador, por ejemplo http://127.0.0.1:47620".into(),
            ));
        }
        let mut c = self.wsp_config()?;
        if !s.key.trim().is_empty() {
            let k = s.key.trim();
            if k.len() < 24 || k.len() > 200 || k.chars().any(char::is_whitespace) {
                return Err(AppError::Validation(
                    "la llave del puente no es válida: cópiala completa desde Iniciar-WhatsApp.ps1"
                        .into(),
                ));
            }
            c.key = k.to_string();
        }
        if c.key.is_empty() {
            return Err(AppError::Validation(
                "falta la llave del puente (la muestra Iniciar-WhatsApp.ps1)".into(),
            ));
        }
        let mut ignore = Vec::new();
        for n in &s.ignore {
            let d = digits(n);
            if d.is_empty() {
                continue;
            }
            if d.len() < 8 || d.len() > 15 {
                return Err(AppError::Validation(format!(
                    "«{}» no parece un teléfono: escríbelo con código de país, por ejemplo +56 9 1234 5678",
                    n.trim()
                )));
            }
            if !ignore.contains(&d) {
                ignore.push(d);
            }
        }
        if ignore.len() > 200 {
            return Err(AppError::Validation("hasta 200 números excluidos".into()));
        }
        // Lo que Claude puede enviar y lo que no puede ver lo decide la persona, nunca el propio Claude.
        if self.via_agent && (s.agent_send != c.agent_send || ignore != c.ignore || url != c.url) {
            return Err(AppError::Validation(
                "la conexión de WhatsApp, los números excluidos y el permiso para que Claude envíe los cambia la persona en Configuración → Integraciones → WhatsApp".into(),
            ));
        }
        c.url = url.clone();
        c.agent_send = s.agent_send;
        c.ignore = ignore;
        let mut row = self.wsp_row()?;
        row.config_json =
            serde_json::to_string(&c).map_err(|e| AppError::Validation(e.to_string()))?;
        row.account_name = Some(url.clone());
        if row.connected_at.is_none() {
            row.connected_at = Some(now_utc());
        }
        idb::upsert(self.db.conn(), &row, &now_utc())?;
        log(
            self.db.conn(),
            &user,
            "update",
            "integracion",
            PROVIDER,
            &format!(
                "Configuró WhatsApp ({url}; Claude {} enviar; {} números excluidos)",
                if c.agent_send { "puede" } else { "no puede" },
                c.ignore.len()
            ),
            None,
        )?;
        self.wsp_status()
    }

    pub fn wsp_disconnect(&mut self) -> AppResult<WspStatus> {
        let user = self.require("config.editar")?.username.clone();
        if self.via_agent {
            return Err(AppError::Validation(
                "quitar la conexión de WhatsApp lo hace la persona".into(),
            ));
        }
        self.db
            .conn()
            .execute("DELETE FROM integrations WHERE provider = ?1", [PROVIDER])?;
        log(
            self.db.conn(),
            &user,
            "delete",
            "integracion",
            PROVIDER,
            "Quitó la conexión de WhatsApp",
            None,
        )?;
        self.wsp_status()
    }

    /// Datos para hablar con el puente (para leer chats o ver el estado).
    pub fn wsp_link(&self) -> AppResult<WspLink> {
        self.require("ventas.ver")?;
        let c = self.wsp_config()?;
        if !c.configured() {
            return Err(AppError::Validation(
                "WhatsApp no está conectado: la persona lo conecta en Configuración → Integraciones → WhatsApp (dirección y llave del puente)".into(),
            ));
        }
        Ok(WspLink {
            url: c.url,
            key: c.key,
            ignore: c.ignore,
        })
    }

    /// Valida el mensaje y lo deja listo para enviar (la persona ya lo aprobó).
    pub fn wsp_plan(&self, d: &WspDraft) -> AppResult<WspOutgoing> {
        self.require("ventas.crear")?;
        let cfg = self.wsp_config()?;
        let link = self.wsp_link()?;
        if self.via_agent && !cfg.agent_send {
            return Err(AppError::Validation(
                "Claude no tiene permiso para enviar mensajes de WhatsApp en este negocio. La persona lo activa en Configuración → Integraciones → WhatsApp («Permitir que Claude envíe los mensajes que apruebes»); mientras tanto, muéstrale el texto para que lo envíe ella".into(),
            ));
        }
        let chat = d.chat.trim().to_string();
        let phone = digits(&d.telefono);
        if chat.is_empty() && phone.is_empty() {
            return Err(AppError::Validation(
                "indica el chat o el teléfono del destinatario".into(),
            ));
        }
        if chat.is_empty() && (phone.len() < 8 || phone.len() > 15) {
            return Err(AppError::Validation(
                "el teléfono debe ir con código de país, por ejemplo +56 9 1234 5678".into(),
            ));
        }
        if chat.ends_with("@g.us") {
            return Err(AppError::Validation(
                "NÚCLEO no escribe en grupos de WhatsApp".into(),
            ));
        }
        let chat_phone = chat.strip_suffix("@c.us").map(digits);
        if ignored(&link, Some(&phone)) || ignored(&link, chat_phone.as_deref()) {
            return Err(AppError::Validation(
                "ese número está excluido en Configuración → Integraciones → WhatsApp".into(),
            ));
        }
        if d.texto.trim().is_empty() && d.quote_uids.is_empty() {
            return Err(AppError::Validation("falta el texto del mensaje".into()));
        }
        if d.texto.chars().count() > MAX_TEXT {
            return Err(AppError::Validation(
                "el mensaje es demasiado largo (máximo 4.000 caracteres)".into(),
            ));
        }
        if d.quote_uids.len() > 3 {
            return Err(AppError::Validation(
                "hasta 3 cotizaciones por mensaje".into(),
            ));
        }
        let mut files = Vec::new();
        let mut numbers = Vec::new();
        for uid in &d.quote_uids {
            let (number, path) = self.quote_pdf_path(uid)?;
            let data = std::fs::read(&path).map_err(|_| {
                AppError::Validation(format!(
                    "la cotización {number} aún no tiene su PDF en la carpeta: emítela primero («Emitir documento»)"
                ))
            })?;
            if !data.starts_with(b"%PDF-") || data.len() > MAX_FILE_BYTES {
                return Err(AppError::Validation(format!(
                    "el PDF de la cotización {number} no se puede adjuntar: vuelve a emitirla"
                )));
            }
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| format!("{number}.pdf"));
            files.push(WspFile { name, data });
            numbers.push(number);
        }
        Ok(WspOutgoing {
            link,
            chat,
            telefono: phone,
            texto: d.texto.trim().to_string(),
            files,
            reference: numbers.join(", "),
        })
    }

    /// Deja en la auditoría lo que se envió (o que falló) y por quién.
    pub fn wsp_record(
        &mut self,
        m: &WspOutgoing,
        result: &Result<WspSent, String>,
    ) -> AppResult<()> {
        let user = self.actor_name()?;
        let to = if m.chat.is_empty() {
            format!("+{}", m.telefono)
        } else {
            m.chat.clone()
        };
        let preview: String = m.texto.chars().take(120).collect();
        let what = match result {
            Ok(_) => format!(
                "Envió por WhatsApp a {to}: «{preview}»{}",
                if m.reference.is_empty() {
                    String::new()
                } else {
                    format!(" con {}", m.reference)
                }
            ),
            Err(e) => format!("No se pudo enviar por WhatsApp a {to}: {e}"),
        };
        log(
            self.db.conn(),
            &user,
            "create",
            "whatsapp",
            &to,
            &what,
            None,
        )?;
        Ok(())
    }
}
