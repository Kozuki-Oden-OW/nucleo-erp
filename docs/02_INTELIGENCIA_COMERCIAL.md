# NÚCLEO ERP — Inteligencia comercial y gestión avanzada

*Especificación del dueño del producto (2026-10-05). Complementa `01_VISION_PRODUCTO.md`. El diseño técnico correspondiente está en `00_BLUEPRINT_MAESTRO.md` §19.*

NÚCLEO ERP no debe limitarse a registrar información: debe **transformar los datos del negocio en decisiones útiles**. Una persona debe poder abrir el programa y saber:

- qué productos está vendiendo más;
- cuáles le dejan más utilidad;
- cuáles están detenidos;
- qué debe volver a comprar;
- qué productos vienen en camino;
- cuándo llegará una importación;
- cuáles clientes compran más;
- qué clientes están dejando de comprar;
- qué promoción funcionó mejor;
- qué productos conviene promocionar;
- cuánto stock tendrá dentro de 30, 60 o 90 días.

El software debe actuar como un verdadero **asistente de gestión empresarial**.

---

## A. Promociones

### 1. Motor de promociones

Módulo **PROMOCIONES**. Permite crear promociones **sin modificar manualmente los precios de los productos**.

| Tipo | Ejemplo |
|---|---|
| Descuento porcentual | 20% de descuento |
| Descuento fijo | Producto $15.000 → promoción $12.990 |
| 2x1 | Compra 2 y paga 1 |
| 3x2 | Compra 3 y paga 2 |
| Combos | Producto A + Producto B: precio normal $35.000 → combo $29.990 |
| Descuento por cantidad | 1 unidad $10.000 · 5 unidades $9.500 c/u · 10 unidades $8.900 c/u |
| Producto regalo | Compra Producto A, recibe Producto B |
| Por cliente | Clientes VIP: 15% de descuento |
| Por categoría | 20% en la categoría Herramientas |
| Por fecha | Inicio 01/12/2026 · Fin 24/12/2026 |
| Por horario | Happy Hour |
| Cupones | VERANO20 · BIENVENIDO · CLIENTEVIP |

### 2. Analítica de promociones

Cada promoción debe mostrar posteriormente: ventas generadas, unidades vendidas, ingresos, descuento entregado, utilidad, margen, clientes nuevos y clientes recurrentes.

El sistema debe responder: **¿Esta promoción realmente aumentó mis ganancias?** No asumir que vender más significa ganar más.

---

## B. Fidelización y clientes

### 3. NÚCLEO FIDELIDAD

Programa de fidelización **opcional**, activable por el usuario. Todo se almacena localmente.

### 4. Sistema de puntos

Ejemplo: cada $1.000 de compra = 1 punto. El negocio configura libremente cuánto vale cada punto, cómo se obtienen, cómo se canjean, su vencimiento, productos excluidos y promociones especiales.

### 5. Niveles de clientes

| Nivel | Ejemplo de condición |
|---|---|
| Bronce | Cliente nuevo |
| Plata | $300.000 en compras acumuladas |
| Oro | $1.000.000 |
| VIP | $3.000.000 |

Todos los parámetros son configurables.

### 6. Beneficios por nivel

Ejemplo VIP: 5% de descuento permanente, acceso anticipado a promociones, productos exclusivos, precio especial, regalo de cumpleaños. Todo configurable por el negocio.

### 7. Ficha inteligente del cliente

Total comprado, número de compras, última compra, compra promedio, productos favoritos, categorías favoritas, margen generado, puntos, nivel, deuda y frecuencia de compra.

### 8. Clientes importantes

Detección automática de: mejores clientes, clientes frecuentes, clientes de alto valor, clientes nuevos, clientes inactivos y clientes que están dejando de comprar.

Ejemplo: *Juan Pérez compraba cada 25 días y lleva 72 días sin comprar* → alerta **CLIENTE EN RIESGO DE PÉRDIDA**.

### 9. Segmentación de clientes

Segmentos: VIP, mayoristas, nuevos, frecuentes, inactivos, alto valor, bajo margen, empresas, personas. Se usan después para promociones, descuentos, campañas y análisis.

---

## C. Inteligencia de productos

### 10. Análisis de productos

