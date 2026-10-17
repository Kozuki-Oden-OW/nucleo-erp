//! Conciliación bancaria con cartola (Fase 8, pendiente D-F8-09): se sube la cartola del banco ya
//! leída por la interfaz (CSV o Excel → filas normalizadas) y cada movimiento se concilia con lo
//! registrado en NÚCLEO o se registra en el momento: un abono puede ser el cobro de una venta, un
//! cargo puede ser el pago de una compra o de un gasto, o un gasto nuevo con su categoría sugerida
//! por la descripción (COPEC → Combustible, ENTEL → Internet y telefonía…), o un traspaso entre
//! cuentas propias. Lo que no corresponde se ignora con una nota.

use crate::company::CompanySession;
use crate::finance_ops::{ExpenseInput, MoneyTransferInput};
use crate::inventory_ops::{date_ord, date_str};
use crate::sales_ops::{local_today, log, parse_date};
use crate::{AppError, AppResult};
use nucleo_db::finance::{self as fdb, AccountRow};
use nucleo_db::now_utc;
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

/// Días de diferencia aceptados entre la fecha del banco y la registrada en NÚCLEO.
const DATE_WINDOW: i64 = 7;
const MAX_LINES: usize = 5_000;

/* ───────────────────────────── Tipos ───────────────────────────── */

