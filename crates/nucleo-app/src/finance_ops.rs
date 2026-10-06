//! Casos de uso de Finanzas (Fase 8): cuentas de caja y banco, traspasos, gastos, recurrentes,
//! cuentas por cobrar y por pagar con antigüedad, calendario, flujo de caja proyectado y el resumen
//! del dueño (Hito C: "sé cuánto me deben, cuánto debo y cuánto tendré").

use crate::company::CompanySession;
use crate::inventory_ops::{date_ord, date_str};
use crate::sales_ops::{
    MAX_PRICE_MINOR, Payment, TimelineItem, local_today, log, method_code, method_label, opt_text,
    parse_date,
};
use crate::{AppError, AppResult};
use nucleo_db::finance::{
    self as db, AccountRow, AccountWrite, CategoryRow, DueRow, ExpenseRow, ExpenseWrite, LedgerRow,
    RecurringRow,
};
use nucleo_db::{core as dbcore, now_utc};
use rusqlite::{Connection, OptionalExtension};
use rust_decimal::Decimal;
use rust_decimal::prelude::ToPrimitive;
use serde::{Deserialize, Serialize};

/// Nombre, banco, referencia y fecha del saldo inicial ya validados.
type AccountFields = (String, Option<String>, Option<String>, Option<String>);

/// Semanas del flujo de caja proyectado.
pub const PROJECTION_WEEKS: i64 = 13;

/* ───────────────────────────── Tipos de la interfaz ───────────────────────────── */

