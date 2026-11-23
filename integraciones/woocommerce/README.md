# NÚCLEO ERP para WooCommerce (plugin de WordPress)

Plugin que conecta una tienda WooCommerce con NÚCLEO ERP. El diseño está en `docs/INTEGRACIONES.md` (I8)
y el lado de NÚCLEO en `crates/nucleo-app/src/woo_ops.rs`.

| Carpeta | Qué hay |
|---|---|
| `nucleo-erp/` | El plugin tal como se instala (`nucleo-erp.php`, `uninstall.php`, `readme.txt` para WordPress.org) |
| `pruebas/arnes.php` | Arnés con funciones de WordPress simuladas: conexión, ruta de estado, checkout y pedido |

## Armar el .zip

```
python3 tools/build_woo_plugin.py
```

Deja `dist-plugin/nucleo-erp-<versión>.zip`, listo para Plugins → Añadir nuevo → Subir plugin.

## Probar

```
php -l integraciones/woocommerce/nucleo-erp/nucleo-erp.php
php integraciones/woocommerce/pruebas/arnes.php
```

El arnés no reemplaza un WordPress real. Antes de publicar una versión se prueba en una tienda de
pruebas (o una copia de la tienda): activar, crear conexión, conectar desde NÚCLEO, un pedido con el
checkout clásico y otro con el de bloques, con y sin almacenamiento de pedidos de alto rendimiento.

## Publicar en WordPress.org

1. Cuenta en wordpress.org y envío del .zip en <https://wordpress.org/plugins/developers/add/>.
2. La revisión es manual (días o semanas). Piden cambios por correo.
3. Aprobado, entregan un repositorio SVN: `trunk/` con el plugin y `tags/<versión>/`.

El plugin se licencia GPL-2.0-or-later (requisito del directorio); NÚCLEO ERP sigue siendo AGPL-3.0.
