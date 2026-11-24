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
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::{Path, PathBuf};

pub const TEMPLATES: [&str; 4] = ["clasica", "moderna", "compacta", "elegante"];
const SETTING: &str = "cotizaciones";
const MAX_PDF: usize = 15 * 1024 * 1024;

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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct QuoteDocSettings {
    /// Una de [`TEMPLATES`].
    pub template: String,
    /// Carpeta del computador donde se guardan los PDF emitidos.
    pub folder: Option<String>,
    /// Condiciones habituales: se proponen en cada cotización nueva.
    pub terms: QuoteTerms,
    /// Línea de contacto («Si tiene alguna pregunta…»).
    pub contact_note: String,
    /// Frase de cierre.
    pub footer: String,
    pub bank: QuoteBank,
}

impl Default for QuoteDocSettings {
    fn default() -> Self {
        Self {
            template: TEMPLATES[0].into(),
            folder: None,
            terms: QuoteTerms::default(),
            contact_note: String::new(),
            footer: "Gracias por confiar en nosotros".into(),
            bank: QuoteBank::default(),
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

impl CompanySession {
    pub fn quote_doc_settings(&self) -> AppResult<QuoteDocSettings> {
        self.require("ventas.ver")?;
        Ok(dbcore::get_setting(self.db.conn(), SETTING)?
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default())
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
        let clean = QuoteDocSettings {
            template: v.template.clone(),
            folder,
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
}
