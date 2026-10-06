# Diseño UX — NÚCLEO ERP (Fase 3)

Sistema de diseño, patrones de interacción y protocolo de la prueba de usabilidad. Complementa el
Blueprint §4 (navegación) y §7 (flujos). El código vive en `apps/desktop/src/ui` y `apps/desktop/src/shell`.

## 1. Principios

1. **Lenguaje del dueño, no del contador.** "Dinero que te deben" antes que "Deudores por venta". La vista
   Contador cambia las palabras, nunca los permisos (glosario dual en `src/lib/glosario.ts`).
2. **Teclado primero.** Un ERP se usa ocho horas al día: todo flujo frecuente se completa sin mouse.
3. **Convertir, no re-digitar.** Cada documento muestra su cadena (COT → VEN → PAG → referencia externa).
4. **Detalle sin perder el contexto.** Fichas en paneles laterales; la lista queda detrás.
5. **Errores que explican qué hacer.** "El RUT no es válido: revisa el dígito verificador", nunca un código.
6. **Honestidad tributaria visible.** Todo documento interno lleva "DOCUMENTO INTERNO — NO TRIBUTARIO";
   el IVA se rotula "informativo" y la tasa muestra su fuente normativa.
7. **Nada se borra a escondidas.** Anular exige motivo y queda en la auditoría.

## 2. Tokens (`src/styles.css`)

