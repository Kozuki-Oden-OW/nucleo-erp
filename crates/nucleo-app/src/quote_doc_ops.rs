//! La cotización como documento para el cliente: plantilla, condiciones y la carpeta donde se
//! guardan los PDF emitidos.
//!
//! El PDF lo arma la interfaz (cuatro plantillas, con el logo del negocio); aquí se guarda lo que
//! debe durar: el ajuste del negocio («cotizaciones»), las condiciones de cada cotización y el
//! archivo en la carpeta elegida por el dueño. Emitir no cambia la cotización ni mueve stock o dinero.

use crate::{AppError, AppResult, CompanySession};
use data_encoding::BASE64;
use nucleo_db::audit;
use nucleo_db::core as dbcore;
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::{Path, PathBuf};

pub const TEMPLATES: [&str; 4] = ["clasica", "moderna", "compacta", "elegante"];
const SETTING: &str = "cotizaciones";
const MAX_PDF: usize = 15 * 1024 * 1024;
const CARD_LABEL: &str = "Pagar con tarjeta (Webpay)";
/// Un número de archivo con más dígitos que esto no es un correlativo (es una fecha, un RUT…).
const MAX_FILE_DIGITS: usize = 7;

/// Condiciones que acompañan a una cotización.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct QuoteTerms {
    /// Plazo de entrega, como se le dice al cliente («2 días hábiles»).
    pub delivery: String,
    pub warranty: String,
    /// Forma de pago («Contado», «30 días con orden de compra»…).
    pub payment: String,
}

/// Datos para que el cliente pague por transferencia. Son del propio negocio.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct QuoteBank {
    pub show: bool,
    pub holder: String,
    pub rut: String,
    pub bank: String,
    pub account_type: String,
    pub account: String,
    pub email: String,
}

/// Enlace para pagar con tarjeta (por ejemplo, el «link de pago» de Webpay del negocio). En el PDF
/// aparece como un botón que se puede pulsar.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct QuoteCard {
    pub show: bool,
    pub url: String,
    /// Texto del botón.
    pub label: String,
}

impl Default for QuoteCard {
    fn default() -> Self {
        Self {
            show: false,
            url: String::new(),
            label: CARD_LABEL.into(),
        }
    }
}

/// Colores del documento, como `#rrggbb`. Vacío = el color del negocio. El secundario se usa en
/// líneas y en el botón de pago (por ejemplo, el amarillo de un logo azul y amarillo).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct QuoteColors {
    pub primary: String,
    pub secondary: String,
}

