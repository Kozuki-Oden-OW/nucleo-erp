-- 0050 · Documento de la venta como en el facturador del SII.
--
-- · Cada línea puede llevar una descripción extendida (la casilla «Descrip.» del SII): el nombre del
--   producto queda corto y el detalle va aparte, igual que en la factura.
-- · La ficha del cliente recuerda si trabaja con orden de compra: al venderle, NÚCLEO pide el número
--   para anotarlo en «Referencias» de la factura.
ALTER TABLE sale_items ADD COLUMN detail TEXT;
ALTER TABLE quote_items ADD COLUMN detail TEXT;
ALTER TABLE customers ADD COLUMN requires_po INTEGER NOT NULL DEFAULT 0 CHECK (requires_po IN (0, 1));

-- Sincronización del dato nuevo de la ficha (los demás campos siguen en los triggers de 0033).
CREATE TRIGGER sync_customers_au_po AFTER UPDATE OF requires_po ON customers
WHEN (SELECT applying FROM sync_state WHERE id = 1) = 0 AND NEW.uid IS NOT NULL AND OLD.requires_po IS NOT NEW.requires_po
BEGIN
    UPDATE sync_state SET
        hlc_counter = CASE WHEN max(CAST(unixepoch('subsec') * 1000 AS INTEGER), hlc_ms) = hlc_ms THEN hlc_counter + 1 ELSE 0 END,
        hlc_ms = max(CAST(unixepoch('subsec') * 1000 AS INTEGER), hlc_ms)
    WHERE id = 1;
    INSERT INTO change_log (hlc, device_uid, entity, entity_uid, field, value_json)
    SELECT (SELECT printf('%013d-%05d-%s', hlc_ms, hlc_counter, device_uid) FROM sync_state WHERE id = 1), (SELECT device_uid FROM sync_state WHERE id = 1), 'customers', NEW.uid, 'requires_po', json_quote(NEW.requires_po);
END;
