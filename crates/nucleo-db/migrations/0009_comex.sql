-- NÚCLEO ERP · Migración 0009 · NÚCLEO COMEX: importaciones y exportaciones
-- Sin aranceles ni tasas inventadas: los porcentajes los ingresa el usuario o vienen de la
-- normativa con fuente (COMEX_RULES.md).

-- Contenido versionado y actualizable de Incoterms (quién paga, riesgo, punto de transferencia).
CREATE TABLE incoterm_definitions (
    code          TEXT NOT NULL,                -- EXW, FCA, FAS, FOB, CFR, CIF, CPT, CIP, DAP, DPU, DDP
    version       TEXT NOT NULL,                -- ej. '2020'
    name          TEXT NOT NULL,
    content_json  TEXT NOT NULL CHECK (json_valid(content_json)),
    source        TEXT NOT NULL CHECK (length(trim(source)) > 0),
    PRIMARY KEY (code, version)
) STRICT, WITHOUT ROWID;

CREATE TABLE imports (
    id                  INTEGER PRIMARY KEY,
    uid                 TEXT NOT NULL UNIQUE,
    number              TEXT NOT NULL UNIQUE,       -- IMP-000012
    supplier_id         INTEGER REFERENCES suppliers (id),
    is_scenario         INTEGER NOT NULL DEFAULT 0 CHECK (is_scenario IN (0, 1)),  -- 1 = simulación
    scenario_group      TEXT,                       -- agrupa escenarios comparables (A marítimo, B aéreo…)
    scenario_label      TEXT,
    incoterm            TEXT,
    incoterm_version    TEXT,
    transport_mode      TEXT CHECK (transport_mode IS NULL OR transport_mode IN ('maritimo', 'aereo', 'terrestre', 'courier', 'multimodal')),
    origin_country      TEXT,
    origin_port         TEXT,
    destination_port    TEXT,
    currency_code       TEXT NOT NULL DEFAULT 'USD' REFERENCES currencies (code),
    rate_e6             INTEGER CHECK (rate_e6 IS NULL OR rate_e6 > 0),     -- CLP por unidad, usada en el cálculo
    stage               TEXT NOT NULL DEFAULT 'cotizacion' CHECK (stage IN (
                            'cotizacion', 'ordenada', 'pagada', 'produccion', 'lista_despacho', 'embarcada',
                            'en_transito', 'arribada', 'internacion', 'transporte_local', 'recibida', 'cerrada', 'anulada')),
    purchase_date       TEXT CHECK (purchase_date IS NULL OR date(purchase_date) IS purchase_date),
    production_eta      TEXT CHECK (production_eta IS NULL OR date(production_eta) IS production_eta),
    shipment_date       TEXT CHECK (shipment_date IS NULL OR date(shipment_date) IS shipment_date),
    eta                 TEXT CHECK (eta IS NULL OR date(eta) IS eta),
    arrival_date        TEXT CHECK (arrival_date IS NULL OR date(arrival_date) IS arrival_date),
    reception_date      TEXT CHECK (reception_date IS NULL OR date(reception_date) IS reception_date),
    allocation_basis    TEXT NOT NULL DEFAULT 'valor' CHECK (allocation_basis IN ('valor', 'peso', 'volumen', 'unidades')),
    fob_minor           INTEGER,                    -- en la moneda de la importación
    cif_minor           INTEGER,
    landed_total_clp    INTEGER,                    -- costo total final en CLP
    rule_set_code       TEXT,
    notes               TEXT,
    created_by          INTEGER REFERENCES users (id),
    created_at          TEXT NOT NULL,
    updated_at          TEXT
) STRICT;
CREATE INDEX idx_imports_open ON imports (eta) WHERE is_scenario = 0 AND stage NOT IN ('cotizacion', 'cerrada', 'anulada');
CREATE INDEX idx_imports_scenarios ON imports (scenario_group) WHERE is_scenario = 1;

CREATE TABLE import_items (
    id                  INTEGER PRIMARY KEY,
    import_id           INTEGER NOT NULL REFERENCES imports (id) ON DELETE CASCADE,
    product_id          INTEGER REFERENCES products (id),
    description         TEXT NOT NULL,
    qty_milli           INTEGER NOT NULL CHECK (qty_milli > 0),
    received_milli      INTEGER NOT NULL DEFAULT 0 CHECK (received_milli >= 0),
    unit_price_minor    INTEGER NOT NULL CHECK (unit_price_minor >= 0),   -- moneda de la importación
    weight_g            INTEGER,
    volume_cm3          INTEGER,
    duty_ppm            INTEGER CHECK (duty_ppm IS NULL OR duty_ppm BETWEEN 0 AND 1000000),  -- arancel ingresado por el usuario
    landed_unit_cost_e4 INTEGER,                                           -- costo final unitario prorrateado (CLP)
    hs_code             TEXT
) STRICT;
-- Stock "en importación" pendiente por producto (§19.4).
CREATE INDEX idx_import_items_product ON import_items (product_id) WHERE received_milli < qty_milli;