Cada producto muestra: unidades vendidas, ventas $, utilidad $, margen %, rotación, stock, días de inventario, última venta, última compra, costo promedio, precio promedio y rentabilidad.

### 11. Productos estrella

Identificación automática de productos destacados, **sin usar solamente la cantidad vendida**. Considerar ventas, utilidad, margen, frecuencia, rotación y estabilidad.

Ejemplo — ⭐ **PRODUCTOS ESTRELLA:** Producto A · Ventas $5.400.000 · Utilidad $1.850.000 · Margen 34% · Rotación alta.

### 12. Matriz de productos

| Clase | Criterio |
|---|---|
| **Estrella** | Alta venta + alto margen |
| **Volumen** | Alta venta + bajo margen |
| **Joya** | Baja venta + alto margen |
| **Problema** | Baja venta + bajo margen |

### 13. Productos sin movimiento

Detectar productos con 30, 60, 90, 180 y 365 días sin vender. Mostrar **INVENTARIO DETENIDO — Valor total: $X** y sugerir posibles acciones: promoción, combo, descuento, liquidación, reducir futuras compras.

### 14. Gráficos de productos

Top 10 productos; top por ventas, por utilidad, por margen y por unidades; productos con mayor crecimiento; productos que están cayendo; productos sin movimiento.

### 15. Evolución de producto

Para cualquier producto, gráfico de 12 meses con ventas mensuales, unidades, precio promedio, costo promedio, margen y stock. Permitir comparar períodos.

---

## D. Inventario real y proyectado

### 16. Tipos de stock

No todo inventario corresponde a productos físicamente disponibles.

| Tipo | Significado |
|---|---|
| Stock disponible | Producto físicamente disponible para vender |
| Stock reservado | Comprometido en ventas o pedidos |
| Stock en compra | Comprado a proveedores nacionales, todavía no recibido |
| Stock en importación | Comprado internacionalmente, todavía no disponible |
| Stock en tránsito | Enviado por el proveedor |
| Stock en recepción | Recibido, pendiente de ingreso definitivo |

### 17. Inventario de compras

Ejemplo: Producto A · stock actual 20 · orden de compra 100 → **Disponible 20 · En compra 100 · Stock futuro 120**.

### 18. Inventario de importación

Una importación puede tardar semanas o meses; el sistema debe permitir conocer desde hoy el inventario futuro.

Ejemplo: Cafetera X · stock actual 23 · importación 500 unidades · estado EN TRÁNSITO · llegada estimada 15 de diciembre → **Disponible 23 · Reservado 5 · En importación 500 · Disponible real 18 · Stock futuro 518**.

### 19. Etapas de una importación

COTIZACIÓN → ORDENADA → PAGADA → PRODUCCIÓN → LISTA PARA DESPACHO → EMBARCADA → EN TRÁNSITO → ARRIBADA → EN PROCESO DE INTERNACIÓN → TRANSPORTE LOCAL → RECIBIDA → CERRADA.

### 20. ETA de importaciones

Registrar fecha de compra, fecha estimada de producción, fecha de embarque, ETA, fecha real de llegada y fecha de recepción. Las fechas se pueden modificar durante el proceso.

### 21. Timeline de importación

COMPRA → PRODUCCIÓN → EMBARQUE → TRÁNSITO → ARRIBO → RECEPCIÓN → INVENTARIO, mostrado visualmente.

### 22. Inventario proyectado

**STOCK FUTURO** a: hoy, 7, 30, 60 y 90 días. Considera stock actual + compras pendientes + importaciones pendientes − reservas − ventas proyectadas.

### 23. Riesgo de quiebre de stock

Ejemplo: *Con tu velocidad actual de ventas, este producto se agotará aproximadamente en 18 días. Próxima importación estimada en 43 días.* → **⚠ RIESGO DE QUIEBRE DE STOCK: 25 DÍAS.** Mucho más útil que mostrar "quedan 20 unidades".

### 24. Velocidad de venta

Ventas por día, por semana y por mes. Ejemplo: Producto A · stock 150 unidades · venta promedio 5/día · **cobertura 30 días**.

### 25. Punto de reorden

Recomendación **COMPRAR NUEVAMENTE** considerando velocidad de venta, stock, stock reservado, compras pendientes, importaciones, tiempo promedio del proveedor, tiempo de transporte y stock de seguridad.

