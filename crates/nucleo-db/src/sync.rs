//! Fase S0 de la sincronización celular ⇄ computador (docs/SINCRONIZACION.md §3 y §5).
//!
//! * **Reloj lógico híbrido (HLC):** marca `MMMMMMMMMMMMM-CCCCC-dispositivo` (milisegundos, contador y
//!   uid del dispositivo). Se compara como texto y nunca retrocede, aunque el reloj del equipo se
//!   atrase. Los triggers de la migración 0033 lo avanzan en cada cambio de ficha.
//! * **Registro de cambios de fichas:** categorías, clientes, proveedores y productos. Cada campo
//!   cambiado queda en `change_log`; al recibir cambios de otro dispositivo gana, campo por campo, la
//!   marca más reciente (última escritura gana) y lo aplicado se registra con la marca de origen.
//! * **Cola de operaciones del celular** (`sync_outbox`) y operaciones ya aplicadas en el computador
//!   (`sync_applied`), para que aplicar dos veces el mismo paquete no duplique nada.

use crate::{DbError, DbResult, now_utc};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};

/// Un cambio de un campo de una ficha, tal como viaja entre dispositivos.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Change {
    pub hlc: String,
    pub device: String,
    pub entity: String,
    pub uid: String,
    pub field: String,
    pub value: Value,
}

/// Columna sincronizable: nombre del campo en el paquete, columna local y, si es referencia a otra
/// ficha, la tabla referida (viaja por uid).
struct Col {
    field: &'static str,
    column: &'static str,
    references: Option<&'static str>,
}

const fn c(name: &'static str) -> Col {
    Col {
        field: name,
        column: name,
        references: None,
    }
}

/// Fichas sincronizables, en orden de dependencia (las categorías antes que los productos).
/// Debe coincidir con los triggers de `0033_sincronizacion.sql`.
const ENTITIES: &[(&str, &[Col])] = &[
    (
        "categories",
        &[
            c("name"),
            c("archived_at"),
            Col {
                field: "parent_uid",
                column: "parent_id",
                references: Some("categories"),
            },
        ],
    ),
    (
        "customers",
        &[
            c("kind"),
            c("rut"),
            c("name"),
            c("trade_name"),
            c("business_activity"),
            c("email"),
            c("phone"),
            c("address"),
            c("commune"),
            c("city"),
            c("payment_terms_days"),
            c("credit_limit_minor"),
            c("birthday"),
            c("notes"),
            c("archived_at"),
            c("region"),
            c("contact_name"),
            c("invoice_email"),
            c("credit_enabled"),
            c("credit_conditions"),
            c("preferred"),
        ],
    ),
    (
        "suppliers",
        &[
            c("kind"),
            c("rut"),
            c("is_foreign"),
            c("tax_id_foreign"),
            c("country"),
            c("name"),
            c("trade_name"),
            c("business_activity"),
            c("email"),
            c("phone"),
            c("address"),
            c("commune"),
            c("city"),
            c("currency_code"),
            c("payment_terms_days"),
            c("lead_time_days"),
            c("notes"),
            c("archived_at"),
        ],
    ),
    (
        "products",
        &[
            c("kind"),
            c("sku"),
            c("barcode"),
            c("name"),
            c("description"),
            c("unit_code"),
            c("taxable"),
            c("track_stock"),
            c("price_minor"),
            c("min_stock_milli"),
            c("max_stock_milli"),
            c("weight_g"),
            c("volume_cm3"),
            c("hs_code"),
            c("archived_at"),
            c("cost_sheet_json"),
            c("stock_policy"),
            Col {
                field: "category_uid",
                column: "category_id",
                references: Some("categories"),
            },
        ],
    ),
];

