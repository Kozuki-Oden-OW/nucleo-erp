-- NÚCLEO ERP · Migración 0030 · Ingresos de stock (ING)
-- «Agregar stock»: mercadería que llega y se ingresa directo al inventario, con su cantidad, costo,
-- fecha, bodega y (opcional) proveedor y documento de respaldo. No genera deuda ni IVA: para eso
-- está la compra. Los movimientos van al libro `stock_movements` como 'entrada' con origen 'ING'.

INSERT INTO document_types (code, name, family, internal_legend, print_title, affects_stock, affects_balance, needs_documentation)
VALUES ('ING', 'Ingreso de stock', 'inventario', 0, 'INGRESO DE STOCK', 1, 0, 0);
INSERT INTO numbering_sequences (doc_type, prefix) VALUES ('ING', 'ING');

CREATE TABLE stock_entries (
    id            INTEGER PRIMARY KEY,
    uid           TEXT NOT NULL UNIQUE,
    number        TEXT NOT NULL UNIQUE,
    warehouse_id  INTEGER NOT NULL REFERENCES warehouses (id),
    entry_date    TEXT NOT NULL CHECK (date(entry_date) IS entry_date),
    supplier_id   INTEGER REFERENCES suppliers (id),
    reference     TEXT CHECK (reference IS NULL OR length(reference) <= 80),   -- ej. «Factura 1234», «Guía 88»
    notes         TEXT CHECK (notes IS NULL OR length(notes) <= 500),
    created_by    INTEGER REFERENCES users (id),
    created_at    TEXT NOT NULL
) STRICT;
CREATE INDEX idx_stock_entries_date ON stock_entries (entry_date);
