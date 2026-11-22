-- Libros de compras y ventas electrónicos (IECV) enviados al SII: el XML firmado tal como se envió,
-- su estado y número de seguimiento. En la certificación, los libros «especiales» del set de pruebas.
CREATE TABLE sii_libros (
    id                 INTEGER PRIMARY KEY,
    ambiente           TEXT NOT NULL CHECK (ambiente IN ('certificacion', 'produccion')),
    operacion          TEXT NOT NULL CHECK (operacion IN ('venta', 'compra')),
    periodo            TEXT NOT NULL,
    tipo_libro         TEXT NOT NULL CHECK (tipo_libro IN ('MENSUAL', 'ESPECIAL', 'RECTIFICA')),
    folio_notificacion INTEGER,
    documentos         INTEGER NOT NULL,
    xml                BLOB NOT NULL,
    estado             TEXT NOT NULL CHECK (estado IN ('firmado', 'enviado', 'aceptado', 'reparos', 'rechazado')),
    track_id           TEXT,
    glosa              TEXT,
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL
) STRICT;

CREATE INDEX idx_sii_libros_track ON sii_libros (track_id);