/// Identidad de este dispositivo: (uid, rol "escritorio" o "celular").
pub fn device(conn: &Connection) -> DbResult<(String, String)> {
    Ok(conn.query_row(
        "SELECT device_uid, role FROM sync_state WHERE id = 1",
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?)
}

pub fn set_role(conn: &Connection, role: &str) -> DbResult<()> {
    if !matches!(role, "escritorio" | "celular") {
        return Err(DbError::Rule("el rol debe ser escritorio o celular".into()));
    }
    conn.execute("UPDATE sync_state SET role = ?1 WHERE id = 1", [role])?;
    Ok(())
}

fn split_hlc(hlc: &str) -> Option<(i64, i64)> {
    let mut it = hlc.splitn(3, '-');
    Some((it.next()?.parse().ok()?, it.next()?.parse().ok()?))
}

/// Avanza el reloj local y devuelve una marca nueva (para operaciones de la cola).
pub fn tick(conn: &Connection) -> DbResult<String> {
    conn.execute(
        "UPDATE sync_state SET
            hlc_counter = CASE WHEN max(CAST(unixepoch('subsec') * 1000 AS INTEGER), hlc_ms) = hlc_ms THEN hlc_counter + 1 ELSE 0 END,
            hlc_ms = max(CAST(unixepoch('subsec') * 1000 AS INTEGER), hlc_ms)
         WHERE id = 1",
        [],
    )?;
    Ok(conn.query_row(
        "SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1",
        [],
        |r| r.get(0),
    )?)
}

/// Al recibir una marca de otro dispositivo, el reloj local queda por delante de ella.
pub fn observe(conn: &Connection, remote: &str) -> DbResult<()> {
    let Some((ms, ctr)) = split_hlc(remote) else {
        return Ok(());
    };
    conn.execute(
        "UPDATE sync_state SET
            hlc_counter = CASE WHEN ?1 > hlc_ms THEN ?2 WHEN ?1 = hlc_ms THEN max(hlc_counter, ?2) ELSE hlc_counter END,
            hlc_ms = max(hlc_ms, ?1)
         WHERE id = 1",
        params![ms, ctr],
    )?;
    Ok(())
}

/// Cambios registrados después de `since` (vacío = todos), el más reciente por campo.
pub fn changes_since(conn: &Connection, since: &str) -> DbResult<Vec<Change>> {
    let mut stmt = conn.prepare(
        "SELECT hlc, device_uid, entity, entity_uid, field, value_json FROM change_log
         WHERE hlc > ?1 ORDER BY hlc, id",
    )?;
    let rows = stmt.query_map([since], |r| {
        let v: String = r.get(5)?;
        Ok(Change {
            hlc: r.get(0)?,
            device: r.get(1)?,
            entity: r.get(2)?,
            uid: r.get(3)?,
            field: r.get(4)?,
            value: serde_json::from_str(&v).unwrap_or(Value::Null),
        })
    })?;
    let mut latest: BTreeMap<(String, String, String), Change> = BTreeMap::new();
    for ch in rows {
        let ch = ch?;
        latest.insert((ch.entity.clone(), ch.uid.clone(), ch.field.clone()), ch);
    }
    let mut out: Vec<Change> = latest.into_values().collect();
    out.sort_by(|a, b| a.hlc.cmp(&b.hlc));
    Ok(out)
}

/// Fotografía completa de las fichas, para el primer emparejamiento (incluye fichas creadas antes de
/// activar la sincronización). Cada campo lleva la marca de su último cambio conocido; si nunca se
/// registró, una marca base que pierde ante cualquier cambio real.
pub fn snapshot(conn: &Connection) -> DbResult<Vec<Change>> {
    let (dev, _) = device(conn)?;
    let base = format!("{:013}-{:05}-{dev}", 0, 0);
    let mut known: HashMap<(String, String, String), (String, String)> = HashMap::new();
    {
        let mut stmt = conn.prepare("SELECT entity, entity_uid, field, max(hlc), device_uid FROM change_log GROUP BY entity, entity_uid, field")?;
        let rows = stmt.query_map([], |r| {
            Ok(((r.get(0)?, r.get(1)?, r.get(2)?), (r.get(3)?, r.get(4)?)))
        })?;
        for row in rows {
            let (k, v) = row?;
            known.insert(k, v);
        }
    }
    let mut out = Vec::new();
    for (entity, cols) in ENTITIES {
        let select: Vec<String> = cols
            .iter()
            .map(|c| match c.references {
                Some(t) => format!("(SELECT uid FROM {t} WHERE id = x.{})", c.column),
                None => format!("x.{}", c.column),
            })
            .collect();
        let sql = format!(
            "SELECT x.uid, {} FROM {entity} x WHERE x.uid IS NOT NULL ORDER BY x.id",
            select.join(", ")
        );
        let mut stmt = conn.prepare(&sql)?;
        let mut rows = stmt.query([])?;
        while let Some(r) = rows.next()? {
            let uid: String = r.get(0)?;
            for (i, col) in cols.iter().enumerate() {
                let value = sql_to_json(r.get_ref(i + 1)?);
                let key = (entity.to_string(), uid.clone(), col.field.to_string());
                let (hlc, device) = known
                    .get(&key)
                    .cloned()
                    .unwrap_or_else(|| (base.clone(), dev.clone()));
                out.push(Change {
                    hlc,
                    device,
                    entity: entity.to_string(),
                    uid: uid.clone(),
                    field: col.field.into(),
                    value,
                });
            }
        }
    }
    Ok(out)
}

fn sql_to_json(v: rusqlite::types::ValueRef<'_>) -> Value {
    use rusqlite::types::ValueRef::*;
    match v {
        Null => Value::Null,
        Integer(i) => Value::from(i),
        Real(f) => Value::from(f),
        Text(t) => Value::from(String::from_utf8_lossy(t).into_owned()),
        Blob(_) => Value::Null,
    }
}

fn json_to_sql(v: &Value) -> rusqlite::types::Value {
    use rusqlite::types::Value as V;
    match v {
        Value::Null => V::Null,
        Value::Bool(b) => V::Integer(i64::from(*b)),
        Value::Number(n) => n
            .as_i64()
            .map(V::Integer)
            .unwrap_or_else(|| V::Real(n.as_f64().unwrap_or(0.0))),
        Value::String(s) => V::Text(s.clone()),
        other => V::Text(other.to_string()),
    }
}

#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize)]
pub struct ApplyReport {
    /// Campos que cambiaron en esta base.
    pub applied: usize,
    /// Campos que ya tenían un cambio igual o más reciente.
    pub skipped: usize,
    /// Fichas creadas porque no existían.
    pub created: usize,
    /// Choques registrados para revisar (p. ej. el mismo RUT en dos fichas).
    pub conflicts: usize,
}

/// Clave natural de cada ficha: dos fichas con el mismo valor son la misma (mismo RUT, mismo código,
/// misma categoría). Al encontrarse, se unen en vez de duplicarse.
fn natural_key(entity: &str) -> &'static str {
    match entity {
        "categories" => "name",
        "products" => "sku",
        _ => "rut",
    }
}

