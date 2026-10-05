-- NÚCLEO ERP · Migración 0007 · Dinero: cajas y bancos, cobros y pagos, CxC, CxP, gastos

-- Cuentas de dinero: cajas y cuentas bancarias.
CREATE TABLE money_accounts (
    id             INTEGER PRIMARY KEY,
    uid            TEXT NOT NULL UNIQUE,
    kind           TEXT NOT NULL CHECK (kind IN ('caja', 'banco', 'billetera')),
    name           TEXT NOT NULL,
    bank_name      TEXT,
    account_label  TEXT,                 -- descripción libre; NO se guardan números de tarjeta
    currency_code  TEXT NOT NULL DEFAULT 'CLP' REFERENCES currencies (code),
    branch_id      INTEGER REFERENCES branches (id),
    opening_minor  INTEGER NOT NULL DEFAULT 0,
    opening_date   TEXT CHECK (opening_date IS NULL OR date(opening_date) IS opening_date),
    archived_at    TEXT,
    created_at     TEXT NOT NULL
) STRICT;

-- Cobros (PAG/ABN, entra dinero) y pagos (EGR, sale dinero).
CREATE TABLE payments (
    id               INTEGER PRIMARY KEY,
    uid              TEXT NOT NULL UNIQUE,
    doc_type         TEXT NOT NULL REFERENCES document_types (code) CHECK (doc_type IN ('PAG', 'ABN', 'EGR')),
    number           TEXT NOT NULL,
    direction        TEXT NOT NULL CHECK (direction IN ('entrada', 'salida')),
    party_type       TEXT CHECK (party_type IN ('cliente', 'proveedor')),
    party_id         INTEGER,
    money_account_id INTEGER NOT NULL REFERENCES money_accounts (id),
    payment_date     TEXT NOT NULL CHECK (date(payment_date) IS payment_date),
    method           TEXT NOT NULL CHECK (method IN ('efectivo', 'transferencia', 'debito', 'credito', 'cheque', 'otro')),
    amount_minor     INTEGER NOT NULL CHECK (amount_minor > 0),
    currency_code    TEXT NOT NULL DEFAULT 'CLP' REFERENCES currencies (code),
    rate_e6          INTEGER CHECK (rate_e6 IS NULL OR rate_e6 > 0),
    reference        TEXT,               -- n.º de transferencia, cheque…
    status           TEXT NOT NULL DEFAULT 'vigente' CHECK (status IN ('vigente', 'anulado')),
    void_reason      TEXT,
    notes            TEXT,
    created_by       INTEGER REFERENCES users (id),
    created_at       TEXT NOT NULL,
    UNIQUE (doc_type, number),
    CHECK ((doc_type IN ('PAG', 'ABN') AND direction = 'entrada') OR (doc_type = 'EGR' AND direction = 'salida')),
    CHECK (status <> 'anulado' OR void_reason IS NOT NULL)
) STRICT;
CREATE INDEX idx_payments_date ON payments (payment_date, direction) WHERE status = 'vigente';
CREATE INDEX idx_payments_account ON payments (money_account_id, payment_date);

-- Vencimientos (cuotas) por cobrar y por pagar, derivados de ventas, compras, gastos e importaciones.
CREATE TABLE receivables (
    id            INTEGER PRIMARY KEY,
    sale_id       INTEGER NOT NULL REFERENCES sales (id),
    customer_id   INTEGER REFERENCES customers (id),
    installment   INTEGER NOT NULL DEFAULT 1 CHECK (installment > 0),
    due_date      TEXT NOT NULL CHECK (date(due_date) IS due_date),
    amount_minor  INTEGER NOT NULL CHECK (amount_minor > 0),
    paid_minor    INTEGER NOT NULL DEFAULT 0 CHECK (paid_minor >= 0),
    status        TEXT NOT NULL DEFAULT 'abierta' CHECK (status IN ('abierta', 'pagada', 'anulada')),
    UNIQUE (sale_id, installment),
    CHECK (paid_minor <= amount_minor)
) STRICT;
CREATE INDEX idx_receivables_open ON receivables (due_date, customer_id) WHERE status = 'abierta';

CREATE TABLE payables (
    id            INTEGER PRIMARY KEY,
    source_type   TEXT NOT NULL CHECK (source_type IN ('COM', 'GAS', 'IMP')),
    source_id     INTEGER NOT NULL,
    supplier_id   INTEGER REFERENCES suppliers (id),
    installment   INTEGER NOT NULL DEFAULT 1 CHECK (installment > 0),
    due_date      TEXT NOT NULL CHECK (date(due_date) IS due_date),
    amount_minor  INTEGER NOT NULL CHECK (amount_minor > 0),
    paid_minor    INTEGER NOT NULL DEFAULT 0 CHECK (paid_minor >= 0),
    priority      INTEGER NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
    status        TEXT NOT NULL DEFAULT 'abierta' CHECK (status IN ('abierta', 'pagada', 'anulada')),
    UNIQUE (source_type, source_id, installment),
    CHECK (paid_minor <= amount_minor)
) STRICT;
CREATE INDEX idx_payables_open ON payables (due_date, supplier_id) WHERE status = 'abierta';

