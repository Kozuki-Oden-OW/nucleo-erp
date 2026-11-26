-- 0048 · Conciliación que aprende.
--
-- * El movimiento del banco guarda quién transfirió o a quién se le pagó (RUT y nombre) y el
--   comentario de la transferencia, cuando el banco los entrega. Con eso NÚCLEO reconoce al cliente.
-- * bank_rules: «cuando la glosa diga X (o el RUT sea Y), es tal cliente, tal proveedor, tal gasto,
--   un traspaso o se ignora». Las crea la persona («manual») o las anota NÚCLEO al conciliar
--   («aprendida»). Una regla no mueve dinero: solo ordena las sugerencias.
ALTER TABLE bank_statement_lines ADD COLUMN counterparty_rut TEXT;
ALTER TABLE bank_statement_lines ADD COLUMN counterparty_name TEXT;
ALTER TABLE bank_statement_lines ADD COLUMN comment TEXT;

CREATE TABLE bank_rules (
    id            INTEGER PRIMARY KEY,
    uid           TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
    pattern       TEXT NOT NULL DEFAULT '',     -- texto normalizado que debe aparecer en la glosa
    rut           TEXT,                         -- RUT de la contraparte, sin puntos ni guion
    direction     TEXT NOT NULL CHECK (direction IN ('abono', 'cargo', 'ambos')),
    action        TEXT NOT NULL CHECK (action IN ('cliente', 'proveedor', 'gasto', 'traspaso', 'ignorar')),
    customer_id   INTEGER REFERENCES customers (id),
    supplier_id   INTEGER REFERENCES suppliers (id),
    category_id   INTEGER REFERENCES expense_categories (id),
    account_id    INTEGER REFERENCES money_accounts (id),
    tax_included  INTEGER CHECK (tax_included IS NULL OR tax_included IN (0, 1)),
    note          TEXT,
    origin        TEXT NOT NULL CHECK (origin IN ('manual', 'aprendida')),
    hits          INTEGER NOT NULL DEFAULT 0,
    last_hit_at   TEXT,
    active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    CHECK (pattern <> '' OR rut IS NOT NULL),
    CHECK ((action = 'cliente') = (customer_id IS NOT NULL)),
    CHECK ((action = 'proveedor') = (supplier_id IS NOT NULL)),
    CHECK (action <> 'gasto' OR category_id IS NOT NULL),
    CHECK ((action = 'traspaso') = (account_id IS NOT NULL))
) STRICT;
CREATE INDEX idx_bank_rules_active ON bank_rules (active, direction);
