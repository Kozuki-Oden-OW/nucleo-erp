-- NÚCLEO ERP · Migración 0023 · Ficha completa del cliente y condiciones de la venta
-- La ficha del cliente ya tenía razón social, nombre de fantasía, giro, dirección, comuna, ciudad y
-- plazo de pago (0003); se agregan región, contacto y correo para recibir facturas.
-- La venta guarda sus condiciones (forma de pago con su detalle, plazo de crédito, referencias como
-- orden de compra u HES, y los datos del receptor tal como quedaron en el documento) en un JSON:
-- son datos del documento interno, no cambian montos ni estados.
ALTER TABLE customers ADD COLUMN region TEXT;
ALTER TABLE customers ADD COLUMN contact_name TEXT;
ALTER TABLE customers ADD COLUMN invoice_email TEXT;

ALTER TABLE sales ADD COLUMN terms_json TEXT CHECK (terms_json IS NULL OR json_valid(terms_json));
