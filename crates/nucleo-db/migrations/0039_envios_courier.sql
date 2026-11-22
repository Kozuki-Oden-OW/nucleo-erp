-- Envíos con los mismos datos que piden los couriers (Bluexpress y otros): destinatario completo, dirección
-- por partes, tipo de entrega, punto de origen, paquete (contenido, valor, talla, peso y medidas,
-- declaración de mercancías peligrosas) y lo que cobró el courier (costo y n.º de transacción).
ALTER TABLE shipments ADD COLUMN email TEXT;
ALTER TABLE shipments ADD COLUMN street TEXT;
ALTER TABLE shipments ADD COLUMN street_number TEXT;
ALTER TABLE shipments ADD COLUMN unit TEXT;
ALTER TABLE shipments ADD COLUMN reference TEXT;
ALTER TABLE shipments ADD COLUMN delivery_mode TEXT CHECK (delivery_mode IS NULL OR delivery_mode IN ('domicilio', 'punto'));
ALTER TABLE shipments ADD COLUMN origin_point TEXT;
ALTER TABLE shipments ADD COLUMN service TEXT;
ALTER TABLE shipments ADD COLUMN content TEXT;
ALTER TABLE shipments ADD COLUMN declared_value_minor INTEGER CHECK (declared_value_minor IS NULL OR declared_value_minor >= 0);
ALTER TABLE shipments ADD COLUMN size TEXT CHECK (size IS NULL OR size IN ('XS', 'S', 'M', 'L'));
ALTER TABLE shipments ADD COLUMN weight_g INTEGER CHECK (weight_g IS NULL OR weight_g > 0);
ALTER TABLE shipments ADD COLUMN length_cm INTEGER CHECK (length_cm IS NULL OR length_cm > 0);
ALTER TABLE shipments ADD COLUMN width_cm INTEGER CHECK (width_cm IS NULL OR width_cm > 0);
ALTER TABLE shipments ADD COLUMN height_cm INTEGER CHECK (height_cm IS NULL OR height_cm > 0);
ALTER TABLE shipments ADD COLUMN no_dangerous INTEGER NOT NULL DEFAULT 0 CHECK (no_dangerous IN (0, 1));
ALTER TABLE shipments ADD COLUMN cost_minor INTEGER CHECK (cost_minor IS NULL OR cost_minor >= 0);
ALTER TABLE shipments ADD COLUMN payment_ref TEXT;
CREATE INDEX idx_shipments_tracking ON shipments (tracking);
