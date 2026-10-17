-- NÚCLEO ERP · Migración 0031 · Plan de cuentas base para la contabilidad automática (Fase 10)
-- Plantilla simple para pymes chilenas, editable: se pueden agregar subcuentas y cambiar nombres.
-- Cada cuenta lleva su nombre contable y su nombre en lenguaje de negocio (vista Simple).
-- Los asientos automáticos se calculan desde los documentos; al cerrar un mes quedan guardados en
-- `journal_entries` (origen 'automatico'). Los asientos manuales se guardan siempre.

INSERT INTO accounting_accounts (code, name, simple_name, parent_id, nature, is_postable) VALUES
    ('1', 'Activo', 'Lo que tienes', NULL, 'activo', 0),
    ('2', 'Pasivo', 'Lo que debes', NULL, 'pasivo', 0),
    ('3', 'Patrimonio', 'Lo que es del dueño', NULL, 'patrimonio', 0),
    ('4', 'Ingresos', 'Lo que ganas', NULL, 'ingreso', 0),
    ('5', 'Costos y gastos', 'Lo que gastas', NULL, 'gasto', 0);

INSERT INTO accounting_accounts (code, name, simple_name, parent_id, nature, is_postable)
SELECT v.code, v.name, v.simple, (SELECT id FROM accounting_accounts WHERE code = v.parent), v.nature, 0 FROM (
    SELECT '1.1' AS code, 'Activo circulante' AS name, 'Dinero, cuentas e inventario' AS simple, '1' AS parent, 'activo' AS nature
    UNION ALL SELECT '1.2', 'Activo fijo', 'Equipos, vehículos y muebles', '1', 'activo'
    UNION ALL SELECT '2.1', 'Pasivo circulante', 'Deudas de corto plazo', '2', 'pasivo'
    UNION ALL SELECT '3.1', 'Capital y resultados', 'Capital y utilidades', '3', 'patrimonio'
    UNION ALL SELECT '4.1', 'Ingresos de explotación', 'Ventas', '4', 'ingreso'
    UNION ALL SELECT '4.2', 'Otros ingresos', 'Otros ingresos', '4', 'ingreso'
    UNION ALL SELECT '5.1', 'Costos de explotación', 'Costo de lo vendido', '5', 'gasto'
    UNION ALL SELECT '5.2', 'Gastos de administración y ventas', 'Gastos del negocio', '5', 'gasto'
) v;

INSERT INTO accounting_accounts (code, name, simple_name, parent_id, nature, is_postable)
SELECT v.code, v.name, v.simple, (SELECT id FROM accounting_accounts WHERE code = v.parent), v.nature, 1 FROM (
    SELECT '1.1.01' AS code, 'Caja' AS name, 'Dinero en caja' AS simple, '1.1' AS parent, 'activo' AS nature
    UNION ALL SELECT '1.1.02', 'Bancos', 'Dinero en el banco', '1.1', 'activo'
    UNION ALL SELECT '1.1.03', 'Clientes', 'Dinero que te deben', '1.1', 'activo'
    UNION ALL SELECT '1.1.04', 'IVA crédito fiscal', 'IVA de tus compras', '1.1', 'activo'
    UNION ALL SELECT '1.1.05', 'Mercaderías', 'Tu inventario', '1.1', 'activo'
    UNION ALL SELECT '1.1.06', 'Importaciones en curso', 'Importaciones por recibir', '1.1', 'activo'
    UNION ALL SELECT '1.1.07', 'Otros activos circulantes', 'Otros activos', '1.1', 'activo'
    UNION ALL SELECT '1.2.01', 'Maquinarias y equipos', 'Maquinarias y equipos', '1.2', 'activo'
    UNION ALL SELECT '1.2.02', 'Vehículos', 'Vehículos', '1.2', 'activo'
    UNION ALL SELECT '1.2.03', 'Muebles y equipos de oficina', 'Muebles y computadores', '1.2', 'activo'
    UNION ALL SELECT '2.1.01', 'Proveedores', 'Lo que debes a proveedores', '2.1', 'pasivo'
    UNION ALL SELECT '2.1.02', 'Acreedores varios', 'Gastos por pagar', '2.1', 'pasivo'
    UNION ALL SELECT '2.1.03', 'IVA débito fiscal', 'IVA de tus ventas', '2.1', 'pasivo'
    UNION ALL SELECT '2.1.04', 'Remuneraciones por pagar', 'Sueldos por pagar', '2.1', 'pasivo'
    UNION ALL SELECT '2.1.05', 'Retenciones y leyes sociales por pagar', 'Imposiciones e impuestos retenidos', '2.1', 'pasivo'
    UNION ALL SELECT '2.1.06', 'Préstamos bancarios', 'Créditos del banco', '2.1', 'pasivo'
    UNION ALL SELECT '3.1.01', 'Capital', 'Capital inicial', '3.1', 'patrimonio'
    UNION ALL SELECT '3.1.02', 'Aportes del dueño', 'Lo que aportaste', '3.1', 'patrimonio'
    UNION ALL SELECT '3.1.03', 'Utilidades acumuladas', 'Ganancias de años anteriores', '3.1', 'patrimonio'
    UNION ALL SELECT '3.1.04', 'Retiros del dueño', 'Lo que retiraste', '3.1', 'patrimonio'
    UNION ALL SELECT '4.1.01', 'Ventas', 'Ventas', '4.1', 'ingreso'
    UNION ALL SELECT '4.2.01', 'Sobrantes de inventario', 'Inventario que apareció', '4.2', 'ingreso'
    UNION ALL SELECT '4.2.02', 'Otros ingresos', 'Otros ingresos', '4.2', 'ingreso'
    UNION ALL SELECT '5.1.01', 'Costo de ventas', 'Costo de lo vendido', '5.1', 'gasto'
    UNION ALL SELECT '5.1.02', 'Mermas y ajustes de inventario', 'Inventario perdido o dañado', '5.1', 'gasto'
    UNION ALL SELECT '5.2.01', 'Remuneraciones', 'Sueldos', '5.2', 'gasto'
    UNION ALL SELECT '5.2.02', 'Gastos de vehículo y transporte', 'Vehículo y transporte', '5.2', 'gasto'
    UNION ALL SELECT '5.2.03', 'Gastos de viaje y alimentación', 'Viajes y comidas', '5.2', 'gasto'
    UNION ALL SELECT '5.2.04', 'Gastos de local y oficina', 'Local y oficina', '5.2', 'gasto'
    UNION ALL SELECT '5.2.05', 'Honorarios y capacitación', 'Personas y estudios', '5.2', 'gasto'
    UNION ALL SELECT '5.2.06', 'Gastos de ventas y publicidad', 'Ventas y publicidad', '5.2', 'gasto'
    UNION ALL SELECT '5.2.07', 'Gastos de operación', 'Operación', '5.2', 'gasto'
    UNION ALL SELECT '5.2.08', 'Servicios contratados', 'Servicios', '5.2', 'gasto'
    UNION ALL SELECT '5.2.09', 'Impuestos, comisiones e intereses', 'Impuestos y finanzas', '5.2', 'gasto'
    UNION ALL SELECT '5.2.99', 'Otros gastos', 'Otros gastos', '5.2', 'gasto'
) v;

CREATE INDEX idx_journal_status_date ON journal_entries (status, entry_date);
