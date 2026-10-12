-- Gastos como módulo propio: cantidad × valor, grupos de categorías, presupuesto mensual y
-- categorías para el día a día (combustible, viajes, comidas, alojamiento, estudios…).

-- Cantidad (milésimas) y valor unitario tal como se escribió (con o sin IVA, igual que el total).
-- Vacíos en los gastos anteriores: se leen como 1 × total.
ALTER TABLE expenses ADD COLUMN quantity_milli INTEGER CHECK (quantity_milli IS NULL OR quantity_milli > 0);
ALTER TABLE expenses ADD COLUMN unit_minor INTEGER CHECK (unit_minor IS NULL OR unit_minor >= 0);

-- Grupo (para ordenar y resumir) y presupuesto mensual opcional de cada categoría.
ALTER TABLE expense_categories ADD COLUMN group_name TEXT NOT NULL DEFAULT 'Otros';
ALTER TABLE expense_categories ADD COLUMN monthly_budget_minor INTEGER CHECK (monthly_budget_minor IS NULL OR monthly_budget_minor >= 0);

UPDATE expense_categories SET name = 'Publicidad y marketing'
 WHERE name = 'Marketing' AND NOT EXISTS (SELECT 1 FROM expense_categories WHERE name = 'Publicidad y marketing');

INSERT OR IGNORE INTO expense_categories (name, behavior) VALUES
    ('Combustible', 'variable'), ('Peajes y estacionamientos', 'variable'), ('Mantención de vehículos', 'variable'),
    ('Viajes y pasajes', 'variable'), ('Alojamiento', 'variable'), ('Alimentación y comidas', 'variable'),
    ('Gas', 'variable'), ('Aseo y mantención', 'variable'), ('Útiles de oficina', 'variable'), ('Reparaciones', 'variable'),
    ('Estudios y capacitación', 'variable'), ('Comisiones de venta y plataformas', 'variable'), ('Envases y embalaje', 'variable'),
    ('Contabilidad y asesorías', 'fijo'), ('Seguros', 'fijo'), ('Intereses de créditos', 'fijo'), ('Patentes y permisos', 'variable');

UPDATE expense_categories SET group_name = CASE
    WHEN name IN ('Combustible', 'Transporte', 'Peajes y estacionamientos', 'Mantención de vehículos') THEN 'Vehículo y transporte'
    WHEN name IN ('Viajes y pasajes', 'Alojamiento', 'Alimentación y comidas') THEN 'Viajes y comidas'
    WHEN name IN ('Arriendo', 'Electricidad', 'Agua', 'Gas', 'Internet y telefonía', 'Aseo y mantención', 'Útiles de oficina', 'Reparaciones') THEN 'Local y oficina'
    WHEN name IN ('Remuneraciones', 'Honorarios', 'Estudios y capacitación') THEN 'Personas y estudios'
    WHEN name IN ('Publicidad y marketing', 'Comisiones de venta y plataformas') THEN 'Ventas y publicidad'
    WHEN name IN ('Materiales', 'Maquinaria y equipos', 'Logística', 'Envases y embalaje') THEN 'Operación'
    WHEN name IN ('Software', 'Contabilidad y asesorías', 'Seguros') THEN 'Servicios'
    WHEN name IN ('Impuestos y contribuciones', 'Comisiones bancarias', 'Intereses de créditos', 'Patentes y permisos') THEN 'Impuestos y finanzas'
    ELSE 'Otros' END;
