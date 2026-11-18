-- Ventas históricas (importadas desde documentos ya emitidos fuera de NÚCLEO, ej. facturas del SII).
-- Sirven para reportes, análisis de clientes y productos y el gráfico de 12 meses. No movieron stock
-- ni dinero en NÚCLEO y no generan asientos contables.
ALTER TABLE sales ADD COLUMN historical INTEGER NOT NULL DEFAULT 0 CHECK (historical IN (0, 1));
CREATE INDEX idx_external_doc_refs_number ON external_doc_refs (doc_kind, external_number);
