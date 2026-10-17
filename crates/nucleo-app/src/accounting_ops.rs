//! Contabilidad automática (Fase 10): plan de cuentas editable, asientos calculados desde los
//! documentos (ventas, cobros, compras, pagos, gastos, inventario, importaciones, traspasos y
//! remuneraciones), asientos manuales, cierre y reapertura de meses, y los libros (diario, mayor,
//! balance de comprobación, estado de resultados y balance general).
//!
//! Mientras un mes está abierto, sus asientos automáticos se calculan al vuelo desde los documentos:
//! siempre cuadran con lo registrado. Al cerrarlo se guardan en `journal_entries` y quedan fijos; si
//! después aparece un documento con fecha de ese mes, el cierre avisa la diferencia (D-F10-04).

use crate::company::CompanySession;
use crate::inventory_ops::{date_ord, date_str};
use crate::sales_ops::{local_today, log, parse_date};
use crate::{AppError, AppResult};
use nucleo_db::{core as dbcore, now_utc};
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};

/* ───────────────────────────── Tipos ───────────────────────────── */

#[derive(Debug, Clone, Serialize)]
pub struct LedgerAccount {
    pub code: String,
    pub name: String,
    pub simple_name: Option<String>,
    /// "activo", "pasivo", "patrimonio", "ingreso" o "gasto".
    pub nature: String,
    pub postable: bool,
    pub parent_code: Option<String>,
    pub archived: bool,
    pub level: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LedgerAccountInput {
    /// Cuenta existente a renombrar; vacío para crear una subcuenta.
    pub code: Option<String>,
    /// Cuenta madre de la subcuenta nueva.
    pub parent_code: Option<String>,
    pub name: String,
    pub simple_name: Option<String>,
}

/// Qué cuenta recibe cada concepto de los asientos automáticos.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct AccountingMap {
    /// concepto → código de cuenta (ej. "caja" → "1.1.01").
    pub concepts: BTreeMap<String, String>,
    /// grupo de categorías de gastos → código de cuenta.
    pub groups: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct EntryLine {
    pub account_code: String,
    pub account_name: String,
    pub debit_minor: i64,
    pub credit_minor: i64,
    pub memo: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct JournalEntry {
    /// Identificador estable: uid del asiento guardado o "auto:<tipo>:<id>".
    pub key: String,
    pub date: String,
    /// Documento de origen (ej. "VEN-000012") o número del asiento manual.
    pub reference: String,
    pub description: String,
    /// "automatico", "manual" o "apertura".
    pub origin: String,
    pub source_type: Option<String>,
    pub link: Option<String>,
    /// "calculado" (mes abierto), "contabilizado" o "reversado".
    pub status: String,
    pub lines: Vec<EntryLine>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ManualLineInput {
    pub account_code: String,
    pub debit_minor: i64,
    pub credit_minor: i64,
    pub memo: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ManualEntryInput {
    pub date: String,
    pub description: String,
    pub lines: Vec<ManualLineInput>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PeriodRow {
    /// "AAAA-MM".
    pub period: String,
    /// "abierto" o "cerrado".
    pub status: String,
    pub entries: i64,
    pub debit_minor: i64,
    /// Mes cerrado cuyos documentos cambiaron después del cierre (el total calculado hoy difiere).
    pub changed: bool,
    pub current_debit_minor: i64,
    pub closed_at: Option<String>,
    pub closed_by: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TrialRow {
    pub code: String,
    pub name: String,
    pub simple_name: Option<String>,
    pub nature: String,
    pub debit_minor: i64,
    pub credit_minor: i64,
    /// Saldo deudor (+) o acreedor (−).
    pub balance_minor: i64,
}

/* ───────────────────────────── Cuentas por defecto ───────────────────────────── */

/// Conceptos de los asientos automáticos: (clave, cuenta por defecto, descripción).
pub const CONCEPTS: &[(&str, &str, &str)] = &[
    (
        "caja",
        "1.1.01",
        "Cobros y pagos en efectivo (cuentas tipo caja)",
    ),
    (
        "bancos",
        "1.1.02",
        "Cobros y pagos por banco o billetera digital",
    ),
    ("clientes", "1.1.03", "Ventas por cobrar"),
    (
        "iva_credito",
        "1.1.04",
        "IVA de compras, gastos e importaciones",
    ),
    ("mercaderias", "1.1.05", "Inventario"),
    (
        "importaciones",
        "1.1.06",
        "Costos de importación hasta recibir",
    ),
    ("proveedores", "2.1.01", "Compras e importaciones por pagar"),
    ("acreedores", "2.1.02", "Gastos por pagar"),
    ("iva_debito", "2.1.03", "IVA de ventas"),
    (
        "rem_por_pagar",
        "2.1.04",
        "Líquido a pagar de las liquidaciones",
    ),
    (
        "retenciones",
        "2.1.05",
        "Imposiciones, impuesto único y aportes del empleador",
    ),
    (
        "capital",
        "3.1.01",
        "Saldos iniciales de caja, bancos y stock",
    ),
    (
        "aportes",
        "3.1.02",
        "Stock agregado sin compra («Agregar stock»)",
    ),
    ("ventas", "4.1.01", "Ventas netas"),
    ("sobrantes", "4.2.01", "Ajustes de inventario a favor"),
    ("costo_ventas", "5.1.01", "Costo de lo vendido"),
    ("mermas", "5.1.02", "Ajustes de inventario en contra"),
    (
        "remuneraciones",
        "5.2.01",
        "Costo de las liquidaciones y gastos de remuneraciones",
    ),
    (
        "compras_otros",
        "5.2.99",
        "Compras de servicios o productos sin stock",
    ),
    ("otros_gastos", "5.2.99", "Gastos sin cuenta propia"),
];

const DEFAULT_GROUPS: &[(&str, &str)] = &[
    ("Vehículo y transporte", "5.2.02"),
    ("Viajes y comidas", "5.2.03"),
    ("Local y oficina", "5.2.04"),
    ("Personas y estudios", "5.2.05"),
    ("Ventas y publicidad", "5.2.06"),
    ("Operación", "5.2.07"),
    ("Servicios", "5.2.08"),
    ("Impuestos y finanzas", "5.2.09"),
];

fn fx(amount: i64, currency: &str, rate_e6: Option<i64>) -> i64 {
    match rate_e6 {
        Some(r) if currency != "CLP" => ((amount as i128 * r as i128 + 500_000) / 1_000_000) as i64,
        _ => amount,
    }
}

/// Valor de movimientos de stock: Σ cantidad (milésimas) × costo (e4) → pesos.
fn stock_value(sum_e7: i64) -> i64 {
    ((sum_e7 as i128 + 5_000_000) / 10_000_000) as i64
}

fn period_bounds(p: &str) -> AppResult<(String, String)> {
    let ok = p.len() == 7
        && p[..4].chars().all(|c| c.is_ascii_digit())
        && &p[4..5] == "-"
        && p[5..].parse::<u32>().is_ok_and(|m| (1..=12).contains(&m));
    if !ok {
        return Err(AppError::Validation("el mes debe ser AAAA-MM".into()));
    }
    let start = format!("{p}-01");
    let s = date_ord(&start).ok_or_else(|| AppError::Validation("mes no válido".into()))?;
    // Último día: el día anterior al primero del mes siguiente.
    let (y, m): (i32, u32) = (p[..4].parse().unwrap_or(2026), p[5..].parse().unwrap_or(1));
    let next = if m == 12 {
        format!("{:04}-01-01", y + 1)
    } else {
        format!("{y:04}-{:02}-01", m + 1)
    };
    let end = date_str(date_ord(&next).unwrap_or(s + 30) - 1);
    Ok((start, end))
}

/// Asiento en armado: (clave, fecha, referencia, descripción, tipo, enlace, líneas).
type Pending<'a> = (
    String,
    String,
    String,
    String,
    Option<String>,
    Option<String>,
    Builder<'a>,
);
/// Meses cerrados: «AAAA-MM» → (cerrado el, cerrado por).
type ClosedMap = HashMap<String, (Option<String>, Option<String>)>;

/// Construye un asiento a partir de líneas por concepto, omitiendo montos en cero.
struct Builder<'a> {
    map: &'a Resolved,
    lines: Vec<(String, i64, i64, Option<String>)>,
}

impl<'a> Builder<'a> {
    fn new(map: &'a Resolved) -> Self {
        Builder {
            map,
            lines: Vec::new(),
        }
    }
    fn debit(&mut self, concept: &str, amount: i64) -> &mut Self {
        let code = self.map.concept(concept);
        self.code_line(code, amount, true, None)
    }
    fn credit(&mut self, concept: &str, amount: i64) -> &mut Self {
        let code = self.map.concept(concept);
        self.code_line(code, amount, false, None)
    }
    fn code_line(
        &mut self,
        code: String,
        amount: i64,
        debit: bool,
        memo: Option<String>,
    ) -> &mut Self {
        if amount == 0 {
            return self;
        }
        // Un monto negativo pasa al lado contrario.
        let (d, c) = if (amount > 0) == debit {
            (amount.abs(), 0)
        } else {
            (0, amount.abs())
        };
        self.lines.push((code, d, c, memo));
        self
    }
    fn balanced(&self) -> bool {
        let d: i64 = self.lines.iter().map(|l| l.1).sum();
        let c: i64 = self.lines.iter().map(|l| l.2).sum();
        d == c && d > 0
    }
}

/// Mapa de conceptos resuelto a códigos existentes, con los nombres de las cuentas.
pub(crate) struct Resolved {
    concepts: HashMap<String, String>,
    groups: HashMap<String, String>,
    names: HashMap<String, String>,
}

impl Resolved {
    fn concept(&self, k: &str) -> String {
        self.concepts
            .get(k)
            .cloned()
            .unwrap_or_else(|| "5.2.99".into())
    }
    fn group(&self, g: &str) -> String {
        self.groups
            .get(g)
            .cloned()
            .unwrap_or_else(|| self.concept("otros_gastos"))
    }
    fn name(&self, code: &str) -> String {
        self.names.get(code).cloned().unwrap_or_else(|| code.into())
    }
}

/* ───────────────────────────── Casos de uso ───────────────────────────── */

impl CompanySession {
    /* ───────────── Plan de cuentas ───────────── */

    pub fn ledger_accounts(&self) -> AppResult<Vec<LedgerAccount>> {
        self.require("contabilidad.ver")?;
        let mut stmt = self.db.conn().prepare(
            "SELECT a.code, a.name, a.simple_name, a.nature, a.is_postable, p.code, a.archived_at IS NOT NULL
             FROM accounting_accounts a LEFT JOIN accounting_accounts p ON p.id = a.parent_id
             ORDER BY a.code",
        )?;
        let rows = stmt
            .query_map([], |r| {
                let code: String = r.get(0)?;
                Ok(LedgerAccount {
                    level: code.matches('.').count() as i64 + 1,
                    code,
                    name: r.get(1)?,
                    simple_name: r.get(2)?,
                    nature: r.get(3)?,
                    postable: r.get::<_, i64>(4)? == 1,
                    parent_code: r.get(5)?,
                    archived: r.get(6)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Crea una subcuenta (código automático bajo la madre) o renombra una cuenta.
    pub fn save_ledger_account(
        &mut self,
        input: &LedgerAccountInput,
    ) -> AppResult<Vec<LedgerAccount>> {
        self.require("contabilidad.editar")?;
        let name = input.name.trim();
        if name.is_empty() || name.chars().count() > 80 {
            return Err(AppError::Validation(
                "escribe el nombre de la cuenta (hasta 80 letras)".into(),
            ));
        }
        let simple = input
            .simple_name
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(String::from);
        let user = self.actor_name()?;
        // Asignación vigente completa (con los valores por defecto), por si la madre deja de ser de detalle.
        let current = {
            let r = self.resolved(self.db.conn())?;
            let mut m = AccountingMap::default();
            for (k, _, _) in CONCEPTS {
                m.concepts.insert((*k).into(), r.concept(k));
            }
            for g in expense_groups(self.db.conn())? {
                m.groups.insert(g.clone(), r.group(&g));
            }
            m
        };
        let tx = self.db.conn_mut().transaction()?;
        let text = match input
            .code
            .as_deref()
            .map(str::trim)
            .filter(|c| !c.is_empty())
        {
            Some(code) => {
                let n = tx.execute(
                    "UPDATE accounting_accounts SET name = ?2, simple_name = ?3 WHERE code = ?1",
                    rusqlite::params![code, name, simple],
                )?;
                if n == 0 {
                    return Err(AppError::NotFound("la cuenta".into()));
                }
                format!("Cuenta {code} renombrada: {name}")
            }
            None => {
                let parent = input
                    .parent_code
                    .as_deref()
                    .map(str::trim)
                    .filter(|c| !c.is_empty())
                    .ok_or_else(|| AppError::Validation("elige la cuenta madre".into()))?;
                let (pid, nature, pcode): (i64, String, String) = tx
                    .query_row(
                        "SELECT id, nature, code FROM accounting_accounts WHERE code = ?1",
                        [parent],
                        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                    )
                    .optional()?
                    .ok_or_else(|| AppError::NotFound("la cuenta madre".into()))?;
                if pcode.matches('.').count() >= 3 {
                    return Err(AppError::Validation(
                        "se permiten hasta 4 niveles de cuentas".into(),
                    ));
                }
                let used: i64 = tx.query_row(
                    "SELECT count(*) FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.journal_entry_id
                     WHERE l.account_id = ?1 AND e.status = 'contabilizado'",
                    [pid],
                    |r| r.get(0),
                )?;
                let parent_postable: bool = tx.query_row(
                    "SELECT is_postable FROM accounting_accounts WHERE id = ?1",
                    [pid],
                    |r| r.get::<_, i64>(0).map(|v| v == 1),
                )?;
                if parent_postable && used > 0 {
                    return Err(AppError::Validation(
                        "esa cuenta ya tiene asientos guardados: crea la subcuenta bajo su cuenta madre".into(),
                    ));
                }
                let mut next = 1;
                {
                    let mut stmt =
                        tx.prepare("SELECT code FROM accounting_accounts WHERE parent_id = ?1")?;
                    let codes = stmt.query_map([pid], |r| r.get::<_, String>(0))?;
                    for c in codes {
                        let c = c?;
                        if let Some(n) = c.rsplit('.').next().and_then(|x| x.parse::<i64>().ok())
                            && n < 90
                        {
                            next = next.max(n + 1);
                        }
                    }
                }
                let code = format!("{pcode}.{next:02}");
                tx.execute(
                    "INSERT INTO accounting_accounts (code, name, simple_name, parent_id, nature, is_postable) VALUES (?1, ?2, ?3, ?4, ?5, 1)",
                    rusqlite::params![code, name, simple, pid, nature],
                )?;
                if parent_postable {
                    // La madre pasa a ser de agrupación; lo que se le asignaba va a la subcuenta nueva.
                    tx.execute(
                        "UPDATE accounting_accounts SET is_postable = 0 WHERE id = ?1",
                        [pid],
                    )?;
                    let mut m = current.clone();
                    for v in m.concepts.values_mut().chain(m.groups.values_mut()) {
                        if v == &pcode {
                            *v = code.clone();
                        }
                    }
                    dbcore::set_setting(
                        &tx,
                        "contabilidad",
                        &serde_json::to_value(&m).unwrap_or_default(),
                    )?;
                }
                format!("Cuenta {code} creada: {name}")
            }
        };
        log(
            &tx,
            &user,
            "contabilidad.cuenta",
            "contabilidad",
            "plan",
            &text,
            None,
        )?;
        tx.commit()?;
        self.ledger_accounts()
    }

    /* ───────────── Asignación de cuentas ───────────── */

    pub fn accounting_map(&self) -> AppResult<AccountingMap> {
        self.require("contabilidad.ver")?;
        let r = self.resolved(self.db.conn())?;
        let mut m = AccountingMap::default();
        for (k, _, _) in CONCEPTS {
            m.concepts.insert((*k).into(), r.concept(k));
        }
        for g in expense_groups(self.db.conn())? {
            m.groups.insert(g.clone(), r.group(&g));
        }
        Ok(m)
    }

    pub fn update_accounting_map(&mut self, m: &AccountingMap) -> AppResult<AccountingMap> {
        self.require("contabilidad.editar")?;
        let postable: HashMap<String, bool> = self
            .ledger_accounts()?
            .into_iter()
            .map(|a| (a.code, a.postable && !a.archived))
            .collect();
        for code in m.concepts.values().chain(m.groups.values()) {
            if !postable.get(code).copied().unwrap_or(false) {
                return Err(AppError::Validation(format!(
                    "la cuenta {code} no existe o es de agrupación: elige una cuenta de detalle"
                )));
            }
        }
        let clean = AccountingMap {
            concepts: m
                .concepts
                .iter()
                .filter(|(k, _)| CONCEPTS.iter().any(|(c, _, _)| c == k))
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect(),
            groups: m.groups.clone(),
        };
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        dbcore::set_setting(
            &tx,
            "contabilidad",
            &serde_json::to_value(&clean).unwrap_or_default(),
        )?;
        log(
            &tx,
            &user,
            "contabilidad.asignacion",
            "contabilidad",
            "plan",
            "Cuentas de los asientos automáticos actualizadas",
            None,
        )?;
        tx.commit()?;
        self.accounting_map()
    }

    pub(crate) fn resolved(&self, conn: &Connection) -> AppResult<Resolved> {
        let saved = map_from_settings(conn)?;
        let mut names = HashMap::new();
        let mut postable = HashMap::new();
        {
            let mut stmt = conn.prepare(
                "SELECT code, name, is_postable, archived_at IS NULL FROM accounting_accounts",
            )?;
            for r in stmt.query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2)? == 1 && r.get::<_, bool>(3)?,
                ))
            })? {
                let (c, n, p) = r?;
                names.insert(c.clone(), n);
                postable.insert(c, p);
            }
        }
        let ok = |c: &String| postable.get(c).copied().unwrap_or(false);
        let mut concepts = HashMap::new();
        for (k, def, _) in CONCEPTS {
            let v = saved
                .concepts
                .get(*k)
                .filter(|c| ok(c))
                .cloned()
                .unwrap_or_else(|| (*def).to_string());
            concepts.insert((*k).to_string(), v);
        }
        let mut groups: HashMap<String, String> = DEFAULT_GROUPS
            .iter()
            .map(|(g, c)| ((*g).to_string(), (*c).to_string()))
            .collect();
        for (g, c) in saved.groups {
            if ok(&c) {
                groups.insert(g, c);
            }
        }
        Ok(Resolved {
            concepts,
            groups,
            names,
        })
    }

    /* ───────────── Asientos automáticos ───────────── */

    /// Asientos calculados desde los documentos con fecha entre `from` y `to` (ambas incluidas).
    pub(crate) fn auto_entries(
        &self,
        conn: &Connection,
        from: &str,
        to: &str,
    ) -> AppResult<Vec<JournalEntry>> {
        let map = self.resolved(conn)?;
        let mut out: Vec<Pending> = Vec::new();
        // (clave, fecha, referencia, descripción, tipo, enlace, líneas)
        macro_rules! push {
            ($key:expr, $date:expr, $reference:expr, $desc:expr, $st:expr, $link:expr, $b:expr) => {
                if $b.balanced() {
                    out.push(($key, $date, $reference, $desc, $st, $link, $b));
                }
            };
        }

        // Saldos iniciales de caja y bancos.
        {
            let mut stmt = conn.prepare(
                "SELECT id, kind, name, opening_minor, coalesce(opening_date, substr(created_at, 1, 10)) AS d
                 FROM money_accounts WHERE opening_minor <> 0 AND d BETWEEN ?1 AND ?2",
            )?;
            let rows = stmt
                .query_map([from, to], |r| {
                    Ok((
                        r.get::<_, i64>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, i64>(3)?,
                        r.get::<_, String>(4)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            for (id, kind, name, amount, d) in rows {
                let mut b = Builder::new(&map);
                b.debit(money_concept(&kind), amount)
                    .credit("capital", amount);
                push!(
                    format!("auto:CTA:{id}"),
                    d,
                    "Saldo inicial".into(),
                    format!("Saldo inicial de {name}"),
                    None,
                    Some("/dinero?tab=cuentas".into()),
                    b
                );
            }
        }
        // Stock inicial (al crear productos).
        {
            let mut stmt = conn.prepare(
                "SELECT movement_date, sum(qty_milli * unit_cost_e4) FROM stock_movements
                 WHERE kind = 'inicial' AND movement_date BETWEEN ?1 AND ?2 GROUP BY movement_date",
            )?;
            let rows = stmt
                .query_map([from, to], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            for (d, v) in rows {
                let v = stock_value(v);
                let mut b = Builder::new(&map);
                b.debit("mercaderias", v).credit("capital", v);
                push!(
                    format!("auto:INI:{d}"),
                    d.clone(),
                    "Stock inicial".into(),
                    "Stock inicial de productos".into(),
                    None,
                    Some("/inventario".into()),
                    b
                );
            }
        }
        // Ventas.
        {
            let mut stmt = conn.prepare(
                "SELECT s.id, s.uid, s.number, s.issue_date, coalesce(c.name, 'Cliente ocasional'), s.tax_minor, s.total_minor,
                    s.cost_minor, s.currency_code, s.rate_e6, s.doc_type
                 FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
                 WHERE s.commercial_state IN ('efectuada', 'cerrada') AND s.issue_date BETWEEN ?1 AND ?2",
            )?;
            type Row = (
                i64,
                String,
                String,
                String,
                String,
                i64,
                i64,
                i64,
                String,
                Option<i64>,
                String,
            );
            let rows: Vec<Row> = stmt
                .query_map([from, to], |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get(2)?,
                        r.get(3)?,
                        r.get(4)?,
                        r.get(5)?,
                        r.get(6)?,
                        r.get(7)?,
                        r.get(8)?,
                        r.get(9)?,
                        r.get(10)?,
                    ))
                })?
                .collect::<Result<_, _>>()?;
            for (id, uid, number, d, party, tax, total, cost, cur, rate, dt) in rows {
                let (tax, total) = (fx(tax, &cur, rate), fx(total, &cur, rate));
                let mut b = Builder::new(&map);
                b.debit("clientes", total)
                    .credit("ventas", total - tax)
                    .credit("iva_debito", tax);
                b.debit("costo_ventas", cost).credit("mercaderias", cost);
                push!(
                    format!("auto:{dt}:{id}"),
                    d,
                    number,
                    format!("Venta a {party}"),
                    Some(dt),
                    Some(format!("/ventas/{uid}")),
                    b
                );
            }
        }
        // Cobros y pagos.
        {
            let mut stmt = conn.prepare(
                "SELECT p.id, p.doc_type, p.number, p.payment_date, p.direction, p.amount_minor, p.currency_code, p.rate_e6, a.kind,
                    CASE p.party_type WHEN 'cliente' THEN (SELECT name FROM customers WHERE id = p.party_id)
                                      WHEN 'proveedor' THEN (SELECT name FROM suppliers WHERE id = p.party_id) END
                 FROM payments p JOIN money_accounts a ON a.id = p.money_account_id
                 WHERE p.status = 'vigente' AND p.payment_date BETWEEN ?1 AND ?2",
            )?;
            type Row = (
                i64,
                String,
                String,
                String,
                String,
                i64,
                String,
                Option<i64>,
                String,
                Option<String>,
            );
            let rows: Vec<Row> = stmt
                .query_map([from, to], |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get(2)?,
                        r.get(3)?,
                        r.get(4)?,
                        r.get(5)?,
                        r.get(6)?,
                        r.get(7)?,
                        r.get(8)?,
                        r.get(9)?,
                    ))
                })?
                .collect::<Result<_, _>>()?;
            let mut alloc = conn.prepare(
                "SELECT b.source_type, sum(pa.amount_minor) FROM payment_allocations pa JOIN payables b ON b.id = pa.payable_id
                 WHERE pa.payment_id = ?1 GROUP BY b.source_type",
            )?;
            for (id, dt, number, d, dir, amount, cur, rate, kind, party) in rows {
                let amount = fx(amount, &cur, rate);
                let mut b = Builder::new(&map);
                let party = party.unwrap_or_else(|| "sin nombre".into());
                if dir == "entrada" {
                    b.debit(money_concept(&kind), amount)
                        .credit("clientes", amount);
                    push!(
                        format!("auto:{dt}:{id}"),
                        d,
                        number,
                        format!("Cobro a {party}"),
                        Some(dt),
                        None,
                        b
                    );
                } else {
                    let parts = alloc
                        .query_map([id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?
                        .collect::<Result<Vec<_>, _>>()?;
                    let mut left = amount;
                    for (st, a) in parts {
                        let a = fx(a, &cur, rate).min(left.max(0));
                        left -= a;
                        b.debit(
                            if st == "GAS" {
                                "acreedores"
                            } else {
                                "proveedores"
                            },
                            a,
                        );
                    }
                    b.debit("proveedores", left)
                        .credit(money_concept(&kind), amount);
                    push!(
                        format!("auto:{dt}:{id}"),
                        d,
                        number,
                        format!("Pago a {party}"),
                        Some(dt),
                        None,
                        b
                    );
                }
            }
        }
        // Compras.
        {
            let mut stmt = conn.prepare(
                "SELECT c.id, c.uid, coalesce(c.supplier_doc_kind || ' ' || c.supplier_doc_number, c.number), c.issue_date, v.name,
                    c.tax_minor, c.total_minor, c.currency_code, c.rate_e6,
                    coalesce((SELECT sum(i.net_minor) FROM purchase_items i JOIN products p ON p.id = i.product_id
                              WHERE i.purchase_id = c.id AND p.track_stock = 1), 0)
                 FROM purchases c JOIN suppliers v ON v.id = c.supplier_id
                 WHERE c.status = 'registrada' AND c.issue_date BETWEEN ?1 AND ?2",
            )?;
            type Row = (
                i64,
                String,
                String,
                String,
                String,
                i64,
                i64,
                String,
                Option<i64>,
                i64,
            );
            let rows: Vec<Row> = stmt
                .query_map([from, to], |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get(2)?,
                        r.get(3)?,
                        r.get(4)?,
                        r.get(5)?,
                        r.get(6)?,
                        r.get(7)?,
                        r.get(8)?,
                        r.get(9)?,
                    ))
                })?
                .collect::<Result<_, _>>()?;
            for (id, uid, doc, d, party, tax, total, cur, rate, stock) in rows {
                let (tax, total, stock) = (
                    fx(tax, &cur, rate),
                    fx(total, &cur, rate),
                    fx(stock, &cur, rate),
                );
                let net = total - tax;
                let stock = stock.clamp(0, net.max(0));
                let mut b = Builder::new(&map);
                b.debit("mercaderias", stock)
                    .debit("compras_otros", net - stock)
                    .debit("iva_credito", tax)
                    .credit("proveedores", total);
                push!(
                    format!("auto:COM:{id}"),
                    d,
                    doc,
                    format!("Compra a {party}"),
                    Some("COM".into()),
                    Some(format!("/compras/doc/{uid}")),
                    b
                );
            }
        }
        // Gastos.
        {
            let mut stmt = conn.prepare(
                "SELECT g.id, g.uid, g.number, g.expense_date, g.description, k.name, k.group_name, g.net_minor, g.tax_minor, g.total_minor
                 FROM expenses g JOIN expense_categories k ON k.id = g.category_id
                 WHERE g.status = 'registrado' AND g.expense_date BETWEEN ?1 AND ?2",
            )?;
            type Row = (
                i64,
                String,
                String,
                String,
                String,
                String,
                String,
                i64,
                i64,
                i64,
            );
            let rows: Vec<Row> = stmt
                .query_map([from, to], |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get(2)?,
                        r.get(3)?,
                        r.get(4)?,
                        r.get(5)?,
                        r.get(6)?,
                        r.get(7)?,
                        r.get(8)?,
                        r.get(9)?,
                    ))
                })?
                .collect::<Result<_, _>>()?;
            for (id, uid, number, d, desc, cat, group, net, tax, total) in rows {
                let account = if cat == "Remuneraciones" {
                    map.concept("remuneraciones")
                } else {
                    map.group(&group)
                };
                let mut b = Builder::new(&map);
                b.code_line(account, total - tax, true, Some(cat.clone()));
                b.debit("iva_credito", tax).credit("acreedores", total);
                let _ = net;
                push!(
                    format!("auto:GAS:{id}"),
                    d,
                    number,
                    format!("Gasto: {desc}"),
                    Some("GAS".into()),
                    Some(format!("/gastos/gasto/{uid}")),
                    b
                );
            }
        }
        // Ajustes de inventario e ingresos de stock.
        {
            let mut stmt = conn.prepare(
                "SELECT a.id, a.number, a.adjust_date, a.reason,
                    coalesce(sum(CASE WHEN m.qty_milli > 0 THEN m.qty_milli * m.unit_cost_e4 END), 0),
                    coalesce(sum(CASE WHEN m.qty_milli < 0 THEN -m.qty_milli * m.unit_cost_e4 END), 0)
                 FROM stock_adjustments a JOIN stock_movements m ON m.source_type = 'AJU' AND m.source_id = a.id AND m.kind = 'ajuste'
                 WHERE a.adjust_date BETWEEN ?1 AND ?2 GROUP BY a.id",
            )?;
            let rows = stmt
                .query_map([from, to], |r| {
                    Ok((
                        r.get::<_, i64>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, String>(3)?,
                        r.get::<_, i64>(4)?,
                        r.get::<_, i64>(5)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            for (id, number, d, reason, up, down) in rows {
                let (up, down) = (stock_value(up), stock_value(down));
                let mut b = Builder::new(&map);
                b.debit("mercaderias", up).credit("sobrantes", up);
                b.debit("mermas", down).credit("mercaderias", down);
                push!(
                    format!("auto:AJU:{id}"),
                    d,
                    number,
                    format!("Ajuste de inventario: {reason}"),
                    Some("AJU".into()),
                    Some("/inventario?tab=movimientos".into()),
                    b
                );
            }
            let mut stmt = conn.prepare(
                "SELECT e.id, e.number, e.entry_date, sum(m.qty_milli * m.unit_cost_e4)
                 FROM stock_entries e JOIN stock_movements m ON m.source_type = 'ING' AND m.source_id = e.id
                 WHERE e.entry_date BETWEEN ?1 AND ?2 GROUP BY e.id",
            )?;
            let rows = stmt
                .query_map([from, to], |r| {
                    Ok((
                        r.get::<_, i64>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, i64>(3)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            for (id, number, d, v) in rows {
                let v = stock_value(v);
                let mut b = Builder::new(&map);
                b.debit("mercaderias", v).credit("aportes", v);
                push!(
                    format!("auto:ING:{id}"),
                    d,
                    number,
                    "Ingreso de stock sin compra".into(),
                    Some("ING".into()),
                    Some("/inventario?tab=movimientos".into()),
                    b
                );
            }
        }
        // Importaciones: costos (hasta recibir) y recepciones.
        {
            let mut stmt = conn.prepare(
                "SELECT b.id, b.amount_minor, k.kind, k.recoverable_tax, coalesce(k.cost_date, substr(k.created_at, 1, 10)) AS d,
                    i.number, i.uid, coalesce(k.description, replace(k.kind, '_', ' '))
                 FROM payables b JOIN import_costs k ON k.id = b.source_id JOIN imports i ON i.id = k.import_id
                 WHERE b.source_type = 'IMP' AND b.status <> 'anulada' AND k.status = 'vigente' AND d BETWEEN ?1 AND ?2",
            )?;
            type Row = (i64, i64, String, i64, String, String, String, String);
            let rows: Vec<Row> = stmt
                .query_map([from, to], |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get(2)?,
                        r.get(3)?,
                        r.get(4)?,
                        r.get(5)?,
                        r.get(6)?,
                        r.get(7)?,
                    ))
                })?
                .collect::<Result<_, _>>()?;
            for (id, amount, kind, recoverable, d, number, uid, desc) in rows {
                let mut b = Builder::new(&map);
                b.debit(
                    if kind == "iva_importacion" || recoverable == 1 {
                        "iva_credito"
                    } else {
                        "importaciones"
                    },
                    amount,
                )
                .credit("proveedores", amount);
                push!(
                    format!("auto:IMPC:{id}"),
                    d,
                    number,
                    format!("Importación: {desc}"),
                    Some("IMP".into()),
                    Some(format!("/comex/importacion/{uid}")),
                    b
                );
            }
            let mut stmt = conn.prepare(
                "SELECT r.id, i.number, i.uid, r.receipt_date, sum(m.qty_milli * m.unit_cost_e4)
                 FROM receipts r JOIN imports i ON i.id = r.import_id
                 JOIN stock_movements m ON m.source_type = 'REC' AND m.source_id = r.id AND m.qty_milli > 0
                 WHERE r.receipt_date BETWEEN ?1 AND ?2 GROUP BY r.id",
            )?;
            let rows = stmt
                .query_map([from, to], |r| {
                    Ok((
                        r.get::<_, i64>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, String>(3)?,
                        r.get::<_, i64>(4)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            for (id, number, uid, d, v) in rows {
                let v = stock_value(v);
                let mut b = Builder::new(&map);
                b.debit("mercaderias", v).credit("importaciones", v);
                push!(
                    format!("auto:IMPR:{id}"),
                    d,
                    number,
                    "Recepción de importación en bodega".into(),
                    Some("IMP".into()),
                    Some(format!("/comex/importacion/{uid}")),
                    b
                );
            }
        }
        // Traspasos entre cuentas de dinero.
        {
            let mut stmt = conn.prepare(
                "SELECT t.id, t.transfer_date, t.amount_minor, f.kind, f.name, d.kind, d.name
                 FROM money_transfers t JOIN money_accounts f ON f.id = t.from_account_id JOIN money_accounts d ON d.id = t.to_account_id
                 WHERE t.transfer_date BETWEEN ?1 AND ?2",
            )?;
            type Row = (i64, String, i64, String, String, String, String);
            let rows: Vec<Row> = stmt
                .query_map([from, to], |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get(2)?,
                        r.get(3)?,
                        r.get(4)?,
                        r.get(5)?,
                        r.get(6)?,
                    ))
                })?
                .collect::<Result<_, _>>()?;
            for (id, d, amount, fk, fname, tk, tname) in rows {
                let (fc, tc) = (
                    map.concept(money_concept(&fk)),
                    map.concept(money_concept(&tk)),
                );
                if fc == tc {
                    continue;
                }
                let mut b = Builder::new(&map);
                b.code_line(tc, amount, true, None)
                    .code_line(fc, amount, false, None);
                push!(
                    format!("auto:TRF:{id}"),
                    d,
                    "Traspaso".into(),
                    format!("Traspaso de {fname} a {tname}"),
                    None,
                    Some("/dinero?tab=cuentas".into()),
                    b
                );
            }
        }
        // Remuneraciones (liquidaciones emitidas, a la fecha de pago).
        {
            let mut stmt = conn.prepare(
                "SELECT p.id, p.pay_date, p.period, w.name, p.employer_cost_minor, p.to_pay_minor
                 FROM payslips p JOIN workers w ON w.id = p.worker_id
                 WHERE p.status = 'emitida' AND p.pay_date BETWEEN ?1 AND ?2",
            )?;
            let rows = stmt
                .query_map([from, to], |r| {
                    Ok((
                        r.get::<_, i64>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, String>(3)?,
                        r.get::<_, i64>(4)?,
                        r.get::<_, i64>(5)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            for (id, d, period, name, cost, to_pay) in rows {
                let cost = cost.max(to_pay);
                let mut b = Builder::new(&map);
                b.debit("remuneraciones", cost)
                    .credit("rem_por_pagar", to_pay)
                    .credit("retenciones", cost - to_pay);
                push!(
                    format!("auto:REM:{id}"),
                    d,
                    format!("Liquidación {period}"),
                    format!("Remuneración de {name}"),
                    None,
                    Some("/remuneraciones".into()),
                    b
                );
            }
        }

        let mut entries: Vec<JournalEntry> = out
            .into_iter()
            .map(
                |(key, date, reference, description, st, link, b)| JournalEntry {
                    origin: if key.starts_with("auto:CTA:") || key.starts_with("auto:INI:") {
                        "apertura".into()
                    } else {
                        "automatico".into()
                    },
                    key,
                    date,
                    reference,
                    description,
                    source_type: st,
                    link,
                    status: "calculado".into(),
                    lines: b
                        .lines
                        .into_iter()
                        .map(|(code, d, c, memo)| EntryLine {
                            account_name: map.name(&code),
                            account_code: code,
                            debit_minor: d,
                            credit_minor: c,
                            memo,
                        })
                        .collect(),
                },
            )
            .collect();
        entries.sort_by(|a, b| a.date.cmp(&b.date).then_with(|| a.key.cmp(&b.key)));
        Ok(entries)
    }

    /// Asientos guardados (cierres y manuales) entre dos fechas.
    fn stored_entries(
        &self,
        conn: &Connection,
        from: &str,
        to: &str,
        origin_auto: bool,
    ) -> AppResult<Vec<JournalEntry>> {
        let mut stmt = conn.prepare(&format!(
            "SELECT e.id, e.uid, e.entry_date, e.description, e.origin, e.source_type, e.status, coalesce(e.rule_set_code, '')
             FROM journal_entries e
             WHERE e.entry_date BETWEEN ?1 AND ?2 AND e.status IN ('contabilizado', 'reversado')
               AND {}
             ORDER BY e.entry_date, e.id",
            if origin_auto { "e.origin IN ('automatico', 'apertura')" } else { "e.origin IN ('manual', 'cierre')" }
        ))?;
        type Head = (
            i64,
            String,
            String,
            String,
            String,
            Option<String>,
            String,
            String,
        );
        let heads: Vec<Head> = stmt
            .query_map([from, to], |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                    r.get(7)?,
                ))
            })?
            .collect::<Result<_, _>>()?;
        let mut lines = conn.prepare(
            "SELECT a.code, a.name, l.debit_minor, l.credit_minor, l.memo FROM journal_entry_lines l
             JOIN accounting_accounts a ON a.id = l.account_id WHERE l.journal_entry_id = ?1 ORDER BY l.id",
        )?;
        let mut out = Vec::with_capacity(heads.len());
        for (id, uid, date, desc, origin, st, status, extra) in heads {
            // En los asientos automáticos guardados, `rule_set_code` lleva "referencia|enlace".
            let (reference, link) = match extra.split_once('|') {
                Some((r, l)) => (r.to_string(), (!l.is_empty()).then(|| l.to_string())),
                None => (
                    if extra.is_empty() {
                        format!("AS-{id:06}")
                    } else {
                        extra
                    },
                    None,
                ),
            };
            out.push(JournalEntry {
                key: uid,
                date,
                reference,
                description: desc,
                origin,
                source_type: st,
                link,
                status,
                lines: lines
                    .query_map([id], |r| {
                        Ok(EntryLine {
                            account_code: r.get(0)?,
                            account_name: r.get(1)?,
                            debit_minor: r.get(2)?,
                            credit_minor: r.get(3)?,
                            memo: r.get(4)?,
                        })
                    })?
                    .collect::<Result<_, _>>()?,
            });
        }
        Ok(out)
    }

    fn closed_periods(&self, conn: &Connection) -> AppResult<ClosedMap> {
        let mut stmt = conn.prepare(
            "SELECT printf('%04d-%02d', f.year, f.month), f.closed_at, u.display_name
             FROM fiscal_periods f LEFT JOIN users u ON u.id = f.closed_by WHERE f.status = 'cerrado'",
        )?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, (r.get(1)?, r.get(2)?))))?
            .collect::<Result<HashMap<_, _>, _>>()?;
        Ok(rows)
    }

    /// Libro diario: meses cerrados desde lo guardado, meses abiertos calculados, más los manuales.
    pub fn journal(&self, from: &str, to: &str) -> AppResult<Vec<JournalEntry>> {
        self.require("contabilidad.ver")?;
        let from = parse_date("la fecha «desde»", from)?;
        let to = parse_date("la fecha «hasta»", to)?;
        if from > to {
            return Err(AppError::Validation(
                "la fecha «desde» es posterior a «hasta»".into(),
            ));
        }
        let conn = self.db.conn();
        self.journal_between(conn, &from, &to)
    }

    pub(crate) fn journal_between(
        &self,
        conn: &Connection,
        from: &str,
        to: &str,
    ) -> AppResult<Vec<JournalEntry>> {
        let closed = self.closed_periods(conn)?;
        let mut out: Vec<JournalEntry> = self
            .auto_entries(conn, from, to)?
            .into_iter()
            .filter(|e| !closed.contains_key(&e.date[..7]))
            .collect();
        out.extend(
            self.stored_entries(conn, from, to, true)?
                .into_iter()
                .filter(|e| closed.contains_key(&e.date[..7]) && e.status == "contabilizado"),
        );
        out.extend(self.stored_entries(conn, from, to, false)?);
        out.sort_by(|a, b| {
            a.date
                .cmp(&b.date)
                .then_with(|| a.reference.cmp(&b.reference))
        });
        Ok(out)
    }

    /// Sumas y saldos por cuenta de detalle en el período (con saldo inicial si `opening`).
    pub fn trial_balance(&self, from: &str, to: &str) -> AppResult<Vec<TrialRow>> {
        self.require("contabilidad.ver")?;
        let conn = self.db.conn();
        self.trial_between(conn, from, to)
    }

    pub(crate) fn trial_between(
        &self,
        conn: &Connection,
        from: &str,
        to: &str,
    ) -> AppResult<Vec<TrialRow>> {
        let mut sums: BTreeMap<String, (i64, i64)> = BTreeMap::new();
        for e in self.journal_between(conn, from, to)? {
            if e.status == "reversado" && e.origin != "manual" {
                continue;
            }
            for l in e.lines {
                let s = sums.entry(l.account_code).or_default();
                s.0 += l.debit_minor;
                s.1 += l.credit_minor;
            }
        }
        let accounts: HashMap<String, (String, Option<String>, String)> = {
            let mut stmt =
                conn.prepare("SELECT code, name, simple_name, nature FROM accounting_accounts")?;
            stmt.query_map([], |r| {
                Ok((r.get::<_, String>(0)?, (r.get(1)?, r.get(2)?, r.get(3)?)))
            })?
            .collect::<Result<_, _>>()?
        };
        Ok(sums
            .into_iter()
            .map(|(code, (d, c))| {
                let (name, simple, nature) =
                    accounts
                        .get(&code)
                        .cloned()
                        .unwrap_or((code.clone(), None, "gasto".into()));
                TrialRow {
                    code,
                    name,
                    simple_name: simple,
                    nature,
                    debit_minor: d,
                    credit_minor: c,
                    balance_minor: d - c,
                }
            })
            .collect())
    }

    /* ───────────── Asientos manuales ───────────── */

    pub fn add_manual_entry(&mut self, input: &ManualEntryInput) -> AppResult<JournalEntry> {
        self.require("contabilidad.editar")?;
        let date = parse_date("la fecha", &input.date)?;
        let desc = input.description.trim();
        if desc.is_empty() || desc.chars().count() > 200 {
            return Err(AppError::Validation(
                "escribe la glosa del asiento (hasta 200 letras)".into(),
            ));
        }
        if input.lines.len() < 2 || input.lines.len() > 100 {
            return Err(AppError::Validation(
                "un asiento lleva entre 2 y 100 líneas".into(),
            ));
        }
        let accounts: HashMap<String, (i64, bool)> = {
            let mut stmt = self.db.conn().prepare(
                "SELECT code, id, is_postable = 1 AND archived_at IS NULL FROM accounting_accounts",
            )?;
            stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, (r.get(1)?, r.get(2)?))))?
                .collect::<Result<_, _>>()?
        };
        let (mut d, mut c) = (0i64, 0i64);
        for (i, l) in input.lines.iter().enumerate() {
            let ok = accounts.get(l.account_code.trim()).is_some_and(|a| a.1);
            if !ok {
                return Err(AppError::Validation(format!(
                    "línea {}: elige una cuenta de detalle",
                    i + 1
                )));
            }
            if l.debit_minor < 0
                || l.credit_minor < 0
                || (l.debit_minor == 0) == (l.credit_minor == 0)
            {
                return Err(AppError::Validation(format!(
                    "línea {}: anota el monto en el debe o en el haber",
                    i + 1
                )));
            }
            d += l.debit_minor;
            c += l.credit_minor;
        }
        if d != c {
            return Err(AppError::Validation(format!(
                "el asiento no cuadra: debe {} y haber {}",
                crate::insight_ops::money(d),
                crate::insight_ops::money(c)
            )));
        }
        if self
            .closed_periods(self.db.conn())?
            .contains_key(&date[..7])
        {
            return Err(AppError::Validation(
                "ese mes está cerrado: reábrelo para agregar asientos".into(),
            ));
        }
        let by = self.user_id();
        let user = self.actor_name()?;
        let now = now_utc();
        let uid = uuid::Uuid::now_v7().to_string();
        let tx = self.db.conn_mut().transaction()?;
        let n: i64 = tx.query_row(
            "SELECT count(*) + 1 FROM journal_entries WHERE origin = 'manual'",
            [],
            |r| r.get(0),
        )?;
        let reference = format!("AS-{n:06}");
        tx.execute(
            "INSERT INTO journal_entries (uid, entry_date, description, origin, status, rule_set_code, created_by, created_at)
             VALUES (?1, ?2, ?3, 'manual', 'propuesto', ?4, ?5, ?6)",
            rusqlite::params![uid, date, desc, reference, by, now],
        )?;
        let eid = tx.last_insert_rowid();
        for l in &input.lines {
            tx.execute(
                "INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_minor, credit_minor, memo) VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![eid, accounts[l.account_code.trim()].0, l.debit_minor, l.credit_minor, l.memo.as_deref().map(str::trim).filter(|m| !m.is_empty())],
            )?;
        }
        tx.execute(
            "UPDATE journal_entries SET status = 'contabilizado' WHERE id = ?1",
            [eid],
        )?;
        log(
            &tx,
            &user,
            "contabilidad.asiento",
            "asiento",
            &uid,
            &format!(
                "{reference} {date}: {desc} ({})",
                crate::insight_ops::money(d)
            ),
            None,
        )?;
        tx.commit()?;
        self.entry_by_uid(&uid)
    }

