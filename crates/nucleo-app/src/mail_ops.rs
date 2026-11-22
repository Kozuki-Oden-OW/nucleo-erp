//! Correo de la empresa (docs/INTEGRACIONES.md, I5): NÚCLEO envía avisos de despacho, recordatorios de
//! cobro y promociones **desde la casilla de la empresa** por SMTP, con usuario y clave de aplicación
//! guardados en la base cifrada.
//!
//! Cada correo lo inicia la persona: NÚCLEO arma un borrador con la plantilla y los datos (envío,
//! deuda del cliente), la persona lo revisa y lo envía. Igual que las otras conexiones, el envío ocurre
//! fuera de la sesión (preparar → enviar → registrar) y el transporte está detrás de [`MailTransport`]
//! para probar sin servidor.

use crate::company::CompanySession;
use crate::sales_ops::log;
use crate::{AppError, AppResult};
use nucleo_db::core as dbcore;
use nucleo_db::customers;
use nucleo_db::integrations::{self as idb, IntegrationRow};
use nucleo_db::now_utc;
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};

pub const PROVIDER: &str = "correo";
const TEMPLATES_KEY: &str = "correo.plantillas";

/* ─────────────────────────────── Configuración ─────────────────────────────── */

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct MailConfig {
    pub host: String,
    pub port: u16,
    /// "tls" (puerto 465), "starttls" (587) o "ninguna" (solo pruebas en la red local).
    pub security: String,
    pub username: String,
    pub password: String,
    pub from_name: String,
    pub from_email: String,
    pub reply_to: String,
    /// Enviar copia oculta a la misma casilla (para tener registro en «Enviados»).
    pub bcc_self: bool,
}

impl MailConfig {
    pub fn configured(&self) -> bool {
        !self.host.is_empty() && !self.from_email.is_empty() && !self.password.is_empty()
    }
}

/// Lo que ve la interfaz (sin la clave).
#[derive(Debug, Clone, Serialize)]
pub struct MailStatus {
    pub configured: bool,
    pub host: String,
    pub port: u16,
    pub security: String,
    pub username: String,
    pub has_password: bool,
    pub from_name: String,
    pub from_email: String,
    pub reply_to: String,
    pub bcc_self: bool,
    pub last_test_at: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct MailSetup {
    pub host: String,
    pub port: Option<u16>,
    pub security: String,
    pub username: String,
    /// Vacía = conserva la guardada.
    pub password: String,
    pub from_name: String,
    pub from_email: String,
    pub reply_to: String,
    pub bcc_self: bool,
}

/// Valores conocidos de servidores comunes (la persona puede cambiarlos).
#[derive(Debug, Clone, Serialize)]
pub struct MailPreset {
    pub name: &'static str,
    pub host: &'static str,
    pub port: u16,
    pub security: &'static str,
    pub note: &'static str,
}

pub fn presets() -> Vec<MailPreset> {
    vec![
        MailPreset {
            name: "Titan (Hostinger)",
            host: "smtp.titan.email",
            port: 465,
            security: "tls",
            note: "Usuario: la dirección completa; clave: la de la casilla.",
        },
        MailPreset {
            name: "Gmail / Google Workspace",
            host: "smtp.gmail.com",
            port: 465,
            security: "tls",
            note: "Requiere verificación en dos pasos y una «contraseña de aplicación».",
        },
        MailPreset {
            name: "Outlook / Microsoft 365",
            host: "smtp.office365.com",
            port: 587,
            security: "starttls",
            note: "El administrador debe permitir SMTP autenticado en la casilla.",
        },
        MailPreset {
            name: "Zoho Mail",
            host: "smtp.zoho.com",
            port: 465,
            security: "tls",
            note: "Con verificación en dos pasos, usa una contraseña de aplicación.",
        },
    ]
}

/* ─────────────────────────────── Plantillas ─────────────────────────────── */

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MailTemplate {
    pub subject: String,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MailTemplates {
    pub envio: MailTemplate,
    pub cobro: MailTemplate,
    pub promocion: MailTemplate,
}

impl Default for MailTemplates {
    fn default() -> Self {
        Self {
            envio: MailTemplate {
                subject: "Tu pedido va en camino — {empresa}".into(),
                body: "Hola {cliente}:\n\nTu pedido {venta} fue despachado por {courier}.\nNúmero de seguimiento: {seguimiento}\nDestino: {destino}\n\nCualquier duda, responde este correo.\n\nSaludos,\n{firma}".into(),
            },
            cobro: MailTemplate {
                subject: "Documentos pendientes de pago — {empresa}".into(),
                body: "Hola {cliente}:\n\nTe escribimos para recordarte los documentos pendientes de pago:\n\n{detalle}\n\nTotal pendiente: {total}{vencido}\n\nSi ya pagaste, por favor responde este correo con el comprobante y lo registramos. ¡Gracias!\n\nSaludos,\n{firma}".into(),
            },
            promocion: MailTemplate {
                subject: "Novedades de {empresa}".into(),
                body: "Hola {cliente}:\n\n(escribe aquí la promoción)\n\nSaludos,\n{firma}\n\nSi no quieres recibir más promociones, responde este correo con la palabra BAJA.".into(),
            },
        }
    }
}

/// Reemplaza `{campo}` por su valor; los campos desconocidos quedan tal cual.
pub fn render(template: &str, vars: &[(&str, String)]) -> String {
    let mut out = template.to_string();
    for (k, v) in vars {
        out = out.replace(&format!("{{{k}}}"), v);
    }
    out
}

fn clp(minor: i64) -> String {
    let neg = minor < 0;
    let digits = minor.unsigned_abs().to_string();
    let mut s = String::new();
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            s.push('.');
        }
        s.push(c);
    }
    format!("{}${s}", if neg { "-" } else { "" })
}

