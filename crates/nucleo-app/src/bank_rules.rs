//! Reglas de conciliación: «cuando la glosa diga X (o el RUT sea Y), es tal cliente, tal proveedor,
//! tal gasto, un traspaso o se ignora».
//!
//! Hay dos orígenes. Las **manuales** las escribe la persona. Las **aprendidas** las anota NÚCLEO cada
//! vez que alguien concilia un movimiento: si el abono de «CLINICA SUR SPA» se cobró contra una venta
//! de Clínica Sur, el próximo abono con esa glosa (o ese RUT) llega con la sugerencia arriba.
//!
//! Una regla nunca mueve dinero ni concilia por su cuenta: solo ordena las sugerencias. Registrar el
//! cobro, el pago o el gasto sigue siendo una decisión de la persona, movimiento por movimiento.

use crate::bank_ops::fold;
use crate::company::CompanySession;
use crate::sales_ops::log;
use crate::{AppError, AppResult};
use nucleo_db::now_utc;
use nucleo_db::{customers, suppliers};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

pub const DIRECTIONS: [&str; 3] = ["abono", "cargo", "ambos"];
pub const ACTIONS: [&str; 5] = ["cliente", "proveedor", "gasto", "traspaso", "ignorar"];

/// Palabras de la glosa que no identifican a nadie.
const NOISE: &[&str] = &[
    "transferencia",
    "transf",
    "transfer",
    "tef",
    "traspaso",
    "de",
    "del",
    "desde",
    "a",
    "al",
    "para",
    "hacia",
    "por",
    "en",
    "la",
    "el",
    "y",
    "abono",
    "cargo",
    "pago",
    "pagos",
    "recibida",
    "recibido",
    "enviada",
    "enviado",
    "electronica",
    "internet",
    "web",
    "app",
    "linea",
    "cta",
    "cuenta",
    "cte",
    "corriente",
    "vista",
    "banco",
    "bco",
    "rut",
    "nro",
    "numero",
    "n",
    "no",
    "compra",
    "redcompra",
    "deposito",
    "otros",
    "otro",
    "bancos",
    "terceros",
    "tercero",
    "mismo",
    "titular",
    "fondos",
    "op",
    "operacion",
    "ref",
    "referencia",
    "doc",
    "documento",
    "fecha",
    "hora",
    "sucursal",
    "oficina",
    "nacional",
    "internacional",
    "debito",
    "credito",
    "tarjeta",
    "td",
    "tc",
    "pos",
    "comercio",
    "servipag",
    "webpay",
    "pac",
    "pat",
];

/// RUT sin puntos, guion ni espacios («77.334.963-0» → «773349630»). None si no parece un RUT.
pub(crate) fn rut_key(s: &str) -> Option<String> {
    let k: String = s
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>()
        .to_uppercase();
    let ok = (7..=9).contains(&k.len())
        && k[..k.len() - 1].chars().all(|c| c.is_ascii_digit())
        && k.chars()
            .last()
            .is_some_and(|c| c.is_ascii_digit() || c == 'K');
    ok.then_some(k)
}

/// Lo que identifica a la contraparte en una glosa: sin tildes, sin números y sin las palabras del
/// banco («Transferencia de CLINICA SUR SPA 0012345» → «clinica sur spa»).
pub fn signature(text: &str) -> String {
    fold(text)
        .split(' ')
        .filter(|w| w.len() > 1 && !w.chars().all(|c| c.is_ascii_digit()) && !NOISE.contains(w))
        .take(6)
        .collect::<Vec<_>>()
        .join(" ")
}

#[derive(Debug, Clone)]
pub(crate) struct Rule {
    pub id: i64,
    pub uid: String,
    pub name: String,
    pub pattern: String,
    pub rut: Option<String>,
    pub direction: String,
    pub action: String,
    pub customer_id: Option<i64>,
    pub supplier_id: Option<i64>,
    pub category_id: Option<i64>,
    pub account_id: Option<i64>,
    pub tax_included: Option<bool>,
    pub note: Option<String>,
    pub origin: String,
    pub hits: i64,
    pub last_hit_at: Option<String>,
    pub active: bool,
}

