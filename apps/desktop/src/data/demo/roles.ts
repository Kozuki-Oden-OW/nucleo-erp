// Generado a partir de crates/nucleo-db/migrations/0011_core.sql (roles base y plantilla, Blueprint §10.4).
import type { PermissionRow, RoleRow } from "../types";

export const DEMO_PERMISSIONS: PermissionRow[] = [
  {
    "code": "auditoria.ver",
    "description": "Ver el registro de auditoría"
  },
  {
    "code": "caja.operar",
    "description": "Operar la caja"
  },
  {
    "code": "clientes.editar",
    "description": "Crear y editar clientes"
  },
  {
    "code": "clientes.ver",
    "description": "Ver clientes"
  },
  {
    "code": "cobros.registrar",
    "description": "Registrar cobros y abonos"
  },
  {
    "code": "comex.editar",
    "description": "Crear y editar importaciones y exportaciones"
  },
  {
    "code": "comex.ver",
    "description": "Ver importaciones y exportaciones"
  },
  {
    "code": "compras.crear",
    "description": "Crear solicitudes y órdenes de compra"
  },
  {
    "code": "compras.recibir",
    "description": "Recibir mercadería"
  },
  {
    "code": "compras.ver",
    "description": "Ver compras"
  },
  {
    "code": "config.editar",
    "description": "Cambiar datos del negocio, numeración y monedas"
  },
  {
    "code": "config.ver",
    "description": "Ver la configuración del negocio"
  },
  {
    "code": "contabilidad.editar",
    "description": "Contabilizar, reversar y cerrar períodos"
  },
  {
    "code": "contabilidad.ver",
    "description": "Ver contabilidad e impuestos estimados"
  },
  {
    "code": "costos.ver",
    "description": "Ver costos, márgenes y utilidad"
  },
  {
    "code": "dinero.registrar",
    "description": "Registrar pagos, gastos y movimientos de dinero"
  },
  {
    "code": "dinero.ver",
    "description": "Ver cuentas por cobrar, por pagar, bancos y caja"
  },
  {
    "code": "documentos.quitar",
    "description": "Quitar documentos adjuntos"
  },
  {
    "code": "documentos.subir",
    "description": "Adjuntar documentos"
  },
  {
    "code": "documentos.ver",
    "description": "Ver documentos adjuntos"
  },
  {
    "code": "inventario.ajustar",
    "description": "Ajustar y transferir stock"
  },
  {
    "code": "inventario.ver",
    "description": "Ver stock y movimientos"
  },
  {
    "code": "productos.editar",
    "description": "Crear y editar productos y precios"
  },
  {
    "code": "productos.ver",
    "description": "Ver productos y precios"
  },
  {
    "code": "proveedores.editar",
    "description": "Crear y editar proveedores"
  },
  {
    "code": "proveedores.ver",
    "description": "Ver proveedores"
  },
  {
    "code": "remuneraciones.ver",
    "description": "Ver remuneraciones (V2)"
  },
  {
    "code": "reportes.exportar",
    "description": "Exportar reportes"
  },
  {
    "code": "reportes.ver",
    "description": "Ver reportes y análisis"
  },
  {
    "code": "respaldos.crear",
    "description": "Crear respaldos"
  },
  {
    "code": "respaldos.restaurar",
    "description": "Restaurar respaldos"
  },
  {
    "code": "usuarios.gestionar",
    "description": "Crear usuarios, asignar roles y contraseñas"
  },
  {
    "code": "ventas.anular",
    "description": "Anular ventas"
  },
  {
    "code": "ventas.crear",
    "description": "Crear cotizaciones y ventas"
  },
  {
    "code": "ventas.documentar",
    "description": "Marcar ventas como documentadas"
  },
  {
    "code": "ventas.efectuar",
    "description": "Marcar ventas como efectuadas"
  },
  {
    "code": "ventas.ver",
    "description": "Ver cotizaciones y ventas"
  }
];

