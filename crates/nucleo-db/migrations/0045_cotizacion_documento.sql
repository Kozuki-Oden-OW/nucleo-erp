-- 0045 · La cotización como documento para el cliente (PDF con plantilla).
--
-- * quotes.terms_json: condiciones de esa cotización (plazo de entrega, garantía y forma de pago).
--   Si es NULL se usan las condiciones habituales del negocio (ajuste «cotizaciones»).

ALTER TABLE quotes ADD COLUMN terms_json TEXT;
