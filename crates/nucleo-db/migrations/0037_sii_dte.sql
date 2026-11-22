-- Facturación electrónica propia con el SII (docs/SII_FACTURACION_PROPIA.md). Todo queda en la base
-- cifrada de la empresa: el certificado digital (.pfx) y su clave, los folios (CAF, con su llave
-- privada) y cada documento firmado tal como se envió.
CREATE TABLE sii_config (
    id                INTEGER PRIMARY KEY CHECK (id = 1),
    ambiente          TEXT NOT NULL DEFAULT 'certificacion' CHECK (ambiente IN ('certificacion', 'produccion')),
    -- Giro, actividades económicas, dirección y comuna de la casa matriz como las tiene el SII.
    emisor_json       TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(emisor_json)),
    resolucion_fecha  TEXT,
    resolucion_numero INTEGER,
    cert_p12          BLOB,
    cert_password     TEXT,
    cert_name         TEXT,
    cert_rut          TEXT,
    cert_expires      TEXT,
    updated_at        TEXT NOT NULL
) STRICT;

-- Rangos de folios autorizados por el SII. `siguiente` avanza al emitir; un folio nunca se repite.
CREATE TABLE sii_cafs (
    id         INTEGER PRIMARY KEY,
    ambiente   TEXT NOT NULL CHECK (ambiente IN ('certificacion', 'produccion')),
    tipo       INTEGER NOT NULL,
    desde      INTEGER NOT NULL,
    hasta      INTEGER NOT NULL CHECK (hasta >= desde),
    autorizado TEXT NOT NULL,
    xml        BLOB NOT NULL,
    siguiente  INTEGER NOT NULL,
    cargado_at TEXT NOT NULL,
    UNIQUE (ambiente, tipo, desde)
) STRICT;

-- Documentos timbrados y firmados, y su estado en el SII.
CREATE TABLE sii_documents (
    id           INTEGER PRIMARY KEY,
    ambiente     TEXT NOT NULL CHECK (ambiente IN ('certificacion', 'produccion')),
    tipo         INTEGER NOT NULL,
    folio        INTEGER NOT NULL,
    sale_id      INTEGER REFERENCES sales (id),
    fecha        TEXT NOT NULL,
    receptor_rut TEXT NOT NULL,
    receptor     TEXT NOT NULL,
    total_minor  INTEGER NOT NULL,
    xml          BLOB NOT NULL,
    estado       TEXT NOT NULL CHECK (estado IN ('firmado', 'enviado', 'aceptado', 'reparos', 'rechazado')),
    track_id     TEXT,
    glosa        TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    UNIQUE (ambiente, tipo, folio)
) STRICT;

CREATE INDEX idx_sii_documents_track ON sii_documents (track_id);
CREATE INDEX idx_sii_documents_sale ON sii_documents (sale_id);
