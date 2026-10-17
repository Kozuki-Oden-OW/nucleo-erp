-- NÚCLEO ERP · Migración 0032 · Conciliación bancaria con cartola
-- La cartola del banco se sube desde un archivo (CSV o Excel) y cada movimiento se concilia con un
-- cobro, pago o traspaso registrado en NÚCLEO, se registra como gasto, cobro o pago nuevo, o se
-- marca como ignorado con una nota. La huella evita duplicar movimientos al subir la misma cartola.

CREATE TABLE bank_statements (
    id                INTEGER PRIMARY KEY,
    uid               TEXT NOT NULL UNIQUE,
    money_account_id  INTEGER NOT NULL REFERENCES money_accounts (id),
    file_name         TEXT,
    period_from       TEXT CHECK (period_from IS NULL OR date(period_from) IS period_from),
    period_to         TEXT CHECK (period_to IS NULL OR date(period_to) IS period_to),
    lines_count       INTEGER NOT NULL DEFAULT 0,
    imported_by       INTEGER REFERENCES users (id),
    imported_at       TEXT NOT NULL
) STRICT;

CREATE TABLE bank_statement_lines (
    id                INTEGER PRIMARY KEY,
    uid               TEXT NOT NULL UNIQUE,
    statement_id      INTEGER NOT NULL REFERENCES bank_statements (id) ON DELETE CASCADE,
    money_account_id  INTEGER NOT NULL REFERENCES money_accounts (id),
    line_date         TEXT NOT NULL CHECK (date(line_date) IS line_date),
    description       TEXT NOT NULL,
    reference         TEXT,
    amount_minor      INTEGER NOT NULL CHECK (amount_minor <> 0),   -- positivo: abono (entra); negativo: cargo (sale)
    balance_minor     INTEGER,                                       -- saldo según la cartola, si viene
    fingerprint       TEXT NOT NULL,
    status            TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'conciliado', 'ignorado')),
    payment_id        INTEGER REFERENCES payments (id),
    transfer_id       INTEGER REFERENCES money_transfers (id),
    note              TEXT,
    reconciled_by     INTEGER REFERENCES users (id),
    reconciled_at     TEXT,
    UNIQUE (money_account_id, fingerprint),
    CHECK (status <> 'conciliado' OR payment_id IS NOT NULL OR transfer_id IS NOT NULL),
    CHECK (payment_id IS NULL OR transfer_id IS NULL)
) STRICT;
CREATE INDEX idx_bank_lines_account ON bank_statement_lines (money_account_id, line_date);
CREATE UNIQUE INDEX idx_bank_lines_payment ON bank_statement_lines (payment_id) WHERE payment_id IS NOT NULL;
CREATE UNIQUE INDEX idx_bank_lines_transfer ON bank_statement_lines (transfer_id, money_account_id) WHERE transfer_id IS NOT NULL;
