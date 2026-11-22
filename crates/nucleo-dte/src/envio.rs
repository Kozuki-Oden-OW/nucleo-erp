//! Sobre de envío al SII (`EnvioDTE`): carátula + documentos firmados, firmado completo con el
//! certificado de quien envía.

use crate::crypto::Certificate;
use crate::dte::{SignedDte, dte_scope};
use crate::xml::El;
use crate::{DteError, DteResult, NS_SII, NS_XSI, RUT_SII};
use std::collections::BTreeMap;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Caratula {
    pub rut_emisor: String,
    /// RUT de la persona dueña del certificado con que se envía.
    pub rut_envia: String,
    /// Normalmente el SII (60803000-K); en intercambio con clientes, el RUT del receptor.
    pub rut_receptor: String,
    /// Resolución que autoriza al emisor (AAAA-MM-DD; en certificación la fecha de postulación y número 0).
    pub fecha_resolucion: String,
    pub numero_resolucion: u32,
}

impl Caratula {
    pub fn al_sii(
        rut_emisor: &str,
        rut_envia: &str,
        fecha_resolucion: &str,
        numero_resolucion: u32,
    ) -> Self {
        Self {
            rut_emisor: rut_emisor.into(),
            rut_envia: rut_envia.into(),
            rut_receptor: RUT_SII.into(),
            fecha_resolucion: fecha_resolucion.into(),
            numero_resolucion,
        }
    }
}

/// Arma y firma el `EnvioDTE`. Devuelve el documento listo para subir (ISO-8859-1).
pub fn envio_dte(
    car: &Caratula,
    dtes: &[SignedDte],
    cert: &Certificate,
    timestamp: &str,
) -> DteResult<Vec<u8>> {
    Ok(envio_el(car, dtes, cert, timestamp)?.to_document())
}

pub fn envio_el(
    car: &Caratula,
    dtes: &[SignedDte],
    cert: &Certificate,
    timestamp: &str,
) -> DteResult<El> {
    if dtes.is_empty() {
        return Err(DteError::Validation("el envío no tiene documentos".into()));
    }
    if dtes.len() > 2000 {
        return Err(DteError::Validation(
            "un envío admite hasta 2000 documentos".into(),
        ));
    }
    let mut por_tipo: BTreeMap<u16, u32> = BTreeMap::new();
    for d in dtes {
        *por_tipo.entry(d.tipo.code()).or_default() += 1;
    }
    let mut caratula = El::new("Caratula")
        .attr("version", "1.0")
        .child(El::text("RutEmisor", &car.rut_emisor))
        .child(El::text("RutEnvia", &car.rut_envia))
        .child(El::text("RutReceptor", &car.rut_receptor))
        .child(El::text("FchResol", &car.fecha_resolucion))
        .child(El::text("NroResol", car.numero_resolucion.to_string()))
        .child(El::text("TmstFirmaEnv", timestamp));
    for (tipo, n) in &por_tipo {
        caratula.push(
            El::new("SubTotDTE")
                .child(El::text("TpoDTE", tipo.to_string()))
                .child(El::text("NroDTE", n.to_string())),
        );
    }
    let mut set = El::new("SetDTE").attr("ID", "SetDoc").child(caratula);
    for d in dtes {
        set.push(d.el.clone());
    }
    let scope = dte_scope();
    let sig = cert.xml_signature(&set, "#SetDoc", &scope, &scope, false)?;
    Ok(El::new("EnvioDTE")
        .ns("", NS_SII)
        .ns("xsi", NS_XSI)
        .attr(
            "xsi:schemaLocation",
            "http://www.sii.cl/SiiDte EnvioDTE_v10.xsd",
        )
        .attr("version", "1.0")
        .child(set)
        .child(sig))
}
