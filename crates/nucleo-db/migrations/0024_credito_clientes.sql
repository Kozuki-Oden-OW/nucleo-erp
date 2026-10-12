-- NÚCLEO ERP · Migración 0024 · Crédito a clientes
-- El crédito se habilita por cliente (días, cupo y condiciones ya existían o se agregan aquí) y
-- puede respaldarse con documentos: carpeta tributaria, certificado de vigencia, inscripción con
-- anotaciones marginales, poderes, informe comercial y otros. Todo es opcional: la persona decide
-- a quién le presta; NÚCLEO solo ordena lo recibido y sugiere qué revisar.
ALTER TABLE customers ADD COLUMN credit_enabled INTEGER NOT NULL DEFAULT 0 CHECK (credit_enabled IN (0, 1));
ALTER TABLE customers ADD COLUMN credit_conditions TEXT;
-- Los clientes que ya tenían días de crédito quedan con el crédito habilitado.
UPDATE customers SET credit_enabled = 1 WHERE payment_terms_days > 0;

CREATE TABLE customer_credit_docs (
    customer_id   INTEGER NOT NULL REFERENCES customers (id),
    kind          TEXT NOT NULL CHECK (kind IN ('carpeta_tributaria', 'situacion_sii', 'vigencia', 'anotaciones',
                      'poderes', 'informe_comercial', 'otro')),
    status        TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'recibido', 'verificado', 'no_aplica')),
    attachment_id INTEGER REFERENCES attachments (id),
    issued_on     TEXT CHECK (issued_on IS NULL OR date(issued_on) IS issued_on),
    verified_on   TEXT CHECK (verified_on IS NULL OR date(verified_on) IS verified_on),
    note          TEXT,
    updated_at    TEXT NOT NULL,
    PRIMARY KEY (customer_id, kind)
) STRICT, WITHOUT ROWID;
