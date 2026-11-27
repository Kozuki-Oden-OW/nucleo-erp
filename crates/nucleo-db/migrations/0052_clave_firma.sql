-- Clave de firma de documentos del SII (la del certificado que el SII pide en «Firma de documento
-- tributario electrónico»). Una sola fila, en la base cifrada de la empresa. No se sincroniza con
-- otros dispositivos y nunca vuelve a la interfaz ni al asistente: NÚCLEO la escribe solo en la
-- página de firma del SII y solo después de que la persona aprueba ese documento.
CREATE TABLE sii_signing_key (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    secret     TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    updated_at TEXT NOT NULL
) STRICT;
