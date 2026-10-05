-- NÚCLEO ERP · Migración 0006 · Compras
-- SOLICITUD → COTIZACIÓN DE PROVEEDOR → ORDEN DE COMPRA → RECEPCIÓN → COMPRA → PAGO

CREATE TABLE purchase_requests (
    id           INTEGER PRIMARY KEY,
    uid          TEXT NOT NULL UNIQUE,
    number       TEXT NOT NULL UNIQUE,
    branch_id    INTEGER REFERENCES branches (id),
    request_date TEXT NOT NULL CHECK (date(request_date) IS request_date),
    needed_by    TEXT CHECK (needed_by IS NULL OR date(needed_by) IS needed_by),
    status       TEXT NOT NULL DEFAULT 'abierta' CHECK (status IN ('borrador', 'abierta', 'cotizando', 'ordenada', 'cerrada', 'anulada')),
    requested_by INTEGER REFERENCES users (id),
    notes        TEXT,
    created_at   TEXT NOT NULL
) STRICT;

CREATE TABLE purchase_request_items (
    id                  INTEGER PRIMARY KEY,
    purchase_request_id INTEGER NOT NULL REFERENCES purchase_requests (id) ON DELETE CASCADE,
    product_id          INTEGER REFERENCES products (id),
    description         TEXT NOT NULL,
    qty_milli           INTEGER NOT NULL CHECK (qty_milli > 0)
) STRICT;

-- Cotizaciones recibidas de proveedores: alimentan el comparador (mejor precio / plazo / histórico).
CREATE TABLE supplier_quotes (
    id            INTEGER PRIMARY KEY,
    uid           TEXT NOT NULL UNIQUE,
    number        TEXT NOT NULL UNIQUE,
    supplier_id   INTEGER NOT NULL REFERENCES suppliers (id),
    purchase_request_id INTEGER REFERENCES purchase_requests (id),
    quote_date    TEXT NOT NULL CHECK (date(quote_date) IS quote_date),
    valid_until   TEXT CHECK (valid_until IS NULL OR date(valid_until) IS valid_until),
    currency_code TEXT NOT NULL DEFAULT 'CLP' REFERENCES currencies (code),
    lead_time_days INTEGER CHECK (lead_time_days IS NULL OR lead_time_days >= 0),
    supplier_reference TEXT,
    status        TEXT NOT NULL DEFAULT 'recibida' CHECK (status IN ('recibida', 'elegida', 'descartada', 'vencida')),
    notes         TEXT,
    created_at    TEXT NOT NULL
) STRICT;

CREATE TABLE supplier_quote_items (
    id                INTEGER PRIMARY KEY,
    supplier_quote_id INTEGER NOT NULL REFERENCES supplier_quotes (id) ON DELETE CASCADE,
    product_id        INTEGER REFERENCES products (id),
    description       TEXT NOT NULL,
    qty_milli         INTEGER NOT NULL CHECK (qty_milli > 0),
    unit_price_minor  INTEGER NOT NULL CHECK (unit_price_minor >= 0)
) STRICT;
CREATE INDEX idx_supplier_quote_items_product ON supplier_quote_items (product_id);

CREATE TABLE purchase_orders (
    id             INTEGER PRIMARY KEY,
    uid            TEXT NOT NULL UNIQUE,
    number         TEXT NOT NULL UNIQUE,
    supplier_id    INTEGER NOT NULL REFERENCES suppliers (id),
    branch_id      INTEGER REFERENCES branches (id),
    warehouse_id   INTEGER REFERENCES warehouses (id),
    order_date     TEXT NOT NULL CHECK (date(order_date) IS order_date),
    expected_date  TEXT CHECK (expected_date IS NULL OR date(expected_date) IS expected_date),  -- ETA nacional
    status         TEXT NOT NULL DEFAULT 'borrador'
                   CHECK (status IN ('borrador', 'emitida', 'despachada_proveedor', 'parcial', 'recibida', 'cerrada', 'anulada')),
    currency_code  TEXT NOT NULL DEFAULT 'CLP' REFERENCES currencies (code),
    rate_e6        INTEGER CHECK (rate_e6 IS NULL OR rate_e6 > 0),
    net_minor      INTEGER NOT NULL DEFAULT 0,
    tax_minor      INTEGER NOT NULL DEFAULT 0,
    total_minor    INTEGER NOT NULL DEFAULT 0,
    import_id      INTEGER,                    -- si es una orden internacional (FK lógica a imports)
    notes          TEXT,
    created_by     INTEGER REFERENCES users (id),
    created_at     TEXT NOT NULL
) STRICT;
CREATE INDEX idx_po_supplier ON purchase_orders (supplier_id, order_date);
CREATE INDEX idx_po_open ON purchase_orders (expected_date) WHERE status IN ('emitida', 'despachada_proveedor', 'parcial');

CREATE TABLE purchase_order_items (
    id                INTEGER PRIMARY KEY,
    purchase_order_id INTEGER NOT NULL REFERENCES purchase_orders (id) ON DELETE CASCADE,
    line_no           INTEGER NOT NULL CHECK (line_no > 0),
    product_id        INTEGER REFERENCES products (id),
    description       TEXT NOT NULL,
    qty_milli         INTEGER NOT NULL CHECK (qty_milli > 0),
    received_milli    INTEGER NOT NULL DEFAULT 0 CHECK (received_milli >= 0),
    rejected_milli    INTEGER NOT NULL DEFAULT 0 CHECK (rejected_milli >= 0),   -- calidad del proveedor
    unit_price_minor  INTEGER NOT NULL CHECK (unit_price_minor >= 0),
    taxable           INTEGER NOT NULL DEFAULT 1 CHECK (taxable IN (0, 1)),
    net_minor         INTEGER NOT NULL,
    UNIQUE (purchase_order_id, line_no)
) STRICT;
-- Pendiente por recibir (stock "en compra") — consulta frecuente.
CREATE INDEX idx_po_items_product ON purchase_order_items (product_id) WHERE received_milli < qty_milli;

