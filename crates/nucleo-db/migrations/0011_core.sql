-- NÚCLEO ERP · Migración 0011 · Núcleo (Fase 4)
-- Catálogo de permisos, roles base con su plantilla (Blueprint §10.4), monedas, usuario dueño,
-- campos de bloqueo de usuarios y de archivo de adjuntos.

-- ───────────────────────────── Permisos ─────────────────────────────
INSERT INTO permissions (code, description) VALUES
    ('config.ver',            'Ver la configuración del negocio'),
    ('config.editar',         'Cambiar datos del negocio, numeración y monedas'),
    ('usuarios.gestionar',    'Crear usuarios, asignar roles y contraseñas'),
    ('auditoria.ver',         'Ver el registro de auditoría'),
    ('respaldos.crear',       'Crear respaldos'),
    ('respaldos.restaurar',   'Restaurar respaldos'),
    ('clientes.ver',          'Ver clientes'),
    ('clientes.editar',       'Crear y editar clientes'),
    ('proveedores.ver',       'Ver proveedores'),
    ('proveedores.editar',    'Crear y editar proveedores'),
    ('productos.ver',         'Ver productos y precios'),
    ('productos.editar',      'Crear y editar productos y precios'),
    ('costos.ver',            'Ver costos, márgenes y utilidad'),
    ('ventas.ver',            'Ver cotizaciones y ventas'),
    ('ventas.crear',          'Crear cotizaciones y ventas'),
    ('ventas.efectuar',       'Marcar ventas como efectuadas'),
    ('ventas.anular',         'Anular ventas'),
    ('ventas.documentar',     'Marcar ventas como documentadas'),
    ('cobros.registrar',      'Registrar cobros y abonos'),
    ('compras.ver',           'Ver compras'),
    ('compras.crear',         'Crear solicitudes y órdenes de compra'),
    ('compras.recibir',       'Recibir mercadería'),
    ('inventario.ver',        'Ver stock y movimientos'),
    ('inventario.ajustar',    'Ajustar y transferir stock'),
    ('dinero.ver',            'Ver cuentas por cobrar, por pagar, bancos y caja'),
    ('dinero.registrar',      'Registrar pagos, gastos y movimientos de dinero'),
    ('caja.operar',           'Operar la caja'),
    ('contabilidad.ver',      'Ver contabilidad e impuestos estimados'),
    ('contabilidad.editar',   'Contabilizar, reversar y cerrar períodos'),
    ('comex.ver',             'Ver importaciones y exportaciones'),
    ('comex.editar',          'Crear y editar importaciones y exportaciones'),
    ('documentos.ver',        'Ver documentos adjuntos'),
    ('documentos.subir',      'Adjuntar documentos'),
    ('documentos.quitar',     'Quitar documentos adjuntos'),
    ('reportes.ver',          'Ver reportes y análisis'),
    ('reportes.exportar',     'Exportar reportes'),
    ('remuneraciones.ver',    'Ver remuneraciones (V2)');

-- ───────────────────────────── Roles base ─────────────────────────────
INSERT INTO roles (code, name, is_system) VALUES
    ('admin',    'Administrador',      1),
    ('dueno',    'Dueño',              1),
    ('contador', 'Contador',           1),
    ('ventas',   'Ventas',             1),
    ('bodega',   'Bodega',             1),
    ('caja',     'Caja',               1),
    ('compras',  'Compras',            1),
    ('rrhh',     'Recursos humanos',   1);

-- Administrador y Dueño: todo.
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r, permissions p WHERE r.code IN ('admin', 'dueno');

