//! Números de serie y certificados de calibración.
//!
//! Cada equipo con serie se registra una vez (producto + serie). Al venderlo queda unido a la venta y
//! al cliente, y guarda los datos de su certificado de calibración: número, fecha, laboratorio, la
//! fecha de la próxima calibración y dónde está el PDF en el computador. Con eso NÚCLEO responde «¿a
//! quién le vendimos la serie X?», «¿qué equipos tiene este cliente?» y «¿qué certificados vencen
//! pronto?» — esto último es una venta posible: la recalibración.
//!
//! La serie no reemplaza al stock: el inventario sigue contando unidades; la serie identifica cuál.

use crate::company::CompanySession;
use crate::inventory_ops::{date_ord, date_str};
use crate::sales_ops::{local_today, log, opt_text, parse_date};
use crate::{AppError, AppResult};
use nucleo_db::now_utc;
use nucleo_db::{customers, products};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};

pub const STATUSES: [&str; 3] = ["en_stock", "vendido", "baja"];
const MAX_BULK: usize = 500;

/// Serie normalizada para comparar: mayúsculas, sin espacios, guiones ni puntos.
pub fn serial_key(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_alphanumeric())
        .collect::<String>()
        .to_uppercase()
}

#[derive(Debug, Clone, Serialize)]
pub struct Serial {
    pub uid: String,
    pub serial: String,
    pub product_uid: String,
    pub product_name: String,
    pub product_sku: String,
    /// "en_stock", "vendido" o "baja".
    pub status: String,
    pub sale_uid: Option<String>,
    pub sale_number: Option<String>,
    pub customer_uid: Option<String>,
    pub customer_name: Option<String>,
    pub sold_at: Option<String>,
    pub certificate_number: Option<String>,
    pub certificate_date: Option<String>,
    /// Próxima calibración (vencimiento del certificado).
    pub certificate_due: Option<String>,
    pub certificate_lab: Option<String>,
    /// Ruta del PDF del certificado en el computador.
    pub certificate_file: Option<String>,
    pub notes: Option<String>,
    /// Días que faltan para la próxima calibración (negativo: vencida).
    pub due_in_days: Option<i64>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct SerialInput {
    pub product_uid: String,
    pub serial: String,
    pub certificate_number: Option<String>,
    pub certificate_date: Option<String>,
    pub certificate_due: Option<String>,
    pub certificate_lab: Option<String>,
    pub certificate_file: Option<String>,
    pub notes: Option<String>,
    /// Solo «en_stock» o «baja» (vender es asignar la serie a una venta).
    pub status: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct SerialFilter {
    /// Texto: serie, producto, cliente o número de certificado.
    pub query: Option<String>,
    pub product_uid: Option<String>,
    pub customer_uid: Option<String>,
    pub sale_uid: Option<String>,
    pub status: Option<String>,
    /// Solo las que tienen la próxima calibración dentro de estos días (o ya vencida).
    pub due_within_days: Option<i64>,
    pub limit: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SerialBulkReport {
    pub added: usize,
    pub duplicates: Vec<String>,
}

const SELECT: &str = "SELECT x.uid, x.serial, p.uid, p.name, p.sku, x.status, s.uid, s.number, c.uid, c.name, x.sold_at,
        x.certificate_number, x.certificate_date, x.certificate_due, x.certificate_lab, x.certificate_file, x.notes
     FROM product_serials x JOIN products p ON p.id = x.product_id
     LEFT JOIN sales s ON s.id = x.sale_id LEFT JOIN customers c ON c.id = x.customer_id";

fn read(today: i64) -> impl Fn(&rusqlite::Row<'_>) -> rusqlite::Result<Serial> {
    move |r| {
        let due: Option<String> = r.get(13)?;
        Ok(Serial {
            uid: r.get(0)?,
            serial: r.get(1)?,
            product_uid: r.get(2)?,
            product_name: r.get(3)?,
            product_sku: r.get(4)?,
            status: r.get(5)?,
            sale_uid: r.get(6)?,
            sale_number: r.get(7)?,
            customer_uid: r.get(8)?,
            customer_name: r.get(9)?,
            sold_at: r.get(10)?,
            certificate_number: r.get(11)?,
            certificate_date: r.get(12)?,
            due_in_days: due.as_deref().and_then(date_ord).map(|d| d - today),
            certificate_due: due,
            certificate_lab: r.get(14)?,
            certificate_file: r.get(15)?,
            notes: r.get(16)?,
        })
    }
}

fn opt_date(label: &str, v: &Option<String>) -> AppResult<Option<String>> {
    match v.as_deref().map(str::trim).filter(|d| !d.is_empty()) {
        Some(d) => Ok(Some(parse_date(label, d)?)),
        None => Ok(None),
    }
}

impl CompanySession {
    fn serials_where(
        &self,
        filter: &str,
        p: &[&dyn rusqlite::ToSql],
        limit: i64,
    ) -> AppResult<Vec<Serial>> {
        let conn = self.db.conn();
        let today = date_ord(&local_today(conn)?).unwrap_or(0);
        let mut st = conn.prepare(&format!(
            "{SELECT} {filter} ORDER BY x.status = 'baja', x.updated_at DESC, x.id DESC LIMIT {limit}"
        ))?;
        Ok(st.query_map(p, read(today))?.collect::<Result<_, _>>()?)
    }

    pub fn serials(&self, f: &SerialFilter) -> AppResult<Vec<Serial>> {
        self.require("productos.ver")?;
        let conn = self.db.conn();
        let mut conds: Vec<String> = Vec::new();
        let mut vals: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        fn push(
            conds: &mut Vec<String>,
            vals: &mut Vec<Box<dyn rusqlite::ToSql>>,
            cond: &str,
            v: Box<dyn rusqlite::ToSql>,
        ) {
            vals.push(v);
            conds.push(cond.replace('?', &format!("?{}", vals.len())));
        }
        if let Some(q) = f.query.as_deref().map(str::trim).filter(|q| !q.is_empty()) {
            let key = serial_key(q);
            let like = format!("%{}%", q.to_lowercase());
            vals.push(Box::new(format!("%{key}%")));
            let a = vals.len();
            vals.push(Box::new(like));
            let b = vals.len();
            conds.push(format!(
                "((?{a} <> '%%' AND x.serial_key LIKE ?{a}) OR lower(p.name) LIKE ?{b} OR lower(p.sku) LIKE ?{b}
                  OR lower(coalesce(c.name, '')) LIKE ?{b} OR lower(coalesce(x.certificate_number, '')) LIKE ?{b})"
            ));
        }
        if let Some(u) = f.product_uid.as_deref().filter(|u| !u.is_empty()) {
            push(&mut conds, &mut vals, "p.uid = ?", Box::new(u.to_string()));
        }
        if let Some(u) = f.customer_uid.as_deref().filter(|u| !u.is_empty()) {
            push(&mut conds, &mut vals, "c.uid = ?", Box::new(u.to_string()));
        }
        if let Some(u) = f.sale_uid.as_deref().filter(|u| !u.is_empty()) {
            push(&mut conds, &mut vals, "s.uid = ?", Box::new(u.to_string()));
        }
        if let Some(s) = f.status.as_deref().filter(|s| !s.is_empty()) {
            if !STATUSES.contains(&s) {
                return Err(AppError::Validation(
                    "estado: en_stock, vendido o baja".into(),
                ));
            }
            push(
                &mut conds,
                &mut vals,
                "x.status = ?",
                Box::new(s.to_string()),
            );
        }
        if let Some(n) = f.due_within_days {
            let limit = date_str(date_ord(&local_today(conn)?).unwrap_or(0) + n.clamp(0, 3650));
            push(
                &mut conds,
                &mut vals,
                "x.certificate_due IS NOT NULL AND x.certificate_due <= ? AND x.status <> 'baja'",
                Box::new(limit),
            );
        }
        let filter = if conds.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", conds.join(" AND "))
        };
        let refs: Vec<&dyn rusqlite::ToSql> = vals.iter().map(|v| v.as_ref()).collect();
        self.serials_where(&filter, &refs, f.limit.unwrap_or(300).clamp(1, 2000))
    }

    fn serial_one(&self, uid: &str) -> AppResult<Serial> {
        self.serials_where("WHERE x.uid = ?1", &[&uid], 1)?
            .pop()
            .ok_or_else(|| AppError::NotFound("la serie".into()))
    }

    /// Registra (sin `uid`) o corrige una serie y los datos de su certificado.
    pub fn save_serial(&mut self, input: &SerialInput, uid: Option<&str>) -> AppResult<Serial> {
        let user = self.require("productos.editar")?.username.clone();
        let conn = self.db.conn();
        let serial = input.serial.trim();
        let key = serial_key(serial);
        if key.is_empty() || serial.chars().count() > 80 {
            return Err(AppError::Validation(
                "escribe el número de serie (hasta 80 caracteres)".into(),
            ));
        }
        let product = products::by_uid(conn, &input.product_uid)?
            .ok_or_else(|| AppError::Validation("elige el producto de esa serie".into()))?;
        let cert_date = opt_date("la fecha del certificado", &input.certificate_date)?;
        let cert_due = opt_date("la fecha de la próxima calibración", &input.certificate_due)?;
        if let (Some(a), Some(b)) = (&cert_date, &cert_due)
            && b < a
        {
            return Err(AppError::Validation(
                "la próxima calibración es anterior a la fecha del certificado".into(),
            ));
        }
        let number = opt_text(&input.certificate_number, 80, "el número de certificado")?;
        let lab = opt_text(&input.certificate_lab, 120, "el laboratorio")?;
        let file = opt_text(&input.certificate_file, 400, "la ruta del certificado")?;
        let notes = opt_text(&input.notes, 1000, "las notas")?;
        let clash: Option<String> = conn
            .query_row(
                "SELECT uid FROM product_serials WHERE product_id = ?1 AND serial_key = ?2",
                params![product.id, key],
                |r| r.get(0),
            )
            .optional()?;
        if clash.as_deref().is_some_and(|c| Some(c) != uid) {
            return Err(AppError::Validation(format!(
                "la serie {serial} ya está registrada para {}",
                product.name
            )));
        }
        let now = now_utc();
        let out = match uid {
            Some(u) => {
                let cur = self.serial_one(u)?;
                let status = match input.status.as_deref() {
                    None | Some("") => cur.status.clone(),
                    Some(s) if s == cur.status => cur.status.clone(),
                    Some(s @ ("en_stock" | "baja")) if cur.status != "vendido" => s.to_string(),
                    Some(_) => {
                        return Err(AppError::Validation(
                            "una serie vendida cambia de estado al quitarla de la venta".into(),
                        ));
                    }
                };
                conn.execute(
                    "UPDATE product_serials SET product_id = ?2, serial = ?3, serial_key = ?4, status = ?5, certificate_number = ?6,
                        certificate_date = ?7, certificate_due = ?8, certificate_lab = ?9, certificate_file = ?10, notes = ?11,
                        updated_at = ?12 WHERE uid = ?1",
                    params![u, product.id, serial, key, status, number, cert_date, cert_due, lab, file, notes, now],
                )?;
                u.to_string()
            }
            None => {
                let status = match input.status.as_deref() {
                    None | Some("") | Some("en_stock") => "en_stock",
                    Some("baja") => "baja",
                    Some(_) => {
                        return Err(AppError::Validation(
                            "una serie nueva entra en stock; se marca vendida al asignarla a una venta"
                                .into(),
                        ));
                    }
                };
                let new_uid = uuid::Uuid::now_v7().to_string();
                conn.execute(
                    "INSERT INTO product_serials (uid, product_id, serial, serial_key, status, certificate_number, certificate_date,
                        certificate_due, certificate_lab, certificate_file, notes, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)",
                    params![new_uid, product.id, serial, key, status, number, cert_date, cert_due, lab, file, notes, now],
                )?;
                new_uid
            }
        };
        log(
            conn,
            &user,
            if uid.is_some() { "update" } else { "create" },
            "serie",
            &out,
            &format!("Serie {serial} de {}", product.name),
            None,
        )?;
        self.serial_one(&out)
    }

