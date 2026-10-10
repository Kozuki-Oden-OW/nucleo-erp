//! Lectura del Registro de Compras y Ventas (RCV) descargado de sii.cl en formato CSV.
//!
//! El SII entrega un archivo por período y por registro (compras o ventas), separado por punto y
//! coma, con una fila por documento. Los encabezados se reconocen por su nombre (sin importar
//! mayúsculas, tildes ni espacios), así que columnas nuevas o en otro orden no rompen la lectura.
//! Las filas que no son documentos (totales, líneas vacías) se ignoran.

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RcvRow {
    pub sii_type: u32,
    pub folio: Option<String>,
    pub counterpart_rut: Option<String>,
    pub counterpart_name: Option<String>,
    /// Fecha del documento en formato AAAA-MM-DD.
    pub issue_date: Option<String>,
    /// Cantidad de documentos que representa la fila (los resúmenes de boletas traen varios).
    pub count: i64,
    pub exempt: i64,
    pub net: i64,
    /// Ventas: IVA; compras: IVA recuperable (o el IVA de activo fijo si es el único).
    pub tax: i64,
    pub tax_non_recoverable: i64,
    pub common_use_tax: i64,
    pub fixed_asset: bool,
    pub total: i64,
    /// Texto o código de la columna "Tipo Compra" / "Tipo Venta".
    pub operation_type: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RcvFile {
    pub rows: Vec<RcvRow>,
    /// Filas ignoradas con su motivo (número de línea del archivo, desde 1).
    pub skipped: Vec<(usize, String)>,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum RcvError {
    #[error("el archivo está vacío")]
    Empty,
    #[error("no parece un registro de compras o ventas del SII: falta la columna «{0}»")]
    MissingColumn(&'static str),
}

/// Encabezado normalizado: minúsculas, sin tildes ni signos.
fn norm(h: &str) -> String {
    h.trim()
        .trim_start_matches('\u{feff}')
        .chars()
        .map(|c| match c {
            'á' | 'Á' => 'a',
            'é' | 'É' => 'e',
            'í' | 'Í' => 'i',
            'ó' | 'Ó' => 'o',
            'ú' | 'Ú' | 'ü' | 'Ü' => 'u',
            'ñ' | 'Ñ' => 'n',
            c => c.to_ascii_lowercase(),
        })
        .filter(|c| c.is_ascii_alphanumeric())
        .collect()
}

fn split_line(line: &str, sep: char) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quoted = false;
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '"' if quoted && chars.peek() == Some(&'"') => {
                cur.push('"');
                chars.next();
            }
            '"' => quoted = !quoted,
            c if c == sep && !quoted => out.push(std::mem::take(&mut cur)),
            c => cur.push(c),
        }
    }
    out.push(cur);
    out.into_iter().map(|s| s.trim().to_string()).collect()
}

/// Monto entero en pesos: acepta "1.234.567", "1234567", "-500" y "1234,00".
fn amount(s: &str) -> i64 {
    let s = s.trim();
    if s.is_empty() {
        return 0;
    }
    let neg = s.starts_with('-');
    let int_part = if let Some((a, b)) = s.rsplit_once(',') {
        if b.len() <= 2 && b.chars().all(|c| c.is_ascii_digit()) {
            a
        } else {
            s
        }
    } else {
        s
    };
    let digits: String = int_part.chars().filter(|c| c.is_ascii_digit()).collect();
    let v: i64 = digits.parse().unwrap_or(0);
    if neg { -v } else { v }
}

/// "dd/mm/aaaa" o "dd-mm-aaaa" (o ya "aaaa-mm-dd") → "aaaa-mm-dd".
fn date(s: &str) -> Option<String> {
    let s = s.trim();
    let s = s.split_whitespace().next()?;
    let parts: Vec<&str> = s.split(['/', '-']).collect();
    if parts.len() != 3 {
        return None;
    }
    let (d, m, y) = if parts[0].len() == 4 {
        (parts[2], parts[1], parts[0])
    } else {
        (parts[0], parts[1], parts[2])
    };
    let (d, m, y): (u32, u32, u32) = (d.parse().ok()?, m.parse().ok()?, y.parse().ok()?);
    if !(1..=31).contains(&d) || !(1..=12).contains(&m) || y < 1900 {
        return None;
    }
    Some(format!("{y:04}-{m:02}-{d:02}"))
}

