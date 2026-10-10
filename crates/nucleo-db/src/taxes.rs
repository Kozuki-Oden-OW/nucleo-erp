//! Impuestos (Fase 10): registro de compras y ventas del período, borradores del F29 y las
//! consultas que derivan documentos tributarios desde ventas, compras, gastos e importaciones.

use crate::DbResult;
use rusqlite::{Connection, OptionalExtension, Row};
use serde::Serialize;

/* ───────────────────────── Registro de compras y ventas ───────────────────────── */

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TaxDocRow {
    pub id: i64,
    pub period: String,
    pub direction: String,
    pub sii_type: u32,
    pub folio: Option<String>,
    pub issue_date: Option<String>,
    pub counterpart_rut: Option<String>,
    pub counterpart_name: Option<String>,
    pub doc_count: i64,
    pub exempt_minor: i64,
    pub net_minor: i64,
    pub tax_minor: i64,
    pub tax_non_rec_minor: i64,
    pub common_use_tax_minor: i64,
    pub total_minor: i64,
    pub purchase_kind: Option<String>,
    pub not_of_business: bool,
    pub origin: String,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct TaxDocWrite<'a> {
    pub period: &'a str,
    pub direction: &'a str,
    pub sii_type: u32,
    pub folio: Option<&'a str>,
    pub issue_date: Option<&'a str>,
    pub counterpart_rut: Option<&'a str>,
    pub counterpart_name: Option<&'a str>,
    pub doc_count: i64,
    pub exempt_minor: i64,
    pub net_minor: i64,
    pub tax_minor: i64,
    pub tax_non_rec_minor: i64,
    pub common_use_tax_minor: i64,
    pub total_minor: i64,
    pub purchase_kind: Option<&'a str>,
    pub not_of_business: bool,
    pub origin: &'a str,
    pub batch_id: Option<i64>,
    pub note: Option<&'a str>,
}

fn doc_row(r: &Row<'_>) -> rusqlite::Result<TaxDocRow> {
    Ok(TaxDocRow {
        id: r.get(0)?,
        period: r.get(1)?,
        direction: r.get(2)?,
        sii_type: r.get(3)?,
        folio: r.get(4)?,
        issue_date: r.get(5)?,
        counterpart_rut: r.get(6)?,
        counterpart_name: r.get(7)?,
        doc_count: r.get(8)?,
        exempt_minor: r.get(9)?,
        net_minor: r.get(10)?,
        tax_minor: r.get(11)?,
        tax_non_rec_minor: r.get(12)?,
        common_use_tax_minor: r.get(13)?,
        total_minor: r.get(14)?,
        purchase_kind: r.get(15)?,
        not_of_business: r.get::<_, i64>(16)? == 1,
        origin: r.get(17)?,
        note: r.get(18)?,
    })
}