/// Cómo va la numeración de cotizaciones, contando los archivos de la carpeta.
#[derive(Debug, Clone, Serialize)]
pub struct QuoteNumbering {
    pub prefix: String,
    pub width: i64,
    /// El número que tomará la próxima cotización.
    pub next_number: i64,
    pub next_label: String,
    /// Número más alto entre los archivos de la carpeta (si se sigue la carpeta y se pudo leer).
    pub folder_last: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct QuoteDocSettings {
    /// Una de [`TEMPLATES`].
    pub template: String,
    /// Carpeta del computador donde se guardan los PDF emitidos.
    pub folder: Option<String>,
    /// La numeración continúa después del número más alto que haya en los archivos de la carpeta
    /// (sirve cuando también se hacen cotizaciones fuera de NÚCLEO).
    pub follow_folder: bool,
    /// Condiciones habituales: se proponen en cada cotización nueva.
    pub terms: QuoteTerms,
    /// Línea de contacto («Si tiene alguna pregunta…»).
    pub contact_note: String,
    /// Frase de cierre.
    pub footer: String,
    pub bank: QuoteBank,
    pub card: QuoteCard,
    pub colors: QuoteColors,
    /// Escribir el nombre del negocio bajo el logo. Sin logo, el nombre va siempre.
    pub show_name: bool,
}

impl Default for QuoteDocSettings {
    fn default() -> Self {
        Self {
            template: TEMPLATES[0].into(),
            folder: None,
            follow_folder: true,
            terms: QuoteTerms::default(),
            contact_note: String::new(),
            footer: "Gracias por confiar en nosotros".into(),
            bank: QuoteBank::default(),
            card: QuoteCard::default(),
            colors: QuoteColors::default(),
            show_name: false,
        }
    }
}

/// Resultado de emitir: dónde quedó el archivo.
#[derive(Debug, Clone, Serialize)]
pub struct QuoteEmitted {
    pub path: String,
    pub file_name: String,
    pub folder: String,
}

fn short(what: &str, v: &str, max: usize) -> AppResult<String> {
    let t = v.trim();
    if t.chars().count() > max {
        return Err(AppError::Validation(format!(
            "{what} es demasiado largo (máximo {max} caracteres)"
        )));
    }
    Ok(t.to_string())
}

/// Un color `#rrggbb` (se guarda en minúsculas) o vacío.
fn color(what: &str, v: &str) -> AppResult<String> {
    let t = v.trim().to_ascii_lowercase();
    let ok = t.is_empty()
        || (t.len() == 7 && t.starts_with('#') && t[1..].chars().all(|c| c.is_ascii_hexdigit()));
    if !ok {
        return Err(AppError::Validation(format!(
            "{what} debe escribirse como #rrggbb, por ejemplo #0a51a4"
        )));
    }
    Ok(t)
}

fn clean_terms(t: &QuoteTerms) -> AppResult<QuoteTerms> {
    Ok(QuoteTerms {
        delivery: short("el plazo de entrega", &t.delivery, 120)?,
        warranty: short("la garantía", &t.warranty, 120)?,
        payment: short("la forma de pago", &t.payment, 120)?,
    })
}

/// Nombre de archivo válido en Windows: sin `\ / : * ? " < > |` ni caracteres de control.
pub fn safe_file_name(text: &str) -> String {
    let cleaned: String = text
        .chars()
        .map(|c| match c {
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => ' ',
            c if c.is_control() => ' ',
            c => c,
        })
        .collect();
    let joined = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let cut: String = joined.chars().take(90).collect();
    cut.trim_end_matches(['.', ' ']).to_string()
}

/// Número de cotización escrito en el nombre de un archivo: «COT-1523.pdf», «COT 1498C.pdf»,
/// «cot-000012 Cliente.pdf». Solo cuenta si el nombre empieza con el prefijo.
pub fn number_in_file_name(name: &str, prefix: &str) -> Option<i64> {
    let head = name.get(..prefix.len())?;
    if prefix.is_empty() || !head.eq_ignore_ascii_case(prefix) {
        return None;
    }
    let rest = name[prefix.len()..].trim_start_matches(['-', '_', ' ', '.']);
    let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
    if digits.is_empty() || digits.len() > MAX_FILE_DIGITS {
        return None;
    }
    digits.parse().ok()
}

/// Número más alto entre los archivos de la carpeta. `None` si la carpeta no existe, no se puede
/// leer o no tiene cotizaciones con ese prefijo.
pub fn folder_last_number(folder: &Path, prefix: &str) -> Option<i64> {
    std::fs::read_dir(folder)
        .ok()?
        .flatten()
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
        .filter_map(|e| number_in_file_name(&e.file_name().to_string_lossy(), prefix))
        .max()
}

fn settings_of(conn: &Connection) -> AppResult<QuoteDocSettings> {
    Ok(dbcore::get_setting(conn, SETTING)?
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default())
}

/// Texto «cómo pagar» para los correos de cobro: los datos de transferencia y el enlace de tarjeta
/// del negocio, si el dueño los tiene activados para sus cotizaciones. Vacío si no hay ninguno.
pub(crate) fn payment_block(conn: &Connection) -> AppResult<String> {
    let s = settings_of(conn)?;
    let mut out = String::new();
    let b = &s.bank;
    if b.show && !b.holder.trim().is_empty() && !b.account.trim().is_empty() {
        out.push_str("Puedes pagar por transferencia:\n");
        out.push_str(b.holder.trim());
        if !b.rut.trim().is_empty() {
            out.push_str(&format!("\nRUT {}", b.rut.trim()));
        }
        let cuenta = [b.bank.trim(), b.account_type.trim()]
            .into_iter()
            .filter(|x| !x.is_empty())
            .collect::<Vec<_>>()
            .join(" · ");
        out.push_str(&format!(
            "\n{}{}N° {}",
            cuenta,
            if cuenta.is_empty() { "" } else { " " },
            b.account.trim()
        ));
        if !b.email.trim().is_empty() {
            out.push_str(&format!("\nComprobante a: {}", b.email.trim()));
        }
        out.push_str("\n\n");
    }
    if s.card.show && !s.card.url.trim().is_empty() {
        out.push_str(&format!(
            "{} con tarjeta aquí: {}\n\n",
            if out.is_empty() {
                "Puedes pagar"
            } else {
                "También puedes pagar"
            },
            s.card.url.trim()
        ));
    }
    Ok(out)
}

fn cot_sequence(conn: &Connection) -> AppResult<dbcore::SequenceRow> {
    dbcore::sequences(conn)?
        .into_iter()
        .find(|s| s.doc_type == "COT")
        .ok_or_else(|| AppError::NotFound("la numeración de cotizaciones".into()))
}

fn folder_last(conn: &Connection, prefix: &str) -> AppResult<Option<i64>> {
    let s = settings_of(conn)?;
    Ok(match s.folder {
        Some(f) if s.follow_folder => folder_last_number(Path::new(&f), prefix),
        _ => None,
    })
}

/// Antes de numerar una cotización nueva: si en la carpeta hay un número más alto que el que
/// NÚCLEO iba a usar, la numeración salta al siguiente. Nunca retrocede. Si la carpeta no está
/// disponible (disco desconectado), se numera como siempre.
pub(crate) fn follow_folder_numbering(conn: &Connection, user: &str) -> AppResult<()> {
    let seq = cot_sequence(conn)?;
    let Some(last) = folder_last(conn, &seq.prefix)? else {
        return Ok(());
    };
    if last < seq.next_number || last + 1 >= 10_i64.pow(seq.width.clamp(1, 12) as u32) {
        return Ok(());
    }
    dbcore::raise_sequence(conn, "COT", last + 1)?;
    audit::append(
        conn,
        &audit::AuditEntry {
            user_name: user,
            action: "numeracion.seguir_carpeta",
            entity: "numeracion",
            entity_id: Some("COT"),
            before_json: Some(json!({ "next_number": seq.next_number }).to_string()),
            after_json: Some(json!({ "next_number": last + 1, "folder_last": last }).to_string()),
            ..Default::default()
        },
    )?;
    Ok(())
}

impl CompanySession {
    /// Qué número tomará la próxima cotización, contando los archivos de la carpeta.
    pub fn quote_numbering(&self) -> AppResult<QuoteNumbering> {
        self.require("ventas.ver")?;
        let conn = self.db.conn();
        let seq = cot_sequence(conn)?;
        let folder_last = folder_last(conn, &seq.prefix)?;
        let fits = |n: i64| n + 1 < 10_i64.pow(seq.width.clamp(1, 12) as u32);
        let next_number = match folder_last {
            Some(last) if last >= seq.next_number && fits(last) => last + 1,
            _ => seq.next_number,
        };
        Ok(QuoteNumbering {
            next_label: format!(
                "{}-{next_number:0width$}",
                seq.prefix,
                width = seq.width as usize
            ),
            prefix: seq.prefix,
            width: seq.width,
            next_number,
            folder_last,
        })
    }