#[derive(Debug, Clone, Deserialize)]
pub struct AccountInput {
    pub kind: String,
    pub name: String,
    pub bank_name: Option<String>,
    pub account_label: Option<String>,
    pub opening_minor: i64,
    pub opening_date: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MoneyTransferInput {
    pub from_uid: String,
    pub to_uid: String,
    pub date: String,
    pub amount_minor: i64,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ExpenseInput {
    pub category_id: i64,
    pub supplier_uid: Option<String>,
    pub date: String,
    pub description: String,
    pub total_minor: i64,
    /// El total incluye IVA (se separa con la tasa del negocio, solo informativo).
    pub tax_included: bool,
    pub due_date: Option<String>,
    /// Medio de pago si ya se pagó.
    pub paid_method: Option<String>,
    pub paid_account_uid: Option<String>,
    pub notes: Option<String>,
    pub recurring_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExpenseSummary {
    pub uid: String,
    pub number: String,
    pub date: String,
    pub due_date: Option<String>,
    pub category: String,
    pub supplier_name: Option<String>,
    pub description: String,
    pub total_minor: i64,
    pub paid_minor: i64,
    pub status: String,
    pub payment_state: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExpenseDetail {
    #[serde(flatten)]
    pub summary: ExpenseSummary,
    pub supplier_uid: Option<String>,
    pub net_minor: i64,
    pub tax_minor: i64,
    pub payments: Vec<Payment>,
    pub void_reason: Option<String>,
    pub notes: Option<String>,
    pub timeline: Vec<TimelineItem>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct ExpenseFilter {
    pub query: Option<String>,
    pub from: Option<String>,
    pub to: Option<String>,
    pub include_void: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RecurringInput {
    pub id: Option<i64>,
    pub direction: String,
    pub description: String,
    pub category_id: Option<i64>,
    pub amount_minor: i64,
    pub frequency: String,
    pub day_of_period: Option<i64>,
    pub starts_on: String,
    pub ends_on: Option<String>,
    pub active: bool,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct Aging {
    pub current_minor: i64,
    pub d1_30_minor: i64,
    pub d31_60_minor: i64,
    pub d61_90_minor: i64,
    pub d90_plus_minor: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct WeekFlow {
    pub start: String,
    pub end: String,
    pub opening_minor: i64,
    pub inflow_minor: i64,
    pub outflow_minor: i64,
    pub closing_minor: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct CalendarItem {
    pub date: String,
    /// "cobro", "pago", "ingreso_recurrente" o "egreso_recurrente".
    pub kind: String,
    pub label: String,
    pub party: String,
    pub amount_minor: i64,
    pub link: Option<String>,
    pub overdue: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct MoneyOverview {
    pub today: String,
    pub accounts: Vec<AccountRow>,
    pub cash_minor: i64,
    pub receivable_minor: i64,
    pub receivable_overdue_minor: i64,
    pub receivable_aging: Aging,
    pub payable_minor: i64,
    pub payable_overdue_minor: i64,
    pub payable_aging: Aging,
    pub next30_in_minor: i64,
    pub next30_out_minor: i64,
    /// Saldo proyectado a 30 días (disponible + cobros − pagos esperados).
    pub in30_minor: i64,
    pub projection: Vec<WeekFlow>,
    /// Semana con el saldo más bajo, si es negativo (alerta de caja).
    pub shortfall_week: Option<String>,
    pub lowest_minor: i64,
    pub receivables: Vec<DueRow>,
    pub payables: Vec<DueRow>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DashboardData {
    pub today_sales_minor: i64,
    pub today_sales_count: i64,
    pub month_sales_minor: i64,
    pub month_prev_sales_minor: i64,
    pub month_expenses_minor: i64,
    pub month_profit_minor: i64,
    pub receivable_minor: i64,
    pub receivable_overdue_minor: i64,
    pub payable_minor: i64,
    pub cash_minor: i64,
    pub tax_estimate_minor: Option<i64>,
    pub low_stock: Vec<LowStock>,
    pub pending_documentation: i64,
    pub upcoming_payments: Vec<Upcoming>,
    pub series: Vec<MonthSales>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LowStock {
    pub uid: String,
    pub name: String,
    pub on_hand_milli: i64,
    pub min_milli: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Upcoming {
    pub label: String,
    pub date: String,
    pub amount_minor: i64,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct MonthSales {
    pub month: String,
    pub sales_minor: i64,
}

/* ───────────────────────────── Auxiliares ───────────────────────────── */

/// Cuenta para un cobro o pago: la indicada, o la sugerida por el medio (se crea "Caja" si no hay).
pub(crate) fn account_for(
    conn: &Connection,
    uid: Option<&str>,
    method: &str,
    now: &str,
) -> AppResult<i64> {
    if let Some(u) = uid.filter(|u| !u.is_empty()) {
        let a = db::account_by_uid(conn, u)?
            .ok_or_else(|| AppError::NotFound("la cuenta de dinero".into()))?;
        if a.archived {
            return Err(AppError::Validation(format!(
                "la cuenta {} está archivada",
                a.name
            )));
        }
        return Ok(a.id);
    }
    match db::account_for_method(conn, method)? {
        Some(id) => Ok(id),
        None => Ok(nucleo_db::sales::default_cash_account(conn, now)?),
    }
}

fn aging_add(a: &mut Aging, days_overdue: i64, amount: i64) {
    match days_overdue {
        d if d <= 0 => a.current_minor += amount,
        1..=30 => a.d1_30_minor += amount,
        31..=60 => a.d31_60_minor += amount,
        61..=90 => a.d61_90_minor += amount,
        _ => a.d90_plus_minor += amount,
    }
}

/// Fechas en que ocurre un recurrente entre `from` y `to` (días julianos, inclusive).
pub fn occurrences(r: &RecurringRow, from: i64, to: i64) -> Vec<i64> {
    let fmt = time::macros::format_description!("[year]-[month]-[day]");
    let Ok(start) = time::Date::parse(&r.starts_on, &fmt) else {
        return Vec::new();
    };
    let end = r
        .ends_on
        .as_deref()
        .and_then(date_ord)
        .unwrap_or(i64::MAX)
        .min(to);
    let mut out = Vec::new();
    if r.frequency == "semanal" {
        let mut d = start.to_julian_day() as i64;
        while d <= end {
            if d >= from {
                out.push(d);
            }
            d += 7;
        }
        return out;
    }
    let step: i32 = match r.frequency.as_str() {
        "bimestral" => 2,
        "trimestral" => 3,
        "anual" => 12,
        _ => 1,
    };
    let day = r.day_of_period.unwrap_or(start.day() as i64).clamp(1, 31) as u8;
    let (mut y, mut m) = (start.year(), start.month() as i32);
    for _ in 0..600 {
        let month = time::Month::try_from(m as u8).unwrap_or(time::Month::January);
        let last = month.length(y);
        if let Ok(d) = time::Date::from_calendar_date(y, month, day.min(last)) {
            let j = d.to_julian_day() as i64;
            if j > end {
                break;
            }
            if j >= from && j >= start.to_julian_day() as i64 {
                out.push(j);
            }
        }
        m += step;
        while m > 12 {
            m -= 12;
            y += 1;
        }
    }
    out
}

fn expense_summary(g: &ExpenseRow) -> ExpenseSummary {
    let state = if g.status == "anulado" {
        "anulado"
    } else if g.paid_minor >= g.total_minor {
        "pagado"
    } else if g.paid_minor > 0 {
        "abonado"
    } else {
        "por_pagar"
    };
    ExpenseSummary {
        uid: g.uid.clone(),
        number: g.number.clone(),
        date: g.date.clone(),
        due_date: g.due_date.clone(),
        category: g.category.clone(),
        supplier_name: g.supplier_name.clone(),
        description: g.description.clone(),
        total_minor: g.total_minor,
        paid_minor: g.paid_minor,
        status: g.status.clone(),
        payment_state: state.into(),
    }
}

impl CompanySession {
    /* ───────────── Cuentas de dinero ───────────── */

    pub fn money_accounts(&self) -> AppResult<Vec<AccountRow>> {
        self.require("dinero.ver")?;
        Ok(db::accounts(self.db.conn())?)
    }

    fn account_fields(input: &AccountInput) -> AppResult<AccountFields> {
        if !matches!(input.kind.as_str(), "caja" | "banco" | "billetera") {
            return Err(AppError::Validation("tipo de cuenta no válido".into()));
        }
        let name = input.name.trim();
        if name.is_empty() || name.chars().count() > 80 {
            return Err(AppError::Validation(
                "el nombre de la cuenta es obligatorio (hasta 80 caracteres)".into(),
            ));
        }
        if input.opening_minor.abs() > MAX_PRICE_MINOR {
            return Err(AppError::Validation("el saldo inicial no es válido".into()));
        }
        let date = match input.opening_date.as_deref().filter(|d| !d.is_empty()) {
            Some(d) => Some(parse_date("la fecha del saldo inicial", d)?),
            None => None,
        };
        // Nunca se guardan números de tarjeta: solo una referencia libre (ej. "Cta. corriente …1234").
        let label = opt_text(&input.account_label, 60, "la referencia")?;
        if label
            .as_ref()
            .is_some_and(|l| l.chars().filter(|c| c.is_ascii_digit()).count() > 8)
        {
            return Err(AppError::Validation(
                "por seguridad anota solo los últimos 4 dígitos de la cuenta, no el número completo".into(),
            ));
        }
        Ok((
            name.to_string(),
            opt_text(&input.bank_name, 60, "el banco")?,
            label,
            date,
        ))
    }

    pub fn create_money_account(&mut self, input: &AccountInput) -> AppResult<Vec<AccountRow>> {
        self.require("dinero.registrar")?;
        let (name, bank, label, date) = Self::account_fields(input)?;
        let now = now_utc();
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        let uid = uuid::Uuid::now_v7().to_string();
        db::insert_account(
            &tx,
            &uid,
            &AccountWrite {
                kind: &input.kind,
                name: &name,
                bank_name: bank.as_deref(),
                account_label: label.as_deref(),
                opening_minor: input.opening_minor,
                opening_date: date.as_deref(),
            },
            &now,
        )?;
        log(
            &tx,
            &user,
            "cuenta.crear",
            "cuenta",
            &uid,
            &format!("Cuenta {name} creada"),
            None,
        )?;
        tx.commit()?;
        self.money_accounts()
    }

    pub fn update_money_account(
        &mut self,
        uid: &str,
        input: &AccountInput,
    ) -> AppResult<Vec<AccountRow>> {
        self.require("dinero.registrar")?;
        let a = db::account_by_uid(self.db.conn(), uid)?
            .ok_or_else(|| AppError::NotFound("la cuenta".into()))?;
        let (name, bank, label, date) = Self::account_fields(input)?;
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        db::update_account(
            &tx,
            a.id,
            &AccountWrite {
                kind: &input.kind,
                name: &name,
                bank_name: bank.as_deref(),
                account_label: label.as_deref(),
                opening_minor: input.opening_minor,
                opening_date: date.as_deref(),
            },
        )?;
        let text = if a.opening_minor != input.opening_minor {
            format!(
                "Cuenta {name} modificada (saldo inicial {} → {})",
                a.opening_minor, input.opening_minor
            )
        } else {
            format!("Cuenta {name} modificada")
        };
        log(&tx, &user, "cuenta.editar", "cuenta", uid, &text, None)?;
        tx.commit()?;
        self.money_accounts()
    }

    pub fn archive_money_account(&mut self, uid: &str) -> AppResult<Vec<AccountRow>> {
        self.require("dinero.registrar")?;
        let a = db::account_by_uid(self.db.conn(), uid)?
            .ok_or_else(|| AppError::NotFound("la cuenta".into()))?;
        if a.balance_minor != 0 {
            return Err(AppError::Validation(
                "la cuenta tiene saldo: traspásalo a otra cuenta antes de archivarla".into(),
            ));
        }
        let now = now_utc();
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        db::archive_account(&tx, a.id, &now)?;
        log(
            &tx,
            &user,
            "cuenta.archivar",
            "cuenta",
            uid,
            &format!("Cuenta {} archivada", a.name),
            None,
        )?;
        tx.commit()?;
        self.money_accounts()
    }

    pub fn account_ledger(&self, uid: &str) -> AppResult<Vec<LedgerRow>> {
        self.require("dinero.ver")?;
        let a = db::account_by_uid(self.db.conn(), uid)?
            .ok_or_else(|| AppError::NotFound("la cuenta".into()))?;
        Ok(db::ledger(self.db.conn(), a.id, 500)?)
    }

    pub fn transfer_money(&mut self, input: &MoneyTransferInput) -> AppResult<Vec<AccountRow>> {
        self.require("dinero.registrar")?;
        let from = db::account_by_uid(self.db.conn(), &input.from_uid)?
            .ok_or_else(|| AppError::NotFound("la cuenta de origen".into()))?;
        let to = db::account_by_uid(self.db.conn(), &input.to_uid)?
            .ok_or_else(|| AppError::NotFound("la cuenta de destino".into()))?;
        if from.id == to.id {
            return Err(AppError::Validation("elige cuentas distintas".into()));
        }
        if from.archived || to.archived {
            return Err(AppError::Validation(
                "una de las cuentas está archivada".into(),
            ));
        }
        if input.amount_minor <= 0 || input.amount_minor > MAX_PRICE_MINOR {
            return Err(AppError::Validation(
                "el monto debe ser mayor que cero".into(),
            ));
        }
        let date = parse_date("la fecha", &input.date)?;
        let notes = opt_text(&input.notes, 200, "la nota")?;
        let now = now_utc();
        let by = self.user_id();
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        let uid = uuid::Uuid::now_v7().to_string();
        db::insert_transfer(
            &tx,
            &uid,
            from.id,
            to.id,
            &date,
            input.amount_minor,
            notes.as_deref(),
            by,
            &now,
        )?;
        log(
            &tx,
            &user,
            "dinero.traspaso",
            "traspaso",
            &uid,
            &format!(
                "Traspaso de {} a {}: {}",
                from.name, to.name, input.amount_minor
            ),
            None,
        )?;
        tx.commit()?;
        self.money_accounts()
    }

    /* ───────────── Gastos ───────────── */

    pub fn expense_categories(&self) -> AppResult<Vec<CategoryRow>> {
        self.actor()?;
        Ok(db::categories(self.db.conn())?)
    }

    pub fn add_expense_category(&mut self, name: &str, fixed: bool) -> AppResult<Vec<CategoryRow>> {
        self.require("dinero.registrar")?;
        let name = name.trim();
        if name.is_empty() || name.chars().count() > 60 {
            return Err(AppError::Validation(
                "el nombre de la categoría es obligatorio (hasta 60 caracteres)".into(),
            ));
        }
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        let id = db::insert_category(&tx, name, if fixed { "fijo" } else { "variable" })?;
        log(
            &tx,
            &user,
            "gasto.categoria",
            "categoria",
            &id.to_string(),
            &format!("Categoría {name} creada"),
            None,
        )?;
        tx.commit()?;
        self.expense_categories()
    }

    pub fn list_expenses(&self, f: &ExpenseFilter) -> AppResult<Vec<ExpenseSummary>> {
        self.require("dinero.ver")?;
        Ok(db::list_expenses(
            self.db.conn(),
            f.query.as_deref().unwrap_or(""),
            f.from.as_deref(),
            f.to.as_deref(),
            f.include_void.unwrap_or(false),
            2000,
        )?
        .iter()
        .map(expense_summary)
        .collect())
    }

    pub fn expense(&self, uid: &str) -> AppResult<ExpenseDetail> {
        self.require("dinero.ver")?;
        let g = db::expense_by_uid(self.db.conn(), uid)?
            .ok_or_else(|| AppError::NotFound("ese gasto".into()))?;
        let payments = db::expense_payments(self.db.conn(), g.id)?
            .into_iter()
            .map(|(number, date, amount_minor, method)| Payment {
                number,
                date,
                amount_minor,
                method: method_label(&method).into(),
            })
            .collect();
        let mut stmt = self.db.conn().prepare(
            "SELECT ts_utc, json_extract(after_json, '$.texto') FROM audit_log WHERE entity = 'gasto' AND entity_id = ?1 ORDER BY id",
        )?;
        let timeline = stmt
            .query_map([&g.uid], |r| {
                Ok(TimelineItem {
                    at: r.get(0)?,
                    text: r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(ExpenseDetail {
            summary: expense_summary(&g),
            supplier_uid: g.supplier_uid.clone(),
            net_minor: g.net_minor,
            tax_minor: g.tax_minor,
            payments,
            void_reason: g.void_reason.clone(),
            notes: g.notes.clone(),
            timeline,
        })
    }

    pub fn register_expense(&mut self, input: &ExpenseInput) -> AppResult<ExpenseDetail> {
        self.require("dinero.registrar")?;
        let conn = self.db.conn();
        let cat = db::categories(conn)?
            .into_iter()
            .find(|c| c.id == input.category_id)
            .ok_or_else(|| AppError::NotFound("la categoría".into()))?;
        let supplier = match input.supplier_uid.as_deref().filter(|u| !u.is_empty()) {
            Some(u) => Some(
                nucleo_db::suppliers::by_uid(conn, u)?
                    .ok_or_else(|| AppError::NotFound("el proveedor".into()))?,
            ),
            None => None,
        };
        let description = input.description.trim();
        if description.is_empty() || description.chars().count() > 200 {
            return Err(AppError::Validation(
                "describe el gasto (hasta 200 caracteres)".into(),
            ));
        }
        if input.total_minor <= 0 || input.total_minor > MAX_PRICE_MINOR {
            return Err(AppError::Validation(
                "el monto debe ser mayor que cero".into(),
            ));
        }
        let date = parse_date("la fecha", &input.date)?;
        let due = match input.due_date.as_deref().filter(|d| !d.is_empty()) {
            Some(d) => parse_date("el vencimiento", d)?,
            None => date.clone(),
        };
        if due < date {
            return Err(AppError::Validation(
                "el vencimiento no puede ser anterior al gasto".into(),
            ));
        }
        let notes = opt_text(&input.notes, 1000, "las notas")?;
        // IVA incluido: se separa con la tasa vigente del negocio (informativo).
        let (net, tax) = match (input.tax_included, self.tax_ppm()?) {
            (true, Some(ppm)) => {
                let net = (Decimal::from(input.total_minor) * Decimal::from(1_000_000)
                    / Decimal::from(1_000_000 + ppm))
                .round()
                .to_i64()
                .unwrap_or(input.total_minor);
                (net, input.total_minor - net)
            }
            _ => (input.total_minor, 0),
        };
        let now = now_utc();
        let by = self.user_id();
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        let uid = uuid::Uuid::now_v7().to_string();
        let number = dbcore::take_number(&tx, "GAS")?;
        let id = db::insert_expense(
            &tx,
            &uid,
            &number,
            &ExpenseWrite {
                category_id: cat.id,
                supplier_id: supplier.as_ref().map(|s| s.id),
                date: &date,
                due_date: Some(&due),
                description,
                net_minor: net,
                tax_minor: tax,
                total_minor: input.total_minor,
                recurring_id: input.recurring_id,
                notes: notes.as_deref(),
            },
            by,
            &now,
        )?;
        let pay = db::insert_expense_payable(
            &tx,
            id,
            supplier.as_ref().map(|s| s.id),
            &due,
            input.total_minor,
        )?;
        log(
            &tx,
            &user,
            "gasto.registrar",
            "gasto",
            &uid,
            &format!("{number} registrado · {} · {description}", cat.name),
            None,
        )?;
        if let Some(m) = &input.paid_method {
            let code = method_code(m);
            let acc = account_for(&tx, input.paid_account_uid.as_deref(), code, &now)?;
            let pnum = dbcore::take_number(&tx, "EGR")?;
            db::insert_payable_payment(
                &tx,
                &uuid::Uuid::now_v7().to_string(),
                &pnum,
                supplier.as_ref().map(|s| s.id),
                acc,
                &date,
                code,
                input.total_minor,
                pay,
                by,
                &now,
            )?;
            log(
                &tx,
                &user,
                "gasto.pagar",
                "gasto",
                &uid,
                &format!("Pagado ({}) · {pnum}", method_label(code)),
                None,
            )?;
        } else {
            log(
                &tx,
                &user,
                "gasto.registrar",
                "gasto",
                &uid,
                &format!("Queda en Dinero que debes (vence {due})"),
                None,
            )?;
        }
        tx.commit()?;
        self.expense(&uid)
    }

    pub fn pay_expense(
        &mut self,
        uid: &str,
        amount_minor: i64,
        method: &str,
        date: &str,
        account_uid: Option<&str>,
    ) -> AppResult<ExpenseDetail> {
        self.require("dinero.registrar")?;
        let g = db::expense_by_uid(self.db.conn(), uid)?
            .ok_or_else(|| AppError::NotFound("ese gasto".into()))?;
        if g.status != "registrado" {
            return Err(AppError::Validation("el gasto está anulado".into()));
        }
        let due = g.total_minor - g.paid_minor;
        if amount_minor <= 0 || amount_minor > due {
            return Err(AppError::Validation(
                "el monto debe ser mayor que cero y no superar el saldo".into(),
            ));
        }
        let date = parse_date("la fecha del pago", date)?;
        let supplier_id = match g.supplier_uid.as_deref() {
            Some(u) => nucleo_db::suppliers::by_uid(self.db.conn(), u)?.map(|s| s.id),
            None => None,
        };
        let now = now_utc();
        let by = self.user_id();
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        let pay = db::open_payable_for_expense(&tx, g.id)?
            .ok_or_else(|| AppError::Validation("el gasto no tiene saldo por pagar".into()))?;
        let code = method_code(method);
        let acc = account_for(&tx, account_uid, code, &now)?;
        let pnum = dbcore::take_number(&tx, "EGR")?;
        db::insert_payable_payment(
            &tx,
            &uuid::Uuid::now_v7().to_string(),
            &pnum,
            supplier_id,
            acc,
            &date,
            code,
            amount_minor,
            pay,
            by,
            &now,
        )?;
        let text = if amount_minor == due {
            "Pago final"
        } else {
            "Abono"
        };
        log(
            &tx,
            &user,
            "gasto.pagar",
            "gasto",
            uid,
            &format!("{text} ({}) · {pnum}", method_label(code)),
            None,
        )?;
        tx.commit()?;
        self.expense(uid)
    }

    pub fn void_expense(&mut self, uid: &str, reason: &str) -> AppResult<ExpenseDetail> {
        self.require("dinero.registrar")?;
        let reason = reason.trim();
        if reason.is_empty() || reason.chars().count() > 500 {
            return Err(AppError::Validation(
                "escribe el motivo de la anulación".into(),
            ));
        }
        let g = db::expense_by_uid(self.db.conn(), uid)?
            .ok_or_else(|| AppError::NotFound("ese gasto".into()))?;
        if g.status == "anulado" {
            return Err(AppError::Validation("el gasto ya está anulado".into()));
        }
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        let n = db::void_expense_payments(&tx, g.id, &format!("Gasto anulado: {reason}"))?;
        db::void_expense(&tx, g.id, reason)?;
        log(
            &tx,
            &user,
            "gasto.anular",
            "gasto",
            uid,
            &format!("Anulado: {reason}"),
            Some(reason),
        )?;
        if n > 0 {
            log(
                &tx,
                &user,
                "gasto.anular",
                "gasto",
                uid,
                "Pagos anulados: el dinero vuelve a la cuenta",
                None,
            )?;
        }
        tx.commit()?;
        self.expense(uid)
    }

    /* ───────────── Recurrentes ───────────── */

    pub fn recurring(&self) -> AppResult<Vec<RecurringRow>> {
        self.require("dinero.ver")?;
        Ok(db::recurring(self.db.conn())?)
    }

    pub fn save_recurring(&mut self, input: &RecurringInput) -> AppResult<Vec<RecurringRow>> {
        self.require("dinero.registrar")?;
        if !matches!(input.direction.as_str(), "ingreso" | "egreso") {
            return Err(AppError::Validation(
                "indica si es un ingreso o un egreso".into(),
            ));
        }
        if !matches!(
            input.frequency.as_str(),
            "semanal" | "mensual" | "bimestral" | "trimestral" | "anual"
        ) {
            return Err(AppError::Validation("frecuencia no válida".into()));
        }
        let description = input.description.trim();
        if description.is_empty() || description.chars().count() > 120 {
            return Err(AppError::Validation(
                "describe el movimiento (hasta 120 caracteres)".into(),
            ));
        }
        if input.amount_minor <= 0 || input.amount_minor > MAX_PRICE_MINOR {
            return Err(AppError::Validation(
                "el monto debe ser mayor que cero".into(),
            ));
        }
        if input.day_of_period.is_some_and(|d| !(1..=31).contains(&d)) {
            return Err(AppError::Validation(
                "el día debe estar entre 1 y 31".into(),
            ));
        }
        let starts = parse_date("la fecha de inicio", &input.starts_on)?;
        let ends = match input.ends_on.as_deref().filter(|d| !d.is_empty()) {
            Some(d) => Some(parse_date("la fecha de término", d)?),
            None => None,
        };
        if ends.as_deref().is_some_and(|e| e < starts.as_str()) {
            return Err(AppError::Validation(
                "la fecha de término es anterior al inicio".into(),
            ));
        }
        let now = now_utc();
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        let id = db::save_recurring(
            &tx,
            input.id,
            &input.direction,
            description,
            input.category_id,
            input.amount_minor,
            &input.frequency,
            input.day_of_period,
            &starts,
            ends.as_deref(),
            input.active,
            &now,
        )?;
        log(
            &tx,
            &user,
            "recurrente.guardar",
            "recurrente",
            &id.to_string(),
            &format!("Recurrente: {description}"),
            None,
        )?;
        tx.commit()?;
        self.recurring()
    }

    /* ───────────── Resumen, calendario y flujo de caja ───────────── */

    pub fn money_overview(&self) -> AppResult<MoneyOverview> {
        self.require("dinero.ver")?;
        let conn = self.db.conn();
        let today_s = local_today(conn)?;
        let today = date_ord(&today_s).unwrap_or(0);
        let accounts = db::accounts(conn)?;
        let cash: i64 = accounts
            .iter()
            .filter(|a| !a.archived)
            .map(|a| a.balance_minor)
            .sum();
        let receivables = db::open_receivables(conn)?;
        let payables = db::open_payables(conn)?;
        let mut r_aging = Aging::default();
        let mut p_aging = Aging::default();
        let (mut r_total, mut r_over, mut p_total, mut p_over) = (0, 0, 0, 0);
        for r in &receivables {
            let late = today - date_ord(&r.due_date).unwrap_or(today);
            aging_add(&mut r_aging, late, r.pending_minor);
            r_total += r.pending_minor;
            if late > 0 {
                r_over += r.pending_minor;
            }
        }
        for p in &payables {
            let late = today - date_ord(&p.due_date).unwrap_or(today);
            aging_add(&mut p_aging, late, p.pending_minor);
            p_total += p.pending_minor;
            if late > 0 {
                p_over += p.pending_minor;
            }
        }
        let items = self.flow_items(today, today + PROJECTION_WEEKS * 7 - 1)?;
        let mut projection = Vec::new();
        let mut balance = cash;
        let mut lowest = cash;
        let mut lowest_week = None;
        for w in 0..PROJECTION_WEEKS {
            let (a, b) = (today + w * 7, today + w * 7 + 6);
            let inflow: i64 = items
                .iter()
                .filter(|i| (a..=b).contains(&i.0) && i.1 > 0)
                .map(|i| i.1)
                .sum();
            let outflow: i64 = -items
                .iter()
                .filter(|i| (a..=b).contains(&i.0) && i.1 < 0)
                .map(|i| i.1)
                .sum::<i64>();
            let opening = balance;
            balance += inflow - outflow;
            if balance < lowest {
                lowest = balance;
                lowest_week = Some(date_str(a));
            }
            projection.push(WeekFlow {
                start: date_str(a),
                end: date_str(b),
                opening_minor: opening,
                inflow_minor: inflow,
                outflow_minor: outflow,
                closing_minor: balance,
            });
        }
        let in30: i64 = items
            .iter()
            .filter(|i| i.0 <= today + 29 && i.1 > 0)
            .map(|i| i.1)
            .sum();
        let out30: i64 = -items
            .iter()
            .filter(|i| i.0 <= today + 29 && i.1 < 0)
            .map(|i| i.1)
            .sum::<i64>();
        Ok(MoneyOverview {
            today: today_s,
            accounts,
            cash_minor: cash,
            receivable_minor: r_total,
            receivable_overdue_minor: r_over,
            receivable_aging: r_aging,
            payable_minor: p_total,
            payable_overdue_minor: p_over,
            payable_aging: p_aging,
            next30_in_minor: in30,
            next30_out_minor: out30,
            in30_minor: cash + in30 - out30,
            projection,
            shortfall_week: if lowest < 0 { lowest_week } else { None },
            lowest_minor: lowest,
            receivables,
            payables,
        })
    }

    /// Flujos esperados (día juliano, monto con signo): vencimientos abiertos (los vencidos se
    /// cuentan hoy) y recurrentes activos que aún no se registraron en ese período.
    fn flow_items(&self, from: i64, to: i64) -> AppResult<Vec<(i64, i64)>> {
        Ok(self
            .calendar_items(from, to)?
            .iter()
            .map(|c| {
                let d = date_ord(&c.date).unwrap_or(from).max(from);
                let sign = if c.kind == "cobro" || c.kind == "ingreso_recurrente" {
                    1
                } else {
                    -1
                };
                (d, sign * c.amount_minor)
            })
            .collect())
    }

    fn calendar_items(&self, from: i64, to: i64) -> AppResult<Vec<CalendarItem>> {
        let conn = self.db.conn();
        let today = date_ord(&local_today(conn)?).unwrap_or(from);
        let mut out = Vec::new();
        for r in db::open_receivables(conn)?
            .into_iter()
            .chain(db::open_payables(conn)?)
        {
            let d = date_ord(&r.due_date).unwrap_or(today);
            if d > to {
                continue;
            }
            out.push(CalendarItem {
                date: r.due_date.clone(),
                kind: r.kind.clone(),
                label: r.document.clone(),
                party: r.party.clone(),
                amount_minor: r.pending_minor,
                link: Some(r.link.clone()),
                overdue: d < today,
            });
        }
        for rec in db::recurring(conn)?.into_iter().filter(|r| r.active) {
            for d in occurrences(&rec, from, to) {
                if rec.direction == "egreso"
                    && self.recurring_registered(conn, rec.id, d, &rec.frequency)?
                {
                    continue;
                }
                out.push(CalendarItem {
                    date: date_str(d),
                    kind: if rec.direction == "ingreso" {
                        "ingreso_recurrente"
                    } else {
                        "egreso_recurrente"
                    }
                    .into(),
                    label: rec.description.clone(),
                    party: rec.category.clone().unwrap_or_else(|| "Recurrente".into()),
                    amount_minor: rec.amount_minor,
                    link: None,
                    overdue: false,
                });
            }
        }
        out.sort_by(|a, b| a.date.cmp(&b.date));
        Ok(out)
    }

    /// ¿Ya se registró un gasto de este recurrente cerca de la fecha de la ocurrencia?
    fn recurring_registered(
        &self,
        conn: &Connection,
        id: i64,
        day: i64,
        frequency: &str,
    ) -> AppResult<bool> {
        let half = if frequency == "semanal" { 3 } else { 15 };
        let (a, b) = (date_str(day - half), date_str(day + half));
        Ok(conn
            .query_row(
                "SELECT 1 FROM expenses WHERE recurring_schedule_id = ?1 AND status = 'registrado' AND expense_date BETWEEN ?2 AND ?3 LIMIT 1",
                (id, a, b),
                |r| r.get::<_, i64>(0),
            )
            .optional()?
            .is_some())
    }

    /// Calendario de cobros, pagos y recurrentes (incluye lo vencido) para los próximos días.
    pub fn money_calendar(&self, days: i64) -> AppResult<Vec<CalendarItem>> {
        self.require("dinero.ver")?;
        let today = date_ord(&local_today(self.db.conn())?).unwrap_or(0);
        self.calendar_items(today, today + days.clamp(1, 366) - 1)
    }

    /* ───────────── Resumen del dueño ───────────── */

    pub fn dashboard(&self) -> AppResult<DashboardData> {
        self.actor()?;
        let conn = self.db.conn();
        let today = local_today(conn)?;
        let t = date_ord(&today).unwrap_or(0);
        let month_start = format!("{}-01", &today[..7]);
        let ms = date_ord(&month_start).unwrap_or(t);
        let prev_end = date_str(ms - 1);
        let prev_start = format!("{}-01", &prev_end[..7]);
        let sales = self.can("ventas.ver");
        let money = self.can("dinero.ver");
        let costs = self.can("costos.ver");
        let q = |sql: &str, p: &[&dyn rusqlite::ToSql]| -> AppResult<i64> {
            Ok(conn
                .query_row(sql, p, |r| r.get::<_, Option<i64>>(0))?
                .unwrap_or(0))
        };
        const LIVE: &str = "commercial_state IN ('efectuada', 'cerrada')";
        let (today_sales, today_count, month_sales, prev_sales) = if sales {
            (
                q(
                    &format!("SELECT sum(total_minor) FROM sales WHERE {LIVE} AND issue_date = ?1"),
                    &[&today],
                )?,
                q(
                    &format!("SELECT count(*) FROM sales WHERE {LIVE} AND issue_date = ?1"),
                    &[&today],
                )?,
                q(
                    &format!(
                        "SELECT sum(total_minor) FROM sales WHERE {LIVE} AND issue_date >= ?1"
                    ),
                    &[&month_start],
                )?,
                q(
                    &format!(
                        "SELECT sum(total_minor) FROM sales WHERE {LIVE} AND issue_date BETWEEN ?1 AND ?2"
                    ),
                    &[&prev_start, &prev_end],
                )?,
            )
        } else {
            (0, 0, 0, 0)
        };
        let month_expenses = if money {
            q(
                "SELECT sum(net_minor) FROM expenses WHERE status = 'registrado' AND expense_date >= ?1",
                &[&month_start],
            )?
        } else {
            0
        };
        let profit = if costs && sales {
            q(
                &format!(
                    "SELECT sum(net_minor + exempt_minor - cost_minor) FROM sales WHERE {LIVE} AND issue_date >= ?1"
                ),
                &[&month_start],
            )? - month_expenses
        } else {
            0
        };
        let tax = if sales && money && self.tax_ppm()?.is_some() {
            Some(
                q(
                    &format!("SELECT sum(tax_minor) FROM sales WHERE {LIVE} AND issue_date >= ?1"),
                    &[&month_start],
                )? - q(
                    "SELECT sum(tax_minor) FROM purchases WHERE status = 'registrada' AND issue_date >= ?1",
                    &[&month_start],
                )? - q(
                    "SELECT sum(tax_minor) FROM expenses WHERE status = 'registrado' AND expense_date >= ?1",
                    &[&month_start],
                )?,
            )
        } else {
            None
        };
        let (mut rec, mut rec_over, mut pay, mut cash) = (0, 0, 0, 0);
        let mut upcoming = Vec::new();
        if money {
            cash = db::accounts(conn)?
                .iter()
                .filter(|a| !a.archived)
                .map(|a| a.balance_minor)
                .sum();
            let mut dues: Vec<DueRow> = db::open_receivables(conn)?;
            for r in &dues {
                rec += r.pending_minor;
                if r.due_date < today {
                    rec_over += r.pending_minor;
                }
            }
            let payables = db::open_payables(conn)?;
            pay = payables.iter().map(|p| p.pending_minor).sum();
            dues.extend(payables);
            dues.retain(|d| d.due_date >= today);
            dues.sort_by(|a, b| a.due_date.cmp(&b.due_date));
            upcoming = dues
                .into_iter()
                .take(6)
                .map(|d| Upcoming {
                    label: format!("{} · {}", d.document, d.party),
                    date: d.due_date,
                    amount_minor: d.pending_minor,
                    kind: d.kind,
                })
                .collect();
        }
        let low_stock = if self.can("inventario.ver") || self.can("productos.ver") {
            let mut stmt = conn.prepare(
                "SELECT p.uid, p.name, coalesce((SELECT sum(on_hand_milli) FROM stock_balances b WHERE b.product_id = p.id), 0) AS q, p.min_stock_milli
                 FROM products p WHERE p.track_stock = 1 AND p.archived_at IS NULL AND p.min_stock_milli > 0
                   AND coalesce((SELECT sum(on_hand_milli) FROM stock_balances b WHERE b.product_id = p.id), 0) <= p.min_stock_milli
                 ORDER BY q - p.min_stock_milli LIMIT 20",
            )?;
            stmt.query_map([], |r| {
                Ok(LowStock {
                    uid: r.get(0)?,
                    name: r.get(1)?,
                    on_hand_milli: r.get(2)?,
                    min_milli: r.get(3)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?
        } else {
            Vec::new()
        };
        let pending_doc = if sales {
            q(
                "SELECT count(*) FROM sales WHERE documentation_state = 'pendiente' AND commercial_state <> 'anulada'",
                &[],
            )?
        } else {
            0
        };
        let mut series = Vec::new();
        let (mut y, mut m): (i32, i32) = (
            today[..4].parse().unwrap_or(2026),
            today[5..7].parse().unwrap_or(1),
        );
        let mut months = Vec::new();
        for _ in 0..12 {
            months.push(format!("{y:04}-{m:02}"));
            m -= 1;
            if m == 0 {
                m = 12;
                y -= 1;
            }
        }
        months.reverse();
        for ym in months {
            let v = if sales {
                q(
                    &format!(
                        "SELECT sum(total_minor) FROM sales WHERE {LIVE} AND substr(issue_date, 1, 7) = ?1"
                    ),
                    &[&ym],
                )?
            } else {
                0
            };
            series.push(MonthSales {
                month: ym,
                sales_minor: v,
            });
        }
        Ok(DashboardData {
            today_sales_minor: today_sales,
            today_sales_count: today_count,
            month_sales_minor: month_sales,
            month_prev_sales_minor: prev_sales,
            month_expenses_minor: month_expenses,
            month_profit_minor: profit,
            receivable_minor: rec,
            receivable_overdue_minor: rec_over,
            payable_minor: pay,
            cash_minor: cash,
            tax_estimate_minor: tax,
            low_stock,
            pending_documentation: pending_doc,
            upcoming_payments: upcoming,
            series,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rec(freq: &str, starts: &str, day: Option<i64>) -> RecurringRow {
        RecurringRow {
            id: 1,
            direction: "egreso".into(),
            description: "x".into(),
            category_id: None,
            category: None,
            amount_minor: 1,
            frequency: freq.into(),
            day_of_period: day,
            starts_on: starts.into(),
            ends_on: None,
            active: true,
        }
    }

    #[test]
    fn ocurrencias_de_recurrentes() {
        let from = date_ord("2026-10-01").unwrap();
        let to = date_ord("2026-12-31").unwrap();
        let m: Vec<String> = occurrences(&rec("mensual", "2026-01-31", None), from, to)
            .into_iter()
            .map(date_str)
            .collect();
        assert_eq!(
            m,
            ["2026-10-31", "2026-11-30", "2026-12-31"],
            "día 31 se ajusta al último día del mes"
        );
        let t: Vec<String> = occurrences(&rec("trimestral", "2026-04-05", Some(5)), from, to)
            .into_iter()
            .map(date_str)
            .collect();
        assert_eq!(t, ["2026-10-05"]);
        assert_eq!(
            occurrences(
                &rec("semanal", "2026-10-02", None),
                from,
                date_ord("2026-10-20").unwrap()
            )
            .len(),
            3
        );
        assert!(occurrences(&rec("anual", "2027-01-01", None), from, to).is_empty());
    }
}
