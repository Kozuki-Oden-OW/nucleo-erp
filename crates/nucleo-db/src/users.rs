//! Usuarios locales, roles y permisos (Blueprint §10.4). La verificación de contraseñas y de
//! permisos vive en `nucleo-app`; aquí solo el acceso a datos.

use crate::{DbError, DbResult};
use rusqlite::{Connection, OptionalExtension, Row};
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct UserRow {
    pub id: i64,
    pub uid: String,
    pub username: String,
    pub display_name: String,
    pub has_password: bool,
    pub is_active: bool,
    pub last_login_at: Option<String>,
    pub created_at: String,
    pub roles: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RoleRow {
    pub code: String,
    pub name: String,
    pub is_system: bool,
    pub permissions: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PermissionRow {
    pub code: String,
    pub description: String,
}

const COLS: &str = "id, uid, username, display_name, password_hash IS NOT NULL, is_active, last_login_at, created_at";

fn map(r: &Row<'_>) -> rusqlite::Result<UserRow> {
    Ok(UserRow {
        id: r.get(0)?,
        uid: r.get(1)?,
        username: r.get(2)?,
        display_name: r.get(3)?,
        has_password: r.get::<_, i64>(4)? == 1,
        is_active: r.get::<_, i64>(5)? == 1,
        last_login_at: r.get(6)?,
        created_at: r.get(7)?,
        roles: Vec::new(),
    })
}

fn with_roles(conn: &Connection, mut u: UserRow) -> DbResult<UserRow> {
    let mut stmt = conn.prepare(
        "SELECT r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ?1 ORDER BY r.id",
    )?;
    u.roles = stmt
        .query_map([u.id], |r| r.get(0))?
        .collect::<Result<_, _>>()?;
    Ok(u)
}

pub fn list(conn: &Connection) -> DbResult<Vec<UserRow>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLS} FROM users WHERE archived_at IS NULL ORDER BY id"
    ))?;
    let rows: Vec<UserRow> = stmt.query_map([], map)?.collect::<Result<_, _>>()?;
    rows.into_iter().map(|u| with_roles(conn, u)).collect()
}

pub fn by_uid(conn: &Connection, uid: &str) -> DbResult<Option<UserRow>> {
    let u = conn
        .query_row(
            &format!("SELECT {COLS} FROM users WHERE uid = ?1"),
            [uid],
            map,
        )
        .optional()?;
    u.map(|u| with_roles(conn, u)).transpose()
}

pub fn by_username(conn: &Connection, username: &str) -> DbResult<Option<UserRow>> {
    let u = conn
        .query_row(
            &format!("SELECT {COLS} FROM users WHERE username = ?1 COLLATE NOCASE AND archived_at IS NULL"),
            [username.trim()],
            map,
        )
        .optional()?;
    u.map(|u| with_roles(conn, u)).transpose()
}

/// Hash de contraseña (PHC) y estado de bloqueo, para el inicio de sesión.
pub fn credentials(
    conn: &Connection,
    user_id: i64,
) -> DbResult<(Option<String>, i64, Option<String>)> {
    Ok(conn.query_row(
        "SELECT password_hash, failed_attempts, locked_until FROM users WHERE id = ?1",
        [user_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?)
}

pub fn any_password(conn: &Connection) -> DbResult<bool> {
    Ok(conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM users WHERE password_hash IS NOT NULL AND is_active = 1 AND archived_at IS NULL)",
        [],
        |r| r.get(0),
    )?)
}

/// Primer usuario activo con rol de dueño o administrador (modo de un solo usuario sin contraseña).
pub fn default_owner(conn: &Connection) -> DbResult<Option<UserRow>> {
    let uid: Option<String> = conn
        .query_row(
            "SELECT u.uid FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
             WHERE u.is_active = 1 AND u.archived_at IS NULL AND r.code IN ('dueno', 'admin')
             ORDER BY u.id LIMIT 1",
            [],
            |r| r.get(0),
        )
        .optional()?;
    uid.map(|u| by_uid(conn, &u))
        .transpose()
        .map(Option::flatten)
}

pub fn insert(
    conn: &Connection,
    uid: &str,
    username: &str,
    display_name: &str,
    created_at: &str,
) -> DbResult<i64> {
    let res = conn.execute(
        "INSERT INTO users (uid, username, display_name, created_at) VALUES (?1, ?2, ?3, ?4)",
        (uid, username.trim(), display_name.trim(), created_at),
    );
    match res {
        Err(rusqlite::Error::SqliteFailure(e, Some(msg)))
            if e.code == rusqlite::ErrorCode::ConstraintViolation
                && msg.contains("users.username") =>
        {
            Err(DbError::Duplicate("nombre de usuario"))
        }
        other => {
            other?;
            Ok(conn.last_insert_rowid())
        }
    }
}

pub fn update_profile(
    conn: &Connection,
    id: i64,
    display_name: &str,
    is_active: bool,
) -> DbResult<()> {
    conn.execute(
        "UPDATE users SET display_name = ?2, is_active = ?3 WHERE id = ?1",
        (id, display_name.trim(), is_active as i64),
    )?;
    Ok(())
}

pub fn set_password_hash(conn: &Connection, id: i64, hash: Option<&str>) -> DbResult<()> {
    conn.execute(
        "UPDATE users SET password_hash = ?2, failed_attempts = 0, locked_until = NULL WHERE id = ?1",
        (id, hash),
    )?;
    Ok(())
}

