-- Fase S0 de la sincronización celular ⇄ computador (docs/SINCRONIZACION.md).
--
-- * sync_state: identidad de este dispositivo y su reloj lógico híbrido (milisegundos + contador).
-- * change_log: cada cambio de campo en las fichas (categorías, clientes, proveedores y productos),
--   escrito por triggers en la misma transacción que el cambio, con su marca de reloj.
--   Las referencias entre fichas se guardan por uid (no por id local), para que viajen entre bases.
-- * sync_peers: dispositivos emparejados y hasta qué marca de reloj se les envió o se recibió.
-- * sync_outbox: operaciones creadas en el celular (venta rápida, gasto, cobro) que esperan viajar.
-- * sync_applied: operaciones ya aplicadas en el computador; aplicar dos veces no duplica nada.
-- * sync_aliases: fichas unidas por su clave natural (mismo RUT, código o nombre de categoría).
-- * sync_conflicts: lo que el dueño debe revisar (p. ej. dos fichas unidas por tener el mismo RUT).
--
-- Mientras se aplica lo recibido de otro dispositivo, sync_state.applying = 1 y los triggers no
-- vuelven a registrar esos cambios como propios.

CREATE TABLE sync_state (
    id          INTEGER PRIMARY KEY CHECK (id = 1),
    device_uid  TEXT NOT NULL,
    role        TEXT NOT NULL DEFAULT 'escritorio' CHECK (role IN ('escritorio', 'celular')),
    hlc_ms      INTEGER NOT NULL DEFAULT 0,
    hlc_counter INTEGER NOT NULL DEFAULT 0,
    applying    INTEGER NOT NULL DEFAULT 0
);
INSERT INTO sync_state (id, device_uid) VALUES (1, lower(hex(randomblob(16))));

CREATE TABLE change_log (
    id          INTEGER PRIMARY KEY,
    hlc         TEXT NOT NULL,
    device_uid  TEXT NOT NULL,
    entity      TEXT NOT NULL,
    entity_uid  TEXT NOT NULL,
    field       TEXT NOT NULL,
    value_json  TEXT NOT NULL
);
CREATE INDEX idx_change_log_hlc ON change_log (hlc);
CREATE INDEX idx_change_log_field ON change_log (entity, entity_uid, field, hlc);

CREATE TABLE sync_peers (
    id            INTEGER PRIMARY KEY,
    device_uid    TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('escritorio', 'celular')),
    paired_at     TEXT NOT NULL,
    revoked_at    TEXT,
    sent_hlc      TEXT NOT NULL DEFAULT '',
    received_hlc  TEXT NOT NULL DEFAULT '',
    last_sync_at  TEXT
);

CREATE TABLE sync_outbox (
    op_uid       TEXT PRIMARY KEY,
    kind         TEXT NOT NULL CHECK (kind IN ('venta', 'gasto', 'cobro')),
    payload_json TEXT NOT NULL,
    hlc          TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    sent_at      TEXT
);

CREATE TABLE sync_applied (
    op_uid        TEXT PRIMARY KEY,
    origin_device TEXT NOT NULL,
    kind          TEXT NOT NULL,
    applied_at    TEXT NOT NULL,
    result_json   TEXT NOT NULL
);

-- Fichas unidas por su clave natural (mismo RUT, código o categoría creados en ambos equipos):
-- el uid que llegó de otro dispositivo apunta a la ficha local.
CREATE TABLE sync_aliases (
    entity    TEXT NOT NULL,
    alias_uid TEXT NOT NULL,
    uid       TEXT NOT NULL,
    PRIMARY KEY (entity, alias_uid)
);

CREATE TABLE sync_conflicts (
    id          INTEGER PRIMARY KEY,
    entity      TEXT NOT NULL,
    entity_uid  TEXT NOT NULL,
    field       TEXT NOT NULL,
    detail      TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    resolved_at TEXT
);


CREATE TRIGGER sync_categories_ai AFTER INSERT ON categories
WHEN (SELECT applying FROM sync_state WHERE id = 1) = 0
BEGIN
    UPDATE sync_state SET
        hlc_counter = CASE WHEN max(CAST(unixepoch('subsec') * 1000 AS INTEGER), hlc_ms) = hlc_ms THEN hlc_counter + 1 ELSE 0 END,
        hlc_ms = max(CAST(unixepoch('subsec') * 1000 AS INTEGER), hlc_ms)
    WHERE id = 1;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'categories', NEW.uid, 'name', json_quote(NEW.name);
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'categories', NEW.uid, 'archived_at', json_quote(NEW.archived_at);
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'categories', NEW.uid, 'parent_uid', json_quote((SELECT uid FROM categories WHERE id = NEW.parent_id));
END;

