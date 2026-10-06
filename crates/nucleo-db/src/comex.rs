//! NÚCLEO COMEX (Fase 9): carpetas de importación con productos, costos, etapas, historial de ETA,
//! recepción a bodega y contenido de Incoterms.

use crate::DbResult;
use rusqlite::{Connection, OptionalExtension, Row};
use serde::Serialize;

/* ───────────────────────────── Incoterms ───────────────────────────── */

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct IncotermRow {
    pub code: String,
    pub version: String,
    pub name: String,
    pub content: serde_json::Value,
    pub source: String,
}

pub fn incoterms(conn: &Connection) -> DbResult<Vec<IncotermRow>> {
    let mut stmt = conn.prepare(
        "SELECT code, version, name, content_json, source FROM incoterm_definitions
         ORDER BY version DESC, CASE code WHEN 'EXW' THEN 1 WHEN 'FCA' THEN 2 WHEN 'FAS' THEN 3 WHEN 'FOB' THEN 4
            WHEN 'CFR' THEN 5 WHEN 'CIF' THEN 6 WHEN 'CPT' THEN 7 WHEN 'CIP' THEN 8 WHEN 'DAP' THEN 9 WHEN 'DPU' THEN 10
            WHEN 'DDP' THEN 11 ELSE 99 END",
    )?;
    let rows = stmt.query_map([], |r| {
        let json: String = r.get(3)?;
        Ok(IncotermRow {
            code: r.get(0)?,
            version: r.get(1)?,
            name: r.get(2)?,
            content: serde_json::from_str(&json).unwrap_or(serde_json::Value::Null),
            source: r.get(4)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn incoterm_exists(conn: &Connection, code: &str) -> DbResult<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT version FROM incoterm_definitions WHERE code = ?1 ORDER BY version DESC LIMIT 1",
            [code],
            |r| r.get(0),
        )
        .optional()?)
}

pub fn currency_decimals(conn: &Connection, code: &str) -> DbResult<Option<u32>> {
    Ok(conn
        .query_row(
            "SELECT decimals FROM currencies WHERE code = ?1",
            [code],
            |r| r.get(0),
        )
        .optional()?)
}

/* ───────────────────────────── Carpetas de importación ───────────────────────────── */

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ImportRow {
    #[serde(skip)]
    pub id: i64,
    pub uid: String,
    pub number: String,
    #[serde(skip)]
    pub supplier_id: Option<i64>,
    pub supplier_uid: Option<String>,
    pub supplier_name: Option<String>,
    pub incoterm: Option<String>,
    pub incoterm_version: Option<String>,
    pub transport_mode: Option<String>,
    pub origin_country: Option<String>,
    pub origin_port: Option<String>,
    pub destination_port: Option<String>,
    pub currency_code: String,
    pub currency_decimals: u32,
    pub rate_e6: Option<i64>,
    pub stage: String,
    pub purchase_date: Option<String>,
    pub production_eta: Option<String>,
    pub shipment_date: Option<String>,
    pub eta: Option<String>,
    pub arrival_date: Option<String>,
    pub reception_date: Option<String>,
    pub allocation_basis: String,
    pub vat_ppm: Option<i64>,
    pub vat_recoverable: bool,
    pub fob_minor: Option<i64>,
    pub landed_total_clp: Option<i64>,
    pub estimated_landed_clp: Option<i64>,
    pub estimated_at: Option<String>,
    pub notes: Option<String>,
    pub void_reason: Option<String>,
    pub created_at: String,
}

const IMPORT_COLS: &str = "i.id, i.uid, i.number, i.supplier_id, s.uid, s.name, i.incoterm, i.incoterm_version, i.transport_mode,
    i.origin_country, i.origin_port, i.destination_port, i.currency_code, coalesce(c.decimals, 2), i.rate_e6, i.stage,
    i.purchase_date, i.production_eta, i.shipment_date, i.eta, i.arrival_date, i.reception_date, i.allocation_basis,
    i.vat_ppm, i.vat_recoverable, i.fob_minor, i.landed_total_clp, i.estimated_landed_clp, i.estimated_at, i.notes,
    i.void_reason, i.created_at
    FROM imports i LEFT JOIN suppliers s ON s.id = i.supplier_id LEFT JOIN currencies c ON c.code = i.currency_code";

fn import_row(r: &Row<'_>) -> rusqlite::Result<ImportRow> {
    Ok(ImportRow {
        id: r.get(0)?,
        uid: r.get(1)?,
        number: r.get(2)?,
        supplier_id: r.get(3)?,
        supplier_uid: r.get(4)?,
        supplier_name: r.get(5)?,
        incoterm: r.get(6)?,
        incoterm_version: r.get(7)?,
        transport_mode: r.get(8)?,
        origin_country: r.get(9)?,
        origin_port: r.get(10)?,
        destination_port: r.get(11)?,
        currency_code: r.get(12)?,
        currency_decimals: r.get(13)?,
        rate_e6: r.get(14)?,
        stage: r.get(15)?,
        purchase_date: r.get(16)?,
        production_eta: r.get(17)?,
        shipment_date: r.get(18)?,
        eta: r.get(19)?,
        arrival_date: r.get(20)?,
        reception_date: r.get(21)?,
        allocation_basis: r.get(22)?,
        vat_ppm: r.get(23)?,
        vat_recoverable: r.get::<_, i64>(24)? == 1,
        fob_minor: r.get(25)?,
        landed_total_clp: r.get(26)?,
        estimated_landed_clp: r.get(27)?,
        estimated_at: r.get(28)?,
        notes: r.get(29)?,
        void_reason: r.get(30)?,
        created_at: r.get(31)?,
    })
}

pub fn import_by_uid(conn: &Connection, uid: &str) -> DbResult<Option<ImportRow>> {
    Ok(conn
        .query_row(
            &format!("SELECT {IMPORT_COLS} WHERE i.uid = ?1 AND i.is_scenario = 0"),
            [uid],
            import_row,
        )
        .optional()?)
}

pub fn import_by_id(conn: &Connection, id: i64) -> DbResult<Option<ImportRow>> {
    Ok(conn
        .query_row(
            &format!("SELECT {IMPORT_COLS} WHERE i.id = ?1"),
            [id],
            import_row,
        )
        .optional()?)
}

/// Datos de cabecera editables de una carpeta.
pub struct ImportWrite<'a> {
    pub supplier_id: Option<i64>,
    pub incoterm: Option<&'a str>,
    pub incoterm_version: Option<&'a str>,
    pub transport_mode: Option<&'a str>,
    pub origin_country: Option<&'a str>,
    pub origin_port: Option<&'a str>,
    pub destination_port: Option<&'a str>,
    pub currency_code: &'a str,
    pub rate_e6: Option<i64>,
    pub purchase_date: Option<&'a str>,
    pub production_eta: Option<&'a str>,
    pub shipment_date: Option<&'a str>,
    pub arrival_date: Option<&'a str>,
    pub allocation_basis: &'a str,
    pub vat_ppm: Option<i64>,
    pub vat_recoverable: bool,
    pub notes: Option<&'a str>,
}

pub fn insert_import(
    conn: &Connection,
    uid: &str,
    number: &str,
    w: &ImportWrite<'_>,
    eta: Option<&str>,
    by: Option<i64>,
    now: &str,
) -> DbResult<i64> {
    conn.execute(
        "INSERT INTO imports (uid, number, supplier_id, incoterm, incoterm_version, transport_mode, origin_country, origin_port,
            destination_port, currency_code, rate_e6, purchase_date, production_eta, shipment_date, eta, arrival_date,
            allocation_basis, vat_ppm, vat_recoverable, notes, created_by, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)",
        rusqlite::params![
            uid,
            number,
            w.supplier_id,
            w.incoterm,
            w.incoterm_version,
            w.transport_mode,
            w.origin_country,
            w.origin_port,
            w.destination_port,
            w.currency_code,
            w.rate_e6,
            w.purchase_date,
            w.production_eta,
            w.shipment_date,
            eta,
            w.arrival_date,
            w.allocation_basis,
            w.vat_ppm,
            w.vat_recoverable as i64,
            w.notes,
            by,
            now
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Actualiza la cabecera (la ETA se cambia aparte para registrar su historial).
pub fn update_import(conn: &Connection, id: i64, w: &ImportWrite<'_>, now: &str) -> DbResult<()> {
    conn.execute(
        "UPDATE imports SET supplier_id = ?2, incoterm = ?3, incoterm_version = ?4, transport_mode = ?5, origin_country = ?6,
            origin_port = ?7, destination_port = ?8, currency_code = ?9, rate_e6 = ?10, purchase_date = ?11,
            production_eta = ?12, shipment_date = ?13, arrival_date = ?14, allocation_basis = ?15, vat_ppm = ?16,
            vat_recoverable = ?17, notes = ?18, updated_at = ?19
         WHERE id = ?1",
        rusqlite::params![
            id,
            w.supplier_id,
            w.incoterm,
            w.incoterm_version,
            w.transport_mode,
            w.origin_country,
            w.origin_port,
            w.destination_port,
            w.currency_code,
            w.rate_e6,
            w.purchase_date,
            w.production_eta,
            w.shipment_date,
            w.arrival_date,
            w.allocation_basis,
            w.vat_ppm,
            w.vat_recoverable as i64,
            w.notes,
            now
        ],
    )?;
    Ok(())
}

/// Cambia la etapa (el trigger registra el historial) y anota quién y por qué.
pub fn set_stage(
    conn: &Connection,
    id: i64,
    stage: &str,
    by: Option<i64>,
    note: Option<&str>,
) -> DbResult<()> {
    conn.execute("UPDATE imports SET stage = ?2 WHERE id = ?1", (id, stage))?;
    conn.execute(
        "UPDATE import_stage_history SET changed_by = ?2, note = ?3
         WHERE id = (SELECT max(id) FROM import_stage_history WHERE import_id = ?1) AND changed_by IS NULL",
        rusqlite::params![id, by, note],
    )?;
    Ok(())
}

/// Cambia la ETA (el trigger registra el cambio) con su motivo.
pub fn set_eta(
    conn: &Connection,
    id: i64,
    eta: &str,
    reason: Option<&str>,
    by: Option<i64>,
) -> DbResult<bool> {
    let n = conn.execute(
        "UPDATE imports SET eta = ?2 WHERE id = ?1 AND eta IS NOT ?2",
        (id, eta),
    )?;
    if n > 0 {
        conn.execute(
            "UPDATE eta_changes SET reason = ?2, changed_by = ?3
             WHERE id = (SELECT max(id) FROM eta_changes WHERE import_id = ?1)",
            rusqlite::params![id, reason, by],
        )?;
    }
    Ok(n > 0)
}

pub fn set_dates(conn: &Connection, id: i64, column: &str, date: &str) -> DbResult<()> {
    // Solo columnas conocidas: el nombre no viene del usuario.
    let col = match column {
        "purchase_date" | "shipment_date" | "arrival_date" | "reception_date" => column,
        _ => return Ok(()),
    };
    conn.execute(
        &format!("UPDATE imports SET {col} = coalesce({col}, ?2) WHERE id = ?1"),
        (id, date),
    )?;
    Ok(())
}

pub fn set_estimate(
    conn: &Connection,
    id: i64,
    landed: i64,
    units: &[(i64, i64)],
    now: &str,
) -> DbResult<()> {
    conn.execute(
        "UPDATE imports SET estimated_landed_clp = ?2, estimated_at = ?3 WHERE id = ?1",
        rusqlite::params![id, landed, now],
    )?;
    for (item, unit) in units {
        conn.execute(
            "UPDATE import_items SET estimated_unit_cost_e4 = ?2 WHERE id = ?1",
            (item, unit),
        )?;
    }
    Ok(())
}

pub fn set_landed(
    conn: &Connection,
    id: i64,
    fob_minor: i64,
    landed: i64,
    units: &[(i64, i64)],
) -> DbResult<()> {
    conn.execute(
        "UPDATE imports SET fob_minor = ?2, landed_total_clp = ?3 WHERE id = ?1",
        rusqlite::params![id, fob_minor, landed],
    )?;
    for (item, unit) in units {
        conn.execute(
            "UPDATE import_items SET landed_unit_cost_e4 = ?2 WHERE id = ?1",
            (item, unit),
        )?;
    }
    Ok(())
}

pub fn void_import(conn: &Connection, id: i64, reason: &str, by: Option<i64>) -> DbResult<()> {
    conn.execute(
        "UPDATE imports SET void_reason = ?2 WHERE id = ?1",
        (id, reason),
    )?;
    set_stage(conn, id, "anulada", by, Some(reason))
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ImportSummary {
    pub uid: String,
    pub number: String,
    pub supplier_name: Option<String>,
    pub stage: String,
    pub incoterm: Option<String>,
    pub transport_mode: Option<String>,
    pub currency_code: String,
    pub fob_minor: Option<i64>,
    pub eta: Option<String>,
    pub eta_changes: i64,
    pub eta_shift_days: i64,
    pub landed_total_clp: Option<i64>,
    pub estimated_landed_clp: Option<i64>,
    pub items: i64,
    pub created_at: String,
}

/// Lista de carpetas. `view`: "en_curso", "cotizaciones", "cerradas", "anuladas" o "todas".
pub fn list_imports(
    conn: &Connection,
    view: &str,
    query: &str,
    limit: u32,
) -> DbResult<Vec<ImportSummary>> {
    let stages = match view {
        "en_curso" => "i.stage NOT IN ('cotizacion', 'cerrada', 'anulada')",
        "cotizaciones" => "i.stage = 'cotizacion'",
        "cerradas" => "i.stage = 'cerrada'",
        "anuladas" => "i.stage = 'anulada'",
        _ => "1 = 1",
    };
    let q = format!("%{}%", query.trim().to_lowercase());
    let mut stmt = conn.prepare(&format!(
        "SELECT i.uid, i.number, s.name, i.stage, i.incoterm, i.transport_mode, i.currency_code, i.fob_minor, i.eta,
            (SELECT count(*) FROM eta_changes e WHERE e.import_id = i.id AND e.old_eta IS NOT NULL),
            coalesce(julianday(i.eta) - julianday((SELECT coalesce(e.old_eta, e.new_eta) FROM eta_changes e WHERE e.import_id = i.id ORDER BY e.id LIMIT 1)), 0),
            i.landed_total_clp, i.estimated_landed_clp,
            (SELECT count(*) FROM import_items t WHERE t.import_id = i.id), i.created_at
         FROM imports i LEFT JOIN suppliers s ON s.id = i.supplier_id
         WHERE i.is_scenario = 0 AND {stages}
           AND (?1 = '%%' OR lower(i.number) LIKE ?1 OR lower(coalesce(s.name, '')) LIKE ?1 OR lower(coalesce(i.notes, '')) LIKE ?1
                OR EXISTS (SELECT 1 FROM import_items t WHERE t.import_id = i.id AND lower(t.description) LIKE ?1))
         ORDER BY CASE WHEN i.stage IN ('cerrada', 'anulada') THEN 1 ELSE 0 END, coalesce(i.eta, '9999-12-31'), i.id DESC
         LIMIT ?2"
    ))?;
    let rows = stmt.query_map(rusqlite::params![q, limit], |r| {
        Ok(ImportSummary {
            uid: r.get(0)?,
            number: r.get(1)?,
            supplier_name: r.get(2)?,
            stage: r.get(3)?,
            incoterm: r.get(4)?,
            transport_mode: r.get(5)?,
            currency_code: r.get(6)?,
            fob_minor: r.get(7)?,
            eta: r.get(8)?,
            eta_changes: r.get(9)?,
            eta_shift_days: r.get::<_, f64>(10)?.round() as i64,
            landed_total_clp: r.get(11)?,
            estimated_landed_clp: r.get(12)?,
            items: r.get(13)?,
            created_at: r.get(14)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/* ───────────────────────────── Productos de la carpeta ───────────────────────────── */

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ImportItemRow {
    pub id: i64,
    #[serde(skip)]
    pub product_id: Option<i64>,
    pub product_uid: Option<String>,
    pub sku: Option<String>,
    pub description: String,
    pub qty_milli: i64,
    pub received_milli: i64,
    pub unit_price_minor: i64,
    pub weight_g: Option<i64>,
    pub volume_cm3: Option<i64>,
    pub duty_ppm: Option<i64>,
    pub hs_code: Option<String>,
    pub landed_unit_cost_e4: Option<i64>,
    pub estimated_unit_cost_e4: Option<i64>,
}

pub fn import_items(conn: &Connection, import_id: i64) -> DbResult<Vec<ImportItemRow>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.product_id, p.uid, p.sku, t.description, t.qty_milli, t.received_milli, t.unit_price_minor, t.weight_g,
            t.volume_cm3, t.duty_ppm, t.hs_code, t.landed_unit_cost_e4, t.estimated_unit_cost_e4
         FROM import_items t LEFT JOIN products p ON p.id = t.product_id WHERE t.import_id = ?1 ORDER BY t.id",
    )?;
    let rows = stmt.query_map([import_id], |r| {
        Ok(ImportItemRow {
            id: r.get(0)?,
            product_id: r.get(1)?,
            product_uid: r.get(2)?,
            sku: r.get(3)?,
            description: r.get(4)?,
            qty_milli: r.get(5)?,
            received_milli: r.get(6)?,
            unit_price_minor: r.get(7)?,
            weight_g: r.get(8)?,
            volume_cm3: r.get(9)?,
            duty_ppm: r.get(10)?,
            hs_code: r.get(11)?,
            landed_unit_cost_e4: r.get(12)?,
            estimated_unit_cost_e4: r.get(13)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub struct ItemWrite<'a> {
    pub product_id: Option<i64>,
    pub description: &'a str,
    pub qty_milli: i64,
    pub unit_price_minor: i64,
    pub weight_g: Option<i64>,
    pub volume_cm3: Option<i64>,
    pub duty_ppm: Option<i64>,
    pub hs_code: Option<&'a str>,
}

/// Reemplaza los productos (solo mientras no se ha recibido nada).
pub fn replace_items(conn: &Connection, import_id: i64, items: &[ItemWrite<'_>]) -> DbResult<()> {
    conn.execute("DELETE FROM import_items WHERE import_id = ?1", [import_id])?;
    for it in items {
        conn.execute(
            "INSERT INTO import_items (import_id, product_id, description, qty_milli, unit_price_minor, weight_g, volume_cm3, duty_ppm, hs_code)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            rusqlite::params![
                import_id,
                it.product_id,
                it.description,
                it.qty_milli,
                it.unit_price_minor,
                it.weight_g,
                it.volume_cm3,
                it.duty_ppm,
                it.hs_code
            ],
        )?;
    }
    Ok(())
}

pub fn add_received(conn: &Connection, item_id: i64, qty: i64) -> DbResult<()> {
    conn.execute(
        "UPDATE import_items SET received_milli = received_milli + ?2 WHERE id = ?1",
        (item_id, qty),
    )?;
    Ok(())
}

/* ───────────────────────────── Costos ───────────────────────────── */

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ImportCostRow {
    pub id: i64,
    pub kind: String,
    pub description: Option<String>,
    #[serde(skip)]
    pub supplier_id: Option<i64>,
    pub supplier_uid: Option<String>,
    pub supplier_name: Option<String>,
    pub currency_code: String,
    pub currency_decimals: u32,
    pub amount_minor: i64,
    pub rate_e6: Option<i64>,
    pub is_estimate: bool,
    pub recoverable_tax: bool,
    pub allocation_basis: Option<String>,
    pub status: String,
    pub document_ref: Option<String>,
    pub cost_date: Option<String>,
    pub created_at: String,
    /// Cuenta por pagar del costo: (vence, monto, pagado, estado).
    pub payable_due: Option<String>,
    pub payable_amount_minor: Option<i64>,
    pub payable_paid_minor: Option<i64>,
}

pub fn import_costs(conn: &Connection, import_id: i64) -> DbResult<Vec<ImportCostRow>> {
    let mut stmt = conn.prepare(
        "SELECT k.id, k.kind, k.description, k.supplier_id, s.uid, s.name, k.currency_code, coalesce(c.decimals, 0), k.amount_minor,
            k.rate_e6, k.is_estimate, k.recoverable_tax, k.allocation_basis, k.status, k.document_ref, k.cost_date, k.created_at,
            b.due_date, b.amount_minor, b.paid_minor
         FROM import_costs k LEFT JOIN suppliers s ON s.id = k.supplier_id LEFT JOIN currencies c ON c.code = k.currency_code
         LEFT JOIN payables b ON b.source_type = 'IMP' AND b.source_id = k.id AND b.status <> 'anulada'
         WHERE k.import_id = ?1 ORDER BY k.id",
    )?;
    let rows = stmt.query_map([import_id], |r| {
        Ok(ImportCostRow {
            id: r.get(0)?,
            kind: r.get(1)?,
            description: r.get(2)?,
            supplier_id: r.get(3)?,
            supplier_uid: r.get(4)?,
            supplier_name: r.get(5)?,
            currency_code: r.get(6)?,
            currency_decimals: r.get(7)?,
            amount_minor: r.get(8)?,
            rate_e6: r.get(9)?,
            is_estimate: r.get::<_, i64>(10)? == 1,
            recoverable_tax: r.get::<_, i64>(11)? == 1,
            allocation_basis: r.get(12)?,
            status: r.get(13)?,
            document_ref: r.get(14)?,
            cost_date: r.get(15)?,
            created_at: r.get(16)?,
            payable_due: r.get(17)?,
            payable_amount_minor: r.get(18)?,
            payable_paid_minor: r.get(19)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub struct CostWrite<'a> {
    pub kind: &'a str,
    pub description: Option<&'a str>,
    pub supplier_id: Option<i64>,
    pub currency_code: &'a str,
    pub amount_minor: i64,
    pub rate_e6: Option<i64>,
    pub is_estimate: bool,
    pub recoverable_tax: bool,
    pub allocation_basis: Option<&'a str>,
    pub document_ref: Option<&'a str>,
    pub cost_date: Option<&'a str>,
}

pub fn insert_cost(
    conn: &Connection,
    import_id: i64,
    w: &CostWrite<'_>,
    now: &str,
) -> DbResult<i64> {
    conn.execute(
        "INSERT INTO import_costs (import_id, kind, description, supplier_id, currency_code, amount_minor, rate_e6, is_estimate,
            recoverable_tax, allocation_basis, document_ref, cost_date, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        rusqlite::params![
            import_id,
            w.kind,
            w.description,
            w.supplier_id,
            w.currency_code,
            w.amount_minor,
            w.rate_e6,
            w.is_estimate as i64,
            w.recoverable_tax as i64,
            w.allocation_basis,
            w.document_ref,
            w.cost_date,
            now
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn update_cost(conn: &Connection, id: i64, w: &CostWrite<'_>) -> DbResult<()> {
    conn.execute(
        "UPDATE import_costs SET kind = ?2, description = ?3, supplier_id = ?4, currency_code = ?5, amount_minor = ?6, rate_e6 = ?7,
            is_estimate = ?8, recoverable_tax = ?9, allocation_basis = ?10, document_ref = ?11, cost_date = ?12
         WHERE id = ?1",
        rusqlite::params![
            id,
            w.kind,
            w.description,
            w.supplier_id,
            w.currency_code,
            w.amount_minor,
            w.rate_e6,
            w.is_estimate as i64,
            w.recoverable_tax as i64,
            w.allocation_basis,
            w.document_ref,
            w.cost_date
        ],
    )?;
    Ok(())
}

pub fn delete_cost(conn: &Connection, id: i64) -> DbResult<()> {
    conn.execute("DELETE FROM import_costs WHERE id = ?1", [id])?;
    Ok(())
}

/// Anula un costo real: su cuenta por pagar y los pagos hechos (el dinero vuelve a la cuenta).
pub fn void_cost(conn: &Connection, id: i64, reason: &str) -> DbResult<usize> {
    conn.execute(
        "UPDATE import_costs SET status = 'anulado' WHERE id = ?1",
        [id],
    )?;
    let n = conn.execute(
        "UPDATE payments SET status = 'anulado', void_reason = ?2 WHERE status = 'vigente' AND id IN (
            SELECT a.payment_id FROM payment_allocations a JOIN payables b ON b.id = a.payable_id
            WHERE b.source_type = 'IMP' AND b.source_id = ?1)",
        (id, reason),
    )?;
    conn.execute(
        "UPDATE payables SET status = 'anulada' WHERE source_type = 'IMP' AND source_id = ?1",
        [id],
    )?;
    Ok(n)
}

pub fn insert_cost_payable(
    conn: &Connection,
    cost_id: i64,
    supplier_id: Option<i64>,
    due: &str,
    amount: i64,
) -> DbResult<i64> {
    conn.execute(
        "INSERT INTO payables (source_type, source_id, supplier_id, installment, due_date, amount_minor)
         VALUES ('IMP', ?1, ?2, 1, ?3, ?4)",
        rusqlite::params![cost_id, supplier_id, due, amount],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn open_cost_payable(conn: &Connection, cost_id: i64) -> DbResult<Option<i64>> {
    Ok(conn
        .query_row(
            "SELECT id FROM payables WHERE source_type = 'IMP' AND source_id = ?1 AND status = 'abierta' LIMIT 1",
            [cost_id],
            |r| r.get(0),
        )
        .optional()?)
}

/// Pago de un costo: (costo, número, fecha, monto, medio, estado).
pub type CostPayment = (i64, String, String, i64, String, String);

/// Pagos de los costos de una carpeta.
pub fn cost_payments(conn: &Connection, import_id: i64) -> DbResult<Vec<CostPayment>> {
    let mut stmt = conn.prepare(
        "SELECT k.id, p.number, p.payment_date, a.amount_minor, p.method, p.status
         FROM import_costs k JOIN payables b ON b.source_type = 'IMP' AND b.source_id = k.id
         JOIN payment_allocations a ON a.payable_id = b.id JOIN payments p ON p.id = a.payment_id
         WHERE k.import_id = ?1 ORDER BY p.payment_date, p.id",
    )?;
    let rows = stmt.query_map([import_id], |r| {
        Ok((
            r.get(0)?,
            r.get(1)?,
            r.get(2)?,
            r.get(3)?,
            r.get(4)?,
            r.get(5)?,
        ))
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/* ───────────────────────────── Historial ───────────────────────────── */

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct StageChange {
    pub from_stage: Option<String>,
    pub to_stage: String,
    pub changed_at: String,
    pub changed_by: Option<String>,
    pub note: Option<String>,
}

pub fn stage_history(conn: &Connection, import_id: i64) -> DbResult<Vec<StageChange>> {
    let mut stmt = conn.prepare(
        "SELECT h.from_stage, h.to_stage, h.changed_at, u.display_name, h.note
         FROM import_stage_history h LEFT JOIN users u ON u.id = h.changed_by WHERE h.import_id = ?1 ORDER BY h.id",
    )?;
    let rows = stmt.query_map([import_id], |r| {
        Ok(StageChange {
            from_stage: r.get(0)?,
            to_stage: r.get(1)?,
            changed_at: r.get(2)?,
            changed_by: r.get(3)?,
            note: r.get(4)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct EtaChange {
    pub old_eta: Option<String>,
    pub new_eta: String,
    pub reason: Option<String>,
    pub changed_at: String,
    pub changed_by: Option<String>,
}

pub fn eta_history(conn: &Connection, import_id: i64) -> DbResult<Vec<EtaChange>> {
    let mut stmt = conn.prepare(
        "SELECT e.old_eta, e.new_eta, e.reason, e.changed_at, u.display_name
         FROM eta_changes e LEFT JOIN users u ON u.id = e.changed_by WHERE e.import_id = ?1 ORDER BY e.id",
    )?;
    let rows = stmt.query_map([import_id], |r| {
        Ok(EtaChange {
            old_eta: r.get(0)?,
            new_eta: r.get(1)?,
            reason: r.get(2)?,
            changed_at: r.get(3)?,
            changed_by: r.get(4)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Recepciones (REC) de una carpeta.
pub fn import_receipts(conn: &Connection, import_id: i64) -> DbResult<Vec<(String, String)>> {
    let mut stmt = conn.prepare("SELECT number, receipt_date FROM receipts WHERE import_id = ?1 AND status = 'confirmada' ORDER BY id")?;
    let rows = stmt.query_map([import_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Próximas llegadas por producto desde importaciones en curso (para el análisis de stock).
pub fn import_arrivals(conn: &Connection) -> DbResult<Vec<(i64, String, i64)>> {
    let mut stmt = conn.prepare(
        "SELECT t.product_id, min(i.eta), sum(t.qty_milli - t.received_milli)
         FROM import_items t JOIN imports i ON i.id = t.import_id
         WHERE t.product_id IS NOT NULL AND t.received_milli < t.qty_milli AND i.is_scenario = 0 AND i.eta IS NOT NULL
           AND i.stage NOT IN ('cotizacion', 'recibida', 'cerrada', 'anulada')
         GROUP BY t.product_id",
    )?;
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
    Ok(rows.collect::<Result<_, _>>()?)
}
