//! Facturación electrónica propia con el SII (fase F2 de `docs/SII_FACTURACION_PROPIA.md`):
//! configuración del emisor, certificado digital y folios (CAF) guardados en la base cifrada,
//! timbre y firma de documentos con control de folios, y conversación con el SII (semilla → token →
//! envío → estado).
//!
//! Igual que Mercado Libre, la red se usa **fuera** de la sesión: se prepara con la sesión (plan),
//! se habla con el SII sin ella y se aplica el resultado con ella. El acceso HTTP está detrás de
//! [`SiiHttp`] para probar sin internet.
//!
//! Reglas: un folio nunca se usa dos veces (se reserva en la misma transacción que guarda el
//! documento); el certificado y su clave nunca salen de la base salvo para firmar; certificación y
//! producción no se mezclan.

use crate::company::CompanySession;
use crate::sales_ops::log;
use crate::{AppError, AppResult};
use nucleo_db::now_utc;
use nucleo_dte::envio::{Caratula, envio_dte};
use nucleo_dte::sii::{self, Ambiente, EstadoEnvio};
use nucleo_dte::{Caf, Certificate, Detalle, Dte, DteError, Emisor, Receptor, Referencia, TipoDte};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};

/// Agente que el SII exige para la subida de envíos (documentado en su manual de envío).
const UPLOAD_AGENT: &str = "Mozilla/4.0 (compatible; PROG 1.0; Windows NT 5.0; YComp 5.0.2.4)";

impl From<DteError> for AppError {
    fn from(e: DteError) -> Self {
        AppError::Validation(e.to_string())
    }
}

/* ─────────────────────────────── Configuración ─────────────────────────────── */