CREATE TRIGGER sync_categories_au AFTER UPDATE ON categories
WHEN (SELECT applying FROM sync_state WHERE id = 1) = 0
BEGIN
    UPDATE sync_state SET
        hlc_counter = CASE WHEN max(CAST(unixepoch('subsec') * 1000 AS INTEGER), hlc_ms) = hlc_ms THEN hlc_counter + 1 ELSE 0 END,
        hlc_ms = max(CAST(unixepoch('subsec') * 1000 AS INTEGER), hlc_ms)
    WHERE id = 1;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'categories', NEW.uid, 'name', json_quote(NEW.name)
    WHERE OLD.name IS NOT NEW.name;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'categories', NEW.uid, 'archived_at', json_quote(NEW.archived_at)
    WHERE OLD.archived_at IS NOT NEW.archived_at;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'categories', NEW.uid, 'parent_uid', json_quote((SELECT uid FROM categories WHERE id = NEW.parent_id))
    WHERE OLD.parent_id IS NOT NEW.parent_id;
END;

CREATE TRIGGER sync_customers_ai AFTER INSERT ON customers
WHEN (SELECT applying FROM sync_state WHERE id = 1) = 0
BEGIN
    UPDATE sync_state SET
        hlc_counter = CASE WHEN max(CAST(unixepoch('subsec') * 1000 AS INTEGER), hlc_ms) = hlc_ms THEN hlc_counter + 1 ELSE 0 END,
        hlc_ms = max(CAST(unixepoch('subsec') * 1000 AS INTEGER), hlc_ms)
    WHERE id = 1;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'customers', NEW.uid, 'kind', json_quote(NEW.kind);
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'customers', NEW.uid, 'rut', json_quote(NEW.rut);
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'customers', NEW.uid, 'name', json_quote(NEW.name);
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'customers', NEW.uid, 'trade_name', json_quote(NEW.trade_name);
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'customers', NEW.uid, 'business_activity', json_quote(NEW.business_activity);
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'customers', NEW.uid, 'email', json_quote(NEW.email);
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'customers', NEW.uid, 'phone', json_quote(NEW.phone);
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'customers', NEW.uid, 'address', json_quote(NEW.address);
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'customers', NEW.uid, 'commune', json_quote(NEW.commune);
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'customers', NEW.uid, 'city', json_quote(NEW.city);
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'customers', NEW.uid, 'payment_terms_days', json_quote(NEW.payment_terms_days);
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'customers', NEW.uid, 'credit_limit_minor', json_quote(NEW.credit_limit_minor);
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'customers', NEW.uid, 'birthday', json_quote(NEW.birthday);
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'customers', NEW.uid, 'notes', json_quote(NEW.notes);
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'customers', NEW.uid, 'archived_at', json_quote(NEW.archived_at);
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'customers', NEW.uid, 'region', json_quote(NEW.region);
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'customers', NEW.uid, 'contact_name', json_quote(NEW.contact_name);
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'customers', NEW.uid, 'invoice_email', json_quote(NEW.invoice_email);
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'customers', NEW.uid, 'credit_enabled', json_quote(NEW.credit_enabled);
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'customers', NEW.uid, 'credit_conditions', json_quote(NEW.credit_conditions);
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'customers', NEW.uid, 'preferred', json_quote(NEW.preferred);
END;