/// uid local de una ficha que llegó con otro uid (unida por su clave natural).
pub fn resolve(conn: &Connection, entity: &str, uid: &str) -> DbResult<String> {
    Ok(conn
        .query_row(
            "SELECT uid FROM sync_aliases WHERE entity = ?1 AND alias_uid = ?2",
            params![entity, uid],
            |r| r.get(0),
        )
        .optional()?
        .unwrap_or_else(|| uid.to_string()))
}

/// Aplica cambios recibidos de otro dispositivo, campo por campo, con «última escritura gana».
/// Todo en una transacción: o queda todo aplicado o nada.
///
/// Si llega una ficha nueva con la misma clave natural que una local (el mismo RUT creado en ambos
/// equipos, o las categorías iniciales de cada base), se unen: el computador conserva su uid y anota
/// el del celular como alias; el celular adopta el uid del computador (es la autoridad, D-SYNC-01).
pub fn apply_changes(conn: &mut Connection, changes: &[Change]) -> DbResult<ApplyReport> {
    let tx = conn.transaction()?;
    let (_, role) = device(&tx)?;
    tx.execute("UPDATE sync_state SET applying = 1 WHERE id = 1", [])?;
    let mut rep = ApplyReport::default();
    let now = now_utc();

    for (entity, cols) in ENTITIES {
        let mut by_uid: BTreeMap<String, Vec<&Change>> = BTreeMap::new();
        for ch in changes.iter().filter(|c| c.entity == *entity) {
            by_uid
                .entry(resolve(&tx, entity, &ch.uid)?)
                .or_default()
                .push(ch);
        }
        // Primero se crean (o se unen) las fichas que faltan, para que las referencias del mismo
        // paquete existan al aplicar los campos.
        let mut merged: BTreeMap<String, String> = BTreeMap::new();
        for (uid, chs) in &by_uid {
            let exists: Option<i64> = tx
                .query_row(
                    &format!("SELECT id FROM {entity} WHERE uid = ?1"),
                    [uid],
                    |r| r.get(0),
                )
                .optional()?;
            if exists.is_some() {
                continue;
            }
            let latest = |f: &str| {
                chs.iter()
                    .filter(|c| c.field == f)
                    .max_by(|a, b| a.hlc.cmp(&b.hlc))
                    .map(|c| c.value.clone())
            };
            let key = natural_key(entity);
            let twin: Option<String> = match latest(key)
                .and_then(|v| v.as_str().map(String::from))
                .filter(|v| !v.trim().is_empty())
            {
                Some(k) => {
                    let active = if *entity == "categories" {
                        " AND archived_at IS NULL"
                    } else {
                        ""
                    };
                    tx.query_row(
                        &format!("SELECT uid FROM {entity} WHERE {key} = ?1{active}"),
                        [&k],
                        |r| r.get(0),
                    )
                    .optional()?
                }
                None => None,
            };
            if let Some(local) = twin {
                if role == "celular" {
                    // El celular adopta el uid del computador para su ficha gemela.
                    tx.execute(
                        &format!("UPDATE {entity} SET uid = ?1 WHERE uid = ?2"),
                        params![uid, local],
                    )?;
                    tx.execute("UPDATE change_log SET entity_uid = ?1 WHERE entity = ?2 AND entity_uid = ?3", params![uid, entity, local])?;
                    tx.execute("UPDATE sync_outbox SET payload_json = replace(payload_json, ?1, ?2) WHERE sent_at IS NULL", params![format!("\"{local}\""), format!("\"{uid}\"")])?;
                    tx.execute("INSERT OR REPLACE INTO sync_aliases (entity, alias_uid, uid) VALUES (?1, ?2, ?3)", params![entity, local, uid])?;
                } else {
                    // El computador conserva su ficha y anota el uid del celular como alias.
                    tx.execute("INSERT OR REPLACE INTO sync_aliases (entity, alias_uid, uid) VALUES (?1, ?2, ?3)", params![entity, uid, local])?;
                    merged.insert(uid.clone(), local.clone());
                    if *entity != "categories" {
                        conflict(
                            &tx,
                            entity,
                            &local,
                            key,
                            &format!(
                                "se unió con una ficha del otro equipo con el mismo {}",
                                if key == "sku" { "código" } else { "RUT" }
                            ),
                            &now,
                        )?;
                        rep.conflicts += 1;
                    }
                }
                continue;
            }
            let name = latest("name")
                .and_then(|v| v.as_str().map(String::from))
                .unwrap_or_else(|| "(sin nombre)".into());
            let name = unique_name(&tx, entity, &name)?;
            tx.execute(
                &format!("INSERT INTO {entity} (uid, name, created_at) VALUES (?1, ?2, ?3)"),
                params![uid, name, now],
            )?;
            rep.created += 1;
        }
        for (uid, chs) in &by_uid {
            let uid = merged.get(uid).unwrap_or(uid);
            for ch in chs {
                let Some(col) = cols.iter().find(|c| c.field == ch.field) else {
                    continue;
                };
                let local: Option<String> = tx
                    .query_row(
                        "SELECT max(hlc) FROM change_log WHERE entity = ?1 AND entity_uid = ?2 AND field = ?3",
                        params![entity, uid, ch.field],
                        |r| r.get(0),
                    )
                    .optional()?
                    .flatten();
                if local.as_deref().is_some_and(|l| l >= ch.hlc.as_str()) {
                    rep.skipped += 1;
                    continue;
                }
                let (value, logged) = match col.references {
                    Some(t) => match ch.value.as_str() {
                        Some(ref_uid) => {
                            let ref_uid = resolve(&tx, t, ref_uid)?;
                            match tx
                                .query_row(
                                    &format!("SELECT id FROM {t} WHERE uid = ?1"),
                                    [&ref_uid],
                                    |r| r.get::<_, i64>(0),
                                )
                                .optional()?
                            {
                                Some(id) => {
                                    (rusqlite::types::Value::Integer(id), Value::from(ref_uid))
                                }
                                None => {
                                    conflict(
                                        &tx,
                                        entity,
                                        uid,
                                        ch.field.as_str(),
                                        &format!("no existe la ficha referida {ref_uid}"),
                                        &now,
                                    )?;
                                    rep.conflicts += 1;
                                    continue;
                                }
                            }
                        }
                        None => (rusqlite::types::Value::Null, Value::Null),
                    },
                    None => (json_to_sql(&ch.value), ch.value.clone()),
                };
                let current: rusqlite::types::Value = tx.query_row(
                    &format!("SELECT {} FROM {entity} WHERE uid = ?1", col.column),
                    [uid],
                    |r| r.get(0),
                )?;
                let r = if current == value {
                    Ok(0)
                } else {
                    tx.execute(
                        &format!("UPDATE {entity} SET {} = ?1 WHERE uid = ?2", col.column),
                        params![value, uid],
                    )
                };
                match r {
                    // Mismo valor: no cambia nada, pero la marca queda registrada.
                    Ok(0) => rep.skipped += 1,
                    Ok(_) => rep.applied += 1,
                    Err(rusqlite::Error::SqliteFailure(e, _))
                        if e.code == rusqlite::ErrorCode::ConstraintViolation =>
                    {
                        conflict(
                            &tx,
                            entity,
                            uid,
                            ch.field.as_str(),
                            &format!("el valor {} ya lo usa otra ficha", ch.value),
                            &now,
                        )?;
                        rep.conflicts += 1;
                        continue;
                    }
                    Err(e) => return Err(e.into()),
                }
                tx.execute(
                    "INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    params![ch.hlc, ch.device, entity, uid, ch.field, logged.to_string()],
                )?;
            }
        }
    }
    if let Some(max) = changes.iter().map(|c| c.hlc.as_str()).max() {
        observe(&tx, max)?;
    }
    tx.execute("UPDATE sync_state SET applying = 0 WHERE id = 1", [])?;
    tx.commit()?;
    Ok(rep)
}

