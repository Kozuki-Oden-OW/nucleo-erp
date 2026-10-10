-- NÚCLEO ERP · Migración 0022 · Categorías de productos y hoja de costo
-- Las categorías ya existían en el modelo (0004); ahora se usan desde la interfaz. Se agrega un
-- identificador estable (para la sincronización futura) y un conjunto inicial que la persona puede
-- renombrar o eliminar. La hoja de costo guarda cómo se calculó el costo de un producto (compra en
-- otra moneda, transporte, envío, mano de obra y otros) para poder revisarla después.
ALTER TABLE categories ADD COLUMN uid TEXT;
ALTER TABLE categories ADD COLUMN created_at TEXT;
UPDATE categories SET uid = lower(hex(randomblob(16))) WHERE uid IS NULL;
CREATE UNIQUE INDEX idx_categories_uid ON categories (uid);
CREATE UNIQUE INDEX idx_categories_active_name ON categories (name COLLATE NOCASE)
    WHERE archived_at IS NULL AND parent_id IS NULL;

INSERT INTO categories (uid, name, created_at)
SELECT lower(hex(randomblob(16))), v.name, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
FROM (SELECT 1 AS o, 'Mercadería para reventa' AS name UNION ALL
      SELECT 2, 'Fabricación propia' UNION ALL
      SELECT 3, 'Materias primas e insumos' UNION ALL
      SELECT 4, 'Repuestos y accesorios' UNION ALL
      SELECT 5, 'Servicios' UNION ALL
      SELECT 6, 'Otros') v
WHERE NOT EXISTS (SELECT 1 FROM categories)
ORDER BY v.o;

ALTER TABLE products ADD COLUMN cost_sheet_json TEXT
    CHECK (cost_sheet_json IS NULL OR json_valid(cost_sheet_json));
