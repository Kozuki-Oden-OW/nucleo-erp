// Glosario dual (Blueprint §3.2): el mismo dato con lenguaje de negocio (vista Simple) o contable
// (vista Contador). La vista cambia palabras y nivel de detalle; nunca permisos.
import { usePrefs } from "./prefs";

export const GLOSARIO = {
  por_cobrar: { simple: "Dinero que te deben", contador: "Deudores por venta (CxC)" },
  por_pagar: { simple: "Dinero que debes", contador: "Proveedores (CxP)" },
  disponible: { simple: "Dinero disponible", contador: "Disponible (caja y bancos)" },
  utilidad_mes: { simple: "Utilidad estimada del mes", contador: "Resultado del período (preliminar)" },
  ventas_mes: { simple: "Ventas del mes", contador: "Ingresos por ventas del período" },
  gastos_mes: { simple: "Gastos del mes", contador: "Gastos de administración y ventas" },
  iva_estimado: { simple: "IVA estimado (informativo)", contador: "Débito − crédito fiscal (estimado)" },
  costo_venta: { simple: "Costo de lo vendido", contador: "Costo de ventas" },
  margen: { simple: "Ganancia de la venta", contador: "Margen bruto" },
  neto: { simple: "Subtotal sin impuesto", contador: "Neto afecto" },
  exento: { simple: "Sin impuesto", contador: "Exento" },
  impuesto: { simple: "IVA", contador: "IVA débito" },
  vencido: { simple: "Atrasado", contador: "Vencido" },
} as const;

export type TermKey = keyof typeof GLOSARIO;

export function useTerm(): (k: TermKey) => string {
  const { prefs } = usePrefs();
  return (k) => GLOSARIO[k][prefs.view];
}
