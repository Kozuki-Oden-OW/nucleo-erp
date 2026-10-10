-- NÚCLEO ERP · Migración 0019 · COMEX: flete según el documento de transporte
-- Cuando la factura trae el flete incluido (CPT, CFR), Aduanas declara el flete que consta en el
-- AWB o BL y la mercadería queda como el total menos ese flete (Compendio de Normas Aduaneras,
-- cap. II; respuesta del agente de aduana, oct-2026). Solo cambia el valor aduanero, no lo pagado.
ALTER TABLE imports ADD COLUMN transport_freight_minor INTEGER
    CHECK (transport_freight_minor IS NULL OR transport_freight_minor >= 0);