    /// Reversa un asiento manual con un asiento inverso (nada se borra).
    pub fn reverse_manual_entry(&mut self, uid: &str, reason: &str) -> AppResult<JournalEntry> {
        self.require("contabilidad.editar")?;
        let reason = reason.trim();
        if reason.is_empty() {
            return Err(AppError::Validation(
                "escribe el motivo de la reversa".into(),
            ));
        }
        let (id, date, desc, origin, status, reference): (i64, String, String, String, String, Option<String>) = self
            .db
            .conn()
            .query_row(
                "SELECT id, entry_date, description, origin, status, rule_set_code FROM journal_entries WHERE uid = ?1",
                [uid],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
            )
            .optional()?
            .ok_or_else(|| AppError::NotFound("el asiento".into()))?;
        if origin != "manual" || status != "contabilizado" {
            return Err(AppError::Validation(
                "solo se reversan asientos manuales vigentes".into(),
            ));
        }
        let today = local_today(self.db.conn())?;
        let when = if self
            .closed_periods(self.db.conn())?
            .contains_key(&date[..7])
        {
            today
        } else {
            date
        };
        let by = self.user_id();
        let user = self.actor_name()?;
        let now = now_utc();
        let ruid = uuid::Uuid::now_v7().to_string();
        let tx = self.db.conn_mut().transaction()?;
        tx.execute(
            "INSERT INTO journal_entries (uid, entry_date, description, origin, status, reversal_of, rule_set_code, created_by, created_at)
             VALUES (?1, ?2, ?3, 'manual', 'propuesto', ?4, ?5, ?6, ?7)",
            rusqlite::params![ruid, when, format!("Reversa de {}: {reason}", reference.clone().unwrap_or_default()), id, format!("{}-R", reference.clone().unwrap_or_default()), by, now],
        )?;
        let rid = tx.last_insert_rowid();
        tx.execute(
            "INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_minor, credit_minor, memo)
             SELECT ?1, account_id, credit_minor, debit_minor, memo FROM journal_entry_lines WHERE journal_entry_id = ?2",
            [rid, id],
        )?;
        tx.execute(
            "UPDATE journal_entries SET status = 'contabilizado' WHERE id = ?1",
            [rid],
        )?;
        tx.execute(
            "UPDATE journal_entries SET status = 'reversado' WHERE id = ?1",
            [id],
        )?;
        log(
            &tx,
            &user,
            "contabilidad.reversa",
            "asiento",
            uid,
            &format!(
                "Asiento {} reversado: {desc}",
                reference.unwrap_or_default()
            ),
            Some(reason),
        )?;
        tx.commit()?;
        self.entry_by_uid(&ruid)
    }

