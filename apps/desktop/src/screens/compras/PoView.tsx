// Ficha de una orden de compra: recepción parcial o total, documentos asociados, impresión y anulación.
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Ban, FilePlus2, PackageCheck, Pencil, Printer, Send } from "lucide-react";
import { useBackend, errorMessage, type BusinessSettings, type PurchaseOrderDetail } from "../../data";
import { formatDate, formatMoney, formatQty, parseQty, todayIso } from "../../lib/format";
import { goBack, navigate } from "../../lib/router";
import { useSession } from "../../lib/session";
import { DocChain } from "../../ui/doc";
import { Button, Card, Field, Notice, PageHeader, Spinner, TextArea } from "../../ui/kit";
import { Dialog, useToast } from "../../ui/overlay";
import { AttachmentsPanel } from "../documentos/Documents";
import { PoStatusBadge } from "./common";

export function PoView({ uid }: { uid: string }) {
  const backend = useBackend();
  const toast = useToast();
  const { can } = useSession();
  const [o, setO] = useState<PurchaseOrderDetail | null>(null);
  const [biz, setBiz] = useState<BusinessSettings | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<null | "receive" | "void" | "print">(null);
  const load = useCallback(() => { backend.purchaseOrder(uid).then(setO).catch((e) => setErr(errorMessage(e))); }, [backend, uid]);
  useEffect(load, [load]);
  useEffect(() => { backend.business().then(setBiz).catch(() => {}); }, [backend]);
  if (err) return <Notice tone="danger">{err}</Notice>;
  if (!o) return <Spinner />;

  const receivable = o.status === "emitida" || o.status === "parcial";
  async function issue() {
    try { setO(await backend.issuePurchaseOrder(o!.uid)); toast("success", "Orden emitida."); } catch (e) { toast("danger", errorMessage(e)); }
  }
  const pending = o.lines.reduce((a, l) => a + Math.max(0, l.qty_milli - l.received_milli), 0);

  return (
    <>
      <PrintPo o={o} biz={biz} />
      <div className="anim-in print:hidden">
        <PageHeader
          back={<button onClick={() => goBack("/compras")} className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft size={15} /> Comprar</button>}
          title={<span className="flex flex-wrap items-center gap-3"><span className="font-mono">{o.number}</span><PoStatusBadge status={o.status} /></span>}
          subtitle={`${o.supplier_name} · ${formatDate(o.issue_date)}${o.expected_date ? ` · llegada estimada ${formatDate(o.expected_date)}` : ""}`}
          actions={
            <>
              {o.status === "borrador" && can("compras.crear") && <Button variant="secondary" icon={Pencil} onClick={() => navigate(`/compras/oc/${o.uid}/editar`)}>Editar</Button>}
              {o.status === "borrador" && can("compras.crear") && <Button icon={Send} onClick={issue}>Emitir</Button>}
              {receivable && can("compras.recibir") && <Button icon={PackageCheck} onClick={() => setOpen("receive")}>Recibir mercadería</Button>}
              {o.status !== "borrador" && o.status !== "anulada" && can("compras.crear") && <Button variant="secondary" icon={FilePlus2} onClick={() => navigate(`/compras/doc/nueva?oc=${o.uid}`)}>Registrar factura</Button>}
              {o.status !== "anulada" && <Button variant="secondary" icon={Printer} onClick={() => (backend.kind === "tauri" ? window.print() : setOpen("print"))}>Imprimir</Button>}
              {(o.status === "borrador" || o.status === "emitida") && can("compras.crear") && <Button variant="ghost" icon={Ban} onClick={() => setOpen("void")}>Anular</Button>}
            </>
          }
        />
        {o.status === "anulada" && <div className="mb-4"><Notice tone="warning" title="Orden anulada">{o.void_reason}</Notice></div>}
        {o.purchases.length > 0 && <div className="mb-4"><DocChain chain={[{ number: o.number, kind: "OC", uid: o.uid, label: "Orden de compra" }, ...o.purchases]} current={o.number} /></div>}
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex min-w-0 flex-col gap-6">
            <Card title="Productos" padded={false}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead><tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-muted"><th className="px-4 py-2.5">Descripción</th><th className="px-2 text-right">Pedido</th><th className="px-2 text-right">Recibido</th><th className="px-2 text-right">Costo unit.</th><th className="px-4 text-right">Total</th></tr></thead>
                  <tbody>
                    {o.lines.map((l) => (
                      <tr key={l.line_no} className="border-b border-line last:border-0">
                        <td className="px-4 py-2.5 text-ink">{l.description}</td>
                        <td className="num px-2 text-right">{formatQty(l.qty_milli)}</td>
                        <td className={`num px-2 text-right ${l.received_milli >= l.qty_milli ? "text-success" : l.received_milli > 0 ? "text-warning" : "text-muted"}`}>{formatQty(l.received_milli)}</td>
                        <td className="num px-2 text-right">{formatMoney(l.unit_cost_minor)}</td>
                        <td className="num px-4 text-right font-medium">{formatMoney(l.net_minor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            {o.notes && <Card title="Observaciones"><p className="whitespace-pre-wrap text-sm text-ink">{o.notes}</p></Card>}
            <AttachmentsPanel link={{ entity: "orden_compra", uid: o.uid }} />
          </div>
          <aside className="flex flex-col gap-4">
            <Card title="Totales">
              <dl className="flex flex-col gap-2 text-sm">
                {o.totals.tax_minor > 0 && <div className="flex justify-between"><dt className="text-muted">Neto</dt><dd className="num">{formatMoney(o.totals.net_minor)}</dd></div>}
                {o.totals.exempt_minor > 0 && <div className="flex justify-between"><dt className="text-muted">{o.totals.tax_minor > 0 ? "Exento" : "Subtotal"}</dt><dd className="num">{formatMoney(o.totals.exempt_minor)}</dd></div>}
                {o.totals.tax_minor > 0 && <div className="flex justify-between"><dt className="text-muted">IVA crédito (estimado)</dt><dd className="num">{formatMoney(o.totals.tax_minor)}</dd></div>}
                <div className="mt-1 flex items-baseline justify-between border-t border-line pt-2"><dt className="font-semibold">Total</dt><dd className="num text-[20px] font-semibold">{formatMoney(o.totals.total_minor)}</dd></div>
              </dl>
              {receivable && <p className="mt-3 text-xs text-muted">Pendiente por recibir: {formatQty(pending)} unidades.</p>}
            </Card>
            {o.receipts.length > 0 && (
              <Card title="Recepciones">
                <ul className="flex flex-col gap-1.5 text-sm">{o.receipts.map((r) => <li key={r.number} className="flex justify-between"><span className="font-mono text-[13px]">{r.number}</span><span className="num text-muted">{formatDate(r.date)}</span></li>)}</ul>
              </Card>
            )}
            <Card title="Historial">
              <ol className="flex flex-col gap-2 text-sm">{o.timeline.map((x, i) => <li key={i}><div className="text-ink">{x.text}</div><div className="num text-xs text-muted">{new Date(x.at).toLocaleString("es-CL")}</div></li>)}</ol>
            </Card>
          </aside>
        </div>
      </div>
      {open === "receive" && <ReceiveDialog o={o} onClose={() => setOpen(null)} onDone={(x) => { setO(x); setOpen(null); }} />}
      {open === "void" && <VoidPoDialog o={o} onClose={() => setOpen(null)} onDone={(x) => { setO(x); setOpen(null); }} />}
      <Dialog open={open === "print"} onClose={() => setOpen(null)} title="Vista previa de impresión" size="lg">
        <div className="overflow-x-auto rounded-lg border border-line bg-white p-4"><div className="min-w-[560px]"><PrintPo o={o} biz={biz} preview /></div></div>
      </Dialog>
    </>
  );
}

function ReceiveDialog({ o, onClose, onDone }: { o: PurchaseOrderDetail; onClose: () => void; onDone: (o: PurchaseOrderDetail) => void }) {
  const backend = useBackend();
  const toast = useToast();
  const open = o.lines.filter((l) => l.qty_milli > l.received_milli);
  const [qty, setQty] = useState<Record<number, string>>(() => Object.fromEntries(open.map((l) => [l.line_no, String((l.qty_milli - l.received_milli) / 1000).replace(".", ",")])));
  const [date, setDate] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function go() {
    setErr(null);
    const lines = open.map((l) => ({ line_no: l.line_no, qty_milli: parseQty(qty[l.line_no] ?? "") ?? -1 }));
    if (lines.some((l) => l.qty_milli < 0)) { setErr("Revisa las cantidades: escribe solo números (0 si no llegó)."); return; }
    setBusy(true);
    try {
      const r = await backend.receivePurchaseOrder(o.uid, lines, date);
      toast("success", r.status === "recibida" ? `${r.number} recibida completa. Stock y costo promedio actualizados.` : "Recepción parcial registrada. Stock actualizado.");
      onDone(r);
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open onClose={onClose} title={`Recibir mercadería · ${o.number}`} size="lg"
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button icon={PackageCheck} onClick={go} disabled={busy}>{busy ? "Registrando…" : "Confirmar recepción"}</Button></>}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">Escribe lo que llegó de cada producto. Lo que falte queda pendiente en la orden para una próxima entrega.</p>
        <table className="w-full text-sm">
          <thead><tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-muted"><th className="py-2">Producto</th><th className="text-right">Pendiente</th><th className="w-32 text-right">Llegó</th></tr></thead>
          <tbody>
            {open.map((l) => (
              <tr key={l.line_no} className="border-b border-line last:border-0">
                <td className="py-2 pr-3 text-ink">{l.description}</td>
                <td className="num text-right text-muted">{formatQty(l.qty_milli - l.received_milli)}</td>
                <td className="py-1.5 pl-3"><input aria-label={`Cantidad recibida de ${l.description}`} inputMode="decimal" value={qty[l.line_no] ?? ""} onChange={(e) => setQty({ ...qty, [l.line_no]: e.target.value })}
                  className="num h-8 w-full rounded-md border border-line bg-surface px-2 text-right focus:border-accent focus:outline-none" /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <Field label="Fecha de recepción" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="max-w-[12rem]" />
        {err && <Notice tone="danger">{err}</Notice>}
      </div>
    </Dialog>
  );
}

function VoidPoDialog({ o, onClose, onDone }: { o: PurchaseOrderDetail; onClose: () => void; onDone: (o: PurchaseOrderDetail) => void }) {
  const backend = useBackend();
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  async function go() {
    try { onDone(await backend.voidPurchaseOrder(o.uid, reason)); } catch (e) { setErr(errorMessage(e)); }
  }
  return (
    <Dialog open onClose={onClose} title={`Anular ${o.number}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="danger" icon={Ban} onClick={go} disabled={!reason.trim()}>Anular orden</Button></>}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">La orden queda anulada con su motivo en el historial. No se borra.</p>
        <TextArea label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej. el proveedor no tiene stock" />
        {err && <Notice tone="danger">{err}</Notice>}
      </div>
    </Dialog>
  );
}

/** Orden de compra imprimible (documento interno para el proveedor). */
function PrintPo({ o, biz, preview = false }: { o: PurchaseOrderDetail; biz: BusinessSettings | null; preview?: boolean }) {
  return (
    <article className={`${preview ? "block" : "hidden print:block"} bg-white p-2 text-[12px] leading-snug text-black`} aria-hidden={!preview}>
      <header className="flex items-start justify-between gap-6 border-b-2 border-black pb-3">
        <div>
          <div className="text-[16px] font-bold">{biz?.legal_name || biz?.name || "Mi negocio"}</div>
          {biz?.rut && <div>RUT {biz.rut}</div>}
          {biz?.address && <div>{biz.address}</div>}
          {(biz?.phone || biz?.email) && <div>{[biz?.phone, biz?.email].filter(Boolean).join(" · ")}</div>}
        </div>
        <div className="min-w-[220px] border-2 border-black p-3 text-center">
          <div className="text-[15px] font-bold tracking-wide">ORDEN DE COMPRA</div>
          <div className="mt-1 font-mono text-[14px] font-bold">{o.number}</div>
        </div>
      </header>
      <section className="mt-3 grid grid-cols-2 gap-2">
        <div><strong>Proveedor:</strong> {o.supplier_name}</div>
        <div className="text-right"><strong>Fecha:</strong> {formatDate(o.issue_date)}</div>
        {o.expected_date && <div><strong>Entrega:</strong> {formatDate(o.expected_date)}</div>}
      </section>
      <table className="mt-4 w-full border-collapse">
        <thead><tr className="border-y border-black text-left"><th className="py-1">Descripción</th><th className="py-1 text-right">Cant.</th><th className="py-1 text-right">Precio</th><th className="py-1 text-right">Total</th></tr></thead>
        <tbody>{o.lines.map((l) => <tr key={l.line_no} className="border-b border-neutral-300"><td className="py-1">{l.description}</td><td className="py-1 text-right">{formatQty(l.qty_milli)}</td><td className="py-1 text-right">{formatMoney(l.unit_cost_minor)}</td><td className="py-1 text-right">{formatMoney(l.net_minor)}</td></tr>)}</tbody>
      </table>
      <section className="mt-3 ml-auto w-64">
        {o.totals.tax_minor > 0 && <div className="flex justify-between"><span>Neto</span><span>{formatMoney(o.totals.net_minor)}</span></div>}
        {o.totals.tax_minor > 0 && <div className="flex justify-between"><span>IVA</span><span>{formatMoney(o.totals.tax_minor)}</span></div>}
        <div className="mt-1 flex justify-between border-t-2 border-black pt-1 text-[14px] font-bold"><span>TOTAL</span><span>{formatMoney(o.totals.total_minor)}</span></div>
      </section>
      {o.notes && <p className="mt-4"><strong>Observaciones:</strong> {o.notes}</p>}
      <footer className="mt-8 border-t border-black pt-2 text-center text-[10px] text-neutral-600">Generado con NÚCLEO ERP · www.nucleoerp.cl</footer>
    </article>
  );
}