CREATE TRIGGER sync_customers_au AFTER UPDATE ON customers
WHEN (SELECT applying FROM sync_state WHERE id = 1) = 0
BEGIN
    UPDATE sync_state SET
        hlc_counter = CASE WHEN max(CAST(unixepoch('subsec') * 1000 AS INTEGER), hlc_ms) = hlc_ms THEN hlc_counter + 1 ELSE 0 END,
        hlc_ms = max(CAST(unixepoch('subsec') * 1000 AS INTEGER), hlc_ms)
    WHERE id = 1;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'customers', NEW.uid, 'kind', json_quote(NEW.kind)
    WHERE OLD.kind IS NOT NEW.kind;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'customers', NEW.uid, 'rut', json_quote(NEW.rut)
    WHERE OLD.rut IS NOT NEW.rut;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'customers', NEW.uid, 'name', json_quote(NEW.name)
    WHERE OLD.name IS NOT NEW.name;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'customers', NEW.uid, 'trade_name', json_quote(NEW.trade_name)
    WHERE OLD.trade_name IS NOT NEW.trade_name;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'customers', NEW.uid, 'business_activity', json_quote(NEW.business_activity)
    WHERE OLD.business_activity IS NOT NEW.business_activity;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'customers', NEW.uid, 'email', json_quote(NEW.email)
    WHERE OLD.email IS NOT NEW.email;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'customers', NEW.uid, 'phone', json_quote(NEW.phone)
    WHERE OLD.phone IS NOT NEW.phone;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'customers', NEW.uid, 'address', json_quote(NEW.address)
    WHERE OLD.address IS NOT NEW.address;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'customers', NEW.uid, 'commune', json_quote(NEW.commune)
    WHERE OLD.commune IS NOT NEW.commune;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'customers', NEW.uid, 'city', json_quote(NEW.city)
    WHERE OLD.city IS NOT NEW.city;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'customers', NEW.uid, 'payment_terms_days', json_quote(NEW.payment_terms_days)
    WHERE OLD.payment_terms_days IS NOT NEW.payment_terms_days;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'customers', NEW.uid, 'credit_limit_minor', json_quote(NEW.credit_limit_minor)
    WHERE OLD.credit_limit_minor IS NOT NEW.credit_limit_minor;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'customers', NEW.uid, 'birthday', json_quote(NEW.birthday)
    WHERE OLD.birthday IS NOT NEW.birthday;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'customers', NEW.uid, 'notes', json_quote(NEW.notes)
    WHERE OLD.notes IS NOT NEW.notes;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'customers', NEW.uid, 'archived_at', json_quote(NEW.archived_at)
    WHERE OLD.archived_at IS NOT NEW.archived_at;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'customers', NEW.uid, 'region', json_quote(NEW.region)
    WHERE OLD.region IS NOT NEW.region;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'customers', NEW.uid, 'contact_name', json_quote(NEW.contact_name)
    WHERE OLD.contact_name IS NOT NEW.contact_name;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'customers', NEW.uid, 'invoice_email', json_quote(NEW.invoice_email)
    WHERE OLD.invoice_email IS NOT NEW.invoice_email;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'customers', NEW.uid, 'credit_enabled', json_quote(NEW.credit_enabled)
    WHERE OLD.credit_enabled IS NOT NEW.credit_enabled;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'customers', NEW.uid, 'credit_conditions', json_quote(NEW.credit_conditions)
    WHERE OLD.credit_conditions IS NOT NEW.credit_conditions;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'customers', NEW.uid, 'preferred', json_quote(NEW.preferred)
    WHERE OLD.preferred IS NOT NEW.preferred;
END;

CREATE TRIGGER sync_suppliers_ai AFTER INSERT ON suppliers
WHEN (SELECT applying FROM sync_state WHERE id = 1) = 0
BEGIN
    UPDATE sync_state SET
        hlc_counter = CASE WHEN max(CAST(unixepoch('subsec') * 1000 AS INTEGER), hlc_ms) = hlc_ms THEN hlc_counter + 1 ELSE 0 END,
        hlc_ms = max(CAST(unixepoch('subsec') * 1000 AS INTEGER), hlc_ms)
    WHERE id = 1;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'suppliers', NEW.uid, 'kind', json_quote(NEW.kind);
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'suppliers', NEW.uid, 'rut', json_quote(NEW.rut);
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'suppliers', NEW.uid, 'is_foreign', json_quote(NEW.is_foreign);
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'suppliers', NEW.uid, 'tax_id_foreign', json_quote(NEW.tax_id_foreign);
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'suppliers', NEW.uid, 'country', json_quote(NEW.country);
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'suppliers', NEW.uid, 'name', json_quote(NEW.name);
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'suppliers', NEW.uid, 'trade_name', json_quote(NEW.trade_name);
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'suppliers', NEW.uid, 'business_activity', json_quote(NEW.business_activity);
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'suppliers', NEW.uid, 'email', json_quote(NEW.email);
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'suppliers', NEW.uid, 'phone', json_quote(NEW.phone);
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'suppliers', NEW.uid, 'address', json_quote(NEW.address);
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'suppliers', NEW.uid, 'commune', json_quote(NEW.commune);
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'suppliers', NEW.uid, 'city', json_quote(NEW.city);
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'suppliers', NEW.uid, 'currency_code', json_quote(NEW.currency_code);
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'suppliers', NEW.uid, 'payment_terms_days', json_quote(NEW.payment_terms_days);
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'suppliers', NEW.uid, 'lead_time_days', json_quote(NEW.lead_time_days);
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'suppliers', NEW.uid, 'notes', json_quote(NEW.notes);
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'suppliers', NEW.uid, 'archived_at', json_quote(NEW.archived_at);
END;

