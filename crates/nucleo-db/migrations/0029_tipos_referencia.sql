-- Tipos de referencia propios del negocio (ej. «Falabella», «Feria de los sábados»), además de los
-- del SII y los canales comunes. En el documento se guardan como «C:<nombre>».
CREATE TABLE reference_kinds (
    id          INTEGER PRIMARY KEY,
    label       TEXT NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 40),
    created_at  TEXT NOT NULL,
    archived_at TEXT
) STRICT;
CREATE UNIQUE INDEX idx_reference_kinds_label ON reference_kinds (label COLLATE NOCASE) WHERE archived_at IS NULL;
