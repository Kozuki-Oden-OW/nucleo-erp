-- Accesos a sitios web (gestor de contraseñas de NÚCLEO): usuario y clave de cuentas de SOLO LECTURA
-- (colaborador de Mercado Libre, operador de consulta del banco…) para que NÚCLEO pueda iniciar sesión
-- con la autorización de la persona. La clave queda en la base cifrada de la empresa y nunca vuelve a la
-- interfaz ni al asistente (docs/AGENTE_CLAUDE.md §7).
CREATE TABLE site_accesses (
    id         INTEGER PRIMARY KEY,
    uid        TEXT NOT NULL UNIQUE,
    name       TEXT NOT NULL,
    login_url  TEXT NOT NULL,
    username   TEXT NOT NULL,
    secret     TEXT NOT NULL,
    -- lectura: solo consulta. operador: puede operar, pero sin facultad de pagar ni transferir.
    kind       TEXT NOT NULL CHECK (kind IN ('lectura', 'operador')),
    notes      TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
) STRICT;
CREATE UNIQUE INDEX idx_site_accesses_name ON site_accesses (lower(name));
