//! Configuración, numeración, monedas, adjuntos y búsqueda global (Fase 4).

use crate::customers::fts_query;
use crate::{DbError, DbResult, now_utc};
use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;

/* ───────────────────────────── Configuración (clave → JSON) ───────────────────────────── */

pub fn get_setting(conn: &Connection, key: &str) -> DbResult<Option<serde_json::Value>> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT value_json FROM settings WHERE key = ?1",
            [key],
            |r| r.get(0),
        )
        .optional()?;
    Ok(raw.and_then(|s| serde_json::from_str(&s).ok()))
}

pub fn set_setting(conn: &Connection, key: &str, value: &serde_json::Value) -> DbResult<()> {
    conn.execute(
        "INSERT INTO settings (key, value_json, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
        (key, value.to_string(), now_utc()),
    )?;
    Ok(())
}

/* ───────────────────────────── Numeración NÚCLEO ───────────────────────────── */

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SequenceRow {
    pub doc_type: String,
    pub name: String,
    pub prefix: String,
    pub next_number: i64,
    pub width: i64,
    /// Mayor correlativo ya usado (0 si ninguno). El siguiente nunca puede ser menor o igual.
    pub last_used: i64,
}

pub fn sequences(conn: &Connection) -> DbResult<Vec<SequenceRow>> {
    let mut stmt = conn.prepare(
        "SELECT s.doc_type, t.name, s.prefix, s.next_number, s.width, ifnull((SELECT value FROM app_meta WHERE key = 'last_used.' || s.doc_type), '0')
         FROM numbering_sequences s JOIN document_types t ON t.code = s.doc_type
         WHERE s.branch_id IS NULL ORDER BY t.family, s.doc_type",
    )?;
    Ok(stmt
        .query_map([], |r| {
            Ok(SequenceRow {
                doc_type: r.get(0)?,
                name: r.get(1)?,
                prefix: r.get(2)?,
                next_number: r.get(3)?,
                width: r.get(4)?,
                last_used: r.get::<_, String>(5)?.parse().unwrap_or(0),
            })
        })?
        .collect::<Result<_, _>>()?)
}

