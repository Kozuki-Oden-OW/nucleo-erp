//! Mensajes de los servicios web del SII (sin red): semilla, token, subida del envío y consulta de
//! estado. El transporte HTTP lo hace `nucleo-app`.
//!
//! Las direcciones vienen de la documentación pública del SII para desarrolladores y deben
//! confirmarse en la fase F2 contra el ambiente de certificación (maullin).

use crate::crypto::Certificate;
use crate::xml::El;
use crate::{DteError, DteResult};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Ambiente {
    /// maullin.sii.cl — pruebas y certificación.
    Certificacion,
    /// palena.sii.cl — documentos reales.
    Produccion,
}

impl Ambiente {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Certificacion => "certificacion",
            Self::Produccion => "produccion",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "certificacion" => Some(Self::Certificacion),
            "produccion" => Some(Self::Produccion),
            _ => None,
        }
    }
    pub fn host(self) -> &'static str {
        match self {
            Self::Certificacion => "maullin.sii.cl",
            Self::Produccion => "palena.sii.cl",
        }
    }
    pub fn seed_url(self) -> String {
        format!("https://{}/DTEWS/CrSeed.jws", self.host())
    }
    pub fn token_url(self) -> String {
        format!("https://{}/DTEWS/GetTokenFromSeed.jws", self.host())
    }
    pub fn upload_url(self) -> String {
        format!("https://{}/cgi_dte/UPL/DTEUpload", self.host())
    }
    pub fn status_url(self) -> String {
        format!("https://{}/DTEWS/QueryEstUp.jws", self.host())
    }
}

