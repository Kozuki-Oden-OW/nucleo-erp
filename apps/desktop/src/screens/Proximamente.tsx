import { Hammer } from "lucide-react";
import { NAV, NAV_FOOTER } from "../shell/nav";
import { EmptyState } from "../ui/kit";

const WHAT: Record<string, string> = {
  inventario: "Stock por bodega, kárdex, costo promedio, ajustes, transferencias, stock real y futuro, velocidad de venta y punto de reorden.",
  dinero: "Cuentas por cobrar y por pagar, cobros y pagos, bancos y cajas, gastos, calendario y flujo de caja a 7, 30, 60 y 90 días.",
  contabilidad: "Plan de cuentas, asientos automáticos que siempre cuadran, libros y estados financieros para tu contador.",
  analisis: "Productos estrella y detenidos, clientes en riesgo de perderse, rentabilidad y reportes exportables.",
  documentos: "Repositorio de documentos y adjuntos cifrados, vinculados a clientes, ventas y compras.",
  vender: "Cotizaciones, ventas, facturas internas y el ciclo completo hasta “documentada”.",
  productos: "Productos y servicios con precio, costo y margen.",
  comprar: "Solicitudes, comparador de proveedores, órdenes de compra y recepciones.",
  comex: "Calculadora de importación, escenarios y carpetas de importación con etapas y ETA.",
  inicio: "El resumen de tu negocio: ventas, utilidad, dinero disponible y lo que requiere tu atención.",
  negocio: "Datos del negocio, perfil y preferencias de documentación.",
};

export function Proximamente({ id }: { id: string }) {
  const item = [...NAV, ...NAV_FOOTER].find((n) => n.id === id);
  return (
    <div className="anim-in mx-auto max-w-xl pt-10">
      <EmptyState icon={Hammer} title={`${item?.label ?? "Este módulo"} llega en la Fase ${item?.phase ?? "siguiente"}`}>
        {WHAT[id] ?? "Lo estamos construyendo."} Puedes ver cómo funcionará en la demostración de www.nucleoerp.cl.
      </EmptyState>
    </div>
  );
}
