-- NÚCLEO ERP · Migración 0005 · Ventas
-- Documentos internos NÚCLEO (ADR-003). Tablas separadas por etapa (D-05) + document_links.
-- Estados de venta en tres ejes independientes (ADR-015).

-- Cotizaciones, presupuestos y proformas (COT / PRE / PRO). No afectan stock ni cuentas.
CREATE TABLE quotes (
    id              INTEGER PRIMARY KEY,
    uid             TEXT NOT NULL UNIQUE,
    doc_type        TEXT NOT NULL DEFAULT 'COT' REFERENCES document_types (code) CHECK (doc_type IN ('COT', 'PRE', 'PRO')),
    number          TEXT NOT NULL,                       -- COT-000147
    branch_id       INTEGER REFERENCES branches (id),
    customer_id     INTEGER REFERENCES customers (id),   -- puede cotizarse a un prospecto sin ficha
    prospect_name   TEXT,
    issue_date      TEXT NOT NULL CHECK (date(issue_date) IS issue_date),
    valid_until     TEXT CHECK (valid_until IS NULL OR date(valid_until) IS valid_until),
    status          TEXT NOT NULL DEFAULT 'borrador' CHECK (status IN ('borrador', 'enviada', 'aceptada', 'rechazada', 'vencida', 'convertida', 'anulada')),
    currency_code   TEXT NOT NULL DEFAULT 'CLP' REFERENCES currencies (code),
    rate_e6         INTEGER CHECK (rate_e6 IS NULL OR rate_e6 > 0),
    net_minor       INTEGER NOT NULL DEFAULT 0,
    exempt_minor    INTEGER NOT NULL DEFAULT 0,
    discount_minor  INTEGER NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
    tax_minor       INTEGER NOT NULL DEFAULT 0,
    total_minor     INTEGER NOT NULL DEFAULT 0,
    rule_set_code   TEXT,                                -- normativa usada en el cálculo
    salesperson_id  INTEGER REFERENCES users (id),
    notes           TEXT,
    created_by      INTEGER REFERENCES users (id),
    created_at      TEXT NOT NULL,
    updated_at      TEXT,
    UNIQUE (doc_type, number),
    CHECK (customer_id IS NOT NULL OR prospect_name IS NOT NULL)
) STRICT;
CREATE INDEX idx_quotes_customer ON quotes (customer_id, issue_date);
CREATE INDEX idx_quotes_status ON quotes (status, issue_date);

CREATE TABLE quote_items (
    id               INTEGER PRIMARY KEY,
    quote_id         INTEGER NOT NULL REFERENCES quotes (id) ON DELETE CASCADE,
    line_no          INTEGER NOT NULL CHECK (line_no > 0),
    product_id       INTEGER REFERENCES products (id),
    description      TEXT NOT NULL,
    qty_milli        INTEGER NOT NULL CHECK (qty_milli > 0),
    unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),
    discount_ppm     INTEGER NOT NULL DEFAULT 0 CHECK (discount_ppm BETWEEN 0 AND 1000000),
    discount_minor   INTEGER NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
    taxable          INTEGER NOT NULL DEFAULT 1 CHECK (taxable IN (0, 1)),
    net_minor        INTEGER NOT NULL,
    UNIQUE (quote_id, line_no)
) STRICT;
CREATE INDEX idx_quote_items_product ON quote_items (product_id);

