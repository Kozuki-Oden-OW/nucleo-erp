//! Finanzas (Fase 8): cuentas de dinero (caja, banco, billetera), su libro, traspasos, gastos,
//! categorías, recurrentes y vencimientos por cobrar y por pagar.

use crate::{DbError, DbResult};
use rusqlite::{Connection, OptionalExtension, Row};
use serde::Serialize;

/* ───────────────────────────── Cuentas de dinero ───────────────────────────── */

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AccountRow {
    #[serde(skip)]
    pub id: i64,
    pub uid: String,
    /// "caja", "banco" o "billetera".
    pub kind: String,
    pub name: String,
    pub bank_name: Option<String>,
    pub account_label: Option<String>,
    pub opening_minor: i64,
    pub opening_date: Option<String>,
    pub archived: bool,
    pub balance_minor: i64,
}

const BALANCE: &str = "a.opening_minor
    + coalesce((SELECT sum(CASE p.direction WHEN 'entrada' THEN p.amount_minor ELSE -p.amount_minor END)
                FROM payments p WHERE p.money_account_id = a.id AND p.status = 'vigente'), 0)
    + coalesce((SELECT sum(t.amount_minor) FROM money_transfers t WHERE t.to_account_id = a.id), 0)
    - coalesce((SELECT sum(t.amount_minor) FROM money_transfers t WHERE t.from_account_id = a.id), 0)";

fn map_account(r: &Row<'_>) -> rusqlite::Result<AccountRow> {
    Ok(AccountRow {
        id: r.get(0)?,
        uid: r.get(1)?,
        kind: r.get(2)?,
        name: r.get(3)?,
        bank_name: r.get(4)?,
        account_label: r.get(5)?,
        opening_minor: r.get(6)?,
        opening_date: r.get(7)?,
        archived: r.get::<_, i64>(8)? == 1,
        balance_minor: r.get(9)?,
    })
}

pub fn accounts(conn: &Connection) -> DbResult<Vec<AccountRow>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT a.id, a.uid, a.kind, a.name, a.bank_name, a.account_label, a.opening_minor, a.opening_date,
            a.archived_at IS NOT NULL, {BALANCE}
         FROM money_accounts a ORDER BY a.archived_at IS NOT NULL, CASE a.kind WHEN 'caja' THEN 0 WHEN 'banco' THEN 1 ELSE 2 END, a.id"
    ))?;
    let rows = stmt.query_map([], map_account)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn account_by_uid(conn: &Connection, uid: &str) -> DbResult<Option<AccountRow>> {
    Ok(accounts(conn)?.into_iter().find(|a| a.uid == uid))
}

pub struct AccountWrite<'a> {
    pub kind: &'a str,
    pub name: &'a str,
    pub bank_name: Option<&'a str>,
    pub account_label: Option<&'a str>,
    pub opening_minor: i64,
    pub opening_date: Option<&'a str>,
}

