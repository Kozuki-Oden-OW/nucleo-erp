// Ficha de una venta: estado en tres ejes, cadena documental, acciones del ciclo y línea de tiempo.
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, BadgeCheck, Ban, BellOff, FileWarning, HandCoins, Pencil, Truck } from "lucide-react";
import { useBackend, errorMessage, type BusinessSettings, type PendingDispatch, type SaleDetail, type Shipment, type ShipmentInput } from "../../data";
import { ShipmentDrawer, ShipStatusBadge, recipientFromCustomer } from "../envios/Shipments";
import { DispatchDialog, DispatchStatus } from "../inventario/Dispatches";
import { formatDate, formatMoney, formatPpm, formatQty } from "../../lib/format";
import { useTerm } from "../../lib/glosario";
import { usePrefs } from "../../lib/prefs";
import { goBack, navigate } from "../../lib/router";
import { DocChain, SaleStatus } from "../../ui/doc";
import { Badge, Button, Card, DefinitionList, Notice, PageHeader, Spinner } from "../../ui/kit";
import { useToast } from "../../ui/overlay";
import { DocumentDialog, EffectDialog, PaymentDialog, VoidDialog } from "./dialogs";
import { PrintButton, PrintDoc } from "./PrintDoc";
import { paymentText, referenceLabel } from "../../data/saleTerms";
import type { SaleTerms } from "../../data";
import { formatRut } from "../../lib/format";

function TermsCard({ terms }: { terms: SaleTerms }) {
  const r = terms.receiver;
  return (
    <Card title="Condiciones del documento">
      <div className="flex flex-col gap-4">
        <DefinitionList items={[
          ...(terms.payment ? [{ label: "Forma de pago", value: paymentText(terms, formatDate) }] : []),
          ...terms.references.map((x) => ({ label: referenceLabel(x.kind), value: `N.º ${x.folio}${x.date ? ` del ${formatDate(x.date)}` : ""}${x.note ? ` · ${x.note}` : ""}` })),
        ]} />
        {r && (
          <div className="rounded-lg bg-surface-2 px-4 py-3 text-sm">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Receptor</div>
            <div className="font-medium text-ink">{r.name}{r.rut ? ` · RUT ${formatRut(r.rut)}` : ""}</div>
            {r.activity && <div className="text-muted">Giro: {r.activity}</div>}
            {(r.address || r.commune) && <div className="text-muted">{[r.address, r.commune, r.city, r.region].filter(Boolean).join(", ")}</div>}
            {(r.contact || r.email || r.phone) && <div className="text-muted">{[r.contact, r.email, r.phone].filter(Boolean).join(" · ")}</div>}
          </div>
        )}
      </div>
    </Card>
  );
}

type Open = null | "effect" | "pay" | "doc" | "void";

