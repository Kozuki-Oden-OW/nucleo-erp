-- NÚCLEO ERP · Migración 0014 · Inventario (Fase 7)
-- Documentos de ajuste (AJU) y de transferencia entre bodegas (TRA). Los movimientos siguen en el
-- libro `stock_movements` (solo inserción); estas tablas guardan el encabezado y el motivo.

CREATE TABLE stock_adjustments (
    id            INTEGER PRIMARY KEY,
    uid           TEXT NOT NULL UNIQUE,
    number        TEXT NOT NULL UNIQUE,
    warehouse_id  INTEGER NOT NULL REFERENCES warehouses (id),
    adjust_date   TEXT NOT NULL CHECK (date(adjust_date) IS adjust_date),
    kind          TEXT NOT NULL DEFAULT 'ajuste' CHECK (kind IN ('ajuste', 'conteo')),
    reason        TEXT NOT NULL CHECK (length(trim(reason)) > 0),
    created_by    INTEGER REFERENCES users (id),
    created_at    TEXT NOT NULL
) STRICT;

CREATE TABLE stock_transfers (
    id                 INTEGER PRIMARY KEY,
    uid                TEXT NOT NULL UNIQUE,
    number             TEXT NOT NULL UNIQUE,
    from_warehouse_id  INTEGER NOT NULL REFERENCES warehouses (id),
    to_warehouse_id    INTEGER NOT NULL REFERENCES warehouses (id),
    transfer_date      TEXT NOT NULL CHECK (date(transfer_date) IS transfer_date),
    notes              TEXT,
    created_by         INTEGER REFERENCES users (id),
    created_at         TEXT NOT NULL,
    CHECK (from_warehouse_id <> to_warehouse_id)
) STRICT;

-- Kárdex por producto ordenado por fecha (consulta de la ficha de inventario).
CREATE INDEX idx_stock_mov_kardex ON stock_movements (product_id, movement_date, id);