#[derive(Debug, Clone, Deserialize)]
pub struct StatementLineInput {
    pub date: String,
    pub description: String,
    pub reference: Option<String>,
    /// Positivo: abono (entra dinero). Negativo: cargo (sale dinero).
    pub amount_minor: i64,
    pub balance_minor: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ImportStatementInput {
    pub account_uid: String,
    pub file_name: Option<String>,
    pub lines: Vec<StatementLineInput>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImportStatementResult {
    pub statement_uid: String,
    pub added: i64,
    pub duplicates: i64,
    pub auto_matched: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Suggestion {
    /// "vincular", "vincular_traspaso", "cobrar", "pagar_compra", "pagar_gasto", "gasto" o "traspaso".
    pub action: String,
    pub target_uid: Option<String>,
    pub label: String,
    pub detail: String,
    /// 0 a 100: qué tan probable es.
    pub score: i64,
    pub category_id: Option<i64>,
    pub category: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MatchedRef {
    /// "pago" (cobro o pago) o "traspaso".
    pub kind: String,
    pub label: String,
    pub link: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct StatementLineView {
    pub uid: String,
    pub date: String,
    pub description: String,
    pub reference: Option<String>,
    pub amount_minor: i64,
    pub balance_minor: Option<i64>,
    /// "pendiente", "conciliado" o "ignorado".
    pub status: String,
    pub matched: Option<MatchedRef>,
    pub note: Option<String>,
    pub suggestions: Vec<Suggestion>,
}

#[derive(Debug, Clone, Serialize)]
pub struct StatementSummary {
    pub uid: String,
    pub file_name: Option<String>,
    pub period_from: Option<String>,
    pub period_to: Option<String>,
    pub lines: i64,
    pub imported_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct UnmatchedMove {
    pub date: String,
    pub document: String,
    pub detail: String,
    pub amount_minor: i64,
    pub link: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReconciliationView {
    pub account: AccountRow,
    pub statements: Vec<StatementSummary>,
    pub lines: Vec<StatementLineView>,
    /// Último saldo informado por la cartola y su fecha.
    pub statement_balance_minor: Option<i64>,
    pub statement_date: Option<String>,
    /// Saldo de la cuenta en NÚCLEO a esa misma fecha.
    pub nucleo_balance_minor: Option<i64>,
    pub pending: i64,
    pub reconciled: i64,
    pub ignored: i64,
    /// Cobros, pagos y traspasos de la cuenta, dentro del período de las cartolas, que no aparecen en ellas.
    pub unmatched: Vec<UnmatchedMove>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ReconcileAction {
    /// "vincular", "vincular_traspaso", "cobrar", "pagar_compra", "pagar_gasto", "gasto", "traspaso",
    /// "ignorar" o "deshacer".
    pub kind: String,
    pub target_uid: Option<String>,
    pub category_id: Option<i64>,
    pub description: Option<String>,
    pub tax_included: Option<bool>,
    pub supplier_uid: Option<String>,
    pub note: Option<String>,
}

/* ───────────────────────────── Utilidades ───────────────────────────── */

/// Texto en minúsculas, sin tildes ni signos, para comparar descripciones.
pub(crate) fn fold(s: &str) -> String {
    s.to_lowercase()
        .chars()
        .map(|c| match c {
            'á' | 'à' | 'ä' | 'â' => 'a',
            'é' | 'è' | 'ë' | 'ê' => 'e',
            'í' | 'ì' | 'ï' | 'î' => 'i',
            'ó' | 'ò' | 'ö' | 'ô' => 'o',
            'ú' | 'ù' | 'ü' | 'û' => 'u',
            'ñ' => 'n',
            c if c.is_alphanumeric() => c,
            _ => ' ',
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Categoría de gasto probable según palabras de la descripción del banco (nombre de la categoría).
pub fn guess_category(description: &str) -> Option<&'static str> {
    const RULES: &[(&[&str], &str)] = &[
        (
            &[
                "copec",
                "shell",
                "petrobras",
                "enex",
                "aramco",
                "terpel",
                "bencin",
                "combustible",
            ],
            "Combustible",
        ),
        (
            &[
                "autopista",
                "peaje",
                "costanera",
                "vespucio",
                "tag ",
                "estacionam",
                "parking",
                "ruta 5",
                "ruta 68",
            ],
            "Peajes y estacionamientos",
        ),
        (
            &[
                "entel",
                "movistar",
                "claro",
                "wom ",
                "vtr",
                "gtd",
                "mundo pacifico",
                "telefonica",
                "internet",
            ],
            "Internet y telefonía",
        ),
        (
            &["enel", "cge", "chilquinta", "saesa", "frontel", "luz "],
            "Electricidad",
        ),
        (
            &[
                "aguas andinas",
                "essbio",
                "esval",
                "nuevosur",
                "aguas del",
                "agua potable",
                "smapa",
            ],
            "Agua",
        ),
        (&["metrogas", "abastible", "lipigas", "gasco"], "Gas"),
        (&["arriendo"], "Arriendo"),
        (&["remuneracion", "sueldo", "liquidacion"], "Remuneraciones"),
        (&["honorario"], "Honorarios"),
        (&["seguro"], "Seguros"),
        (&["interes"], "Intereses de créditos"),
        (
            &[
                "tesoreria",
                "tgr ",
                "servicio de impuestos",
                "contribucion",
                "impuesto",
                "f29",
                "formulario 29",
            ],
            "Impuestos y contribuciones",
        ),
        (
            &[
                "comision",
                "mantencion cuenta",
                "cargo mantencion",
                "costo mantencion",
                "timbre",
            ],
            "Comisiones bancarias",
        ),
        (
            &[
                "google ads",
                "facebook",
                "meta platforms",
                "fb.me",
                "instagram",
                "mercado ads",
                "publicidad",
            ],
            "Publicidad y marketing",
        ),
        (
            &[
                "google",
                "microsoft",
                "adobe",
                "amazon web",
                "aws",
                "apple com",
                "dropbox",
                "zoom",
                "shopify",
                "wix",
                "hostgator",
                "canva",
                "openai",
                "anthropic",
                "software",
            ],
            "Software",
        ),
        (
            &[
                "mercado pago",
                "mercadopago",
                "transbank",
                "getnet",
                "flow ",
                "khipu",
                "sumup",
            ],
            "Comisiones de venta y plataformas",
        ),
        (
            &[
                "uber", "cabify", "didi", "metro ", "bip ", "turbus", "pullman", "taxi",
            ],
            "Transporte",
        ),
        (
            &["latam", "sky airline", "jetsmart", "pasaje"],
            "Viajes y pasajes",
        ),
        (&["hotel", "airbnb", "booking", "hostal"], "Alojamiento"),
        (
            &[
                "restaurant",
                "rest ",
                "cafe",
                "starbucks",
                "mcdonald",
                "burger",
                "pedidosya",
                "rappi",
                "uber eats",
                "sushi",
                "pizza",
            ],
            "Alimentación y comidas",
        ),
        (&["libreria", "office", "papeleria"], "Útiles de oficina"),
        (
            &[
                "chilexpress",
                "starken",
                "correos de chile",
                "bluexpress",
                "blue express",
            ],
            "Logística",
        ),
        (
            &["sodimac", "easy ", "construmart", "imperial"],
            "Materiales",
        ),
        (
            &["contador", "contabilidad", "asesoria"],
            "Contabilidad y asesorías",
        ),
    ];
    let d = format!(" {} ", fold(description));
    RULES
        .iter()
        // Cada clave debe empezar una palabra («claro» no calza con «declaro»).
        .find(|(keys, _)| keys.iter().any(|k| d.contains(&format!(" {k}"))))
        .map(|(_, c)| *c)
}

/// Huella de un movimiento: fecha, monto, descripción y referencia normalizadas, y su repetición.
fn fingerprint(l: &StatementLineInput, n: usize) -> String {
    format!(
        "{}|{}|{}|{}|{n}",
        l.date,
        l.amount_minor,
        fold(&l.description),
        fold(l.reference.as_deref().unwrap_or(""))
    )
}

/// Palabras de 4+ letras de un nombre (para reconocer al cliente o proveedor en la descripción).
fn name_hit(description: &str, name: &str) -> bool {
    let d = fold(description);
    fold(name)
        .split(' ')
        .filter(|w| {
            w.len() >= 4
                && ![
                    "spa",
                    "ltda",
                    "limitada",
                    "sociedad",
                    "comercial",
                    "servicios",
                ]
                .contains(w)
        })
        .any(|w| d.contains(w))
}

/* ───────────────────────────── Casos de uso ───────────────────────────── */

impl CompanySession {
    fn bank_account(&self, uid: &str) -> AppResult<AccountRow> {
        fdb::account_by_uid(self.db.conn(), uid)?
            .ok_or_else(|| AppError::NotFound("la cuenta".into()))
    }

    /// Guarda los movimientos de una cartola (sin duplicar los ya subidos) y concilia los evidentes.
    pub fn import_bank_statement(
        &mut self,
        input: &ImportStatementInput,
    ) -> AppResult<ImportStatementResult> {
        self.require("dinero.registrar")?;
        let account = self.bank_account(&input.account_uid)?;
        if input.lines.is_empty() {
            return Err(AppError::Validation(
                "la cartola no trae movimientos".into(),
            ));
        }
        if input.lines.len() > MAX_LINES {
            return Err(AppError::Validation(format!(
                "hasta {MAX_LINES} movimientos por cartola"
            )));
        }
        let mut clean = Vec::with_capacity(input.lines.len());
        for (i, l) in input.lines.iter().enumerate() {
            let date = parse_date(&format!("la fecha de la fila {}", i + 1), &l.date)?;
            if l.amount_minor == 0 || l.amount_minor.abs() > 10_000_000_000_000 {
                return Err(AppError::Validation(format!(
                    "revisa el monto de la fila {}",
                    i + 1
                )));
            }
            let desc: String = l.description.trim().chars().take(300).collect();
            clean.push(StatementLineInput {
                date,
                description: if desc.is_empty() {
                    "Movimiento".into()
                } else {
                    desc
                },
                reference: l
                    .reference
                    .as_deref()
                    .map(str::trim)
                    .filter(|r| !r.is_empty())
                    .map(|r| r.chars().take(80).collect()),
                amount_minor: l.amount_minor,
                balance_minor: l.balance_minor,
            });
        }
        let from = clean.iter().map(|l| l.date.clone()).min();
        let to = clean.iter().map(|l| l.date.clone()).max();
        let by = self.user_id();
        let user = self.actor_name()?;
        let now = now_utc();
        let suid = uuid::Uuid::now_v7().to_string();
        let tx = self.db.conn_mut().transaction()?;
        tx.execute(
            "INSERT INTO bank_statements (uid, money_account_id, file_name, period_from, period_to, imported_by, imported_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![suid, account.id, input.file_name.as_deref().map(|f| f.chars().take(200).collect::<String>()), from, to, by, now],
        )?;
        let sid = tx.last_insert_rowid();
        let mut seen: HashMap<String, usize> = HashMap::new();
        let (mut added, mut dup) = (0i64, 0i64);
        for l in &clean {
            let base = fingerprint(l, 0);
            let n = seen.entry(base).or_insert(0);
            let fp = fingerprint(l, *n);
            *n += 1;
            let ok = tx.execute(
                "INSERT OR IGNORE INTO bank_statement_lines (uid, statement_id, money_account_id, line_date, description, reference, amount_minor, balance_minor, fingerprint)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                rusqlite::params![uuid::Uuid::now_v7().to_string(), sid, account.id, l.date, l.description, l.reference, l.amount_minor, l.balance_minor, fp],
            )?;
            if ok == 1 {
                added += 1;
            } else {
                dup += 1;
            }
        }
        tx.execute(
            "UPDATE bank_statements SET lines_count = ?2 WHERE id = ?1",
            [sid, added],
        )?;
        let auto = auto_match(&tx, account.id, by, &now)?;
        log(
            &tx,
            &user,
            "banco.cartola",
            "cuenta",
            &account.uid,
            &format!(
                "Cartola de {}: {added} movimientos nuevos, {dup} repetidos, {auto} conciliados solos",
                account.name
            ),
            None,
        )?;
        tx.commit()?;
        Ok(ImportStatementResult {
            statement_uid: suid,
            added,
            duplicates: dup,
            auto_matched: auto,
        })
    }

    /// Movimientos de la cartola de una cuenta con su estado y sugerencias, y el cuadre de saldos.
    pub fn bank_reconciliation(&self, account_uid: &str) -> AppResult<ReconciliationView> {
        self.require("dinero.ver")?;
        let account = self.bank_account(account_uid)?;
        let conn = self.db.conn();
        let today = local_today(conn)?;
        let since = date_str(date_ord(&today).unwrap_or(0) - 400);
        let statements = {
            let mut stmt = conn.prepare(
                "SELECT uid, file_name, period_from, period_to, lines_count, imported_at FROM bank_statements
                 WHERE money_account_id = ?1 ORDER BY id DESC LIMIT 50",
            )?;
            stmt.query_map([account.id], |r| {
                Ok(StatementSummary {
                    uid: r.get(0)?,
                    file_name: r.get(1)?,
                    period_from: r.get(2)?,
                    period_to: r.get(3)?,
                    lines: r.get(4)?,
                    imported_at: r.get(5)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?
        };
        type Raw = (
            i64,
            String,
            String,
            String,
            Option<String>,
            i64,
            Option<i64>,
            String,
            Option<i64>,
            Option<i64>,
            Option<String>,
        );
        let raw: Vec<Raw> = {
            let mut stmt = conn.prepare(
                "SELECT id, uid, line_date, description, reference, amount_minor, balance_minor, status, payment_id, transfer_id, note
                 FROM bank_statement_lines WHERE money_account_id = ?1 AND line_date >= ?2 ORDER BY line_date DESC, id DESC",
            )?;
            stmt.query_map(rusqlite::params![account.id, since], |r| {
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
            .collect::<Result<_, _>>()?
        };
        let ctx = SuggestCtx::load(conn, account.id)?;
        let mut lines = Vec::with_capacity(raw.len());
        let (mut pending, mut reconciled, mut ignored) = (0, 0, 0);
        for (_, uid, date, desc, reference, amount, balance, status, pid, tid, note) in raw {
            match status.as_str() {
                "pendiente" => pending += 1,
                "conciliado" => reconciled += 1,
                _ => ignored += 1,
            }
            let matched = match (pid, tid) {
                (Some(p), _) => matched_payment(conn, p)?,
                (_, Some(t)) => matched_transfer(conn, t, account.id)?,
                _ => None,
            };
            let suggestions = if status == "pendiente" {
                ctx.suggest(&date, &desc, reference.as_deref(), amount)
            } else {
                Vec::new()
            };
            lines.push(StatementLineView {
                uid,
                date,
                description: desc,
                reference,
                amount_minor: amount,
                balance_minor: balance,
                status,
                matched,
                note,
                suggestions,
            });
        }
        // Cuadre: último saldo informado por el banco contra el saldo de NÚCLEO a esa fecha.
        let last: Option<(String, i64)> = conn
            .query_row(
                "SELECT line_date, balance_minor FROM bank_statement_lines WHERE money_account_id = ?1 AND balance_minor IS NOT NULL
                 ORDER BY line_date DESC, id DESC LIMIT 1",
                [account.id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        let nucleo_at = match &last {
            Some((d, _)) => Some(balance_at(conn, account.id, d)?),
            None => None,
        };
        // Movimientos de NÚCLEO en el período de las cartolas que no aparecen en ellas.
        let range: Option<(String, String)> = conn
            .query_row(
                "SELECT min(line_date), max(line_date) FROM bank_statement_lines WHERE money_account_id = ?1",
                [account.id],
                |r| Ok((r.get::<_, Option<String>>(0)?, r.get::<_, Option<String>>(1)?)),
            )
            .map(|(a, b)| a.zip(b))?;
        let mut unmatched = Vec::new();
        if let Some((a, b)) = range {
            let mut stmt = conn.prepare(
                "SELECT p.payment_date, p.number, CASE p.direction WHEN 'entrada' THEN p.amount_minor ELSE -p.amount_minor END,
                    coalesce(p.reference, ''), p.direction
                 FROM payments p WHERE p.money_account_id = ?1 AND p.status = 'vigente' AND p.payment_date BETWEEN ?2 AND ?3
                   AND NOT EXISTS (SELECT 1 FROM bank_statement_lines l WHERE l.payment_id = p.id)
                 UNION ALL
                 SELECT t.transfer_date, 'Traspaso', CASE WHEN t.to_account_id = ?1 THEN t.amount_minor ELSE -t.amount_minor END,
                    coalesce(t.notes, ''), 'traspaso'
                 FROM money_transfers t WHERE (t.to_account_id = ?1 OR t.from_account_id = ?1) AND t.transfer_date BETWEEN ?2 AND ?3
                   AND NOT EXISTS (SELECT 1 FROM bank_statement_lines l WHERE l.transfer_id = t.id AND l.money_account_id = ?1)
                 ORDER BY 1 DESC LIMIT 200",
            )?;
            unmatched = stmt
                .query_map(rusqlite::params![account.id, a, b], |r| {
                    let dir: String = r.get(4)?;
                    let refr: String = r.get(3)?;
                    Ok(UnmatchedMove {
                        date: r.get(0)?,
                        document: r.get(1)?,
                        detail: match dir.as_str() {
                            "entrada" => "Cobro registrado".to_string(),
                            "salida" => "Pago registrado".to_string(),
                            _ => "Traspaso entre cuentas".to_string(),
                        } + &if refr.is_empty() {
                            String::new()
                        } else {
                            format!(" · {refr}")
                        },
                        amount_minor: r.get(2)?,
                        link: None,
                    })
                })?
                .collect::<Result<_, _>>()?;
        }
        Ok(ReconciliationView {
            account,
            statements,
            lines,
            statement_balance_minor: last.as_ref().map(|l| l.1),
            statement_date: last.map(|l| l.0),
            nucleo_balance_minor: nucleo_at,
            pending,
            reconciled,
            ignored,
            unmatched,
        })
    }

    /// Concilia un movimiento: lo vincula, registra el documento que corresponde, lo ignora o lo deshace.
    pub fn reconcile_bank_line(
        &mut self,
        line_uid: &str,
        action: &ReconcileAction,
    ) -> AppResult<ReconciliationView> {
        self.require("dinero.registrar")?;
        let (id, acc_id, date, desc, amount, status): (i64, i64, String, String, i64, String) = self
            .db
            .conn()
            .query_row(
                "SELECT id, money_account_id, line_date, description, amount_minor, status FROM bank_statement_lines WHERE uid = ?1",
                [line_uid],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
            )
            .optional()?
            .ok_or_else(|| AppError::NotFound("el movimiento".into()))?;
        let account = fdb::accounts(self.db.conn())?
            .into_iter()
            .find(|a| a.id == acc_id)
            .ok_or_else(|| AppError::NotFound("la cuenta".into()))?;
        if action.kind != "deshacer" && status != "pendiente" {
            return Err(AppError::Validation(
                "ese movimiento ya está conciliado o ignorado: deshazlo primero".into(),
            ));
        }
        let target = || {
            action
                .target_uid
                .as_deref()
                .map(str::trim)
                .filter(|t| !t.is_empty())
                .ok_or_else(|| AppError::Validation("elige con qué conciliar".into()))
        };
        let abs = amount.abs();
        let last_payment = |conn: &Connection| -> AppResult<i64> {
            Ok(
                conn.query_row("SELECT coalesce(max(id), 0) FROM payments", [], |r| {
                    r.get(0)
                })?,
            )
        };
        let new_payment = |conn: &Connection, after: i64| -> AppResult<i64> {
            conn.query_row(
                "SELECT id FROM payments WHERE id > ?1 AND money_account_id = ?2 AND amount_minor = ?3 ORDER BY id DESC LIMIT 1",
                rusqlite::params![after, acc_id, abs],
                |r| r.get(0),
            )
            .optional()?
            .ok_or_else(|| AppError::Validation("no se encontró el pago recién registrado".into()))
        };
        let (payment, transfer, note): (Option<i64>, Option<i64>, Option<String>) = match action
            .kind
            .as_str()
        {
            "vincular" => {
                let t = target()?;
                let (pid, dir, pamount, pacc, pstatus): (i64, String, i64, i64, String) = self
                    .db
                    .conn()
                    .query_row("SELECT id, direction, amount_minor, money_account_id, status FROM payments WHERE uid = ?1", [t], |r| {
                        Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
                    })
                    .optional()?
                    .ok_or_else(|| AppError::NotFound("el cobro o pago".into()))?;
                if pacc != acc_id
                    || pstatus != "vigente"
                    || pamount != abs
                    || (dir == "entrada") != (amount > 0)
                {
                    return Err(AppError::Validation(
                        "ese cobro o pago no coincide en cuenta, monto o sentido con el movimiento"
                            .into(),
                    ));
                }
                (Some(pid), None, None)
            }
            "vincular_traspaso" => {
                let t = target()?;
                let (tid, from, to, tamount): (i64, i64, i64, i64) = self
                    .db
                    .conn()
                    .query_row("SELECT id, from_account_id, to_account_id, amount_minor FROM money_transfers WHERE uid = ?1", [t], |r| {
                        Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
                    })
                    .optional()?
                    .ok_or_else(|| AppError::NotFound("el traspaso".into()))?;
                let ok = tamount == abs
                    && ((amount > 0 && to == acc_id) || (amount < 0 && from == acc_id));
                if !ok {
                    return Err(AppError::Validation(
                        "ese traspaso no coincide con el movimiento".into(),
                    ));
                }
                (None, Some(tid), None)
            }
            "cobrar" => {
                if amount <= 0 {
                    return Err(AppError::Validation(
                        "solo un abono puede ser el cobro de una venta".into(),
                    ));
                }
                let t = target()?.to_string();
                let before = last_payment(self.db.conn())?;
                self.register_payment(&t, abs, "Transferencia", &date, Some(&account.uid))?;
                (Some(new_payment(self.db.conn(), before)?), None, None)
            }
            "pagar_compra" | "pagar_gasto" => {
                if amount >= 0 {
                    return Err(AppError::Validation(
                        "solo un cargo puede ser un pago".into(),
                    ));
                }
                let t = target()?.to_string();
                let before = last_payment(self.db.conn())?;
                if action.kind == "pagar_compra" {
                    self.pay_purchase(&t, abs, "Transferencia", &date, Some(&account.uid))?;
                } else {
                    self.pay_expense(&t, abs, "Transferencia", &date, Some(&account.uid))?;
                }
                (Some(new_payment(self.db.conn(), before)?), None, None)
            }
            "gasto" => {
                if amount >= 0 {
                    return Err(AppError::Validation(
                        "solo un cargo puede registrarse como gasto".into(),
                    ));
                }
                let category_id = action
                    .category_id
                    .ok_or_else(|| AppError::Validation("elige la categoría del gasto".into()))?;
                let before = last_payment(self.db.conn())?;
                let description = action
                    .description
                    .as_deref()
                    .map(str::trim)
                    .filter(|d| !d.is_empty())
                    .map(String::from)
                    .unwrap_or_else(|| desc.chars().take(120).collect());
                self.register_expense(&ExpenseInput {
                    category_id,
                    supplier_uid: action.supplier_uid.clone(),
                    date: date.clone(),
                    description,
                    total_minor: abs,
                    tax_included: action.tax_included.unwrap_or(false),
                    due_date: None,
                    paid_method: Some("Transferencia".into()),
                    paid_account_uid: Some(account.uid.clone()),
                    notes: Some(format!("Desde la cartola: {desc}")),
                    recurring_id: None,
                    quantity_milli: None,
                    unit_minor: None,
                })?;
                (Some(new_payment(self.db.conn(), before)?), None, None)
            }
            "traspaso" => {
                let other = self.bank_account(target()?)?;
                if other.id == acc_id {
                    return Err(AppError::Validation(
                        "elige otra cuenta para el traspaso".into(),
                    ));
                }
                let (from, to) = if amount > 0 {
                    (other.uid.clone(), account.uid.clone())
                } else {
                    (account.uid.clone(), other.uid.clone())
                };
                let before: i64 = self.db.conn().query_row(
                    "SELECT coalesce(max(id), 0) FROM money_transfers",
                    [],
                    |r| r.get(0),
                )?;
                self.transfer_money(&MoneyTransferInput {
                    from_uid: from,
                    to_uid: to,
                    date: date.clone(),
                    amount_minor: abs,
                    notes: Some(desc.chars().take(200).collect()),
                })?;
                let tid: i64 = self.db.conn().query_row(
                    "SELECT max(id) FROM money_transfers WHERE id > ?1",
                    [before],
                    |r| r.get(0),
                )?;
                (None, Some(tid), None)
            }
            "ignorar" => {
                let n = action.note.as_deref().map(str::trim).filter(|n| !n.is_empty()).ok_or_else(|| {
                    AppError::Validation("escribe por qué se ignora (ej. aporte del dueño, préstamo, movimiento de otra empresa)".into())
                })?;
                (None, None, Some(n.chars().take(300).collect()))
            }
            "deshacer" => (None, None, None),
            _ => {
                return Err(AppError::Validation(
                    "acción de conciliación no válida".into(),
                ));
            }
        };
        let by = self.user_id();
        let user = self.actor_name()?;
        let now = now_utc();
        let tx = self.db.conn_mut().transaction()?;
        let (new_status, text) = match action.kind.as_str() {
            "deshacer" => (
                "pendiente",
                format!(
                    "Movimiento {date} {} vuelve a pendiente",
                    crate::insight_ops::money(amount)
                ),
            ),
            "ignorar" => (
                "ignorado",
                format!(
                    "Movimiento {date} {} ignorado",
                    crate::insight_ops::money(amount)
                ),
            ),
            k => (
                "conciliado",
                format!(
                    "Movimiento {date} {} conciliado ({k})",
                    crate::insight_ops::money(amount)
                ),
            ),
        };
        tx.execute(
            "UPDATE bank_statement_lines SET status = ?2, payment_id = ?3, transfer_id = ?4, note = ?5,
                reconciled_by = CASE WHEN ?2 = 'pendiente' THEN NULL ELSE ?6 END, reconciled_at = CASE WHEN ?2 = 'pendiente' THEN NULL ELSE ?7 END
             WHERE id = ?1",
            rusqlite::params![id, new_status, payment, transfer, note, by, now],
        )?;
        log(
            &tx,
            &user,
            "banco.conciliar",
            "cuenta",
            &account.uid,
            &text,
            action.note.as_deref(),
        )?;
        tx.commit()?;
        self.bank_reconciliation(&account.uid)
    }

    /// Concilia de una vez los movimientos con un solo cobro, pago o traspaso posible.
    pub fn auto_reconcile_bank(&mut self, account_uid: &str) -> AppResult<ReconciliationView> {
        self.require("dinero.registrar")?;
        let account = self.bank_account(account_uid)?;
        let by = self.user_id();
        let user = self.actor_name()?;
        let now = now_utc();
        let tx = self.db.conn_mut().transaction()?;
        let n = auto_match(&tx, account.id, by, &now)?;
        if n > 0 {
            log(
                &tx,
                &user,
                "banco.conciliar",
                "cuenta",
                &account.uid,
                &format!("{n} movimientos conciliados automáticamente"),
                None,
            )?;
        }
        tx.commit()?;
        self.bank_reconciliation(account_uid)
    }

    /// Elimina una cartola subida (sus movimientos); lo registrado desde ella se mantiene.
    pub fn delete_bank_statement(&mut self, statement_uid: &str) -> AppResult<()> {
        self.require("dinero.registrar")?;
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        let (sid, name): (i64, Option<String>) = tx
            .query_row(
                "SELECT id, file_name FROM bank_statements WHERE uid = ?1",
                [statement_uid],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?
            .ok_or_else(|| AppError::NotFound("la cartola".into()))?;
        tx.execute(
            "DELETE FROM bank_statement_lines WHERE statement_id = ?1",
            [sid],
        )?;
        tx.execute("DELETE FROM bank_statements WHERE id = ?1", [sid])?;
        log(
            &tx,
            &user,
            "banco.cartola_eliminar",
            "cartola",
            statement_uid,
            &format!("Cartola eliminada: {}", name.unwrap_or_default()),
            None,
        )?;
        tx.commit()?;
        Ok(())
    }
}

/* ───────────────────────────── Búsqueda de coincidencias ───────────────────────────── */

/// Saldo de una cuenta al cierre de un día.
fn balance_at(conn: &Connection, account_id: i64, date: &str) -> AppResult<i64> {
    Ok(conn.query_row(
        "SELECT a.opening_minor
            + coalesce((SELECT sum(CASE p.direction WHEN 'entrada' THEN p.amount_minor ELSE -p.amount_minor END)
                        FROM payments p WHERE p.money_account_id = a.id AND p.status = 'vigente' AND p.payment_date <= ?2), 0)
            + coalesce((SELECT sum(t.amount_minor) FROM money_transfers t WHERE t.to_account_id = a.id AND t.transfer_date <= ?2), 0)
            - coalesce((SELECT sum(t.amount_minor) FROM money_transfers t WHERE t.from_account_id = a.id AND t.transfer_date <= ?2), 0)
         FROM money_accounts a WHERE a.id = ?1",
        rusqlite::params![account_id, date],
        |r| r.get(0),
    )?)
}

/// Cobros, pagos y traspasos de la cuenta aún no vinculados a un movimiento: (tipo, id, uid, fecha, monto con signo, etiqueta, referencia).
type Candidate = (&'static str, i64, String, String, i64, String, String);

fn open_candidates(conn: &Connection, account_id: i64) -> AppResult<Vec<Candidate>> {
    let mut stmt = conn.prepare(
        "SELECT 'pago', p.id, p.uid, p.payment_date, CASE p.direction WHEN 'entrada' THEN p.amount_minor ELSE -p.amount_minor END,
            p.number || CASE p.party_type WHEN 'cliente' THEN coalesce(' · ' || (SELECT name FROM customers WHERE id = p.party_id), '')
                                          WHEN 'proveedor' THEN coalesce(' · ' || (SELECT name FROM suppliers WHERE id = p.party_id), '') ELSE '' END,
            coalesce(p.reference, '')
         FROM payments p WHERE p.money_account_id = ?1 AND p.status = 'vigente'
           AND NOT EXISTS (SELECT 1 FROM bank_statement_lines l WHERE l.payment_id = p.id)
         UNION ALL
         SELECT 'traspaso', t.id, t.uid, t.transfer_date, CASE WHEN t.to_account_id = ?1 THEN t.amount_minor ELSE -t.amount_minor END,
            'Traspaso ' || CASE WHEN t.to_account_id = ?1 THEN 'desde ' || f.name ELSE 'a ' || d.name END, coalesce(t.notes, '')
         FROM money_transfers t JOIN money_accounts f ON f.id = t.from_account_id JOIN money_accounts d ON d.id = t.to_account_id
         WHERE (t.to_account_id = ?1 OR t.from_account_id = ?1)
           AND NOT EXISTS (SELECT 1 FROM bank_statement_lines l WHERE l.transfer_id = t.id AND l.money_account_id = ?1)",
    )?;
    let rows = stmt
        .query_map([account_id], |r| {
            let k: String = r.get(0)?;
            Ok((
                if k == "pago" { "pago" } else { "traspaso" },
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get(4)?,
                r.get(5)?,
                r.get(6)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Vincula los movimientos pendientes que tienen exactamente un cobro, pago o traspaso posible
/// (mismo monto y sentido, a no más de `DATE_WINDOW` días) y que ese candidato no sirva a otro.
fn auto_match(conn: &Connection, account_id: i64, by: Option<i64>, now: &str) -> AppResult<i64> {
    let cands = open_candidates(conn, account_id)?;
    let lines: Vec<(i64, String, i64)> = {
        let mut stmt = conn.prepare(
            "SELECT id, line_date, amount_minor FROM bank_statement_lines WHERE money_account_id = ?1 AND status = 'pendiente' ORDER BY line_date, id",
        )?;
        stmt.query_map([account_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
            .collect::<Result<_, _>>()?
    };
    let near = |a: &str, b: &str| match (date_ord(a), date_ord(b)) {
        (Some(x), Some(y)) => (x - y).abs() <= DATE_WINDOW,
        _ => false,
    };
    // Cuántos movimientos podrían usar cada candidato (para no adivinar entre iguales).
    let mut demand: HashMap<usize, usize> = HashMap::new();
    let options: Vec<Vec<usize>> = lines
        .iter()
        .map(|(_, d, a)| {
            let v: Vec<usize> = cands
                .iter()
                .enumerate()
                .filter(|(_, c)| c.4 == *a && near(&c.3, d))
                .map(|(i, _)| i)
                .collect();
            for i in &v {
                *demand.entry(*i).or_default() += 1;
            }
            v
        })
        .collect();
    let mut used: HashSet<usize> = HashSet::new();
    let mut n = 0;
    for ((lid, _, _), opts) in lines.iter().zip(options) {
        if opts.len() != 1
            || demand.get(&opts[0]).copied().unwrap_or(0) != 1
            || used.contains(&opts[0])
        {
            continue;
        }
        let c = &cands[opts[0]];
        used.insert(opts[0]);
        let (pid, tid) = if c.0 == "pago" {
            (Some(c.1), None)
        } else {
            (None, Some(c.1))
        };
        conn.execute(
            "UPDATE bank_statement_lines SET status = 'conciliado', payment_id = ?2, transfer_id = ?3, reconciled_by = ?4, reconciled_at = ?5, note = 'Conciliado automáticamente'
             WHERE id = ?1",
            rusqlite::params![lid, pid, tid, by, now],
        )?;
        n += 1;
    }
    Ok(n)
}

fn matched_payment(conn: &Connection, id: i64) -> AppResult<Option<MatchedRef>> {
    Ok(conn
        .query_row(
            "SELECT p.number, p.direction,
                coalesce((SELECT '/ventas/' || s.uid FROM payment_allocations pa JOIN receivables r ON r.id = pa.receivable_id JOIN sales s ON s.id = r.sale_id WHERE pa.payment_id = p.id LIMIT 1),
                         (SELECT CASE b.source_type WHEN 'COM' THEN '/compras/doc/' || (SELECT uid FROM purchases WHERE id = b.source_id)
                                                     WHEN 'GAS' THEN '/gastos/gasto/' || (SELECT uid FROM expenses WHERE id = b.source_id) END
                          FROM payment_allocations pa JOIN payables b ON b.id = pa.payable_id WHERE pa.payment_id = p.id LIMIT 1)),
                coalesce((SELECT s.number FROM payment_allocations pa JOIN receivables r ON r.id = pa.receivable_id JOIN sales s ON s.id = r.sale_id WHERE pa.payment_id = p.id LIMIT 1),
                         (SELECT CASE b.source_type WHEN 'COM' THEN (SELECT coalesce(supplier_doc_kind || ' ' || supplier_doc_number, number) FROM purchases WHERE id = b.source_id)
                                                     WHEN 'GAS' THEN (SELECT number || ' · ' || description FROM expenses WHERE id = b.source_id) END
                          FROM payment_allocations pa JOIN payables b ON b.id = pa.payable_id WHERE pa.payment_id = p.id LIMIT 1))
             FROM payments p WHERE p.id = ?1",
            [id],
            |r| {
                let number: String = r.get(0)?;
                let dir: String = r.get(1)?;
                let doc: Option<String> = r.get(3)?;
                Ok(MatchedRef {
                    kind: "pago".into(),
                    label: format!("{} {number}{}", if dir == "entrada" { "Cobro" } else { "Pago" }, doc.map(|d| format!(" · {d}")).unwrap_or_default()),
                    link: r.get(2)?,
                })
            },
        )
        .optional()?)
}

fn matched_transfer(conn: &Connection, id: i64, account_id: i64) -> AppResult<Option<MatchedRef>> {
    Ok(conn
        .query_row(
            "SELECT CASE WHEN t.to_account_id = ?2 THEN 'Traspaso desde ' || f.name ELSE 'Traspaso a ' || d.name END
             FROM money_transfers t JOIN money_accounts f ON f.id = t.from_account_id JOIN money_accounts d ON d.id = t.to_account_id WHERE t.id = ?1",
            [id, account_id],
            |r| Ok(MatchedRef { kind: "traspaso".into(), label: r.get(0)?, link: Some("/dinero?tab=cuentas".into()) }),
        )
        .optional()?)
}

/// Datos para sugerir con qué conciliar cada movimiento pendiente.
struct SuggestCtx {
    cands: Vec<Candidate>,
    receivables: Vec<(String, String, String, String, i64)>,
    payables: Vec<(&'static str, String, String, String, String, i64)>,
    categories: HashMap<String, (i64, String)>,
    others: Vec<(String, String)>,
}

impl SuggestCtx {
    fn load(conn: &Connection, account_id: i64) -> AppResult<Self> {
        let cands = open_candidates(conn, account_id)?;
        let receivables = {
            let mut stmt = conn.prepare(
                "SELECT s.uid, s.number, coalesce(c.name, 'Cliente ocasional'), r.due_date, sum(r.amount_minor - r.paid_minor)
                 FROM receivables r JOIN sales s ON s.id = r.sale_id LEFT JOIN customers c ON c.id = s.customer_id
                 WHERE r.status = 'abierta' AND s.commercial_state = 'efectuada' GROUP BY s.id",
            )?;
            stmt.query_map([], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
            })?
            .collect::<Result<Vec<_>, _>>()?
        };
        let payables = {
            let mut stmt = conn.prepare(
                "SELECT b.source_type,
                    CASE b.source_type WHEN 'COM' THEN (SELECT uid FROM purchases WHERE id = b.source_id) ELSE (SELECT uid FROM expenses WHERE id = b.source_id) END,
                    CASE b.source_type WHEN 'COM' THEN (SELECT coalesce(supplier_doc_kind || ' ' || supplier_doc_number, number) FROM purchases WHERE id = b.source_id)
                                        ELSE (SELECT number || ' · ' || description FROM expenses WHERE id = b.source_id) END,
                    coalesce(v.name, ''), b.due_date, sum(b.amount_minor - b.paid_minor)
                 FROM payables b LEFT JOIN suppliers v ON v.id = b.supplier_id
                 WHERE b.status = 'abierta' AND b.source_type IN ('COM', 'GAS') GROUP BY b.source_type, b.source_id",
            )?;
            stmt.query_map([], |r| {
                let st: String = r.get(0)?;
                Ok((
                    if st == "COM" {
                        "pagar_compra"
                    } else {
                        "pagar_gasto"
                    },
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?
        };
        let categories = {
            let mut stmt =
                conn.prepare("SELECT id, name FROM expense_categories WHERE archived_at IS NULL")?;
            stmt.query_map([], |r| {
                let name: String = r.get(1)?;
                Ok((fold(&name), (r.get::<_, i64>(0)?, name)))
            })?
            .collect::<Result<HashMap<_, _>, _>>()?
        };
        let others = {
            let mut stmt = conn.prepare("SELECT uid, name FROM money_accounts WHERE id <> ?1 AND archived_at IS NULL ORDER BY name")?;
            stmt.query_map([account_id], |r| Ok((r.get(0)?, r.get(1)?)))?
                .collect::<Result<Vec<_>, _>>()?
        };
        Ok(SuggestCtx {
            cands,
            receivables,
            payables,
            categories,
            others,
        })
    }

    fn suggest(
        &self,
        date: &str,
        desc: &str,
        reference: Option<&str>,
        amount: i64,
    ) -> Vec<Suggestion> {
        let d = date_ord(date).unwrap_or(0);
        let mut out = Vec::new();
        for c in self.cands.iter().filter(|c| c.4 == amount) {
            let diff = (date_ord(&c.3).unwrap_or(d) - d).abs();
            if diff > 30 {
                continue;
            }
            let mut score = 95 - diff * 4;
            if reference
                .is_some_and(|r| !r.is_empty() && !c.6.is_empty() && fold(&c.6).contains(&fold(r)))
            {
                score += 10;
            }
            out.push(Suggestion {
                action: if c.0 == "pago" {
                    "vincular"
                } else {
                    "vincular_traspaso"
                }
                .into(),
                target_uid: Some(c.2.clone()),
                label: c.5.clone(),
                detail: format!("Registrado el {} · ya está en NÚCLEO", fecha(&c.3)),
                score: score.clamp(30, 100),
                category_id: None,
                category: None,
            });
        }
        if amount > 0 {
            for (uid, number, party, due, pending) in
                self.receivables.iter().filter(|r| r.4 == amount)
            {
                let hit = name_hit(desc, party);
                out.push(Suggestion {
                    action: "cobrar".into(),
                    target_uid: Some(uid.clone()),
                    label: format!("Cobro de {number} · {party}"),
                    detail: format!(
                        "Por cobrar {} · vence el {}{}",
                        crate::insight_ops::money(*pending),
                        fecha(due),
                        if hit {
                            " · el nombre aparece en el banco"
                        } else {
                            ""
                        }
                    ),
                    score: if hit { 85 } else { 60 },
                    category_id: None,
                    category: None,
                });
            }
        } else {
            for (kind, uid, doc, party, due, pending) in
                self.payables.iter().filter(|p| p.5 == -amount)
            {
                let hit = !party.is_empty() && name_hit(desc, party);
                out.push(Suggestion {
                    action: (*kind).into(),
                    target_uid: Some(uid.clone()),
                    label: format!(
                        "Pago de {doc}{}",
                        if party.is_empty() {
                            String::new()
                        } else {
                            format!(" · {party}")
                        }
                    ),
                    detail: format!(
                        "Por pagar {} · vence el {}{}",
                        crate::insight_ops::money(*pending),
                        fecha(due),
                        if hit {
                            " · el nombre aparece en el banco"
                        } else {
                            ""
                        }
                    ),
                    score: if hit { 85 } else { 60 },
                    category_id: None,
                    category: None,
                });
            }
            let guess = guess_category(desc).and_then(|g| self.categories.get(&fold(g)).cloned());
            out.push(Suggestion {
                action: "gasto".into(),
                target_uid: None,
                label: match &guess {
                    Some((_, n)) => format!("Registrar gasto: {n}"),
                    None => "Registrar como gasto".into(),
                },
                detail: if guess.is_some() {
                    "Categoría sugerida por la descripción del banco".into()
                } else {
                    "Elige la categoría".into()
                },
                score: if guess.is_some() { 55 } else { 25 },
                category_id: guess.as_ref().map(|g| g.0),
                category: guess.map(|g| g.1),
            });
        }
        let lower = fold(desc);
        let transfer_like = [
            "traspaso",
            "transferencia entre",
            "tef propia",
            "cuenta propia",
            "giro cajero",
            "deposito efectivo",
            "retiro",
        ]
        .iter()
        .any(|k| lower.contains(k));
        for (uid, name) in &self.others {
            out.push(Suggestion {
                action: "traspaso".into(),
                target_uid: Some(uid.clone()),
                label: format!("Traspaso {} {name}", if amount > 0 { "desde" } else { "a" }),
                detail: "Movimiento entre tus propias cuentas".into(),
                score: if transfer_like { 70 } else { 15 },
                category_id: None,
                category: None,
            });
        }
        out.sort_by_key(|x| std::cmp::Reverse(x.score));
        out.truncate(6);
        out
    }
}

fn fecha(d: &str) -> String {
    if d.len() == 10 {
        format!("{}-{}-{}", &d[8..10], &d[5..7], &d[..4])
    } else {
        d.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn categoria_por_descripcion() {
        assert_eq!(
            guess_category("COMPRA COPEC LOS LAGOS 1234"),
            Some("Combustible")
        );
        assert_eq!(
            guess_category("PAC ENTEL PCS"),
            Some("Internet y telefonía")
        );
        assert_eq!(
            guess_category("Comisión mantención cuenta"),
            Some("Comisiones bancarias")
        );
        assert_eq!(
            guess_category("PAGO TESORERIA GENERAL"),
            Some("Impuestos y contribuciones")
        );
        assert_eq!(guess_category("Transferencia a Juan Pérez"), None);
    }

    #[test]
    fn nombres_y_huella() {
        assert!(name_hit(
            "TRANSF DE CLINICA LOS LAGOS SPA",
            "Clínica Los Lagos SpA"
        ));
        assert!(!name_hit("TRANSF DE PEDRO", "Comercial Ltda"));
        let l = StatementLineInput {
            date: "2026-10-01".into(),
            description: "Pago  ENTEL".into(),
            reference: None,
            amount_minor: -9990,
            balance_minor: None,
        };
        assert_eq!(fingerprint(&l, 0), "2026-10-01|-9990|pago entel||0");
    }
}
