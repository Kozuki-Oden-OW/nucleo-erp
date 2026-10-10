-- NÚCLEO ERP · Migración 0018 · Impuestos: borrador del F29 (Fase 10, hito A)
-- NÚCLEO no declara: arma el borrador código por código desde el Registro de Compras y Ventas
-- (importado de sii.cl o, si no se importó, derivado de las ventas, compras, gastos e
-- importaciones de NÚCLEO). Sin tasas en la base: la tasa de PPM es la de la empresa (ajustes)
-- y la UTM la ingresa la persona o viene de un paquete normativo con fuente.

-- Archivos del Registro de Compras y Ventas importados (uno vigente por período y registro).
CREATE TABLE tax_import_batches (
    id           INTEGER PRIMARY KEY,
    period       TEXT NOT NULL CHECK (period GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
    direction    TEXT NOT NULL CHECK (direction IN ('venta', 'compra')),
    file_name    TEXT,
    row_count    INTEGER NOT NULL DEFAULT 0,
    imported_by  INTEGER REFERENCES users (id),
    imported_at  TEXT NOT NULL
) STRICT;
CREATE INDEX idx_tax_batches_period ON tax_import_batches (period, direction);

-- Documentos tributarios del período: filas del registro del SII o ingresadas a mano.
CREATE TABLE tax_documents (
    id                    INTEGER PRIMARY KEY,
    period                TEXT NOT NULL CHECK (period GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
    direction             TEXT NOT NULL CHECK (direction IN ('venta', 'compra')),
    sii_type              INTEGER NOT NULL CHECK (sii_type > 0),
    folio                 TEXT,
    issue_date            TEXT CHECK (issue_date IS NULL OR date(issue_date) IS issue_date),
    counterpart_rut       TEXT,
    counterpart_name      TEXT,
    doc_count             INTEGER NOT NULL DEFAULT 1 CHECK (doc_count >= 1),
    exempt_minor          INTEGER NOT NULL DEFAULT 0,
    net_minor             INTEGER NOT NULL DEFAULT 0,
    tax_minor             INTEGER NOT NULL DEFAULT 0,
    tax_non_rec_minor     INTEGER NOT NULL DEFAULT 0,
    common_use_tax_minor  INTEGER NOT NULL DEFAULT 0,
    total_minor           INTEGER NOT NULL DEFAULT 0,
    purchase_kind         TEXT CHECK (purchase_kind IS NULL OR purchase_kind IN
                              ('giro', 'supermercado', 'activo_fijo', 'uso_comun', 'sin_derecho', 'bien_raiz')),
    not_of_business       INTEGER NOT NULL DEFAULT 0 CHECK (not_of_business IN (0, 1)),
    origin                TEXT NOT NULL CHECK (origin IN ('rcv', 'manual')),
    batch_id              INTEGER REFERENCES tax_import_batches (id) ON DELETE CASCADE,
    note                  TEXT,
    created_at            TEXT NOT NULL,
    CHECK (origin <> 'rcv' OR batch_id IS NOT NULL)
) STRICT;
CREATE INDEX idx_tax_documents_period ON tax_documents (period, direction);

-- Borrador del F29 de cada mes: datos que ingresa la persona y, al marcarlo declarado, la foto de
-- lo que se declaró en sii.cl (el remanente declarado alimenta el mes siguiente).
CREATE TABLE f29_periods (
    id              INTEGER PRIMARY KEY,
    period          TEXT NOT NULL UNIQUE CHECK (period GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
    status          TEXT NOT NULL DEFAULT 'borrador' CHECK (status IN ('borrador', 'declarado')),
    inputs_json     TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(inputs_json)),
    result_json     TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
    declared_77     INTEGER CHECK (declared_77 IS NULL OR declared_77 >= 0),
    declared_91     INTEGER CHECK (declared_91 IS NULL OR declared_91 >= 0),
    declared_folio  TEXT,
    declared_at     TEXT,
    declared_by     INTEGER REFERENCES users (id),
    updated_at      TEXT NOT NULL,
    CHECK (status <> 'declarado' OR (declared_77 IS NOT NULL AND declared_91 IS NOT NULL))
) STRICT;

-- Un F29 marcado como declarado no cambia sus datos: hay que reabrirlo.
CREATE TRIGGER f29_lock_inputs BEFORE UPDATE OF inputs_json ON f29_periods
WHEN old.status = 'declarado' AND new.status = 'declarado'
BEGIN SELECT RAISE(ABORT, 'F29 marcado como declarado: reábrelo para cambiarlo'); END;
