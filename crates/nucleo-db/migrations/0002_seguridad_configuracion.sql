-- NÚCLEO ERP · Migración 0002 · Seguridad, configuración y catálogos transversales
--
-- Convenciones de todo el esquema (DATABASE.md):
--   *_minor  dinero en unidad mínima de la moneda (CLP sin decimales, USD en centavos)
--   *_e4     valor unitario con 4 decimales extra (costos promedio)
--   qty_milli cantidades en milésimas (1 unidad = 1000)
--   *_ppm    proporciones en partes por millón (12,5 % = 125000)
--   rate_e6  tasa de cambio en CLP por unidad × 1.000.000
--   fechas de negocio 'AAAA-MM-DD'; marcas de tiempo RFC 3339 en UTC

-- ───────────────────────────── Usuarios y permisos ─────────────────────────────
CREATE TABLE users (
    id            INTEGER PRIMARY KEY,
    uid           TEXT NOT NULL UNIQUE,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(username) BETWEEN 2 AND 60),
    display_name  TEXT NOT NULL,
    password_hash TEXT,                     -- Argon2id (PHC). NULL = usuario sin contraseña aún
    is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    last_login_at TEXT,
    created_at    TEXT NOT NULL,
    archived_at   TEXT
) STRICT;

CREATE TABLE roles (
    id          INTEGER PRIMARY KEY,
    code        TEXT NOT NULL UNIQUE,       -- admin, dueno, contador, ventas, bodega, caja, compras, rrhh
    name        TEXT NOT NULL,
    is_system   INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1))
) STRICT;

CREATE TABLE permissions (
    code        TEXT PRIMARY KEY NOT NULL,  -- ej. 'ventas.efectuar', 'costos.ver'
    description TEXT NOT NULL
) STRICT;

CREATE TABLE role_permissions (
    role_id         INTEGER NOT NULL REFERENCES roles (id) ON DELETE CASCADE,
    permission_code TEXT NOT NULL REFERENCES permissions (code) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_code)
) STRICT, WITHOUT ROWID;

CREATE TABLE user_roles (
    user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role_id INTEGER NOT NULL REFERENCES roles (id) ON DELETE RESTRICT,
    PRIMARY KEY (user_id, role_id)
) STRICT, WITHOUT ROWID;

-- ───────────────────────────── Sucursales y monedas ─────────────────────────────
CREATE TABLE branches (
    id          INTEGER PRIMARY KEY,
    uid         TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL CHECK (length(trim(name)) > 0),
    address     TEXT,
    commune     TEXT,
    is_default  INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
    created_at  TEXT NOT NULL,
    archived_at TEXT
) STRICT;
CREATE UNIQUE INDEX ux_branches_default ON branches (is_default) WHERE is_default = 1;

CREATE TABLE currencies (
    code     TEXT PRIMARY KEY NOT NULL CHECK (length(code) = 3 AND code = upper(code)),
    name     TEXT NOT NULL,
    decimals INTEGER NOT NULL CHECK (decimals BETWEEN 0 AND 4),
    symbol   TEXT NOT NULL
) STRICT;

-- Tasas ingresadas por el usuario (funciona sin Internet). CLP por 1 unidad de la moneda.
CREATE TABLE exchange_rates (
    id            INTEGER PRIMARY KEY,
    currency_code TEXT NOT NULL REFERENCES currencies (code),
    rate_date     TEXT NOT NULL CHECK (date(rate_date) IS rate_date),
    rate_e6       INTEGER NOT NULL CHECK (rate_e6 > 0),
    origin        TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual', 'paquete')),
    note          TEXT,
    created_by    INTEGER REFERENCES users (id),
    created_at    TEXT NOT NULL,
    UNIQUE (currency_code, rate_date)
) STRICT;

-- ───────────────────────────── Normativa versionada ─────────────────────────────
-- Copia local de los paquetes importados (nucleo-rules). Fuente obligatoria.
CREATE TABLE rule_sets (
    id          INTEGER PRIMARY KEY,
    code        TEXT NOT NULL UNIQUE,
    publisher   TEXT NOT NULL,
    signature   TEXT,                       -- firma Ed25519 del paquete (base64)
    key_id      TEXT,
    package_json TEXT NOT NULL CHECK (json_valid(package_json)),
    imported_at TEXT NOT NULL,
    imported_by INTEGER REFERENCES users (id)
) STRICT;