pub fn tax_documents(conn: &Connection, period: &str) -> DbResult<Vec<TaxDocRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, period, direction, sii_type, folio, issue_date, counterpart_rut, counterpart_name, doc_count,
            exempt_minor, net_minor, tax_minor, tax_non_rec_minor, common_use_tax_minor, total_minor, purchase_kind,
            not_of_business, origin, note
         FROM tax_documents WHERE period = ?1 ORDER BY direction DESC, issue_date, sii_type, folio, id",
    )?;
    let rows = stmt.query_map([period], doc_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn tax_document(conn: &Connection, id: i64) -> DbResult<Option<TaxDocRow>> {
    Ok(conn
        .query_row(
            "SELECT id, period, direction, sii_type, folio, issue_date, counterpart_rut, counterpart_name, doc_count,
                exempt_minor, net_minor, tax_minor, tax_non_rec_minor, common_use_tax_minor, total_minor, purchase_kind,
                not_of_business, origin, note
             FROM tax_documents WHERE id = ?1",
            [id],
            doc_row,
        )
        .optional()?)
}

pub fn insert_tax_document(conn: &Connection, w: &TaxDocWrite<'_>, now: &str) -> DbResult<i64> {
    conn.execute(
        "INSERT INTO tax_documents (period, direction, sii_type, folio, issue_date, counterpart_rut, counterpart_name,
            doc_count, exempt_minor, net_minor, tax_minor, tax_non_rec_minor, common_use_tax_minor, total_minor,
            purchase_kind, not_of_business, origin, batch_id, note, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)",
        rusqlite::params![
            w.period,
            w.direction,
            w.sii_type,
            w.folio,
            w.issue_date,
            w.counterpart_rut,
            w.counterpart_name,
            w.doc_count,
            w.exempt_minor,
            w.net_minor,
            w.tax_minor,
            w.tax_non_rec_minor,
            w.common_use_tax_minor,
            w.total_minor,
            w.purchase_kind,
            w.not_of_business as i64,
            w.origin,
            w.batch_id,
            w.note,
            now
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn delete_tax_document(conn: &Connection, id: i64) -> DbResult<()> {
    conn.execute("DELETE FROM tax_documents WHERE id = ?1", [id])?;
    Ok(())
}

pub fn set_purchase_kind(conn: &Connection, id: i64, kind: Option<&str>) -> DbResult<()> {
    conn.execute(
        "UPDATE tax_documents SET purchase_kind = ?2 WHERE id = ?1",
        rusqlite::params![id, kind],
    )?;
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BatchRow {
    pub id: i64,
    pub direction: String,
    pub file_name: Option<String>,
    pub row_count: i64,
    pub imported_at: String,
}

pub fn batches(conn: &Connection, period: &str) -> DbResult<Vec<BatchRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, direction, file_name, row_count, imported_at FROM tax_import_batches WHERE period = ?1 ORDER BY id",
    )?;
    let rows = stmt.query_map([period], |r| {
        Ok(BatchRow {
            id: r.get(0)?,
            direction: r.get(1)?,
            file_name: r.get(2)?,
            row_count: r.get(3)?,
            imported_at: r.get(4)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn insert_batch(
    conn: &Connection,
    period: &str,
    direction: &str,
    file_name: Option<&str>,
    row_count: i64,
    by: Option<i64>,
    now: &str,
) -> DbResult<i64> {
    conn.execute(
        "INSERT INTO tax_import_batches (period, direction, file_name, row_count, imported_by, imported_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![period, direction, file_name, row_count, by, now],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Borra las importaciones del registro de un período (y sus filas).
pub fn delete_batches(conn: &Connection, period: &str, direction: &str) -> DbResult<usize> {
    conn.execute(
        "DELETE FROM tax_documents WHERE period = ?1 AND direction = ?2 AND origin = 'rcv'",
        [period, direction],
    )?;
    Ok(conn.execute(
        "DELETE FROM tax_import_batches WHERE period = ?1 AND direction = ?2",
        [period, direction],
    )?)
}

/* ───────────────────────────── Borradores del F29 ───────────────────────────── */

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct F29Row {
    pub period: String,
    pub status: String,
    pub inputs_json: String,
    pub result_json: Option<String>,
    pub declared_77: Option<i64>,
    pub declared_91: Option<i64>,
    pub declared_folio: Option<String>,
    pub declared_at: Option<String>,
}

pub fn f29_row(conn: &Connection, period: &str) -> DbResult<Option<F29Row>> {
    Ok(conn
        .query_row(
            "SELECT period, status, inputs_json, result_json, declared_77, declared_91, declared_folio, declared_at
             FROM f29_periods WHERE period = ?1",
            [period],
            |r| {
                Ok(F29Row {
                    period: r.get(0)?,
                    status: r.get(1)?,
                    inputs_json: r.get(2)?,
                    result_json: r.get(3)?,
                    declared_77: r.get(4)?,
                    declared_91: r.get(5)?,
                    declared_folio: r.get(6)?,
                    declared_at: r.get(7)?,
                })
            },
        )
        .optional()?)
}

pub fn save_f29_inputs(
    conn: &Connection,
    period: &str,
    inputs_json: &str,
    now: &str,
) -> DbResult<()> {
    conn.execute(
        "INSERT INTO f29_periods (period, inputs_json, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(period) DO UPDATE SET inputs_json = excluded.inputs_json, updated_at = excluded.updated_at",
        [period, inputs_json, now],
    )?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub fn mark_f29_declared(
    conn: &Connection,
    period: &str,
    result_json: &str,
    declared_77: i64,
    declared_91: i64,
    folio: Option<&str>,
    by: Option<i64>,
    now: &str,
) -> DbResult<()> {
    conn.execute(
        "INSERT INTO f29_periods (period, updated_at) VALUES (?1, ?2) ON CONFLICT(period) DO NOTHING",
        [period, now],
    )?;
    conn.execute(
        "UPDATE f29_periods SET status = 'declarado', result_json = ?2, declared_77 = ?3, declared_91 = ?4,
            declared_folio = ?5, declared_at = ?6, declared_by = ?7, updated_at = ?6
         WHERE period = ?1",
        rusqlite::params![period, result_json, declared_77, declared_91, folio, now, by],
    )?;
    Ok(())
}

pub fn reopen_f29(conn: &Connection, period: &str, now: &str) -> DbResult<()> {
    conn.execute(
        "UPDATE f29_periods SET status = 'borrador', declared_at = NULL, updated_at = ?2 WHERE period = ?1",
        [period, now],
    )?;
    Ok(())
}

/// Último F29 marcado como declarado antes de un período (para el remanente).
pub fn previous_declared(conn: &Connection, period: &str) -> DbResult<Option<F29Row>> {
    let p: Option<String> = conn
        .query_row(
            "SELECT period FROM f29_periods WHERE period < ?1 AND status = 'declarado' ORDER BY period DESC LIMIT 1",
            [period],
            |r| r.get(0),
        )
        .optional()?;
    match p {
        Some(p) => f29_row(conn, &p),
        None => Ok(None),
    }
}

pub fn f29_statuses(conn: &Connection) -> DbResult<Vec<(String, String, Option<i64>)>> {
    let mut stmt =
        conn.prepare("SELECT period, status, declared_91 FROM f29_periods ORDER BY period DESC")?;
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/* ──────────────── Documentos tributarios derivados de NÚCLEO ──────────────── */

/// Venta efectuada (o anulada después de documentarse) en el rango de fechas.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SaleTaxRow {
    pub uid: String,
    pub number: String,
    pub doc_type: String,
    pub commercial_state: String,
    pub documentation_state: String,
    pub doc_kind: Option<String>,
    pub external_number: Option<String>,
    pub date: String,
    pub customer_rut: Option<String>,
    pub customer_name: Option<String>,
    pub currency_code: String,
    pub rate_e6: Option<i64>,
    pub net_minor: i64,
    pub exempt_minor: i64,
    pub tax_minor: i64,
    pub total_minor: i64,
}

/// Ventas cuya fecha tributaria (la del documento externo o, si no hay, la de la venta) cae en el rango.
pub fn sales_for_tax(conn: &Connection, from: &str, to: &str) -> DbResult<Vec<SaleTaxRow>> {
    let mut stmt = conn.prepare(
        "SELECT s.uid, s.number, s.doc_type, s.commercial_state, s.documentation_state, x.doc_kind, x.external_number,
            coalesce(x.issue_date, s.issue_date), c.rut, c.name, s.currency_code, s.rate_e6, s.net_minor, s.exempt_minor,
            s.tax_minor, s.total_minor
         FROM sales s LEFT JOIN external_doc_refs x ON x.sale_id = s.id LEFT JOIN customers c ON c.id = s.customer_id
         WHERE s.commercial_state IN ('efectuada', 'cerrada', 'anulada')
           AND coalesce(x.issue_date, s.issue_date) BETWEEN ?1 AND ?2
         ORDER BY 8, s.number",
    )?;
    let rows = stmt.query_map([from, to], |r| {
        Ok(SaleTaxRow {
            uid: r.get(0)?,
            number: r.get(1)?,
            doc_type: r.get(2)?,
            commercial_state: r.get(3)?,
            documentation_state: r.get(4)?,
            doc_kind: r.get(5)?,
            external_number: r.get(6)?,
            date: r.get(7)?,
            customer_rut: r.get(8)?,
            customer_name: r.get(9)?,
            currency_code: r.get(10)?,
            rate_e6: r.get(11)?,
            net_minor: r.get(12)?,
            exempt_minor: r.get(13)?,
            tax_minor: r.get(14)?,
            total_minor: r.get(15)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PurchaseTaxRow {
    pub number: String,
    pub doc_kind: Option<String>,
    pub doc_number: Option<String>,
    pub date: String,
    pub supplier_rut: Option<String>,
    pub supplier_name: String,
    pub currency_code: String,
    pub rate_e6: Option<i64>,
    pub net_minor: i64,
    pub exempt_minor: i64,
    pub tax_minor: i64,
    pub total_minor: i64,
}

pub fn purchases_for_tax(conn: &Connection, from: &str, to: &str) -> DbResult<Vec<PurchaseTaxRow>> {
    let mut stmt = conn.prepare(
        "SELECT p.number, p.supplier_doc_kind, p.supplier_doc_number, p.issue_date, s.rut, s.name, p.currency_code,
            p.rate_e6, p.net_minor, p.exempt_minor, p.tax_minor, p.total_minor
         FROM purchases p JOIN suppliers s ON s.id = p.supplier_id
         WHERE p.status = 'registrada' AND p.issue_date BETWEEN ?1 AND ?2 ORDER BY p.issue_date, p.number",
    )?;
    let rows = stmt.query_map([from, to], |r| {
        Ok(PurchaseTaxRow {
            number: r.get(0)?,
            doc_kind: r.get(1)?,
            doc_number: r.get(2)?,
            date: r.get(3)?,
            supplier_rut: r.get(4)?,
            supplier_name: r.get(5)?,
            currency_code: r.get(6)?,
            rate_e6: r.get(7)?,
            net_minor: r.get(8)?,
            exempt_minor: r.get(9)?,
            tax_minor: r.get(10)?,
            total_minor: r.get(11)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExpenseTaxRow {
    pub number: String,
    pub date: String,
    pub description: String,
    pub supplier_rut: Option<String>,
    pub supplier_name: Option<String>,
    pub net_minor: i64,
    pub tax_minor: i64,
    pub total_minor: i64,
}

/// Gastos con IVA del rango (los que no tienen IVA no van al F29).
pub fn expenses_for_tax(conn: &Connection, from: &str, to: &str) -> DbResult<Vec<ExpenseTaxRow>> {
    let mut stmt = conn.prepare(
        "SELECT e.number, e.expense_date, e.description, s.rut, s.name, e.net_minor, e.tax_minor, e.total_minor
         FROM expenses e LEFT JOIN suppliers s ON s.id = e.supplier_id
         WHERE e.status = 'registrado' AND e.tax_minor > 0 AND e.currency_code = 'CLP'
           AND e.expense_date BETWEEN ?1 AND ?2 ORDER BY e.expense_date, e.number",
    )?;
    let rows = stmt.query_map([from, to], |r| {
        Ok(ExpenseTaxRow {
            number: r.get(0)?,
            date: r.get(1)?,
            description: r.get(2)?,
            supplier_rut: r.get(3)?,
            supplier_name: r.get(4)?,
            net_minor: r.get(5)?,
            tax_minor: r.get(6)?,
            total_minor: r.get(7)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// IVA de importación (real o estimado) de carpetas vigentes, con fecha en el rango.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportVatRow {
    pub import_number: String,
    pub document_ref: Option<String>,
    pub date: String,
    pub currency_code: String,
    pub amount_minor: i64,
    pub rate_e6: Option<i64>,
    pub is_estimate: bool,
    pub recoverable: bool,
}

pub fn import_vat_for_tax(conn: &Connection, from: &str, to: &str) -> DbResult<Vec<ImportVatRow>> {
    let mut stmt = conn.prepare(
        "SELECT i.number, c.document_ref, c.cost_date, c.currency_code, c.amount_minor, coalesce(c.rate_e6, i.rate_e6),
            c.is_estimate, c.recoverable_tax
         FROM import_costs c JOIN imports i ON i.id = c.import_id
         WHERE c.kind = 'iva_importacion' AND c.status = 'vigente' AND i.is_scenario = 0 AND i.stage <> 'anulada'
           AND c.cost_date BETWEEN ?1 AND ?2 ORDER BY c.cost_date, i.number",
    )?;
    let rows = stmt.query_map([from, to], |r| {
        Ok(ImportVatRow {
            import_number: r.get(0)?,
            document_ref: r.get(1)?,
            date: r.get(2)?,
            currency_code: r.get(3)?,
            amount_minor: r.get(4)?,
            rate_e6: r.get(5)?,
            is_estimate: r.get::<_, i64>(6)? == 1,
            recoverable: r.get::<_, i64>(7)? == 1,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}
