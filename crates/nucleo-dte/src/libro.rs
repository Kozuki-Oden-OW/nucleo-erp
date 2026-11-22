//! Información Electrónica de Compras y Ventas (IECV, `LibroCompraVenta` v1.0): libro de ventas o de
//! compras de un período, con el resumen por tipo de documento y el detalle, firmado con el
//! certificado de quien envía. Se sube al SII por el mismo servicio que los DTE.
//!
//! En la certificación el SII pide un libro «ESPECIAL» con el número de atención del set como
//! `FolioNotificacion`.

use crate::crypto::Certificate;
use crate::dte::dte_scope;
use crate::xml::El;
use crate::{DteError, DteResult, NS_SII, NS_XSI};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Operacion {
    Venta,
    Compra,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CaratulaLibro {
    pub rut_emisor: String,
    pub rut_envia: String,
    /// AAAA-MM
    pub periodo: String,
    pub fecha_resolucion: String,
    pub numero_resolucion: u32,
    pub operacion: Operacion,
    /// MENSUAL, ESPECIAL (certificación o rectificación) o RECTIFICA.
    pub tipo_libro: String,
    /// Número de atención del set (libro especial de certificación) o de la notificación del SII.
    pub folio_notificacion: Option<u64>,
}

/// Una línea del libro (un documento). Montos en pesos.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(default)]
pub struct LineaLibro {
    pub tipo: u16,
    pub folio: u64,
    pub anulado: bool,
    /// Tasa de IVA en %, normalmente 19.
    pub tasa_iva: Option<f64>,
    /// AAAA-MM-DD
    pub fecha: String,
    pub rut: String,
    pub razon_social: String,
    /// Documento que modifica (notas de crédito o débito).
    pub tipo_ref: Option<u16>,
    pub folio_ref: Option<u64>,
    pub exento: i64,
    pub neto: i64,
    /// IVA recuperable (compras) o débito (ventas).
    pub iva: i64,
    /// Compras: IVA no recuperable (código SII 1–9 y monto).
    pub iva_no_recuperable: Option<(u8, i64)>,
    /// Compras: IVA de uso común (se prorratea con el factor de proporcionalidad).
    pub iva_uso_comun: Option<i64>,
    /// IVA retenido total (factura de compra).
    pub iva_retenido_total: Option<i64>,
    pub total: i64,
}

#[derive(Default)]
struct Tot {
    docs: u64,
    anulados: u64,
    exe: i64,
    neto: i64,
    iva: i64,
    ops_iva: u64,
    no_rec: BTreeMap<u8, (u64, i64)>,
    ops_uso_comun: u64,
    uso_comun: i64,
    ops_ret_total: u64,
    ret_total: i64,
    total: i64,
}

fn pct(p: f64) -> String {
    let s = format!("{:.2}", p);
    s.trim_end_matches('0').trim_end_matches('.').to_string()
}

/// Arma y firma el libro. `fct_prop` = factor de proporcionalidad del IVA de uso común (compras).
pub fn libro_cv(
    car: &CaratulaLibro,
    lineas: &[LineaLibro],
    fct_prop: Option<f64>,
    cert: &Certificate,
    timestamp: &str,
) -> DteResult<Vec<u8>> {
    Ok(libro_el(car, lineas, fct_prop, cert, timestamp)?.to_document())
}

pub fn libro_el(
    car: &CaratulaLibro,
    lineas: &[LineaLibro],
    fct_prop: Option<f64>,
    cert: &Certificate,
    timestamp: &str,
) -> DteResult<El> {
    let v = |m: &str| Err(DteError::Validation(m.into()));
    if car.periodo.len() != 7 || car.periodo.as_bytes()[4] != b'-' {
        return v("el período del libro va como AAAA-MM");
    }
    if !matches!(
        car.tipo_libro.as_str(),
        "MENSUAL" | "ESPECIAL" | "RECTIFICA"
    ) {
        return v("tipo de libro no válido");
    }
    if car.tipo_libro == "ESPECIAL" && car.folio_notificacion.is_none() {
        return v("el libro especial necesita el folio de notificación (número de atención)");
    }
    let compra = car.operacion == Operacion::Compra;
    let mut caratula = El::new("Caratula")
        .child(El::text("RutEmisorLibro", &car.rut_emisor))
        .child(El::text("RutEnvia", &car.rut_envia))
        .child(El::text("PeriodoTributario", &car.periodo))
        .child(El::text("FchResol", &car.fecha_resolucion))
        .child(El::text("NroResol", car.numero_resolucion.to_string()))
        .child(El::text(
            "TipoOperacion",
            if compra { "COMPRA" } else { "VENTA" },
        ))
        .child(El::text("TipoLibro", &car.tipo_libro))
        .child(El::text("TipoEnvio", "TOTAL"));
    if let Some(f) = car.folio_notificacion {
        caratula.push(El::text("FolioNotificacion", f.to_string()));
    }

    let mut tots: BTreeMap<u16, Tot> = BTreeMap::new();
    for l in lineas {
        let t = tots.entry(l.tipo).or_default();
        t.docs += 1;
        if l.anulado {
            t.anulados += 1;
            continue;
        }
        t.exe += l.exento;
        t.neto += l.neto;
        t.iva += l.iva;
        if l.iva > 0 {
            t.ops_iva += 1;
        }
        if let Some((c, m)) = l.iva_no_recuperable {
            let e = t.no_rec.entry(c).or_default();
            e.0 += 1;
            e.1 += m;
        }
        if let Some(m) = l.iva_uso_comun {
            t.ops_uso_comun += 1;
            t.uso_comun += m;
        }
        if let Some(m) = l.iva_retenido_total {
            t.ops_ret_total += 1;
            t.ret_total += m;
        }
        t.total += l.total;
    }

    let mut resumen = El::new("ResumenPeriodo");
    for (tipo, t) in &tots {
        let mut e = El::new("TotalesPeriodo")
            .child(El::text("TpoDoc", tipo.to_string()))
            .child(El::text("TotDoc", (t.docs - t.anulados).to_string()));
        if t.anulados > 0 {
            e.push(El::text("TotAnulado", t.anulados.to_string()));
        }
        e = e
            .child(El::text("TotMntExe", t.exe.to_string()))
            .child(El::text("TotMntNeto", t.neto.to_string()));
        if compra && t.ops_iva > 0 {
            e.push(El::text("TotOpIVARec", t.ops_iva.to_string()));
        }
        e.push(El::text("TotMntIVA", t.iva.to_string()));
        for (c, (ops, m)) in &t.no_rec {
            e.push(
                El::new("TotIVANoRec")
                    .child(El::text("CodIVANoRec", c.to_string()))
                    .child(El::text("TotOpIVANoRec", ops.to_string()))
                    .child(El::text("TotMntIVANoRec", m.to_string())),
            );
        }
        if t.ops_uso_comun > 0 {
            let f = fct_prop.ok_or_else(|| {
                DteError::Validation(
                    "falta el factor de proporcionalidad del IVA de uso común".into(),
                )
            })?;
            e = e
                .child(El::text("TotOpIVAUsoComun", t.ops_uso_comun.to_string()))
                .child(El::text("TotIVAUsoComun", t.uso_comun.to_string()))
                .child(El::text("FctProp", pct(f)))
                .child(El::text(
                    "TotCredIVAUsoComun",
                    ((t.uso_comun as f64) * f).round().to_string(),
                ));
        }
        if t.ops_ret_total > 0 {
            e = e
                .child(El::text("TotOpIVARetTotal", t.ops_ret_total.to_string()))
                .child(El::text("TotIVARetTotal", t.ret_total.to_string()));
        }
        e.push(El::text("TotMntTotal", t.total.to_string()));
        resumen.push(e);
    }

    let id = format!(
        "LIBRO_{}_{}",
        if compra { "COMPRA" } else { "VENTA" },
        car.periodo.replace('-', "")
    );
    let mut envio = El::new("EnvioLibro").attr("ID", &id).child(caratula);
    if !tots.is_empty() {
        envio.push(resumen);
    }
    for l in lineas {
        let mut d = El::new("Detalle")
            .child(El::text("TpoDoc", l.tipo.to_string()))
            .child(El::text("NroDoc", l.folio.to_string()));
        if l.anulado {
            d.push(El::text("Anulado", "A"));
            envio.push(d);
            continue;
        }
        d = d
            .opt("TasaImp", l.tasa_iva.filter(|_| l.neto != 0).map(pct))
            .child(El::text("FchDoc", &l.fecha))
            .child(El::text("RUTDoc", &l.rut))
            .child(El::text(
                "RznSoc",
                l.razon_social.chars().take(50).collect::<String>(),
            ))
            .opt("TpoDocRef", l.tipo_ref.map(|x| x.to_string()))
            .opt("FolioDocRef", l.folio_ref.map(|x| x.to_string()));
        if l.exento != 0 {
            d.push(El::text("MntExe", l.exento.to_string()));
        }
        d = d
            .child(El::text("MntNeto", l.neto.to_string()))
            .child(El::text("MntIVA", l.iva.to_string()));
        if let Some((c, m)) = l.iva_no_recuperable {
            d.push(
                El::new("IVANoRec")
                    .child(El::text("CodIVANoRec", c.to_string()))
                    .child(El::text("MntIVANoRec", m.to_string())),
            );
        }
        if let Some(m) = l.iva_uso_comun {
            d.push(El::text("IVAUsoComun", m.to_string()));
        }
        if let Some(m) = l.iva_retenido_total {
            d.push(El::text("IVARetTotal", m.to_string()));
        }
        d.push(El::text("MntTotal", l.total.to_string()));
        envio.push(d);
    }
    envio.push(El::text("TmstFirma", timestamp));
    let scope = dte_scope();
    let sig = cert.xml_signature(&envio, &format!("#{id}"), &scope, &scope, false)?;
    Ok(El::new("LibroCompraVenta")
        .ns("", NS_SII)
        .ns("xsi", NS_XSI)
        .attr(
            "xsi:schemaLocation",
            "http://www.sii.cl/SiiDte LibroCV_v10.xsd",
        )
        .attr("version", "1.0")
        .child(envio)
        .child(sig))
}