export const DEMO_ROLES: RoleRow[] = [
  {
    "code": "admin",
    "name": "Administrador",
    "is_system": true,
    "permissions": [
      "auditoria.ver",
      "caja.operar",
      "clientes.editar",
      "clientes.ver",
      "cobros.registrar",
      "comex.editar",
      "comex.ver",
      "compras.crear",
      "compras.recibir",
      "compras.ver",
      "config.editar",
      "config.ver",
      "contabilidad.editar",
      "contabilidad.ver",
      "costos.ver",
      "dinero.registrar",
      "dinero.ver",
      "documentos.quitar",
      "documentos.subir",
      "documentos.ver",
      "inventario.ajustar",
      "inventario.ver",
      "productos.editar",
      "productos.ver",
      "proveedores.editar",
      "proveedores.ver",
      "remuneraciones.ver",
      "reportes.exportar",
      "reportes.ver",
      "respaldos.crear",
      "respaldos.restaurar",
      "usuarios.gestionar",
      "ventas.anular",
      "ventas.crear",
      "ventas.documentar",
      "ventas.efectuar",
      "ventas.ver"
    ]
  },
  {
    "code": "dueno",
    "name": "Dueño",
    "is_system": true,
    "permissions": [
      "auditoria.ver",
      "caja.operar",
      "clientes.editar",
      "clientes.ver",
      "cobros.registrar",
      "comex.editar",
      "comex.ver",
      "compras.crear",
      "compras.recibir",
      "compras.ver",
      "config.editar",
      "config.ver",
      "contabilidad.editar",
      "contabilidad.ver",
      "costos.ver",
      "dinero.registrar",
      "dinero.ver",
      "documentos.quitar",
      "documentos.subir",
      "documentos.ver",
      "inventario.ajustar",
      "inventario.ver",
      "productos.editar",
      "productos.ver",
      "proveedores.editar",
      "proveedores.ver",
      "remuneraciones.ver",
      "reportes.exportar",
      "reportes.ver",
      "respaldos.crear",
      "respaldos.restaurar",
      "usuarios.gestionar",
      "ventas.anular",
      "ventas.crear",
      "ventas.documentar",
      "ventas.efectuar",
      "ventas.ver"
    ]
  },
  {
    "code": "contador",
    "name": "Contador",
    "is_system": true,
    "permissions": [
      "auditoria.ver",
      "clientes.ver",
      "comex.ver",
      "compras.ver",
      "config.ver",
      "contabilidad.editar",
      "contabilidad.ver",
      "costos.ver",
      "dinero.registrar",
      "dinero.ver",
      "documentos.ver",
      "inventario.ver",
      "productos.ver",
      "proveedores.ver",
      "remuneraciones.ver",
      "reportes.exportar",
      "reportes.ver",
      "respaldos.crear",
      "ventas.documentar",
      "ventas.ver"
    ]
  },
  {
    "code": "ventas",
    "name": "Ventas",
    "is_system": true,
    "permissions": [
      "clientes.editar",
      "clientes.ver",
      "cobros.registrar",
      "documentos.subir",
      "documentos.ver",
      "inventario.ver",
      "productos.ver",
      "ventas.crear",
      "ventas.efectuar",
      "ventas.ver"
    ]
  },
  {
    "code": "bodega",
    "name": "Bodega",
    "is_system": true,
    "permissions": [
      "compras.recibir",
      "compras.ver",
      "documentos.subir",
      "documentos.ver",
      "inventario.ajustar",
      "inventario.ver",
      "productos.ver",
      "ventas.ver"
    ]
  },
  {
    "code": "caja",
    "name": "Caja",
    "is_system": true,
    "permissions": [
      "caja.operar",
      "clientes.ver",
      "cobros.registrar",
      "inventario.ver",
      "productos.ver",
      "ventas.crear",
      "ventas.ver"
    ]
  },
  {
    "code": "compras",
    "name": "Compras",
    "is_system": true,
    "permissions": [
      "comex.ver",
      "compras.crear",
      "compras.recibir",
      "compras.ver",
      "dinero.ver",
      "documentos.subir",
      "documentos.ver",
      "inventario.ver",
      "productos.ver",
      "proveedores.editar",
      "proveedores.ver"
    ]
  },
  {
    "code": "rrhh",
    "name": "Recursos humanos",
    "is_system": true,
    "permissions": [
      "documentos.ver",
      "remuneraciones.ver"
    ]
  }
];