    fn entry_by_uid(&self, uid: &str) -> AppResult<JournalEntry> {
        let conn = self.db.conn();
        let date: String = conn.query_row(
            "SELECT entry_date FROM journal_entries WHERE uid = ?1",
            [uid],
            |r| r.get(0),
        )?;
        self.stored_entries(conn, &date, &date, false)?
            .into_iter()
            .find(|e| e.key == uid)
            .ok_or_else(|| AppError::NotFound("el asiento".into()))
    }

    /* ───────────── Cierre de meses ───────────── */

    /// Meses con movimientos (los últimos 24 y los cerrados), con su estado.
    pub fn accounting_periods(&self) -> AppResult<Vec<PeriodRow>> {
        self.require("contabilidad.ver")?;
        let conn = self.db.conn();
        let today = local_today(conn)?;
        let t = date_ord(&today).unwrap_or(0);
        let from = format!("{}-01", &date_str(t - 730)[..7]);
        let closed = self.closed_periods(conn)?;
        let mut by: BTreeMap<String, (i64, i64)> = BTreeMap::new();
        for e in self.auto_entries(conn, &from, &today)? {
            let s = by.entry(e.date[..7].to_string()).or_default();
            s.0 += 1;
            s.1 += e.lines.iter().map(|l| l.debit_minor).sum::<i64>();
        }
        for p in closed.keys() {
            by.entry(p.clone()).or_default();
        }
        by.entry(today[..7].to_string()).or_default();
        let mut out = Vec::new();
        for (p, (n, debit)) in by.into_iter().rev() {
            let (status, closed_at, closed_by, stored_n, stored_d) = match closed.get(&p) {
                Some((at, who)) => {
                    let (s, e) = period_bounds(&p)?;
                    let st = self.stored_entries(conn, &s, &e, true)?;
                    let st: Vec<&JournalEntry> =
                        st.iter().filter(|x| x.status == "contabilizado").collect();
                    let d: i64 = st
                        .iter()
                        .flat_map(|x| x.lines.iter())
                        .map(|l| l.debit_minor)
                        .sum();
                    ("cerrado", at.clone(), who.clone(), st.len() as i64, d)
                }
                None => ("abierto", None, None, n, debit),
            };
            out.push(PeriodRow {
                changed: status == "cerrado" && (stored_d != debit || stored_n != n),
                period: p,
                status: status.into(),
                entries: stored_n,
                debit_minor: stored_d,
                current_debit_minor: debit,
                closed_at,
                closed_by,
            });
        }
        Ok(out)
    }

