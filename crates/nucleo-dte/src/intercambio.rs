//! Intercambio de información entre contribuyentes: leer un sobre recibido (`EnvioDTE`) y armar las
//! tres respuestas que define el SII, firmadas con el certificado de quien responde:
//!
//! 1. **Recepción del envío** (`RespuestaDTE` con `RecepcionEnvio`): acuse de recibo del sobre y de
//!    cada documento (recibido, error en RUT receptor, firma…).
//! 2. **Resultado comercial** (`RespuestaDTE` con `ResultadoDTE`): aceptado, con discrepancias o
//!    rechazado.
//! 3. **Recibo de mercaderías o servicios** (`EnvioRecibos`, Ley 19.983).
//!
//! En la certificación se responde el sobre de prueba que entrega el SII; en producción estas
//! respuestas van al correo de intercambio del emisor.

use crate::crypto::{Certificate, FirmaEstado, verify_xml_signature};
use crate::dte::{dte_scope, normalize_rut};
use crate::xml::{El, Node, from_latin1, from_rox};
use crate::{DteError, DteResult, NS_SII, NS_XSI};
use std::collections::BTreeMap;

/// Texto fijo del recibo (así lo exige el esquema del SII, sin tildes).
pub const DECLARACION: &str = "El acuse de recibo que se declara en este acto, de acuerdo a lo dispuesto en la letra b) del Art. 4, y la letra c) del Art. 5 de la Ley 19.983, acredita que la entrega de mercaderias o servicio(s) prestado(s) ha(n) sido recibido(s).";

/// Un documento dentro del sobre recibido.
#[derive(Debug, Clone, serde::Serialize)]
pub struct DteRecibido {
    pub tipo: u16,
    pub folio: u64,
    pub fecha: String,
    pub rut_emisor: String,
    pub razon_social_emisor: String,
    pub rut_receptor: String,
    pub total: i64,
    pub firma: FirmaEstado,
}

/// Sobre recibido de otro contribuyente.
#[derive(Debug, Clone, serde::Serialize)]
pub struct EnvioRecibido {
    /// ID del `SetDTE`.
    pub set_id: String,
    pub rut_emisor: String,
    pub rut_envia: String,
    /// RUT al que viene dirigido el sobre (carátula).
    pub rut_receptor: String,
    /// `DigestValue` de la firma del sobre (va en el acuse).
    pub digest: Option<String>,
    pub firma: FirmaEstado,
    pub dtes: Vec<DteRecibido>,
}

fn txt(e: Option<&El>, name: &str) -> String {
    e.and_then(|x| x.find(name))
        .map(|x| x.text_content().trim().to_string())
        .unwrap_or_default()
}

fn kids<'a>(e: &'a El, name: &'a str) -> impl Iterator<Item = &'a El> + 'a {
    e.kids.iter().filter_map(move |k| match k {
        Node::El(c) if c.name == name => Some(c),
        _ => None,
    })
}

/// Espacios de nombres en alcance al entrar a un hijo de la cadena de ancestros dada.
fn alcance(cadena: &[&El]) -> BTreeMap<String, String> {
    let mut m = BTreeMap::new();
    for e in cadena {
        for (p, u) in &e.ns {
            m.insert(p.clone(), u.clone());
        }
    }
    m
}

/// Texto del archivo: UTF-8 si lo declara o lo es; si no, ISO-8859-1 (lo habitual en el SII).
fn decodificar(xml: &[u8]) -> String {
    let cabeza = String::from_utf8_lossy(&xml[..xml.len().min(120)]).to_lowercase();
    if cabeza.contains("utf-8")
        && let Ok(s) = std::str::from_utf8(xml)
    {
        return s.trim_start_matches('\u{feff}').to_string();
    }
    from_latin1(xml)
}

