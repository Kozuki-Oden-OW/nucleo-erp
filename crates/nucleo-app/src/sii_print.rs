//! Representación impresa de un documento tributario electrónico: los datos se leen del XML firmado
//! (lo que se imprime es exactamente lo que se envió al SII) y el timbre va como código PDF417.
//! La interfaz arma la página (ejemplar tributario y cedible) y la imprime o guarda como PDF.

use crate::company::CompanySession;
use crate::sii_ops::{roxmltree_parse, tipo_nombre};
use crate::{AppError, AppResult};
use nucleo_dte::timbre::pdf417;
use nucleo_dte::xml::{El, Node, from_latin1, from_rox, latin1};
use rusqlite::OptionalExtension;
use serde::Serialize;

#[derive(Debug, Clone, Default, Serialize)]
pub struct PrintParte {
    pub rut: String,
    pub razon_social: String,
    pub giro: Option<String>,
    pub direccion: Option<String>,
    pub comuna: Option<String>,
    pub ciudad: Option<String>,
    pub telefono: Option<String>,
    pub correo: Option<String>,
    pub contacto: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct PrintLinea {
    pub codigo: Option<String>,
    pub nombre: String,
    pub descripcion: Option<String>,
    pub cantidad: Option<f64>,
    pub unidad: Option<String>,
    pub precio: Option<f64>,
    pub descuento_pct: Option<f64>,
    pub descuento_monto: Option<i64>,
    pub monto: i64,
    pub exento: bool,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct PrintGlobal {
    pub recargo: bool,
    pub glosa: Option<String>,
    /// «%» o «$».
    pub tipo_valor: String,
    pub valor: f64,
    pub exento: bool,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct PrintReferencia {
    pub tipo: String,
    pub tipo_nombre: String,
    pub folio: String,
    pub fecha: String,
    pub codigo: Option<u8>,
    pub razon: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct PrintTotales {
    pub neto: Option<i64>,
    pub exento: Option<i64>,
    pub tasa_iva: Option<f64>,
    pub iva: Option<i64>,
    pub total: i64,
}

/// Todo lo que necesita la página impresa de un documento.
#[derive(Debug, Clone, Default, Serialize)]
pub struct SiiPrintDoc {
    pub id: i64,
    pub ambiente: String,
    pub tipo: u16,
    pub tipo_nombre: String,
    pub folio: u64,
    pub fecha: String,
    pub vencimiento: Option<String>,
    /// 1 contado, 2 crédito, 3 sin costo.
    pub forma_pago: Option<u8>,
    pub ind_traslado: Option<u8>,
    pub emisor: PrintParte,
    pub receptor: PrintParte,
    pub lineas: Vec<PrintLinea>,
    pub globales: Vec<PrintGlobal>,
    pub referencias: Vec<PrintReferencia>,
    pub totales: PrintTotales,
    /// Unidad del SII de la casa matriz (bajo el recuadro): «SANTIAGO ORIENTE».
    pub unidad_sii: String,
    pub resolucion_numero: u32,
    pub resolucion_anio: String,
    /// Timbre electrónico como PDF417 (SVG).
    pub timbre_svg: String,
    /// Admite ejemplar cedible (facturas y guías; las notas no).
    pub cedible: bool,
}

fn kids<'a>(e: &'a El, name: &'a str) -> impl Iterator<Item = &'a El> + 'a {
    e.kids.iter().filter_map(move |k| match k {
        Node::El(c) if c.name == name => Some(c),
        _ => None,
    })
}

fn txt(e: Option<&El>, name: &str) -> Option<String> {
    e.and_then(|x| x.find(name))
        .map(|x| x.text_content().trim().to_string())
        .filter(|s| !s.is_empty())
}

fn num<T: std::str::FromStr>(e: Option<&El>, name: &str) -> Option<T> {
    txt(e, name).and_then(|s| s.parse().ok())
}

/// Nombre del documento referenciado, como se muestra en la tabla de referencias.
fn ref_nombre(tipo: &str) -> String {
    match tipo {
        "SET" => "Set de pruebas".into(),
        "30" => "Factura".into(),
        "33" => "Factura electrónica".into(),
        "34" => "Factura exenta electrónica".into(),
        "46" => "Factura de compra electrónica".into(),
        "50" => "Guía de despacho".into(),
        "52" => "Guía de despacho electrónica".into(),
        "55" => "Nota de débito".into(),
        "56" => "Nota de débito electrónica".into(),
        "60" => "Nota de crédito".into(),
        "61" => "Nota de crédito electrónica".into(),
        "801" => "Orden de compra".into(),
        "802" => "Nota de pedido".into(),
        "803" => "Contrato".into(),
        "HES" => "Hoja de entrada de servicio".into(),
        "HEM" => "Hoja de entrada de materiales".into(),
        otro => format!("Documento {otro}"),
    }
}

/// Lee el XML firmado de un documento y arma lo que se imprime.
pub fn print_doc(xml: &[u8]) -> AppResult<SiiPrintDoc> {
    let text = from_latin1(xml);
    let body = match text.find("?>") {
        Some(i) => &text[i + 2..],
        None => &text[..],
    };
    let parsed = roxmltree_parse(body)?;
    let dte = from_rox(parsed.root_element());
    let bad = || AppError::Validation("documento guardado dañado".into());
    let doc = dte.find("Documento").ok_or_else(bad)?;
    let enc = doc.find("Encabezado").ok_or_else(bad)?;
    let (id_doc, em, rec, tot) = (
        enc.find("IdDoc"),
        enc.find("Emisor"),
        enc.find("Receptor"),
        enc.find("Totales"),
    );
    let tipo: u16 = num(id_doc, "TipoDTE").ok_or_else(bad)?;
    let ted = doc.find("TED").ok_or_else(bad)?;
    let timbre_svg = pdf417(&latin1(&ted.to_xml()))?.svg();
    Ok(SiiPrintDoc {
        tipo,
        tipo_nombre: tipo_nombre(tipo),
        folio: num(id_doc, "Folio").ok_or_else(bad)?,
        fecha: txt(id_doc, "FchEmis").ok_or_else(bad)?,
        vencimiento: txt(id_doc, "FchVenc"),
        forma_pago: num(id_doc, "FmaPago"),
        ind_traslado: num(id_doc, "IndTraslado"),
        emisor: PrintParte {
            rut: txt(em, "RUTEmisor").unwrap_or_default(),
            razon_social: txt(em, "RznSoc").unwrap_or_default(),
            giro: txt(em, "GiroEmis"),
            direccion: txt(em, "DirOrigen"),
            comuna: txt(em, "CmnaOrigen"),
            ciudad: txt(em, "CiudadOrigen"),
            telefono: txt(em, "Telefono"),
            correo: txt(em, "CorreoEmisor"),
            contacto: None,
        },
        receptor: PrintParte {
            rut: txt(rec, "RUTRecep").unwrap_or_default(),
            razon_social: txt(rec, "RznSocRecep").unwrap_or_default(),
            giro: txt(rec, "GiroRecep"),
            direccion: txt(rec, "DirRecep"),
            comuna: txt(rec, "CmnaRecep"),
            ciudad: txt(rec, "CiudadRecep"),
            telefono: None,
            correo: txt(rec, "CorreoRecep"),
            contacto: txt(rec, "Contacto"),
        },
        lineas: kids(doc, "Detalle")
            .map(|d| {
                let d = Some(d);
                PrintLinea {
                    codigo: d
                        .and_then(|x| x.find("CdgItem"))
                        .and_then(|c| txt(Some(c), "VlrCodigo")),
                    nombre: txt(d, "NmbItem").unwrap_or_default(),
                    descripcion: txt(d, "DscItem"),
                    cantidad: num(d, "QtyItem"),
                    unidad: txt(d, "UnmdItem"),
                    precio: num(d, "PrcItem"),
                    descuento_pct: num(d, "DescuentoPct"),
                    descuento_monto: num(d, "DescuentoMonto"),
                    monto: num(d, "MontoItem").unwrap_or(0),
                    exento: txt(d, "IndExe").is_some(),
                }
            })
            .collect(),
        globales: kids(doc, "DscRcgGlobal")
            .map(|g| {
                let g = Some(g);
                PrintGlobal {
                    recargo: txt(g, "TpoMov").as_deref() == Some("R"),
                    glosa: txt(g, "GlosaDR"),
                    tipo_valor: txt(g, "TpoValor").unwrap_or_else(|| "$".into()),
                    valor: num(g, "ValorDR").unwrap_or(0.0),
                    exento: txt(g, "IndExeDR").is_some(),
                }
            })
            .collect(),
        referencias: kids(doc, "Referencia")
            .map(|r| {
                let r = Some(r);
                let tipo = txt(r, "TpoDocRef").unwrap_or_default();
                PrintReferencia {
                    tipo_nombre: ref_nombre(&tipo),
                    tipo,
                    folio: txt(r, "FolioRef").unwrap_or_default(),
                    fecha: txt(r, "FchRef").unwrap_or_default(),
                    codigo: num(r, "CodRef"),
                    razon: txt(r, "RazonRef"),
                }
            })
            .collect(),
        totales: PrintTotales {
            neto: num(tot, "MntNeto"),
            exento: num(tot, "MntExe"),
            tasa_iva: num(tot, "TasaIVA"),
            iva: num(tot, "IVA"),
            total: num(tot, "MntTotal").unwrap_or(0),
        },
        timbre_svg,
        cedible: matches!(tipo, 33 | 34 | 52),
        ..Default::default()
    })
}

impl CompanySession {
    /// Datos para imprimir un documento emitido (ejemplar tributario y cedible).
    pub fn sii_document_print(&self, id: i64) -> AppResult<SiiPrintDoc> {
        self.require("ventas.ver")?;
        let (ambiente, xml): (String, Vec<u8>) = self
            .db
            .conn()
            .query_row(
                "SELECT ambiente, xml FROM sii_documents WHERE id = ?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?
            .ok_or_else(|| AppError::NotFound("el documento".into()))?;
        let c = self.sii_row()?;
        let mut d = print_doc(&xml)?;
        d.id = id;
        d.ambiente = ambiente;
        d.unidad_sii = c.emisor.unidad_sii.clone();
        d.resolucion_numero = c.resolucion_numero.unwrap_or(0);
        d.resolucion_anio = c
            .resolucion_fecha
            .as_deref()
            .map(|f| f.chars().take(4).collect())
            .unwrap_or_default();
        Ok(d)
    }
}
