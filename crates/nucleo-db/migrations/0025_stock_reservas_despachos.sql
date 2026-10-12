-- Fase 12: qué hacer cuando un producto no tiene stock (por producto) y despachos pendientes.
--   general  = sigue la regla del negocio (Inventario → permitir o no vender sin stock)
--   bloquear = no se vende más de lo que hay
--   vender   = se vende igual (el stock puede quedar negativo)
--   reservar = la venta aparta lo que hay y deja como pedido pendiente lo que falta; el stock se
--              descuenta al despachar (Inventario → Por despachar)
ALTER TABLE products ADD COLUMN stock_policy TEXT NOT NULL DEFAULT 'general'
    CHECK (stock_policy IN ('general', 'bloquear', 'vender', 'reservar'));

-- Unidades ya despachadas de cada reserva (lo pendiente es qty_milli − dispatched_milli).
ALTER TABLE stock_reservations ADD COLUMN dispatched_milli INTEGER NOT NULL DEFAULT 0
    CHECK (dispatched_milli >= 0);

-- Lo reservado es solo lo que falta despachar.
DROP VIEW v_stock_position;
CREATE VIEW v_stock_position AS
SELECT
    p.id AS product_id,
    ifnull((SELECT sum(on_hand_milli) FROM stock_balances b WHERE b.product_id = p.id), 0) AS on_hand_milli,
    ifnull((SELECT sum(qty_milli - dispatched_milli) FROM stock_reservations r WHERE r.product_id = p.id AND r.status = 'activa'), 0) AS reserved_milli,
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