    /// Registra varias series de un producto de una vez (una por línea, al recibir mercadería).
    pub fn add_serials(
        &mut self,
        product_uid: &str,
        serials: &[String],
    ) -> AppResult<SerialBulkReport> {
        let user = self.require("productos.editar")?.username.clone();
        if serials.len() > MAX_BULK {
            return Err(AppError::Validation(format!(
                "hasta {MAX_BULK} series por vez"
            )));
        }
        let product = products::by_uid(self.db.conn(), product_uid)?
            .ok_or_else(|| AppError::Validation("elige el producto".into()))?;
        let now = now_utc();
        let tx = self.db.conn_mut().transaction()?;
        let mut added = 0;
        let mut duplicates = Vec::new();
        for raw in serials {
            let serial = raw.trim();
            let key = serial_key(serial);
            if key.is_empty() {
                continue;
            }
            if serial.chars().count() > 80 {
                return Err(AppError::Validation(format!(
                    "la serie «{}…» es demasiado larga",
                    serial.chars().take(20).collect::<String>()
                )));
            }
            let n = tx.execute(
                "INSERT OR IGNORE INTO product_serials (uid, product_id, serial, serial_key, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
                params![uuid::Uuid::now_v7().to_string(), product.id, serial, key, now],
            )?;
            if n == 1 {
                added += 1;
            } else {
                duplicates.push(serial.to_string());
            }
        }
        if added > 0 {
            log(
                &tx,
                &user,
                "create",
                "serie",
                &product.uid,
                &format!("Registró {added} serie(s) de {}", product.name),
                None,
            )?;
        }
        tx.commit()?;
        Ok(SerialBulkReport { added, duplicates })
    }

