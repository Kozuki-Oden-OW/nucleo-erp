-- NÚCLEO ERP · Migración 0004 · Productos, precios, bodegas e inventario
-- El stock es un LIBRO DE MOVIMIENTOS (ADR-007): stock_movements es de solo inserción y
-- stock_balances se mantiene por trigger en la misma transacción.

CREATE TABLE units (
    code     TEXT PRIMARY KEY NOT NULL,   -- 'UN', 'KG', 'M', 'LT', 'CJ', 'HR'
    name     TEXT NOT NULL,
    decimals INTEGER NOT NULL DEFAULT 0 CHECK (decimals BETWEEN 0 AND 3)
) STRICT;
INSERT INTO units (code, name, decimals) VALUES
    ('UN', 'Unidad', 0), ('KG', 'Kilogramo', 3), ('GR', 'Gramo', 0), ('LT', 'Litro', 3),
    ('M', 'Metro', 3), ('M2', 'Metro cuadrado', 3), ('CJ', 'Caja', 0), ('HR', 'Hora', 2), ('SV', 'Servicio', 0);

CREATE TABLE categories (
    id         INTEGER PRIMARY KEY,
    parent_id  INTEGER REFERENCES categories (id) ON DELETE RESTRICT,
    name       TEXT NOT NULL CHECK (length(trim(name)) > 0),
    archived_at TEXT,
    UNIQUE (parent_id, name)
) STRICT;

CREATE TABLE brands (
    id   INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE
) STRICT;

CREATE TABLE products (
    id                 INTEGER PRIMARY KEY,
    uid                TEXT NOT NULL UNIQUE,
    kind               TEXT NOT NULL DEFAULT 'bien' CHECK (kind IN ('bien', 'servicio', 'kit')),
    sku                TEXT UNIQUE COLLATE NOCASE,
    barcode            TEXT,
    name               TEXT NOT NULL CHECK (length(trim(name)) > 0),
    description        TEXT,
    category_id        INTEGER REFERENCES categories (id),
    brand_id           INTEGER REFERENCES brands (id),
    unit_code          TEXT NOT NULL DEFAULT 'UN' REFERENCES units (code),
    taxable            INTEGER NOT NULL DEFAULT 1 CHECK (taxable IN (0, 1)),   -- 0 = exento
    track_stock        INTEGER NOT NULL DEFAULT 1 CHECK (track_stock IN (0, 1)),
    track_lots         INTEGER NOT NULL DEFAULT 0 CHECK (track_lots IN (0, 1)),
    track_serials      INTEGER NOT NULL DEFAULT 0 CHECK (track_serials IN (0, 1)),
    price_minor        INTEGER NOT NULL DEFAULT 0 CHECK (price_minor >= 0),    -- precio neto de lista (CLP)
    avg_cost_e4        INTEGER NOT NULL DEFAULT 0 CHECK (avg_cost_e4 >= 0),    -- costo promedio vigente
    last_cost_e4       INTEGER,
    min_stock_milli    INTEGER CHECK (min_stock_milli IS NULL OR min_stock_milli >= 0),
    max_stock_milli    INTEGER CHECK (max_stock_milli IS NULL OR max_stock_milli >= 0),
    weight_g           INTEGER CHECK (weight_g IS NULL OR weight_g >= 0),     -- prorrateo de importaciones
    volume_cm3         INTEGER CHECK (volume_cm3 IS NULL OR volume_cm3 >= 0),
    hs_code            TEXT,                                                   -- partida arancelaria (dato del usuario)
    created_at         TEXT NOT NULL,
    updated_at         TEXT,
    archived_at        TEXT,
    CHECK (kind <> 'servicio' OR track_stock = 0),
    CHECK (min_stock_milli IS NULL OR max_stock_milli IS NULL OR max_stock_milli >= min_stock_milli)
) STRICT;
CREATE INDEX idx_products_barcode ON products (barcode) WHERE barcode IS NOT NULL;
CREATE INDEX idx_products_category ON products (category_id);
CREATE INDEX idx_products_name ON products (name COLLATE NOCASE) WHERE archived_at IS NULL;

-- Componentes de un kit/combo fijo.
CREATE TABLE product_components (
    kit_id       INTEGER NOT NULL REFERENCES products (id) ON DELETE CASCADE,
    component_id INTEGER NOT NULL REFERENCES products (id),
    qty_milli    INTEGER NOT NULL CHECK (qty_milli > 0),
    PRIMARY KEY (kit_id, component_id),
    CHECK (kit_id <> component_id)
) STRICT, WITHOUT ROWID;