const COLS: &str = "id, uid, name, pattern, rut, direction, action, customer_id, supplier_id, category_id, account_id, tax_included, note, origin, hits, last_hit_at, active";

fn read(r: &rusqlite::Row<'_>) -> rusqlite::Result<Rule> {
    Ok(Rule {
        id: r.get(0)?,
        uid: r.get(1)?,
        name: r.get(2)?,
        pattern: r.get(3)?,
        rut: r.get(4)?,
        direction: r.get(5)?,
        action: r.get(6)?,
        customer_id: r.get(7)?,
        supplier_id: r.get(8)?,
        category_id: r.get(9)?,
        account_id: r.get(10)?,
        tax_included: r.get(11)?,
        note: r.get(12)?,
        origin: r.get(13)?,
        hits: r.get(14)?,
        last_hit_at: r.get(15)?,
        active: r.get(16)?,
    })
}

pub(crate) fn load(conn: &Connection, only_active: bool) -> AppResult<Vec<Rule>> {
    let mut st = conn.prepare(&format!(
        "SELECT {COLS} FROM bank_rules {} ORDER BY origin DESC, hits DESC, id",
        if only_active { "WHERE active = 1" } else { "" }
    ))?;
    Ok(st.query_map([], read)?.collect::<Result<_, _>>()?)
}

/// Lo que se sabe de un movimiento para compararlo con las reglas.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Facts<'a> {
    pub description: &'a str,
    pub name: Option<&'a str>,
    pub comment: Option<&'a str>,
    pub rut: Option<&'a str>,
    pub amount: i64,
}

impl Facts<'_> {
    fn text(&self) -> String {
        fold(&format!(
            "{} {} {}",
            self.description,
            self.name.unwrap_or(""),
            self.comment.unwrap_or("")
        ))
    }
}

impl Rule {
    /// 0 = no aplica; 3 = coincide el RUT; 2 = la glosa contiene el texto de la regla.
    fn strength(&self, f: &Facts<'_>, text: &str, sig: &str, rut: Option<&str>) -> u8 {
        let dir_ok = match self.direction.as_str() {
            "abono" => f.amount > 0,
            "cargo" => f.amount < 0,
            _ => true,
        };
        if !dir_ok {
            return 0;
        }
        if let (Some(a), Some(b)) = (self.rut.as_deref(), rut)
            && a == b
        {
            return 3;
        }
        if !self.pattern.is_empty()
            && (format!(" {text} ").contains(&format!(" {} ", self.pattern))
                || format!(" {sig} ").contains(&format!(" {} ", self.pattern)))
        {
            return 2;
        }
        0
    }
}

/// Reglas que aplican a un movimiento, la mejor primero: RUT antes que glosa, manual antes que
/// aprendida, el texto más largo (más específico) antes que el corto.
pub(crate) fn matching<'a>(rules: &'a [Rule], f: &Facts<'_>) -> Vec<&'a Rule> {
    let text = f.text();
    let sig = signature(&text);
    let rut = f.rut.and_then(rut_key);
    let mut hits: Vec<(u8, &Rule)> = rules
        .iter()
        .filter(|r| r.active)
        .map(|r| (r.strength(f, &text, &sig, rut.as_deref()), r))
        .filter(|(s, _)| *s > 0)
        .collect();
    hits.sort_by(|a, b| {
        b.0.cmp(&a.0)
            .then((b.1.origin == "manual").cmp(&(a.1.origin == "manual")))
            .then(b.1.pattern.len().cmp(&a.1.pattern.len()))
            .then(b.1.hits.cmp(&a.1.hits))
    });
    hits.into_iter().map(|(_, r)| r).collect()
}

/// En qué terminó una conciliación hecha por la persona (lo que se aprende).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Outcome {
    Customer(i64),
    Supplier(i64),
    Expense {
        category_id: i64,
        tax_included: bool,
    },
    Transfer(i64),
}

