# Base de datos — NÚCLEO ERP

Modelo de datos del MVP, diseñado en la **Fase 2** a partir del Blueprint §5 y de
`02_INTELIGENCIA_COMERCIAL.md` §19. Cada negocio tiene su propio archivo `company.db` cifrado con
SQLCipher (ADR-001, ADR-005).

**Tamaño:** 91 tablas · 30 triggers · 62 índices · 1 vista · 3 índices de búsqueda FTS5 · 10 migraciones.

## 1. Convenciones

| Convención | Significado | Ejemplo |
|---|---|---|
| `*_minor` | Dinero en unidad mínima de la moneda | CLP 49.990 → `49990`; USD 5,13 → `513` |
| `*_e4` | Valor unitario con 4 decimales extra (costos promedio) | $1.300,25 → `13002500` |
| `qty_milli` | Cantidades en milésimas (1 unidad = 1000) | 2,5 kg → `2500` |
| `*_ppm` | Proporciones en partes por millón | 12,5 % → `125000` |
| `rate_e6` | Tasa de cambio: CLP por 1 unidad × 1.000.000 | 950,123456 → `950123456` |
| Fechas de negocio | `TEXT` `'AAAA-MM-DD'`, validadas con `CHECK (date(x) IS x)` | `'2026-10-05'` |
| Marcas de tiempo | `TEXT` RFC 3339 en UTC | `'2026-10-05T12:00:00Z'` |
| Identificadores | `id INTEGER PRIMARY KEY` + `uid` UUIDv7 en entidades principales | — |
| Numeración NÚCLEO | Prefijo + correlativo de 6 dígitos | `COT-000147`, `FV-000001` |
| Tablas | Todas `STRICT`; `foreign_keys = ON` | — |

Todo es entero: las sumas y los reportes se hacen en SQL sin perder exactitud y sin `REAL`.

## 2. Migraciones

| # | Archivo | Contenido |
|---|---|---|
| 1 | `0001_nucleo_base.sql` | `app_meta`, `settings`, `audit_log` (encadenada, solo inserción) |
| 2 | `0002_seguridad_configuracion.sql` | Usuarios, roles, permisos, sucursales, monedas, tasas de cambio, normativa (`rule_sets`, `rule_values`), **23 tipos de documento NÚCLEO**, numeración, `document_links`, etiquetas, adjuntos, `insights`, `alert_rules` |
| 3 | `0003_maestros.sql` | Clientes, proveedores, contactos, direcciones, notas; FTS5 de clientes y proveedores |
| 4 | `0004_productos_inventario.sql` | Unidades, categorías, marcas, productos, kits, proveedor por producto, listas de precios, bodegas, lotes, series, **libro de movimientos**, saldos, reservas, foto diaria, parámetros de reorden; FTS5 de productos |
| 5 | `0005_ventas.sql` | Cotizaciones (COT/PRE/PRO), notas de venta (NV/PED), despachos, ventas (VEN/FV/SRV/DEV), líneas, descuentos por origen, referencia tributaria externa |
| 6 | `0006_compras.sql` | Solicitudes, cotizaciones de proveedor, órdenes de compra, recepciones, compras |
| 7 | `0007_dinero.sql` | Cajas y bancos, cobros y pagos, CxC, CxP, aplicaciones de pago, categorías de gasto, gastos, recurrentes |
| 8 | `0008_contabilidad_impuestos.sql` | Plan de cuentas, centros de costo, períodos, asientos, reglas de contabilización, códigos de impuesto, IVA estimado mensual |
| 9 | `0009_comex.sql` | Incoterms versionados, importaciones (12 etapas, ETA, escenarios), ítems, costos, historial de etapas y ETA, exportaciones |
| 10 | `0010_analitica.sql` | `fact_sales_daily`, `fact_sales_day`, `fact_customer_monthly`, vista `v_stock_position` |

Las migraciones son transaccionales y versionadas con `PRAGMA user_version`. **Pre-1.0:** se pueden
reescribir (en la Fase 2 se reemplazó la tabla mínima de clientes de la Fase 1); desde la primera beta
pública son inmutables.

## 3. Mapa por dominio

```
NÚCLEO          users · roles · permissions · branches · currencies · exchange_rates · rule_sets/rule_values
                document_types · numbering_sequences · document_links · tags · attachments · insights · audit_log
MAESTROS        customers · suppliers · contacts · addresses · party_notes
PRODUCTOS       units · categories · brands · products · product_components · product_suppliers · price_lists
INVENTARIO      warehouses · lots · serials · stock_movements → stock_balances · stock_reservations
                stock_daily_snapshot · reorder_settings
VENTAS          quotes → sales_orders → deliveries → sales (+ sale_items, sale_item_adjustments, external_doc_refs)
COMPRAS         purchase_requests → supplier_quotes → purchase_orders → receipts → purchases
DINERO          money_accounts · payments → payment_allocations → receivables / payables · expenses · recurring_schedules
CONTABILIDAD    accounting_accounts · cost_centers · fiscal_periods · journal_entries/lines · posting_rules
INDICADORES     tax_codes · tax_periods (IVA estimado informativo)
COMEX           incoterm_definitions · imports (+ items, costs, stage_history, eta_changes) · exports (+ items, costs)
ANALÍTICA       fact_sales_daily · fact_sales_day · fact_customer_monthly · v_stock_position
```

Las conversiones entre documentos (COT-000147 → VEN-000089 → PAG-000340) quedan en `document_links`.

## 4. Reglas que hace cumplir la propia base

Aunque la aplicación tenga un error, estas reglas no se pueden romper:

