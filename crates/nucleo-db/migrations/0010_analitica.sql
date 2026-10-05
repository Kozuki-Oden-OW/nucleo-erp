-- NÚCLEO ERP · Migración 0010 · Capa analítica (ADR-018, Blueprint §19.3)
-- Tablas resumen para que el dashboard y los análisis no recorran el millón de movimientos.
-- Se actualizan en la misma transacción de cada venta y se pueden reconstruir desde cero.

CREATE TABLE fact_sales_daily (
    sale_date        TEXT NOT NULL CHECK (date(sale_date) IS sale_date),
    product_id       INTEGER NOT NULL REFERENCES products (id),
    branch_id        INTEGER NOT NULL DEFAULT 0,                -- 0 = sin sucursal
    units_milli      INTEGER NOT NULL DEFAULT 0,
    revenue_minor    INTEGER NOT NULL DEFAULT 0,                -- neto
    discount_minor   INTEGER NOT NULL DEFAULT 0,
    cost_minor       INTEGER NOT NULL DEFAULT 0,
    sales_count      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (product_id, branch_id, sale_date)
) STRICT, WITHOUT ROWID;
-- Índice "cubriente": los rangos de fechas (top productos del mes) se resuelven sin leer la tabla.
CREATE INDEX idx_fact_sales_date ON fact_sales_daily (sale_date, product_id, units_milli, revenue_minor, cost_minor);

-- Totales por día (unas 365 filas por año): ventas de hoy, del mes y serie de 12 meses del dashboard.
-- Medición Fase 2: sin esta tabla, la serie de 12 meses tardaba ~14 s con 1M de movimientos.
CREATE TABLE fact_sales_day (
    sale_date        TEXT NOT NULL CHECK (date(sale_date) IS sale_date),
    branch_id        INTEGER NOT NULL DEFAULT 0,
    sales_count      INTEGER NOT NULL DEFAULT 0,
    units_milli      INTEGER NOT NULL DEFAULT 0,
    revenue_minor    INTEGER NOT NULL DEFAULT 0,
    discount_minor   INTEGER NOT NULL DEFAULT 0,
    cost_minor       INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (sale_date, branch_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE fact_customer_monthly (
    customer_id     INTEGER NOT NULL REFERENCES customers (id),
    month           TEXT NOT NULL CHECK (length(month) = 7),   -- 'AAAA-MM'
    sales_count     INTEGER NOT NULL DEFAULT 0,
    revenue_minor   INTEGER NOT NULL DEFAULT 0,
    discount_minor  INTEGER NOT NULL DEFAULT 0,
    cost_minor      INTEGER NOT NULL DEFAULT 0,
    first_sale_date TEXT,
    last_sale_date  TEXT,
    PRIMARY KEY (customer_id, month)
) STRICT, WITHOUT ROWID;
CREATE INDEX idx_fact_customer_month ON fact_customer_monthly (month);

-- Vista de stock real por producto (§19.4): disponible, reservado, en compra, en importación
-- (con su subconjunto en tránsito) y en recepción. Regla para no contar dos veces: al registrar una
-- recepción PENDIENTE se actualiza received_milli de la OC/importación; el movimiento de stock se
-- crea recién al CONFIRMAR la recepción.
CREATE VIEW v_stock_position AS
SELECT
    p.id AS product_id,
    ifnull((SELECT sum(on_hand_milli) FROM stock_balances b WHERE b.product_id = p.id), 0) AS on_hand_milli,
    ifnull((SELECT sum(qty_milli) FROM stock_reservations r WHERE r.product_id = p.id AND r.status = 'activa'), 0) AS reserved_milli,
    ifnull((SELECT sum(i.qty_milli - i.received_milli) FROM purchase_order_items i
            JOIN purchase_orders o ON o.id = i.purchase_order_id
            WHERE i.product_id = p.id AND i.received_milli < i.qty_milli
              AND o.import_id IS NULL AND o.status IN ('emitida', 'despachada_proveedor', 'parcial')), 0) AS in_purchase_milli,
    ifnull((SELECT sum(ii.qty_milli - ii.received_milli) FROM import_items ii
            JOIN imports im ON im.id = ii.import_id
            WHERE ii.product_id = p.id AND ii.received_milli < ii.qty_milli AND im.is_scenario = 0
              AND im.stage IN ('ordenada', 'pagada', 'produccion', 'lista_despacho', 'embarcada', 'en_transito',
                               'arribada', 'internacion', 'transporte_local')), 0) AS in_import_milli,
    ifnull((SELECT sum(ii.qty_milli - ii.received_milli) FROM import_items ii
            JOIN imports im ON im.id = ii.import_id
            WHERE ii.product_id = p.id AND ii.received_milli < ii.qty_milli AND im.is_scenario = 0
              AND im.stage IN ('embarcada', 'en_transito')), 0) AS in_transit_milli,
    ifnull((SELECT sum(ri.qty_milli - ri.rejected_milli) FROM receipt_items ri
            JOIN receipts rc ON rc.id = ri.receipt_id
            WHERE ri.product_id = p.id AND rc.status = 'pendiente'), 0) AS in_receiving_milli
FROM products p
WHERE p.track_stock = 1;
