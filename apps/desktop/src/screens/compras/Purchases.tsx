// Prototipo de compras (Fase 3). El módulo completo llega en la Fase 6: solicitudes, comparador de
// cotizaciones de proveedores, órdenes de compra, recepciones parciales y documentos de compra.
import { useEffect, useState } from "react";
import { PackageCheck, ShoppingCart } from "lucide-react";
import { useBackend, errorMessage, type PurchaseOrderDetail, type PurchaseOrderSummary } from "../../data";
import { formatDate, formatMoney, formatQty } from "../../lib/format";
import { navigate, type Route } from "../../lib/router";
import { Badge, Button, EmptyState, Notice, PageHeader, Spinner, type Tone } from "../../ui/kit";
import { Drawer, useToast } from "../../ui/overlay";
import { DataTable, type Column } from "../../ui/table";

const PO_STATUS: Record<PurchaseOrderSummary["status"], [Tone, string]> = {
  borrador: ["info", "Borrador"], emitida: ["accent", "Emitida · por recibir"], parcial: ["warning", "Recibida en parte"], recibida: ["success", "Recibida"], anulada: ["neutral", "Anulada"],
};

export function Purchases({ route }: { route: Route }) {
  const backend = useBackend();
  const [rows, setRows] = useState<PurchaseOrderSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const openUid = route.path[1];
  useEffect(() => { backend.listPurchaseOrders().then(setRows).catch((e) => setErr(errorMessage(e))); }, [backend, version]);

  const cols: Column<PurchaseOrderSummary>[] = [
    { key: "n", header: "Número", width: "9rem", render: (o) => <span className="font-mono text-[13px] font-medium">{o.number}</span> },
    { key: "f", header: "Fecha", width: "7rem", render: (o) => <span className="num text-muted">{formatDate(o.issue_date)}</span> },
    { key: "p", header: "Proveedor", render: (o) => o.supplier_name },
    { key: "l", header: "Llega", width: "7rem", render: (o) => <span className="num text-muted">{formatDate(o.expected_date)}</span> },
    { key: "e", header: "Estado", width: "12rem", render: (o) => { const [tone, label] = PO_STATUS[o.status]; return <Badge tone={tone}>{label}</Badge>; } },
    { key: "t", header: "Total", width: "8.5rem", align: "right", render: (o) => <span className="num font-medium">{formatMoney(o.total_minor)}</span> },
  ];

  return (
    <div className="anim-in">
      <PageHeader title="Comprar" subtitle="Órdenes de compra a tus proveedores. Al recibir, el stock y el costo promedio se actualizan solos." />
      <div className="mb-4"><Notice tone="info" title="Prototipo">Esta pantalla muestra el flujo orden de compra → recepción. Solicitudes, comparador de proveedores y documentos de compra llegan en la Fase 6.</Notice></div>
      {err && <Notice tone="danger">{err}</Notice>}
      <DataTable label="Órdenes de compra" columns={cols} rows={rows ?? []} rowKey={(o) => o.uid} onOpen={(o) => navigate(`/compras/${o.uid}`)} empty={<EmptyState icon={ShoppingCart} title="Sin órdenes de compra" />} />
      {openUid && <PoDrawer uid={openUid} onClose={() => navigate("/compras", { replace: true })} onChanged={() => setVersion((v) => v + 1)} />}
    </div>
  );
}

function PoDrawer({ uid, onClose, onChanged }: { uid: string; onClose: () => void; onChanged: () => void }) {
  const backend = useBackend();
  const toast = useToast();
  const [o, setO] = useState<PurchaseOrderDetail | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { backend.purchaseOrder(uid).then(setO).catch((e) => toast("danger", errorMessage(e))); }, [backend, uid, toast]);
  async function receive() {
    setBusy(true);
    try {
      const r = await backend.receivePurchaseOrder(uid);
      setO(r); onChanged();
      toast("success", `${r.number} recibida: stock y costo promedio actualizados.`);
    } catch (e) { toast("danger", errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Drawer
      open
      onClose={onClose}
      title={o ? `${o.number} · ${o.supplier_name}` : "Orden de compra"}
      subtitle={o ? `Emitida ${formatDate(o.issue_date)} · llega ${formatDate(o.expected_date)}` : undefined}
      width="w-[min(680px,100vw)]"
      footer={o && o.status !== "recibida" && <Button icon={PackageCheck} onClick={receive} disabled={busy}>Recibir todo en bodega</Button>}
    >
      {!o ? <Spinner /> : (
        <div className="flex flex-col gap-4">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-muted"><th className="py-2">Producto</th><th className="text-right">Pedido</th><th className="text-right">Recibido</th><th className="text-right">Costo unit.</th></tr></thead>
            <tbody>
              {o.lines.map((l, i) => (
                <tr key={i} className="border-b border-line last:border-0">
                  <td className="py-2 pr-3">{l.description}</td>
                  <td className="num text-right">{formatQty(l.qty_milli)}</td>
                  <td className={`num text-right ${l.received_milli >= l.qty_milli ? "text-success" : "text-muted"}`}>{formatQty(l.received_milli)}</td>
                  <td className="num text-right">{formatMoney(l.unit_cost_minor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="ml-auto w-64 text-sm">
            <div className="flex justify-between"><span className="text-muted">Neto</span><span className="num">{formatMoney(o.totals.net_minor)}</span></div>
            <div className="flex justify-between"><span className="text-muted">IVA (crédito estimado)</span><span className="num">{formatMoney(o.totals.tax_minor)}</span></div>
            <div className="mt-1 flex justify-between border-t border-line pt-1 font-semibold"><span>Total</span><span className="num">{formatMoney(o.totals.total_minor)}</span></div>
          </div>
        </div>
      )}
    </Drawer>
  );
}