-- Código y precio del producto en cada proveedor (precio histórico vive en las compras).
CREATE TABLE product_suppliers (
    product_id      INTEGER NOT NULL REFERENCES products (id) ON DELETE CASCADE,
    supplier_id     INTEGER NOT NULL REFERENCES suppliers (id) ON DELETE CASCADE,
    supplier_sku    TEXT,
    currency_code   TEXT NOT NULL DEFAULT 'CLP' REFERENCES currencies (code),
    last_price_minor INTEGER CHECK (last_price_minor IS NULL OR last_price_minor >= 0),
    min_order_milli INTEGER CHECK (min_order_milli IS NULL OR min_order_milli > 0),
    order_multiple_milli INTEGER CHECK (order_multiple_milli IS NULL OR order_multiple_milli > 0),
    lead_time_days  INTEGER CHECK (lead_time_days IS NULL OR lead_time_days >= 0),
    is_preferred    INTEGER NOT NULL DEFAULT 0 CHECK (is_preferred IN (0, 1)),
    PRIMARY KEY (product_id, supplier_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX idx_product_suppliers_supplier ON product_suppliers (supplier_id);

CREATE TABLE price_lists (
    id            INTEGER PRIMARY KEY,
    name          TEXT NOT NULL UNIQUE,
    currency_code TEXT NOT NULL DEFAULT 'CLP' REFERENCES currencies (code),
    is_default    INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
    archived_at   TEXT
) STRICT;
CREATE UNIQUE INDEX ux_price_lists_default ON price_lists (is_default) WHERE is_default = 1;

CREATE TABLE price_list_items (
    price_list_id INTEGER NOT NULL REFERENCES price_lists (id) ON DELETE CASCADE,
    product_id    INTEGER NOT NULL REFERENCES products (id) ON DELETE CASCADE,
    price_minor   INTEGER NOT NULL CHECK (price_minor >= 0),
    PRIMARY KEY (price_list_id, product_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE warehouses (
    id          INTEGER PRIMARY KEY,
    uid         TEXT NOT NULL UNIQUE,
    branch_id   INTEGER REFERENCES branches (id),
    code        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    is_default  INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
    created_at  TEXT NOT NULL,
    archived_at TEXT
) STRICT;
CREATE UNIQUE INDEX ux_warehouses_default ON warehouses (is_default) WHERE is_default = 1;

CREATE TABLE lots (
    id          INTEGER PRIMARY KEY,
    product_id  INTEGER NOT NULL REFERENCES products (id),
    code        TEXT NOT NULL,
    expires_on  TEXT CHECK (expires_on IS NULL OR date(expires_on) IS expires_on),
    UNIQUE (product_id, code)
) STRICT;

CREATE TABLE serials (
    id          INTEGER PRIMARY KEY,
    product_id  INTEGER NOT NULL REFERENCES products (id),
    serial      TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'en_stock' CHECK (status IN ('en_stock', 'vendido', 'devuelto', 'baja')),
    warehouse_id INTEGER REFERENCES warehouses (id),
    UNIQUE (product_id, serial)
) STRICT;

-- Libro de movimientos (fuente de verdad del stock).
CREATE TABLE stock_movements (
    id                 INTEGER PRIMARY KEY,
    product_id         INTEGER NOT NULL REFERENCES products (id),
    warehouse_id       INTEGER NOT NULL REFERENCES warehouses (id),
    movement_date      TEXT NOT NULL CHECK (date(movement_date) IS movement_date),
    kind               TEXT NOT NULL CHECK (kind IN ('entrada', 'salida', 'ajuste', 'transferencia_entrada', 'transferencia_salida', 'inicial')),
    qty_milli          INTEGER NOT NULL CHECK (qty_milli <> 0),       -- positivo entra, negativo sale
    unit_cost_e4       INTEGER NOT NULL CHECK (unit_cost_e4 >= 0),    -- costo de la entrada o costo promedio aplicado a la salida
    avg_cost_after_e4  INTEGER NOT NULL CHECK (avg_cost_after_e4 >= 0),
    lot_id             INTEGER REFERENCES lots (id),
    serial_id          INTEGER REFERENCES serials (id),
    source_type        TEXT NOT NULL REFERENCES document_types (code),
    source_id          INTEGER NOT NULL,
    source_line_id     INTEGER,
    reason             TEXT,                                           -- obligatorio en ajustes (lo exige la app)
    created_by         INTEGER REFERENCES users (id),
    created_at         TEXT NOT NULL,
    CHECK ((kind IN ('entrada', 'transferencia_entrada', 'inicial') AND qty_milli > 0)
        OR (kind IN ('salida', 'transferencia_salida') AND qty_milli < 0)
        OR kind = 'ajuste')
) STRICT;
CREATE INDEX idx_stock_mov_product ON stock_movements (product_id, warehouse_id, movement_date, id);
CREATE INDEX idx_stock_mov_source ON stock_movements (source_type, source_id);
CREATE INDEX idx_stock_mov_date ON stock_movements (movement_date);

CREATE TRIGGER stock_movements_no_update BEFORE UPDATE ON stock_movements
BEGIN SELECT RAISE(ABORT, 'stock_movements es de solo inserción: corrige con un movimiento de ajuste'); END;
CREATE TRIGGER stock_movements_no_delete BEFORE DELETE ON stock_movements
BEGIN SELECT RAISE(ABORT, 'stock_movements es de solo inserción: corrige con un movimiento de ajuste'); END;

-- Saldo materializado por producto y bodega (lecturas rápidas).
CREATE TABLE stock_balances (
    product_id     INTEGER NOT NULL REFERENCES products (id),
    warehouse_id   INTEGER NOT NULL REFERENCES warehouses (id),
    on_hand_milli  INTEGER NOT NULL DEFAULT 0,
    avg_cost_e4    INTEGER NOT NULL DEFAULT 0,
    last_movement_id INTEGER,
    PRIMARY KEY (product_id, warehouse_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX idx_stock_balances_wh ON stock_balances (warehouse_id);

CREATE TRIGGER stock_movements_balance AFTER INSERT ON stock_movements BEGIN
    INSERT INTO stock_balances (product_id, warehouse_id, on_hand_milli, avg_cost_e4, last_movement_id)
    VALUES (new.product_id, new.warehouse_id, new.qty_milli, new.avg_cost_after_e4, new.id)
    ON CONFLICT (product_id, warehouse_id) DO UPDATE SET
        on_hand_milli = on_hand_milli + new.qty_milli,
        avg_cost_e4 = new.avg_cost_after_e4,
        last_movement_id = new.id;
    UPDATE products SET avg_cost_e4 = new.avg_cost_after_e4,
        last_cost_e4 = CASE WHEN new.qty_milli > 0 AND new.kind IN ('entrada', 'inicial') THEN new.unit_cost_e4 ELSE last_cost_e4 END
    WHERE id = new.product_id;
END;

-- Reservas: unidades comprometidas en notas de venta / pedidos no despachados (§19.4).
CREATE TABLE stock_reservations (
    id            INTEGER PRIMARY KEY,
    product_id    INTEGER NOT NULL REFERENCES products (id),
    warehouse_id  INTEGER NOT NULL REFERENCES warehouses (id),
    qty_milli     INTEGER NOT NULL CHECK (qty_milli > 0),
    source_type   TEXT NOT NULL REFERENCES document_types (code),
    source_id     INTEGER NOT NULL,
    source_line_id INTEGER,
    status        TEXT NOT NULL DEFAULT 'activa' CHECK (status IN ('activa', 'consumida', 'liberada')),
    created_at    TEXT NOT NULL,
    closed_at     TEXT
) STRICT;
CREATE INDEX idx_reservations_active ON stock_reservations (product_id, warehouse_id) WHERE status = 'activa';

-- Foto diaria del stock (velocidad excluyendo días sin stock, evolución 12 meses — §19.2).
CREATE TABLE stock_daily_snapshot (
    snapshot_date  TEXT NOT NULL CHECK (date(snapshot_date) IS snapshot_date),
    product_id     INTEGER NOT NULL REFERENCES products (id),
    warehouse_id   INTEGER NOT NULL REFERENCES warehouses (id),
    on_hand_milli  INTEGER NOT NULL,
    avg_cost_e4    INTEGER NOT NULL,
    PRIMARY KEY (product_id, warehouse_id, snapshot_date)
) STRICT, WITHOUT ROWID;
CREATE INDEX idx_snapshot_date ON stock_daily_snapshot (snapshot_date);

-- Parámetros de reorden por producto (V1.1 usa estos datos; se capturan desde el MVP).
CREATE TABLE reorder_settings (
    product_id           INTEGER PRIMARY KEY REFERENCES products (id) ON DELETE CASCADE,
    safety_days          INTEGER NOT NULL DEFAULT 7 CHECK (safety_days >= 0),
    target_coverage_days INTEGER NOT NULL DEFAULT 30 CHECK (target_coverage_days >= 0),
    excess_coverage_days INTEGER NOT NULL DEFAULT 180 CHECK (excess_coverage_days > 0),
    lead_time_days       INTEGER CHECK (lead_time_days IS NULL OR lead_time_days >= 0)
) STRICT;

CREATE VIRTUAL TABLE products_fts USING fts5(
    name, sku, barcode, description,
    content = 'products', content_rowid = 'id',
    tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TRIGGER products_ai AFTER INSERT ON products BEGIN
    INSERT INTO products_fts (rowid, name, sku, barcode, description) VALUES (new.id, new.name, new.sku, new.barcode, new.description);
END;
CREATE TRIGGER products_ad AFTER DELETE ON products BEGIN
    INSERT INTO products_fts (products_fts, rowid, name, sku, barcode, description) VALUES ('delete', old.id, old.name, old.sku, old.barcode, old.description);
END;
CREATE TRIGGER products_au AFTER UPDATE OF name, sku, barcode, description ON products BEGIN
    INSERT INTO products_fts (products_fts, rowid, name, sku, barcode, description) VALUES ('delete', old.id, old.name, old.sku, old.barcode, old.description);
    INSERT INTO products_fts (rowid, name, sku, barcode, description) VALUES (new.id, new.name, new.sku, new.barcode, new.description);
END;