impl Outcome {
    fn same(&self, r: &Rule) -> bool {
        match *self {
            Outcome::Customer(id) => r.action == "cliente" && r.customer_id == Some(id),
            Outcome::Supplier(id) => r.action == "proveedor" && r.supplier_id == Some(id),
            Outcome::Expense { category_id, .. } => {
                r.action == "gasto" && r.category_id == Some(category_id)
            }
            Outcome::Transfer(id) => r.action == "traspaso" && r.account_id == Some(id),
        }
    }

    fn label(&self, conn: &Connection) -> AppResult<String> {
        let q = |sql: &str, id: i64| -> AppResult<String> {
            Ok(conn
                .query_row(sql, [id], |r| r.get::<_, String>(0))
                .optional()?
                .unwrap_or_default())
        };
        Ok(match *self {
            Outcome::Customer(id) => q("SELECT name FROM customers WHERE id = ?1", id)?,
            Outcome::Supplier(id) => q("SELECT name FROM suppliers WHERE id = ?1", id)?,
            Outcome::Expense { category_id, .. } => format!(
                "gasto de {}",
                q(
                    "SELECT name FROM expense_categories WHERE id = ?1",
                    category_id
                )?
            ),
            Outcome::Transfer(id) => format!(
                "traspaso con {}",
                q("SELECT name FROM money_accounts WHERE id = ?1", id)?
            ),
        })
    }
}

/// (acción, cliente, proveedor, categoría, cuenta, ¿con IVA incluido?) de una regla aprendida.
type Learned = (
    &'static str,
    Option<i64>,
    Option<i64>,
    Option<i64>,
    Option<i64>,
    Option<bool>,
);

/// Anota lo aprendido de una conciliación: suma un acierto a la regla que ya lo decía, corrige la
/// aprendida que decía otra cosa, o crea una nueva.
pub(crate) fn learn(conn: &Connection, f: &Facts<'_>, outcome: Outcome) -> AppResult<()> {
    let now = now_utc();
    let rules = load(conn, false)?;
    if let Some(r) = matching(&rules, f).into_iter().find(|r| outcome.same(r)) {
        conn.execute(
            "UPDATE bank_rules SET hits = hits + 1, last_hit_at = ?2 WHERE id = ?1",
            params![r.id, now],
        )?;
        return Ok(());
    }
    let rut = f.rut.and_then(rut_key);
    let sig = signature(
        f.name
            .filter(|n| !n.trim().is_empty())
            .unwrap_or(f.description),
    );
    if rut.is_none() && sig.len() < 4 {
        return Ok(());
    }
    let direction = if f.amount > 0 { "abono" } else { "cargo" };
    let (action, customer, supplier, category, account, tax): Learned = match outcome {
        Outcome::Customer(id) => ("cliente", Some(id), None, None, None, None),
        Outcome::Supplier(id) => ("proveedor", None, Some(id), None, None, None),
        Outcome::Expense {
            category_id,
            tax_included,
        } => (
            "gasto",
            None,
            None,
            Some(category_id),
            None,
            Some(tax_included),
        ),
        Outcome::Transfer(id) => ("traspaso", None, None, None, Some(id), None),
    };
    let who = f
        .name
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .map(String::from)
        .unwrap_or_else(|| sig.to_uppercase());
    let name: String = format!("{who} → {}", outcome.label(conn)?)
        .chars()
        .take(160)
        .collect();
    // Una aprendida con la misma llave (RUT o glosa) que decía otra cosa se corrige.
    let existing = rules.iter().find(|r| {
        r.origin == "aprendida"
            && r.direction == direction
            && match (&rut, &r.rut) {
                (Some(a), Some(b)) => a == b,
                (None, None) => r.pattern == sig,
                _ => false,
            }
    });
    match existing {
        Some(r) => {
            conn.execute(
                "UPDATE bank_rules SET name = ?2, action = ?3, customer_id = ?4, supplier_id = ?5, category_id = ?6,
                    account_id = ?7, tax_included = ?8, hits = hits + 1, last_hit_at = ?9, active = 1, updated_at = ?9
                 WHERE id = ?1",
                params![r.id, name, action, customer, supplier, category, account, tax, now],
            )?;
        }
        None => {
            conn.execute(
                "INSERT INTO bank_rules (uid, name, pattern, rut, direction, action, customer_id, supplier_id, category_id,
                    account_id, tax_included, origin, hits, last_hit_at, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'aprendida', 1, ?12, ?12, ?12)",
                params![uuid::Uuid::now_v7().to_string(), name, if rut.is_some() { String::new() } else { sig },
                    rut, direction, action, customer, supplier, category, account, tax, now],
            )?;
        }
    }
    Ok(())
}