/// Lee un `EnvioDTE` recibido y revisa sus firmas.
pub fn leer_envio(xml: &[u8]) -> DteResult<EnvioRecibido> {
    let text = decodificar(xml);
    let body = match text.find("?>") {
        Some(i) if text.trim_start().starts_with("<?xml") => &text[i + 2..],
        _ => &text[..],
    };
    let parsed = crate::xml::parse(body)
        .map_err(|e| DteError::Validation(format!("el archivo no es un XML válido: {e}")))?;
    let root = from_rox(parsed.root_element());
    if root.name != "EnvioDTE" {
        return Err(DteError::Validation(format!(
            "se esperaba un envío de documentos (EnvioDTE) y el archivo trae «{}»",
            root.name
        )));
    }
    let set = root
        .find("SetDTE")
        .ok_or_else(|| DteError::Validation("el envío no trae documentos (SetDTE)".into()))?;
    let car = set.find("Caratula");
    let set_id = set
        .attrs
        .iter()
        .find(|(k, _)| k == "ID")
        .map(|(_, v)| v.clone())
        .unwrap_or_default();
    let sig = root.find("Signature");
    let scope_set = alcance(&[&root]);
    let firma = match sig {
        Some(s) => verify_xml_signature(s, set, &scope_set),
        None => FirmaEstado::SinVerificar,
    };
    let digest = sig
        .and_then(|s| s.find("SignedInfo"))
        .and_then(|s| s.find("Reference"))
        .and_then(|r| r.find("DigestValue"))
        .map(|d| d.text_content().split_whitespace().collect::<String>())
        .filter(|d| !d.is_empty());
    let mut dtes = Vec::new();
    for dte in kids(set, "DTE") {
        let Some(doc) = dte.find("Documento") else {
            continue;
        };
        let enc = doc.find("Encabezado");
        let (id, em, rec, tot) = (
            enc.and_then(|e| e.find("IdDoc")),
            enc.and_then(|e| e.find("Emisor")),
            enc.and_then(|e| e.find("Receptor")),
            enc.and_then(|e| e.find("Totales")),
        );
        let firma = match dte.find("Signature") {
            Some(s) => verify_xml_signature(s, doc, &alcance(&[&root, set, dte])),
            None => FirmaEstado::SinVerificar,
        };
        dtes.push(DteRecibido {
            tipo: txt(id, "TipoDTE").parse().unwrap_or(0),
            folio: txt(id, "Folio").parse().unwrap_or(0),
            fecha: txt(id, "FchEmis"),
            rut_emisor: txt(em, "RUTEmisor"),
            razon_social_emisor: txt(em, "RznSoc"),
            rut_receptor: txt(rec, "RUTRecep"),
            total: txt(tot, "MntTotal").parse().unwrap_or(0),
            firma,
        });
    }
    if dtes.is_empty() {
        return Err(DteError::Validation("el envío no trae documentos".into()));
    }
    Ok(EnvioRecibido {
        set_id,
        rut_emisor: txt(car, "RutEmisor"),
        rut_envia: txt(car, "RutEnvia"),
        rut_receptor: txt(car, "RutReceptor"),
        digest,
        firma,
        dtes,
    })
}

/// Estado de recepción de un documento: 0 recibido; 3 si no viene dirigido a `rut_propio`.
pub fn estado_recepcion(d: &DteRecibido, rut_propio: &str) -> u8 {
    if normalize_rut(&d.rut_receptor) != normalize_rut(rut_propio) {
        3
    } else {
        0
    }
}

pub fn glosa_recepcion_dte(estado: u8) -> &'static str {
    match estado {
        0 => "DTE Recibido OK",
        1 => "DTE No Recibido - Error de Firma",
        2 => "DTE No Recibido - Error en RUT Emisor",
        3 => "DTE No Recibido - Error en RUT Receptor",
        4 => "DTE No Recibido - DTE Repetido",
        _ => "DTE No Recibido - Otros",
    }
}

pub fn glosa_recepcion_envio(estado: u8) -> &'static str {
    match estado {
        0 => "Envio Recibido Conforme",
        1 => "Envio Rechazado - Error de Schema",
        2 => "Envio Rechazado - Error de Firma",
        3 => "Envio Rechazado - RUT Receptor No Corresponde",
        90 => "Envio Rechazado - Archivo Repetido",
        91 => "Envio Rechazado - Archivo Ilegible",
        _ => "Envio Rechazado - Otros",
    }
}

pub fn glosa_resultado(estado: u8) -> &'static str {
    match estado {
        0 => "DTE Aceptado OK",
        1 => "DTE Aceptado con Discrepancias",
        _ => "DTE Rechazado",
    }
}