-- Notas de venta y órdenes de pedido (NV / PED). Reservan stock.
CREATE TABLE sales_orders (
    id              INTEGER PRIMARY KEY,
    uid             TEXT NOT NULL UNIQUE,
    doc_type        TEXT NOT NULL DEFAULT 'NV' REFERENCES document_types (code) CHECK (doc_type IN ('NV', 'PED')),
    number          TEXT NOT NULL,
    branch_id       INTEGER REFERENCES branches (id),
    customer_id     INTEGER NOT NULL REFERENCES customers (id),
    issue_date      TEXT NOT NULL CHECK (date(issue_date) IS issue_date),
    promised_date   TEXT CHECK (promised_date IS NULL OR date(promised_date) IS promised_date),
    status          TEXT NOT NULL DEFAULT 'abierta' CHECK (status IN ('borrador', 'abierta', 'parcial', 'despachada', 'facturada', 'anulada')),
    warehouse_id    INTEGER REFERENCES warehouses (id),
    currency_code   TEXT NOT NULL DEFAULT 'CLP' REFERENCES currencies (code),
    total_minor     INTEGER NOT NULL DEFAULT 0,
    salesperson_id  INTEGER REFERENCES users (id),
    notes           TEXT,
    created_by      INTEGER REFERENCES users (id),
    created_at      TEXT NOT NULL,
    UNIQUE (doc_type, number)
) STRICT;
CREATE INDEX idx_sales_orders_customer ON sales_orders (customer_id, issue_date);

CREATE TABLE sales_order_items (
    id                 INTEGER PRIMARY KEY,
    sales_order_id     INTEGER NOT NULL REFERENCES sales_orders (id) ON DELETE CASCADE,
    line_no            INTEGER NOT NULL CHECK (line_no > 0),
    product_id         INTEGER REFERENCES products (id),
    description        TEXT NOT NULL,
    qty_milli          INTEGER NOT NULL CHECK (qty_milli > 0),
    delivered_milli    INTEGER NOT NULL DEFAULT 0 CHECK (delivered_milli >= 0),
    unit_price_minor   INTEGER NOT NULL CHECK (unit_price_minor >= 0),
    discount_ppm       INTEGER NOT NULL DEFAULT 0 CHECK (discount_ppm BETWEEN 0 AND 1000000),
    taxable            INTEGER NOT NULL DEFAULT 1 CHECK (taxable IN (0, 1)),
    net_minor          INTEGER NOT NULL,
    UNIQUE (sales_order_id, line_no),
    CHECK (delivered_milli <= qty_milli)
) STRICT;

-- Despachos (DES): generan la salida de stock.
CREATE TABLE deliveries (
    id              INTEGER PRIMARY KEY,
    uid             TEXT NOT NULL UNIQUE,
    number          TEXT NOT NULL UNIQUE,
    customer_id     INTEGER NOT NULL REFERENCES customers (id),
    warehouse_id    INTEGER NOT NULL REFERENCES warehouses (id),
    delivery_date   TEXT NOT NULL CHECK (date(delivery_date) IS delivery_date),
    address         TEXT,
    status          TEXT NOT NULL DEFAULT 'borrador' CHECK (status IN ('borrador', 'despachado', 'entregado', 'anulado')),
    notes           TEXT,
    created_by      INTEGER REFERENCES users (id),
    created_at      TEXT NOT NULL
) STRICT;

CREATE TABLE delivery_items (
    id                   INTEGER PRIMARY KEY,
    delivery_id          INTEGER NOT NULL REFERENCES deliveries (id) ON DELETE CASCADE,
    sales_order_item_id  INTEGER REFERENCES sales_order_items (id),
    product_id           INTEGER NOT NULL REFERENCES products (id),
    qty_milli            INTEGER NOT NULL CHECK (qty_milli > 0),
    lot_id               INTEGER REFERENCES lots (id),
    serial_id            INTEGER REFERENCES serials (id)
) STRICT;
CREATE INDEX idx_delivery_items_delivery ON delivery_items (delivery_id);