/* ───────────────────────────── Lo que ve y edita la persona ───────────────────────────── */

#[derive(Debug, Clone, Serialize)]
pub struct BankRule {
    pub uid: String,
    pub name: String,
    pub pattern: String,
    pub rut: Option<String>,
    pub direction: String,
    pub action: String,
    pub customer_uid: Option<String>,
    pub supplier_uid: Option<String>,
    pub category_id: Option<i64>,
    pub account_uid: Option<String>,
    /// A qué lleva, en palabras («Clínica Sur», «gasto de Combustible»…).
    pub target: String,
    pub tax_included: Option<bool>,
    pub note: Option<String>,
    /// "manual" o "aprendida".
    pub origin: String,
    pub hits: i64,
    pub last_hit_at: Option<String>,
    pub active: bool,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct BankRuleInput {
    pub name: String,
    /// Texto que debe aparecer en la glosa (o en el nombre de quien transfiere).
    pub pattern: String,
    pub rut: Option<String>,
    pub direction: String,
    pub action: String,
    pub customer_uid: Option<String>,
    pub supplier_uid: Option<String>,
    pub category_id: Option<i64>,
    pub account_uid: Option<String>,
    pub tax_included: Option<bool>,
    pub note: Option<String>,
    pub active: Option<bool>,
}

impl CompanySession {
    fn bank_rule_view(&self, r: Rule) -> AppResult<BankRule> {
        let conn = self.db.conn();
        let uid_of = |table: &str, id: Option<i64>| -> AppResult<Option<(String, String)>> {
            match id {
                Some(id) => Ok(conn
                    .query_row(
                        &format!("SELECT uid, name FROM {table} WHERE id = ?1"),
                        [id],
                        |x| Ok((x.get(0)?, x.get(1)?)),
                    )
                    .optional()?),
                None => Ok(None),
            }
        };
        let customer = uid_of("customers", r.customer_id)?;
        let supplier = uid_of("suppliers", r.supplier_id)?;
        let account = uid_of("money_accounts", r.account_id)?;
        let category: Option<String> = match r.category_id {
            Some(id) => conn
                .query_row(
                    "SELECT name FROM expense_categories WHERE id = ?1",
                    [id],
                    |x| x.get(0),
                )
                .optional()?,
            None => None,
        };
        let target = match r.action.as_str() {
            "cliente" => customer.as_ref().map(|c| c.1.clone()).unwrap_or_default(),
            "proveedor" => supplier.as_ref().map(|c| c.1.clone()).unwrap_or_default(),
            "gasto" => format!("gasto de {}", category.unwrap_or_default()),
            "traspaso" => format!(
                "traspaso con {}",
                account.as_ref().map(|c| c.1.clone()).unwrap_or_default()
            ),
            _ => "se ignora".into(),
        };
        Ok(BankRule {
            uid: r.uid,
            name: r.name,
            pattern: r.pattern,
            rut: r.rut,
            direction: r.direction,
            action: r.action,
            customer_uid: customer.map(|c| c.0),
            supplier_uid: supplier.map(|c| c.0),
            category_id: r.category_id,
            account_uid: account.map(|c| c.0),
            target,
            tax_included: r.tax_included,
            note: r.note,
            origin: r.origin,
            hits: r.hits,
            last_hit_at: r.last_hit_at,
            active: r.active,
        })
    }