/// Un nombre que no choque con otra ficha activa (las categorías tienen nombre único).
fn unique_name(conn: &Connection, entity: &str, name: &str) -> DbResult<String> {
    if entity != "categories" {
        return Ok(name.to_string());
    }
    let mut candidate = name.to_string();
    let mut n = 2;
    while conn
        .query_row(
            "SELECT 1 FROM categories WHERE name = ?1 AND archived_at IS NULL",
            [&candidate],
            |_| Ok(()),
        )
        .optional()?
        .is_some()
    {
        candidate = format!("{name} ({n})");
        n += 1;
    }
    Ok(candidate)
}

fn conflict(
    conn: &Connection,
    entity: &str,
    uid: &str,
    field: &str,
    detail: &str,
    now: &str,
) -> DbResult<()> {
    conn.execute(
        "INSERT INTO sync_conflicts (entity, entity_uid, field, detail, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![entity, uid, field, detail, now],
    )?;
    Ok(())
}

pub fn open_conflicts(conn: &Connection) -> DbResult<Vec<(String, String, String, String)>> {
    let mut stmt = conn.prepare("SELECT entity, entity_uid, field, detail FROM sync_conflicts WHERE resolved_at IS NULL ORDER BY id")?;
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/* ───────────── Dispositivos emparejados ───────────── */

#[derive(Debug, Clone, Serialize)]
pub struct Peer {
    pub device_uid: String,
    pub name: String,
    pub role: String,
    pub paired_at: String,
    pub revoked: bool,
    pub sent_hlc: String,
    pub received_hlc: String,
    pub last_sync_at: Option<String>,
}

pub fn pair(conn: &Connection, device_uid: &str, name: &str, role: &str) -> DbResult<()> {
    conn.execute(
        "INSERT INTO sync_peers (device_uid, name, role, paired_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(device_uid) DO UPDATE SET name = excluded.name, role = excluded.role, revoked_at = NULL",
        params![device_uid, name, role, now_utc()],
    )?;
    Ok(())
}

pub fn revoke(conn: &Connection, device_uid: &str) -> DbResult<usize> {
    Ok(conn.execute(
        "UPDATE sync_peers SET revoked_at = ?2 WHERE device_uid = ?1 AND revoked_at IS NULL",
        params![device_uid, now_utc()],
    )?)
}

pub fn peer(conn: &Connection, device_uid: &str) -> DbResult<Option<Peer>> {
    Ok(conn
        .query_row(
            "SELECT device_uid, name, role, paired_at, revoked_at IS NOT NULL, sent_hlc, received_hlc, last_sync_at FROM sync_peers WHERE device_uid = ?1",
            [device_uid],
            |r| Ok(Peer { device_uid: r.get(0)?, name: r.get(1)?, role: r.get(2)?, paired_at: r.get(3)?, revoked: r.get(4)?, sent_hlc: r.get(5)?, received_hlc: r.get(6)?, last_sync_at: r.get(7)? }),
        )
        .optional()?)
}

pub fn peers(conn: &Connection) -> DbResult<Vec<Peer>> {
    let mut stmt = conn.prepare("SELECT device_uid FROM sync_peers ORDER BY id")?;
    let ids: Vec<String> = stmt
        .query_map([], |r| r.get(0))?
        .collect::<Result<_, _>>()?;
    Ok(ids
        .iter()
        .filter_map(|d| peer(conn, d).ok().flatten())
        .collect())
}

/// Registra el avance con un dispositivo: lo que confirmó haber recibido y lo que se recibió de él.
pub fn mark_progress(
    conn: &Connection,
    device_uid: &str,
    sent_hlc: Option<&str>,
    received_hlc: Option<&str>,
) -> DbResult<()> {
    conn.execute(
        "UPDATE sync_peers SET
            sent_hlc = CASE WHEN ?2 IS NOT NULL AND ?2 > sent_hlc THEN ?2 ELSE sent_hlc END,
            received_hlc = CASE WHEN ?3 IS NOT NULL AND ?3 > received_hlc THEN ?3 ELSE received_hlc END,
            last_sync_at = ?4
         WHERE device_uid = ?1",
        params![device_uid, sent_hlc, received_hlc, now_utc()],
    )?;
    Ok(())
}

/* ───────────── Cola de operaciones (celular) y operaciones aplicadas (computador) ───────────── */

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Op {
    pub op_uid: String,
    pub kind: String,
    pub payload: Value,
    pub hlc: String,
}

pub fn outbox_add(conn: &Connection, kind: &str, payload: &Value) -> DbResult<Op> {
    let hlc = tick(conn)?;
    let op_uid = uuid::Uuid::now_v7().to_string();
    conn.execute(
        "INSERT INTO sync_outbox (op_uid, kind, payload_json, hlc, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![op_uid, kind, payload.to_string(), hlc, now_utc()],
    )?;
    Ok(Op {
        op_uid,
        kind: kind.into(),
        payload: payload.clone(),
        hlc,
    })
}

pub fn outbox(conn: &Connection) -> DbResult<Vec<Op>> {
    let mut stmt =
        conn.prepare("SELECT op_uid, kind, payload_json, hlc FROM sync_outbox ORDER BY hlc")?;
    let rows = stmt.query_map([], |r| {
        let p: String = r.get(2)?;
        Ok(Op {
            op_uid: r.get(0)?,
            kind: r.get(1)?,
            payload: serde_json::from_str(&p).unwrap_or(Value::Null),
            hlc: r.get(3)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// El computador confirmó estas operaciones: salen de la cola.
pub fn outbox_ack(conn: &Connection, op_uids: &[String]) -> DbResult<usize> {
    let mut n = 0;
    for u in op_uids {
        n += conn.execute("DELETE FROM sync_outbox WHERE op_uid = ?1", [u])?;
    }
    Ok(n)
}

pub fn applied(conn: &Connection, op_uid: &str) -> DbResult<Option<Value>> {
    Ok(conn
        .query_row(
            "SELECT result_json FROM sync_applied WHERE op_uid = ?1",
            [op_uid],
            |r| r.get::<_, String>(0),
        )
        .optional()?
        .map(|s| serde_json::from_str(&s).unwrap_or(Value::Null)))
}

pub fn mark_applied(conn: &Connection, op: &Op, origin: &str, result: &Value) -> DbResult<()> {
    conn.execute(
        "INSERT OR IGNORE INTO sync_applied (op_uid, origin_device, kind, applied_at, result_json) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![op.op_uid, origin, op.kind, now_utc(), result.to_string()],
    )?;
    Ok(())
}

/// Operaciones aplicadas que vinieron de un dispositivo (para confirmárselas en el próximo paquete).
pub fn applied_from(conn: &Connection, origin: &str) -> DbResult<Vec<String>> {
    let mut stmt = conn.prepare("SELECT op_uid FROM sync_applied WHERE origin_device = ?1 ORDER BY applied_at DESC LIMIT 2000")?;
    let rows = stmt.query_map([origin], |r| r.get(0))?;
    Ok(rows.collect::<Result<_, _>>()?)
}