| Regla | Mecanismo |
|---|---|
| El stock no se edita: se corrige con movimientos | Triggers de solo inserción en `stock_movements` |
| El saldo de stock siempre cuadra con el libro | Trigger `stock_movements_balance` actualiza `stock_balances` y el costo del producto |
| Una salida no puede tener cantidad positiva (y viceversa) | `CHECK` por tipo de movimiento |
| Venta efectuada, cerrada o anulada: montos y líneas inmutables | `sales_lock_amounts`, `sale_items_lock_*` |
| Estados comerciales solo avanzan (borrador → … → cerrada / anulada) | `sales_state_flow` |
| Anular exige motivo | `CHECK (… void_reason IS NOT NULL)` |
| Los pagos actualizan saldos de CxC/CxP y cambian a "pagada" | Triggers en `payment_allocations` |
| Lo pagado nunca supera lo adeudado | `CHECK (paid_minor <= amount_minor)` |
| Un asiento solo se contabiliza si el debe es igual al haber | `journal_entry_balanced` |
| Un período cerrado bloquea asientos | `journal_entry_period_open` |
| Un asiento contabilizado no se edita: se reversa | `journal_lines_locked*` |
| Cambios de etapa y de ETA de importaciones quedan registrados | `imports_stage_log`, `imports_eta_log` |
| Normativa siempre con fuente y vigencia válida | `CHECK` en `rule_values` |
| Un servicio no lleva stock | `CHECK` en `products` |
| Auditoría inalterable | Triggers de solo inserción + hash encadenado |

## 5. Stock real (`v_stock_position`)

| Columna | Definición |
|---|---|
| `on_hand_milli` | Suma de `stock_balances` (disponible físico) |
| `reserved_milli` | Reservas activas de notas de venta / pedidos |
| `in_purchase_milli` | Pendiente de órdenes de compra **nacionales** abiertas |
| `in_import_milli` | Pendiente de importaciones reales (no escenarios) entre ORDENADA y TRANSPORTE LOCAL |
| `in_transit_milli` | Subconjunto de lo anterior en EMBARCADA o EN TRÁNSITO |
| `in_receiving_milli` | Recibido en recepciones pendientes de confirmar |

**Regla para no contar dos veces:** al registrar una recepción *pendiente* se actualiza `received_milli`
de la orden o importación; el movimiento de stock se crea recién al *confirmar* la recepción.

Las fórmulas derivadas (disponible real, stock futuro, cobertura, quiebre, reorden) están en
`nucleo-domain::inventory` y probadas con los casos golden.

**Costo promedio:** se lleva **por producto** (global, no por bodega), más simple para una pyme.

## 6. Capa analítica (ADR-018)

| Tabla | Grano | Uso |
|---|---|---|
| `fact_sales_day` | día × sucursal | Ventas de hoy, del mes, serie de 12 meses del dashboard |
| `fact_sales_daily` | producto × día × sucursal | Top productos, evolución, matriz, detenidos, velocidad |
| `fact_customer_monthly` | cliente × mes | Ficha inteligente, frecuencia, riesgo de pérdida |
| `stock_daily_snapshot` | producto × bodega × día | Días con stock (velocidad), evolución del stock |

Se actualizan en la misma transacción de cada venta y se pueden reconstruir desde las tablas de origen.

## 7. Rendimiento medido (Fase 2)

Base generada con `cargo run --release -p nucleo-tools --bin seed -- <ruta> 1.0`:
**100.000 clientes · 100.000 productos · 300.000 ventas · 900.000 líneas · 1.000.000 de movimientos**,
cifrada, 436 MB. Equipo de medición: contenedor Linux de 2 núcleos (Xeon 2,1 GHz), más lento que el
equipo de referencia del MVP. Resultados de `bench` (25 ejecuciones por consulta):

| Consulta | p95 | Meta |
|---|---|---|
| Búsqueda global de clientes ("perez") | 63 ms | 300 ms |
| Búsqueda de clientes por RUT parcial | 3 ms | 300 ms |
| Búsqueda de productos ("taladro mak") | 17 ms | 300 ms |
| Lista de clientes, página 1.000 | 0,1 ms | 500 ms |
| Lista de productos con stock | 0,1 ms | 500 ms |
| Kárdex de un producto | < 0,1 ms | 500 ms |
| Stock real de 50 productos | 0,1 ms | 500 ms |
| **Dashboard del dueño** (10 consultas) | **318 ms** | 1.000 ms |
| Evolución 12 meses de un producto | < 0,1 ms | 500 ms |
| Ficha inteligente de un cliente | < 0,1 ms | 300 ms |
| Inventario detenido > 90 días valorizado (10.455 productos) | 307 ms | 1.000 ms |
| Ventas pendientes de documentación | < 0,1 ms | 300 ms |

**Hallazgo corregido:** la serie de 12 meses del dashboard tardaba **~14 s** leyendo `fact_sales_daily`.
Se agregó `fact_sales_day` (totales por día) y un índice cubriente; el dashboard completo bajó a ~0,3 s.

**Pendiente (Fase 12):** con la caché del disco fría, la primera apertura del dashboard tomó ~1,3 s en
este equipo. El dashboard se cargará por bloques (primero "Hoy" y "Este mes") y los contadores de
"Atención" se precalcularán en `insights`.

## 8. Pendientes del modelo

- Plantilla base del plan de cuentas y de `posting_rules` (Fase 10, con el contador colaborador).
- Tablas de promociones, segmentos y fidelidad (V1.1 y V1.2): `sale_item_adjustments` ya registra el
  origen de cada descuento para que la analítica tenga historia desde el primer día.
- Remuneraciones y activos fijos (V2).
