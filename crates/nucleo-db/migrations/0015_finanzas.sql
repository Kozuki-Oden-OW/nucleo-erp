-- NÚCLEO ERP · Migración 0015 · Finanzas (Fase 8)
-- Traspasos entre cuentas de dinero, anulación de gastos y registro de lo generado por recurrentes.

ALTER TABLE expenses ADD COLUMN void_reason TEXT;
ALTER TABLE expenses ADD COLUMN notes TEXT;
ALTER TABLE recurring_schedules ADD COLUMN created_at TEXT;

-- Traspaso de dinero entre cuentas propias (ej. depositar la caja en el banco).
CREATE TABLE money_transfers (
    id               INTEGER PRIMARY KEY,
    uid              TEXT NOT NULL UNIQUE,
    from_account_id  INTEGER NOT NULL REFERENCES money_accounts (id),
    to_account_id    INTEGER NOT NULL REFERENCES money_accounts (id),
    transfer_date    TEXT NOT NULL CHECK (date(transfer_date) IS transfer_date),
    amount_minor     INTEGER NOT NULL CHECK (amount_minor > 0),
    notes            TEXT,
    created_by       INTEGER REFERENCES users (id),
    created_at       TEXT NOT NULL,
    CHECK (from_account_id <> to_account_id)
) STRICT;
CREATE INDEX idx_money_transfers_date ON money_transfers (transfer_date);

CREATE TRIGGER money_transfers_no_update BEFORE UPDATE ON money_transfers
BEGIN SELECT RAISE(ABORT, 'los traspasos no se modifican: registra uno inverso'); END;

CREATE INDEX idx_receivables_sale ON receivables (sale_id);
CREATE INDEX idx_payables_source ON payables (source_type, source_id);
