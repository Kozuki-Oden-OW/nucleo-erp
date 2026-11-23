-- Un documento que el SII rechazó nunca quedó registrado en el SII: su folio sigue disponible allá y
-- se vuelve a usar. Al reutilizar el folio, el documento rechazado sale de `sii_documents` (donde el
-- folio es único) y queda aquí como historial, tal como se envió.
CREATE TABLE sii_documents_reemplazados (
    id             INTEGER PRIMARY KEY,
    documento_id   INTEGER NOT NULL,
    ambiente       TEXT NOT NULL CHECK (ambiente IN ('certificacion', 'produccion')),
    tipo           INTEGER NOT NULL,
    folio          INTEGER NOT NULL,
    sale_id        INTEGER REFERENCES sales (id),
    fecha          TEXT NOT NULL,
    receptor_rut   TEXT NOT NULL,
    receptor       TEXT NOT NULL,
    total_minor    INTEGER NOT NULL,
    xml            BLOB NOT NULL,
    track_id       TEXT,
    glosa          TEXT,
    created_at     TEXT NOT NULL,
    reemplazado_at TEXT NOT NULL
) STRICT;

CREATE INDEX idx_sii_reemplazados_folio ON sii_documents_reemplazados (ambiente, tipo, folio);
