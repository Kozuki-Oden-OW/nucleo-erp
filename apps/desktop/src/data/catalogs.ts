// Catálogos de la interfaz (editables desde Configuración en la Fase 4).
export const PAYMENT_METHODS = ["Efectivo", "Transferencia", "Tarjeta de débito", "Tarjeta de crédito", "Cheque"];
/** Tipos de documento tributario EXTERNO que el usuario puede anotar como referencia. NÚCLEO no los emite. */
export const EXTERNAL_DOC_KINDS = ["Factura", "Boleta", "Factura exenta", "Guía de despacho", "Otro"];
/** Unidades de medida (mismas que la tabla `units` de la base). */
export const UNITS = [
  { value: "un", label: "Unidad (un)" }, { value: "kg", label: "Kilogramo (kg)" }, { value: "gr", label: "Gramo (gr)" },
  { value: "lt", label: "Litro (lt)" }, { value: "m", label: "Metro (m)" }, { value: "m2", label: "Metro cuadrado (m2)" },
  { value: "cj", label: "Caja (cj)" }, { value: "hr", label: "Hora (hr)" }, { value: "sv", label: "Servicio (sv)" },
];