    pub fn bank_rules(&self) -> AppResult<Vec<BankRule>> {
        self.require("dinero.ver")?;
        load(self.db.conn(), false)?
            .into_iter()
            .map(|r| self.bank_rule_view(r))
            .collect()
    }

    /// Crea (sin `uid`) o cambia una regla. Una regla aprendida que la persona edita pasa a manual.
    pub fn save_bank_rule(
        &mut self,
        input: &BankRuleInput,
        uid: Option<&str>,
    ) -> AppResult<Vec<BankRule>> {
        let user = self.require("dinero.registrar")?.username.clone();
        let conn = self.db.conn();
        if !DIRECTIONS.contains(&input.direction.as_str()) {
            return Err(AppError::Validation("sentido: abono, cargo o ambos".into()));
        }
        if !ACTIONS.contains(&input.action.as_str()) {
            return Err(AppError::Validation(
                "la regla lleva a: cliente, proveedor, gasto, traspaso o ignorar".into(),
            ));
        }
        let pattern = fold(&input.pattern);
        let rut = match input
            .rut
            .as_deref()
            .map(str::trim)
            .filter(|r| !r.is_empty())
        {
            Some(r) => {
                Some(rut_key(r).ok_or_else(|| AppError::Validation("el RUT no es válido".into()))?)
            }
            None => None,
        };
        if rut.is_none() && pattern.len() < 3 {
            return Err(AppError::Validation(
                "escribe el texto que debe aparecer en la glosa (al menos 3 letras) o el RUT"
                    .into(),
            ));
        }
        if pattern.len() > 120 {
            return Err(AppError::Validation("el texto es demasiado largo".into()));
        }
        let need = |v: &Option<String>, what: &str| -> AppResult<String> {
            v.as_deref()
                .map(str::trim)
                .filter(|x| !x.is_empty())
                .map(String::from)
                .ok_or_else(|| AppError::Validation(format!("elige {what}")))
        };
        let (mut customer, mut supplier, mut category, mut account, mut tax) =
            (None, None, None, None, None);
        let target: String;
        match input.action.as_str() {
            "cliente" => {
                if input.direction == "cargo" {
                    return Err(AppError::Validation(
                        "una regla de cliente aplica a abonos".into(),
                    ));
                }
                let c = customers::by_uid(conn, &need(&input.customer_uid, "el cliente")?)?
                    .ok_or_else(|| AppError::NotFound("el cliente".into()))?;
                target = c.name.clone();
                customer = Some(c.id);
            }
            "proveedor" => {
                if input.direction == "abono" {
                    return Err(AppError::Validation(
                        "una regla de proveedor aplica a cargos".into(),
                    ));
                }
                let s = suppliers::by_uid(conn, &need(&input.supplier_uid, "el proveedor")?)?
                    .ok_or_else(|| AppError::NotFound("el proveedor".into()))?;
                target = s.name.clone();
                supplier = Some(s.id);
            }
            "gasto" => {
                if input.direction == "abono" {
                    return Err(AppError::Validation(
                        "una regla de gasto aplica a cargos".into(),
                    ));
                }
                let id = input
                    .category_id
                    .ok_or_else(|| AppError::Validation("elige la categoría del gasto".into()))?;
                let name: String = conn
                    .query_row(
                        "SELECT name FROM expense_categories WHERE id = ?1 AND archived_at IS NULL",
                        [id],
                        |r| r.get(0),
                    )
                    .optional()?
                    .ok_or_else(|| AppError::NotFound("la categoría".into()))?;
                target = format!("gasto de {name}");
                category = Some(id);
                tax = Some(input.tax_included.unwrap_or(false));
            }
            "traspaso" => {
                let (id, name): (i64, String) = conn
                    .query_row(
                        "SELECT id, name FROM money_accounts WHERE uid = ?1",
                        [need(&input.account_uid, "la otra cuenta")?],
                        |r| Ok((r.get(0)?, r.get(1)?)),
                    )
                    .optional()?
                    .ok_or_else(|| AppError::NotFound("la cuenta".into()))?;
                target = format!("traspaso con {name}");
                account = Some(id);
            }
            _ => {
                if input
                    .note
                    .as_deref()
                    .map(str::trim)
                    .is_none_or(|n| n.is_empty())
                {
                    return Err(AppError::Validation(
                        "escribe por qué se ignoran esos movimientos (queda como nota en cada uno)"
                            .into(),
                    ));
                }
                target = "se ignora".into();
            }
        }
        let note: Option<String> = input
            .note
            .as_deref()
            .map(str::trim)
            .filter(|n| !n.is_empty())
            .map(|n| n.chars().take(300).collect());
        let name: String = match input.name.trim() {
            "" => format!(
                "{} → {target}",
                if pattern.is_empty() {
                    format!("RUT {}", rut.clone().unwrap_or_default())
                } else {
                    pattern.to_uppercase()
                }
            ),
            n => n.to_string(),
        }
        .chars()
        .take(160)
        .collect();
        let now = now_utc();
        let active = input.active.unwrap_or(true);
        let out_uid = match uid {
            Some(u) => {
                let n = conn.execute(
                    "UPDATE bank_rules SET name = ?2, pattern = ?3, rut = ?4, direction = ?5, action = ?6, customer_id = ?7,
                        supplier_id = ?8, category_id = ?9, account_id = ?10, tax_included = ?11, note = ?12, origin = 'manual',
                        active = ?13, updated_at = ?14 WHERE uid = ?1",
                    params![u, name, pattern, rut, input.direction, input.action, customer, supplier, category, account,
                        tax, note, active, now],
                )?;
                if n == 0 {
                    return Err(AppError::NotFound("la regla".into()));
                }
                u.to_string()
            }
            None => {
                let new_uid = uuid::Uuid::now_v7().to_string();
                conn.execute(
                    "INSERT INTO bank_rules (uid, name, pattern, rut, direction, action, customer_id, supplier_id, category_id,
                        account_id, tax_included, note, origin, active, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 'manual', ?13, ?14, ?14)",
                    params![new_uid, name, pattern, rut, input.direction, input.action, customer, supplier, category,
                        account, tax, note, active, now],
                )?;
                new_uid
            }
        };
        log(
            conn,
            &user,
            if uid.is_some() { "update" } else { "create" },
            "regla_banco",
            &out_uid,
            &format!("Regla de conciliación «{name}»"),
            None,
        )?;
        self.bank_rules()
    }