    /// Une series a una venta: quedan vendidas a ese cliente con la fecha de la venta. Cada serie debe
    /// ser de un producto que esté en la venta, y no se asignan más series que unidades vendidas.
    pub fn assign_serials(
        &mut self,
        sale_uid: &str,
        serial_uids: &[String],
    ) -> AppResult<Vec<Serial>> {
        let user = self.require("ventas.crear")?.username.clone();
        let conn = self.db.conn();
        let (sale_id, number, customer_id, date, state): (i64, String, Option<i64>, String, String) = conn
            .query_row(
                "SELECT id, number, customer_id, issue_date, commercial_state FROM sales WHERE uid = ?1",
                [sale_uid],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )
            .optional()?
            .ok_or_else(|| AppError::NotFound("la venta".into()))?;
        if state == "anulada" {
            return Err(AppError::Validation("esa venta está anulada".into()));
        }
        let now = now_utc();
        // Todo o nada: si una serie no corresponde, ninguna queda asignada.
        conn.execute_batch("SAVEPOINT asignar_series")?;
        let result = self.assign_each(
            sale_uid,
            sale_id,
            &number,
            customer_id,
            &date,
            &now,
            serial_uids,
        );
        if let Err(e) = result {
            conn.execute_batch("ROLLBACK TO asignar_series; RELEASE asignar_series")?;
            return Err(e);
        }
        conn.execute_batch("RELEASE asignar_series")?;
        if !serial_uids.is_empty() {
            log(
                conn,
                &user,
                "update",
                "serie",
                sale_uid,
                &format!("Asignó {} serie(s) a la venta {number}", serial_uids.len()),
                None,
            )?;
        }
        self.serials(&SerialFilter {
            sale_uid: Some(sale_uid.to_string()),
            ..Default::default()
        })
    }

