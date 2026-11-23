//! Intercambio de información: leer un sobre de documentos recibido de otro contribuyente (o el de
//! prueba que entrega el SII en la certificación) y armar las tres respuestas firmadas: acuse de recibo,
//! resultado comercial y recibo de mercaderías o servicios (Ley 19.983).

use crate::company::CompanySession;
use crate::sales_ops::log;
use crate::sii_ops::tipo_nombre;
use crate::{AppError, AppResult};
use nucleo_dte::crypto::FirmaEstado;
use nucleo_dte::dte::normalize_rut;
use nucleo_dte::intercambio::{
    EnvioRecibido, Responde, envio_recibos, estado_recepcion, glosa_recepcion_dte,
    glosa_recepcion_envio, leer_envio, respuesta_recepcion, respuesta_resultado,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
pub struct IntercambioDoc {
    pub tipo: u16,
    pub tipo_nombre: String,
    pub folio: u64,
    pub fecha: String,
    pub rut_emisor: String,
    pub razon_social: String,
    pub rut_receptor: String,
    pub total: i64,
    pub firma: FirmaEstado,
    /// 0 recibido; 3 no viene dirigido a esta empresa.
    pub estado: u8,
    pub glosa: String,
}

/// Lo que trae un sobre recibido y cómo se va a responder.
#[derive(Debug, Clone, Serialize)]
pub struct IntercambioResumen {
    pub set_id: String,
    pub rut_emisor: String,
    pub rut_receptor: String,
    pub firma: FirmaEstado,
    /// 0 conforme; 3 el sobre viene dirigido a otro RUT.
    pub estado_envio: u8,
    pub glosa_envio: String,
    pub documentos: Vec<IntercambioDoc>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct IntercambioInput {
    pub contacto: Option<String>,
    pub fono: Option<String>,
    pub mail: Option<String>,
    /// Lugar donde se recibieron las mercaderías o servicios (para el recibo).
    pub recinto: String,
}

/// Las respuestas listas para guardar o enviar. El resultado y los recibos solo existen si hay
/// documentos recibidos conformes.
pub struct IntercambioRespuestas {
    pub resumen: IntercambioResumen,
    pub recepcion: Vec<u8>,
    pub resultado: Option<Vec<u8>>,
    pub recibos: Option<Vec<u8>>,
}

fn resumen(envio: &EnvioRecibido, rut_propio: &str) -> IntercambioResumen {
    let estado_envio = if normalize_rut(&envio.rut_receptor) == normalize_rut(rut_propio) {
        0
    } else {
        3
    };
    IntercambioResumen {
        set_id: envio.set_id.clone(),
        rut_emisor: envio.rut_emisor.clone(),
        rut_receptor: envio.rut_receptor.clone(),
        firma: envio.firma,
        estado_envio,
        glosa_envio: glosa_recepcion_envio(estado_envio).into(),
        documentos: envio
            .dtes
            .iter()
            .map(|d| {
                let estado = estado_recepcion(d, rut_propio);
                IntercambioDoc {
                    tipo: d.tipo,
                    tipo_nombre: tipo_nombre(d.tipo),
                    folio: d.folio,
                    fecha: d.fecha.clone(),
                    rut_emisor: d.rut_emisor.clone(),
                    razon_social: d.razon_social_emisor.clone(),
                    rut_receptor: d.rut_receptor.clone(),
                    total: d.total,
                    firma: d.firma,
                    estado,
                    glosa: glosa_recepcion_dte(estado).into(),
                }
            })
            .collect(),
    }
}

impl CompanySession {
    fn rut_propio(&self) -> AppResult<String> {
        self.business()?
            .rut
            .filter(|r| !r.trim().is_empty())
            .ok_or_else(|| AppError::Validation("anota el RUT de la empresa en Mi negocio".into()))
    }

    /// Lee un sobre recibido y dice cómo se respondería (no firma ni guarda nada).
    pub fn sii_intercambio_leer(&self, xml: &[u8]) -> AppResult<IntercambioResumen> {
        self.require("ventas.ver")?;
        let envio = leer_envio(xml)?;
        Ok(resumen(&envio, &self.rut_propio()?))
    }

    /// Arma y firma las respuestas a un sobre recibido. Los documentos dirigidos a esta empresa se
    /// reciben y aceptan; los dirigidos a otro RUT se informan como no recibidos.
    pub fn sii_intercambio_responder(
        &mut self,
        xml: &[u8],
        nombre_archivo: &str,
        input: &IntercambioInput,
    ) -> AppResult<IntercambioRespuestas> {
        let user = self.require("ventas.documentar")?.username.clone();
        let rut = self.rut_propio()?;
        let envio = leer_envio(xml)?;
        let res = resumen(&envio, &rut);
        let c = self.sii_row()?;
        let cred = self.sii_credentials(&c)?;
        let cert = cred.certificate()?;
        let ts = self.sii_now()?;
        let opt = |s: &Option<String>| {
            s.as_deref()
                .map(str::trim)
                .filter(|x| !x.is_empty())
                .map(String::from)
        };
        let r = Responde {
            rut: cred.rut_emisor.clone(),
            contacto: opt(&input.contacto),
            fono: opt(&input.fono),
            mail: opt(&input.mail),
        };
        let id: u64 =
            self.db
                .conn()
                .query_row("SELECT CAST(strftime('%s', 'now') AS INTEGER)", [], |r| {
                    r.get::<_, i64>(0)
                })? as u64;
        let estados: Vec<u8> = if res.estado_envio == 0 {
            res.documentos.iter().map(|d| d.estado).collect()
        } else {
            // Sobre para otro RUT: ningún documento se recibe.
            vec![3; res.documentos.len()]
        };
        let recepcion = respuesta_recepcion(
            &envio,
            nombre_archivo,
            &r,
            id,
            res.estado_envio,
            &estados,
            &cert,
            &ts,
        )?;
        let ok: Vec<usize> = estados
            .iter()
            .enumerate()
            .filter(|(_, e)| **e == 0)
            .map(|(i, _)| i)
            .collect();
        let (resultado, recibos) = if ok.is_empty() {
            (None, None)
        } else {
            let aceptados: Vec<(usize, u8)> = ok.iter().map(|i| (*i, 0)).collect();
            (
                Some(respuesta_resultado(&envio, &r, id, &aceptados, &cert, &ts)?),
                Some(envio_recibos(
                    &envio,
                    &r,
                    &input.recinto,
                    &cred.rut_envia,
                    &ok,
                    &cert,
                    &ts,
                )?),
            )
        };
        log(
            self.db.conn(),
            &user,
            "create",
            "sii",
            &format!("intercambio-{id}"),
            &format!(
                "Respondió el envío {} de {}: {} documento(s), {} recibido(s)",
                envio.set_id,
                envio.rut_emisor,
                res.documentos.len(),
                ok.len()
            ),
            None,
        )?;
        Ok(IntercambioRespuestas {
            resumen: res,
            recepcion,
            resultado,
            recibos,
        })
    }
}