    /// Cierra un mes: guarda sus asientos automáticos y bloquea nuevos asientos con esa fecha.
    pub fn close_period(&mut self, period: &str) -> AppResult<Vec<PeriodRow>> {
        self.require("contabilidad.editar")?;
        let (start, end) = period_bounds(period)?;
        let conn = self.db.conn();
        if end >= local_today(conn)? {
            return Err(AppError::Validation(
                "solo se cierran meses ya terminados".into(),
            ));
        }
        if self.closed_periods(conn)?.contains_key(period) {
            return Err(AppError::Validation("ese mes ya está cerrado".into()));
        }
        let entries = self.auto_entries(conn, &start, &end)?;
        let ids: HashMap<String, i64> = {
            let mut stmt = conn.prepare("SELECT code, id FROM accounting_accounts")?;
            stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
                .collect::<Result<_, _>>()?
        };
        let by = self.user_id();
        let user = self.actor_name()?;
        let now = now_utc();
        let (y, m): (i64, i64) = (
            period[..4].parse().unwrap_or(0),
            period[5..].parse().unwrap_or(0),
        );
        let tx = self.db.conn_mut().transaction()?;
        let mut total = 0;
        for e in &entries {
            let uid = uuid::Uuid::now_v7().to_string();
            let src_id: Option<i64> = e.key.rsplit(':').next().and_then(|x| x.parse().ok());
            let st = e.source_type.as_deref().filter(|s| {
                [
                    "VEN", "FV", "SRV", "PAG", "ABN", "EGR", "COM", "GAS", "AJU", "ING", "IMP",
                ]
                .contains(s)
            });
            tx.execute(
                "INSERT INTO journal_entries (uid, entry_date, description, origin, source_type, source_id, status, rule_set_code, created_by, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'propuesto', ?7, ?8, ?9)",
                rusqlite::params![uid, e.date, e.description, e.origin, st, src_id, format!("{}|{}", e.reference, e.link.clone().unwrap_or_default()), by, now],
            )?;
            let eid = tx.last_insert_rowid();
            for l in &e.lines {
                let aid = ids
                    .get(&l.account_code)
                    .ok_or_else(|| AppError::NotFound(format!("la cuenta {}", l.account_code)))?;
                tx.execute(
                    "INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_minor, credit_minor, memo) VALUES (?1, ?2, ?3, ?4, ?5)",
                    rusqlite::params![eid, aid, l.debit_minor, l.credit_minor, l.memo],
                )?;
                total += l.debit_minor;
            }
            tx.execute(
                "UPDATE journal_entries SET status = 'contabilizado' WHERE id = ?1",
                [eid],
            )?;
        }
        tx.execute(
            "INSERT INTO fiscal_periods (year, month, status, closed_by, closed_at) VALUES (?1, ?2, 'cerrado', ?3, ?4)
             ON CONFLICT(year, month) DO UPDATE SET status = 'cerrado', closed_by = excluded.closed_by, closed_at = excluded.closed_at",
            rusqlite::params![y, m, by, now],
        )?;
        log(
            &tx,
            &user,
            "contabilidad.cierre",
            "periodo",
            period,
            &format!(
                "Mes {period} cerrado: {} asientos por {}",
                entries.len(),
                crate::insight_ops::money(total)
            ),
            None,
        )?;
        tx.commit()?;
        self.accounting_periods()
    }