/// Quién responde y a quién contactar.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(default)]
pub struct Responde {
    pub rut: String,
    pub contacto: Option<String>,
    pub fono: Option<String>,
    pub mail: Option<String>,
}

fn clip(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

fn datos_dte(e: El, d: &DteRecibido, tipo_tag: &str) -> El {
    e.child(El::text(tipo_tag, d.tipo.to_string()))
        .child(El::text("Folio", d.folio.to_string()))
        .child(El::text("FchEmis", &d.fecha))
        .child(El::text("RUTEmisor", &d.rut_emisor))
        .child(El::text("RUTRecep", &d.rut_receptor))
        .child(El::text("MntTotal", d.total.to_string()))
}

fn respuesta(
    envio: &EnvioRecibido,
    r: &Responde,
    id_respuesta: u64,
    detalles: Vec<El>,
    cert: &Certificate,
    timestamp: &str,
) -> DteResult<Vec<u8>> {
    if detalles.is_empty() {
        return Err(DteError::Validation(
            "la respuesta no tiene documentos".into(),
        ));
    }
    let caratula = El::new("Caratula")
        .attr("version", "1.0")
        .child(El::text("RutResponde", &r.rut))
        .child(El::text("RutRecibe", &envio.rut_emisor))
        .child(El::text("IdRespuesta", id_respuesta.max(1).to_string()))
        .child(El::text("NroDetalles", detalles.len().to_string()))
        .opt("NmbContacto", r.contacto.as_deref().map(|x| clip(x, 40)))
        .opt("FonoContacto", r.fono.as_deref().map(|x| clip(x, 40)))
        .opt("MailContacto", r.mail.as_deref().map(|x| clip(x, 80)))
        .child(El::text("TmstFirmaResp", timestamp));
    let id = format!("Respuesta{}", id_respuesta.max(1));
    let mut resultado = El::new("Resultado").attr("ID", &id).child(caratula);
    for d in detalles {
        resultado.push(d);
    }
    resultado.break_lines(&[]);
    let scope = dte_scope();
    let sig = cert.xml_signature(&resultado, &format!("#{id}"), &scope, &scope, false)?;
    let mut root = El::new("RespuestaDTE")
        .ns("", NS_SII)
        .ns("xsi", NS_XSI)
        .attr(
            "xsi:schemaLocation",
            "http://www.sii.cl/SiiDte RespuestaEnvioDTE_v10.xsd",
        )
        .attr("version", "1.0")
        .child(resultado)
        .child(sig);
    root.break_lines(&[]);
    Ok(root.to_document())
}

/// Respuesta 1: acuse de recibo del sobre y de cada documento. `estados[i]` es el estado de recepción
/// del documento i (0 recibido, 3 error en RUT receptor…).
#[allow(clippy::too_many_arguments)]
pub fn respuesta_recepcion(
    envio: &EnvioRecibido,
    nombre_archivo: &str,
    r: &Responde,
    id_respuesta: u64,
    estado_envio: u8,
    estados: &[u8],
    cert: &Certificate,
    timestamp: &str,
) -> DteResult<Vec<u8>> {
    if estados.len() != envio.dtes.len() {
        return Err(DteError::Validation(
            "falta el estado de recepción de algún documento".into(),
        ));
    }
    let mut rec = El::new("RecepcionEnvio")
        .child(El::text("NmbEnvio", clip(nombre_archivo, 80)))
        .child(El::text("FchRecep", timestamp))
        .child(El::text("CodEnvio", id_respuesta.max(1).to_string()))
        .child(El::text("EnvioDTEID", clip(&envio.set_id, 80)))
        .opt("Digest", envio.digest.clone())
        .child(El::text("RutEmisor", &envio.rut_emisor))
        .child(El::text("RutReceptor", &envio.rut_receptor))
        .child(El::text("EstadoRecepEnv", estado_envio.to_string()))
        .child(El::text(
            "RecepEnvGlosa",
            glosa_recepcion_envio(estado_envio),
        ))
        .child(El::text("NroDTE", envio.dtes.len().to_string()));
    for (d, e) in envio.dtes.iter().zip(estados) {
        rec.push(
            datos_dte(El::new("RecepcionDTE"), d, "TipoDTE")
                .child(El::text("EstadoRecepDTE", e.to_string()))
                .child(El::text("RecepDTEGlosa", glosa_recepcion_dte(*e))),
        );
    }
    respuesta(envio, r, id_respuesta, vec![rec], cert, timestamp)
}

/// Respuesta 2: resultado comercial de los documentos recibidos. `resultados` = (índice del documento,
/// estado 0 aceptado / 1 con discrepancias / 2 rechazado).
pub fn respuesta_resultado(
    envio: &EnvioRecibido,
    r: &Responde,
    id_respuesta: u64,
    resultados: &[(usize, u8)],
    cert: &Certificate,
    timestamp: &str,
) -> DteResult<Vec<u8>> {
    let mut detalles = Vec::new();
    for (i, estado) in resultados {
        let d = envio
            .dtes
            .get(*i)
            .ok_or_else(|| DteError::Validation("documento fuera del envío".into()))?;
        let mut e = datos_dte(El::new("ResultadoDTE"), d, "TipoDTE")
            .child(El::text("CodEnvio", id_respuesta.max(1).to_string()))
            .child(El::text("EstadoDTE", estado.to_string()))
            .child(El::text("EstadoDTEGlosa", glosa_resultado(*estado)));
        if *estado == 2 {
            e.push(El::text("CodRchDsc", "-1"));
        }
        detalles.push(e);
    }
    respuesta(envio, r, id_respuesta, detalles, cert, timestamp)
}

/// Respuesta 3: recibos de mercaderías o servicios (Ley 19.983) de los documentos indicados.
/// `rut_firma` es el RUT de la persona que firma el recibo (dueña del certificado).
pub fn envio_recibos(
    envio: &EnvioRecibido,
    r: &Responde,
    recinto: &str,
    rut_firma: &str,
    documentos: &[usize],
    cert: &Certificate,
    timestamp: &str,
) -> DteResult<Vec<u8>> {
    if documentos.is_empty() {
        return Err(DteError::Validation(
            "no hay documentos para el recibo".into(),
        ));
    }
    if recinto.trim().is_empty() {
        return Err(DteError::Validation(
            "indica el recinto donde se recibieron las mercaderías o servicios".into(),
        ));
    }
    let scope = dte_scope();
    let caratula = El::new("Caratula")
        .attr("version", "1.0")
        .child(El::text("RutResponde", &r.rut))
        .child(El::text("RutRecibe", &envio.rut_emisor))
        .opt("NmbContacto", r.contacto.as_deref().map(|x| clip(x, 40)))
        .opt("FonoContacto", r.fono.as_deref().map(|x| clip(x, 40)))
        .opt("MailContacto", r.mail.as_deref().map(|x| clip(x, 80)))
        .child(El::text("TmstFirmaEnv", timestamp));
    let mut set = El::new("SetRecibos")
        .attr("ID", "SetRecibos")
        .child(caratula);
    for i in documentos {
        let d = envio
            .dtes
            .get(*i)
            .ok_or_else(|| DteError::Validation("documento fuera del envío".into()))?;
        let id = format!("Recibo_T{}F{}", d.tipo, d.folio);
        let mut doc = datos_dte(El::new("DocumentoRecibo").attr("ID", &id), d, "TipoDoc")
            .child(El::text("Recinto", clip(recinto.trim(), 80)))
            .child(El::text("RutFirma", rut_firma))
            .child(El::text("Declaracion", DECLARACION))
            .child(El::text("TmstFirmaRecibo", timestamp));
        doc.break_lines(&[]);
        let sig = cert.xml_signature(&doc, &format!("#{id}"), &scope, &scope, false)?;
        let mut recibo = El::new("Recibo")
            .attr("version", "1.0")
            .child(doc)
            .child(sig);
        recibo.break_lines(&[]);
        set.push(recibo);
    }
    set.break_lines(&[]);
    let sig = cert.xml_signature(&set, "#SetRecibos", &scope, &scope, false)?;
    let mut root = El::new("EnvioRecibos")
        .ns("", NS_SII)
        .ns("xsi", NS_XSI)
        .attr(
            "xsi:schemaLocation",
            "http://www.sii.cl/SiiDte EnvioRecibos_v10.xsd",
        )
        .attr("version", "1.0")
        .child(set)
        .child(sig);
    root.break_lines(&[]);
    Ok(root.to_document())
}
