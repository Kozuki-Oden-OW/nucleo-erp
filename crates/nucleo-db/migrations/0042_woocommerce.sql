-- Pedidos de la tienda WooCommerce ya vistos: cada pedido queda enlazado a una sola venta de NÚCLEO y,
-- si lleva despacho, a un envío (para crear después la orden de transporte).
CREATE TABLE woo_orders (
    order_id       TEXT PRIMARY KEY,
    number         TEXT NOT NULL,
    sale_id        INTEGER REFERENCES sales (id),
    shipment_id    INTEGER REFERENCES shipments (id),
    date_created   TEXT NOT NULL,
    buyer          TEXT,
    email          TEXT,
    woo_status     TEXT NOT NULL,
    -- importada (venta efectuada), por_revisar (venta en borrador), cancelada (cancelada en la tienda).
    status         TEXT NOT NULL CHECK (status IN ('importada', 'por_revisar', 'cancelada')),
    total_minor    INTEGER NOT NULL DEFAULT 0,
    shipping_minor INTEGER NOT NULL DEFAULT 0,
    payment_method TEXT,
    shipping_method TEXT,
    needs_invoice  INTEGER NOT NULL DEFAULT 0 CHECK (needs_invoice IN (0, 1)),
    issue          TEXT,
    updated_at     TEXT NOT NULL
) STRICT;
CREATE INDEX idx_woo_orders_sale ON woo_orders (sale_id);
CREATE INDEX idx_woo_orders_date ON woo_orders (date_created);