| Grupo | Tokens | Notas |
|---|---|---|
| Marca | `--brand` #001a3c · `--accent` #00788f (claro) / #3cc8df (oscuro) · verde de marca en el logo | El turquesa del logo (#0090aa) se oscurece a #00788f en texto para cumplir contraste AA |
| Superficies | `--bg`, `--surface`, `--surface-2`, `--surface-3`, `--border`, `--border-strong` | Tres niveles de superficie; bordes de 1 px |
| Texto | `--text`, `--text-muted`, `--text-faint` | Nunca texto en color de serie de gráfico |
| Estado | `success`, `warning`, `danger`, `info` + variantes `*-soft` | Siempre con ícono + palabra, nunca solo color |
| Gráficos | `--chart-1` (#0090aa claro / #2a9bb2 oscuro), `--chart-grid` | Validados con el verificador de paletas (banda de luminosidad, croma, contraste ≥ 3:1) |
| Forma | `--radius-sm` 6 · `--radius` 10 · `--radius-lg` 14 | Tarjetas 12 px, controles 8 px |
| Densidad | `--ctl-h` 36/30 px · `--row-h` 40/32 px | "Cómoda" o "Compacta" en Configuración → Apariencia |

Tema claro por defecto, oscuro por preferencia de Windows o por elección (`data-theme`). Tipografía del
sistema (Segoe UI Variable) para no cargar fuentes externas; cifras con `tabular-nums`.

## 3. Componentes

| Componente | Archivo | Uso |
|---|---|---|
| `Button`, `IconButton`, `Kbd` | `ui/kit.tsx` | 5 variantes (primary, secondary, ghost, subtle, danger) y 3 tamaños; atajo visible con `kbd` |
| `Field`, `Select`, `TextArea`, `Checkbox`, `Segmented` | `ui/kit.tsx` | Etiqueta, "(opcional)", ayuda y error accesible (`role="alert"`) |
| `MoneyField` | `ui/doc.tsx` | Digitar "49990" o "49.990"; muestra "$ 49.990"; soporta USD |
| `Card`, `PageHeader`, `Kpi`, `DefinitionList`, `Tabs`, `Badge`, `Notice`, `EmptyState`, `Spinner` | `ui/kit.tsx` | Estructura y estados |
| `DataTable` | `ui/table.tsx` | Teclado (↑ ↓ Enter), encabezado fijo, virtualización desde 150 filas, desplazamiento horizontal en pantallas angostas |
| `Drawer`, `Dialog`, `ToastProvider` | `ui/overlay.tsx` | Foco atrapado, Esc para cerrar, foco devuelto al origen |
| `BarChart` | `ui/BarChart.tsx` | Una serie, columnas ≤ 24 px con extremo redondeado, tooltip con mouse o teclado, vista de tabla |
| `SaleStatus`, `QuoteStatusBadge`, `DocChain` | `ui/doc.tsx` | Estados de venta en tres ejes y cadena documental navegable |
| `CommandPalette` | `shell/CommandPalette.tsx` | Ctrl+K: busca registros y ejecuta acciones |
| `AppShell` | `shell/AppShell.tsx` | Menú lateral por perfil, barra superior, alertas, vista Simple/Contador, tema |

## 4. Estructura de pantalla y navegación

```
┌ Menú lateral ─────┬ Barra: [Buscar o hacer cualquier cosa… Ctrl K]  [+ Nueva venta] [Simple|Contador] [tema] [🔔] ┐
│ Negocio ▾ / perfil│                                                                                              │
│ Inicio            │  Área de trabajo: lista · ficha · formulario (máx. 1280 px)                                  │
│ Vender …          │  Paneles laterales para detalle; diálogos solo para confirmar una acción                     │
│ Más módulos (n)   │                                                                                              │
│ Mi negocio        │                                                                                              │
│ Configuración     │                                                                                              │
└───────────────────┴──────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Perfil → menú:** Emprendedor, Negocio y Empresa muestran módulos distintos por defecto (`shell/nav.ts`);
  "Más módulos" permite mostrar cualquiera sin cambiar de perfil.
- **Módulos aún no construidos** aparecen con su fase ("Fase 7") y una pantalla que explica qué traerán.
- Bajo 1.200 px de ancho el menú se contrae solo (íconos); `Ctrl+B` lo alterna.

### Atajos

| Atajo | Acción |
|---|---|
| `Ctrl+K` | Buscar o ejecutar cualquier cosa |
| `Alt+N` | Nueva venta |
| `Ctrl+Enter` | Guardar el documento que se está digitando |
| `Ctrl+B` | Contraer o expandir el menú |
| `↑ ↓ Enter` | Moverse y abrir en listas y buscadores |
| `Esc` | Cerrar panel, diálogo o paleta |

## 5. Patrones clave

### Digitar un documento (cotización, venta, factura interna)

`Cliente (buscar o crear) → producto: escribir parte del nombre + Enter → cantidad + Enter → siguiente producto → Ctrl+Enter`.
Si se presiona Enter antes de que lleguen los resultados, se elige el primero cuando llegan (nunca se crea
una línea libre por accidente). El resumen calcula al instante; el valor oficial lo calcula y guarda Rust.

### Ciclo de venta (Blueprint §7.1–7.3)

`Cotización → "Cliente aceptó" → "Convertir en venta" → "Venta efectuada" (contado o crédito) → pagos/abonos → "Marcar como documentada" → Cerrada (automática)`.

Una sola etiqueta muestra el estado más relevante por eje (pago y documentación). La alerta de
documentación ofrece **Marcar como documentada · Recordármelo después · No aplica**. Todos los campos de la
referencia externa son opcionales.

### Impresión

Cotización, comprobante de venta y factura interna se imprimen (o se guardan en PDF desde el diálogo de
impresión de Windows) con la leyenda fija en el encabezado y en el pie. La tipografía de impresión es
negra sobre blanco, sin colores de pantalla.

## 6. Accesibilidad

Contraste AA en texto, foco visible en todo control, navegación completa con teclado, diálogos con foco
atrapado, listas con roles `grid`/`listbox`, gráficos con etiqueta y vista de tabla, estados con ícono y
texto, animaciones desactivadas con `prefers-reduced-motion`.

## 7. Demostración navegable

La misma interfaz corre en un navegador con el **backend de demostración** (`src/data/demo`): una ferretería
ficticia con 35 clientes, 38 productos, 70 ventas, cotizaciones y órdenes de compra, en memoria. Nada se
guarda. El escritorio puede abrirla desde "Explorar con datos de ejemplo". Las pantallas solo conocen el
puerto `Backend` (`src/data/backend.ts`); cuando un comando Rust existe, la pantalla del prototipo pasa a
ser la pantalla real sin rehacerla.

## 8. Prueba de usabilidad (criterio de salida de la Fase 3)

**Participantes:** 3 a 5 personas que administran un negocio pequeño y **no son contadores**. Idealmente
mezcla de perfiles (alguien que empieza, alguien con local, alguien que importa).

**Formato:** 30–40 minutos por persona, presencial o por videollamada compartiendo pantalla. Se usa la
demostración en el navegador. El facilitador **no ayuda**: si la persona pregunta, responde "¿qué harías
tú?". Se pide pensar en voz alta.

**Antes de empezar (leer en voz alta):** "Vamos a probar el programa, no a ti. No hay respuestas malas.
Si algo te confunde, es un problema del programa y eso es justo lo que buscamos."

| # | Tarea (se lee tal cual) | Éxito si… | Tiempo meta |
|---|---|---|---|
| 1 | "Llegó un cliente nuevo: Rosa Gálvez, RUT 15.555.555-6, correo rosa@ejemplo.cl. Regístralo." | Cliente creado con RUT válido | 1 min |
| 2 | "Constructora Sur te pidió precio por 3 taladros inalámbricos de 18 V y 40 sacos de cemento. Prepárale una cotización." | Cotización guardada con esas 2 líneas y cantidades | 3 min |
| 3 | "Constructora Sur aceptó la cotización que le enviaste hace unos días (la que ya figura como aceptada). Conviértela en venta y regístrala: te pagarán a 30 días." | Venta efectuada a crédito desde la COT, sin re-digitar | 3 min |
| 4 | "Hoy te transfirieron la mitad de esa venta. Regístralo." | Abono registrado; saldo correcto | 2 min |
| 5 | "Ya emitiste la factura Nº 563 en el sistema oficial. Anótalo en NÚCLEO." | Venta marcada como documentada con el número | 1 min |
| 6 | "¿Cuánto dinero te deben en total y cuánto está atrasado?" | Responde con las cifras del Inicio o de Por cobrar | 1 min |
| 7 | "¿Qué productos tienes que reponer pronto?" | Nombra al menos 2 productos con poco stock | 1 min |
| 8 | "Quieres importar taladros desde China. ¿Qué es más barato: marítimo, aéreo o courier? ¿Cuánto te cuesta cada taladro puesto en tu bodega?" | Identifica el escenario más barato y lee el costo unitario | 3 min |

**Qué registrar por tarea:** completada sin ayuda / con ayuda / no completada; tiempo; errores (clics en
lugares equivocados, vueltas atrás); frases textuales de duda o satisfacción.

**Al final (escala 1 a 5):**
1. Fue fácil encontrar lo que buscaba.
2. Entendí los nombres y las palabras que usa el programa.
3. Me sentiría seguro registrando las ventas reales de mi negocio aquí.
4. Quedó claro que NÚCLEO no emite facturas ni se conecta con el SII.
5. Recomendaría este programa a otro emprendedor.

Y dos preguntas abiertas: "¿Qué fue lo más confuso?" y "¿Qué te gustaría que hiciera y no hace?".

**Criterio de aprobación:** al menos 4 de 5 participantes completan sin ayuda las tareas 2, 3, 4 y 6, y la
pregunta 4 promedia 4 o más. Cada problema observado en 2 o más personas se corrige antes de la Fase 5.

**Plantilla de resultados:** una fila por participante y tarea en `docs/usabilidad/AAAA-MM-DD.md`
(participante anónimo P1…P5, perfil, resultado, tiempo, observaciones).