CREATE TABLE import_costs (
    id                INTEGER PRIMARY KEY,
    import_id         INTEGER NOT NULL REFERENCES imports (id) ON DELETE CASCADE,
    kind              TEXT NOT NULL CHECK (kind IN ('flete', 'seguro', 'derechos', 'iva_importacion', 'agente_aduana',
                          'gastos_portuarios', 'almacenaje', 'transporte_interno', 'gastos_bancarios', 'otros')),
    description       TEXT,
    supplier_id       INTEGER REFERENCES suppliers (id),      -- quién lo cobra (genera CxP si es real)
    currency_code     TEXT NOT NULL REFERENCES currencies (code),
    amount_minor      INTEGER NOT NULL CHECK (amount_minor >= 0),
    rate_e6           INTEGER CHECK (rate_e6 IS NULL OR rate_e6 > 0),
    is_estimate       INTEGER NOT NULL DEFAULT 1 CHECK (is_estimate IN (0, 1)),
    recoverable_tax   INTEGER NOT NULL DEFAULT 0 CHECK (recoverable_tax IN (0, 1)),  -- no se suma al costo si es crédito
    allocation_basis  TEXT CHECK (allocation_basis IS NULL OR allocation_basis IN ('valor', 'peso', 'volumen', 'unidades')),
    created_at        TEXT NOT NULL
) STRICT;
CREATE INDEX idx_import_costs ON import_costs (import_id);

-- Historial de etapas y de cambios de ETA ("la ETA cambió 3 veces: +12 días").
CREATE TABLE import_stage_history (
    id          INTEGER PRIMARY KEY,
    import_id   INTEGER NOT NULL REFERENCES imports (id) ON DELETE CASCADE,
    from_stage  TEXT,
    to_stage    TEXT NOT NULL,
    changed_at  TEXT NOT NULL,
    changed_by  INTEGER REFERENCES users (id),
    note        TEXT
) STRICT;
CREATE INDEX idx_import_stage_history ON import_stage_history (import_id, changed_at);

CREATE TABLE eta_changes (
    id          INTEGER PRIMARY KEY,
    import_id   INTEGER NOT NULL REFERENCES imports (id) ON DELETE CASCADE,
    old_eta     TEXT,
    new_eta     TEXT NOT NULL CHECK (date(new_eta) IS new_eta),
    reason      TEXT,
    changed_at  TEXT NOT NULL,
    changed_by  INTEGER REFERENCES users (id)
) STRICT;

CREATE TRIGGER imports_stage_log AFTER UPDATE OF stage ON imports WHEN old.stage <> new.stage BEGIN
    INSERT INTO import_stage_history (import_id, from_stage, to_stage, changed_at)
    VALUES (new.id, old.stage, new.stage, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));
END;
CREATE TRIGGER imports_eta_log AFTER UPDATE OF eta ON imports WHEN new.eta IS NOT NULL AND old.eta IS NOT new.eta BEGIN
    INSERT INTO eta_changes (import_id, old_eta, new_eta, changed_at)
    VALUES (new.id, old.eta, new.eta, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));
END;

CREATE TABLE exports (
    id                INTEGER PRIMARY KEY,
    uid               TEXT NOT NULL UNIQUE,
    number            TEXT NOT NULL UNIQUE,
    customer_id       INTEGER REFERENCES customers (id),
    is_scenario       INTEGER NOT NULL DEFAULT 0 CHECK (is_scenario IN (0, 1)),
    incoterm          TEXT,
    incoterm_version  TEXT,
    destination_country TEXT,
    currency_code     TEXT NOT NULL DEFAULT 'USD' REFERENCES currencies (code),
    rate_e6           INTEGER CHECK (rate_e6 IS NULL OR rate_e6 > 0),
    status            TEXT NOT NULL DEFAULT 'simulacion' CHECK (status IN ('simulacion', 'confirmada', 'embarcada', 'cobrada', 'cerrada', 'anulada')),
    shipment_date     TEXT CHECK (shipment_date IS NULL OR date(shipment_date) IS shipment_date),
    revenue_minor     INTEGER,
    rule_set_code     TEXT,
    notes             TEXT,
    created_by        INTEGER REFERENCES users (id),
    created_at        TEXT NOT NULL
) STRICT;

CREATE TABLE export_items (
    id                INTEGER PRIMARY KEY,
    export_id         INTEGER NOT NULL REFERENCES exports (id) ON DELETE CASCADE,
    product_id        INTEGER REFERENCES products (id),
    description       TEXT NOT NULL,
    qty_milli         INTEGER NOT NULL CHECK (qty_milli > 0),
    unit_price_minor  INTEGER NOT NULL CHECK (unit_price_minor >= 0),
    unit_cost_e4      INTEGER
) STRICT;

CREATE TABLE export_costs (
    id             INTEGER PRIMARY KEY,
    export_id      INTEGER NOT NULL REFERENCES exports (id) ON DELETE CASCADE,
    kind           TEXT NOT NULL CHECK (kind IN ('flete', 'seguro', 'documentacion', 'transporte', 'logistica', 'comisiones', 'gastos_bancarios', 'otros')),
    description    TEXT,
    currency_code  TEXT NOT NULL REFERENCES currencies (code),
    amount_minor   INTEGER NOT NULL CHECK (amount_minor >= 0),
    rate_e6        INTEGER CHECK (rate_e6 IS NULL OR rate_e6 > 0)
) STRICT;