    pub fn delete_bank_rule(&mut self, uid: &str) -> AppResult<Vec<BankRule>> {
        let user = self.require("dinero.registrar")?.username.clone();
        let conn = self.db.conn();
        let name: String = conn
            .query_row("SELECT name FROM bank_rules WHERE uid = ?1", [uid], |r| {
                r.get(0)
            })
            .optional()?
            .ok_or_else(|| AppError::NotFound("la regla".into()))?;
        conn.execute("DELETE FROM bank_rules WHERE uid = ?1", [uid])?;
        log(
            conn,
            &user,
            "delete",
            "regla_banco",
            uid,
            &format!("Eliminó la regla de conciliación «{name}»"),
            None,
        )?;
        self.bank_rules()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn firma_y_rut() {
        assert_eq!(
            signature("Transferencia de CLÍNICA SUR SPA 0012345"),
            "clinica sur spa"
        );
        assert_eq!(signature("COMPRA REDCOMPRA COPEC 1234 STGO"), "copec stgo");
        assert_eq!(signature("TEF 99887766"), "");
        assert_eq!(rut_key("77.334.963-0").as_deref(), Some("773349630"));
        assert_eq!(rut_key("12.345.678-k").as_deref(), Some("12345678K"));
        assert_eq!(rut_key("ventas"), None);
        assert_eq!(rut_key("123"), None);
    }
}
