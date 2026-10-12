//! Crédito a clientes: documentos de respaldo (todos opcionales), estado del cupo, consejos de qué
//! revisar y exportación de la carpeta del cliente. La persona decide a quién le presta: NÚCLEO
//! ordena lo recibido y sugiere; no consulta a terceros por su cuenta.

use crate::company::CompanySession;
use crate::sales_ops::{local_today, parse_date};
use crate::{AppError, AppResult};
use nucleo_db::audit::{self, AuditEntry};
use nucleo_db::core as dbcore;
use nucleo_db::customers::{self, CreditDocWrite};
use nucleo_db::now_utc;
use nucleo_io::vault;
use serde::{Deserialize, Serialize};
use std::path::Path;

/// Catálogo de documentos: (código, nombre, quién lo entrega o dónde se obtiene, cómo verificarlo,
/// qué mirar, días de vigencia sugeridos — 0 = sin vencimiento).
pub struct DocKind {
    pub code: &'static str,
    pub label: &'static str,
    pub source: &'static str,
    pub verify: &'static str,
    pub look_for: &'static str,
    pub fresh_days: i64,
    /// Solo aplica a empresas (sociedades).
    pub company_only: bool,
}

pub const DOC_KINDS: &[DocKind] = &[
    DocKind {
        code: "situacion_sii",
        label: "Situación tributaria en el SII",
        source: "Consulta gratuita y pública en sii.cl → Servicios online → Situación tributaria → Consultar situación tributaria de terceros (solo con el RUT).",
        verify: "La haces tú mismo: guarda una captura o el PDF de la consulta con la fecha.",
        look_for: "Que tenga inicio de actividades, que el giro calce con lo que te compra y que no aparezcan observaciones.",
        fresh_days: 30,
        company_only: false,
    },
    DocKind {
        code: "carpeta_tributaria",
        label: "Carpeta tributaria electrónica",
        source: "El cliente la genera en sii.cl (Servicios online → Situación tributaria → Carpeta tributaria electrónica) y te la envía.",
        verify: "Con el código y la clave que vienen en el envío, en el mismo servicio del SII. El acceso dura 90 días.",
        look_for: "Ventas de los últimos 12 meses (F29), la última renta (F22), propiedades y si declara a tiempo.",
        fresh_days: 90,
        company_only: false,
    },
    DocKind {
        code: "vigencia",
        label: "Certificado de vigencia de la sociedad",
        source: "Gratis en registrodeempresasysociedades.cl (empresas creadas o migradas ahí) o en el Conservador de Bienes Raíces del domicilio.",
        verify: "Revisa el código de verificación del certificado en el sitio que lo emitió.",
        look_for: "Que la sociedad esté vigente y la fecha de emisión sea reciente.",
        fresh_days: 30,
        company_only: true,
    },
    DocKind {
        code: "anotaciones",
        label: "Inscripción con anotaciones marginales",
        source: "Conservador de Bienes Raíces (Registro de Comercio) del domicilio de la sociedad, o el estatuto actualizado del Registro de Empresas y Sociedades.",
        verify: "Revisa el código de verificación del documento en el sitio del Conservador o del Registro.",
        look_for: "Modificaciones, cambios de socios, disolución o embargos anotados al margen.",
        fresh_days: 60,
        company_only: true,
    },
    DocKind {
        code: "poderes",
        label: "Inscripción de poderes",
        source: "Conservador de Bienes Raíces o la escritura de poderes que te entregue el cliente.",
        verify: "Compara el nombre y RUT de quien firma la orden de compra o el pagaré con los apoderados vigentes.",
        look_for: "Que quien compra o firma tenga facultades para obligar a la empresa.",
        fresh_days: 60,
        company_only: true,
    },
    DocKind {
        code: "informe_comercial",
        label: "Informe comercial (Dicom / Equifax u otro)",
        source: "Lo contratas tú en Equifax u otro buró de crédito, o te lo entrega el cliente.",
        verify: "Usa solo informes emitidos por el buró y pide autorización al cliente para consultarlo.",
        look_for: "Morosidades, protestos, deudas impagas y su evolución reciente.",
        fresh_days: 30,
        company_only: false,
    },
    DocKind {
        code: "otro",
        label: "Otros respaldos (pagaré, garantía, balance…)",
        source: "Lo que acuerdes con el cliente: pagaré, cheque en garantía, balances, referencias comerciales.",
        verify: "Guarda el original firmado; aquí queda una copia digital.",
        look_for: "Montos y fechas que coincidan con el cupo que otorgas.",
        fresh_days: 0,
        company_only: false,
    },
];