    pub fn quote_doc_settings(&self) -> AppResult<QuoteDocSettings> {
        self.require("ventas.ver")?;
        settings_of(self.db.conn())
    }

    pub fn save_quote_doc_settings(&mut self, v: &QuoteDocSettings) -> AppResult<QuoteDocSettings> {
        let user = {
            self.require("config.editar")?;
            self.actor_name()?
        };
        if !TEMPLATES.contains(&v.template.as_str()) {
            return Err(AppError::Validation(
                "elige una de las plantillas de cotización".into(),
            ));
        }
        let folder = match v.folder.as_deref().map(str::trim).filter(|f| !f.is_empty()) {
            Some(f) => {
                if !Path::new(f).is_absolute() {
                    return Err(AppError::Validation(
                        "la carpeta debe ser una ruta completa, por ejemplo D:\\Mi empresa\\Cotizaciones".into(),
                    ));
                }
                Some(short("la carpeta", f, 400)?)
            }
            None => None,
        };
        let card_url = short("el enlace de pago con tarjeta", &v.card.url, 300)?;
        if !card_url.is_empty()
            && (!card_url.starts_with("https://")
                || card_url.len() < 12
                || card_url.chars().any(char::is_whitespace))
        {
            return Err(AppError::Validation(
                "el enlace de pago con tarjeta debe ser una dirección completa que empiece con https://".into(),
            ));
        }
        if v.card.show && card_url.is_empty() {
            return Err(AppError::Validation(
                "pega el enlace de pago con tarjeta, o desmarca «Mostrar el botón de pago con tarjeta»".into(),
            ));
        }
        let card_label = short("el texto del botón de pago", &v.card.label, 60)?;
        let clean = QuoteDocSettings {
            template: v.template.clone(),
            folder,
            follow_folder: v.follow_folder,
            terms: clean_terms(&v.terms)?,
            contact_note: short("la línea de contacto", &v.contact_note, 400)?,
            footer: short("la frase de cierre", &v.footer, 200)?,
            bank: QuoteBank {
                show: v.bank.show,
                holder: short("el titular de la cuenta", &v.bank.holder, 120)?,
                rut: short("el RUT de la cuenta", &v.bank.rut, 20)?,
                bank: short("el banco", &v.bank.bank, 80)?,
                account_type: short("el tipo de cuenta", &v.bank.account_type, 60)?,
                account: short("el número de cuenta", &v.bank.account, 40)?,
                email: short("el correo de avisos de pago", &v.bank.email, 120)?,
            },
            card: QuoteCard {
                show: v.card.show,
                url: card_url,
                label: if card_label.is_empty() {
                    CARD_LABEL.into()
                } else {
                    card_label
                },
            },
            colors: QuoteColors {
                primary: color("el color principal", &v.colors.primary)?,
                secondary: color("el color secundario", &v.colors.secondary)?,
            },
            show_name: v.show_name,
        };
        let conn = self.db.conn();
        dbcore::set_setting(
            conn,
            SETTING,
            &serde_json::to_value(&clean).unwrap_or_default(),
        )?;
        audit::append(
            conn,
            &audit::AuditEntry {
                user_name: &user,
                action: "cotizacion.ajustes",
                entity: "cotizaciones",
                after_json: Some(
                    json!({ "template": clean.template, "folder": clean.folder }).to_string(),
                ),
                ..Default::default()
            },
        )?;
        Ok(clean)
    }