struct Cols {
    idx: Vec<String>,
}

impl Cols {
    /// Primera columna cuyo nombre normalizado empieza con alguno de los prefijos.
    fn find(&self, prefixes: &[&str]) -> Option<usize> {
        for p in prefixes {
            if let Some(i) = self.idx.iter().position(|h| h == p) {
                return Some(i);
            }
        }
        for p in prefixes {
            if let Some(i) = self.idx.iter().position(|h| h.starts_with(p)) {
                return Some(i);
            }
        }
        None
    }
}

pub fn parse(text: &str) -> Result<RcvFile, RcvError> {
    let mut lines = text
        .lines()
        .enumerate()
        .filter(|(_, l)| !l.trim().is_empty());
    let (_, header) = lines.next().ok_or(RcvError::Empty)?;
    let sep = [';', '\t', ',']
        .into_iter()
        .max_by_key(|c| header.matches(*c).count())
        .unwrap_or(';');
    let cols = Cols {
        idx: split_line(header, sep).iter().map(|h| norm(h)).collect(),
    };
    let c_type = cols
        .find(&["tipodoc", "tipodocumento", "tipodte"])
        .ok_or(RcvError::MissingColumn("Tipo Doc"))?;
    let c_folio = cols.find(&["folio"]);
    let c_rut = cols.find(&["rutproveedor", "rutcliente", "rutcontraparte", "rut"]);
    let c_name = cols.find(&["razonsocial"]);
    let c_date = cols.find(&["fechadocto", "fechaemision", "fechadocumento", "fecha"]);
    let c_exempt = cols.find(&["montoexento"]);
    let c_net = cols.find(&["montoneto"]);
    let c_tax = cols.find(&["montoivarecuperable", "montoiva", "iva"]);
    let c_nonrec = cols.find(&["montoivanorecuperable", "montoivanorec"]);
    let c_common = cols.find(&["ivausocomun"]);
    let c_fa_net = cols.find(&["montonetoactivofijo", "montoactivofijo"]);
    let c_fa_tax = cols.find(&["ivaactivofijo", "montoivaactivofijo"]);
    let c_total = cols.find(&["montototal"]);
    let c_count = cols.find(&["totaldocumentos", "cantidaddocumentos", "cantidad"]);
    let c_op = cols.find(&["tipocompra", "tipoventa", "tipotransaccion"]);
    if c_net.is_none() && c_exempt.is_none() {
        return Err(RcvError::MissingColumn("Monto Neto"));
    }

    let mut rows = Vec::new();
    let mut skipped = Vec::new();
    for (n, line) in lines {
        let f = split_line(line, sep);
        let get = |c: Option<usize>| c.and_then(|i| f.get(i)).map(String::as_str).unwrap_or("");
        let raw_type = get(Some(c_type));
        let sii_type: u32 = match raw_type
            .split(|c: char| !c.is_ascii_digit())
            .find(|s| !s.is_empty())
            .and_then(|s| s.parse().ok())
        {
            Some(t) => t,
            None => {
                skipped.push((n + 1, format!("sin tipo de documento («{raw_type}»)")));
                continue;
            }
        };
        let fa_tax = amount(get(c_fa_tax));
        let mut tax = amount(get(c_tax));
        if tax == 0 && fa_tax > 0 {
            tax = fa_tax;
        }
        let opt = |c: Option<usize>| Some(get(c).to_string()).filter(|s| !s.is_empty());
        rows.push(RcvRow {
            sii_type,
            folio: opt(c_folio),
            counterpart_rut: opt(c_rut),
            counterpart_name: opt(c_name),
            issue_date: date(get(c_date)),
            count: amount(get(c_count)).max(1),
            exempt: amount(get(c_exempt)),
            net: amount(get(c_net)),
            tax,
            tax_non_recoverable: amount(get(c_nonrec)),
            common_use_tax: amount(get(c_common)),
            fixed_asset: fa_tax > 0 || amount(get(c_fa_net)) > 0,
            total: amount(get(c_total)),
            operation_type: opt(c_op),
        });
    }
    Ok(RcvFile { rows, skipped })
}

