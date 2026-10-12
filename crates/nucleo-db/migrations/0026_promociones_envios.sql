-- Fase 12: descuentos y promociones, cliente preferencial y envíos.

-- Cliente preferencial: recibe las promociones de tipo «preferencial».
ALTER TABLE customers ADD COLUMN preferred INTEGER NOT NULL DEFAULT 0 CHECK (preferred IN (0, 1));

-- Promociones. La regla de cada tipo va en `rule_json` (productos, tramos, porcentajes, clientes):
--   pack        = varios productos juntos a un precio fijo o con un % de descuento
--   cantidad    = % de descuento por tramos de cantidad (opcionalmente sumando varios productos)
--   lleva_paga  = lleva X y paga Y (ej. 3x2)
--   cliente     = % de descuento para clientes elegidos
--   preferencial= % de descuento para los clientes marcados como preferenciales
CREATE TABLE promotions (
    id          INTEGER PRIMARY KEY,
    uid         TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
    kind        TEXT NOT NULL CHECK (kind IN ('pack', 'cantidad', 'lleva_paga', 'cliente', 'preferencial')),
    rule_json   TEXT NOT NULL CHECK (json_valid(rule_json)),
    starts_on   TEXT CHECK (starts_on IS NULL OR date(starts_on) IS starts_on),
    ends_on     TEXT CHECK (ends_on IS NULL OR date(ends_on) IS ends_on),
    active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    notes       TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT,
    archived_at TEXT,
    CHECK (starts_on IS NULL OR ends_on IS NULL OR ends_on >= starts_on)
) STRICT;

-- Envíos: a quién, por qué agencia, con qué número de seguimiento y en qué estado va.
INSERT INTO document_types (code, name, family, internal_legend, print_title, affects_stock, affects_balance, needs_documentation)
VALUES ('ENV', 'Envío', 'venta', 0, 'ENVÍO', 0, 0, 0);
INSERT INTO numbering_sequences (doc_type, prefix) VALUES ('ENV', 'ENV');

CREATE TABLE shipments (
    id            INTEGER PRIMARY KEY,
    uid           TEXT NOT NULL UNIQUE,
    number        TEXT NOT NULL UNIQUE,
    sale_id       INTEGER REFERENCES sales (id),
    customer_id   INTEGER REFERENCES customers (id),
    carrier       TEXT,
    tracking      TEXT,
    first_name    TEXT,
    last_name     TEXT,
    phone         TEXT,
    address       TEXT,
    commune       TEXT,
    city          TEXT,
    region        TEXT,
    shipped_on    TEXT CHECK (shipped_on IS NULL OR date(shipped_on) IS shipped_on),
    delivered_on  TEXT CHECK (delivered_on IS NULL OR date(delivered_on) IS delivered_on),
    status        TEXT NOT NULL DEFAULT 'no_despachado'
                  CHECK (status IN ('no_despachado', 'en_camino', 'entregado', 'no_entregado')),
    notes         TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT
) STRICT;
CREATE INDEX idx_shipments_status ON shipments (status);
CREATE INDEX idx_shipments_sale ON shipments (sale_id);
