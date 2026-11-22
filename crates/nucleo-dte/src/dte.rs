//! Documento tributario electrónico: datos, armado del XML según el formato del SII, timbre
//! electrónico (TED) firmado con la llave del CAF y firma XML del documento con el certificado.

use crate::caf::Caf;
use crate::crypto::Certificate;
use crate::xml::{El, latin1};
use crate::{DteError, DteResult, NS_SII, NS_XSI};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum TipoDte {
    Factura = 33,
    FacturaExenta = 34,
    GuiaDespacho = 52,
    NotaDebito = 56,
    NotaCredito = 61,
}

impl TipoDte {
    pub fn code(self) -> u16 {
        self as u16
    }
    pub fn from_code(c: u16) -> Option<Self> {
        Some(match c {
            33 => Self::Factura,
            34 => Self::FacturaExenta,
            52 => Self::GuiaDespacho,
            56 => Self::NotaDebito,
            61 => Self::NotaCredito,
            _ => return None,
        })
    }
    pub fn name(self) -> &'static str {
        match self {
            Self::Factura => "Factura electrónica",
            Self::FacturaExenta => "Factura no afecta o exenta electrónica",
            Self::GuiaDespacho => "Guía de despacho electrónica",
            Self::NotaDebito => "Nota de débito electrónica",
            Self::NotaCredito => "Nota de crédito electrónica",
        }
    }
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(default)]
pub struct Emisor {
    pub rut: String,
    pub razon_social: String,
    pub giro: String,
    /// Códigos de actividad económica (1 a 4).
    pub actecos: Vec<u32>,
    pub direccion: String,
    pub comuna: String,
    pub ciudad: Option<String>,
    pub telefono: Option<String>,
    pub correo: Option<String>,
    /// Código de sucursal del SII, si emite desde una sucursal.
    pub cdg_sii_sucur: Option<u32>,
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(default)]
pub struct Receptor {
    pub rut: String,
    pub razon_social: String,
    pub giro: Option<String>,
    pub direccion: Option<String>,
    pub comuna: Option<String>,
    pub ciudad: Option<String>,
    pub contacto: Option<String>,
    pub correo: Option<String>,
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(default)]
pub struct Detalle {
    pub codigo: Option<String>,
    pub nombre: String,
    pub descripcion: Option<String>,
    /// Cantidad en milésimas (1 un = 1000).
    pub cantidad_milli: Option<i64>,
    pub unidad: Option<String>,
    /// Precio unitario neto en pesos.
    pub precio: Option<i64>,
    /// Descuento en porcentaje (0–100, con decimales).
    pub descuento_pct: Option<f64>,
    pub descuento_monto: Option<i64>,
    /// Monto neto de la línea (cantidad × precio − descuento).
    pub monto: i64,
    pub exento: bool,
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(default)]
pub struct Referencia {
    /// Tipo del documento referenciado (33, 52, 801 = orden de compra, HES, «SET»…).
    pub tipo: String,
    pub folio: String,
    pub fecha: String,
    /// 1 = anula, 2 = corrige texto, 3 = corrige montos (notas de crédito y débito).
    pub codigo: Option<u8>,
    pub razon: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Dte {
    pub tipo: TipoDte,
    pub folio: u64,
    /// AAAA-MM-DD
    pub fecha: String,
    /// 1 contado, 2 crédito, 3 sin costo.
    pub forma_pago: Option<u8>,
    pub vencimiento: Option<String>,
    /// Guía: 1 constituye venta, 2 venta por efectuar, 3 consignación, 5 traslado interno, 6 otros…
    pub ind_traslado: Option<u8>,
    /// Guía: 1 por cuenta del receptor, 2 del emisor a instalaciones del cliente, 3 del emisor a otras.
    pub tipo_despacho: Option<u8>,
    pub emisor: Emisor,
    pub receptor: Receptor,
    pub detalle: Vec<Detalle>,
    pub referencias: Vec<Referencia>,
    /// Tasa de IVA en partes por millón (de la configuración de la empresa; no está en el código).
    pub tasa_iva_ppm: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
pub struct Totales {
    pub neto: i64,
    pub exento: i64,
    pub iva: i64,
    pub total: i64,
}

fn clip(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

fn qty(milli: i64) -> String {
    let s = format!("{}.{:03}", milli / 1000, (milli % 1000).abs());
    s.trim_end_matches('0').trim_end_matches('.').to_string()
}

impl Dte {
    pub fn totales(&self) -> Totales {
        let exento_doc = self.tipo == TipoDte::FacturaExenta;
        let neto: i64 = self
            .detalle
            .iter()
            .filter(|d| !d.exento && !exento_doc)
            .map(|d| d.monto)
            .sum();
        let exento: i64 = self
            .detalle
            .iter()
            .filter(|d| d.exento || exento_doc)
            .map(|d| d.monto)
            .sum();
        let iva = if neto > 0 {
            let n = neto as i128 * self.tasa_iva_ppm as i128;
            ((n + 500_000) / 1_000_000) as i64
        } else {
            0
        };
        Totales {
            neto,
            exento,
            iva,
            total: neto + exento + iva,
        }
    }

    pub fn id(&self) -> String {
        format!("F{}T{}", self.folio, self.tipo.code())
    }

    /// Revisa lo que el SII rechazaría sin necesidad de enviarlo.
    pub fn validate(&self) -> DteResult<()> {
        let v = |m: &str| Err(DteError::Validation(m.into()));
        if self.folio == 0 {
            return v("falta el folio");
        }
        if self.detalle.is_empty() || self.detalle.len() > 60 {
            return v("el documento debe tener entre 1 y 60 líneas");
        }
        if self.emisor.actecos.is_empty() || self.emisor.actecos.len() > 4 {
            return v("el emisor debe tener entre 1 y 4 códigos de actividad económica");
        }
        for (k, val) in [
            ("el RUT del emisor", &self.emisor.rut),
            ("la razón social del emisor", &self.emisor.razon_social),
            ("el giro del emisor", &self.emisor.giro),
            ("la dirección del emisor", &self.emisor.direccion),
            ("la comuna del emisor", &self.emisor.comuna),
            ("el RUT del receptor", &self.receptor.rut),
            ("la razón social del receptor", &self.receptor.razon_social),
        ] {
            if val.trim().is_empty() {
                return Err(DteError::Validation(format!("falta {k}")));
            }
        }
        if matches!(self.tipo, TipoDte::Factura | TipoDte::FacturaExenta)
            && (self.receptor.giro.as_deref().unwrap_or("").is_empty()
                || self.receptor.direccion.as_deref().unwrap_or("").is_empty()
                || self.receptor.comuna.as_deref().unwrap_or("").is_empty())
        {
            return v("la factura necesita giro, dirección y comuna del receptor");
        }
        if self.tipo == TipoDte::GuiaDespacho && self.ind_traslado.is_none() {
            return v("la guía de despacho necesita el tipo de traslado");
        }
        if matches!(self.tipo, TipoDte::NotaCredito | TipoDte::NotaDebito)
            && !self.referencias.iter().any(|r| r.codigo.is_some())
        {
            return v(
                "la nota debe referenciar el documento que corrige (anula, corrige texto o montos)",
            );
        }
        if self.tipo == TipoDte::Factura
            && self.tasa_iva_ppm <= 0
            && self.detalle.iter().any(|d| !d.exento)
        {
            return v("falta la tasa de IVA de la empresa");
        }
        if self.forma_pago == Some(2) && self.vencimiento.is_none() {
            return v("una venta a crédito necesita la fecha de vencimiento");
        }
        Ok(())
    }

    fn encabezado(&self, t: &Totales) -> El {
        let mut id_doc = El::new("IdDoc")
            .child(El::text("TipoDTE", self.tipo.code().to_string()))
            .child(El::text("Folio", self.folio.to_string()))
            .child(El::text("FchEmis", &self.fecha));
        if self.tipo == TipoDte::GuiaDespacho {
            id_doc = id_doc
                .opt("TipoDespacho", self.tipo_despacho.map(|x| x.to_string()))
                .opt("IndTraslado", self.ind_traslado.map(|x| x.to_string()));
        }
        id_doc = id_doc
            .opt("FmaPago", self.forma_pago.map(|x| x.to_string()))
            .opt("FchVenc", self.vencimiento.clone());
        let e = &self.emisor;
        let mut emisor = El::new("Emisor")
            .child(El::text("RUTEmisor", &e.rut))
            .child(El::text("RznSoc", clip(&e.razon_social, 100)))
            .child(El::text("GiroEmis", clip(&e.giro, 80)))
            .opt("Telefono", e.telefono.clone().map(|x| clip(&x, 20)))
            .opt("CorreoEmisor", e.correo.clone().map(|x| clip(&x, 80)));
        for a in &e.actecos {
            emisor.push(El::text("Acteco", a.to_string()));
        }
        let emisor = emisor
            .opt("CdgSIISucur", e.cdg_sii_sucur.map(|x| x.to_string()))
            .child(El::text("DirOrigen", clip(&e.direccion, 70)))
            .child(El::text("CmnaOrigen", clip(&e.comuna, 20)))
            .opt("CiudadOrigen", e.ciudad.clone().map(|x| clip(&x, 20)));
        let r = &self.receptor;
        let receptor = El::new("Receptor")
            .child(El::text("RUTRecep", &r.rut))
            .child(El::text("RznSocRecep", clip(&r.razon_social, 100)))
            .opt("GiroRecep", r.giro.clone().map(|x| clip(&x, 40)))
            .opt("Contacto", r.contacto.clone().map(|x| clip(&x, 80)))
            .opt("CorreoRecep", r.correo.clone().map(|x| clip(&x, 80)))
            .opt("DirRecep", r.direccion.clone().map(|x| clip(&x, 70)))
            .opt("CmnaRecep", r.comuna.clone().map(|x| clip(&x, 20)))
            .opt("CiudadRecep", r.ciudad.clone().map(|x| clip(&x, 20)));
        let mut tot = El::new("Totales");
        if t.neto > 0 || (self.tipo != TipoDte::FacturaExenta && t.exento == 0) {
            tot.push(El::text("MntNeto", t.neto.to_string()));
        }
        if t.exento > 0 {
            tot.push(El::text("MntExe", t.exento.to_string()));
        }
        if t.neto > 0 || (self.tipo != TipoDte::FacturaExenta && t.exento == 0) {
            tot.push(El::text("TasaIVA", ppm_pct(self.tasa_iva_ppm)));
            tot.push(El::text("IVA", t.iva.to_string()));
        }
        tot.push(El::text("MntTotal", t.total.to_string()));
        El::new("Encabezado")
            .child(id_doc)
            .child(emisor)
            .child(receptor)
            .child(tot)
    }

    fn detalle_el(&self) -> Vec<El> {
        self.detalle
            .iter()
            .enumerate()
            .map(|(i, d)| {
                let mut e = El::new("Detalle").child(El::text("NroLinDet", (i + 1).to_string()));
                if let Some(c) = d.codigo.as_deref().filter(|c| !c.is_empty()) {
                    e.push(
                        El::new("CdgItem")
                            .child(El::text("TpoCodigo", "INT1"))
                            .child(El::text("VlrCodigo", clip(c, 35))),
                    );
                }
                if d.exento || self.tipo == TipoDte::FacturaExenta {
                    e.push(El::text("IndExe", "1"));
                }
                e = e
                    .child(El::text("NmbItem", clip(&d.nombre, 80)))
                    .opt("DscItem", d.descripcion.clone().map(|x| clip(&x, 1000)))
                    .opt("QtyItem", d.cantidad_milli.map(qty))
                    .opt("UnmdItem", d.unidad.clone().map(|x| clip(&x, 4)))
                    .opt("PrcItem", d.precio.map(|p| p.to_string()))
                    .opt(
                        "DescuentoPct",
                        d.descuento_pct.filter(|p| *p > 0.0).map(|p| format!("{p}")),
                    )
                    .opt(
                        "DescuentoMonto",
                        d.descuento_monto.filter(|m| *m > 0).map(|m| m.to_string()),
                    )
                    .child(El::text("MontoItem", d.monto.to_string()));
                e
            })
            .collect()
    }

    fn referencias_el(&self) -> Vec<El> {
        self.referencias
            .iter()
            .enumerate()
            .map(|(i, r)| {
                El::new("Referencia")
                    .child(El::text("NroLinRef", (i + 1).to_string()))
                    .child(El::text("TpoDocRef", clip(&r.tipo, 3)))
                    .child(El::text("FolioRef", clip(&r.folio, 18)))
                    .child(El::text("FchRef", &r.fecha))
                    .opt("CodRef", r.codigo.map(|c| c.to_string()))
                    .opt("RazonRef", r.razon.clone().map(|x| clip(&x, 90)))
            })
            .collect()
    }

    /// Timbre electrónico: datos básicos del documento firmados con la llave del CAF.
    fn ted(&self, t: &Totales, caf: &Caf, tsted: &str) -> DteResult<El> {
        let dd = El::new("DD")
            .child(El::text("RE", &self.emisor.rut))
            .child(El::text("TD", self.tipo.code().to_string()))
            .child(El::text("F", self.folio.to_string()))
            .child(El::text("FE", &self.fecha))
            .child(El::text("RR", &self.receptor.rut))
            .child(El::text("RSR", clip(&self.receptor.razon_social, 40)))
            .child(El::text("MNT", t.total.to_string()))
            .child(El::text("IT1", clip(&self.detalle[0].nombre, 40)))
            .child(caf.node.clone())
            .child(El::text("TSTED", tsted));
        let frmt = caf.sign_dd(&latin1(&dd.to_xml()))?;
        Ok(El::new("TED")
            .attr("version", "1.0")
            .child(dd)
            .child(El::text("FRMT", frmt).attr("algoritmo", "SHA1withRSA")))
    }

    /// Arma, timbra y firma el documento. `timestamp` = AAAA-MM-DDTHH:MM:SS (hora de Chile).
    pub fn sign(&self, caf: &Caf, cert: &Certificate, timestamp: &str) -> DteResult<SignedDte> {
        self.validate()?;
        if caf.tipo != self.tipo.code() {
            return Err(DteError::Caf(format!(
                "el CAF es de tipo {} y el documento de tipo {}",
                caf.tipo,
                self.tipo.code()
            )));
        }
        if !caf.includes(self.folio) {
            return Err(DteError::Caf(format!(
                "el folio {} no está en el CAF ({}–{})",
                self.folio, caf.desde, caf.hasta
            )));
        }
        if normalize_rut(&caf.rut) != normalize_rut(&self.emisor.rut) {
            return Err(DteError::Caf("el CAF es de otra empresa".into()));
        }
        let t = self.totales();
        let mut doc = El::new("Documento")
            .attr("ID", self.id())
            .child(self.encabezado(&t));
        for d in self.detalle_el() {
            doc.push(d);
        }
        for r in self.referencias_el() {
            doc.push(r);
        }
        doc.push(self.ted(&t, caf, timestamp)?);
        doc.push(El::text("TmstFirma", timestamp));
        let scope = dte_scope();
        let sig = cert.xml_signature(&doc, &format!("#{}", self.id()), &scope, &scope, false)?;
        let dte = El::new("DTE")
            .ns("", NS_SII)
            .ns("xsi", NS_XSI)
            .attr("version", "1.0")
            .child(doc)
            .child(sig);
        Ok(SignedDte {
            tipo: self.tipo,
            folio: self.folio,
            totales: t,
            el: dte,
        })
    }
}

/// Espacios de nombres en el ámbito del documento y de su firma: el DTE declara los dos (así su
/// forma canónica es la misma dentro o fuera del sobre de envío).
pub fn dte_scope() -> BTreeMap<String, String> {
    let mut m = BTreeMap::new();
    m.insert(String::new(), NS_SII.to_string());
    m.insert("xsi".to_string(), NS_XSI.to_string());
    m
}

pub fn normalize_rut(r: &str) -> String {
    r.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>()
        .to_uppercase()
}

fn ppm_pct(ppm: i64) -> String {
    let s = format!("{}.{:02}", ppm / 10_000, (ppm % 10_000) / 100);
    s.trim_end_matches('0').trim_end_matches('.').to_string()
}

/// Documento timbrado y firmado.
#[derive(Debug, Clone)]
pub struct SignedDte {
    pub tipo: TipoDte,
    pub folio: u64,
    pub totales: Totales,
    pub el: El,
}

impl SignedDte {
    pub fn to_document(&self) -> Vec<u8> {
        self.el.to_document()
    }
    /// Texto del timbre (TED) para el código de barras PDF417 del documento impreso.
    pub fn ted_latin1(&self) -> Vec<u8> {
        self.el
            .find("Documento")
            .and_then(|d| d.find("TED"))
            .map(|t| latin1(&t.to_xml()))
            .unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formatos() {
        assert_eq!(qty(2000), "2");
        assert_eq!(qty(1500), "1.5");
        assert_eq!(qty(1250), "1.25");
        assert_eq!(ppm_pct(190_000), "19");
        assert_eq!(ppm_pct(195_000), "19.5");
        assert_eq!(normalize_rut("76.123.456-k"), "76123456K");
    }
}