CREATE TABLE rule_values (
    id          INTEGER PRIMARY KEY,
    rule_set_id INTEGER NOT NULL REFERENCES rule_sets (id) ON DELETE CASCADE,
    code        TEXT NOT NULL,
    data_json   TEXT NOT NULL CHECK (json_valid(data_json)),
    valid_from  TEXT NOT NULL CHECK (date(valid_from) IS valid_from),
    valid_until TEXT CHECK (valid_until IS NULL OR (date(valid_until) IS valid_until AND valid_until >= valid_from)),
    source      TEXT NOT NULL CHECK (length(trim(source)) > 0),
    notes       TEXT
) STRICT;
CREATE INDEX idx_rule_values_code ON rule_values (code, valid_from);

-- ───────────────────────────── Tipos de documento NÚCLEO ─────────────────────────────
-- Documentos administrativos internos. NO son documentos tributarios (ADR-003).
CREATE TABLE document_types (
    code              TEXT PRIMARY KEY NOT NULL,  -- coincide con el prefijo por defecto
    name              TEXT NOT NULL,
    family            TEXT NOT NULL CHECK (family IN ('venta', 'compra', 'inventario', 'dinero', 'comex', 'otro')),
    internal_legend   INTEGER NOT NULL DEFAULT 0 CHECK (internal_legend IN (0, 1)), -- "DOCUMENTO INTERNO — NO TRIBUTARIO"
    print_title       TEXT,                      -- ej. 'FACTURA INTERNA'
    affects_stock     INTEGER NOT NULL DEFAULT 0 CHECK (affects_stock IN (-1, 0, 1)),
    affects_balance   INTEGER NOT NULL DEFAULT 0 CHECK (affects_balance IN (-1, 0, 1)), -- +1 CxC, -1 CxP
    needs_documentation INTEGER NOT NULL DEFAULT 0 CHECK (needs_documentation IN (0, 1)),
    is_system         INTEGER NOT NULL DEFAULT 1 CHECK (is_system IN (0, 1))
) STRICT;

INSERT INTO document_types (code, name, family, internal_legend, print_title, affects_stock, affects_balance, needs_documentation) VALUES
    ('COT', 'Cotización',               'venta',      0, 'COTIZACIÓN',            0,  0, 0),
    ('PRE', 'Presupuesto',              'venta',      0, 'PRESUPUESTO',           0,  0, 0),
    ('PRO', 'Proforma',                 'venta',      1, 'PROFORMA',              0,  0, 0),
    ('NV',  'Nota de venta',            'venta',      1, 'NOTA DE VENTA',         0,  0, 0),
    ('PED', 'Orden de pedido',          'venta',      0, 'ORDEN DE PEDIDO',       0,  0, 0),
    ('VEN', 'Venta',                    'venta',      1, 'COMPROBANTE DE VENTA', -1,  1, 1),
    ('FV',  'Factura interna',          'venta',      1, 'FACTURA INTERNA',      -1,  1, 1),
    ('SRV', 'Registro de servicio',     'venta',      1, 'REGISTRO DE SERVICIO',  0,  1, 1),
    ('DES', 'Despacho',                 'venta',      0, 'GUÍA DE DESPACHO INTERNA', -1, 0, 0),
    ('DEV', 'Devolución de cliente',    'venta',      1, 'DEVOLUCIÓN',            1, -1, 1),
    ('PAG', 'Comprobante de pago',      'dinero',     1, 'COMPROBANTE DE PAGO',   0, -1, 0),
    ('ABN', 'Registro de abono',        'dinero',     1, 'REGISTRO DE ABONO',     0, -1, 0),
    ('SOL', 'Solicitud de compra',      'compra',     0, 'SOLICITUD DE COMPRA',   0,  0, 0),
    ('CTP', 'Cotización de proveedor',  'compra',     0, NULL,                    0,  0, 0),
    ('OC',  'Orden de compra',          'compra',     0, 'ORDEN DE COMPRA',       0,  0, 0),
    ('REC', 'Recepción',                'compra',     0, 'RECEPCIÓN',             1,  0, 0),
    ('COM', 'Compra',                   'compra',     0, NULL,                    1, -1, 0),
    ('EGR', 'Pago a proveedor',         'dinero',     0, 'COMPROBANTE DE EGRESO', 0,  1, 0),
    ('GAS', 'Gasto',                    'dinero',     0, NULL,                    0, -1, 0),
    ('AJU', 'Ajuste de inventario',     'inventario', 0, 'AJUSTE DE INVENTARIO',  0,  0, 0),
    ('TRA', 'Transferencia de bodega',  'inventario', 0, 'TRANSFERENCIA',         0,  0, 0),
    ('IMP', 'Importación',              'comex',      0, NULL,                    0,  0, 0),
    ('EXP', 'Exportación',              'comex',      0, NULL,                    0,  0, 0);

