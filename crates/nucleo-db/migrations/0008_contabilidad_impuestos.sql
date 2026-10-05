-- NÚCLEO ERP · Migración 0008 · Contabilidad interna e indicadores tributarios informativos
-- NÚCLEO no declara ni emite (ADR-003). El IVA estimado es una cifra informativa (D-10).

-- Plan de cuentas jerárquico (la plantilla base la carga la app; es editable).
CREATE TABLE accounting_accounts (
    id           INTEGER PRIMARY KEY,
    code         TEXT NOT NULL UNIQUE,              -- ej. '1.1.03'
    name         TEXT NOT NULL,                     -- nombre contable
    simple_name  TEXT,                              -- nombre en lenguaje de negocio ("Dinero que te deben")
    parent_id    INTEGER REFERENCES accounting_accounts (id),
    nature       TEXT NOT NULL CHECK (nature IN ('activo', 'pasivo', 'patrimonio', 'ingreso', 'gasto', 'orden')),
    is_postable  INTEGER NOT NULL DEFAULT 1 CHECK (is_postable IN (0, 1)),
    archived_at  TEXT
) STRICT;

CREATE TABLE cost_centers (
    id          INTEGER PRIMARY KEY,
    code        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    archived_at TEXT
) STRICT;

-- Períodos contables mensuales; un período cerrado bloquea asientos.
CREATE TABLE fiscal_periods (
    id         INTEGER PRIMARY KEY,
    year       INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2200),
    month      INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
    status     TEXT NOT NULL DEFAULT 'abierto' CHECK (status IN ('abierto', 'cerrado')),
    closed_by  INTEGER REFERENCES users (id),
    closed_at  TEXT,
    UNIQUE (year, month)
) STRICT;

CREATE TABLE journal_entries (
    id            INTEGER PRIMARY KEY,
    uid           TEXT NOT NULL UNIQUE,
    entry_date    TEXT NOT NULL CHECK (date(entry_date) IS entry_date),
    description   TEXT NOT NULL,
    origin        TEXT NOT NULL CHECK (origin IN ('automatico', 'manual', 'apertura', 'cierre')),
    source_type   TEXT REFERENCES document_types (code),
    source_id     INTEGER,
    status        TEXT NOT NULL DEFAULT 'propuesto' CHECK (status IN ('propuesto', 'contabilizado', 'reversado')),
    reversal_of   INTEGER REFERENCES journal_entries (id),
    rule_set_code TEXT,
    created_by    INTEGER REFERENCES users (id),
    created_at    TEXT NOT NULL
) STRICT;
CREATE INDEX idx_journal_date ON journal_entries (entry_date);
CREATE INDEX idx_journal_source ON journal_entries (source_type, source_id);

CREATE TABLE journal_entry_lines (
    id               INTEGER PRIMARY KEY,
    journal_entry_id INTEGER NOT NULL REFERENCES journal_entries (id) ON DELETE CASCADE,
    account_id       INTEGER NOT NULL REFERENCES accounting_accounts (id),
    cost_center_id   INTEGER REFERENCES cost_centers (id),
    debit_minor      INTEGER NOT NULL DEFAULT 0 CHECK (debit_minor >= 0),
    credit_minor     INTEGER NOT NULL DEFAULT 0 CHECK (credit_minor >= 0),
    memo             TEXT,
    CHECK ((debit_minor = 0) <> (credit_minor = 0))
) STRICT;
CREATE INDEX idx_journal_lines_account ON journal_entry_lines (account_id, journal_entry_id);

-- Un asiento solo se contabiliza si cuadra (debe = haber) y su período está abierto.
CREATE TRIGGER journal_entry_balanced BEFORE UPDATE OF status ON journal_entries
WHEN new.status = 'contabilizado' AND (
    (SELECT ifnull(sum(debit_minor), 0) - ifnull(sum(credit_minor), 0) FROM journal_entry_lines WHERE journal_entry_id = new.id) <> 0
    OR (SELECT count(*) FROM journal_entry_lines WHERE journal_entry_id = new.id) < 2
)
BEGIN SELECT RAISE(ABORT, 'el asiento no cuadra: el debe debe ser igual al haber'); END;

CREATE TRIGGER journal_entry_period_open BEFORE UPDATE OF status ON journal_entries
WHEN new.status = 'contabilizado' AND EXISTS (
    SELECT 1 FROM fiscal_periods
    WHERE year = CAST(substr(new.entry_date, 1, 4) AS INTEGER)
      AND month = CAST(substr(new.entry_date, 6, 2) AS INTEGER)
      AND status = 'cerrado')
BEGIN SELECT RAISE(ABORT, 'el período contable está cerrado'); END;

CREATE TRIGGER journal_lines_locked BEFORE UPDATE ON journal_entry_lines
WHEN (SELECT status FROM journal_entries WHERE id = old.journal_entry_id) <> 'propuesto'
BEGIN SELECT RAISE(ABORT, 'asiento contabilizado: corrige con una reversa'); END;
CREATE TRIGGER journal_lines_locked_insert BEFORE INSERT ON journal_entry_lines
WHEN (SELECT status FROM journal_entries WHERE id = new.journal_entry_id) <> 'propuesto'
BEGIN SELECT RAISE(ABORT, 'asiento contabilizado: corrige con una reversa'); END;
CREATE TRIGGER journal_lines_locked_delete BEFORE DELETE ON journal_entry_lines
WHEN (SELECT status FROM journal_entries WHERE id = old.journal_entry_id) <> 'propuesto'
BEGIN SELECT RAISE(ABORT, 'asiento contabilizado: corrige con una reversa'); END;

-- Reglas de contabilización configurables: tipo de documento → cuentas (motor de asientos, D-01).
CREATE TABLE posting_rules (
    id           INTEGER PRIMARY KEY,
    doc_type     TEXT NOT NULL REFERENCES document_types (code),
    concept      TEXT NOT NULL,            -- 'total', 'neto', 'impuesto', 'costo', 'inventario'…
    side         TEXT NOT NULL CHECK (side IN ('debe', 'haber')),
    account_id   INTEGER NOT NULL REFERENCES accounting_accounts (id),
    UNIQUE (doc_type, concept, side)
) STRICT;

-- Impuestos por línea (IVA y otros que correspondan). Las TASAS viven en la normativa (rule_values).
CREATE TABLE tax_codes (
    code        TEXT PRIMARY KEY NOT NULL,     -- ej. 'IVA', 'EXENTO'
    name        TEXT NOT NULL,
    rule_code   TEXT,                          -- código del parámetro en la normativa (ej. 'IVA_TASA_GENERAL')
    is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
) STRICT;

-- Resumen mensual del IVA estimado (informativo).
CREATE TABLE tax_periods (
    id                 INTEGER PRIMARY KEY,
    year               INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2200),
    month              INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
    status             TEXT NOT NULL DEFAULT 'abierto' CHECK (status IN ('abierto', 'revisado', 'cerrado')),
    sales_tax_minor    INTEGER NOT NULL DEFAULT 0,
    purchase_tax_minor INTEGER NOT NULL DEFAULT 0,
    adjustments_minor  INTEGER NOT NULL DEFAULT 0,
    estimated_minor    INTEGER NOT NULL DEFAULT 0,
    rule_set_code      TEXT,
    computed_at        TEXT,
    notes              TEXT,
    UNIQUE (year, month)
) STRICT;
