-- NÚCLEO ERP · Migración 0021 · Renta anual: borrador del F22 Pro Pyme general (Fase 10, hito C)
-- NÚCLEO no declara: arma el borrador desde lo cobrado y lo pagado en el año y guarda lo que la
-- persona ajusta (tasa, incentivo 14 E, saldos del año anterior, factores de reajuste de los PPM).
CREATE TABLE f22_years (
    year        INTEGER PRIMARY KEY CHECK (year BETWEEN 2000 AND 2200),
    inputs_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(inputs_json)),
    status      TEXT NOT NULL DEFAULT 'borrador' CHECK (status IN ('borrador', 'declarado')),
    declared_at TEXT,
    declared_folio TEXT,
    updated_at  TEXT NOT NULL
) STRICT;
