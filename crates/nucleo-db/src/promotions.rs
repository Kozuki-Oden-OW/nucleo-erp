//! Promociones y descuentos (la regla de cada tipo se guarda como JSON validado en nucleo-app).

use crate::DbResult;
use rusqlite::{Connection, OptionalExtension, Row};

#[derive(Debug, Clone)]
pub struct PromotionRow {
    pub id: i64,
    pub uid: String,
    pub name: String,
    pub kind: String,
    pub rule_json: String,
    pub starts_on: Option<String>,
    pub ends_on: Option<String>,
    pub active: bool,
    pub notes: Option<String>,
    pub created_at: String,
}

pub struct PromotionWrite<'a> {
    pub name: &'a str,
    pub kind: &'a str,
    pub rule_json: &'a str,
    pub starts_on: Option<&'a str>,
    pub ends_on: Option<&'a str>,
    pub active: bool,
    pub notes: Option<&'a str>,
    pub now: &'a str,
}

const SELECT: &str = "SELECT id, uid, name, kind, rule_json, starts_on, ends_on, active, notes, created_at FROM promotions";

fn map(r: &Row<'_>) -> rusqlite::Result<PromotionRow> {
    Ok(PromotionRow {
        id: r.get(0)?,
        uid: r.get(1)?,
        name: r.get(2)?,
        kind: r.get(3)?,
        rule_json: r.get(4)?,
        starts_on: r.get(5)?,
        ends_on: r.get(6)?,
        active: r.get::<_, i64>(7)? == 1,
        notes: r.get(8)?,
        created_at: r.get(9)?,
    })
}

/// Promociones vigentes en el sistema (no eliminadas), las más nuevas primero.
pub fn list(conn: &Connection) -> DbResult<Vec<PromotionRow>> {
    let mut stmt = conn.prepare(&format!(
        "{SELECT} WHERE archived_at IS NULL ORDER BY id DESC"
    ))?;
    Ok(stmt.query_map([], map)?.collect::<Result<Vec<_>, _>>()?)
}

pub fn by_uid(conn: &Connection, uid: &str) -> DbResult<Option<PromotionRow>> {
    Ok(conn
        .query_row(
            &format!("{SELECT} WHERE uid = ?1 AND archived_at IS NULL"),
            [uid],
            map,
        )
        .optional()?)
}

pub fn insert(conn: &Connection, uid: &str, w: &PromotionWrite<'_>) -> DbResult<()> {
    conn.execute(
        "INSERT INTO promotions (uid, name, kind, rule_json, starts_on, ends_on, active, notes, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![uid, w.name, w.kind, w.rule_json, w.starts_on, w.ends_on, w.active as i64, w.notes, w.now],
    )?;
    Ok(())
}

pub fn update(conn: &Connection, id: i64, w: &PromotionWrite<'_>) -> DbResult<()> {
    conn.execute(
        "UPDATE promotions SET name = ?2, kind = ?3, rule_json = ?4, starts_on = ?5, ends_on = ?6, active = ?7,
            notes = ?8, updated_at = ?9 WHERE id = ?1",
        rusqlite::params![id, w.name, w.kind, w.rule_json, w.starts_on, w.ends_on, w.active as i64, w.notes, w.now],
    )?;
    Ok(())
}

pub fn set_active(conn: &Connection, id: i64, active: bool, now: &str) -> DbResult<()> {
    conn.execute(
        "UPDATE promotions SET active = ?2, updated_at = ?3 WHERE id = ?1",
        rusqlite::params![id, active as i64, now],
    )?;
    Ok(())
}

/// Elimina de la lista (queda en la base para la auditoría).
pub fn archive(conn: &Connection, id: i64, now: &str) -> DbResult<()> {
    conn.execute(
        "UPDATE promotions SET archived_at = ?2, active = 0 WHERE id = ?1",
        rusqlite::params![id, now],
    )?;
    Ok(())
}