fn dmy(iso: &str) -> String {
    if iso.len() >= 10 {
        format!("{}-{}-{}", &iso[8..10], &iso[5..7], &iso[..4])
    } else {
        iso.to_string()
    }
}

/* ─────────────────────────────── Borradores y envío ─────────────────────────────── */

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct MailDraft {
    /// "prueba", "envio", "cobro", "promocion" u "otro".
    pub kind: String,
    pub to: String,
    pub subject: String,
    pub body: String,
    pub customer_uid: Option<String>,
    /// Envío o venta relacionada (número), para el registro.
    pub reference: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MailLogRow {
    pub id: i64,
    pub kind: String,
    pub to_addr: String,
    pub subject: String,
    pub customer_name: Option<String>,
    pub reference: Option<String>,
    pub status: String,
    pub error: Option<String>,
    pub user_name: String,
    pub sent_at: String,
}

/// Mensaje listo para salir (lo arma la sesión, lo envía el transporte).
#[derive(Debug, Clone)]
pub struct OutgoingMail {
    pub cfg: MailConfig,
    pub draft: MailDraft,
    pub customer_id: Option<i64>,
}

pub trait MailTransport {
    fn send(&self, mail: &OutgoingMail) -> Result<(), String>;
}

/// Envío real por SMTP (TLS con rustls y las raíces de Mozilla).
pub struct SmtpMail;

fn mailbox(name: &str, email: &str) -> Result<lettre::message::Mailbox, String> {
    let addr: lettre::Address = email
        .trim()
        .parse()
        .map_err(|_| format!("dirección no válida: {email}"))?;
    Ok(lettre::message::Mailbox::new(
        Some(name.trim().to_string()).filter(|n| !n.is_empty()),
        addr,
    ))
}

impl MailTransport for SmtpMail {
    fn send(&self, m: &OutgoingMail) -> Result<(), String> {
        use lettre::message::header::ContentType;
        use lettre::transport::smtp::authentication::Credentials;
        use lettre::{Message, SmtpTransport, Transport};
        let c = &m.cfg;
        let mut b = Message::builder()
            .from(mailbox(&c.from_name, &c.from_email)?)
            .subject(m.draft.subject.clone());
        for to in split_addrs(&m.draft.to) {
            b = b.to(mailbox("", &to)?);
        }
        if !c.reply_to.trim().is_empty() {
            b = b.reply_to(mailbox("", &c.reply_to)?);
        }
        if c.bcc_self {
            b = b.bcc(mailbox("", &c.from_email)?);
        }
        let msg = b
            .header(ContentType::TEXT_PLAIN)
            .body(m.draft.body.clone())
            .map_err(|e| format!("no se pudo armar el correo: {e}"))?;
        let builder = match c.security.as_str() {
            "tls" => SmtpTransport::relay(&c.host),
            "starttls" => SmtpTransport::starttls_relay(&c.host),
            _ => Ok(SmtpTransport::builder_dangerous(&c.host)),
        }
        .map_err(|e| format!("servidor no válido: {e}"))?;
        let user = if c.username.trim().is_empty() {
            c.from_email.clone()
        } else {
            c.username.clone()
        };
        let transport = builder
            .port(c.port)
            .credentials(Credentials::new(user, c.password.clone()))
            .timeout(Some(std::time::Duration::from_secs(30)))
            .build();
        transport.send(&msg).map(|_| ()).map_err(|e| {
            let t = e.to_string();
            if t.contains("535") || t.to_lowercase().contains("authentication") {
                "el servidor rechazó el usuario o la clave (en Gmail/Outlook usa una contraseña de aplicación)".into()
            } else {
                format!("no se pudo enviar: {t}")
            }
        })
    }
}

pub fn split_addrs(s: &str) -> Vec<String> {
    s.split([',', ';'])
        .map(|x| x.trim().to_string())
        .filter(|x| !x.is_empty())
        .collect()
}

fn valid_email(s: &str) -> bool {
    s.parse::<lettre::Address>().is_ok()
}

const KINDS: &[&str] = &["prueba", "envio", "cobro", "promocion", "otro"];

impl CompanySession {
    fn mail_row(&self) -> AppResult<IntegrationRow> {
        Ok(
            idb::get(self.db.conn(), PROVIDER)?.unwrap_or(IntegrationRow {
                provider: PROVIDER.into(),
                config_json: "{}".into(),
                ..Default::default()
            }),
        )
    }

    fn mail_config(&self) -> AppResult<MailConfig> {
        Ok(serde_json::from_str(&self.mail_row()?.config_json).unwrap_or_default())
    }

    pub fn mail_status(&self) -> AppResult<MailStatus> {
        self.require("config.ver")?;
        let row = self.mail_row()?;
        let c: MailConfig = serde_json::from_str(&row.config_json).unwrap_or_default();
        Ok(MailStatus {
            configured: c.configured(),
            host: c.host.clone(),
            port: c.port,
            security: if c.security.is_empty() {
                "tls".into()
            } else {
                c.security.clone()
            },
            username: c.username.clone(),
            has_password: !c.password.is_empty(),
            from_name: c.from_name.clone(),
            from_email: c.from_email.clone(),
            reply_to: c.reply_to.clone(),
            bcc_self: c.bcc_self,
            last_test_at: row.last_sync_at,
        })
    }

    /// Guarda la casilla de la empresa. La clave la escribe la persona; vacía conserva la guardada.
    pub fn mail_save(&mut self, s: &MailSetup) -> AppResult<MailStatus> {
        let user = self.require("config.editar")?.username.clone();
        let host = s.host.trim().to_lowercase();
        if host.is_empty() || host.len() > 120 || host.contains(['/', ' ', ':']) {
            return Err(AppError::Validation(
                "escribe el servidor SMTP sin «https://» ni puerto (ej. smtp.titan.email)".into(),
            ));
        }
        let security = match s.security.as_str() {
            "tls" | "starttls" | "ninguna" => s.security.clone(),
            "" => "tls".into(),
            _ => {
                return Err(AppError::Validation(
                    "seguridad: tls, starttls o ninguna".into(),
                ));
            }
        };
        let port = s
            .port
            .unwrap_or(if security == "starttls" { 587 } else { 465 });
        if port == 0 {
            return Err(AppError::Validation("puerto no válido".into()));
        }
        let from = s.from_email.trim().to_lowercase();
        if !valid_email(&from) {
            return Err(AppError::Validation(
                "la dirección del remitente no es válida".into(),
            ));
        }
        let reply = s.reply_to.trim().to_lowercase();
        if !reply.is_empty() && !valid_email(&reply) {
            return Err(AppError::Validation(
                "la dirección de respuesta no es válida".into(),
            ));
        }
        let mut c = self.mail_config()?;
        c.host = host;
        c.port = port;
        c.security = security;
        c.username = s.username.trim().to_string();
        if !s.password.is_empty() {
            if s.password.len() > 200 {
                return Err(AppError::Validation("la clave es demasiado larga".into()));
            }
            c.password = s.password.clone();
        }
        if c.password.is_empty() {
            return Err(AppError::Validation(
                "falta la clave de la casilla (o la contraseña de aplicación)".into(),
            ));
        }
        c.from_name = s.from_name.trim().chars().take(80).collect();
        c.from_email = from.clone();
        c.reply_to = reply;
        c.bcc_self = s.bcc_self;
        let mut row = self.mail_row()?;
        row.config_json =
            serde_json::to_string(&c).map_err(|e| AppError::Validation(e.to_string()))?;
        row.account_name = Some(from.clone());
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
            &format!("Configuró el correo de la empresa ({from})"),
            None,
        )?;
        self.mail_status()
    }

    pub fn mail_disconnect(&mut self) -> AppResult<MailStatus> {
        let user = self.require("config.editar")?.username.clone();
        self.db
            .conn()
            .execute("DELETE FROM integrations WHERE provider = ?1", [PROVIDER])?;
        log(
            self.db.conn(),
            &user,
            "delete",
            "integracion",
            PROVIDER,
            "Quitó el correo de la empresa",
            None,
        )?;
        self.mail_status()
    }

    pub fn mail_templates(&self) -> AppResult<MailTemplates> {
        self.require("ventas.ver")?;
        Ok(dbcore::get_setting(self.db.conn(), TEMPLATES_KEY)?
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default())
    }

    pub fn mail_save_templates(&mut self, t: &MailTemplates) -> AppResult<MailTemplates> {
        let user = self.require("config.editar")?.username.clone();
        for m in [&t.envio, &t.cobro, &t.promocion] {
            if m.subject.trim().is_empty() || m.body.trim().is_empty() {
                return Err(AppError::Validation(
                    "cada plantilla necesita asunto y texto".into(),
                ));
            }
            if m.subject.len() > 200 || m.body.len() > 20_000 {
                return Err(AppError::Validation(
                    "la plantilla es demasiado larga".into(),
                ));
            }
        }
        dbcore::set_setting(
            self.db.conn(),
            TEMPLATES_KEY,
            &serde_json::to_value(t).map_err(|e| AppError::Validation(e.to_string()))?,
        )?;
        log(
            self.db.conn(),
            &user,
            "update",
            "integracion",
            PROVIDER,
            "Cambió las plantillas de correo",
            None,
        )?;
        self.mail_templates()
    }

    fn mail_firma(&self) -> AppResult<(String, String)> {
        let b = self.business()?;
        let empresa = b
            .legal_name
            .clone()
            .filter(|s| !s.is_empty())
            .unwrap_or(b.name.clone());
        let mut firma = vec![b.name.clone()];
        if let Some(p) = b.phone.filter(|s| !s.is_empty()) {
            firma.push(p);
        }
        if let Some(e) = b.email.filter(|s| !s.is_empty()) {
            firma.push(e);
        }
        Ok((empresa, firma.join("\n")))
    }

    /// Borrador del aviso de despacho de un envío.
    pub fn mail_draft_shipment(&self, shipment_uid: &str) -> AppResult<MailDraft> {
        self.require("ventas.ver")?;
        let s = self
            .shipments(None)?
            .into_iter()
            .find(|x| x.uid == shipment_uid)
            .ok_or_else(|| AppError::NotFound("el envío".into()))?;
        let to = match s.customer_uid.as_deref() {
            Some(u) => customers::by_uid(self.db.conn(), u)?
                .and_then(|c| c.email)
                .unwrap_or_default(),
            None => String::new(),
        };
        let (empresa, firma) = self.mail_firma()?;
        let nombre = [s.first_name.clone(), s.last_name.clone()]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
            .join(" ");
        let cliente = s
            .customer_name
            .clone()
            .filter(|n| !n.is_empty())
            .unwrap_or(nombre);
        let destino = [s.address.clone(), s.commune.clone(), s.city.clone()]
            .into_iter()
            .flatten()
            .filter(|x| !x.is_empty())
            .collect::<Vec<_>>()
            .join(", ");
        let t = self.mail_templates()?.envio;
        let vars = [
            ("cliente", cliente),
            ("empresa", empresa),
            (
                "venta",
                s.sale_number.clone().unwrap_or_else(|| s.number.clone()),
            ),
            (
                "courier",
                s.carrier.clone().unwrap_or_else(|| "el courier".into()),
            ),
            (
                "seguimiento",
                s.tracking
                    .clone()
                    .unwrap_or_else(|| "(por informar)".into()),
            ),
            (
                "destino",
                if destino.is_empty() {
                    "—".into()
                } else {
                    destino
                },
            ),
            ("firma", firma),
        ];
        Ok(MailDraft {
            kind: "envio".into(),
            to,
            subject: render(&t.subject, &vars),
            body: render(&t.body, &vars),
            customer_uid: s.customer_uid.clone(),
            reference: Some(s.number.clone()),
        })
    }

    /// Borrador del recordatorio de cobro con todo lo que el cliente debe.
    pub fn mail_draft_collection(&self, customer_uid: &str) -> AppResult<MailDraft> {
        self.require("ventas.ver")?;
        let c = customers::by_uid(self.db.conn(), customer_uid)?
            .ok_or_else(|| AppError::NotFound("el cliente".into()))?;
        let today: String =
            self.db
                .conn()
                .query_row("SELECT date('now', 'localtime')", [], |r| r.get(0))?;
        let mut st = self.db.conn().prepare(
            "SELECT number, issue_date, due_date, total_minor - paid_minor FROM sales
             WHERE customer_id = ?1 AND commercial_state IN ('efectuada', 'cerrada') AND payment_state <> 'pagada'
               AND total_minor > paid_minor
             ORDER BY COALESCE(due_date, issue_date), id",
        )?;
        let rows: Vec<(String, String, Option<String>, i64)> = st
            .query_map([c.id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
            .collect::<Result<_, _>>()?;
        if rows.is_empty() {
            return Err(AppError::Validation(format!(
                "{} no tiene documentos pendientes de pago",
                c.name
            )));
        }
        let mut total = 0;
        let mut vencido = 0;
        let mut lines = Vec::new();
        for (num, fecha, vence, saldo) in &rows {
            total += saldo;
            let atrasado = vence.as_deref().is_some_and(|v| v < today.as_str());
            if atrasado {
                vencido += saldo;
            }
            lines.push(format!(
                "• {num} del {} — {}{}",
                dmy(fecha),
                clp(*saldo),
                match vence {
                    Some(v) if atrasado => format!(" (venció el {})", dmy(v)),
                    Some(v) => format!(" (vence el {})", dmy(v)),
                    None => String::new(),
                }
            ));
        }
        let (empresa, firma) = self.mail_firma()?;
        let t = self.mail_templates()?.cobro;
        let vars = [
            ("cliente", c.name.clone()),
            ("empresa", empresa),
            ("detalle", lines.join("\n")),
            ("total", clp(total)),
            (
                "vencido",
                if vencido > 0 {
                    format!(" (vencido: {})", clp(vencido))
                } else {
                    String::new()
                },
            ),
            ("firma", firma),
        ];
        Ok(MailDraft {
            kind: "cobro".into(),
            to: c.email.clone().unwrap_or_default(),
            subject: render(&t.subject, &vars),
            body: render(&t.body, &vars),
            customer_uid: Some(c.uid.clone()),
            reference: None,
        })
    }

    /// Borrador de promoción para un cliente.
    pub fn mail_draft_promotion(&self, customer_uid: &str) -> AppResult<MailDraft> {
        self.require("ventas.ver")?;
        let c = customers::by_uid(self.db.conn(), customer_uid)?
            .ok_or_else(|| AppError::NotFound("el cliente".into()))?;
        let (empresa, firma) = self.mail_firma()?;
        let t = self.mail_templates()?.promocion;
        let vars = [
            ("cliente", c.name.clone()),
            ("empresa", empresa),
            ("firma", firma),
        ];
        Ok(MailDraft {
            kind: "promocion".into(),
            to: c.email.clone().unwrap_or_default(),
            subject: render(&t.subject, &vars),
            body: render(&t.body, &vars),
            customer_uid: Some(c.uid.clone()),
            reference: None,
        })
    }

    /// Correo de prueba a la propia casilla (o a otra dirección).
    pub fn mail_test_plan(&self, to: Option<&str>) -> AppResult<OutgoingMail> {
        self.require("config.editar")?;
        let cfg = self.mail_config()?;
        let (empresa, firma) = self.mail_firma()?;
        let to = to
            .map(str::trim)
            .filter(|t| !t.is_empty())
            .map(String::from)
            .unwrap_or(cfg.from_email.clone());
        let draft = MailDraft {
            kind: "prueba".into(),
            to,
            subject: format!("Prueba de correo desde NÚCLEO — {empresa}"),
            body: format!(
                "Este es un correo de prueba enviado desde NÚCLEO ERP.\nSi lo recibes, el correo de la empresa quedó bien configurado.\n\n{firma}"
            ),
            ..Default::default()
        };
        self.mail_plan(&draft)
    }

    /// Valida el borrador y lo deja listo para enviar (la persona ya lo revisó).
    pub fn mail_plan(&self, d: &MailDraft) -> AppResult<OutgoingMail> {
        self.require("ventas.ver")?;
        let cfg = self.mail_config()?;
        if !cfg.configured() {
            return Err(AppError::Validation("configura primero el correo de la empresa (Configuración → Integraciones → Correo)".into()));
        }
        if !KINDS.contains(&d.kind.as_str()) {
            return Err(AppError::Validation("tipo de correo no válido".into()));
        }
        let to = split_addrs(&d.to);
        if to.is_empty() {
            return Err(AppError::Validation(
                "falta el destinatario (el cliente no tiene correo en su ficha)".into(),
            ));
        }
        if to.len() > 10 {
            return Err(AppError::Validation(
                "hasta 10 destinatarios por correo".into(),
            ));
        }
        if let Some(bad) = to.iter().find(|a| !valid_email(a)) {
            return Err(AppError::Validation(format!("dirección no válida: {bad}")));
        }
        if d.subject.trim().is_empty() || d.body.trim().is_empty() {
            return Err(AppError::Validation(
                "el correo necesita asunto y texto".into(),
            ));
        }
        if d.body.len() > 100_000 {
            return Err(AppError::Validation("el texto es demasiado largo".into()));
        }
        let customer_id = match d.customer_uid.as_deref().filter(|u| !u.is_empty()) {
            Some(u) => Some(
                customers::by_uid(self.db.conn(), u)?
                    .ok_or_else(|| AppError::NotFound("el cliente".into()))?
                    .id,
            ),
            None => None,
        };
        Ok(OutgoingMail {
            cfg,
            draft: MailDraft {
                to: to.join(", "),
                ..d.clone()
            },
            customer_id,
        })
    }

    /// Registra el resultado del envío (enviado o fallido) y la auditoría.
    pub fn mail_record(
        &mut self,
        m: &OutgoingMail,
        result: &Result<(), String>,
    ) -> AppResult<MailLogRow> {
        let user = self.actor_name()?;
        let now = now_utc();
        let (status, error) = match result {
            Ok(()) => ("enviado", None),
            Err(e) => ("fallido", Some(e.clone())),
        };
        self.db.conn().execute(
            "INSERT INTO email_log (kind, to_addr, subject, customer_id, ref, status, error, user_name, sent_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![m.draft.kind, m.draft.to, m.draft.subject, m.customer_id, m.draft.reference, status, error, user, now],
        )?;
        let id = self.db.conn().last_insert_rowid();
        if result.is_ok() {
            if m.draft.kind == "prueba" {
                let mut row = self.mail_row()?;
                row.last_sync_at = Some(now.clone());
                idb::upsert(self.db.conn(), &row, &now)?;
            }
            log(
                self.db.conn(),
                &user,
                "create",
                "correo",
                &id.to_string(),
                &format!("Envió el correo «{}» a {}", m.draft.subject, m.draft.to),
                None,
            )?;
        }
        self.mail_log_where("WHERE e.id = ?1", params![id], 1)?
            .pop()
            .ok_or_else(|| AppError::NotFound("el registro".into()))
    }

    fn mail_log_where(
        &self,
        filter: &str,
        p: impl rusqlite::Params,
        limit: i64,
    ) -> AppResult<Vec<MailLogRow>> {
        let sql = format!(
            "SELECT e.id, e.kind, e.to_addr, e.subject, c.name, e.ref, e.status, e.error, e.user_name, e.sent_at
             FROM email_log e LEFT JOIN customers c ON c.id = e.customer_id {filter} ORDER BY e.id DESC LIMIT {limit}"
        );
        let mut st = self.db.conn().prepare(&sql)?;
        let rows = st.query_map(p, |r| {
            Ok(MailLogRow {
                id: r.get(0)?,
                kind: r.get(1)?,
                to_addr: r.get(2)?,
                subject: r.get(3)?,
                customer_name: r.get(4)?,
                reference: r.get(5)?,
                status: r.get(6)?,
                error: r.get(7)?,
                user_name: r.get(8)?,
                sent_at: r.get(9)?,
            })
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// Correos enviados (todos o los de un cliente).
    pub fn mail_log(
        &self,
        customer_uid: Option<&str>,
        limit: Option<i64>,
    ) -> AppResult<Vec<MailLogRow>> {
        self.require("ventas.ver")?;
        let limit = limit.unwrap_or(100).clamp(1, 1000);
        match customer_uid.filter(|u| !u.is_empty()) {
            None => self.mail_log_where("", [], limit),
            Some(u) => {
                let id: Option<i64> = self
                    .db
                    .conn()
                    .query_row("SELECT id FROM customers WHERE uid = ?1", [u], |r| r.get(0))
                    .optional()?;
                let id = id.ok_or_else(|| AppError::NotFound("el cliente".into()))?;
                self.mail_log_where("WHERE e.customer_id = ?1", params![id], limit)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plantillas_y_formatos() {
        assert_eq!(
            render("Hola {cliente}, {otro}", &[("cliente", "Ana".into())]),
            "Hola Ana, {otro}"
        );
        assert_eq!(clp(1234567), "$1.234.567");
        assert_eq!(clp(500), "$500");
        assert_eq!(dmy("2026-11-22"), "22-11-2026");
        assert_eq!(split_addrs("a@b.cl; c@d.cl ,"), vec!["a@b.cl", "c@d.cl"]);
        assert!(valid_email("ventas@datalogger.cl") && !valid_email("ventas@"));
    }
}
