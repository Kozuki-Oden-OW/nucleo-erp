-- 0046 · Correos automáticos: el registro de correos acepta también el informe periódico al dueño
-- («informe»). La ronda de cobranza y el cobro recurrente usan el tipo «cobro», que ya existía.
CREATE TABLE email_log_new (
    id          INTEGER PRIMARY KEY,
    kind        TEXT NOT NULL CHECK (kind IN ('prueba', 'envio', 'cobro', 'promocion', 'otro', 'informe')),
    to_addr     TEXT NOT NULL,
    subject     TEXT NOT NULL,
    customer_id INTEGER REFERENCES customers (id),
    ref         TEXT,
    status      TEXT NOT NULL CHECK (status IN ('enviado', 'fallido')),
    error       TEXT,
    user_name   TEXT NOT NULL,
    sent_at     TEXT NOT NULL
) STRICT;
INSERT INTO email_log_new (id, kind, to_addr, subject, customer_id, ref, status, error, user_name, sent_at)
    SELECT id, kind, to_addr, subject, customer_id, ref, status, error, user_name, sent_at FROM email_log;
DROP TABLE email_log;
ALTER TABLE email_log_new RENAME TO email_log;
CREATE INDEX idx_email_log_customer ON email_log (customer_id, sent_at);