    #[allow(clippy::too_many_arguments)]
    fn assign_each(
        &self,
        sale_uid: &str,
        sale_id: i64,
        number: &str,
        customer_id: Option<i64>,
        date: &str,
        now: &str,
        serial_uids: &[String],
    ) -> AppResult<()> {
        let conn = self.db.conn();
        for uid in serial_uids {
            let s = self.serial_one(uid)?;
            if s.status == "baja" {
                return Err(AppError::Validation(format!(
                    "la serie {} está dada de baja",
                    s.serial
                )));
            }
            if s.status == "vendido" && s.sale_uid.as_deref() != Some(sale_uid) {
                return Err(AppError::Validation(format!(
                    "la serie {} ya está en la venta {}",
                    s.serial,
                    s.sale_number.unwrap_or_default()
                )));
            }
            let sold_milli: i64 = conn.query_row(
                "SELECT coalesce(sum(i.qty_milli), 0) FROM sale_items i JOIN products p ON p.id = i.product_id
                 WHERE i.sale_id = ?1 AND p.uid = ?2",
                params![sale_id, s.product_uid],
                |r| r.get(0),
            )?;
            if sold_milli <= 0 {
                return Err(AppError::Validation(format!(
                    "la venta {number} no incluye {} (serie {})",
                    s.product_name, s.serial
                )));
            }
            let already: i64 = conn.query_row(
                "SELECT count(*) FROM product_serials x JOIN products p ON p.id = x.product_id
                 WHERE x.sale_id = ?1 AND p.uid = ?2 AND x.uid <> ?3",
                params![sale_id, s.product_uid, uid],
                |r| r.get(0),
            )?;
            if (already + 1) * 1000 > sold_milli {
                return Err(AppError::Validation(format!(
                    "la venta {number} tiene {} unidad(es) de {} y ya tiene {already} serie(s) asignadas",
                    sold_milli / 1000,
                    s.product_name
                )));
            }
            conn.execute(
                "UPDATE product_serials SET status = 'vendido', sale_id = ?2, customer_id = ?3, sold_at = ?4, updated_at = ?5 WHERE uid = ?1",
                params![uid, sale_id, customer_id, date, now],
            )?;
        }
        Ok(())
    }