pub const DOC_STATUSES: &[&str] = &["pendiente", "recibido", "verificado", "no_aplica"];

#[derive(Debug, Clone, Serialize)]
pub struct CreditDoc {
    pub kind: String,
    pub label: String,
    pub source: String,
    pub verify: String,
    pub look_for: String,
    pub company_only: bool,
    pub fresh_days: i64,
    pub status: String,
    pub attachment_uid: Option<String>,
    pub file_name: Option<String>,
    pub issued_on: Option<String>,
    pub verified_on: Option<String>,
    pub note: Option<String>,
    /// `true` si la fecha del documento supera la vigencia sugerida.
    pub stale: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct CustomerCredit {
    pub enabled: bool,
    pub days: i64,
    pub limit_minor: Option<i64>,
    pub conditions: Option<String>,
    /// Deuda abierta del cliente y la parte vencida.
    pub debt_minor: i64,
    pub overdue_minor: i64,
    /// Cupo disponible (si tiene cupo).
    pub available_minor: Option<i64>,
    pub docs: Vec<CreditDoc>,
    /// Documentos recibidos o verificados / documentos que aplican.
    pub docs_ready: i64,
    pub docs_applicable: i64,
    /// Consejos en lenguaje claro.
    pub advice: Vec<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct CreditDocInput {
    pub status: String,
    /// Documento adjunto (uid); `None` lo desvincula.
    pub attachment_uid: Option<String>,
    pub issued_on: Option<String>,
    pub verified_on: Option<String>,
    pub note: Option<String>,
}

fn safe_name(s: &str) -> String {
    let out: String = s
        .chars()
        .map(|c| {
            if "<>:\"/\\|?*".contains(c) || c.is_control() {
                '_'
            } else {
                c
            }
        })
        .collect();
    let t = out.trim().trim_end_matches('.').to_string();
    if t.is_empty() {
        "Cliente".into()
    } else {
        t.chars().take(80).collect()
    }
}

impl CompanySession {
    fn customer_row(&self, uid: &str) -> AppResult<customers::CustomerRow> {
        customers::by_uid(self.db.conn(), uid)?
            .ok_or_else(|| AppError::NotFound("el cliente".into()))
    }

    /// Ficha de crédito del cliente: cupo, deuda, documentos y consejos.
    pub fn customer_credit(&self, uid: &str) -> AppResult<CustomerCredit> {
        self.require("clientes.ver")?;
        let c = self.customer_row(uid)?;
        let conn = self.db.conn();
        let today = local_today(conn)?;
        let t = crate::inventory_ops::date_ord(&today).unwrap_or(0);
        let (debt, overdue) = if self.can("ventas.ver") {
            customers::open_balance(conn, c.id, &today)?
        } else {
            (0, 0)
        };
        let rows = customers::credit_docs(conn, c.id)?;
        let company = c.profile.kind == "empresa";
        let mut docs = Vec::new();
        for k in DOC_KINDS {
            let r = rows.iter().find(|r| r.kind == k.code);
            let issued = r.and_then(|r| r.issued_on.clone());
            let stale = k.fresh_days > 0
                && issued
                    .as_deref()
                    .and_then(crate::inventory_ops::date_ord)
                    .is_some_and(|d| t - d > k.fresh_days);
            docs.push(CreditDoc {
                kind: k.code.into(),
                label: k.label.into(),
                source: k.source.into(),
                verify: k.verify.into(),
                look_for: k.look_for.into(),
                company_only: k.company_only,
                fresh_days: k.fresh_days,
                status: r
                    .map(|r| r.status.clone())
                    .unwrap_or_else(|| "pendiente".into()),
                attachment_uid: r.and_then(|r| r.attachment_uid.clone()),
                file_name: r.and_then(|r| r.file_name.clone()),
                issued_on: issued,
                verified_on: r.and_then(|r| r.verified_on.clone()),
                note: r.and_then(|r| r.note.clone()),
                stale,
            });
        }
        let applicable: Vec<&CreditDoc> = docs
            .iter()
            .filter(|d| d.status != "no_aplica" && d.kind != "otro" && (company || !d.company_only))
            .collect();
        let ready = applicable
            .iter()
            .filter(|d| d.status == "recibido" || d.status == "verificado")
            .count() as i64;
        let applicable_count = applicable.len() as i64;
        let p = &c.profile;
        let mut advice = Vec::new();
        if p.credit_enabled {
            if ready == 0 {
                advice.push(if company {
                    "Crédito habilitado sin respaldos. Es tu decisión; para una empresa te sugerimos al menos la carpeta tributaria y el certificado de vigencia.".to_string()
                } else {
                    "Crédito habilitado sin respaldos. Si es alguien de confianza está bien; si no, pide al menos la carpeta tributaria o un informe comercial.".to_string()
                });
            }
            if p.credit_limit_minor.is_none() {
                advice.push("No tiene cupo: define un monto máximo para que NÚCLEO te avise antes de pasarte.".into());
            }
            if p.payment_terms_days == 0 {
                advice.push(
                    "No tiene días de crédito: se propondrán 30 días al venderle a crédito.".into(),
                );
            }
        } else if ready > 0 {
            advice.push(
                "Ya tienes respaldos: si los revisaste, puedes habilitarle crédito en Editar."
                    .into(),
            );
        }
        if let Some(l) = p.credit_limit_minor
            && debt > l
        {
            advice.push("La deuda actual supera el cupo: cobra antes de venderle más a crédito o revisa el cupo.".into());
        }
        if overdue > 0 {
            advice
                .push("Tiene saldos vencidos: conviene cobrar antes de darle más crédito.".into());
        }
        for d in &docs {
            if d.stale && d.status != "no_aplica" {
                advice.push(format!(
                    "«{}» tiene más de {} días: pide uno actualizado.",
                    d.label, d.fresh_days
                ));
            }
            if d.status == "recibido" && d.kind != "otro" {
                advice.push(format!(
                    "«{}» está recibido pero sin verificar: {}",
                    d.label, d.verify
                ));
            }
        }
        if company && p.business_activity.is_none() {
            advice.push(
                "Falta el giro del cliente: lo ves en la consulta de situación tributaria del SII."
                    .into(),
            );
        }
        Ok(CustomerCredit {
            enabled: p.credit_enabled,
            days: p.payment_terms_days,
            limit_minor: p.credit_limit_minor,
            conditions: p.credit_conditions.clone(),
            debt_minor: debt,
            overdue_minor: overdue,
            available_minor: p.credit_limit_minor.map(|l| l - debt),
            docs,
            docs_ready: ready,
            docs_applicable: applicable_count,
            advice,
        })
    }

    /// Guarda el estado de un documento de respaldo (y su archivo adjunto, si lo tiene).
    pub fn save_credit_doc(
        &mut self,
        uid: &str,
        kind: &str,
        input: &CreditDocInput,
    ) -> AppResult<CustomerCredit> {
        self.require("clientes.editar")?;
        let c = self.customer_row(uid)?;
        if !DOC_KINDS.iter().any(|k| k.code == kind) {
            return Err(AppError::Validation("tipo de documento no válido".into()));
        }
        let status = if input.status.is_empty() {
            "pendiente"
        } else {
            input.status.as_str()
        };
        if !DOC_STATUSES.contains(&status) {
            return Err(AppError::Validation(
                "estado del documento no válido".into(),
            ));
        }
        let attachment_id = match input.attachment_uid.as_deref().filter(|u| !u.is_empty()) {
            Some(u) => Some(
                dbcore::attachment(self.db.conn(), u)?
                    .ok_or_else(|| AppError::NotFound("el documento adjunto".into()))?
                    .id,
            ),
            None => None,
        };
        let date = |v: &Option<String>, label: &str| -> AppResult<Option<String>> {
            match v.as_deref().filter(|d| !d.is_empty()) {
                Some(d) => Ok(Some(parse_date(label, d)?)),
                None => Ok(None),
            }
        };
        let issued = date(&input.issued_on, "la fecha del documento")?;
        let verified = date(&input.verified_on, "la fecha de verificación")?;
        let note = input
            .note
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty());
        if note.is_some_and(|n| n.chars().count() > 1000) {
            return Err(AppError::Validation(
                "la nota admite hasta 1.000 caracteres".into(),
            ));
        }
        let user = self.actor_name()?;
        let now = now_utc();
        let tx = self.db.conn_mut().transaction()?;
        customers::save_credit_doc(
            &tx,
            c.id,
            &CreditDocWrite {
                kind,
                status,
                attachment_id,
                issued_on: issued.as_deref(),
                verified_on: verified.as_deref(),
                note,
                updated_at: &now,
            },
        )?;
        if let Some(a) = attachment_id {
            tx.execute(
                "INSERT OR IGNORE INTO attachment_links (attachment_id, entity, entity_id) VALUES (?1, 'cliente', ?2)",
                (a, c.id),
            )?;
        }
        audit::append(
            &tx,
            &AuditEntry {
                user_name: &user,
                action: "cliente.credito_documento",
                entity: "cliente",
                entity_id: Some(uid),
                after_json: serde_json::to_string(
                    &serde_json::json!({ "documento": kind, "estado": status }),
                )
                .ok(),
                ..Default::default()
            },
        )?;
        tx.commit()?;
        self.customer_credit(uid)
    }

    /// Copia descifrada de los documentos del cliente en `dir/<Cliente (RUT)>/`, con los de crédito
    /// en la subcarpeta «Crédito». Devuelve la carpeta creada y cuántos archivos se copiaron.
    pub fn export_customer_folder(&mut self, uid: &str, dir: &Path) -> AppResult<(String, usize)> {
        let by = self.require("documentos.ver")?.username.clone();
        let c = self.customer_row(uid)?;
        let folder_name = match &c.rut {
            Some(r) => safe_name(&format!("{} ({})", c.name, r)),
            None => safe_name(&c.name),
        };
        let base = dir.join(&folder_name);
        let credit_dir = base.join("Crédito");
        std::fs::create_dir_all(&credit_dir)?;
        let conn = self.db.conn();
        let docs = customers::credit_docs(conn, c.id)?;
        let all = dbcore::attachments(conn, "", Some(("cliente", c.id)), 10_000)?;
        let mut n = 0;
        let mut used = std::collections::HashSet::new();
        for a in &all {
            let credit = docs
                .iter()
                .find(|d| d.attachment_uid.as_deref() == Some(a.uid.as_str()))
                .and_then(|d| {
                    DOC_KINDS
                        .iter()
                        .position(|k| k.code == d.kind)
                        .map(|i| (i, d))
                });
            let (target_dir, name) = match credit {
                Some((i, _)) => (
                    &credit_dir,
                    safe_name(&format!(
                        "{:02} {} - {}",
                        i + 1,
                        DOC_KINDS[i].label,
                        a.file_name
                    )),
                ),
                None => (&base, safe_name(&a.file_name)),
            };
            let mut path = target_dir.join(&name);
            let mut k = 2;
            // Se reemplazan las copias de una exportación anterior; solo se evitan choques entre archivos de esta.
            while !used.insert(path.clone()) {
                path = target_dir.join(format!("{k} - {name}"));
                k += 1;
            }
            let plain = vault::load(&self.documents_dir(), self.key.expose_bytes(), &a.sha256)?;
            std::fs::write(&path, plain)?;
            n += 1;
        }
        let tx = self.db.conn_mut().transaction()?;
        audit::append(
            &tx,
            &AuditEntry {
                user_name: &by,
                action: "cliente.exportar_carpeta",
                entity: "cliente",
                entity_id: Some(uid),
                after_json: serde_json::to_string(&serde_json::json!({ "archivos": n })).ok(),
                ..Default::default()
            },
        )?;
        tx.commit()?;
        Ok((base.to_string_lossy().into_owned(), n))
    }
}