CREATE TRIGGER sync_suppliers_au AFTER UPDATE ON suppliers
WHEN (SELECT applying FROM sync_state WHERE id = 1) = 0
BEGIN
    UPDATE sync_state SET
        hlc_counter = CASE WHEN max(CAST(unixepoch('subsec') * 1000 AS INTEGER), hlc_ms) = hlc_ms THEN hlc_counter + 1 ELSE 0 END,
        hlc_ms = max(CAST(unixepoch('subsec') * 1000 AS INTEGER), hlc_ms)
    WHERE id = 1;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'suppliers', NEW.uid, 'kind', json_quote(NEW.kind)
    WHERE OLD.kind IS NOT NEW.kind;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'suppliers', NEW.uid, 'rut', json_quote(NEW.rut)
    WHERE OLD.rut IS NOT NEW.rut;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'suppliers', NEW.uid, 'is_foreign', json_quote(NEW.is_foreign)
    WHERE OLD.is_foreign IS NOT NEW.is_foreign;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'suppliers', NEW.uid, 'tax_id_foreign', json_quote(NEW.tax_id_foreign)
    WHERE OLD.tax_id_foreign IS NOT NEW.tax_id_foreign;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'suppliers', NEW.uid, 'country', json_quote(NEW.country)
    WHERE OLD.country IS NOT NEW.country;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'suppliers', NEW.uid, 'name', json_quote(NEW.name)
    WHERE OLD.name IS NOT NEW.name;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'suppliers', NEW.uid, 'trade_name', json_quote(NEW.trade_name)
    WHERE OLD.trade_name IS NOT NEW.trade_name;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'suppliers', NEW.uid, 'business_activity', json_quote(NEW.business_activity)
    WHERE OLD.business_activity IS NOT NEW.business_activity;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'suppliers', NEW.uid, 'email', json_quote(NEW.email)
    WHERE OLD.email IS NOT NEW.email;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'suppliers', NEW.uid, 'phone', json_quote(NEW.phone)
    WHERE OLD.phone IS NOT NEW.phone;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'suppliers', NEW.uid, 'address', json_quote(NEW.address)
    WHERE OLD.address IS NOT NEW.address;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'suppliers', NEW.uid, 'commune', json_quote(NEW.commune)
    WHERE OLD.commune IS NOT NEW.commune;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'suppliers', NEW.uid, 'city', json_quote(NEW.city)
    WHERE OLD.city IS NOT NEW.city;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'suppliers', NEW.uid, 'currency_code', json_quote(NEW.currency_code)
    WHERE OLD.currency_code IS NOT NEW.currency_code;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'suppliers', NEW.uid, 'payment_terms_days', json_quote(NEW.payment_terms_days)
    WHERE OLD.payment_terms_days IS NOT NEW.payment_terms_days;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'suppliers', NEW.uid, 'lead_time_days', json_quote(NEW.lead_time_days)
    WHERE OLD.lead_time_days IS NOT NEW.lead_time_days;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'suppliers', NEW.uid, 'notes', json_quote(NEW.notes)
    WHERE OLD.notes IS NOT NEW.notes;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'suppliers', NEW.uid, 'archived_at', json_quote(NEW.archived_at)
    WHERE OLD.archived_at IS NOT NEW.archived_at;
END;

