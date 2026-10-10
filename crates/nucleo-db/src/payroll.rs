//! Remuneraciones (Fase 10, hito B): personas, indicadores del mes y liquidaciones.

use crate::DbResult;
use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct WorkerRow {
    pub id: i64,
    pub rut: String,
    pub name: String,
    pub is_owner: bool,
    pub position: Option<String>,
    pub start_date: String,
    pub end_date: Option<String>,
    pub terms_json: String,
    pub active: bool,
}

fn worker_row(r: &Row<'_>) -> rusqlite::Result<WorkerRow> {
    Ok(WorkerRow {
        id: r.get(0)?,
        rut: r.get(1)?,
        name: r.get(2)?,
        is_owner: r.get::<_, i64>(3)? == 1,
        position: r.get(4)?,
        start_date: r.get(5)?,
        end_date: r.get(6)?,
        terms_json: r.get(7)?,
        active: r.get::<_, i64>(8)? == 1,
    })
}

const WORKER_COLS: &str =
    "id, rut, name, is_owner, position, start_date, end_date, terms_json, active";

pub fn workers(conn: &Connection) -> DbResult<Vec<WorkerRow>> {
    let mut st = conn.prepare(&format!(
        "SELECT {WORKER_COLS} FROM workers ORDER BY active DESC, is_owner DESC, name COLLATE NOCASE"
    ))?;
    let rows = st.query_map([], worker_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn worker(conn: &Connection, id: i64) -> DbResult<Option<WorkerRow>> {
    Ok(conn
        .query_row(
            &format!("SELECT {WORKER_COLS} FROM workers WHERE id = ?1"),
            [id],
            worker_row,
        )
        .optional()?)
}

pub fn worker_by_rut(conn: &Connection, rut: &str) -> DbResult<Option<WorkerRow>> {
    Ok(conn
        .query_row(
            &format!("SELECT {WORKER_COLS} FROM workers WHERE rut = ?1"),
            [rut],
            worker_row,
        )
        .optional()?)
}

pub struct WorkerWrite<'a> {
    pub rut: &'a str,
    pub name: &'a str,
    pub is_owner: bool,
    pub position: Option<&'a str>,
    pub start_date: &'a str,
    pub end_date: Option<&'a str>,
    pub terms_json: &'a str,
    pub active: bool,
}

pub fn insert_worker(conn: &Connection, w: &WorkerWrite<'_>, now: &str) -> DbResult<i64> {
    conn.execute(
        "INSERT INTO workers (rut, name, is_owner, position, start_date, end_date, terms_json, active, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
        params![
            w.rut,
            w.name,
            w.is_owner as i64,
            w.position,
            w.start_date,
            w.end_date,
            w.terms_json,
            w.active as i64,
            now
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn update_worker(conn: &Connection, id: i64, w: &WorkerWrite<'_>, now: &str) -> DbResult<()> {
    conn.execute(
        "UPDATE workers SET rut = ?2, name = ?3, is_owner = ?4, position = ?5, start_date = ?6, end_date = ?7,
            terms_json = ?8, active = ?9, updated_at = ?10 WHERE id = ?1",
        params![
            id,
            w.rut,
            w.name,
            w.is_owner as i64,
            w.position,
            w.start_date,
            w.end_date,
            w.terms_json,
            w.active as i64,
            now
        ],
    )?;
    Ok(())
}

/* ───────────────────────────── indicadores ───────────────────────────── */

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct IndicatorsRow {
    pub period: String,
    pub indicators_json: String,
    pub source: Option<String>,
    pub updated_at: String,
}

fn indicators_row(r: &Row<'_>) -> rusqlite::Result<IndicatorsRow> {
    Ok(IndicatorsRow {
        period: r.get(0)?,
        indicators_json: r.get(1)?,
        source: r.get(2)?,
        updated_at: r.get(3)?,
    })
}

pub fn indicators(conn: &Connection, period: &str) -> DbResult<Option<IndicatorsRow>> {
    Ok(conn
        .query_row(
            "SELECT period, indicators_json, source, updated_at FROM payroll_indicators WHERE period = ?1",
            [period],
            indicators_row,
        )
        .optional()?)
}

/// Los últimos indicadores guardados antes del período (para proponerlos como punto de partida).
pub fn indicators_before(conn: &Connection, period: &str) -> DbResult<Option<IndicatorsRow>> {
    Ok(conn
        .query_row(
            "SELECT period, indicators_json, source, updated_at FROM payroll_indicators
             WHERE period < ?1 ORDER BY period DESC LIMIT 1",
            [period],
            indicators_row,
        )
        .optional()?)
}

pub fn save_indicators(
    conn: &Connection,
    period: &str,
    json: &str,
    source: Option<&str>,
    now: &str,
) -> DbResult<()> {
    conn.execute(
        "INSERT INTO payroll_indicators (period, indicators_json, source, updated_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(period) DO UPDATE SET indicators_json = excluded.indicators_json,
            source = excluded.source, updated_at = excluded.updated_at",
        params![period, json, source, now],
    )?;
    Ok(())
}

/* ───────────────────────────── liquidaciones ───────────────────────────── */

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PayslipRow {
    pub id: i64,
    pub worker_id: i64,
    pub period: String,
    pub status: String,
    pub inputs_json: String,
    pub snapshot_json: Option<String>,
    pub pay_date: Option<String>,
    pub tax_minor: i64,
    pub to_pay_minor: i64,
    pub employer_cost_minor: i64,
    pub emitted_at: Option<String>,
    pub voided_at: Option<String>,
    pub void_reason: Option<String>,
}

const PAYSLIP_COLS: &str =
    "id, worker_id, period, status, inputs_json, snapshot_json, pay_date, tax_minor,
    to_pay_minor, employer_cost_minor, emitted_at, voided_at, void_reason";

fn payslip_row(r: &Row<'_>) -> rusqlite::Result<PayslipRow> {
    Ok(PayslipRow {
        id: r.get(0)?,
        worker_id: r.get(1)?,
        period: r.get(2)?,
        status: r.get(3)?,
        inputs_json: r.get(4)?,
        snapshot_json: r.get(5)?,
        pay_date: r.get(6)?,
        tax_minor: r.get(7)?,
        to_pay_minor: r.get(8)?,
        employer_cost_minor: r.get(9)?,
        emitted_at: r.get(10)?,
        voided_at: r.get(11)?,
        void_reason: r.get(12)?,
    })
}

/// La liquidación vigente (borrador o emitida) de una persona en un mes.
pub fn current_payslip(
    conn: &Connection,
    worker_id: i64,
    period: &str,
) -> DbResult<Option<PayslipRow>> {
    Ok(conn
        .query_row(
            &format!(
                "SELECT {PAYSLIP_COLS} FROM payslips WHERE worker_id = ?1 AND period = ?2 AND status <> 'anulada'"
            ),
            params![worker_id, period],
            payslip_row,
        )
        .optional()?)
}

pub fn payslip(conn: &Connection, id: i64) -> DbResult<Option<PayslipRow>> {
    Ok(conn
        .query_row(
            &format!("SELECT {PAYSLIP_COLS} FROM payslips WHERE id = ?1"),
            [id],
            payslip_row,
        )
        .optional()?)
}

pub fn payslips_of_period(conn: &Connection, period: &str) -> DbResult<Vec<PayslipRow>> {
    let mut st = conn.prepare(&format!(
        "SELECT {PAYSLIP_COLS} FROM payslips WHERE period = ?1 ORDER BY id"
    ))?;
    let rows = st.query_map([period], payslip_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn save_payslip_inputs(
    conn: &Connection,
    worker_id: i64,
    period: &str,
    inputs_json: &str,
    now: &str,
) -> DbResult<i64> {
    if let Some(p) = current_payslip(conn, worker_id, period)? {
        conn.execute(
            "UPDATE payslips SET inputs_json = ?2, updated_at = ?3 WHERE id = ?1",
            params![p.id, inputs_json, now],
        )?;
        Ok(p.id)
    } else {
        conn.execute(
            "INSERT INTO payslips (worker_id, period, inputs_json, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)",
            params![worker_id, period, inputs_json, now],
        )?;
        Ok(conn.last_insert_rowid())
    }
}

#[allow(clippy::too_many_arguments)]
pub fn emit_payslip(
    conn: &Connection,
    id: i64,
    snapshot_json: &str,
    pay_date: &str,
    tax: i64,
    to_pay: i64,
    employer_cost: i64,
    by: Option<i64>,
    now: &str,
) -> DbResult<()> {
    conn.execute(
        "UPDATE payslips SET snapshot_json = ?2, pay_date = ?3, tax_minor = ?4, to_pay_minor = ?5,
            employer_cost_minor = ?6, emitted_by = ?7, emitted_at = ?8, status = 'emitida', updated_at = ?8
         WHERE id = ?1 AND status = 'borrador'",
        params![id, snapshot_json, pay_date, tax, to_pay, employer_cost, by, now],
    )?;
    Ok(())
}

pub fn void_payslip(conn: &Connection, id: i64, reason: &str, now: &str) -> DbResult<()> {
    conn.execute(
        "UPDATE payslips SET status = 'anulada', voided_at = ?3, void_reason = ?2, updated_at = ?3
         WHERE id = ?1 AND status = 'emitida'",
        params![id, reason, now],
    )?;
    Ok(())
}

pub fn delete_draft(conn: &Connection, id: i64) -> DbResult<()> {
    conn.execute(
        "DELETE FROM payslips WHERE id = ?1 AND status = 'borrador'",
        [id],
    )?;
    Ok(())
}

/// Impuesto único retenido en liquidaciones emitidas pagadas entre dos fechas (código 48 del F29).
pub fn tax_paid_between(conn: &Connection, from: &str, to: &str) -> DbResult<(i64, i64)> {
    Ok(conn.query_row(
        "SELECT COUNT(*), COALESCE(SUM(tax_minor), 0) FROM payslips
         WHERE status = 'emitida' AND pay_date BETWEEN ?1 AND ?2",
        [from, to],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?)
}