-- Aplicación de un pago a uno o varios vencimientos (pagos parciales, anticipos).
CREATE TABLE payment_allocations (
    id             INTEGER PRIMARY KEY,
    payment_id     INTEGER NOT NULL REFERENCES payments (id),
    receivable_id  INTEGER REFERENCES receivables (id),
    payable_id     INTEGER REFERENCES payables (id),
    amount_minor   INTEGER NOT NULL CHECK (amount_minor > 0),
    created_at     TEXT NOT NULL,
    CHECK ((receivable_id IS NULL) <> (payable_id IS NULL))
) STRICT;
CREATE INDEX idx_alloc_payment ON payment_allocations (payment_id);
CREATE INDEX idx_alloc_receivable ON payment_allocations (receivable_id) WHERE receivable_id IS NOT NULL;
CREATE INDEX idx_alloc_payable ON payment_allocations (payable_id) WHERE payable_id IS NOT NULL;

-- Mantener saldos pagados en la misma transacción.
CREATE TRIGGER alloc_receivable_ai AFTER INSERT ON payment_allocations WHEN new.receivable_id IS NOT NULL BEGIN
    UPDATE receivables SET paid_minor = paid_minor + new.amount_minor,
        status = CASE WHEN paid_minor + new.amount_minor >= amount_minor THEN 'pagada' ELSE status END
    WHERE id = new.receivable_id;
END;
CREATE TRIGGER alloc_payable_ai AFTER INSERT ON payment_allocations WHEN new.payable_id IS NOT NULL BEGIN
    UPDATE payables SET paid_minor = paid_minor + new.amount_minor,
        status = CASE WHEN paid_minor + new.amount_minor >= amount_minor THEN 'pagada' ELSE status END
    WHERE id = new.payable_id;
END;
CREATE TRIGGER payment_allocations_no_update BEFORE UPDATE ON payment_allocations
BEGIN SELECT RAISE(ABORT, 'las aplicaciones de pago no se modifican: anula el pago'); END;

CREATE TABLE expense_categories (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    behavior    TEXT NOT NULL DEFAULT 'variable' CHECK (behavior IN ('fijo', 'variable')),
    archived_at TEXT
) STRICT;
INSERT INTO expense_categories (name, behavior) VALUES
    ('Arriendo', 'fijo'), ('Electricidad', 'variable'), ('Agua', 'variable'), ('Internet y telefonía', 'fijo'),
    ('Transporte', 'variable'), ('Marketing', 'variable'), ('Remuneraciones', 'fijo'), ('Honorarios', 'variable'),
    ('Software', 'fijo'), ('Maquinaria y equipos', 'variable'), ('Materiales', 'variable'), ('Logística', 'variable'),
    ('Impuestos y contribuciones', 'variable'), ('Comisiones bancarias', 'variable'), ('Otros', 'variable');

CREATE TABLE expenses (
    id                  INTEGER PRIMARY KEY,
    uid                 TEXT NOT NULL UNIQUE,
    number              TEXT NOT NULL UNIQUE,
    category_id         INTEGER NOT NULL REFERENCES expense_categories (id),
    supplier_id         INTEGER REFERENCES suppliers (id),
    expense_date        TEXT NOT NULL CHECK (date(expense_date) IS expense_date),
    due_date            TEXT CHECK (due_date IS NULL OR date(due_date) IS due_date),
    description         TEXT NOT NULL,
    net_minor           INTEGER NOT NULL CHECK (net_minor >= 0),
    tax_minor           INTEGER NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
    total_minor         INTEGER NOT NULL CHECK (total_minor >= 0),
    currency_code       TEXT NOT NULL DEFAULT 'CLP' REFERENCES currencies (code),
    recurring_schedule_id INTEGER,
    cost_center_id      INTEGER,
    status              TEXT NOT NULL DEFAULT 'registrado' CHECK (status IN ('registrado', 'anulado')),
    created_by          INTEGER REFERENCES users (id),
    created_at          TEXT NOT NULL
) STRICT;
CREATE INDEX idx_expenses_date ON expenses (expense_date, category_id) WHERE status = 'registrado';

-- Gastos e ingresos recurrentes (alimentan el flujo de caja proyectado).
CREATE TABLE recurring_schedules (
    id            INTEGER PRIMARY KEY,
    direction     TEXT NOT NULL CHECK (direction IN ('ingreso', 'egreso')),
    description   TEXT NOT NULL,
    category_id   INTEGER REFERENCES expense_categories (id),
    amount_minor  INTEGER NOT NULL CHECK (amount_minor > 0),
    frequency     TEXT NOT NULL CHECK (frequency IN ('semanal', 'mensual', 'bimestral', 'trimestral', 'anual')),
    day_of_period INTEGER CHECK (day_of_period IS NULL OR day_of_period BETWEEN 1 AND 31),
    starts_on     TEXT NOT NULL CHECK (date(starts_on) IS starts_on),
    ends_on       TEXT CHECK (ends_on IS NULL OR date(ends_on) IS ends_on),
    is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
) STRICT;