fn soap(method: &str, args: &[(&str, &str)]) -> String {
    let mut body = String::new();
    for (k, v) in args {
        body.push_str(&format!("<{k} xsi:type=\"xsd:string\">{}</{k}>", esc(v)));
    }
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\
<soapenv:Envelope xmlns:soapenv=\"http://schemas.xmlsoap.org/soap/envelope/\" \
xmlns:xsd=\"http://www.w3.org/2001/XMLSchema\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\">\
<soapenv:Body><{method}>{body}</{method}></soapenv:Body></soapenv:Envelope>"
    )
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn unesc(s: &str) -> String {
    s.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

/// Texto del primer elemento con ese nombre local (ignora prefijos), en una respuesta que puede venir
/// con el XML interno escapado dentro del sobre SOAP.
pub fn tag(xml: &str, name: &str) -> Option<String> {
    let text = if xml.contains("&lt;") {
        unesc(xml)
    } else {
        xml.to_string()
    };
    let mut from = 0;
    while let Some(i) = text[from..].find('<') {
        let start = from + i + 1;
        let end_name = text[start..].find(['>', ' ', '/']).map(|j| start + j)?;
        let qn = &text[start..end_name];
        let local = qn.rsplit(':').next().unwrap_or(qn);
        if local == name && !qn.starts_with('/') {
            let open_end = text[end_name..].find('>').map(|j| end_name + j + 1)?;
            if text[..open_end].ends_with("/>") {
                return Some(String::new());
            }
            let close = format!("</{qn}>");
            let close_at = text[open_end..].find(&close).map(|j| open_end + j)?;
            return Some(text[open_end..close_at].trim().to_string());
        }
        from = end_name;
    }
    None
}

/// Sobre SOAP para pedir la semilla.
pub fn seed_request() -> String {
    soap("getSeed", &[])
}

/// Semilla de la respuesta de `getSeed`.
pub fn parse_seed(resp: &str) -> DteResult<String> {
    check_estado(resp, "semilla")?;
    tag(resp, "SEMILLA")
        .filter(|s| !s.is_empty())
        .ok_or_else(|| DteError::Sii("la respuesta no trae la semilla".into()))
}

/// `<getToken>` con la semilla, firmado (firma envolvente sobre el documento completo).
pub fn token_xml(seed: &str, cert: &Certificate) -> DteResult<String> {
    let mut root = El::new("getToken").child(El::new("item").child(El::text("Semilla", seed)));
    let sig = cert.xml_signature(&root, "", &BTreeMap::new(), &BTreeMap::new(), true)?;
    root.push(sig);
    Ok(format!("<?xml version=\"1.0\"?>\n{}", root.to_xml()))
}

pub fn token_request(signed_token_xml: &str) -> String {
    soap("getToken", &[("pszXml", signed_token_xml)])
}

pub fn parse_token(resp: &str) -> DteResult<String> {
    check_estado(resp, "token")?;
    tag(resp, "TOKEN")
        .filter(|s| !s.is_empty())
        .ok_or_else(|| DteError::Sii("la respuesta no trae el token".into()))
}

fn check_estado(resp: &str, what: &str) -> DteResult<()> {
    match tag(resp, "ESTADO") {
        Some(e) if e == "00" => Ok(()),
        Some(e) => {
            let glosa = tag(resp, "GLOSA").unwrap_or_default();
            Err(DteError::Sii(format!(
                "el SII no entregó el {what} (estado {e}{})",
                if glosa.is_empty() {
                    String::new()
                } else {
                    format!(": {glosa}")
                }
            )))
        }
        None => Err(DteError::Sii(format!(
            "respuesta inesperada al pedir el {what}"
        ))),
    }
}

/// Separa «76123456-7» en (76123456, '7').
pub fn split_rut(rut: &str) -> DteResult<(String, String)> {
    let clean: String = rut
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>()
        .to_uppercase();
    if clean.len() < 2 {
        return Err(DteError::Validation(format!("RUT no válido: {rut}")));
    }
    let (n, dv) = clean.split_at(clean.len() - 1);
    Ok((n.to_string(), dv.to_string()))
}

/// Cuerpo multipart para subir el `EnvioDTE`. Devuelve (content-type, cuerpo).
pub fn upload_body(
    rut_envia: &str,
    rut_emisor: &str,
    file_name: &str,
    envio: &[u8],
    boundary: &str,
) -> DteResult<(String, Vec<u8>)> {
    let (rs, ds) = split_rut(rut_envia)?;
    let (rc, dc) = split_rut(rut_emisor)?;
    let mut b = Vec::new();
    for (k, v) in [
        ("rutSender", rs),
        ("dvSender", ds),
        ("rutCompany", rc),
        ("dvCompany", dc),
    ] {
        b.extend_from_slice(
            format!("--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n")
                .as_bytes(),
        );
    }
    b.extend_from_slice(
        format!("--{boundary}\r\nContent-Disposition: form-data; name=\"archivo\"; filename=\"{file_name}\"\r\nContent-Type: text/xml\r\n\r\n").as_bytes(),
    );
    b.extend_from_slice(envio);
    b.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    Ok((format!("multipart/form-data; boundary={boundary}"), b))
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct Upload {
    pub track_id: String,
}

/// Respuesta de la subida: STATUS 0 = recibido, con número de seguimiento (TRACKID).
pub fn parse_upload(resp: &str) -> DteResult<Upload> {
    let status = tag(resp, "STATUS")
        .ok_or_else(|| DteError::Sii("respuesta inesperada al subir el envío".into()))?;
    if status != "0" {
        let detalle = tag(resp, "DETAIL")
            .or_else(|| tag(resp, "ERROR"))
            .unwrap_or_default();
        let causa = match status.as_str() {
            "1" => "el usuario no tiene permiso para enviar",
            "2" => "error en el tamaño del archivo",
            "3" => "archivo cortado",
            "5" => "no está autenticado (token vencido)",
            "6" => "la empresa no está autorizada a enviar",
            "7" => "esquema no válido",
            "8" => "firma del documento",
            "9" => "sistema bloqueado",
            _ => "error del SII",
        };
        return Err(DteError::Sii(format!(
            "envío rechazado ({status}: {causa}){}",
            if detalle.is_empty() {
                String::new()
            } else {
                format!(" — {detalle}")
            }
        )));
    }
    let track_id = tag(resp, "TRACKID")
        .filter(|s| !s.is_empty())
        .ok_or_else(|| DteError::Sii("la respuesta no trae el número de seguimiento".into()))?;
    Ok(Upload { track_id })
}

pub fn status_request(rut_emisor: &str, track_id: &str, token: &str) -> DteResult<String> {
    let (n, dv) = split_rut(rut_emisor)?;
    Ok(soap(
        "getEstUp",
        &[
            ("RutCompania", &n),
            ("DvCompania", &dv),
            ("TrackId", track_id),
            ("Token", token),
        ],
    ))
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct EstadoEnvio {
    /// Código del SII (EPR = procesado, RCT = rechazado por error en carátula, RFR = firma, …).
    pub estado: String,
    pub glosa: String,
    pub aceptados: Option<u32>,
    pub rechazados: Option<u32>,
    pub reparos: Option<u32>,
    /// Aún en proceso: hay que volver a consultar.
    pub pendiente: bool,
}

pub fn parse_status(resp: &str) -> DteResult<EstadoEnvio> {
    let estado = tag(resp, "ESTADO")
        .ok_or_else(|| DteError::Sii("respuesta inesperada al consultar el envío".into()))?;
    let num = |n: &str| tag(resp, n).and_then(|v| v.parse().ok());
    let pendiente = matches!(
        estado.as_str(),
        "REC" | "SOK" | "FOK" | "PRD" | "CRT" | "-11"
    );
    Ok(EstadoEnvio {
        glosa: tag(resp, "GLOSA").unwrap_or_default(),
        aceptados: num("ACEPTADOS"),
        rechazados: num("RECHAZADOS"),
        reparos: num("REPAROS"),
        pendiente,
        estado,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lee_respuestas_escapadas() {
        let r = "<soapenv:Envelope><soapenv:Body><ns1:getSeedResponse><getSeedReturn>&lt;?xml version=&quot;1.0&quot;?&gt;&lt;SII:RESPUESTA xmlns:SII=&quot;http://www.sii.cl/XMLSchema&quot;&gt;&lt;SII:RESP_BODY&gt;&lt;SEMILLA&gt;012345678901&lt;/SEMILLA&gt;&lt;/SII:RESP_BODY&gt;&lt;SII:RESP_HDR&gt;&lt;ESTADO&gt;00&lt;/ESTADO&gt;&lt;/SII:RESP_HDR&gt;&lt;/SII:RESPUESTA&gt;</getSeedReturn></ns1:getSeedResponse></soapenv:Body></soapenv:Envelope>";
        assert_eq!(parse_seed(r).unwrap(), "012345678901");
        let t = "<SII:RESPUESTA><SII:RESP_BODY><TOKEN>ABC123</TOKEN></SII:RESP_BODY><SII:RESP_HDR><ESTADO>00</ESTADO></SII:RESP_HDR></SII:RESPUESTA>";
        assert_eq!(parse_token(t).unwrap(), "ABC123");
        let bad = "<SII:RESP_HDR><ESTADO>10</ESTADO><GLOSA>Error</GLOSA></SII:RESP_HDR>";
        assert!(parse_token(bad).is_err());
    }

    #[test]
    fn subida_y_estado() {
        let ok = "<?xml version=\"1.0\"?><RECEPCIONDTE><RUTSENDER>1-9</RUTSENDER><RUTCOMPANY>2-7</RUTCOMPANY><FILE>e.xml</FILE><TIMESTAMP>x</TIMESTAMP><STATUS>0</STATUS><TRACKID>4242</TRACKID></RECEPCIONDTE>";
        assert_eq!(parse_upload(ok).unwrap().track_id, "4242");
        let ko = "<RECEPCIONDTE><STATUS>7</STATUS></RECEPCIONDTE>";
        assert!(
            parse_upload(ko)
                .unwrap_err()
                .to_string()
                .contains("esquema")
        );
        let st = "<SII:RESP_HDR><ESTADO>EPR</ESTADO><GLOSA>Envio Procesado</GLOSA></SII:RESP_HDR><SII:RESP_BODY><ACEPTADOS>1</ACEPTADOS><RECHAZADOS>0</RECHAZADOS><REPAROS>0</REPAROS></SII:RESP_BODY>";
        let e = parse_status(st).unwrap();
        assert_eq!(
            (e.estado.as_str(), e.aceptados, e.pendiente),
            ("EPR", Some(1), false)
        );
        assert_eq!(
            split_rut("76.123.456-k").unwrap(),
            ("76123456".into(), "K".into())
        );
    }
}
