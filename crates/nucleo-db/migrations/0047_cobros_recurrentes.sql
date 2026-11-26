-- 0047 · Cobros recurrentes: una venta que se repite sola (mensual, trimestral…), por ejemplo el
-- monitoreo por suscripción. Cada vez que toca, NÚCLEO crea la venta con estas líneas, la deja por
-- cobrar y, si el dueño quiere, le avisa al cliente por correo. El documento tributario lo emite la
-- persona (emitir es irreversible).
CREATE TABLE recurring_sales (
    id            INTEGER PRIMARY KEY,
    uid           TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
    customer_id   INTEGER NOT NULL REFERENCES customers (id),
    lines_json    TEXT NOT NULL CHECK (json_valid(lines_json)),
    notes         TEXT,
    frequency     TEXT NOT NULL CHECK (frequency IN ('mensual', 'bimestral', 'trimestral', 'semestral', 'anual')),
    anchor_day    INTEGER NOT NULL CHECK (anchor_day BETWEEN 1 AND 31),
    next_date     TEXT NOT NULL CHECK (date(next_date) IS next_date),
    end_date      TEXT CHECK (end_date IS NULL OR date(end_date) IS end_date),
    credit_days   INTEGER NOT NULL DEFAULT 0 CHECK (credit_days BETWEEN 0 AND 365),
    confirm       INTEGER NOT NULL DEFAULT 1 CHECK (confirm IN (0, 1)),
    send_mail     INTEGER NOT NULL DEFAULT 1 CHECK (send_mail IN (0, 1)),
    active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    last_run_date TEXT,
    last_sale_id  INTEGER REFERENCES sales (id),
    runs          INTEGER NOT NULL DEFAULT 0,
    created_by    INTEGER REFERENCES users (id),
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
) STRICT;
CREATE INDEX idx_recurring_sales_next ON recurring_sales (next_date) WHERE active = 1;
