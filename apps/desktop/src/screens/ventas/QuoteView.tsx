import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRightLeft, Check, Pencil, Send, X } from "lucide-react";
import { useBackend, errorMessage, type BusinessSettings, type QuoteDetail } from "../../data";
import { formatDate, formatMoney, formatPpm, formatQty } from "../../lib/format";
import { goBack, navigate } from "../../lib/router";
import { QuoteStatusBadge } from "../../ui/doc";
import { Button, Card, Notice, PageHeader, Spinner } from "../../ui/kit";
import { useToast } from "../../ui/overlay";
import { PrintButton, PrintDoc } from "./PrintDoc";

export function QuoteView({ uid }: { uid: string }) {
  const backend = useBackend();
  const toast = useToast();
  const [q, setQ] = useState<QuoteDetail | null>(null);
  const [biz, setBiz] = useState<BusinessSettings | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => { backend.quote(uid).then(setQ).catch((e) => setErr(errorMessage(e))); }, [backend, uid]);
  useEffect(load, [load]);
  useEffect(() => { backend.business().then(setBiz).catch(() => {}); }, [backend]);

  if (err) return <Notice tone="danger">{err}</Notice>;
  if (!q) return <Spinner />;

  const open = q.status === "borrador" || q.status === "enviada" || q.status === "aceptada";
  async function status(s: "enviada" | "aceptada" | "rechazada") {
    try { setQ(await backend.setQuoteStatus(q!.uid, s)); } catch (e) { toast("danger", errorMessage(e)); }
  }
  async function convert() {
    setBusy(true);
    try {
      const s = await backend.convertQuote(q!.uid);
      toast("success", `${q!.number} se convirtió en ${s.number}. Revisa y marca la venta como efectuada.`);
      navigate(`/ventas/${s.uid}`);
    } catch (e) { toast("danger", errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <>
      <PrintDoc kind="COT" doc={q} biz={biz} />
      <div className="anim-in print:hidden">
        <PageHeader
          back={<button onClick={() => goBack("/ventas?tab=cotizaciones")} className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft size={15} /> Cotizaciones</button>}
          title={<span className="flex flex-wrap items-center gap-3"><span className="font-mono">{q.number}</span><QuoteStatusBadge status={q.status} /></span>}
          subtitle={`${q.customer_name} · emitida ${formatDate(q.issue_date)}${q.valid_until ? ` · válida hasta ${formatDate(q.valid_until)}` : ""}`}
          actions={
            <>
              {open && <Button variant="secondary" icon={Pencil} onClick={() => navigate(`/cotizaciones/${q.uid}/editar`)}>Editar</Button>}
              {q.status === "borrador" && <Button variant="secondary" icon={Send} onClick={() => status("enviada")}>Marcar enviada</Button>}
              {(q.status === "borrador" || q.status === "enviada") && <Button variant="secondary" icon={Check} onClick={() => status("aceptada")}>Cliente aceptó</Button>}
              {open && <Button icon={ArrowRightLeft} onClick={convert} disabled={busy}>Convertir en venta</Button>}
              <PrintButton kind="COT" doc={q} biz={biz} />
              {open && <Button variant="ghost" icon={X} onClick={() => status("rechazada")}>Rechazada</Button>}
            </>
          }
        />
        {q.status === "convertida" && q.sale_uid && (
          <div className="mb-6">
            <Notice tone="success" title={`Convertida en ${q.sale_number}`} actions={<Button size="sm" onClick={() => navigate(`/ventas/${q.sale_uid}`)}>Ver la venta</Button>}>
              Se copiaron cliente, productos, cantidades, precios y descuentos sin volver a digitar.
            </Notice>
          </div>
        )}
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <Card title="Detalle" padded={false}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-muted">
                  <th className="px-5 py-2.5">Descripción</th><th className="px-3 text-right">Cantidad</th><th className="px-3 text-right">Precio</th><th className="px-3 text-right">Desc.</th><th className="px-5 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {q.lines.map((l) => (
                  <tr key={l.line_no} className="border-b border-line last:border-0">
                    <td className="px-5 py-2.5">{l.description}</td>
                    <td className="num px-3 text-right">{formatQty(l.qty_milli)}</td>
                    <td className="num px-3 text-right">{formatMoney(l.unit_price_minor)}</td>
                    <td className="num px-3 text-right text-muted">{l.discount_ppm ? formatPpm(l.discount_ppm, 0) : "—"}</td>
                    <td className="num px-5 text-right font-medium">{formatMoney(l.net_minor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {q.notes && <p className="border-t border-line px-5 py-3 text-sm text-muted">{q.notes}</p>}
          </Card>
          <Card title="Total">
            <dl className="flex flex-col gap-2 text-sm">
              {q.totals.tax_minor > 0 && <div className="flex justify-between"><dt className="text-muted">Neto</dt><dd className="num">{formatMoney(q.totals.net_minor)}</dd></div>}
              {q.totals.tax_minor > 0 && <div className="flex justify-between"><dt className="text-muted">IVA</dt><dd className="num">{formatMoney(q.totals.tax_minor)}</dd></div>}
              <div className="flex items-baseline justify-between border-t border-line pt-2"><dt className="font-semibold">Total</dt><dd className="num text-xl font-semibold">{formatMoney(q.total_minor)}</dd></div>
            </dl>
            <p className="mt-4 text-xs text-muted">Una cotización no mueve stock ni dinero.</p>
          </Card>
        </div>
      </div>
    </>
  );
}
