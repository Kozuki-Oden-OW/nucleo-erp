-- Un producto puede estar en varias categorías (ej. «Ropa» y «One Piece»).
-- `products.category_id` sigue siendo la categoría principal: con ella se agrupan los reportes por
-- categoría, para que cada venta se cuente una sola vez. Aquí van las otras categorías del producto.
CREATE TABLE product_extra_categories (
    product_id  INTEGER NOT NULL REFERENCES products (id),
    category_id INTEGER NOT NULL REFERENCES categories (id),
    PRIMARY KEY (product_id, category_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX idx_product_extra_categories_cat ON product_extra_categories (category_id);