### 26. Planificación de compras — "¿Qué debo comprar?"

Ejemplo: Producto A: comprar 200 · Producto B: no comprar · Producto C: comprar 50 · Producto D: exceso de inventario. **Las recomendaciones deben mostrar siempre el cálculo utilizado.**

---

## E. Proveedores

### 27. Análisis de proveedores

Por precio, tiempo de entrega, cumplimiento, calidad, frecuencia y variación de precio.

### 28. Precio histórico

Para cada producto comprado: proveedor, fecha, cantidad y precio, con gráfico **EVOLUCIÓN DEL COSTO**. Detectar, por ejemplo: *Este proveedor aumentó el producto un 18% durante los últimos 6 meses.*

### 29. Comparador de proveedores

| Opción | Precio | Entrega |
|---|---|---|
| Proveedor Chile A | $10.000 | 2 días |
| Proveedor Chile B | $9.000 | 10 días |
| Importación | $6.000 estimado | 65 días |

NÚCLEO ayuda a comparar precio, plazo, stock necesario, capital inmovilizado y riesgo de quiebre.

---

## F. Capital y rentabilidad

### 30. Inventario valorizado

Valor de inventario actual, valor reservado, valor en compras pendientes, valor en importaciones y valor total futuro: cuánto capital está invertido en mercadería.

### 31. Capital inmovilizado

Ejemplo: *Actualmente tienes $18.500.000 invertidos en inventario* → stock activo $12.000.000 · stock lento $4.000.000 · stock sin movimiento $2.500.000.

### 32. Rentabilidad por producto

No confundir **ventas** con **utilidad**. Producto A: ventas $10 millones, utilidad $500.000. Producto B: ventas $4 millones, utilidad $1.600.000. NÚCLEO debe destacar que **B genera más beneficio aunque venda menos**.

### 33. Rentabilidad por cliente

Algunos clientes compran mucho pero generan poco margen. Mostrar cliente, ventas, descuentos, costos, utilidad y margen.

### 34. Rentabilidad por promoción

Ejemplo — promoción 2x1: ventas generadas $1.500.000 · costo $900.000 · descuentos $300.000 · utilidad $300.000. **Comparar contra un período normal.**

---

## G. Tableros

### 35. Dashboard del dueño

Pantalla para quien administra el negocio, que responde **en menos de 30 segundos**:

- **HOY:** ventas $, utilidad estimada, caja, número de ventas, número de clientes.
- **ESTE MES:** ventas, compras, gastos, utilidad, margen.
- **ATENCIÓN:** 3 clientes deben dinero · 4 productos están por agotarse · 2 importaciones en tránsito · 1 proveedor aumentó precios · 8 productos llevan más de 90 días sin vender.

### 36. Centro de oportunidades

Sección **OPORTUNIDADES**, por ejemplo:

- ⭐ Producto A está creciendo 30%.
- 💰 Producto B tiene un margen de 48%.
- 📦 Producto C podría quedarse sin stock.
- 📉 Producto D lleva 120 días sin vender.
- 👤 Cliente X lleva 60 días sin comprar.
- 🛒 Proveedor Y redujo su precio.
- 🚢 Importación Z llegará aproximadamente en 14 días.
- 🎯 La promoción AB aumentó ventas un 32%.

NÚCLEO no solo muestra datos: ayuda al usuario a descubrir qué hacer con ellos.

### 37. Principio general

Cada módulo debe responder, en este orden:

1. **¿Qué está pasando?**
2. **¿Por qué está pasando?**
3. **¿Qué debería revisar?**

**No entregar recomendaciones automáticas sin mostrar los datos que las justifican.**

---

## Visión actualizada

NÚCLEO ERP evoluciona desde un software administrativo hacia un **SISTEMA OPERATIVO DEL NEGOCIO**, que integra ventas, compras, clientes, fidelización, promociones, inventario, importaciones, proveedores, productos, caja, finanzas, rentabilidad, COMEX, analítica y planificación.

Su propósito no es únicamente registrar lo que ya ocurrió, sino ayudar al empresario a entender **qué ocurrió, qué está ocurriendo y qué probablemente necesitará hacer después**.