    /// Reabre un mes cerrado: sus asientos guardados quedan reversados y vuelven a calcularse.
    pub fn reopen_period(&mut self, period: &str, reason: &str) -> AppResult<Vec<PeriodRow>> {
        self.require("contabilidad.editar")?;
        let reason = reason.trim();
        if reason.is_empty() {
            return Err(AppError::Validation(
                "escribe el motivo para reabrir el mes".into(),
            ));
        }
        let (start, end) = period_bounds(period)?;
        if !self.closed_periods(self.db.conn())?.contains_key(period) {
            return Err(AppError::Validation("ese mes no está cerrado".into()));
        }
        let (y, m): (i64, i64) = (
            period[..4].parse().unwrap_or(0),
            period[5..].parse().unwrap_or(0),
        );
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        tx.execute(
            "UPDATE fiscal_periods SET status = 'abierto' WHERE year = ?1 AND month = ?2",
            [y, m],
        )?;
        let n = tx.execute(
            "UPDATE journal_entries SET status = 'reversado'
             WHERE origin IN ('automatico', 'apertura') AND status = 'contabilizado' AND entry_date BETWEEN ?1 AND ?2",
            [&start, &end],
        )?;
        log(
            &tx,
            &user,
            "contabilidad.reapertura",
            "periodo",
            period,
            &format!("Mes {period} reabierto ({n} asientos guardados quedan sin efecto)"),
            Some(reason),
        )?;
        tx.commit()?;
        self.accounting_periods()
    }
}