export function SaleView({ uid }: { uid: string }) {
  const backend = useBackend();
  const toast = useToast();
  const t = useTerm();
  const { prefs } = usePrefs();
  const [s, setS] = useState<SaleDetail | null>(null);
  const [biz, setBiz] = useState<BusinessSettings | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<Open>(null);
  const [snoozed, setSnoozed] = useState(false);
  const [dispatching, setDispatching] = useState<PendingDispatch | null>(null);
  const [ships, setShips] = useState<Shipment[]>([]);
  const [shipping, setShipping] = useState<(ShipmentInput & { sale_number?: string | null }) | null>(null);

  const load = useCallback(() => {
    backend.sale(uid).then(setS).catch((e) => setErr(errorMessage(e)));
    backend.shipments(uid).then(setShips).catch(() => setShips([]));
  }, [backend, uid]);
  useEffect(load, [load]);
  useEffect(() => { backend.business().then(setBiz).catch(() => {}); }, [backend]);

  if (err) return <Notice tone="danger">{err}</Notice>;
  if (!s) return <Spinner />;

  const editable = ["borrador", "cotizada", "aceptada"].includes(s.commercial_state);
  const effected = s.commercial_state === "efectuada" || s.commercial_state === "cerrada";
  const due = effected ? s.total_minor - s.paid_minor : 0;
  const profit = s.totals.net_minor + s.totals.exempt_minor - s.cost_minor;
  const taxPpm = s.totals.tax_minor > 0 && biz?.tax_rate_ppm ? biz.tax_rate_ppm : null;

  return (
    <>
    <PrintDoc kind={s.doc_type} doc={s} biz={biz} />
    <div className="anim-in print:hidden">
      <PageHeader
        back={<button onClick={() => goBack("/ventas")} className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft size={15} /> Ventas</button>}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono">{s.number}</span>
            {s.doc_type === "FV" && <Badge tone="accent">Factura interna</Badge>}
            <SaleStatus s={s} />
          </span>
        }
        subtitle={`${s.customer_name} · ${formatDate(s.issue_date)}${s.payment_method ? ` · ${s.payment_method}` : ""}`}
        actions={
          <>
            {editable && <Button variant="secondary" icon={Pencil} onClick={() => navigate(`/ventas/${s.uid}/editar`)}>Editar</Button>}
            {editable && <Button icon={BadgeCheck} onClick={() => setOpen("effect")}>Venta efectuada</Button>}
            {effected && due > 0 && <Button icon={HandCoins} onClick={() => setOpen("pay")}>Registrar pago</Button>}
            {s.commercial_state !== "anulada" && !editable && <PrintButton kind={s.doc_type} doc={s} biz={biz} />}
            {s.commercial_state !== "anulada" && <Button variant="ghost" icon={Ban} onClick={() => setOpen("void")}>Anular</Button>}
          </>
        }
      />

      {s.documentation_state === "pendiente" && s.commercial_state !== "anulada" && !snoozed && (
        <div className="mb-6">
          <Notice
            tone="warning"
            icon={FileWarning}
            title="Esta venta está pendiente de documentación tributaria"
            actions={
              <>
                <Button size="sm" icon={BadgeCheck} onClick={() => setOpen("doc")}>Marcar como documentada</Button>
                <Button size="sm" variant="secondary" icon={BellOff} onClick={() => { setSnoozed(true); toast("info", "Te lo recordaremos en la lista de pendientes y en las alertas."); }}>Recordármelo después</Button>
                <Button size="sm" variant="ghost" onClick={async () => { setS(await backend.setDocumentationNotApplicable(s.uid)); toast("info", "Marcada como “no aplica”."); }}>No aplica</Button>
              </>
            }
          >
            Si corresponde, emite la factura o boleta en el sistema oficial y luego anota aquí su número. NÚCLEO no emite ni envía documentos.
          </Notice>
        </div>
      )}
      {s.commercial_state === "anulada" && <div className="mb-6"><Notice tone="danger" icon={Ban} title="Venta anulada">{s.void_reason}</Notice></div>}
      {editable && (
        <div className="mb-6">
          <Notice tone="info" title="Borrador">Todavía no mueve stock ni dinero. Cuando el cliente confirme, presiona “Venta efectuada”.</Notice>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card title="Cadena del documento" subtitle="Cómo llegó esta venta hasta aquí, sin volver a digitar">
            <DocChain chain={s.chain} current={s.number} />
          </Card>

          <Card title="Detalle" padded={false}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-muted">
                    <th className="px-5 py-2.5">Descripción</th>
                    <th className="px-3 py-2.5 text-right">Cantidad</th>
                    <th className="px-3 py-2.5 text-right">Precio</th>
                    <th className="px-3 py-2.5 text-right">Desc.</th>
                    <th className="px-5 py-2.5 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {s.lines.map((l) => (
                    <tr key={l.line_no} className="border-b border-line last:border-0">
                      <td className="px-5 py-2.5 text-ink">{l.description}</td>
                      <td className="num px-3 py-2.5 text-right">{formatQty(l.qty_milli)}</td>
                      <td className="num px-3 py-2.5 text-right">{formatMoney(l.unit_price_minor)}</td>
                      <td className="num px-3 py-2.5 text-right text-muted">{l.discount_ppm ? formatPpm(l.discount_ppm, 0) : "—"}</td>
                      <td className="num px-5 py-2.5 text-right font-medium">{formatMoney(l.net_minor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {s.terms && <TermsCard terms={s.terms} />}

          {s.dispatch.length > 0 && (
            <Card title="Por despachar" subtitle="Productos que toman reservas: se descuentan del stock al despachar." padded={false}>
              <ul className="divide-y divide-line">
                {s.dispatch.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                    <span className="min-w-0 flex-1 font-medium text-ink">{d.product_name}</span>
                    <span className="num text-muted">Faltan {formatQty(d.pending_milli)} de {formatQty(d.ordered_milli)} {d.unit}</span>
                    <DispatchStatus d={d} />
                    <Button size="sm" icon={Truck} disabled={d.reserved_milli === 0} onClick={() => setDispatching(d)}>Despachar</Button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {effected && (
            <Card title="Envíos" subtitle="Agencia, seguimiento y estado del despacho al cliente." padded={false}
              actions={<Button size="sm" variant="secondary" icon={Truck} onClick={async () => {
                const c = s.customer_uid ? await backend.customer(s.customer_uid).catch(() => null) : null;
                setShipping({ status: "no_despachado", sale_uid: s.uid, sale_number: s.number, ...recipientFromCustomer(c) });
              }}>Crear envío</Button>}>
              {ships.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Sin envíos registrados.</p> : (
                <ul className="divide-y divide-line">
                  {ships.map((e) => (
                    <li key={e.uid}>
                      <button type="button" onClick={() => navigate(`/envios?ver=${e.uid}`)} className="flex w-full flex-wrap items-center gap-3 px-5 py-3 text-left text-sm hover:bg-surface-2">
                        <span className="font-mono text-[13px]">{e.number}</span>
                        <span className="min-w-0 flex-1 text-muted">{[e.carrier, e.tracking && `N.º ${e.tracking}`].filter(Boolean).join(" · ") || "Sin agencia"}</span>
                        <ShipStatusBadge status={e.status} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
          {shipping && <ShipmentDrawer shipment={null} preset={shipping} onClose={() => setShipping(null)} onSaved={() => { setShipping(null); load(); }} />}
          {dispatching && <DispatchDialog d={dispatching} onClose={() => setDispatching(null)} onDone={() => { setDispatching(null); load(); }} />}

          {s.payments.length > 0 && (
            <Card title="Pagos recibidos" padded={false}>
              <ul className="divide-y divide-line text-sm">
                {s.payments.map((p) => (
                  <li key={p.number} className="flex items-center gap-4 px-5 py-2.5">
                    <span className="font-mono text-[13px] text-muted">{p.number}</span>
                    <span className="num text-muted">{formatDate(p.date)}</span>
                    <span className="flex-1 text-ink">{p.method}</span>
                    <span className="num font-medium">{formatMoney(p.amount_minor)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card title="Historial">
            <ol className="relative ml-2 border-l border-line">
              {s.timeline.map((e, i) => (
                <li key={i} className="mb-3 ml-4 last:mb-0">
                  <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full border-2 border-surface bg-accent" aria-hidden />
                  <div className="text-sm text-ink">{e.text}</div>
                  <div className="text-xs text-muted">{new Date(e.at).toLocaleString("es-CL", { dateStyle: "medium", timeStyle: "short" })}</div>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <aside className="flex flex-col gap-6">
          <Card title="Montos">
            <dl className="flex flex-col gap-2 text-sm">
              {s.totals.discount_minor > 0 && <div className="flex justify-between"><dt className="text-muted">Descuentos</dt><dd className="num">− {formatMoney(s.totals.discount_minor)}</dd></div>}
              {s.totals.tax_minor > 0 && <div className="flex justify-between"><dt className="text-muted">{t("neto")}</dt><dd className="num">{formatMoney(s.totals.net_minor)}</dd></div>}
              {s.totals.tax_minor > 0 && s.totals.exempt_minor > 0 && <div className="flex justify-between"><dt className="text-muted">{t("exento")}</dt><dd className="num">{formatMoney(s.totals.exempt_minor)}</dd></div>}
              {s.totals.tax_minor > 0 && <div className="flex justify-between"><dt className="text-muted">{t("impuesto")}{taxPpm ? ` (${formatPpm(taxPpm, 0)})` : ""}</dt><dd className="num">{formatMoney(s.totals.tax_minor)}</dd></div>}
              <div className="flex items-baseline justify-between border-t border-line pt-2"><dt className="font-semibold">Total</dt><dd className="num text-xl font-semibold">{formatMoney(s.total_minor)}</dd></div>
              {effected && (
                <>
                  <div className="flex justify-between"><dt className="text-muted">Pagado</dt><dd className="num text-success">{formatMoney(s.paid_minor)}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted">Saldo</dt><dd className={`num font-medium ${due > 0 ? "text-warning" : "text-faint"}`}>{formatMoney(due)}</dd></div>
                  {s.due_date && due > 0 && <div className="flex justify-between"><dt className="text-muted">Vence</dt><dd className="num">{formatDate(s.due_date)}</dd></div>}
                </>
              )}
            </dl>
          </Card>

          {effected && (
            <Card title={t("margen")} subtitle={prefs.view === "contador" ? "Costo promedio congelado al efectuar" : "Lo que te queda después del costo de los productos"}>
              <DefinitionList
                items={[
                  { label: t("costo_venta"), value: <span className="num">{formatMoney(s.cost_minor)}</span> },
                  { label: t("margen"), value: <span className={`num font-semibold ${profit < 0 ? "text-danger" : "text-success"}`}>{formatMoney(profit)}</span> },
                  { label: "Ganancia sobre costo", value: <span className="num">{s.cost_minor > 0 ? `${((profit / s.cost_minor) * 100).toFixed(1).replace(".", ",")} %` : "—"}</span> },
                ]}
              />
            </Card>
          )}

          <Card title="Documentación tributaria">
            {s.documentation_state === "documentada" && s.external_ref ? (
              <DefinitionList
                items={[
                  { label: "Estado", value: <Badge tone="success" icon={BadgeCheck}>Documentada</Badge> },
                  { label: "Documento", value: [s.external_ref.doc_kind, s.external_ref.external_number && `Nº ${s.external_ref.external_number}`].filter(Boolean).join(" ") || "—" },
                  { label: "Fecha", value: formatDate(s.external_ref.issue_date) },
                  ...(s.external_ref.observation ? [{ label: "Observación", value: s.external_ref.observation }] : []),
                ]}
              />
            ) : s.documentation_state === "pendiente" ? (
              <div className="flex flex-col gap-3 text-sm">
                <Badge tone="warning" icon={FileWarning}>Pendiente</Badge>
                <Button size="sm" variant="secondary" icon={BadgeCheck} onClick={() => setOpen("doc")}>Marcar como documentada</Button>
              </div>
            ) : (
              <p className="text-sm text-muted">{effected ? "No aplica para esta venta." : "Se define al efectuar la venta, según la configuración de tu negocio."}</p>
            )}
          </Card>
        </aside>
      </div>

      <EffectDialog sale={s} open={open === "effect"} onClose={() => setOpen(null)} onDone={setS} />
      {open === "pay" && <PaymentDialog sale={s} open onClose={() => setOpen(null)} onDone={setS} />}
      <DocumentDialog sale={s} open={open === "doc"} onClose={() => setOpen(null)} onDone={setS} />
      <VoidDialog sale={s} open={open === "void"} onClose={() => setOpen(null)} onDone={setS} />
    </div>
    </>
  );
}
