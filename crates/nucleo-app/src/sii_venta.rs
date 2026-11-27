//! Documento tributario de una venta de NÚCLEO: arma el borrador de la factura (afecta o exenta) con
//! el receptor, las líneas, la forma de pago y las referencias de la venta, para revisarlo antes de
//! timbrarlo. Al emitirlo en producción, la venta queda documentada con el folio.

use crate::company::CompanySession;
use crate::sales_ops::ExternalRefInput;
use crate::sii_ops::{SiiDocument, SiiIssueInput};
use crate::{AppError, AppResult};
use nucleo_db::customers;
use nucleo_dte::sii::Ambiente;
use nucleo_dte::{Detalle, Receptor, Referencia};
use rusqlite::{OptionalExtension, params};

fn limpio(v: &Option<String>) -> Option<String> {
    v.as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from)
}

impl CompanySession {
    /// Borrador del documento tributario de una venta efectuada (no timbra ni guarda nada).
    pub fn sii_sale_draft(&self, sale_uid: &str) -> AppResult<SiiIssueInput> {
        self.require("ventas.documentar")?;
        let s = self.sale(sale_uid)?;
        if !matches!(s.summary.commercial_state.as_str(), "efectuada" | "cerrada") {
            return Err(AppError::Validation(
                "solo se emite el documento de una venta efectuada".into(),
            ));
        }
        if s.summary.historical {
            return Err(AppError::Validation(
                "una venta histórica ya tiene su documento: no se emite de nuevo".into(),
            ));
        }
        let c = self.sii_row()?;
        let ya: Option<(u16, i64)> = self
            .db
            .conn()
            .query_row(
                "SELECT d.tipo, d.folio FROM sii_documents d JOIN sales s ON s.id = d.sale_id
                 WHERE s.uid = ?1 AND d.ambiente = ?2 AND d.tipo IN (33, 34) AND d.estado <> 'rechazado'
                 ORDER BY d.id DESC LIMIT 1",
                params![sale_uid, c.ambiente.as_str()],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        if let Some((tipo, folio)) = ya {
            return Err(AppError::Validation(format!(
                "esta venta ya tiene {} N° {folio}",
                crate::sii_ops::tipo_nombre(tipo).to_lowercase()
            )));
        }
        let terms = s.terms.clone().unwrap_or_default();
        // Receptor: lo que quedó en el documento; lo que falte, de la ficha del cliente.
        let ficha = match s.customer_uid.as_deref() {
            Some(u) => customers::by_uid(self.db.conn(), u)?,
            None => None,
        };
        let r = terms.receiver.clone().unwrap_or_default();
        let de = |a: &Option<String>, b: Option<&Option<String>>| {
            limpio(a).or_else(|| b.and_then(limpio))
        };
        let p = ficha.as_ref().map(|f| &f.profile);
        let receptor = Receptor {
            rut: de(&r.rut, ficha.as_ref().map(|f| &f.rut)).unwrap_or_default(),
            razon_social: limpio(&r.name)
                .or_else(|| ficha.as_ref().map(|f| f.name.clone()))
                .unwrap_or_else(|| s.summary.customer_name.clone()),
            giro: de(&r.activity, p.map(|x| &x.business_activity)),
            direccion: de(&r.address, p.map(|x| &x.address)),
            comuna: de(&r.commune, p.map(|x| &x.commune)),
            ciudad: de(&r.city, p.map(|x| &x.city)),
            contacto: de(&r.contact, p.map(|x| &x.contact_name)),
            correo: de(&r.email, p.map(|x| &x.invoice_email))
                .or_else(|| ficha.as_ref().and_then(|f| limpio(&f.email))),
        };
        let afecta = s.totals.tax_minor > 0 && s.lines.iter().any(|l| l.taxable);
        let detalle = s
            .lines
            .iter()
            .map(|l| {
                let nombre: String = l.description.chars().take(80).collect();
                let resto: String = l.description.chars().skip(80).collect();
                Detalle {
                    codigo: None,
                    nombre,
                    descripcion: l
                        .detail
                        .clone()
                        .or(Some(resto))
                        .filter(|x| !x.trim().is_empty()),
                    cantidad_milli: Some(l.qty_milli),
                    unidad: None,
                    precio: Some(l.unit_price_minor),
                    descuento_pct: (l.discount_ppm > 0).then(|| l.discount_ppm as f64 / 10_000.0),
                    descuento_monto: (l.discount_minor > 0).then_some(l.discount_minor),
                    monto: l.net_minor,
                    exento: !afecta || !l.taxable,
                }
            })
            .collect();
        let credito = terms.payment == "credito";
        Ok(SiiIssueInput {
            tipo: if afecta { 33 } else { 34 },
            fecha: None,
            receptor,
            detalle,
            referencias: terms
                .references
                .iter()
                .filter(|x| !x.folio.trim().is_empty())
                .map(|x| Referencia {
                    tipo: x.kind.chars().take(3).collect(),
                    folio: x.folio.trim().chars().take(18).collect(),
                    fecha: limpio(&x.date).unwrap_or_else(|| s.summary.issue_date.clone()),
                    codigo: None,
                    razon: limpio(&x.note),
                })
                .collect(),
            descuentos_globales: vec![],
            forma_pago: Some(if credito { 2 } else { 1 }),
            vencimiento: if credito {
                limpio(&terms.due_date).or_else(|| s.summary.due_date.clone())
            } else {
                None
            },
            ind_traslado: None,
            tipo_despacho: None,
            sale_uid: Some(sale_uid.to_string()),
        })
    }

    /// Después de timbrar el documento de una venta: en producción la venta queda documentada con el
    /// folio (en certificación es una prueba y la venta no cambia).
    pub(crate) fn sii_document_sale(&mut self, sale_uid: &str, d: &SiiDocument) -> AppResult<()> {
        if d.ambiente != Ambiente::Produccion || !matches!(d.tipo, 33 | 34) {
            return Ok(());
        }
        self.mark_documented(
            sale_uid,
            &ExternalRefInput {
                doc_kind: Some(d.tipo_nombre.clone()),
                external_number: Some(d.folio.to_string()),
                issue_date: Some(d.fecha.clone()),
                observation: Some("Emitida con NÚCLEO".into()),
            },
        )?;
        Ok(())
    }
}