pub fn insert_account(
    conn: &Connection,
    uid: &str,
    w: &AccountWrite<'_>,
    now: &str,
) -> DbResult<i64> {
    conn.execute(
        "INSERT INTO money_accounts (uid, kind, name, bank_name, account_label, opening_minor, opening_date, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![uid, w.kind, w.name.trim(), w.bank_name, w.account_label, w.opening_minor, w.opening_date, now],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn update_account(conn: &Connection, id: i64, w: &AccountWrite<'_>) -> DbResult<()> {
    conn.execute(
        "UPDATE money_accounts SET kind = ?2, name = ?3, bank_name = ?4, account_label = ?5, opening_minor = ?6, opening_date = ?7
         WHERE id = ?1",
        rusqlite::params![id, w.kind, w.name.trim(), w.bank_name, w.account_label, w.opening_minor, w.opening_date],
    )?;
    Ok(())
}

pub fn archive_account(conn: &Connection, id: i64, now: &str) -> DbResult<()> {
    conn.execute(
        "UPDATE money_accounts SET archived_at = ?2 WHERE id = ?1",
        (id, now),
    )?;
    Ok(())
}

/// Cuenta sugerida para un medio de pago: efectivo → la caja; los demás → el primer banco (o la caja).
pub fn account_for_method(conn: &Connection, method: &str) -> DbResult<Option<i64>> {
    let kind_order = if method == "efectivo" {
        "CASE kind WHEN 'caja' THEN 0 WHEN 'billetera' THEN 1 ELSE 2 END"
    } else {
        "CASE kind WHEN 'banco' THEN 0 WHEN 'billetera' THEN 1 ELSE 2 END"
    };
    Ok(conn
        .query_row(
            &format!("SELECT id FROM money_accounts WHERE archived_at IS NULL ORDER BY {kind_order}, id LIMIT 1"),
            [],
            |r| r.get(0),
        )
        .optional()?)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LedgerRow {
    pub date: String,
    /// "cobro", "pago", "traspaso_entrada", "traspaso_salida".
    pub kind: String,
    pub document: String,
    pub detail: String,
    pub amount_minor: i64,
    pub link: Option<String>,
    pub status: String,
}

/// Libro de una cuenta: cobros, pagos y traspasos (más reciente primero).
pub fn ledger(conn: &Connection, account_id: i64, limit: u32) -> DbResult<Vec<LedgerRow>> {
    let mut stmt = conn.prepare(
        "SELECT * FROM (
            SELECT p.payment_date AS d, CASE p.direction WHEN 'entrada' THEN 'cobro' ELSE 'pago' END, p.number,
                coalesce(
                    (SELECT 'Cobro ' || s.number || ' · ' || coalesce(c.name, 'Cliente ocasional') FROM payment_allocations a
                       JOIN receivables r ON r.id = a.receivable_id JOIN sales s ON s.id = r.sale_id LEFT JOIN customers c ON c.id = s.customer_id
                      WHERE a.payment_id = p.id LIMIT 1),
                    (SELECT 'Pago ' || coalesce(c.supplier_doc_kind || ' ' || c.supplier_doc_number, c.number) || ' · ' || v.name
                       FROM payment_allocations a JOIN payables b ON b.id = a.payable_id JOIN purchases c ON b.source_type = 'COM' AND c.id = b.source_id
                       JOIN suppliers v ON v.id = c.supplier_id WHERE a.payment_id = p.id LIMIT 1),
                    (SELECT 'Gasto ' || g.number || ' · ' || g.description FROM payment_allocations a JOIN payables b ON b.id = a.payable_id
                       JOIN expenses g ON b.source_type = 'GAS' AND g.id = b.source_id WHERE a.payment_id = p.id LIMIT 1),
                    (SELECT 'Importación ' || i.number || ' · ' || coalesce(k.description, replace(k.kind, '_', ' ')) FROM payment_allocations a
                       JOIN payables b ON b.id = a.payable_id JOIN import_costs k ON b.source_type = 'IMP' AND k.id = b.source_id
                       JOIN imports i ON i.id = k.import_id WHERE a.payment_id = p.id LIMIT 1),
                    p.number),
                CASE p.direction WHEN 'entrada' THEN p.amount_minor ELSE -p.amount_minor END,
                coalesce(
                    (SELECT '/ventas/' || s.uid FROM payment_allocations a JOIN receivables r ON r.id = a.receivable_id JOIN sales s ON s.id = r.sale_id WHERE a.payment_id = p.id LIMIT 1),
                    (SELECT '/compras/doc/' || c.uid FROM payment_allocations a JOIN payables b ON b.id = a.payable_id JOIN purchases c ON b.source_type = 'COM' AND c.id = b.source_id WHERE a.payment_id = p.id LIMIT 1),
                    (SELECT '/dinero/gasto/' || g.uid FROM payment_allocations a JOIN payables b ON b.id = a.payable_id JOIN expenses g ON b.source_type = 'GAS' AND g.id = b.source_id WHERE a.payment_id = p.id LIMIT 1),
                    (SELECT '/comex/importacion/' || i.uid FROM payment_allocations a JOIN payables b ON b.id = a.payable_id JOIN import_costs k ON b.source_type = 'IMP' AND k.id = b.source_id JOIN imports i ON i.id = k.import_id WHERE a.payment_id = p.id LIMIT 1)),
                p.status, p.id AS k
            FROM payments p WHERE p.money_account_id = ?1
            UNION ALL
            SELECT t.transfer_date, 'traspaso_entrada', 'Traspaso', 'Desde ' || f.name || coalesce(' · ' || t.notes, ''), t.amount_minor, NULL, 'vigente', -t.id
            FROM money_transfers t JOIN money_accounts f ON f.id = t.from_account_id WHERE t.to_account_id = ?1
            UNION ALL
            SELECT t.transfer_date, 'traspaso_salida', 'Traspaso', 'A ' || d.name || coalesce(' · ' || t.notes, ''), -t.amount_minor, NULL, 'vigente', -t.id
            FROM money_transfers t JOIN money_accounts d ON d.id = t.to_account_id WHERE t.from_account_id = ?1
         ) ORDER BY d DESC, k DESC LIMIT ?2",
    )?;
    let rows = stmt.query_map((account_id, limit), |r| {
        Ok(LedgerRow {
            date: r.get(0)?,
            kind: r.get(1)?,
            document: r.get(2)?,
            detail: r.get(3)?,
            amount_minor: r.get(4)?,
            link: r.get(5)?,
            status: r.get(6)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

#[allow(clippy::too_many_arguments)]
pub fn insert_transfer(
    conn: &Connection,
    uid: &str,
    from: i64,
    to: i64,
    date: &str,
    amount: i64,
    notes: Option<&str>,
    by: Option<i64>,
    now: &str,
) -> DbResult<()> {
    conn.execute(
        "INSERT INTO money_transfers (uid, from_account_id, to_account_id, transfer_date, amount_minor, notes, created_by, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![uid, from, to, date, amount, notes, by, now],
    )?;
    Ok(())
}

/* ───────────────────────────── Gastos ───────────────────────────── */

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CategoryRow {
    pub id: i64,
    pub name: String,
    pub behavior: String,
}

pub fn categories(conn: &Connection) -> DbResult<Vec<CategoryRow>> {
    let mut stmt = conn.prepare("SELECT id, name, behavior FROM expense_categories WHERE archived_at IS NULL ORDER BY name COLLATE NOCASE")?;
    let rows = stmt.query_map([], |r| {
        Ok(CategoryRow {
            id: r.get(0)?,
            name: r.get(1)?,
            behavior: r.get(2)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn insert_category(conn: &Connection, name: &str, behavior: &str) -> DbResult<i64> {
    let res = conn.execute(
        "INSERT INTO expense_categories (name, behavior) VALUES (?1, ?2)",
        (name.trim(), behavior),
    );
    match res {
        Err(rusqlite::Error::SqliteFailure(e, _))
            if e.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            Err(DbError::Duplicate("categoría"))
        }
        other => {
            other?;
            Ok(conn.last_insert_rowid())
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExpenseRow {
    pub id: i64,
    pub uid: String,
    pub number: String,
    pub category_id: i64,
    pub category: String,
    pub supplier_uid: Option<String>,
    pub supplier_name: Option<String>,
    pub date: String,
    pub due_date: Option<String>,
    pub description: String,
    pub net_minor: i64,
    pub tax_minor: i64,
    pub total_minor: i64,
    pub paid_minor: i64,
    pub status: String,
    pub void_reason: Option<String>,
    pub notes: Option<String>,
    pub recurring_id: Option<i64>,
}

const EXP_SELECT: &str = "SELECT g.id, g.uid, g.number, g.category_id, k.name, v.uid, v.name, g.expense_date, g.due_date, g.description,
        g.net_minor, g.tax_minor, g.total_minor,
        coalesce((SELECT sum(b.paid_minor) FROM payables b WHERE b.source_type = 'GAS' AND b.source_id = g.id AND b.status <> 'anulada'), 0),
        g.status, g.void_reason, g.notes, g.recurring_schedule_id
    FROM expenses g JOIN expense_categories k ON k.id = g.category_id LEFT JOIN suppliers v ON v.id = g.supplier_id";

fn map_expense(r: &Row<'_>) -> rusqlite::Result<ExpenseRow> {
    Ok(ExpenseRow {
        id: r.get(0)?,
        uid: r.get(1)?,
        number: r.get(2)?,
        category_id: r.get(3)?,
        category: r.get(4)?,
        supplier_uid: r.get(5)?,
        supplier_name: r.get(6)?,
        date: r.get(7)?,
        due_date: r.get(8)?,
        description: r.get(9)?,
        net_minor: r.get(10)?,
        tax_minor: r.get(11)?,
        total_minor: r.get(12)?,
        paid_minor: r.get(13)?,
        status: r.get(14)?,
        void_reason: r.get(15)?,
        notes: r.get(16)?,
        recurring_id: r.get(17)?,
    })
}

pub struct ExpenseWrite<'a> {
    pub category_id: i64,
    pub supplier_id: Option<i64>,
    pub date: &'a str,
    pub due_date: Option<&'a str>,
    pub description: &'a str,
    pub net_minor: i64,
    pub tax_minor: i64,
    pub total_minor: i64,
    pub recurring_id: Option<i64>,
    pub notes: Option<&'a str>,
}

pub fn insert_expense(
    conn: &Connection,
    uid: &str,
    number: &str,
    w: &ExpenseWrite<'_>,
    by: Option<i64>,
    now: &str,
) -> DbResult<i64> {
    conn.execute(
        "INSERT INTO expenses (uid, number, category_id, supplier_id, expense_date, due_date, description, net_minor, tax_minor,
            total_minor, recurring_schedule_id, notes, created_by, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        rusqlite::params![
            uid, number, w.category_id, w.supplier_id, w.date, w.due_date, w.description, w.net_minor, w.tax_minor,
            w.total_minor, w.recurring_id, w.notes, by, now
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn expense_by_uid(conn: &Connection, uid: &str) -> DbResult<Option<ExpenseRow>> {
    Ok(conn
        .query_row(
            &format!("{EXP_SELECT} WHERE g.uid = ?1"),
            [uid],
            map_expense,
        )
        .optional()?)
}

pub fn list_expenses(
    conn: &Connection,
    query: &str,
    from: Option<&str>,
    to: Option<&str>,
    include_void: bool,
    limit: u32,
) -> DbResult<Vec<ExpenseRow>> {
    let like = format!("%{}%", query.trim());
    let mut stmt = conn.prepare(&format!(
        "{EXP_SELECT} WHERE (?1 = '%%' OR g.number LIKE ?1 OR g.description LIKE ?1 OR k.name LIKE ?1 OR coalesce(v.name, '') LIKE ?1)
           AND (?2 IS NULL OR g.expense_date >= ?2) AND (?3 IS NULL OR g.expense_date <= ?3)
           AND (?4 = 1 OR g.status = 'registrado')
         ORDER BY g.expense_date DESC, g.id DESC LIMIT ?5"
    ))?;
    let rows = stmt.query_map(
        rusqlite::params![like, from, to, include_void as i64, limit],
        map_expense,
    )?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn void_expense(conn: &Connection, id: i64, reason: &str) -> DbResult<()> {
    conn.execute(
        "UPDATE expenses SET status = 'anulado', void_reason = ?2 WHERE id = ?1",
        (id, reason),
    )?;
    Ok(())
}

/// Gastos registrados por categoría en un período: (categoría, total).
pub fn expenses_by_category(
    conn: &Connection,
    from: &str,
    to: &str,
) -> DbResult<Vec<(String, i64)>> {
    let mut stmt = conn.prepare(
        "SELECT k.name, sum(g.total_minor) FROM expenses g JOIN expense_categories k ON k.id = g.category_id
         WHERE g.status = 'registrado' AND g.expense_date BETWEEN ?1 AND ?2 GROUP BY k.name ORDER BY 2 DESC",
    )?;
    let rows = stmt.query_map((from, to), |r| Ok((r.get(0)?, r.get(1)?)))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn insert_expense_payable(
    conn: &Connection,
    expense_id: i64,
    supplier_id: Option<i64>,
    due: &str,
    amount: i64,
) -> DbResult<i64> {
    conn.execute(
        "INSERT INTO payables (source_type, source_id, supplier_id, installment, due_date, amount_minor) VALUES ('GAS', ?1, ?2, 1, ?3, ?4)",
        (expense_id, supplier_id, due, amount),
    )?;
    Ok(conn.last_insert_rowid())
}

/* ───────────────────────────── Recurrentes ───────────────────────────── */

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RecurringRow {
    pub id: i64,
    /// "ingreso" o "egreso".
    pub direction: String,
    pub description: String,
    pub category_id: Option<i64>,
    pub category: Option<String>,
    pub amount_minor: i64,
    /// "semanal", "mensual", "bimestral", "trimestral" o "anual".
    pub frequency: String,
    pub day_of_period: Option<i64>,
    pub starts_on: String,
    pub ends_on: Option<String>,
    pub active: bool,
}

pub fn recurring(conn: &Connection) -> DbResult<Vec<RecurringRow>> {
    let mut stmt = conn.prepare(
        "SELECT r.id, r.direction, r.description, r.category_id, k.name, r.amount_minor, r.frequency, r.day_of_period,
            r.starts_on, r.ends_on, r.is_active
         FROM recurring_schedules r LEFT JOIN expense_categories k ON k.id = r.category_id
         ORDER BY r.is_active DESC, r.direction, r.description COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(RecurringRow {
            id: r.get(0)?,
            direction: r.get(1)?,
            description: r.get(2)?,
            category_id: r.get(3)?,
            category: r.get(4)?,
            amount_minor: r.get(5)?,
            frequency: r.get(6)?,
            day_of_period: r.get(7)?,
            starts_on: r.get(8)?,
            ends_on: r.get(9)?,
            active: r.get::<_, i64>(10)? == 1,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

#[allow(clippy::too_many_arguments)]
pub fn save_recurring(
    conn: &Connection,
    id: Option<i64>,
    direction: &str,
    description: &str,
    category_id: Option<i64>,
    amount: i64,
    frequency: &str,
    day: Option<i64>,
    starts_on: &str,
    ends_on: Option<&str>,
    active: bool,
    now: &str,
) -> DbResult<i64> {
    match id {
        Some(id) => {
            conn.execute(
                "UPDATE recurring_schedules SET direction = ?2, description = ?3, category_id = ?4, amount_minor = ?5, frequency = ?6,
                    day_of_period = ?7, starts_on = ?8, ends_on = ?9, is_active = ?10 WHERE id = ?1",
                rusqlite::params![id, direction, description, category_id, amount, frequency, day, starts_on, ends_on, active as i64],
            )?;
            Ok(id)
        }
        None => {
            conn.execute(
                "INSERT INTO recurring_schedules (direction, description, category_id, amount_minor, frequency, day_of_period, starts_on,
                    ends_on, is_active, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                rusqlite::params![direction, description, category_id, amount, frequency, day, starts_on, ends_on, active as i64, now],
            )?;
            Ok(conn.last_insert_rowid())
        }
    }
}

/* ───────────────────────────── Vencimientos ───────────────────────────── */

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DueRow {
    /// "cobro" o "pago".
    pub kind: String,
    pub due_date: String,
    pub party: String,
    pub document: String,
    pub link: String,
    pub amount_minor: i64,
    pub pending_minor: i64,
}

/// Cuentas por cobrar abiertas.
pub fn open_receivables(conn: &Connection) -> DbResult<Vec<DueRow>> {
    let mut stmt = conn.prepare(
        "SELECT r.due_date, coalesce(c.name, 'Cliente ocasional'), s.number, s.uid, r.amount_minor, r.amount_minor - r.paid_minor
         FROM receivables r JOIN sales s ON s.id = r.sale_id LEFT JOIN customers c ON c.id = s.customer_id
         WHERE r.status = 'abierta' AND r.amount_minor > r.paid_minor ORDER BY r.due_date",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(DueRow {
            kind: "cobro".into(),
            due_date: r.get(0)?,
            party: r.get(1)?,
            document: r.get(2)?,
            link: format!("/ventas/{}", r.get::<_, String>(3)?),
            amount_minor: r.get(4)?,
            pending_minor: r.get(5)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Cuentas por pagar abiertas (documentos de compra y gastos).
pub fn open_payables(conn: &Connection) -> DbResult<Vec<DueRow>> {
    let mut stmt = conn.prepare(
        "SELECT b.due_date,
            coalesce(v.name, CASE b.source_type WHEN 'GAS' THEN (SELECT k.name FROM expenses g JOIN expense_categories k ON k.id = g.category_id WHERE g.id = b.source_id)
                WHEN 'IMP' THEN 'Importación' END, 'Proveedor'),
            CASE b.source_type
                WHEN 'COM' THEN (SELECT coalesce(c.supplier_doc_kind || ' ' || c.supplier_doc_number, c.number) FROM purchases c WHERE c.id = b.source_id)
                WHEN 'GAS' THEN (SELECT g.number || ' · ' || g.description FROM expenses g WHERE g.id = b.source_id)
                WHEN 'IMP' THEN (SELECT i.number || ' · ' || coalesce(k.description, replace(k.kind, '_', ' ')) FROM import_costs k JOIN imports i ON i.id = k.import_id WHERE k.id = b.source_id)
                ELSE b.source_type END,
            CASE b.source_type
                WHEN 'COM' THEN '/compras/doc/' || (SELECT c.uid FROM purchases c WHERE c.id = b.source_id)
                WHEN 'GAS' THEN '/dinero/gasto/' || (SELECT g.uid FROM expenses g WHERE g.id = b.source_id)
                WHEN 'IMP' THEN '/comex/importacion/' || (SELECT i.uid FROM import_costs k JOIN imports i ON i.id = k.import_id WHERE k.id = b.source_id)
                ELSE '/dinero' END,
            b.amount_minor, b.amount_minor - b.paid_minor
         FROM payables b LEFT JOIN suppliers v ON v.id = b.supplier_id
         WHERE b.status = 'abierta' AND b.amount_minor > b.paid_minor ORDER BY b.due_date",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(DueRow {
            kind: "pago".into(),
            due_date: r.get(0)?,
            party: r.get(1)?,
            document: r.get(2)?,
            link: r.get(3)?,
            amount_minor: r.get(4)?,
            pending_minor: r.get(5)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn open_payable_for_expense(conn: &Connection, expense_id: i64) -> DbResult<Option<i64>> {
    Ok(conn
        .query_row(
            "SELECT id FROM payables WHERE source_type = 'GAS' AND source_id = ?1 AND status = 'abierta' LIMIT 1",
            [expense_id],
            |r| r.get(0),
        )
        .optional()?)
}

/// Pagos vigentes de un gasto: (número, fecha, monto, medio).
pub fn expense_payments(
    conn: &Connection,
    expense_id: i64,
) -> DbResult<Vec<(String, String, i64, String)>> {
    let mut stmt = conn.prepare(
        "SELECT p.number, p.payment_date, a.amount_minor, p.method FROM payment_allocations a
         JOIN payments p ON p.id = a.payment_id JOIN payables b ON b.id = a.payable_id
         WHERE b.source_type = 'GAS' AND b.source_id = ?1 AND p.status = 'vigente' ORDER BY p.payment_date, p.id",
    )?;
    let rows = stmt.query_map([expense_id], |r| {
        Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn void_expense_payments(conn: &Connection, expense_id: i64, reason: &str) -> DbResult<usize> {
    let n = conn.execute(
        "UPDATE payments SET status = 'anulado', void_reason = ?2 WHERE status = 'vigente' AND id IN (
            SELECT a.payment_id FROM payment_allocations a JOIN payables b ON b.id = a.payable_id
            WHERE b.source_type = 'GAS' AND b.source_id = ?1)",
        (expense_id, reason),
    )?;
    conn.execute(
        "UPDATE payables SET status = 'anulada' WHERE source_type = 'GAS' AND source_id = ?1",
        [expense_id],
    )?;
    Ok(n)
}

/// Pago (EGR) de una cuenta por pagar sin documento de compra (ej. un gasto), con o sin proveedor.
#[allow(clippy::too_many_arguments)]
pub fn insert_payable_payment(
    conn: &Connection,
    uid: &str,
    number: &str,
    supplier_id: Option<i64>,
    account_id: i64,
    date: &str,
    method: &str,
    amount: i64,
    payable_id: i64,
    by: Option<i64>,
    now: &str,
) -> DbResult<i64> {
    conn.execute(
        "INSERT INTO payments (uid, doc_type, number, direction, party_type, party_id, money_account_id, payment_date, method,
            amount_minor, created_by, created_at)
         VALUES (?1, 'EGR', ?2, 'salida', CASE WHEN ?3 IS NULL THEN NULL ELSE 'proveedor' END, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![uid, number, supplier_id, account_id, date, method, amount, by, now],
    )?;
    let id = conn.last_insert_rowid();
    conn.execute(
        "INSERT INTO payment_allocations (payment_id, payable_id, amount_minor, created_at) VALUES (?1, ?2, ?3, ?4)",
        (id, payable_id, amount, now),
    )?;
    Ok(id)
}
