//! Renta anual (Fase 10, hito C): datos guardados del borrador del F22 y las consultas de caja del año
//! (lo cobrado de ventas y lo pagado de compras, gastos e importaciones).

use crate::DbResult;
use rusqlite::{Connection, OptionalExtension, params};

pub fn inputs(conn: &Connection, year: i32) -> DbResult<Option<(String, String)>> {
    Ok(conn
        .query_row(
            "SELECT inputs_json, status FROM f22_years WHERE year = ?1",
            [year],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?)
}

pub fn save_inputs(conn: &Connection, year: i32, json: &str, now: &str) -> DbResult<()> {
    conn.execute(
        "INSERT INTO f22_years (year, inputs_json, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(year) DO UPDATE SET inputs_json = excluded.inputs_json, updated_at = excluded.updated_at",
        params![year, json, now],
    )?;
    Ok(())
}

/// Cobros del período aplicados a ventas, agrupados por venta.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Collected {
    pub doc_date: String,
    pub number: String,
    pub net_minor: i64,
    pub exempt_minor: i64,
    pub total_minor: i64,
    pub currency_code: String,
    pub rate_e6: Option<i64>,
    pub collected_minor: i64,
}

pub fn sales_collected(conn: &Connection, from: &str, to: &str) -> DbResult<Vec<Collected>> {
    let mut st = conn.prepare(
        "SELECT coalesce(x.issue_date, s.issue_date), s.number, s.net_minor, s.exempt_minor, s.total_minor,
            s.currency_code, s.rate_e6, SUM(a.amount_minor)
         FROM payment_allocations a
         JOIN payments p ON p.id = a.payment_id AND p.status = 'vigente'
         JOIN receivables r ON r.id = a.receivable_id
         JOIN sales s ON s.id = r.sale_id
         LEFT JOIN external_doc_refs x ON x.sale_id = s.id
         WHERE p.payment_date BETWEEN ?1 AND ?2
         GROUP BY s.id ORDER BY 1",
    )?;
    let rows = st.query_map([from, to], |r| {
        Ok(Collected {
            doc_date: r.get(0)?,
            number: r.get(1)?,
            net_minor: r.get(2)?,
            exempt_minor: r.get(3)?,
            total_minor: r.get(4)?,
            currency_code: r.get(5)?,
            rate_e6: r.get(6)?,
            collected_minor: r.get(7)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Pagos del período aplicados a compras, gastos o costos de importación.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Paid {
    /// "COM", "GAS" o "IMP".
    pub source: String,
    pub doc_date: String,
    pub number: String,
    pub net_minor: i64,
    pub tax_minor: i64,
    pub total_minor: i64,
    pub currency_code: String,
    pub rate_e6: Option<i64>,
    /// Categoría del gasto o tipo de costo de importación.
    pub category: Option<String>,
    /// Costo de importación que es IVA recuperable (no es gasto).
    pub recoverable: bool,
    pub paid_minor: i64,
}

pub fn payables_paid(conn: &Connection, from: &str, to: &str) -> DbResult<Vec<Paid>> {
    let mut st = conn.prepare(
        "SELECT b.source_type,
            CASE b.source_type WHEN 'COM' THEN c.issue_date WHEN 'GAS' THEN e.expense_date ELSE substr(k.created_at, 1, 10) END,
            CASE b.source_type WHEN 'COM' THEN c.number WHEN 'GAS' THEN e.number ELSE i.number END,
            CASE b.source_type WHEN 'COM' THEN c.net_minor + c.exempt_minor WHEN 'GAS' THEN e.net_minor ELSE k.amount_minor END,
            CASE b.source_type WHEN 'COM' THEN c.tax_minor WHEN 'GAS' THEN e.tax_minor ELSE 0 END,
            CASE b.source_type WHEN 'COM' THEN c.total_minor WHEN 'GAS' THEN e.total_minor ELSE k.amount_minor END,
            CASE b.source_type WHEN 'COM' THEN c.currency_code WHEN 'GAS' THEN e.currency_code ELSE k.currency_code END,
            CASE b.source_type WHEN 'COM' THEN c.rate_e6 WHEN 'GAS' THEN NULL ELSE k.rate_e6 END,
            CASE b.source_type WHEN 'GAS' THEN g.name WHEN 'IMP' THEN k.kind END,
            coalesce(k.recoverable_tax, 0),
            SUM(a.amount_minor)
         FROM payment_allocations a
         JOIN payments p ON p.id = a.payment_id AND p.status = 'vigente'
         JOIN payables b ON b.id = a.payable_id
         LEFT JOIN purchases c ON b.source_type = 'COM' AND c.id = b.source_id
         LEFT JOIN expenses e ON b.source_type = 'GAS' AND e.id = b.source_id
         LEFT JOIN expense_categories g ON g.id = e.category_id
         LEFT JOIN import_costs k ON b.source_type = 'IMP' AND k.id = b.source_id
         LEFT JOIN imports i ON i.id = k.import_id
         WHERE p.payment_date BETWEEN ?1 AND ?2
         GROUP BY b.source_type, b.source_id ORDER BY 2",
    )?;
    let rows = st.query_map([from, to], |r| {
        Ok(Paid {
            source: r.get(0)?,
            doc_date: r.get::<_, Option<String>>(1)?.unwrap_or_default(),
            number: r.get::<_, Option<String>>(2)?.unwrap_or_default(),
            net_minor: r.get::<_, Option<i64>>(3)?.unwrap_or(0),
            tax_minor: r.get::<_, Option<i64>>(4)?.unwrap_or(0),
            total_minor: r.get::<_, Option<i64>>(5)?.unwrap_or(0),
            currency_code: r
                .get::<_, Option<String>>(6)?
                .unwrap_or_else(|| "CLP".into()),
            rate_e6: r.get(7)?,
            category: r.get(8)?,
            recoverable: r.get::<_, i64>(9)? == 1,
            paid_minor: r.get(10)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// PPM (código 62) de los F29 marcados como declarados en el año.
pub fn declared_ppm(conn: &Connection, year: i32) -> DbResult<Vec<(String, i64)>> {
    let mut st = conn.prepare(
        "SELECT period, coalesce(json_extract(result_json, '$.codes.\"62\"'), 0) FROM f29_periods
         WHERE status = 'declarado' AND substr(period, 1, 4) = ?1 ORDER BY period",
    )?;
    let rows = st.query_map([year.to_string()], |r| Ok((r.get(0)?, r.get(1)?)))?;
    Ok(rows.collect::<Result<_, _>>()?)
}
