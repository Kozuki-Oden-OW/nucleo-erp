//! Catálogo de productos: categorías (crear, renombrar, eliminar, asignar en lote) y hoja de
//! costo avanzado (compra en otra moneda, transporte, envío, mano de obra y otros).

use crate::company::CompanySession;
use crate::{AppError, AppResult};
use nucleo_db::audit::{self, AuditEntry};
use nucleo_db::categories::{self, CategoryRow};
use nucleo_db::{now_utc, products};
use nucleo_domain::costing::{CostSheet, CostSheetResult, compute_cost_sheet};
use rusqlite::OptionalExtension;

const MAX_AMOUNT: i64 = 10_000_000_000_000;

impl CompanySession {
    /// Id de una categoría activa a partir de su uid (vacío = sin categoría).
    pub(crate) fn category_id(&self, uid: Option<&str>) -> AppResult<Option<i64>> {
        match uid.map(str::trim).filter(|u| !u.is_empty()) {
            None => Ok(None),
            Some(u) => Ok(Some(
                categories::id_by_uid(self.db.conn(), u)?
                    .ok_or_else(|| AppError::NotFound("la categoría".into()))?,
            )),
        }
    }

    /// Valida la hoja de costo y calcula el costo unitario con la tasa del negocio. Devuelve
    /// `None` si la hoja viene vacía. Los decimales de la moneda salen de la configuración.
    pub(crate) fn prepare_cost_sheet(
        &self,
        sheet: Option<&CostSheet>,
    ) -> AppResult<Option<(i64, String)>> {
        let Some(s) = sheet else { return Ok(None) };
        let used = [
            s.purchase_minor,
            s.freight_minor,
            s.shipping_minor,
            s.labor_minor,
            s.other_minor,
        ];
        if used.iter().any(|v| !(0..=MAX_AMOUNT).contains(v))
            || !(0..=MAX_AMOUNT).contains(&s.fx_rate_e6)
            || !(0..=1_000_000_000_000).contains(&s.units_milli)
        {
            return Err(AppError::Validation(
                "revisa los montos del costo avanzado".into(),
            ));
        }
        if used.iter().all(|v| *v == 0) {
            return Ok(None);
        }
        let mut s = s.clone();
        s.currency = s.currency.trim().to_uppercase();
        if s.currency.is_empty() {
            s.currency = "CLP".into();
        }
        let digits: Option<i64> = self
            .db
            .conn()
            .query_row(
                "SELECT decimals FROM currencies WHERE code = ?1",
                [&s.currency],
                |r| r.get(0),
            )
            .optional()?;
        s.currency_digits = match (digits, s.currency.as_str()) {
            (Some(d), _) => d as u32,
            (None, "CLP") => 0,
            (None, c) => {
                return Err(AppError::Validation(format!(
                    "la moneda {c} no está configurada (Configuración → Monedas)"
                )));
            }
        };
        let r = self.cost_sheet_result(&s)?;
        if r.total == 0 {
            return Err(AppError::Validation(
                r.notes
                    .first()
                    .cloned()
                    .unwrap_or_else(|| "el costo avanzado quedó en cero".into()),
            ));
        }
        let json = serde_json::to_string(&s).map_err(|e| AppError::Validation(e.to_string()))?;
        Ok(Some((r.unit_cost_e4, json)))
    }

    /// Resultado de una hoja de costo con la tasa de IVA vigente del negocio.
    pub fn cost_sheet_result(&self, s: &CostSheet) -> AppResult<CostSheetResult> {
        Ok(compute_cost_sheet(s, self.tax_ppm()?))
    }

    /* ───────────── Categorías ───────────── */

    pub fn product_categories(&self) -> AppResult<Vec<CategoryRow>> {
        self.require("productos.ver")?;
        Ok(categories::list(self.db.conn())?)
    }

    fn category_name(name: &str) -> AppResult<String> {
        let n = name.trim();
        if n.is_empty() || n.chars().count() > 80 {
            return Err(AppError::Validation(
                "el nombre de la categoría es obligatorio (hasta 80 caracteres)".into(),
            ));
        }
        Ok(n.to_string())
    }

    /// Crea (sin `uid`) o renombra una categoría.
    pub fn save_category(&mut self, uid: Option<&str>, name: &str) -> AppResult<Vec<CategoryRow>> {
        self.require("productos.editar")?;
        let name = Self::category_name(name)?;
        let user = self.actor_name()?;
        let now = now_utc();
        let tx = self.db.conn_mut().transaction()?;
        let (action, cat_uid) = match uid.filter(|u| !u.is_empty()) {
            Some(u) => {
                let id = categories::id_by_uid(&tx, u)?
                    .ok_or_else(|| AppError::NotFound("la categoría".into()))?;
                categories::rename(&tx, id, &name)?;
                ("categoria.renombrar", u.to_string())
            }
            None => {
                let u = uuid::Uuid::now_v7().to_string();
                categories::insert(&tx, &u, &name, &now)?;
                ("categoria.crear", u)
            }
        };
        audit::append(
            &tx,
            &AuditEntry {
                user_name: &user,
                action,
                entity: "categoria",
                entity_id: Some(&cat_uid),
                after_json: serde_json::to_string(&serde_json::json!({ "nombre": name })).ok(),
                ..Default::default()
            },
        )?;
        tx.commit()?;
        Ok(categories::list(self.db.conn())?)
    }

    /// Elimina la categoría; sus productos quedan sin categoría.
    pub fn delete_category(&mut self, uid: &str) -> AppResult<Vec<CategoryRow>> {
        self.require("productos.editar")?;
        let user = self.actor_name()?;
        let now = now_utc();
        let tx = self.db.conn_mut().transaction()?;
        let id = categories::id_by_uid(&tx, uid)?
            .ok_or_else(|| AppError::NotFound("la categoría".into()))?;
        let moved = categories::archive(&tx, id, &now)?;
        audit::append(
            &tx,
            &AuditEntry {
                user_name: &user,
                action: "categoria.eliminar",
                entity: "categoria",
                entity_id: Some(uid),
                after_json: serde_json::to_string(
                    &serde_json::json!({ "productos_sin_categoria": moved }),
                )
                .ok(),
                ..Default::default()
            },
        )?;
        tx.commit()?;
        Ok(categories::list(self.db.conn())?)
    }

    /// Pone (o quita, con `None`) la categoría de varios productos.
    pub fn assign_category(
        &mut self,
        product_uids: &[String],
        category_uid: Option<&str>,
    ) -> AppResult<Vec<CategoryRow>> {
        self.require("productos.editar")?;
        if product_uids.len() > 10_000 {
            return Err(AppError::Validation(
                "elige hasta 10.000 productos a la vez".into(),
            ));
        }
        let category_id = self.category_id(category_uid)?;
        let mut ids = Vec::with_capacity(product_uids.len());
        for u in product_uids {
            let p = products::by_uid(self.db.conn(), u)?
                .ok_or_else(|| AppError::NotFound("el producto".into()))?;
            ids.push(p.id);
        }
        let user = self.actor_name()?;
        let now = now_utc();
        let tx = self.db.conn_mut().transaction()?;
        let n = categories::assign(&tx, &ids, category_id, &now)?;
        audit::append(
            &tx,
            &AuditEntry {
                user_name: &user,
                action: "categoria.asignar",
                entity: "categoria",
                entity_id: category_uid,
                after_json: serde_json::to_string(
                    &serde_json::json!({ "productos": product_uids, "cambiados": n }),
                )
                .ok(),
                ..Default::default()
            },
        )?;
        tx.commit()?;
        Ok(categories::list(self.db.conn())?)
    }
}