fn money_concept(kind: &str) -> &'static str {
    if kind == "caja" { "caja" } else { "bancos" }
}

fn map_from_settings(conn: &Connection) -> AppResult<AccountingMap> {
    Ok(dbcore::get_setting(conn, "contabilidad")?
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default())
}

fn expense_groups(conn: &Connection) -> AppResult<Vec<String>> {
    let mut stmt =
        conn.prepare("SELECT DISTINCT group_name FROM expense_categories ORDER BY group_name")?;
    let mut v: Vec<String> = stmt
        .query_map([], |r| r.get(0))?
        .collect::<Result<_, _>>()?;
    for (g, _) in DEFAULT_GROUPS {
        if !v.iter().any(|x| x == g) {
            v.push((*g).into());
        }
    }
    v.retain(|g| g != "Otros");
    v.sort();
    Ok(v)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn limites_de_mes() {
        assert_eq!(
            period_bounds("2026-02").unwrap(),
            ("2026-02-01".into(), "2026-02-28".into())
        );
        assert_eq!(period_bounds("2024-02").unwrap().1, "2024-02-29");
        assert_eq!(period_bounds("2026-12").unwrap().1, "2026-12-31");
        assert!(period_bounds("2026-13").is_err());
        assert!(period_bounds("26-1").is_err());
    }

    #[test]
    fn moneda_y_valor_de_stock() {
        assert_eq!(fx(100, "USD", Some(950_000_000)), 95_000);
        assert_eq!(fx(100, "CLP", Some(950_000_000)), 100);
        assert_eq!(stock_value(3_000 * 14_000_000), 4_200);
    }
}