-- Recepciones (REC): entrada física. 'pendiente' = en recepción (no disponible aún).
CREATE TABLE receipts (
    id                INTEGER PRIMARY KEY,
    uid               TEXT NOT NULL UNIQUE,
    number            TEXT NOT NULL UNIQUE,
    supplier_id       INTEGER NOT NULL REFERENCES suppliers (id),
    purchase_order_id INTEGER REFERENCES purchase_orders (id),
    import_id         INTEGER,
    warehouse_id      INTEGER NOT NULL REFERENCES warehouses (id),
    receipt_date      TEXT NOT NULL CHECK (date(receipt_date) IS receipt_date),
    status            TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'confirmada', 'anulada')),
    notes             TEXT,
    created_by        INTEGER REFERENCES users (id),
    created_at        TEXT NOT NULL,
    confirmed_at      TEXT
) STRICT;

CREATE TABLE receipt_items (
    id                     INTEGER PRIMARY KEY,
    receipt_id             INTEGER NOT NULL REFERENCES receipts (id) ON DELETE CASCADE,
    purchase_order_item_id INTEGER REFERENCES purchase_order_items (id),
    product_id             INTEGER NOT NULL REFERENCES products (id),
    qty_milli              INTEGER NOT NULL CHECK (qty_milli > 0),
    rejected_milli         INTEGER NOT NULL DEFAULT 0 CHECK (rejected_milli >= 0),
    unit_cost_e4           INTEGER NOT NULL CHECK (unit_cost_e4 >= 0),    -- costo (landed en importaciones)
    lot_id                 INTEGER REFERENCES lots (id)
) STRICT;
CREATE INDEX idx_receipt_items_receipt ON receipt_items (receipt_id);

-- Documentos de compra (COM): el documento del proveedor digitado por el usuario.
CREATE TABLE purchases (
    id                INTEGER PRIMARY KEY,
    uid               TEXT NOT NULL UNIQUE,
    number            TEXT NOT NULL UNIQUE,              -- correlativo NÚCLEO COM-000001
    supplier_id       INTEGER NOT NULL REFERENCES suppliers (id),
    supplier_doc_kind TEXT,                              -- ej. 'Factura'
    supplier_doc_number TEXT,                            -- número del documento del proveedor
    purchase_order_id INTEGER REFERENCES purchase_orders (id),
    issue_date        TEXT NOT NULL CHECK (date(issue_date) IS issue_date),
    due_date          TEXT CHECK (due_date IS NULL OR date(due_date) IS due_date),
    status            TEXT NOT NULL DEFAULT 'borrador' CHECK (status IN ('borrador', 'registrada', 'anulada')),
    payment_state     TEXT NOT NULL DEFAULT 'sin_pago' CHECK (payment_state IN ('sin_pago', 'abonada', 'pagada')),
    paid_minor        INTEGER NOT NULL DEFAULT 0 CHECK (paid_minor >= 0),
    currency_code     TEXT NOT NULL DEFAULT 'CLP' REFERENCES currencies (code),
    rate_e6           INTEGER CHECK (rate_e6 IS NULL OR rate_e6 > 0),
    net_minor         INTEGER NOT NULL DEFAULT 0,
    exempt_minor      INTEGER NOT NULL DEFAULT 0,
    tax_minor         INTEGER NOT NULL DEFAULT 0,
    total_minor       INTEGER NOT NULL DEFAULT 0,
    rule_set_code     TEXT,
    void_reason       TEXT,
    notes             TEXT,
    created_by        INTEGER REFERENCES users (id),
    created_at        TEXT NOT NULL,
    UNIQUE (supplier_id, supplier_doc_kind, supplier_doc_number),
    CHECK (status <> 'anulada' OR void_reason IS NOT NULL)
) STRICT;
CREATE INDEX idx_purchases_date ON purchases (issue_date) WHERE status = 'registrada';
CREATE INDEX idx_purchases_unpaid ON purchases (due_date) WHERE payment_state <> 'pagada' AND status = 'registrada';

CREATE TABLE purchase_items (
    id                INTEGER PRIMARY KEY,
    purchase_id       INTEGER NOT NULL REFERENCES purchases (id) ON DELETE CASCADE,
    line_no           INTEGER NOT NULL CHECK (line_no > 0),
    product_id        INTEGER REFERENCES products (id),
    description       TEXT NOT NULL,
    qty_milli         INTEGER NOT NULL CHECK (qty_milli > 0),
    unit_price_minor  INTEGER NOT NULL CHECK (unit_price_minor >= 0),
    discount_minor    INTEGER NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
    taxable           INTEGER NOT NULL DEFAULT 1 CHECK (taxable IN (0, 1)),
    net_minor         INTEGER NOT NULL,
    expense_category_id INTEGER,                          -- si la línea es un gasto y no mercadería
    UNIQUE (purchase_id, line_no)
) STRICT;
-- Precio histórico por producto y proveedor (§19.12).
CREATE INDEX idx_purchase_items_product ON purchase_items (product_id, purchase_id);

CREATE TRIGGER purchases_lock_amounts BEFORE UPDATE OF supplier_id, issue_date, net_minor, exempt_minor, tax_minor, total_minor ON purchases
WHEN old.status IN ('registrada', 'anulada')
BEGIN SELECT RAISE(ABORT, 'compra registrada: los montos no se modifican; anula y vuelve a registrar'); END;
