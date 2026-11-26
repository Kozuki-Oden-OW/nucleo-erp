-- 0049 · Números de serie por unidad y su certificado de calibración.
--
-- Cada equipo con serie se registra una vez (producto + serie). Cuando se vende queda unido a la
-- venta y al cliente, y guarda los datos de su certificado: número, fecha, laboratorio, la fecha de
-- la próxima calibración y la ruta del PDF en el computador. Así se responde «¿a quién le vendimos la
-- serie X?» y «¿qué certificados vencen este mes?» (una oportunidad de recalibración).
CREATE TABLE product_serials (
    id                  INTEGER PRIMARY KEY,
    uid                 TEXT NOT NULL UNIQUE,
    product_id          INTEGER NOT NULL REFERENCES products (id),
    serial              TEXT NOT NULL CHECK (length(serial) BETWEEN 1 AND 80),
    serial_key          TEXT NOT NULL,          -- serie normalizada (mayúsculas, sin espacios ni guiones) para buscar
    status              TEXT NOT NULL DEFAULT 'en_stock' CHECK (status IN ('en_stock', 'vendido', 'baja')),
    sale_id             INTEGER REFERENCES sales (id),
    customer_id         INTEGER REFERENCES customers (id),
    sold_at             TEXT CHECK (sold_at IS NULL OR date(sold_at) IS sold_at),
    certificate_number  TEXT,
    certificate_date    TEXT CHECK (certificate_date IS NULL OR date(certificate_date) IS certificate_date),
    certificate_due     TEXT CHECK (certificate_due IS NULL OR date(certificate_due) IS certificate_due),
    certificate_lab     TEXT,
    certificate_file    TEXT,
    notes               TEXT,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    UNIQUE (product_id, serial_key),
    CHECK (status <> 'vendido' OR sold_at IS NOT NULL)
) STRICT;
CREATE INDEX idx_serials_key ON product_serials (serial_key);
CREATE INDEX idx_serials_sale ON product_serials (sale_id) WHERE sale_id IS NOT NULL;
CREATE INDEX idx_serials_customer ON product_serials (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX idx_serials_due ON product_serials (certificate_due) WHERE certificate_due IS NOT NULL;