-- Ventas (VEN), facturas internas (FV), registros de servicio (SRV) y devoluciones (DEV).
CREATE TABLE sales (
    id                    INTEGER PRIMARY KEY,
    uid                   TEXT NOT NULL UNIQUE,
    doc_type              TEXT NOT NULL DEFAULT 'VEN' REFERENCES document_types (code) CHECK (doc_type IN ('VEN', 'FV', 'SRV', 'DEV')),
    number                TEXT NOT NULL,
    branch_id             INTEGER REFERENCES branches (id),
    customer_id           INTEGER REFERENCES customers (id),   -- NULL = cliente ocasional
    warehouse_id          INTEGER REFERENCES warehouses (id),
    issue_date            TEXT NOT NULL CHECK (date(issue_date) IS issue_date),
    issued_at             TEXT,                                 -- fecha-hora al efectuar (promociones por horario)
    due_date              TEXT CHECK (due_date IS NULL OR date(due_date) IS due_date),
    -- Eje comercial
    commercial_state      TEXT NOT NULL DEFAULT 'borrador'
                          CHECK (commercial_state IN ('borrador', 'cotizada', 'aceptada', 'efectuada', 'cerrada', 'anulada')),
    -- Eje pago (derivado de payment_allocations; se guarda para filtrar rápido)
    payment_state         TEXT NOT NULL DEFAULT 'sin_pago' CHECK (payment_state IN ('sin_pago', 'abonada', 'pagada')),
    paid_minor            INTEGER NOT NULL DEFAULT 0 CHECK (paid_minor >= 0),
    -- Eje documentación externa (NÚCLEO no emite: solo recuerda y guarda la referencia)
    documentation_state   TEXT NOT NULL DEFAULT 'no_aplica' CHECK (documentation_state IN ('no_aplica', 'pendiente', 'documentada')),
    currency_code         TEXT NOT NULL DEFAULT 'CLP' REFERENCES currencies (code),
    rate_e6               INTEGER CHECK (rate_e6 IS NULL OR rate_e6 > 0),
    net_minor             INTEGER NOT NULL DEFAULT 0,
    exempt_minor          INTEGER NOT NULL DEFAULT 0,
    discount_minor        INTEGER NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
    tax_minor             INTEGER NOT NULL DEFAULT 0,
    total_minor           INTEGER NOT NULL DEFAULT 0,
    cost_minor            INTEGER NOT NULL DEFAULT 0,          -- costo de lo vendido al efectuar
    rule_set_code         TEXT,
    payment_method        TEXT,
    salesperson_id        INTEGER REFERENCES users (id),
    related_sale_id       INTEGER REFERENCES sales (id),       -- DEV → venta original
    void_reason           TEXT,
    notes                 TEXT,
    created_by            INTEGER REFERENCES users (id),
    created_at            TEXT NOT NULL,
    updated_at            TEXT,
    UNIQUE (doc_type, number),
    CHECK (commercial_state <> 'anulada' OR void_reason IS NOT NULL),
    CHECK (doc_type <> 'DEV' OR related_sale_id IS NOT NULL)
) STRICT;
CREATE INDEX idx_sales_date ON sales (issue_date) WHERE commercial_state IN ('efectuada', 'cerrada');
CREATE INDEX idx_sales_customer ON sales (customer_id, issue_date);
CREATE INDEX idx_sales_pending_doc ON sales (issue_date) WHERE documentation_state = 'pendiente';
CREATE INDEX idx_sales_unpaid ON sales (due_date) WHERE payment_state <> 'pagada' AND commercial_state IN ('efectuada', 'cerrada');

CREATE TABLE sale_items (
    id                 INTEGER PRIMARY KEY,
    sale_id            INTEGER NOT NULL REFERENCES sales (id) ON DELETE CASCADE,
    line_no            INTEGER NOT NULL CHECK (line_no > 0),
    product_id         INTEGER REFERENCES products (id),
    description        TEXT NOT NULL,
    qty_milli          INTEGER NOT NULL CHECK (qty_milli > 0),
    list_price_minor   INTEGER NOT NULL CHECK (list_price_minor >= 0),  -- precio de lista al momento (§19.2)
    unit_price_minor   INTEGER NOT NULL CHECK (unit_price_minor >= 0),  -- precio aplicado antes de descuentos de línea
    discount_minor     INTEGER NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
    taxable            INTEGER NOT NULL DEFAULT 1 CHECK (taxable IN (0, 1)),
    net_minor          INTEGER NOT NULL,
    unit_cost_e4       INTEGER,                                          -- costo promedio congelado al efectuar
    cost_minor         INTEGER,
    lot_id             INTEGER REFERENCES lots (id),
    serial_id          INTEGER REFERENCES serials (id),
    UNIQUE (sale_id, line_no)
) STRICT;
CREATE INDEX idx_sale_items_product ON sale_items (product_id, sale_id);

