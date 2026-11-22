-- Integraciones con servicios externos (Mercado Libre; luego couriers). La configuración y los tokens
-- quedan en la base cifrada de la empresa.
CREATE TABLE integrations (
    provider     TEXT PRIMARY KEY CHECK (provider IN ('mercadolibre', 'bluexpress')),
    config_json  TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(config_json)),
    account_id   TEXT,
    account_name TEXT,
    connected_at TEXT,
    last_sync_at TEXT,
    updated_at   TEXT NOT NULL
) STRICT;

-- Pedidos de Mercado Libre ya vistos: cada uno queda enlazado a una sola venta (un carrito = una venta).
CREATE TABLE ml_orders (
    order_id           TEXT PRIMARY KEY,
    pack_id            TEXT,
    sale_id            INTEGER REFERENCES sales (id),
    date_created       TEXT NOT NULL,
    buyer              TEXT,
    ml_status          TEXT NOT NULL,
    -- importada (venta efectuada), por_revisar (venta en borrador), cancelada (cancelada en ML).
    status             TEXT NOT NULL CHECK (status IN ('importada', 'por_revisar', 'cancelada')),
    total_minor        INTEGER NOT NULL DEFAULT 0,
    sale_fee_minor     INTEGER NOT NULL DEFAULT 0,
    shipping_cost_minor INTEGER NOT NULL DEFAULT 0,
    needs_invoice      INTEGER NOT NULL DEFAULT 0 CHECK (needs_invoice IN (0, 1)),
    billing_json       TEXT CHECK (billing_json IS NULL OR json_valid(billing_json)),
    issue              TEXT,
    updated_at         TEXT NOT NULL
) STRICT;
CREATE INDEX idx_ml_orders_pack ON ml_orders (pack_id);
CREATE INDEX idx_ml_orders_sale ON ml_orders (sale_id);
CREATE INDEX idx_ml_orders_date ON ml_orders (date_created);

-- Publicación (y variación) de Mercado Libre enlazada a un producto de NÚCLEO.
CREATE TABLE ml_item_links (
    item_id      TEXT NOT NULL,
    variation_id TEXT NOT NULL DEFAULT '',
    product_id   INTEGER NOT NULL REFERENCES products (id),
    title        TEXT,
    created_at   TEXT NOT NULL,
    PRIMARY KEY (item_id, variation_id)
) STRICT;