-- Correlativos: uno por tipo de documento (y opcionalmente por sucursal).
DROP TABLE numbering_sequences;
CREATE TABLE numbering_sequences (
    id          INTEGER PRIMARY KEY,
    doc_type    TEXT NOT NULL REFERENCES document_types (code),
    branch_id   INTEGER REFERENCES branches (id),
    prefix      TEXT NOT NULL CHECK (length(prefix) BETWEEN 1 AND 6 AND prefix = upper(prefix)),
    next_number INTEGER NOT NULL DEFAULT 1 CHECK (next_number >= 1),
    width       INTEGER NOT NULL DEFAULT 6 CHECK (width BETWEEN 1 AND 12)
) STRICT;
CREATE UNIQUE INDEX ux_numbering ON numbering_sequences (doc_type, ifnull(branch_id, 0));
INSERT INTO numbering_sequences (doc_type, prefix) SELECT code, code FROM document_types;

-- ───────────────────────────── Transversales ─────────────────────────────
-- Trazabilidad entre documentos: COT-000147 → VEN-000089 → PAG-000340 …
CREATE TABLE document_links (
    id          INTEGER PRIMARY KEY,
    source_type TEXT NOT NULL REFERENCES document_types (code),
    source_id   INTEGER NOT NULL,
    target_type TEXT NOT NULL REFERENCES document_types (code),
    target_id   INTEGER NOT NULL,
    relation    TEXT NOT NULL CHECK (relation IN ('convertido', 'despacha', 'paga', 'devuelve', 'recibe', 'origina', 'referencia')),
    created_at  TEXT NOT NULL,
    UNIQUE (source_type, source_id, target_type, target_id, relation)
) STRICT;
CREATE INDEX idx_links_target ON document_links (target_type, target_id);

-- Etiquetas para cualquier entidad.
CREATE TABLE tags (
    id    INTEGER PRIMARY KEY,
    name  TEXT NOT NULL UNIQUE COLLATE NOCASE,
    color TEXT
) STRICT;
CREATE TABLE entity_tags (
    tag_id    INTEGER NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
    entity    TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    PRIMARY KEY (entity, entity_id, tag_id)
) STRICT, WITHOUT ROWID;

-- Repositorio de archivos adjuntos (contenido deduplicado por SHA-256, cifrado en disco).
CREATE TABLE attachments (
    id          INTEGER PRIMARY KEY,
    uid         TEXT NOT NULL UNIQUE,
    sha256      TEXT NOT NULL CHECK (length(sha256) = 64),
    file_name   TEXT NOT NULL,
    mime_type   TEXT NOT NULL,
    size_bytes  INTEGER NOT NULL CHECK (size_bytes >= 0),
    created_by  INTEGER REFERENCES users (id),
    created_at  TEXT NOT NULL
) STRICT;
CREATE INDEX idx_attachments_sha ON attachments (sha256);
CREATE TABLE attachment_links (
    attachment_id INTEGER NOT NULL REFERENCES attachments (id) ON DELETE CASCADE,
    entity        TEXT NOT NULL,
    entity_id     INTEGER NOT NULL,
    PRIMARY KEY (entity, entity_id, attachment_id)
) STRICT, WITHOUT ROWID;

-- Hallazgos del motor de inteligencia (alertas, atención, oportunidades — §19.1).
CREATE TABLE insights (
    id           INTEGER PRIMARY KEY,
    kind         TEXT NOT NULL,             -- ej. 'riesgo_quiebre', 'cliente_en_riesgo'
    severity     TEXT NOT NULL CHECK (severity IN ('info', 'atencion', 'urgente', 'oportunidad')),
    entity       TEXT,
    entity_id    INTEGER,
    what_json    TEXT NOT NULL CHECK (json_valid(what_json)),  -- qué pasa
    why_json     TEXT NOT NULL CHECK (json_valid(why_json)),   -- por qué (números y fórmula)
    review_json  TEXT CHECK (review_json IS NULL OR json_valid(review_json)), -- qué revisar
    impact_minor INTEGER,
    status       TEXT NOT NULL DEFAULT 'nuevo' CHECK (status IN ('nuevo', 'visto', 'descartado', 'resuelto')),
    snooze_until TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT
) STRICT;
CREATE INDEX idx_insights_open ON insights (status, severity) WHERE status IN ('nuevo', 'visto');
CREATE UNIQUE INDEX ux_insights_active ON insights (kind, ifnull(entity, ''), ifnull(entity_id, 0)) WHERE status IN ('nuevo', 'visto');

CREATE TABLE alert_rules (
    code        TEXT PRIMARY KEY NOT NULL,
    enabled     INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    params_json TEXT NOT NULL CHECK (json_valid(params_json))
) STRICT;
