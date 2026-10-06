-- NÚCLEO ERP · Migración 0013 · Compras (Fase 6)
-- Motivo de anulación y monto exento en órdenes de compra; búsqueda por número.

ALTER TABLE purchase_orders ADD COLUMN exempt_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE purchase_orders ADD COLUMN void_reason TEXT;

-- Una orden emitida o recibida no cambia sus montos ni su proveedor (se anula con motivo).
CREATE TRIGGER purchase_orders_lock_amounts BEFORE UPDATE OF supplier_id, net_minor, exempt_minor, tax_minor, total_minor ON purchase_orders
WHEN old.status NOT IN ('borrador')
BEGIN SELECT RAISE(ABORT, 'orden de compra emitida: los montos no se modifican'); END;

CREATE INDEX idx_purchases_supplier ON purchases (supplier_id, issue_date);
CREATE INDEX idx_purchases_number ON purchases (number);
CREATE INDEX idx_receipts_po ON receipts (purchase_order_id);
