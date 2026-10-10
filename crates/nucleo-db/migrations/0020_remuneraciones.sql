-- NÚCLEO ERP · Migración 0020 · Remuneraciones: sueldo empresarial y liquidaciones (Fase 10, hito B)
-- NÚCLEO prepara la liquidación y explica cada monto; no envía nada a Previred, la DT ni el SII.
-- Sin tasas en la base: los "indicadores del mes" (UF, UTM, topes, tasas de AFP, SIS, tabla del
-- impuesto único) los ingresa la persona desde Previred y el SII, o vienen de un paquete normativo.

-- Permiso para preparar y emitir liquidaciones (ver ya existía desde 0011).
UPDATE permissions SET description = 'Ver remuneraciones y liquidaciones' WHERE code = 'remuneraciones.ver';
INSERT INTO permissions (code, description) VALUES
    ('remuneraciones.editar', 'Preparar, emitir y anular liquidaciones de sueldo');
INSERT INTO role_permissions (role_id, permission_code)
SELECT id, 'remuneraciones.editar' FROM roles WHERE code IN ('admin', 'dueno', 'rrhh');

-- Personas que reciben remuneración: el dueño con sueldo empresarial y los trabajadores.
-- Las condiciones (contrato, sueldo, AFP, salud, haberes y descuentos fijos) van en terms_json.
CREATE TABLE workers (
    id          INTEGER PRIMARY KEY,
    rut         TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL CHECK (length(trim(name)) > 0),
    is_owner    INTEGER NOT NULL DEFAULT 0 CHECK (is_owner IN (0, 1)),
    position    TEXT,
    start_date  TEXT NOT NULL CHECK (date(start_date) IS start_date),
    end_date    TEXT CHECK (end_date IS NULL OR date(end_date) IS end_date),
    terms_json  TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(terms_json)),
    active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    CHECK (end_date IS NULL OR end_date >= start_date)
) STRICT;

-- Indicadores del mes de remuneraciones (copiados de Previred y del SII), con su fuente.
CREATE TABLE payroll_indicators (
    period          TEXT PRIMARY KEY CHECK (period GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
    indicators_json TEXT NOT NULL CHECK (json_valid(indicators_json)),
    source          TEXT,
    updated_at      TEXT NOT NULL
) STRICT;

-- Liquidaciones: un borrador por persona y mes; al emitirla se congela una foto completa
-- (indicadores, condiciones y resultado) para poder reimprimirla igual años después.
CREATE TABLE payslips (
    id                   INTEGER PRIMARY KEY,
    worker_id            INTEGER NOT NULL REFERENCES workers (id),
    period               TEXT NOT NULL CHECK (period GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
    status               TEXT NOT NULL DEFAULT 'borrador' CHECK (status IN ('borrador', 'emitida', 'anulada')),
    inputs_json          TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(inputs_json)),
    snapshot_json        TEXT CHECK (snapshot_json IS NULL OR json_valid(snapshot_json)),
    pay_date             TEXT CHECK (pay_date IS NULL OR date(pay_date) IS pay_date),
    tax_minor            INTEGER NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
    to_pay_minor         INTEGER NOT NULL DEFAULT 0,
    employer_cost_minor  INTEGER NOT NULL DEFAULT 0,
    emitted_at           TEXT,
    emitted_by           INTEGER REFERENCES users (id),
    voided_at            TEXT,
    void_reason          TEXT,
    created_at           TEXT NOT NULL,
    updated_at           TEXT NOT NULL,
    CHECK (status = 'borrador' OR (snapshot_json IS NOT NULL AND pay_date IS NOT NULL AND emitted_at IS NOT NULL)),
    CHECK (status <> 'anulada' OR (voided_at IS NOT NULL AND void_reason IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX idx_payslips_one_per_month ON payslips (worker_id, period) WHERE status <> 'anulada';
CREATE INDEX idx_payslips_pay_date ON payslips (pay_date) WHERE status = 'emitida';

-- Una liquidación emitida no cambia: se anula y se prepara otra.
CREATE TRIGGER payslips_lock_emitted BEFORE UPDATE OF inputs_json, snapshot_json, pay_date, tax_minor, to_pay_minor ON payslips
WHEN old.status <> 'borrador'
BEGIN SELECT RAISE(ABORT, 'liquidación emitida: anúlala y prepara otra para cambiarla'); END;