-- Descuentos de cada línea desglosados por origen (analítica de promociones, §19.2).
CREATE TABLE sale_item_adjustments (
    id            INTEGER PRIMARY KEY,
    sale_item_id  INTEGER NOT NULL REFERENCES sale_items (id) ON DELETE CASCADE,
    origin        TEXT NOT NULL CHECK (origin IN ('manual', 'promocion', 'cupon', 'nivel_cliente', 'lista_precios', 'redondeo')),
    origin_ref    TEXT,               -- id de promoción, código de cupón, nivel…
    amount_minor  INTEGER NOT NULL CHECK (amount_minor >= 0),
    description   TEXT
) STRICT;
CREATE INDEX idx_adjustments_origin ON sale_item_adjustments (origin, origin_ref);

-- Referencia tributaria externa anotada a mano por el usuario (ADR-003). Todo opcional.
CREATE TABLE external_doc_refs (
    id             INTEGER PRIMARY KEY,
    sale_id        INTEGER NOT NULL UNIQUE REFERENCES sales (id) ON DELETE CASCADE,
    doc_kind       TEXT,              -- ej. 'Factura', 'Boleta'
    external_number TEXT,             -- ej. '563'
    issue_date     TEXT CHECK (issue_date IS NULL OR date(issue_date) IS issue_date),
    observation    TEXT,
    marked_by      INTEGER REFERENCES users (id),
    marked_at      TEXT NOT NULL
) STRICT;

-- Inmutabilidad (ADR-008): una venta efectuada, cerrada o anulada no cambia sus montos ni líneas.
CREATE TRIGGER sales_lock_amounts BEFORE UPDATE OF customer_id, issue_date, currency_code, net_minor, exempt_minor,
    discount_minor, tax_minor, total_minor, cost_minor, doc_type, number ON sales
WHEN old.commercial_state IN ('efectuada', 'cerrada', 'anulada')
BEGIN SELECT RAISE(ABORT, 'venta efectuada: los montos no se modifican; usa una devolución o anula'); END;

CREATE TRIGGER sales_state_flow BEFORE UPDATE OF commercial_state ON sales
WHEN NOT (
    (old.commercial_state = new.commercial_state)
    OR (old.commercial_state = 'borrador'  AND new.commercial_state IN ('cotizada', 'aceptada', 'efectuada', 'anulada'))
    OR (old.commercial_state = 'cotizada'  AND new.commercial_state IN ('aceptada', 'anulada'))
    OR (old.commercial_state = 'aceptada'  AND new.commercial_state IN ('efectuada', 'anulada'))
    OR (old.commercial_state = 'efectuada' AND new.commercial_state IN ('cerrada', 'anulada'))
)
BEGIN SELECT RAISE(ABORT, 'transición de estado comercial no permitida'); END;

CREATE TRIGGER sale_items_lock_insert BEFORE INSERT ON sale_items
WHEN (SELECT commercial_state FROM sales WHERE id = new.sale_id) NOT IN ('borrador', 'cotizada', 'aceptada')
BEGIN SELECT RAISE(ABORT, 'no se agregan líneas a una venta efectuada'); END;
CREATE TRIGGER sale_items_lock_update BEFORE UPDATE ON sale_items
WHEN (SELECT commercial_state FROM sales WHERE id = old.sale_id) NOT IN ('borrador', 'cotizada', 'aceptada')
     AND NOT (old.unit_cost_e4 IS NULL AND new.unit_cost_e4 IS NOT NULL
              AND old.qty_milli = new.qty_milli AND old.net_minor = new.net_minor AND old.unit_price_minor = new.unit_price_minor)
BEGIN SELECT RAISE(ABORT, 'las líneas de una venta efectuada no se modifican'); END;
CREATE TRIGGER sale_items_lock_delete BEFORE DELETE ON sale_items
WHEN (SELECT commercial_state FROM sales WHERE id = old.sale_id) NOT IN ('borrador', 'cotizada', 'aceptada')
BEGIN SELECT RAISE(ABORT, 'las líneas de una venta efectuada no se eliminan'); END;