CREATE TRIGGER sync_products_ai AFTER INSERT ON products
WHEN (SELECT applying FROM sync_state WHERE id = 1) = 0
BEGIN
    UPDATE sync_state SET
        hlc_counter = CASE WHEN max(CAST(unixepoch('subsec') * 1000 AS INTEGER), hlc_ms) = hlc_ms THEN hlc_counter + 1 ELSE 0 END,
        hlc_ms = max(CAST(unixepoch('subsec') * 1000 AS INTEGER), hlc_ms)
    WHERE id = 1;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'products', NEW.uid, 'kind', json_quote(NEW.kind);
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'products', NEW.uid, 'sku', json_quote(NEW.sku);
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'products', NEW.uid, 'barcode', json_quote(NEW.barcode);
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'products', NEW.uid, 'name', json_quote(NEW.name);
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'products', NEW.uid, 'description', json_quote(NEW.description);
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'products', NEW.uid, 'unit_code', json_quote(NEW.unit_code);
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'products', NEW.uid, 'taxable', json_quote(NEW.taxable);
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'products', NEW.uid, 'track_stock', json_quote(NEW.track_stock);
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'products', NEW.uid, 'price_minor', json_quote(NEW.price_minor);
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'products', NEW.uid, 'min_stock_milli', json_quote(NEW.min_stock_milli);
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'products', NEW.uid, 'max_stock_milli', json_quote(NEW.max_stock_milli);
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'products', NEW.uid, 'weight_g', json_quote(NEW.weight_g);
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'products', NEW.uid, 'volume_cm3', json_quote(NEW.volume_cm3);
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'products', NEW.uid, 'hs_code', json_quote(NEW.hs_code);
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'products', NEW.uid, 'archived_at', json_quote(NEW.archived_at);
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'products', NEW.uid, 'cost_sheet_json', json_quote(NEW.cost_sheet_json);
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'products', NEW.uid, 'stock_policy', json_quote(NEW.stock_policy);
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'products', NEW.uid, 'category_uid', json_quote((SELECT uid FROM categories WHERE id = NEW.category_id));
END;

CREATE TRIGGER sync_products_au AFTER UPDATE ON products
WHEN (SELECT applying FROM sync_state WHERE id = 1) = 0
BEGIN
    UPDATE sync_state SET
        hlc_counter = CASE WHEN max(CAST(unixepoch('subsec') * 1000 AS INTEGER), hlc_ms) = hlc_ms THEN hlc_counter + 1 ELSE 0 END,
        hlc_ms = max(CAST(unixepoch('subsec') * 1000 AS INTEGER), hlc_ms)
    WHERE id = 1;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'products', NEW.uid, 'kind', json_quote(NEW.kind)
    WHERE OLD.kind IS NOT NEW.kind;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'products', NEW.uid, 'sku', json_quote(NEW.sku)
    WHERE OLD.sku IS NOT NEW.sku;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'products', NEW.uid, 'barcode', json_quote(NEW.barcode)
    WHERE OLD.barcode IS NOT NEW.barcode;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'products', NEW.uid, 'name', json_quote(NEW.name)
    WHERE OLD.name IS NOT NEW.name;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'products', NEW.uid, 'description', json_quote(NEW.description)
    WHERE OLD.description IS NOT NEW.description;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'products', NEW.uid, 'unit_code', json_quote(NEW.unit_code)
    WHERE OLD.unit_code IS NOT NEW.unit_code;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'products', NEW.uid, 'taxable', json_quote(NEW.taxable)
    WHERE OLD.taxable IS NOT NEW.taxable;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'products', NEW.uid, 'track_stock', json_quote(NEW.track_stock)
    WHERE OLD.track_stock IS NOT NEW.track_stock;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'products', NEW.uid, 'price_minor', json_quote(NEW.price_minor)
    WHERE OLD.price_minor IS NOT NEW.price_minor;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'products', NEW.uid, 'min_stock_milli', json_quote(NEW.min_stock_milli)
    WHERE OLD.min_stock_milli IS NOT NEW.min_stock_milli;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'products', NEW.uid, 'max_stock_milli', json_quote(NEW.max_stock_milli)
    WHERE OLD.max_stock_milli IS NOT NEW.max_stock_milli;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'products', NEW.uid, 'weight_g', json_quote(NEW.weight_g)
    WHERE OLD.weight_g IS NOT NEW.weight_g;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'products', NEW.uid, 'volume_cm3', json_quote(NEW.volume_cm3)
    WHERE OLD.volume_cm3 IS NOT NEW.volume_cm3;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'products', NEW.uid, 'hs_code', json_quote(NEW.hs_code)
    WHERE OLD.hs_code IS NOT NEW.hs_code;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'products', NEW.uid, 'archived_at', json_quote(NEW.archived_at)
    WHERE OLD.archived_at IS NOT NEW.archived_at;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'products', NEW.uid, 'cost_sheet_json', json_quote(NEW.cost_sheet_json)
    WHERE OLD.cost_sheet_json IS NOT NEW.cost_sheet_json;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'products', NEW.uid, 'stock_policy', json_quote(NEW.stock_policy)
    WHERE OLD.stock_policy IS NOT NEW.stock_policy;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'products', NEW.uid, 'category_uid', json_quote((SELECT uid FROM categories WHERE id = NEW.category_id))
    WHERE OLD.category_id IS NOT NEW.category_id;
END;
