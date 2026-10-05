-- NÚCLEO ERP · Migración 0003 · Clientes, proveedores, contactos y direcciones

CREATE TABLE customers (
    id                  INTEGER PRIMARY KEY,
    uid                 TEXT NOT NULL UNIQUE,
    kind                TEXT NOT NULL DEFAULT 'persona' CHECK (kind IN ('persona', 'empresa')),
    rut                 TEXT UNIQUE,              -- forma compacta "12345678-5"; opcional
    name                TEXT NOT NULL CHECK (length(trim(name)) > 0),   -- nombre o razón social
    trade_name          TEXT,                     -- nombre de fantasía
    business_activity   TEXT,                     -- giro
    email               TEXT,
    phone               TEXT,
    address             TEXT,
    commune             TEXT,
    city                TEXT,
    payment_terms_days  INTEGER NOT NULL DEFAULT 0 CHECK (payment_terms_days BETWEEN 0 AND 365),
    credit_limit_minor  INTEGER CHECK (credit_limit_minor IS NULL OR credit_limit_minor >= 0),
    price_list_id       INTEGER,                  -- FK a price_lists (0004); validada por la app
    salesperson_id      INTEGER REFERENCES users (id),
    birthday            TEXT CHECK (birthday IS NULL OR date(birthday) IS birthday),   -- opcional, solo si el cliente lo entrega
    notes               TEXT,
    created_at          TEXT NOT NULL,
    updated_at          TEXT,
    archived_at         TEXT
) STRICT;
CREATE INDEX idx_customers_name ON customers (name COLLATE NOCASE) WHERE archived_at IS NULL;

CREATE TABLE suppliers (
    id                  INTEGER PRIMARY KEY,
    uid                 TEXT NOT NULL UNIQUE,
    kind                TEXT NOT NULL DEFAULT 'empresa' CHECK (kind IN ('persona', 'empresa')),
    rut                 TEXT UNIQUE,
    is_foreign          INTEGER NOT NULL DEFAULT 0 CHECK (is_foreign IN (0, 1)),
    tax_id_foreign      TEXT,                     -- identificador tributario extranjero
    country             TEXT,
    name                TEXT NOT NULL CHECK (length(trim(name)) > 0),
    trade_name          TEXT,
    business_activity   TEXT,
    email               TEXT,
    phone               TEXT,
    address             TEXT,
    commune             TEXT,
    city                TEXT,
    currency_code       TEXT NOT NULL DEFAULT 'CLP' REFERENCES currencies (code),
    payment_terms_days  INTEGER NOT NULL DEFAULT 0 CHECK (payment_terms_days BETWEEN 0 AND 365),
    lead_time_days      INTEGER CHECK (lead_time_days IS NULL OR lead_time_days >= 0),  -- plazo declarado
    notes               TEXT,
    created_at          TEXT NOT NULL,
    updated_at          TEXT,
    archived_at         TEXT
) STRICT;
CREATE INDEX idx_suppliers_name ON suppliers (name COLLATE NOCASE) WHERE archived_at IS NULL;

-- Contactos y direcciones de clientes y proveedores.
CREATE TABLE contacts (
    id          INTEGER PRIMARY KEY,
    party_type  TEXT NOT NULL CHECK (party_type IN ('cliente', 'proveedor')),
    party_id    INTEGER NOT NULL,
    name        TEXT NOT NULL,
    role        TEXT,
    email       TEXT,
    phone       TEXT,
    is_primary  INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
    created_at  TEXT NOT NULL
) STRICT;
CREATE INDEX idx_contacts_party ON contacts (party_type, party_id);

CREATE TABLE addresses (
    id          INTEGER PRIMARY KEY,
    party_type  TEXT NOT NULL CHECK (party_type IN ('cliente', 'proveedor')),
    party_id    INTEGER NOT NULL,
    label       TEXT NOT NULL DEFAULT 'principal',
    address     TEXT NOT NULL,
    commune     TEXT,
    city        TEXT,
    region      TEXT,
    country     TEXT NOT NULL DEFAULT 'CL',
    is_delivery INTEGER NOT NULL DEFAULT 0 CHECK (is_delivery IN (0, 1))
) STRICT;
CREATE INDEX idx_addresses_party ON addresses (party_type, party_id);

-- Historial cronológico manual (llamadas, acuerdos, notas).
CREATE TABLE party_notes (
    id          INTEGER PRIMARY KEY,
    party_type  TEXT NOT NULL CHECK (party_type IN ('cliente', 'proveedor')),
    party_id    INTEGER NOT NULL,
    body        TEXT NOT NULL,
    created_by  INTEGER REFERENCES users (id),
    created_at  TEXT NOT NULL
) STRICT;
CREATE INDEX idx_party_notes ON party_notes (party_type, party_id, created_at);

-- Búsqueda global (FTS5, sin tildes).
CREATE VIRTUAL TABLE customers_fts USING fts5(
    name, trade_name, rut, email,
    content = 'customers', content_rowid = 'id',
    tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TRIGGER customers_ai AFTER INSERT ON customers BEGIN
    INSERT INTO customers_fts (rowid, name, trade_name, rut, email) VALUES (new.id, new.name, new.trade_name, new.rut, new.email);
END;
CREATE TRIGGER customers_ad AFTER DELETE ON customers BEGIN
    INSERT INTO customers_fts (customers_fts, rowid, name, trade_name, rut, email) VALUES ('delete', old.id, old.name, old.trade_name, old.rut, old.email);
END;
CREATE TRIGGER customers_au AFTER UPDATE OF name, trade_name, rut, email ON customers BEGIN
    INSERT INTO customers_fts (customers_fts, rowid, name, trade_name, rut, email) VALUES ('delete', old.id, old.name, old.trade_name, old.rut, old.email);
    INSERT INTO customers_fts (rowid, name, trade_name, rut, email) VALUES (new.id, new.name, new.trade_name, new.rut, new.email);
END;

CREATE VIRTUAL TABLE suppliers_fts USING fts5(
    name, trade_name, rut, email,
    content = 'suppliers', content_rowid = 'id',
    tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TRIGGER suppliers_ai AFTER INSERT ON suppliers BEGIN
    INSERT INTO suppliers_fts (rowid, name, trade_name, rut, email) VALUES (new.id, new.name, new.trade_name, new.rut, new.email);
END;
CREATE TRIGGER suppliers_ad AFTER DELETE ON suppliers BEGIN
    INSERT INTO suppliers_fts (suppliers_fts, rowid, name, trade_name, rut, email) VALUES ('delete', old.id, old.name, old.trade_name, old.rut, old.email);
END;
CREATE TRIGGER suppliers_au AFTER UPDATE OF name, trade_name, rut, email ON suppliers BEGIN
    INSERT INTO suppliers_fts (suppliers_fts, rowid, name, trade_name, rut, email) VALUES ('delete', old.id, old.name, old.trade_name, old.rut, old.email);
    INSERT INTO suppliers_fts (rowid, name, trade_name, rut, email) VALUES (new.id, new.name, new.trade_name, new.rut, new.email);
END;