/// Datos del emisor como los tiene el SII (lo que no está en «Mi negocio»).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct SiiEmisor {
    pub giro: String,
    pub actecos: Vec<u32>,
    /// Dirección de la casa matriz; vacía = la de «Mi negocio».
    pub direccion: String,
    pub comuna: String,
    pub ciudad: String,
    pub sucursal: Option<u32>,
    /// RUT de la persona dueña del certificado, si el certificado no lo trae.
    pub rut_envia: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SiiSetup {
    pub ambiente: Ambiente,
    pub emisor: SiiEmisor,
    pub resolucion_fecha: Option<String>,
    pub resolucion_numero: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SiiCertInfo {
    pub nombre: Option<String>,
    pub rut: Option<String>,
    pub vence: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SiiFolios {
    pub id: i64,
    pub ambiente: Ambiente,
    pub tipo: u16,
    pub tipo_nombre: String,
    pub desde: u64,
    pub hasta: u64,
    pub siguiente: u64,
    pub restantes: u64,
    pub autorizado: String,
}

/// Lo que ve la interfaz (sin el certificado ni su clave).
#[derive(Debug, Clone, Serialize)]
pub struct SiiStatus {
    pub ambiente: Ambiente,
    pub rut: Option<String>,
    pub razon_social: Option<String>,
    pub emisor: SiiEmisor,
    pub resolucion_fecha: Option<String>,
    pub resolucion_numero: Option<u32>,
    pub certificado: Option<SiiCertInfo>,
    pub folios: Vec<SiiFolios>,
    /// Lo que falta para poder emitir en el ambiente actual.
    pub faltantes: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SiiDocument {
    pub id: i64,
    pub ambiente: Ambiente,
    pub tipo: u16,
    pub tipo_nombre: String,
    pub folio: u64,
    pub fecha: String,
    pub receptor_rut: String,
    pub receptor: String,
    pub total_minor: i64,
    pub estado: String,
    pub track_id: Option<String>,
    pub glosa: Option<String>,
    pub created_at: String,
}

/// Documento a emitir (sin folio: lo asigna NÚCLEO desde los CAF cargados).
#[derive(Debug, Clone, Deserialize)]
pub struct SiiIssueInput {
    pub tipo: u16,
    /// AAAA-MM-DD; vacío = hoy.
    pub fecha: Option<String>,
    pub receptor: Receptor,
    pub detalle: Vec<Detalle>,
    #[serde(default)]
    pub referencias: Vec<Referencia>,
    pub forma_pago: Option<u8>,
    pub vencimiento: Option<String>,
    pub ind_traslado: Option<u8>,
    pub tipo_despacho: Option<u8>,
    /// Venta de NÚCLEO que documenta, si corresponde.
    pub sale_uid: Option<String>,
}

/* ─────────────────────────────── Acceso HTTP ─────────────────────────────── */

pub trait SiiHttp {
    /// POST con el cuerpo dado; devuelve el cuerpo de la respuesta como texto.
    fn post(
        &self,
        url: &str,
        content_type: &str,
        headers: &[(&str, &str)],
        body: &[u8],
    ) -> Result<String, String>;
}

pub struct UreqSii {
    agent: ureq::Agent,
}

impl Default for UreqSii {
    fn default() -> Self {
        Self {
            agent: ureq::AgentBuilder::new()
                .timeout(std::time::Duration::from_secs(60))
                .build(),
        }
    }
}

fn text_of(bytes: Vec<u8>) -> String {
    match String::from_utf8(bytes) {
        Ok(s) => s,
        Err(e) => nucleo_dte::xml::from_latin1(e.as_bytes()),
    }
}

impl SiiHttp for UreqSii {
    fn post(
        &self,
        url: &str,
        content_type: &str,
        headers: &[(&str, &str)],
        body: &[u8],
    ) -> Result<String, String> {
        let mut req = self.agent.post(url).set("Content-Type", content_type);
        for (k, v) in headers {
            req = req.set(k, v);
        }
        let read = |r: ureq::Response| {
            let mut b = Vec::new();
            std::io::Read::read_to_end(&mut r.into_reader(), &mut b).map(|_| b)
        };
        match req.send_bytes(body) {
            Ok(r) => read(r).map(text_of).map_err(|e| e.to_string()),
            Err(ureq::Error::Status(code, r)) => {
                let b = read(r).map(text_of).unwrap_or_default();
                Err(format!(
                    "el SII respondió {code}: {}",
                    b.chars().take(200).collect::<String>()
                ))
            }
            Err(e) => Err(e.to_string()),
        }
    }
}

fn net(e: String) -> AppError {
    AppError::Validation(format!("no se pudo conectar con el SII: {e}"))
}

fn soap_post(http: &dyn SiiHttp, url: &str, body: &str) -> AppResult<String> {
    http.post(
        url,
        "text/xml; charset=utf-8",
        &[("SOAPAction", "\"\"")],
        body.as_bytes(),
    )
    .map_err(net)
}

/// Pide semilla y token con el certificado. El token sirve unos minutos.
pub fn get_token(http: &dyn SiiHttp, amb: Ambiente, cert: &Certificate) -> AppResult<String> {
    let seed = sii::parse_seed(&soap_post(http, &amb.seed_url(), &sii::seed_request())?)?;
    let xml = sii::token_xml(&seed, cert)?;
    Ok(sii::parse_token(&soap_post(
        http,
        &amb.token_url(),
        &sii::token_request(&xml),
    )?)?)
}

/* ─────────────────────────────── Planes (red fuera de la sesión) ─────────────────────────────── */

/// Todo lo necesario para hablar con el SII sin la sesión.
pub struct SiiCredentials {
    pub ambiente: Ambiente,
    pub p12: Vec<u8>,
    pub password: String,
    pub rut_envia: String,
    pub rut_emisor: String,
}

impl SiiCredentials {
    pub fn certificate(&self) -> AppResult<Certificate> {
        Ok(Certificate::from_pkcs12(&self.p12, &self.password)?)
    }
}

pub struct SendPlan {
    pub cred: SiiCredentials,
    pub ids: Vec<i64>,
    pub file_name: String,
    pub envio: Vec<u8>,
}

/// Sube el sobre y devuelve el número de seguimiento.
pub fn send(http: &dyn SiiHttp, plan: &SendPlan) -> AppResult<String> {
    let cert = plan.cred.certificate()?;
    let token = get_token(http, plan.cred.ambiente, &cert)?;
    let boundary = format!("----NucleoERP{}", std::process::id());
    let (ct, body) = sii::upload_body(
        &plan.cred.rut_envia,
        &plan.cred.rut_emisor,
        &plan.file_name,
        &plan.envio,
        &boundary,
    )?;
    let cookie = format!("TOKEN={token}");
    let resp = http
        .post(
            &plan.cred.ambiente.upload_url(),
            &ct,
            &[("Cookie", &cookie), ("User-Agent", UPLOAD_AGENT)],
            &body,
        )
        .map_err(net)?;
    Ok(sii::parse_upload(&resp)?.track_id)
}

/// Consulta el estado de un envío.
pub fn check(http: &dyn SiiHttp, cred: &SiiCredentials, track_id: &str) -> AppResult<EstadoEnvio> {
    let cert = cred.certificate()?;
    let token = get_token(http, cred.ambiente, &cert)?;
    let req = sii::status_request(&cred.rut_emisor, track_id, &token)?;
    Ok(sii::parse_status(&soap_post(
        http,
        &cred.ambiente.status_url(),
        &req,
    )?)?)
}

/* ─────────────────────────────── Sesión ─────────────────────────────── */

struct ConfigRow {
    ambiente: Ambiente,
    emisor: SiiEmisor,
    resolucion_fecha: Option<String>,
    resolucion_numero: Option<u32>,
    cert_p12: Option<Vec<u8>>,
    cert_password: Option<String>,
    cert_name: Option<String>,
    cert_rut: Option<String>,
    cert_expires: Option<String>,
}

fn tipo_nombre(t: u16) -> String {
    TipoDte::from_code(t)
        .map(|t| t.name().to_string())
        .unwrap_or_else(|| format!("tipo {t}"))
}

fn norm_rut(r: &str) -> String {
    nucleo_dte::dte::normalize_rut(r)
}

/// RUT en el formato del SII: sin puntos, con guion y DV en mayúscula.
fn fmt_rut(r: &str) -> String {
    let n = norm_rut(r);
    if n.len() < 2 {
        return n;
    }
    let (a, b) = n.split_at(n.len() - 1);
    format!("{a}-{b}")
}

fn valid_date(d: &str) -> bool {
    d.len() == 10
        && d.as_bytes()[4] == b'-'
        && d.as_bytes()[7] == b'-'
        && d.chars().filter(|c| c.is_ascii_digit()).count() == 8
}

impl CompanySession {
    fn sii_row(&self) -> AppResult<ConfigRow> {
        let row = self
            .db
            .conn()
            .query_row(
                "SELECT ambiente, emisor_json, resolucion_fecha, resolucion_numero, cert_p12, cert_password,
                        cert_name, cert_rut, cert_expires FROM sii_config WHERE id = 1",
                [],
                |r| {
                    Ok(ConfigRow {
                        ambiente: Ambiente::parse(&r.get::<_, String>(0)?).unwrap_or(Ambiente::Certificacion),
                        emisor: serde_json::from_str(&r.get::<_, String>(1)?).unwrap_or_default(),
                        resolucion_fecha: r.get(2)?,
                        resolucion_numero: r.get(3)?,
                        cert_p12: r.get(4)?,
                        cert_password: r.get(5)?,
                        cert_name: r.get(6)?,
                        cert_rut: r.get(7)?,
                        cert_expires: r.get(8)?,
                    })
                },
            )
            .optional()?;
        Ok(row.unwrap_or(ConfigRow {
            ambiente: Ambiente::Certificacion,
            emisor: SiiEmisor::default(),
            resolucion_fecha: None,
            resolucion_numero: None,
            cert_p12: None,
            cert_password: None,
            cert_name: None,
            cert_rut: None,
            cert_expires: None,
        }))
    }

    fn sii_ensure_row(&self) -> AppResult<()> {
        self.db.conn().execute(
            "INSERT INTO sii_config (id, updated_at) VALUES (1, ?1) ON CONFLICT (id) DO NOTHING",
            [now_utc()],
        )?;
        Ok(())
    }

    fn sii_emisor(&self, c: &ConfigRow) -> AppResult<Emisor> {
        let b = self.business()?;
        Ok(Emisor {
            rut: b.rut.as_deref().map(fmt_rut).unwrap_or_default(),
            razon_social: b
                .legal_name
                .clone()
                .or(Some(b.name.clone()))
                .unwrap_or_default(),
            giro: c.emisor.giro.clone(),
            actecos: c.emisor.actecos.clone(),
            direccion: if c.emisor.direccion.trim().is_empty() {
                b.address.clone().unwrap_or_default()
            } else {
                c.emisor.direccion.clone()
            },
            comuna: c.emisor.comuna.clone(),
            ciudad: Some(c.emisor.ciudad.clone()).filter(|s| !s.is_empty()),
            telefono: b.phone.clone(),
            correo: b.email.clone(),
            cdg_sii_sucur: c.emisor.sucursal,
        })
    }

    fn sii_folios(&self, amb: Option<Ambiente>) -> AppResult<Vec<SiiFolios>> {
        let mut st = self.db.conn().prepare(
            "SELECT id, ambiente, tipo, desde, hasta, siguiente, autorizado FROM sii_cafs ORDER BY ambiente, tipo, desde",
        )?;
        let rows = st.query_map([], |r| {
            let tipo: u16 = r.get(2)?;
            let hasta: i64 = r.get(4)?;
            let sig: i64 = r.get(5)?;
            Ok(SiiFolios {
                id: r.get(0)?,
                ambiente: Ambiente::parse(&r.get::<_, String>(1)?)
                    .unwrap_or(Ambiente::Certificacion),
                tipo,
                tipo_nombre: tipo_nombre(tipo),
                desde: r.get::<_, i64>(3)? as u64,
                hasta: hasta as u64,
                siguiente: sig as u64,
                restantes: (hasta - sig + 1).max(0) as u64,
                autorizado: r.get(6)?,
            })
        })?;
        let mut out = Vec::new();
        for f in rows {
            let f = f?;
            if amb.is_none_or(|a| a == f.ambiente) {
                out.push(f);
            }
        }
        Ok(out)
    }

    pub fn sii_status(&self) -> AppResult<SiiStatus> {
        self.require("config.ver")?;
        let c = self.sii_row()?;
        let e = self.sii_emisor(&c)?;
        let folios = self.sii_folios(None)?;
        let mut faltantes = Vec::new();
        if e.rut.is_empty() {
            faltantes.push("el RUT de la empresa (Configuración → Mi negocio)".into());
        }
        if e.razon_social.is_empty() {
            faltantes.push("la razón social (Configuración → Mi negocio)".into());
        }
        if e.giro.trim().is_empty() {
            faltantes.push("el giro como está en el SII".into());
        }
        if e.actecos.is_empty() {
            faltantes.push("al menos un código de actividad económica".into());
        }
        if e.direccion.trim().is_empty() || e.comuna.trim().is_empty() {
            faltantes.push("la dirección y comuna de la casa matriz".into());
        }
        if c.resolucion_fecha.is_none() {
            faltantes.push("la fecha de resolución del SII".into());
        }
        if c.cert_p12.is_none() {
            faltantes.push("el certificado digital (.pfx)".into());
        } else if c.cert_rut.is_none() && c.emisor.rut_envia.trim().is_empty() {
            faltantes.push("el RUT del dueño del certificado".into());
        }
        if !folios
            .iter()
            .any(|f| f.ambiente == c.ambiente && f.restantes > 0)
        {
            faltantes.push(format!(
                "folios (CAF) del ambiente de {}",
                if c.ambiente == Ambiente::Certificacion {
                    "certificación"
                } else {
                    "producción"
                }
            ));
        }
        Ok(SiiStatus {
            ambiente: c.ambiente,
            rut: Some(e.rut).filter(|s| !s.is_empty()),
            razon_social: Some(e.razon_social).filter(|s| !s.is_empty()),
            emisor: c.emisor.clone(),
            resolucion_fecha: c.resolucion_fecha.clone(),
            resolucion_numero: c.resolucion_numero,
            certificado: c.cert_p12.as_ref().map(|_| SiiCertInfo {
                nombre: c.cert_name.clone(),
                rut: c.cert_rut.clone(),
                vence: c.cert_expires.clone(),
            }),
            folios,
            faltantes,
        })
    }

    /// Guarda los datos del emisor ante el SII y el ambiente.
    pub fn sii_save_setup(&mut self, s: &SiiSetup) -> AppResult<SiiStatus> {
        let user = self.require("config.editar")?.username.clone();
        let mut e = s.emisor.clone();
        e.giro = e.giro.trim().chars().take(80).collect();
        e.direccion = e.direccion.trim().chars().take(70).collect();
        e.comuna = e.comuna.trim().chars().take(20).collect();
        e.ciudad = e.ciudad.trim().chars().take(20).collect();
        e.rut_envia = e.rut_envia.trim().to_string();
        e.actecos.retain(|a| *a > 0);
        e.actecos.dedup();
        if e.actecos.len() > 4 {
            return Err(AppError::Validation(
                "el SII admite hasta 4 actividades económicas por documento".into(),
            ));
        }
        if e.actecos.iter().any(|a| !(10_000..=999_999).contains(a)) {
            return Err(AppError::Validation(
                "los códigos de actividad económica tienen 6 dígitos (ej. 620200)".into(),
            ));
        }
        if !e.rut_envia.is_empty() {
            e.rut_envia = fmt_rut(&e.rut_envia);
        }
        let fecha = s
            .resolucion_fecha
            .as_deref()
            .map(str::trim)
            .filter(|f| !f.is_empty());
        if let Some(f) = fecha
            && !valid_date(f)
        {
            return Err(AppError::Validation(
                "la fecha de resolución va como AAAA-MM-DD".into(),
            ));
        }
        if s.ambiente == Ambiente::Produccion
            && (fecha.is_none() || s.resolucion_numero.unwrap_or(0) == 0)
        {
            return Err(AppError::Validation(
                "para emitir documentos reales se necesita la fecha y el número de la resolución que entrega el SII al terminar la certificación".into(),
            ));
        }
        self.sii_ensure_row()?;
        let prev = self.sii_row()?.ambiente;
        self.db.conn().execute(
            "UPDATE sii_config SET ambiente = ?1, emisor_json = ?2, resolucion_fecha = ?3, resolucion_numero = ?4, updated_at = ?5 WHERE id = 1",
            params![
                s.ambiente.as_str(),
                serde_json::to_string(&e).map_err(|x| AppError::Validation(x.to_string()))?,
                fecha,
                s.resolucion_numero,
                now_utc()
            ],
        )?;
        let text = if prev != s.ambiente {
            format!(
                "Cambió la facturación electrónica al ambiente de {}",
                if s.ambiente == Ambiente::Produccion {
                    "producción"
                } else {
                    "certificación"
                }
            )
        } else {
            "Actualizó los datos de facturación electrónica".to_string()
        };
        log(
            self.db.conn(),
            &user,
            "update",
            "sii",
            "config",
            &text,
            None,
        )?;
        self.sii_status()
    }

    /// Carga el certificado digital (.pfx/.p12). La clave la escribe la persona en NÚCLEO; se guarda
    /// en la base cifrada para firmar sin pedirla cada vez.
    pub fn sii_load_certificate(&mut self, p12: &[u8], password: &str) -> AppResult<SiiStatus> {
        let user = self.require("config.editar")?.username.clone();
        if p12.len() > 64 * 1024 {
            return Err(AppError::Validation(
                "el archivo es demasiado grande para un certificado".into(),
            ));
        }
        let cert = Certificate::from_pkcs12(p12, password)?;
        let (cn, serial) = cert.subject();
        let rut = serial.as_deref().or(cn.as_deref()).and_then(rut_in_text);
        let vence = cert.not_after();
        self.sii_ensure_row()?;
        self.db.conn().execute(
            "UPDATE sii_config SET cert_p12 = ?1, cert_password = ?2, cert_name = ?3, cert_rut = ?4, cert_expires = ?5, updated_at = ?6 WHERE id = 1",
            params![p12, password, cn, rut, vence, now_utc()],
        )?;
        log(
            self.db.conn(),
            &user,
            "update",
            "sii",
            "certificado",
            &format!(
                "Cargó el certificado digital de {} (vence {vence})",
                cn.as_deref().unwrap_or("sin nombre")
            ),
            None,
        )?;
        self.sii_status()
    }

    /// Carga un archivo de folios (CAF) descargado del SII.
    pub fn sii_load_caf(&mut self, xml: &[u8]) -> AppResult<SiiStatus> {
        let user = self.require("config.editar")?.username.clone();
        let caf = Caf::parse(xml)?;
        if TipoDte::from_code(caf.tipo).is_none() {
            return Err(AppError::Validation(format!(
                "NÚCLEO todavía no emite el tipo de documento {}",
                caf.tipo
            )));
        }
        let c = self.sii_row()?;
        let e = self.sii_emisor(&c)?;
        if e.rut.is_empty() {
            return Err(AppError::Validation(
                "anota primero el RUT de la empresa en Configuración → Mi negocio".into(),
            ));
        }
        if norm_rut(&caf.rut) != norm_rut(&e.rut) {
            return Err(AppError::Validation(format!(
                "estos folios son de otra empresa (RUT {})",
                caf.rut
            )));
        }
        let overlap: i64 = self.db.conn().query_row(
            "SELECT COUNT(*) FROM sii_cafs WHERE ambiente = ?1 AND tipo = ?2 AND desde <= ?4 AND hasta >= ?3",
            params![c.ambiente.as_str(), caf.tipo, caf.desde as i64, caf.hasta as i64],
            |r| r.get(0),
        )?;
        if overlap > 0 {
            return Err(AppError::Validation(format!(
                "los folios {}–{} de {} ya estaban cargados",
                caf.desde,
                caf.hasta,
                tipo_nombre(caf.tipo)
            )));
        }
        self.db.conn().execute(
            "INSERT INTO sii_cafs (ambiente, tipo, desde, hasta, autorizado, xml, siguiente, cargado_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?3, ?7)",
            params![c.ambiente.as_str(), caf.tipo, caf.desde as i64, caf.hasta as i64, caf.fecha, xml, now_utc()],
        )?;
        log(
            self.db.conn(),
            &user,
            "create",
            "sii",
            &format!("caf-{}-{}", caf.tipo, caf.desde),
            &format!(
                "Cargó los folios {}–{} de {} ({})",
                caf.desde,
                caf.hasta,
                tipo_nombre(caf.tipo),
                c.ambiente.as_str()
            ),
            None,
        )?;
        self.sii_status()
    }

    fn sii_credentials(&self, c: &ConfigRow) -> AppResult<SiiCredentials> {
        let p12 = c
            .cert_p12
            .clone()
            .ok_or_else(|| AppError::Validation("carga primero el certificado digital".into()))?;
        let rut_envia = c
            .cert_rut
            .clone()
            .or(Some(c.emisor.rut_envia.clone()).filter(|r| !r.is_empty()))
            .ok_or_else(|| AppError::Validation("anota el RUT del dueño del certificado".into()))?;
        Ok(SiiCredentials {
            ambiente: c.ambiente,
            p12,
            password: c.cert_password.clone().unwrap_or_default(),
            rut_envia,
            rut_emisor: self.sii_emisor(c)?.rut,
        })
    }

    /// Credenciales para probar la conexión (pedir un token) sin emitir nada.
    pub fn sii_connection_plan(&self) -> AppResult<SiiCredentials> {
        self.require("config.editar")?;
        let c = self.sii_row()?;
        self.sii_credentials(&c)
    }

    fn sii_now(&self) -> AppResult<String> {
        Ok(self.db.conn().query_row(
            "SELECT strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime')",
            [],
            |r| r.get(0),
        )?)
    }

    /// Timbra y firma un documento con el siguiente folio disponible y lo deja listo para enviar.
    /// No sale nada al SII todavía.
    pub fn sii_issue(&mut self, input: &SiiIssueInput) -> AppResult<SiiDocument> {
        let user = self.require("ventas.documentar")?.username.clone();
        let tipo = TipoDte::from_code(input.tipo).ok_or_else(|| {
            AppError::Validation(format!("tipo de documento {} no soportado", input.tipo))
        })?;
        let c = self.sii_row()?;
        let emisor = self.sii_emisor(&c)?;
        let cred = self.sii_credentials(&c)?;
        let cert = cred.certificate()?;
        let now = self.sii_now()?;
        let fecha = input
            .fecha
            .clone()
            .filter(|f| !f.is_empty())
            .unwrap_or_else(|| now[..10].to_string());
        if !valid_date(&fecha) {
            return Err(AppError::Validation("la fecha va como AAAA-MM-DD".into()));
        }
        let tasa = if tipo == TipoDte::FacturaExenta {
            0
        } else {
            self.tax_ppm()?.unwrap_or(0)
        };
        let sale_id: Option<i64> = match input.sale_uid.as_deref().filter(|u| !u.is_empty()) {
            None => None,
            Some(u) => Some(
                self.db
                    .conn()
                    .query_row("SELECT id FROM sales WHERE uid = ?1", [u], |r| r.get(0))
                    .optional()?
                    .ok_or_else(|| AppError::NotFound("la venta".into()))?,
            ),
        };
        let mut receptor = input.receptor.clone();
        receptor.rut = fmt_rut(&receptor.rut);
        let amb = c.ambiente;
        let tx = self.db.conn_mut().transaction()?;
        let caf_row: Option<(i64, Vec<u8>, i64)> = tx
            .query_row(
                "SELECT id, xml, siguiente FROM sii_cafs WHERE ambiente = ?1 AND tipo = ?2 AND siguiente <= hasta
                 ORDER BY desde LIMIT 1",
                params![amb.as_str(), input.tipo],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?;
        let (caf_id, caf_xml, folio) = caf_row.ok_or_else(|| {
            AppError::Validation(format!(
                "no quedan folios de {} — descarga un CAF nuevo en el SII",
                tipo.name()
            ))
        })?;
        let caf = Caf::parse(&caf_xml)?;
        let dte = Dte {
            tipo,
            folio: folio as u64,
            fecha: fecha.clone(),
            forma_pago: input.forma_pago,
            vencimiento: input.vencimiento.clone().filter(|v| !v.is_empty()),
            ind_traslado: input.ind_traslado,
            tipo_despacho: input.tipo_despacho,
            emisor,
            receptor: receptor.clone(),
            detalle: input.detalle.clone(),
            referencias: input.referencias.clone(),
            tasa_iva_ppm: tasa,
        };
        let signed = dte.sign(&caf, &cert, &now)?;
        tx.execute(
            "UPDATE sii_cafs SET siguiente = siguiente + 1 WHERE id = ?1",
            [caf_id],
        )?;
        let ts = now_utc();
        tx.execute(
            "INSERT INTO sii_documents (ambiente, tipo, folio, sale_id, fecha, receptor_rut, receptor, total_minor, xml, estado, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'firmado', ?10, ?10)",
            params![amb.as_str(), input.tipo, folio, sale_id, fecha, receptor.rut, receptor.razon_social, signed.totales.total, signed.to_document(), ts],
        )?;
        let id = tx.last_insert_rowid();
        log(
            &tx,
            &user,
            "create",
            "sii",
            &format!("{}-{}", input.tipo, folio),
            &format!(
                "Firmó {} N° {folio} a {} por ${} ({})",
                tipo.name(),
                receptor.razon_social,
                signed.totales.total,
                amb.as_str()
            ),
            None,
        )?;
        tx.commit()?;
        self.sii_document(id)
    }

    fn sii_document(&self, id: i64) -> AppResult<SiiDocument> {
        self.sii_documents_where("WHERE id = ?1", params![id], 1)?
            .pop()
            .ok_or_else(|| AppError::NotFound("el documento".into()))
    }

    fn sii_documents_where(
        &self,
        filter: &str,
        p: impl rusqlite::Params,
        limit: i64,
    ) -> AppResult<Vec<SiiDocument>> {
        let sql = format!(
            "SELECT id, ambiente, tipo, folio, fecha, receptor_rut, receptor, total_minor, estado, track_id, glosa, created_at
             FROM sii_documents {filter} ORDER BY id DESC LIMIT {limit}"
        );
        let mut st = self.db.conn().prepare(&sql)?;
        let rows = st.query_map(p, |r| {
            let tipo: u16 = r.get(2)?;
            Ok(SiiDocument {
                id: r.get(0)?,
                ambiente: Ambiente::parse(&r.get::<_, String>(1)?)
                    .unwrap_or(Ambiente::Certificacion),
                tipo,
                tipo_nombre: tipo_nombre(tipo),
                folio: r.get::<_, i64>(3)? as u64,
                fecha: r.get(4)?,
                receptor_rut: r.get(5)?,
                receptor: r.get(6)?,
                total_minor: r.get(7)?,
                estado: r.get(8)?,
                track_id: r.get(9)?,
                glosa: r.get(10)?,
                created_at: r.get(11)?,
            })
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn sii_documents(&self, limit: Option<i64>) -> AppResult<Vec<SiiDocument>> {
        self.require("ventas.ver")?;
        self.sii_documents_where("", [], limit.unwrap_or(100).clamp(1, 1000))
    }

    /// XML firmado de un documento (para guardarlo o enviarlo al cliente).
    pub fn sii_document_xml(&self, id: i64) -> AppResult<Vec<u8>> {
        self.require("ventas.ver")?;
        self.db
            .conn()
            .query_row("SELECT xml FROM sii_documents WHERE id = ?1", [id], |r| {
                r.get(0)
            })
            .optional()?
            .ok_or_else(|| AppError::NotFound("el documento".into()))
    }

    /// Prepara el sobre con los documentos firmados (aún no enviados) del ambiente actual.
    pub fn sii_send_plan(&self, ids: &[i64]) -> AppResult<SendPlan> {
        self.require("ventas.documentar")?;
        let c = self.sii_row()?;
        let cred = self.sii_credentials(&c)?;
        let fecha_resol = c
            .resolucion_fecha
            .clone()
            .ok_or_else(|| AppError::Validation("anota la fecha de resolución del SII".into()))?;
        if ids.is_empty() {
            return Err(AppError::Validation("elige al menos un documento".into()));
        }
        let mut docs = Vec::new();
        for id in ids {
            let (amb, estado, xml): (String, String, Vec<u8>) = self
                .db
                .conn()
                .query_row(
                    "SELECT ambiente, estado, xml FROM sii_documents WHERE id = ?1",
                    [id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .optional()?
                .ok_or_else(|| AppError::NotFound("el documento".into()))?;
            if amb != c.ambiente.as_str() {
                return Err(AppError::Validation(
                    "no se mezclan documentos de certificación y de producción".into(),
                ));
            }
            if estado != "firmado" && estado != "rechazado" {
                return Err(AppError::Validation(format!(
                    "el documento {id} ya fue enviado"
                )));
            }
            docs.push(signed_from_xml(&xml)?);
        }
        let cert = cred.certificate()?;
        let car = Caratula::al_sii(
            &cred.rut_emisor,
            &cred.rut_envia,
            &fecha_resol,
            c.resolucion_numero.unwrap_or(0),
        );
        let now = self.sii_now()?;
        let envio = envio_dte(&car, &docs, &cert, &now)?;
        Ok(SendPlan {
            file_name: format!(
                "EnvioDTE_{}_{}.xml",
                norm_rut(&cred.rut_emisor),
                now.replace([':', '-'], "")
            ),
            cred,
            ids: ids.to_vec(),
            envio,
        })
    }

    /// Registra el número de seguimiento del envío.
    pub fn sii_send_apply(
        &mut self,
        plan: &SendPlan,
        track_id: &str,
    ) -> AppResult<Vec<SiiDocument>> {
        let user = self.require("ventas.documentar")?.username.clone();
        let tx = self.db.conn_mut().transaction()?;
        for id in &plan.ids {
            tx.execute(
                "UPDATE sii_documents SET estado = 'enviado', track_id = ?1, glosa = NULL, updated_at = ?2 WHERE id = ?3",
                params![track_id, now_utc(), id],
            )?;
        }
        log(
            &tx,
            &user,
            "update",
            "sii",
            track_id,
            &format!(
                "Envió {} documento(s) al SII (seguimiento {track_id}, {})",
                plan.ids.len(),
                plan.cred.ambiente.as_str()
            ),
            None,
        )?;
        tx.commit()?;
        let mut out = Vec::new();
        for id in &plan.ids {
            out.push(self.sii_document(*id)?);
        }
        Ok(out)
    }

    /// Credenciales y número de seguimiento para consultar el estado de un documento enviado.
    pub fn sii_status_plan(&self, id: i64) -> AppResult<(SiiCredentials, String)> {
        self.require("ventas.ver")?;
        let c = self.sii_row()?;
        let track: Option<String> = self
            .db
            .conn()
            .query_row(
                "SELECT track_id FROM sii_documents WHERE id = ?1",
                [id],
                |r| r.get(0),
            )
            .optional()?
            .flatten();
        let track =
            track.ok_or_else(|| AppError::Validation("el documento aún no se envía".into()))?;
        Ok((self.sii_credentials(&c)?, track))
    }

    /// Anota el estado que informó el SII en todos los documentos de ese envío.
    pub fn sii_status_apply(
        &mut self,
        track_id: &str,
        e: &EstadoEnvio,
    ) -> AppResult<Vec<SiiDocument>> {
        let user = self.require("ventas.ver")?.username.clone();
        let estado = if e.pendiente {
            "enviado"
        } else if e.estado == "EPR" {
            match (e.rechazados.unwrap_or(0), e.reparos.unwrap_or(0)) {
                (0, 0) => "aceptado",
                (0, _) => "reparos",
                // Envío con varios documentos y resultados mixtos: el detalle llega por correo del SII.
                (r, _) if r > 0 && e.aceptados.unwrap_or(0) > 0 => "reparos",
                _ => "rechazado",
            }
        } else {
            "rechazado"
        };
        let glosa = format!("{} {}", e.estado, e.glosa).trim().to_string();
        self.db.conn().execute(
            "UPDATE sii_documents SET estado = ?1, glosa = ?2, updated_at = ?3 WHERE track_id = ?4",
            params![estado, glosa, now_utc(), track_id],
        )?;
        if !e.pendiente {
            log(
                self.db.conn(),
                &user,
                "update",
                "sii",
                track_id,
                &format!("El SII respondió el envío {track_id}: {glosa}"),
                None,
            )?;
        }
        self.sii_documents_where("WHERE track_id = ?1", params![track_id], 2000)
    }
}

/// Busca un RUT («12.345.678-9» o «12345678-9») dentro de un texto.
fn rut_in_text(s: &str) -> Option<String> {
    let clean: String = s.chars().filter(|c| *c != '.').collect();
    for (i, _) in clean.match_indices('-') {
        let num: String = clean[..i]
            .chars()
            .rev()
            .take_while(|c| c.is_ascii_digit())
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        let dv = clean[i + 1..].chars().next()?;
        if (7..=8).contains(&num.len()) && (dv.is_ascii_digit() || dv == 'k' || dv == 'K') {
            return Some(format!("{num}-{}", dv.to_ascii_uppercase()));
        }
    }
    None
}

/// Rearma un documento firmado leído de la base para incluirlo en un sobre.
fn signed_from_xml(xml: &[u8]) -> AppResult<nucleo_dte::SignedDte> {
    let text = nucleo_dte::xml::from_latin1(xml);
    let body = match text.find("?>") {
        Some(i) => &text[i + 2..],
        None => &text[..],
    };
    let doc = roxmltree_parse(body)?;
    let el = nucleo_dte::xml::from_rox(doc.root_element());
    let id_doc = el
        .find("Documento")
        .and_then(|d| d.find("Encabezado"))
        .and_then(|e| e.find("IdDoc"))
        .ok_or_else(|| AppError::Validation("documento guardado dañado".into()))?;
    let tipo: u16 = id_doc
        .find("TipoDTE")
        .map(|t| t.text_content())
        .unwrap_or_default()
        .parse()
        .unwrap_or(0);
    let folio: u64 = id_doc
        .find("Folio")
        .map(|t| t.text_content())
        .unwrap_or_default()
        .parse()
        .unwrap_or(0);
    let tipo = TipoDte::from_code(tipo)
        .ok_or_else(|| AppError::Validation("documento guardado dañado".into()))?;
    let total: i64 = el
        .find("Documento")
        .and_then(|d| d.find("Encabezado"))
        .and_then(|e| e.find("Totales"))
        .and_then(|t| t.find("MntTotal"))
        .map(|t| t.text_content().parse().unwrap_or(0))
        .unwrap_or(0);
    Ok(nucleo_dte::SignedDte {
        tipo,
        folio,
        totales: nucleo_dte::dte::Totales {
            neto: 0,
            exento: 0,
            iva: 0,
            total,
        },
        el,
    })
}

fn roxmltree_parse(s: &str) -> AppResult<nucleo_dte::xml::RoxDocument<'_>> {
    nucleo_dte::xml::parse(s)
        .map_err(|e| AppError::Validation(format!("documento guardado dañado: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rut_en_textos() {
        assert_eq!(rut_in_text("12.345.678-k").as_deref(), Some("12345678-K"));
        assert_eq!(
            rut_in_text("JUAN PEREZ 9876543-2").as_deref(),
            Some("9876543-2")
        );
        assert_eq!(rut_in_text("sin rut"), None);
        assert_eq!(fmt_rut("76.123.456-k"), "76123456-K");
    }
}
