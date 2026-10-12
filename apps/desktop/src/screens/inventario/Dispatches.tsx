// Productos por despachar: ventas de productos con reservas. Lo que hay en bodega queda apartado
// para el pedido más antiguo; lo que falta queda pendiente hasta que llegue el stock.
import { useEffect, useMemo, useState } from "react";
import { PackageCheck, Truck } from "lucide-react";
import { useBackend, errorMessage, type PendingDispatch } from "../../data";
import { formatDate, formatQty, parseQty, todayIso } from "../../lib/format";
import { navigate } from "../../lib/router";
import { useSession } from "../../lib/session";
import { Badge, Button, EmptyState, Field, Kpi, Notice, Spinner } from "../../ui/kit";
import { Dialog, useToast } from "../../ui/overlay";
import { DataTable, type Column } from "../../ui/table";

export function DispatchStatus({ d }: { d: PendingDispatch }) {
  if (d.missing_milli === 0) return <Badge tone="success">Listo para despachar</Badge>;
  if (d.reserved_milli > 0) return <Badge tone="warning">Apartado {formatQty(d.reserved_milli)} · faltan {formatQty(d.missing_milli)}</Badge>;
  return <Badge tone="danger">Falta stock</Badge>;
}

export function Dispatches({ onCount }: { onCount?: (n: number) => void }) {
  const backend = useBackend();
  const { can } = useSession();
  const [rows, setRows] = useState<PendingDispatch[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [doing, setDoing] = useState<PendingDispatch | null>(null);
  useEffect(() => { backend.pendingDispatches().then((r) => { setRows(r); onCount?.(r.length); }).catch((e) => setErr(errorMessage(e))); }, [backend]); // eslint-disable-line react-hooks/exhaustive-deps
  const totals = useMemo(() => ({
    ready: rows?.filter((r) => r.missing_milli === 0).length ?? 0,
    waiting: rows?.filter((r) => r.missing_milli > 0).length ?? 0,
  }), [rows]);
  if (err) return <Notice tone="danger">{err}</Notice>;
  if (!rows) return <Spinner />;

  const cols: Column<PendingDispatch>[] = [
    { key: "v", header: "Venta", width: "8rem", render: (d) => <span className="flex flex-col"><span className="font-mono text-[12.5px]">{d.sale_number}</span><span className="num text-xs text-muted">{formatDate(d.issue_date)}</span></span> },
    { key: "c", header: "Cliente", render: (d) => <span className="text-ink">{d.customer ?? "Cliente ocasional"}</span> },
    { key: "p", header: "Producto", render: (d) => <span className="flex flex-col"><span className="font-medium text-ink">{d.product_name}</span><span className="font-mono text-xs text-muted">{d.sku}</span></span> },
    { key: "n", header: "Por despachar", width: "9rem", align: "right", render: (d) => <span className="flex flex-col items-end"><span className="num font-medium">{formatQty(d.pending_milli)} {d.unit}</span><span className="num text-xs text-muted">de {formatQty(d.ordered_milli)} vendidos</span></span> },
    { key: "e", header: "Estado", width: "12.5rem", render: (d) => <DispatchStatus d={d} /> },
    ...(can("ventas.efectuar") ? [{ key: "a", header: "", width: "8.5rem", align: "right" as const, render: (d: PendingDispatch) => (
      <Button size="sm" icon={Truck} disabled={d.reserved_milli === 0} onClick={(e) => { e.stopPropagation(); setDoing(d); }}>Despachar</Button>
    ) }] : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi label="Pedidos por despachar" value={String(rows.length)} />
        <Kpi label="Listos para despachar" value={String(totals.ready)} tone={totals.ready ? "success" : undefined} hint="Hay stock para entregarlos completos" />
        <Kpi label="Esperando stock" value={String(totals.waiting)} tone={totals.waiting ? "warning" : undefined} hint="Falta todo o parte" />
      </div>
      <p className="text-sm text-muted">
        Aquí llegan las ventas de productos que <strong className="font-medium text-ink">toman reservas</strong> (se elige en la ficha del producto).
        El stock que hay se aparta para el pedido más antiguo; se descuenta de la bodega cuando despachas.
      </p>
      <DataTable label="Por despachar" columns={cols} rows={rows} rowKey={(d) => String(d.id)} onOpen={(d) => navigate(`/ventas/${d.sale_uid}`)}
        empty={<EmptyState icon={PackageCheck} title="Nada por despachar">Cuando vendas un producto que toma reservas, aparecerá aquí hasta que lo entregues.</EmptyState>} />
      {doing && <DispatchDialog d={doing} onClose={() => setDoing(null)} onDone={(r) => { setRows(r); onCount?.(r.length); setDoing(null); }} />}
    </div>
  );
}

export function DispatchDialog({ d, onClose, onDone }: { d: PendingDispatch; onClose: () => void; onDone: (rows: PendingDispatch[]) => void }) {
  const backend = useBackend();
  const toast = useToast();
  const [qty, setQty] = useState(formatQty(Math.min(d.pending_milli, d.reserved_milli || d.pending_milli)));
  const [date, setDate] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function go() {
    const q = parseQty(qty);
    if (q === null || q <= 0) { setErr("Escribe la cantidad a despachar."); return; }
    setBusy(true); setErr(null);
    try {
      const rows = await backend.dispatchItems(d.id, q, date);
      toast("success", `Despachado ${formatQty(q)} ${d.unit} de ${d.product_name}.`);
      onDone(rows);
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open onClose={onClose} title={`Despachar ${d.sale_number}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button icon={Truck} onClick={go} disabled={busy}>{busy ? "Guardando…" : "Despachar"}</Button></>}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          {d.product_name} para <strong className="text-ink">{d.customer ?? "cliente ocasional"}</strong>: faltan despachar {formatQty(d.pending_milli)} {d.unit}
          {" "}y hay {formatQty(d.reserved_milli)} apartados en bodega. Al despachar se descuenta del stock.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Cantidad a despachar" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} suffix={d.unit} inputClassName="text-right num" data-autofocus />
          <Field label="Fecha" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        {err && <Notice tone="danger">{err}</Notice>}
      </div>
    </Dialog>
  );
}