-- Plantilla inicial del resto (editable por el dueño). Blueprint §10.4.
INSERT INTO role_permissions (role_id, permission_code)
SELECT (SELECT id FROM roles WHERE code = v.role), v.perm FROM (
    SELECT 'contador' AS role, 'config.ver' AS perm UNION ALL
    SELECT 'contador', 'auditoria.ver' UNION ALL SELECT 'contador', 'respaldos.crear' UNION ALL
    SELECT 'contador', 'clientes.ver' UNION ALL SELECT 'contador', 'proveedores.ver' UNION ALL
    SELECT 'contador', 'productos.ver' UNION ALL SELECT 'contador', 'costos.ver' UNION ALL
    SELECT 'contador', 'ventas.ver' UNION ALL SELECT 'contador', 'ventas.documentar' UNION ALL
    SELECT 'contador', 'compras.ver' UNION ALL SELECT 'contador', 'inventario.ver' UNION ALL
    SELECT 'contador', 'dinero.ver' UNION ALL SELECT 'contador', 'dinero.registrar' UNION ALL
    SELECT 'contador', 'contabilidad.ver' UNION ALL SELECT 'contador', 'contabilidad.editar' UNION ALL
    SELECT 'contador', 'comex.ver' UNION ALL SELECT 'contador', 'documentos.ver' UNION ALL
    SELECT 'contador', 'reportes.ver' UNION ALL SELECT 'contador', 'reportes.exportar' UNION ALL
    SELECT 'contador', 'remuneraciones.ver' UNION ALL
    SELECT 'ventas', 'clientes.ver' UNION ALL SELECT 'ventas', 'clientes.editar' UNION ALL
    SELECT 'ventas', 'productos.ver' UNION ALL SELECT 'ventas', 'ventas.ver' UNION ALL
    SELECT 'ventas', 'ventas.crear' UNION ALL SELECT 'ventas', 'ventas.efectuar' UNION ALL
    SELECT 'ventas', 'cobros.registrar' UNION ALL SELECT 'ventas', 'inventario.ver' UNION ALL
    SELECT 'ventas', 'documentos.ver' UNION ALL SELECT 'ventas', 'documentos.subir' UNION ALL
    SELECT 'bodega', 'productos.ver' UNION ALL SELECT 'bodega', 'ventas.ver' UNION ALL
    SELECT 'bodega', 'compras.ver' UNION ALL SELECT 'bodega', 'compras.recibir' UNION ALL
    SELECT 'bodega', 'inventario.ver' UNION ALL SELECT 'bodega', 'inventario.ajustar' UNION ALL
    SELECT 'bodega', 'documentos.ver' UNION ALL SELECT 'bodega', 'documentos.subir' UNION ALL
    SELECT 'caja', 'clientes.ver' UNION ALL SELECT 'caja', 'productos.ver' UNION ALL
    SELECT 'caja', 'ventas.ver' UNION ALL SELECT 'caja', 'ventas.crear' UNION ALL
    SELECT 'caja', 'cobros.registrar' UNION ALL SELECT 'caja', 'caja.operar' UNION ALL
    SELECT 'caja', 'inventario.ver' UNION ALL
    SELECT 'compras', 'proveedores.ver' UNION ALL SELECT 'compras', 'proveedores.editar' UNION ALL
    SELECT 'compras', 'productos.ver' UNION ALL SELECT 'compras', 'compras.ver' UNION ALL
    SELECT 'compras', 'compras.crear' UNION ALL SELECT 'compras', 'compras.recibir' UNION ALL
    SELECT 'compras', 'inventario.ver' UNION ALL SELECT 'compras', 'dinero.ver' UNION ALL
    SELECT 'compras', 'comex.ver' UNION ALL SELECT 'compras', 'documentos.ver' UNION ALL
    SELECT 'compras', 'documentos.subir' UNION ALL
    SELECT 'rrhh', 'remuneraciones.ver' UNION ALL SELECT 'rrhh', 'documentos.ver'
) v;

-- ───────────────────────────── Usuarios: bloqueo por intentos fallidos ─────────────────────────────
ALTER TABLE users ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0);
ALTER TABLE users ADD COLUMN locked_until TEXT;

-- Usuario dueño inicial (sin contraseña: el negocio abre directo hasta que se active una).
INSERT INTO users (uid, username, display_name, password_hash, created_at)
SELECT lower(hex(randomblob(16))), 'dueno', 'Dueño', NULL, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE NOT EXISTS (SELECT 1 FROM users);
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id FROM users u, roles r
WHERE u.username = 'dueno' AND r.code = 'dueno'
  AND NOT EXISTS (SELECT 1 FROM user_roles);

-- ───────────────────────────── Monedas ─────────────────────────────
INSERT INTO currencies (code, name, decimals, symbol) VALUES
    ('CLP', 'Peso chileno',          0, '$'),
    ('USD', 'Dólar estadounidense',  2, 'US$'),
    ('EUR', 'Euro',                  2, '€'),
    ('CNY', 'Yuan chino',            2, 'CN¥');

-- ───────────────────────────── Adjuntos ─────────────────────────────
ALTER TABLE attachments ADD COLUMN description TEXT;
ALTER TABLE attachments ADD COLUMN archived_at TEXT;
ALTER TABLE attachments ADD COLUMN archived_by TEXT;
CREATE INDEX idx_attachments_active ON attachments (created_at) WHERE archived_at IS NULL;

-- ───────────────────────────── Leyenda interna en cotizaciones (D-F3-08) ─────────────────────────────
UPDATE document_types SET internal_legend = 1 WHERE code IN ('COT', 'PRE');
