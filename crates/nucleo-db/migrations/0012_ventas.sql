-- NÚCLEO ERP · Migración 0012 · Ventas (Fase 5)
-- Descuento porcentual por línea en ventas (igual que en cotizaciones) y anulación de ventas cerradas.

-- El descuento porcentual de la línea se guarda tal como lo digitó el usuario (ppm = millonésimas).
ALTER TABLE sale_items ADD COLUMN discount_ppm INTEGER NOT NULL DEFAULT 0 CHECK (discount_ppm BETWEEN 0 AND 1000000);

-- Una venta cerrada (pagada y documentada) también puede anularse con motivo: el error se corrige
-- sin borrar nada y queda en la auditoría (D-F5-04).
DROP TRIGGER sales_state_flow;
CREATE TRIGGER sales_state_flow BEFORE UPDATE OF commercial_state ON sales
WHEN NOT (
    (old.commercial_state = new.commercial_state)
    OR (old.commercial_state = 'borrador'  AND new.commercial_state IN ('cotizada', 'aceptada', 'efectuada', 'anulada'))
    OR (old.commercial_state = 'cotizada'  AND new.commercial_state IN ('aceptada', 'anulada'))
    OR (old.commercial_state = 'aceptada'  AND new.commercial_state IN ('efectuada', 'anulada'))
    OR (old.commercial_state = 'efectuada' AND new.commercial_state IN ('cerrada', 'anulada'))
    OR (old.commercial_state = 'cerrada'   AND new.commercial_state = 'anulada')
)
BEGIN SELECT RAISE(ABORT, 'transición de estado comercial no permitida'); END;

-- Búsqueda por número de documento.
CREATE INDEX idx_quotes_number ON quotes (number);
CREATE INDEX idx_sales_number ON sales (number);
