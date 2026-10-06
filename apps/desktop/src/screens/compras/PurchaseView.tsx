// Ficha de un documento de compra: saldo por pagar, pagos al proveedor, orden asociada y anulación.
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Ban, HandCoins } from "lucide-react";
import { useBackend, errorMessage, type PurchaseDetail } from "../../data";
import { PAYMENT_METHODS } from "../../data/catalogs";
import { formatDate, formatMoney, formatQty, todayIso } from "../../lib/format";
import { goBack } from "../../lib/router";
import { useSession } from "../../lib/session";
import { DocChain, MoneyField } from "../../ui/doc";
import { Badge, Button, Card, DefinitionList, Field, Notice, PageHeader, Select, Spinner, TextArea } from "../../ui/kit";
import { Dialog, useToast } from "../../ui/overlay";
import { AttachmentsPanel } from "../documentos/Documents";
import { PurchaseStatusBadge } from "./common";

export function PurchaseView({ uid }: { uid: string }) {
  const backend = useBackend();
  const { can } = useSession();
  const [c, setC] = useState<PurchaseDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<null | "pay" | "void">(null);
  const load = useCallback(() => { backend.purchase(uid).then(setC).catch((e) => setErr(errorMessage(e))); }, [backend, uid]);
  useEffect(load, [load]);
  if (err) return <Notice tone="danger">{err}</Notice>;
  if (!c) return <Spinner />;
  const due = c.status === "registrada" ? c.total_minor - c.paid_minor : 0;
  const docLabel = [c.doc_kind, c.doc_number && `Nº ${c.doc_number}`].filter(Boolean).join(" ") || "Documento de compra";

  return (
    <div className="anim-in">
      <PageHeader
        back={<button onClick={() => goBack("/compras?tab=documentos")} className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft size={15} /> Comprar</button>}
        title={<span className="flex flex-wrap items-center gap-3"><span>{docLabel}</span><PurchaseStatusBadge c={c} />{c.received_stock && <Badge tone="info">Ingresó a bodega</Badge>}</span>}
        subtitle={`${c.supplier_name} · ${formatDate(c.issue_date)} · registro ${c.number}`}
        actions={
          <>
            {due > 0 && can("dinero.registrar") && <Button icon={HandCoins} onClick={() => setOpen("pay")}>Registrar pago</Button>}
            {c.status === "registrada" && can("compras.crear") && <Button variant="ghost" icon={Ban} onClick={() => setOpen("void")}>Anular</Button>}
          </>
        }
      />
      {c.status === "anulada" && <div className="mb-4"><Notice tone="warning" title="Documento anulado">{c.void_reason}</Notice></div>}
      {c.order_number && <div className="mb-4"><DocChain chain={[{ number: c.order_number, kind: "OC", uid: c.order_uid, label: "Orden de compra" }, { number: c.number, kind: "COM", uid: c.uid, label: docLabel }]} current={c.number} /></div>}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card title="Detalle" padded={false}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead><tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-muted"><th className="px-4 py-2.5">Descripción</th><th className="px-2 text-right">Cantidad</th><th className="px-2 text-right">Costo unit.</th><th className="px-4 text-right">Total</th></tr></thead>
                <tbody>{c.lines.map((l) => (
                  <tr key={l.line_no} className="border-b border-line last:border-0">
                    <td className="px-4 py-2.5 text-ink">{l.description}{!l.taxable && <span className="ml-2 text-xs text-muted">(exento)</span>}</td>
                    <td className="num px-2 text-right">{formatQty(l.qty_milli)}</td>
                    <td className="num px-2 text-right">{formatMoney(l.unit_cost_minor)}</td>
                    <td className="num px-4 text-right font-medium">{formatMoney(l.net_minor)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </Card>
          <AttachmentsPanel link={{ entity: "compra", uid: c.uid }} />
          {c.notes && <Card title="Observaciones"><p className="whitespace-pre-wrap text-sm">{c.notes}</p></Card>}
        </div>
        <aside className="flex flex-col gap-4">
          <Card title="Totales">
            <dl className="flex flex-col gap-2 text-sm">
              {c.totals.tax_minor > 0 && <div className="flex justify-between"><dt className="text-muted">Neto</dt><dd className="num">{formatMoney(c.totals.net_minor)}</dd></div>}
              {c.totals.exempt_minor > 0 && <div className="flex justify-between"><dt className="text-muted">{c.totals.tax_minor > 0 ? "Exento" : "Subtotal"}</dt><dd className="num">{formatMoney(c.totals.exempt_minor)}</dd></div>}
              {c.totals.tax_minor > 0 && <div className="flex justify-between"><dt className="text-muted">IVA crédito (estimado)</dt><dd className="num">{formatMoney(c.totals.tax_minor)}</dd></div>}
              <div className="mt-1 flex items-baseline justify-between border-t border-line pt-2"><dt className="font-semibold">Total</dt><dd className="num text-[20px] font-semibold">{formatMoney(c.totals.total_minor)}</dd></div>
            </dl>
          </Card>
          <Card title="Pago">
            <DefinitionList items={[
              { label: "Vence", value: formatDate(c.due_date) },
              { label: "Pagado", value: <span className="num">{formatMoney(c.paid_minor)}</span> },
              { label: "Saldo", value: <span className={`num font-semibold ${due > 0 ? "text-warning" : "text-success"}`}>{formatMoney(due)}</span> },
            ]} />
            {c.payments.length > 0 && (
              <ul className="mt-3 divide-y divide-line rounded-lg border border-line text-sm">
                {c.payments.map((p) => (
                  <li key={p.number} className="px-3 py-2">
                    <div className="flex justify-between gap-3"><span className="text-ink">{p.method}</span><span className="num font-medium">{formatMoney(p.amount_minor)}</span></div>
                    <div className="num text-xs text-muted">{p.number} · {formatDate(p.date)}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Historial">
            <ol className="flex flex-col gap-2 text-sm">{c.timeline.map((x, i) => <li key={i}><div className="text-ink">{x.text}</div><div className="num text-xs text-muted">{new Date(x.at).toLocaleString("es-CL")}</div></li>)}</ol>
          </Card>
        </aside>
      </div>
      {open === "pay" && <PayDialog c={c} due={due} onClose={() => setOpen(null)} onDone={(x) => { setC(x); setOpen(null); }} />}
      {open === "void" && <VoidDialog c={c} onClose={() => setOpen(null)} onDone={(x) => { setC(x); setOpen(null); }} />}
    </div>
  );
}

function PayDialog({ c, due, onClose, onDone }: { c: PurchaseDetail; due: number; onClose: () => void; onDone: (c: PurchaseDetail) => void }) {
  const backend = useBackend();
  const toast = useToast();
  const [amount, setAmount] = useState<number | null>(due);
  const [method, setMethod] = useState(PAYMENT_METHODS[1]!);
  const [date, setDate] = useState(todayIso());
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true); setErr(null);
    try { const x = await backend.payPurchase(c.uid, amount ?? 0, method, date); toast("success", x.payment_state === "pagada" ? "Documento pagado completo." : "Abono registrado."); onDone(x); }
    catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open onClose={onClose} title={`Pagar a ${c.supplier_name}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button icon={HandCoins} onClick={go} disabled={busy || !amount}>Registrar pago</Button></>}>
      <div className="flex flex-col gap-4">
        <div className="rounded-lg bg-surface-2 px-4 py-3 text-sm"><div className="flex justify-between"><span className="text-muted">Saldo pendiente</span><span className="num font-semibold">{formatMoney(due)}</span></div></div>
        <MoneyField label="Monto" value={amount} onValue={setAmount} hint="Puedes pagar una parte (abono)." />
        <div className="grid grid-cols-2 gap-4">
          <Select label="Medio de pago" value={method} onChange={(e) => setMethod(e.target.value)} options={PAYMENT_METHODS.map((m) => ({ value: m, label: m }))} />
          <Field label="Fecha" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        {err && <Notice tone="danger">{err}</Notice>}
      </div>
    </Dialog>
  );
}

function VoidDialog({ c, onClose, onDone }: { c: PurchaseDetail; onClose: () => void; onDone: (c: PurchaseDetail) => void }) {
  const backend = useBackend();
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  async function go() { try { onDone(await backend.voidPurchase(c.uid, reason)); } catch (e) { setErr(errorMessage(e)); } }
  return (
    <Dialog open onClose={onClose} title={`Anular ${c.number}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="danger" icon={Ban} onClick={go} disabled={!reason.trim()}>Anular documento</Button></>}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          Se anulan la deuda y los pagos registrados{c.received_stock ? ", y la mercadería que ingresó con este documento sale del stock" : ""}. Nada se borra. Después puedes volver a registrar el documento corregido.
        </p>
        <TextArea label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej. monto mal digitado" />
        {err && <Notice tone="danger">{err}</Notice>}
      </div>
    </Dialog>
  );
}
