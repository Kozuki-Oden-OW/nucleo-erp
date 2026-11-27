-- 0051 · Equivalencias entre los productos de la tienda WooCommerce y los de NÚCLEO.
--
-- Muchas tiendas no usan SKU, o venden combos («equipo + soporte») y packs («5 x …») que en NÚCLEO
-- son uno o varios productos con su cantidad. Cada fila dice a qué equivale un producto de la tienda
-- (o una de sus variaciones; con la variación vacía vale para todas). El SKU, cuando existe y calza,
-- sigue mandando.
CREATE TABLE woo_product_map (
    id                 INTEGER PRIMARY KEY,
    store_product_id   TEXT NOT NULL CHECK (length(store_product_id) BETWEEN 1 AND 20),
    store_variation_id TEXT NOT NULL DEFAULT '',
    store_name         TEXT NOT NULL,
    -- [{"product_uid": "...", "qty_milli": 1000}]: productos de NÚCLEO por cada unidad de la tienda.
    items_json         TEXT NOT NULL CHECK (json_valid(items_json)),
    updated_at         TEXT NOT NULL,
    UNIQUE (store_product_id, store_variation_id)
) STRICT;