pub fn record_login(
    conn: &Connection,
    id: i64,
    ok: bool,
    now: &str,
    lock_until: Option<&str>,
) -> DbResult<()> {
    if ok {
        conn.execute(
            "UPDATE users SET last_login_at = ?2, failed_attempts = 0, locked_until = NULL WHERE id = ?1",
            (id, now),
        )?;
    } else {
        conn.execute(
            "UPDATE users SET failed_attempts = failed_attempts + 1, locked_until = ?2 WHERE id = ?1",
            (id, lock_until),
        )?;
    }
    Ok(())
}

pub fn set_roles(conn: &Connection, user_id: i64, role_codes: &[String]) -> DbResult<()> {
    conn.execute("DELETE FROM user_roles WHERE user_id = ?1", [user_id])?;
    for code in role_codes {
        let n = conn.execute(
            "INSERT INTO user_roles (user_id, role_id) SELECT ?1, id FROM roles WHERE code = ?2",
            (user_id, code),
        )?;
        if n == 0 {
            return Err(DbError::Rule(format!("rol desconocido: {code}")));
        }
    }
    Ok(())
}

/// Cantidad de usuarios activos con rol dueño o administrador (nunca debe quedar en cero).
pub fn active_owners(conn: &Connection) -> DbResult<i64> {
    Ok(conn.query_row(
        "SELECT count(DISTINCT u.id) FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
         WHERE u.is_active = 1 AND u.archived_at IS NULL AND r.code IN ('dueno', 'admin')",
        [],
        |r| r.get(0),
    )?)
}

pub fn permissions_of(conn: &Connection, user_id: i64) -> DbResult<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT DISTINCT rp.permission_code FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id
         WHERE ur.user_id = ?1 ORDER BY 1",
    )?;
    Ok(stmt
        .query_map([user_id], |r| r.get(0))?
        .collect::<Result<_, _>>()?)
}

pub fn roles(conn: &Connection) -> DbResult<Vec<RoleRow>> {
    let mut stmt = conn.prepare("SELECT id, code, name, is_system FROM roles ORDER BY id")?;
    let base: Vec<(i64, String, String, bool)> = stmt
        .query_map([], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get::<_, i64>(3)? == 1))
        })?
        .collect::<Result<_, _>>()?;
    let mut perms =
        conn.prepare("SELECT permission_code FROM role_permissions WHERE role_id = ?1 ORDER BY 1")?;
    let mut out = Vec::new();
    for (id, code, name, is_system) in base {
        let permissions = perms
            .query_map([id], |r| r.get(0))?
            .collect::<Result<_, _>>()?;
        out.push(RoleRow {
            code,
            name,
            is_system,
            permissions,
        });
    }
    Ok(out)
}

pub fn permissions(conn: &Connection) -> DbResult<Vec<PermissionRow>> {
    let mut stmt = conn.prepare("SELECT code, description FROM permissions ORDER BY code")?;
    Ok(stmt
        .query_map([], |r| {
            Ok(PermissionRow {
                code: r.get(0)?,
                description: r.get(1)?,
            })
        })?
        .collect::<Result<_, _>>()?)
}

pub fn set_role_permissions(conn: &Connection, role_code: &str, perms: &[String]) -> DbResult<()> {
    let role_id: i64 = conn
        .query_row("SELECT id FROM roles WHERE code = ?1", [role_code], |r| {
            r.get(0)
        })
        .optional()?
        .ok_or_else(|| DbError::Rule(format!("rol desconocido: {role_code}")))?;
    conn.execute("DELETE FROM role_permissions WHERE role_id = ?1", [role_id])?;
    for p in perms {
        conn.execute(
            "INSERT INTO role_permissions (role_id, permission_code) VALUES (?1, ?2)",
            (role_id, p),
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::*;

    #[test]
    fn dueno_inicial_con_todos_los_permisos() {
        let dir = tempfile::tempdir().unwrap();
        let db = fresh_db(&dir);
        let all = list(db.conn()).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].username, "dueno");
        assert_eq!(all[0].roles, vec!["dueno".to_string()]);
        assert!(!any_password(db.conn()).unwrap());
        let perms = permissions_of(db.conn(), all[0].id).unwrap();
        assert_eq!(perms.len(), permissions(db.conn()).unwrap().len());
        assert_eq!(default_owner(db.conn()).unwrap().unwrap().username, "dueno");
    }

    #[test]
    fn roles_base_y_plantilla() {
        let dir = tempfile::tempdir().unwrap();
        let db = fresh_db(&dir);
        let r = roles(db.conn()).unwrap();
        assert_eq!(r.len(), 8);
        let ventas = r.iter().find(|x| x.code == "ventas").unwrap();
        assert!(ventas.permissions.contains(&"ventas.efectuar".to_string()));
        assert!(
            !ventas
                .permissions
                .contains(&"usuarios.gestionar".to_string())
        );
        assert!(!ventas.permissions.contains(&"costos.ver".to_string()));
    }

    #[test]
    fn usuario_duplicado_sin_importar_mayusculas() {
        let dir = tempfile::tempdir().unwrap();
        let db = fresh_db(&dir);
        insert(db.conn(), "u1", "maria", "María", "2026-10-06T00:00:00Z").unwrap();
        let e = insert(db.conn(), "u2", "MARIA", "Otra", "2026-10-06T00:00:00Z")
            .err()
            .unwrap();
        assert!(matches!(e, DbError::Duplicate(_)));
    }
}