/// Clasificación de una compra a partir de las columnas del registro.
pub fn purchase_kind(row: &RcvRow) -> &'static str {
    let op = row.operation_type.as_deref().map(norm).unwrap_or_default();
    if row.fixed_asset || op.contains("activo") || op == "4" {
        "activo_fijo"
    } else if op.contains("super") || op == "2" {
        "supermercado"
    } else if op.contains("bienraiz") || op.contains("bienesraices") || op == "3" {
        "bien_raiz"
    } else if row.common_use_tax > 0 || op.contains("comun") || op == "5" {
        "uso_comun"
    } else if (row.tax == 0 && row.tax_non_recoverable > 0)
        || op.contains("sinderecho")
        || op.contains("norecuperable")
        || op == "6"
    {
        "sin_derecho"
    } else {
        "giro"
    }
}

/// Una venta "no del giro" (activo fijo o bienes raíces) según la columna "Tipo Venta".
pub fn sale_not_of_business(row: &RcvRow) -> bool {
    let op = row.operation_type.as_deref().map(norm).unwrap_or_default();
    op.contains("activo") || op.contains("raiz") || op.contains("raices")
}

#[cfg(test)]
mod tests {
    use super::*;

    const COMPRAS: &str = "\u{feff}Nro;Tipo Doc;Tipo Compra;RUT Proveedor;Razon Social;Folio;Fecha Docto;Fecha Recepcion;Fecha Acuse;Monto Exento;Monto Neto;Monto IVA Recuperable;Monto Iva No Recuperable;Codigo IVA No Rec.;Monto Total;Monto Neto Activo Fijo;IVA Activo Fijo;IVA uso Comun;Impto. Sin Derecho a Credito;IVA No Retenido\n\
1;33;Del Giro;76123456-7;Proveedor Uno SpA;1500;05/09/2026 00:00:00;06/09/2026 10:00:00;;0;100000;19000;0;;119000;0;0;0;0;0\n\
2;33;Activo Fijo;76987654-3;Computadores Ltda;77;10/09/2026;;;0;1000000;0;0;;1190000;1000000;190000;0;0;0\n\
3;61;Del Giro;76123456-7;Proveedor Uno SpA;20;12/09/2026;;;0;10000;1900;0;;11900;0;0;0;0;0\n\
4;33;Del Giro;77111222-3;Restaurante;9;15/09/2026;;;0;50000;0;9500;3;59500;0;0;0;0;0\n\
;;;;;;;;;;Total;;;;;;;;;\n";

    #[test]
    fn lee_compras_del_sii() {
        let f = parse(COMPRAS).unwrap();
        assert_eq!(f.rows.len(), 4);
        assert_eq!(f.skipped.len(), 1);
        let r = &f.rows[0];
        assert_eq!(r.sii_type, 33);
        assert_eq!(r.issue_date.as_deref(), Some("2026-09-05"));
        assert_eq!((r.net, r.tax, r.total), (100_000, 19_000, 119_000));
        assert_eq!(purchase_kind(r), "giro");
        assert_eq!(purchase_kind(&f.rows[1]), "activo_fijo");
        assert_eq!(f.rows[1].tax, 190_000);
        assert_eq!(f.rows[2].sii_type, 61);
        assert_eq!(purchase_kind(&f.rows[3]), "sin_derecho");
    }

    #[test]
    fn lee_ventas_y_montos_con_puntos() {
        let t = "Nro;Tipo Doc;Tipo Venta;Rut cliente;Razon Social;Folio;Fecha Docto;Monto Exento;Monto Neto;Monto IVA;Monto total\n\
1;33;Del Giro;\"77.334.963-0\";\"Cliente; con punto y coma\";100;01-09-2026;0;1.000.000;190.000;1.190.000\n\
2;34;Activo Fijo;1-9;Otro;101;2026-09-02;50000;0;0;50000\n";
        let f = parse(t).unwrap();
        assert_eq!(f.rows.len(), 2);
        assert_eq!(
            f.rows[0].counterpart_name.as_deref(),
            Some("Cliente; con punto y coma")
        );
        assert_eq!(f.rows[0].net, 1_000_000);
        assert_eq!(f.rows[0].tax, 190_000);
        assert!(sale_not_of_business(&f.rows[1]));
        assert_eq!(f.rows[1].issue_date.as_deref(), Some("2026-09-02"));
    }

    #[test]
    fn rechaza_un_archivo_cualquiera() {
        assert_eq!(parse(""), Err(RcvError::Empty));
        assert_eq!(
            parse("nombre,precio\nA,1"),
            Err(RcvError::MissingColumn("Tipo Doc"))
        );
    }
}