/// Toma el siguiente número interno de forma atómica (debe llamarse dentro de la transacción
/// que crea el documento): "COT-000147".
pub fn take_number(conn: &Connection, doc_type: &str) -> DbResult<String> {
    let (prefix, n, width): (String, i64, i64) = conn
        .query_row(
            "UPDATE numbering_sequences SET next_number = next_number + 1
             WHERE doc_type = ?1 AND branch_id IS NULL
             RETURNING prefix, next_number - 1, width",
            [doc_type],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?
        .ok_or_else(|| DbError::Rule(format!("tipo de documento sin numeración: {doc_type}")))?;
    conn.execute(
        "INSERT INTO app_meta (key, value) VALUES ('last_used.' || ?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (doc_type, n.to_string()),
    )?;
    Ok(format!("{prefix}-{n:0width$}", width = width as usize))
}

/// Cambia prefijo, siguiente número y ancho. Rechaza retroceder bajo lo ya usado.
pub fn update_sequence(
    conn: &Connection,
    doc_type: &str,
    prefix: &str,
    next_number: i64,
    width: i64,
) -> DbResult<()> {
    let last_used: i64 = conn
        .query_row(
            "SELECT value FROM app_meta WHERE key = 'last_used.' || ?1",
            [doc_type],
            |r| r.get::<_, String>(0),
        )
        .optional()?
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    if next_number <= last_used {
        return Err(DbError::Rule(format!(
            "el siguiente número debe ser mayor que {last_used}, el último ya usado"
        )));
    }
    let n = conn.execute(
        "UPDATE numbering_sequences SET prefix = ?2, next_number = ?3, width = ?4 WHERE doc_type = ?1 AND branch_id IS NULL",
        (doc_type, prefix, next_number, width),
    )?;
    if n == 0 {
        return Err(DbError::Rule(format!(
            "tipo de documento desconocido: {doc_type}"
        )));
    }
    Ok(())
}

/* ───────────────────────────── Monedas y tasas de cambio ───────────────────────────── */

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CurrencyRow {
    pub code: String,
    pub name: String,
    pub decimals: i64,
    pub symbol: String,
    /// Última tasa ingresada (CLP por unidad × 1.000.000) y su fecha.
    pub last_rate_e6: Option<i64>,
    pub last_rate_date: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RateRow {
    pub currency_code: String,
    pub rate_date: String,
    pub rate_e6: i64,
    pub note: Option<String>,
    pub created_at: String,
}

pub fn currencies(conn: &Connection) -> DbResult<Vec<CurrencyRow>> {
    let mut stmt = conn.prepare(
        "SELECT c.code, c.name, c.decimals, c.symbol,
                (SELECT rate_e6 FROM exchange_rates e WHERE e.currency_code = c.code ORDER BY rate_date DESC LIMIT 1),
                (SELECT rate_date FROM exchange_rates e WHERE e.currency_code = c.code ORDER BY rate_date DESC LIMIT 1)
         FROM currencies c ORDER BY c.code = 'CLP' DESC, c.code",
    )?;
    Ok(stmt
        .query_map([], |r| {
            Ok(CurrencyRow {
                code: r.get(0)?,
                name: r.get(1)?,
                decimals: r.get(2)?,
                symbol: r.get(3)?,
                last_rate_e6: r.get(4)?,
                last_rate_date: r.get(5)?,
            })
        })?
        .collect::<Result<_, _>>()?)
}

pub fn rates(conn: &Connection, currency: &str, limit: u32) -> DbResult<Vec<RateRow>> {
    let mut stmt = conn.prepare(
        "SELECT currency_code, rate_date, rate_e6, note, created_at FROM exchange_rates
         WHERE currency_code = ?1 ORDER BY rate_date DESC LIMIT ?2",
    )?;
    Ok(stmt
        .query_map((currency, limit), |r| {
            Ok(RateRow {
                currency_code: r.get(0)?,
                rate_date: r.get(1)?,
                rate_e6: r.get(2)?,
                note: r.get(3)?,
                created_at: r.get(4)?,
            })
        })?
        .collect::<Result<_, _>>()?)
}

/// Inserta o reemplaza la tasa del día (el usuario la ingresa: NÚCLEO no consulta Internet).
pub fn upsert_rate(
    conn: &Connection,
    currency: &str,
    date: &str,
    rate_e6: i64,
    note: Option<&str>,
) -> DbResult<()> {
    conn.execute(
        "INSERT INTO exchange_rates (currency_code, rate_date, rate_e6, origin, note, created_at) VALUES (?1, ?2, ?3, 'manual', ?4, ?5)
         ON CONFLICT(currency_code, rate_date) DO UPDATE SET rate_e6 = excluded.rate_e6, note = excluded.note, created_at = excluded.created_at",
        (currency, date, rate_e6, note, now_utc()),
    )?;
    Ok(())
}

/// Tasa vigente para una fecha: la más reciente en o antes de esa fecha.
pub fn rate_for(conn: &Connection, currency: &str, date: &str) -> DbResult<Option<i64>> {
    Ok(conn
        .query_row(
            "SELECT rate_e6 FROM exchange_rates WHERE currency_code = ?1 AND rate_date <= ?2 ORDER BY rate_date DESC LIMIT 1",
            (currency, date),
            |r| r.get(0),
        )
        .optional()?)
}

/* ───────────────────────────── Documentos adjuntos ───────────────────────────── */

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AttachmentRow {
    pub id: i64,
    pub uid: String,
    pub sha256: String,
    pub file_name: String,
    pub mime_type: String,
    pub size_bytes: i64,
    pub description: Option<String>,
    pub created_by: Option<String>,
    pub created_at: String,
    /// Vínculos "entidad:uid" (cliente, venta, compra…).
    pub links: Vec<String>,
}

pub struct NewAttachment<'a> {
    pub uid: &'a str,
    pub sha256: &'a str,
    pub file_name: &'a str,
    pub mime_type: &'a str,
    pub size_bytes: i64,
    pub description: Option<&'a str>,
    pub created_by: Option<i64>,
}

const ATT_COLS: &str = "a.id, a.uid, a.sha256, a.file_name, a.mime_type, a.size_bytes, a.description, u.display_name, a.created_at";

fn map_att(r: &rusqlite::Row<'_>) -> rusqlite::Result<AttachmentRow> {
    Ok(AttachmentRow {
        id: r.get(0)?,
        uid: r.get(1)?,
        sha256: r.get(2)?,
        file_name: r.get(3)?,
        mime_type: r.get(4)?,
        size_bytes: r.get(5)?,
        description: r.get(6)?,
        created_by: r.get(7)?,
        created_at: r.get(8)?,
        links: Vec::new(),
    })
}

fn with_links(conn: &Connection, mut a: AttachmentRow) -> DbResult<AttachmentRow> {
    let mut stmt = conn.prepare(
        "SELECT entity, entity_id FROM attachment_links WHERE attachment_id = ?1 ORDER BY entity",
    )?;
    a.links = stmt
        .query_map([a.id], |r| {
            Ok(format!(
                "{}:{}",
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?
            ))
        })?
        .collect::<Result<_, _>>()?;
    Ok(a)
}

pub fn insert_attachment(conn: &Connection, a: &NewAttachment<'_>) -> DbResult<i64> {
    conn.execute(
        "INSERT INTO attachments (uid, sha256, file_name, mime_type, size_bytes, description, created_by, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![a.uid, a.sha256, a.file_name, a.mime_type, a.size_bytes, a.description, a.created_by, now_utc()],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn link_attachment(
    conn: &Connection,
    attachment_id: i64,
    entity: &str,
    entity_id: i64,
) -> DbResult<()> {
    conn.execute(
        "INSERT OR IGNORE INTO attachment_links (attachment_id, entity, entity_id) VALUES (?1, ?2, ?3)",
        (attachment_id, entity, entity_id),
    )?;
    Ok(())
}

pub fn attachment(conn: &Connection, uid: &str) -> DbResult<Option<AttachmentRow>> {
    let a = conn
        .query_row(
            &format!("SELECT {ATT_COLS} FROM attachments a LEFT JOIN users u ON u.id = a.created_by WHERE a.uid = ?1 AND a.archived_at IS NULL"),
            [uid],
            map_att,
        )
        .optional()?;
    a.map(|a| with_links(conn, a)).transpose()
}

/// Lista adjuntos vigentes; con `entity` filtra los vinculados a ese registro.
pub fn attachments(
    conn: &Connection,
    query: &str,
    entity: Option<(&str, i64)>,
    limit: u32,
) -> DbResult<Vec<AttachmentRow>> {
    let like = format!("%{}%", query.trim());
    let rows: Vec<AttachmentRow> = match entity {
        Some((e, id)) => {
            let mut stmt = conn.prepare(&format!(
                "SELECT {ATT_COLS} FROM attachments a LEFT JOIN users u ON u.id = a.created_by
                 JOIN attachment_links l ON l.attachment_id = a.id
                 WHERE a.archived_at IS NULL AND l.entity = ?1 AND l.entity_id = ?2 ORDER BY a.created_at DESC LIMIT ?3"
            ))?;
            stmt.query_map(rusqlite::params![e, id, limit], map_att)?
                .collect::<Result<_, _>>()?
        }
        None => {
            let mut stmt = conn.prepare(&format!(
                "SELECT {ATT_COLS} FROM attachments a LEFT JOIN users u ON u.id = a.created_by
                 WHERE a.archived_at IS NULL AND (a.file_name LIKE ?1 OR ifnull(a.description, '') LIKE ?1)
                 ORDER BY a.created_at DESC LIMIT ?2"
            ))?;
            stmt.query_map(rusqlite::params![like, limit], map_att)?
                .collect::<Result<_, _>>()?
        }
    };
    rows.into_iter().map(|a| with_links(conn, a)).collect()
}

/// Quitar un adjunto lo archiva (no borra el contenido cifrado: queda en respaldos y auditoría).
pub fn archive_attachment(conn: &Connection, uid: &str, by: &str) -> DbResult<bool> {
    Ok(conn.execute(
        "UPDATE attachments SET archived_at = ?2, archived_by = ?3 WHERE uid = ?1 AND archived_at IS NULL",
        (uid, now_utc(), by),
    )? == 1)
}

/* ───────────────────────────── Búsqueda global ───────────────────────────── */

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SearchHit {
    pub kind: &'static str,
    pub uid: String,
    pub title: String,
    pub subtitle: String,
}

/// Busca en clientes, proveedores, productos (FTS5, sin tildes, por prefijo) y documentos internos
/// por número (COT-000147) y en adjuntos por nombre.
pub fn global_search(conn: &Connection, input: &str, per_kind: u32) -> DbResult<Vec<SearchHit>> {
    let mut out = Vec::new();
    let Some(q) = fts_query(input) else {
        return Ok(out);
    };

    let mut stmt = conn.prepare(
        "SELECT c.uid, c.name, c.rut FROM customers c JOIN customers_fts f ON f.rowid = c.id
         WHERE customers_fts MATCH ?1 AND c.archived_at IS NULL ORDER BY bm25(customers_fts) LIMIT ?2",
    )?;
    for r in stmt.query_map((&q, per_kind), |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, Option<String>>(2)?,
        ))
    })? {
        let (uid, name, rut) = r?;
        out.push(SearchHit {
            kind: "cliente",
            uid,
            title: name,
            subtitle: rut
                .map(|r| format!("RUT {r}"))
                .unwrap_or_else(|| "Cliente".into()),
        });
    }
    let mut stmt = conn.prepare(
        "SELECT s.uid, s.name, s.rut FROM suppliers s JOIN suppliers_fts f ON f.rowid = s.id
         WHERE suppliers_fts MATCH ?1 AND s.archived_at IS NULL ORDER BY bm25(suppliers_fts) LIMIT ?2",
    )?;
    for r in stmt.query_map((&q, per_kind), |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, Option<String>>(2)?,
        ))
    })? {
        let (uid, name, rut) = r?;
        out.push(SearchHit {
            kind: "proveedor",
            uid,
            title: name,
            subtitle: rut
                .map(|r| format!("Proveedor · RUT {r}"))
                .unwrap_or_else(|| "Proveedor".into()),
        });
    }
    let mut stmt = conn.prepare(
        "SELECT p.uid, p.name, p.sku FROM products p JOIN products_fts f ON f.rowid = p.id
         WHERE products_fts MATCH ?1 AND p.archived_at IS NULL ORDER BY bm25(products_fts) LIMIT ?2",
    )?;
    for r in stmt.query_map((&q, per_kind), |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, Option<String>>(2)?,
        ))
    })? {
        let (uid, name, sku) = r?;
        out.push(SearchHit {
            kind: "producto",
            uid,
            title: name,
            subtitle: sku.unwrap_or_default(),
        });
    }

    // Número de documento interno: "cot-147", "VEN-000089" o solo "000089".
    let term = input.trim().to_uppercase();
    if term.len() >= 3 && term.chars().any(|c| c.is_ascii_digit()) {
        let like = format!("%{}%", term.replace(' ', ""));
        for (sql, kind) in [
            (
                "SELECT q.uid, q.number, ifnull(c.name, q.prospect_name) FROM quotes q LEFT JOIN customers c ON c.id = q.customer_id WHERE q.number LIKE ?1 ORDER BY q.id DESC LIMIT ?2",
                "cotizacion",
            ),
            (
                "SELECT s.uid, s.number, ifnull(c.name, 'Cliente ocasional') FROM sales s LEFT JOIN customers c ON c.id = s.customer_id WHERE s.number LIKE ?1 ORDER BY s.id DESC LIMIT ?2",
                "venta",
            ),
            (
                "SELECT o.uid, o.number, p.name FROM purchase_orders o JOIN suppliers p ON p.id = o.supplier_id WHERE o.number LIKE ?1 ORDER BY o.id DESC LIMIT ?2",
                "orden_compra",
            ),
        ] {
            let mut stmt = conn.prepare(sql)?;
            for r in stmt.query_map((&like, per_kind), |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                ))
            })? {
                let (uid, number, who) = r?;
                out.push(SearchHit {
                    kind,
                    uid,
                    title: format!("{number} · {}", who.unwrap_or_default()),
                    subtitle: String::new(),
                });
            }
        }
    }

    let like = format!("%{}%", input.trim());
    let mut stmt = conn.prepare(
        "SELECT uid, file_name, ifnull(description, '') FROM attachments WHERE archived_at IS NULL AND (file_name LIKE ?1 OR description LIKE ?1)
         ORDER BY created_at DESC LIMIT ?2",
    )?;
    for r in stmt.query_map((&like, per_kind), |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
        ))
    })? {
        let (uid, name, desc) = r?;
        out.push(SearchHit {
            kind: "documento",
            uid,
            title: name,
            subtitle: if desc.is_empty() {
                "Documento adjunto".into()
            } else {
                desc
            },
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::*;

    #[test]
    fn numeracion_atomica_y_sin_retroceso() {
        let dir = tempfile::tempdir().unwrap();
        let db = fresh_db(&dir);
        assert_eq!(take_number(db.conn(), "COT").unwrap(), "COT-000001");
        assert_eq!(take_number(db.conn(), "COT").unwrap(), "COT-000002");
        assert_eq!(take_number(db.conn(), "VEN").unwrap(), "VEN-000001");
        assert!(
            update_sequence(db.conn(), "COT", "COT", 2, 6).is_err(),
            "no puede repetir números usados"
        );
        update_sequence(db.conn(), "COT", "PRESU", 100, 4).unwrap();
        assert_eq!(take_number(db.conn(), "COT").unwrap(), "PRESU-0100");
        let seq = sequences(db.conn()).unwrap();
        assert_eq!(
            seq.iter().find(|s| s.doc_type == "COT").unwrap().last_used,
            100
        );
    }

    #[test]
    fn tasas_por_fecha() {
        let dir = tempfile::tempdir().unwrap();
        let db = fresh_db(&dir);
        upsert_rate(db.conn(), "USD", "2026-10-01", 950_000_000, None).unwrap();
        upsert_rate(db.conn(), "USD", "2026-10-05", 960_500_000, Some("cierre")).unwrap();
        upsert_rate(db.conn(), "USD", "2026-10-05", 961_000_000, None).unwrap(); // reemplaza
        assert_eq!(
            rate_for(db.conn(), "USD", "2026-10-03").unwrap(),
            Some(950_000_000)
        );
        assert_eq!(
            rate_for(db.conn(), "USD", "2026-10-09").unwrap(),
            Some(961_000_000)
        );
        assert_eq!(rate_for(db.conn(), "USD", "2026-09-01").unwrap(), None);
        let usd = currencies(db.conn())
            .unwrap()
            .into_iter()
            .find(|c| c.code == "USD")
            .unwrap();
        assert_eq!(usd.last_rate_date.as_deref(), Some("2026-10-05"));
        assert_eq!(rates(db.conn(), "USD", 10).unwrap().len(), 2);
    }

    #[test]
    fn configuracion_json() {
        let dir = tempfile::tempdir().unwrap();
        let db = fresh_db(&dir);
        assert_eq!(get_setting(db.conn(), "negocio").unwrap(), None);
        set_setting(
            db.conn(),
            "negocio",
            &serde_json::json!({ "rut": "76.123.456-0" }),
        )
        .unwrap();
        assert_eq!(
            get_setting(db.conn(), "negocio").unwrap().unwrap()["rut"],
            "76.123.456-0"
        );
    }

    #[test]
    fn adjuntos_y_busqueda_global() {
        let dir = tempfile::tempdir().unwrap();
        let db = fresh_db(&dir);
        let c = db.conn();
        c.execute("INSERT INTO customers (uid, name, created_at) VALUES ('c1','Constructora Pérez','2026-10-06T00:00:00Z')", []).unwrap();
        c.execute("INSERT INTO products (uid, sku, name, price_minor, created_at) VALUES ('p1','TAL-18','Taladro inalámbrico',64990,'2026-10-06T00:00:00Z')", []).unwrap();
        let id = insert_attachment(
            c,
            &NewAttachment {
                uid: "a1",
                sha256: &"a".repeat(64),
                file_name: "contrato-perez.pdf",
                mime_type: "application/pdf",
                size_bytes: 10,
                description: Some("Contrato de arriendo"),
                created_by: Some(1),
            },
        )
        .unwrap();
        link_attachment(c, id, "cliente", 1).unwrap();
        assert_eq!(
            attachments(c, "", Some(("cliente", 1)), 10).unwrap()[0].links,
            vec!["cliente:1".to_string()]
        );
        let hits = global_search(c, "perez", 5).unwrap();
        let kinds: Vec<_> = hits.iter().map(|h| h.kind).collect();
        assert!(
            kinds.contains(&"cliente") && kinds.contains(&"documento"),
            "{kinds:?}"
        );
        assert_eq!(global_search(c, "talad", 5).unwrap()[0].kind, "producto");
        assert!(archive_attachment(c, "a1", "dueno").unwrap());
        assert!(attachment(c, "a1").unwrap().is_none());
    }
}
