-- NÚCLEO ERP · Migración 0017 · COMEX: seguro teórico
-- Cuando no se contrata seguro, la aduana agrega un seguro teórico (% del valor de la mercadería)
-- solo para calcular el valor aduanero. No es un costo pagado: no se suma al costo en bodega.
-- La tasa la ingresa el usuario (o la propone un paquete normativo con fuente); no se escribe aquí.
ALTER TABLE imports ADD COLUMN notional_insurance_ppm INTEGER
    CHECK (notional_insurance_ppm IS NULL OR notional_insurance_ppm BETWEEN 0 AND 1000000);
