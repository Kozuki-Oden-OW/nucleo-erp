-- NÚCLEO ERP · Migración 0001 · Infraestructura base
-- Pre-1.0: las migraciones pueden reescribirse hasta la primera beta pública.
-- Desde la primera beta, toda migración publicada es INMUTABLE.

CREATE TABLE app_meta (
    key   TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
) STRICT;

CREATE TABLE settings (
    key        TEXT PRIMARY KEY NOT NULL,
    value_json TEXT NOT NULL CHECK (json_valid(value_json)),
    updated_at TEXT NOT NULL
) STRICT;

-- Numeración interna NÚCLEO (COT-000001…). No son folios tributarios.
CREATE TABLE numbering_sequences (
    doc_type    TEXT PRIMARY KEY NOT NULL,
    prefix      TEXT NOT NULL UNIQUE CHECK (length(prefix) BETWEEN 1 AND 6),
    next_number INTEGER NOT NULL DEFAULT 1 CHECK (next_number >= 1),
    width       INTEGER NOT NULL DEFAULT 6 CHECK (width BETWEEN 1 AND 12)
) STRICT;

-- Auditoría encadenada (ADR-012): cada fila guarda el hash de la anterior.
CREATE TABLE audit_log (
    id          INTEGER PRIMARY KEY,
    ts_utc      TEXT NOT NULL,
    user_name   TEXT NOT NULL,
    action      TEXT NOT NULL,
    entity      TEXT NOT NULL,
    entity_id   TEXT,
    before_json TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
    after_json  TEXT CHECK (after_json IS NULL OR json_valid(after_json)),
    reason      TEXT,
    prev_hash   TEXT NOT NULL,
    hash        TEXT NOT NULL UNIQUE
) STRICT;

CREATE INDEX idx_audit_entity ON audit_log (entity, entity_id);

-- La auditoría no se modifica ni se borra desde la aplicación.
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log es de solo inserción'); END;
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log es de solo inserción'); END;
