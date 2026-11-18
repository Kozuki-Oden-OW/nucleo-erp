-- Factura histórica a crédito aún no pagada: la venta importada como historial puede volver de
-- «cerrada» a «efectuada» para quedar por cobrar (solo ventas históricas; el resto mantiene el flujo).
DROP TRIGGER sales_state_flow;
CREATE TRIGGER sales_state_flow BEFORE UPDATE OF commercial_state ON sales
WHEN NOT (
    (old.commercial_state = new.commercial_state)
    OR (old.commercial_state = 'borrador'  AND new.commercial_state IN ('cotizada', 'aceptada', 'efectuada', 'anulada'))
    OR (old.commercial_state = 'cotizada'  AND new.commercial_state IN ('aceptada', 'anulada'))
    OR (old.commercial_state = 'aceptada'  AND new.commercial_state IN ('efectuada', 'anulada'))
    OR (old.commercial_state = 'efectuada' AND new.commercial_state IN ('cerrada', 'anulada'))
    OR (old.commercial_state = 'cerrada'   AND new.commercial_state = 'anulada')
    OR (old.commercial_state = 'cerrada'   AND new.commercial_state = 'efectuada' AND old.historical = 1)
)
BEGIN SELECT RAISE(ABORT, 'transición de estado comercial no permitida'); END;