    fn quote_ref(&self, uid: &str) -> AppResult<(i64, String, String, Option<String>)> {
        self.db
            .conn()
            .query_row(
                "SELECT q.id, q.number, COALESCE(c.name, q.prospect_name, ''), q.terms_json
                 FROM quotes q LEFT JOIN customers c ON c.id = q.customer_id WHERE q.uid = ?1",
                [uid],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .optional()?
            .ok_or_else(|| AppError::NotFound("la cotización".into()))
    }

    /// Condiciones de la cotización; si aún no tiene propias, las habituales del negocio.
    pub fn quote_terms(&self, uid: &str) -> AppResult<QuoteTerms> {
        self.require("ventas.ver")?;
        let (_, _, _, raw) = self.quote_ref(uid)?;
        match raw.and_then(|t| serde_json::from_str::<QuoteTerms>(&t).ok()) {
            Some(t) => Ok(t),
            None => Ok(self.quote_doc_settings()?.terms),
        }
    }

    pub fn save_quote_terms(&mut self, uid: &str, terms: &QuoteTerms) -> AppResult<QuoteTerms> {
        self.require("ventas.crear")?;
        let (id, _, _, _) = self.quote_ref(uid)?;
        let clean = clean_terms(terms)?;
        self.db.conn().execute(
            "UPDATE quotes SET terms_json = ?2 WHERE id = ?1",
            (id, serde_json::to_string(&clean).unwrap_or_default()),
        )?;
        Ok(clean)
    }

    /// Número de la cotización y ruta donde queda (o quedaría) su PDF emitido.
    pub(crate) fn quote_pdf_path(&self, uid: &str) -> AppResult<(String, PathBuf)> {
        self.require("ventas.ver")?;
        let (_, number, customer, _) = self.quote_ref(uid)?;
        let folder = self.quote_doc_settings()?.folder.ok_or_else(|| {
            AppError::Validation(
                "elige primero la carpeta donde se guardan las cotizaciones (Configuración → Cotizaciones)".into(),
            )
        })?;
        let file = format!("{}.pdf", safe_file_name(&format!("{number} {customer}")));
        Ok((number, PathBuf::from(folder).join(file)))
    }

    /// Guarda el PDF emitido en la carpeta de cotizaciones del negocio. Volver a emitir la misma
    /// cotización reemplaza el archivo anterior.
    pub fn save_quote_pdf(&mut self, uid: &str, pdf_base64: &str) -> AppResult<QuoteEmitted> {
        let user = {
            self.require("ventas.crear")?;
            self.actor_name()?
        };
        let (_, number, customer, _) = self.quote_ref(uid)?;
        let folder = self.quote_doc_settings()?.folder.ok_or_else(|| {
            AppError::Validation(
                "elige primero la carpeta donde se guardan las cotizaciones (Configuración → Cotizaciones)".into(),
            )
        })?;
        let bytes = BASE64.decode(pdf_base64.trim().as_bytes()).map_err(|_| {
            AppError::Validation("el documento llegó dañado: vuelve a emitirlo".into())
        })?;
        if !bytes.starts_with(b"%PDF-") || bytes.len() > MAX_PDF {
            return Err(AppError::Validation(
                "el documento no es un PDF válido: vuelve a emitirlo".into(),
            ));
        }
        let file_name = format!("{}.pdf", safe_file_name(&format!("{number} {customer}")));
        let dir = PathBuf::from(&folder);
        let path = dir.join(&file_name);
        std::fs::create_dir_all(&dir)
            .and_then(|_| std::fs::write(&path, &bytes))
            .map_err(|e| {
                AppError::Validation(format!(
                    "no se pudo guardar en «{folder}»: {e}. Revisa que la carpeta exista y que el archivo no esté abierto en otro programa"
                ))
            })?;
        let shown = path.to_string_lossy().to_string();
        audit::append(
            self.db.conn(),
            &audit::AuditEntry {
                user_name: &user,
                action: "cotizacion.emitir",
                entity: "cotizacion",
                entity_id: Some(uid),
                after_json: Some(json!({ "number": number, "path": shown }).to_string()),
                ..Default::default()
            },
        )?;
        Ok(QuoteEmitted {
            path: shown,
            file_name,
            folder,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn el_nombre_del_archivo_sirve_en_windows() {
        assert_eq!(
            safe_file_name("COT-000001 Soc. de Inv. / Desarrollo: \"I+D\" <Chile>?"),
            "COT-000001 Soc. de Inv. Desarrollo I+D Chile"
        );
        assert_eq!(
            safe_file_name("COT-000002  Clínica   Ñuñoa S.A."),
            "COT-000002 Clínica Ñuñoa S.A"
        );
        assert!(safe_file_name(&"x".repeat(300)).chars().count() <= 90);
    }

    #[test]
    fn lee_el_numero_del_nombre_del_archivo() {
        for (name, n) in [
            ("COT-1523.pdf", Some(1523)),
            ("COT-000001 Universidad de los Andes.pdf", Some(1)),
            ("COT-1498C.pdf", Some(1498)),
            ("COT-1295 (1).pdf", Some(1295)),
            ("cot 77.xlsx", Some(77)),
            ("COT_0042.pdf", Some(42)),
            ("COT-20261124.pdf", None), // una fecha no es un correlativo
            ("COTIZACION.pdf", None),
            ("Plantilla_Cotizacion.xlsx", None),
            ("OC-1523.pdf", None),
            ("ÑU", None),
        ] {
            assert_eq!(number_in_file_name(name, "COT"), n, "{name}");
        }
    }
}