    /// Quita la serie de su venta: vuelve a estar en stock (por ejemplo, tras una devolución).
    pub fn release_serial(&mut self, uid: &str) -> AppResult<Serial> {
        let user = self.require("ventas.crear")?.username.clone();
        let s = self.serial_one(uid)?;
        if s.status != "vendido" {
            return Err(AppError::Validation(
                "esa serie no está asignada a una venta".into(),
            ));
        }
        self.db.conn().execute(
            "UPDATE product_serials SET status = 'en_stock', sale_id = NULL, customer_id = NULL, sold_at = NULL, updated_at = ?2 WHERE uid = ?1",
            params![uid, now_utc()],
        )?;
        log(
            self.db.conn(),
            &user,
            "update",
            "serie",
            uid,
            &format!(
                "Quitó la serie {} de la venta {}",
                s.serial,
                s.sale_number.unwrap_or_default()
            ),
            None,
        )?;
        self.serial_one(uid)
    }

    /// Elimina una serie mal ingresada (solo si no está vendida).
    pub fn delete_serial(&mut self, uid: &str) -> AppResult<()> {
        let user = self.require("productos.editar")?.username.clone();
        let s = self.serial_one(uid)?;
        if s.status == "vendido" {
            return Err(AppError::Validation(
                "esa serie está en una venta: quítala de la venta primero".into(),
            ));
        }
        self.db
            .conn()
            .execute("DELETE FROM product_serials WHERE uid = ?1", [uid])?;
        log(
            self.db.conn(),
            &user,
            "delete",
            "serie",
            uid,
            &format!("Eliminó la serie {} de {}", s.serial, s.product_name),
            None,
        )?;
        Ok(())
    }

    /// Certificados cuya próxima calibración cae dentro de `days` días (o ya pasó), de equipos vendidos.
    pub(crate) fn serials_due(&self, days: i64) -> AppResult<Vec<Serial>> {
        let conn = self.db.conn();
        let limit = date_str(date_ord(&local_today(conn)?).unwrap_or(0) + days);
        let mut v = self.serials_where(
            "WHERE x.certificate_due IS NOT NULL AND x.certificate_due <= ?1 AND x.status = 'vendido'",
            &[&limit],
            500,
        )?;
        v.sort_by(|a, b| a.certificate_due.cmp(&b.certificate_due));
        Ok(v)
    }

    /// Cliente por uid (para mostrar sus equipos).
    pub fn customer_serials(&self, customer_uid: &str) -> AppResult<Vec<Serial>> {
        self.require("productos.ver")?;
        customers::by_uid(self.db.conn(), customer_uid)?
            .ok_or_else(|| AppError::NotFound("el cliente".into()))?;
        self.serials(&SerialFilter {
            customer_uid: Some(customer_uid.to_string()),
            ..Default::default()
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn la_serie_se_compara_sin_guiones_ni_espacios() {
        assert_eq!(serial_key(" ef-7 24a 0012 "), "EF724A0012");
        assert_eq!(serial_key("—"), "");
    }
}
