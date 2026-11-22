-- Conexiones abiertas a más proveedores (correo, couriers, bancos por agregador, WooCommerce) y registro
-- de los correos que NÚCLEO envía desde la casilla de la empresa (docs/INTEGRACIONES.md, I5 e I6).
CREATE TABLE integrations_new (
    provider     TEXT PRIMARY KEY CHECK (length(provider) BETWEEN 2 AND 40),
    config_json  TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(config_json)),
    account_id   TEXT,
    account_name TEXT,
    connected_at TEXT,
    last_sync_at TEXT,
    updated_at   TEXT NOT NULL
) STRICT;
INSERT INTO integrations_new (provider, config_json, account_id, account_name, connected_at, last_sync_at, updated_at)
    SELECT provider, config_json, account_id, account_name, connected_at, last_sync_at, updated_at FROM integrations;
DROP TABLE integrations;
ALTER TABLE integrations_new RENAME TO integrations;

CREATE TABLE email_log (
    id          INTEGER PRIMARY KEY,
    kind        TEXT NOT NULL CHECK (kind IN ('prueba', 'envio', 'cobro', 'promocion', 'otro')),
    to_addr     TEXT NOT NULL,
    subject     TEXT NOT NULL,
    customer_id INTEGER REFERENCES customers (id),
    ref         TEXT,
    status      TEXT NOT NULL CHECK (status IN ('enviado', 'fallido')),
    error       TEXT,
    user_name   TEXT NOT NULL,
    sent_at     TEXT NOT NULL
) STRICT;
CREATE INDEX idx_email_log_customer ON email_log (customer_id, sent_at);
