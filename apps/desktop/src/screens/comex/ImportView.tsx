// Carpeta de importación: etapas, ETA con historial, costos estimados y reales (con pagos),
// costo puesto en bodega por producto, recepción a stock, cierre (estimado vs. real) y anulación.
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft, Ban, CalendarClock, Check, CheckCircle2, HandCoins, Lock, PackageCheck, Pencil, Plus, Trash2,
} from "lucide-react";
import {
  useBackend, errorMessage, type ImportCost, type ImportCostInput, type ImportDetail, type ImportStage, type Supplier,
} from "../../data";
import { PAYMENT_METHODS } from "../../data/catalogs";
import { BASIS_LABEL, COST_KINDS, COST_LABEL, STAGE_LABEL, type Basis, type CostKind } from "../../data/comex";
import { addDays, daysBetween, formatDate, formatMoney, formatQty, parseQty, todayIso } from "../../lib/format";
import { goBack, navigate } from "../../lib/router";
import { useSession } from "../../lib/session";
import { MoneyField } from "../../ui/doc";
import { Badge, Button, Card, Checkbox, cx, Field, IconButton, Notice, PageHeader, Segmented, Select, Spinner, TextArea } from "../../ui/kit";
import { Dialog, useToast } from "../../ui/overlay";
import { SupplierFormDrawer } from "../compras/common";
import { AccountSelect, PayDialog } from "../dinero/common";
import { AttachmentsPanel } from "../documentos/Documents";
import { SupplierPicker } from "../ventas/pickers";
import { MANUAL_STAGES, RateField, STAGE_HINT, STAGES, StageBadge, TRANSPORT, formatRate } from "./common";

const unit = (e4: number | null | undefined) => (e4 == null ? "—" : formatMoney(Math.round(e4 / 10_000)));

export function ImportView({ uid }: { uid: string }) {
  const backend = useBackend();
  const { can } = useSession();
  const toast = useToast();
  const [d, setD] = useState<ImportDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<null | { k: "stage"; stage: ImportStage } | { k: "eta" } | { k: "cost"; cost?: ImportCost } | { k: "pay"; cost: ImportCost } | { k: "remove"; cost: ImportCost } | { k: "receive" } | { k: "void" }>(null);
  useEffect(() => { backend.import(uid).then(setD).catch((e) => setErr(errorMessage(e))); }, [backend, uid]);
  if (err) return <Notice tone="danger">{err}</Notice>;
  if (!d) return <Spinner />;
  const write = can("comex.editar");
  const live = d.stage !== "cerrada" && d.stage !== "anulada";
  const idx = STAGES.indexOf(d.stage);
  const next = MANUAL_STAGES[idx + 1];
  const done = (x: ImportDetail, msg: string) => { setD(x); setOpen(null); toast("success", msg); };
  async function close() {
    try { done(await backend.closeImport(uid), "Importación cerrada: costo final fijado."); } catch (e) { toast("danger", errorMessage(e)); }
  }
  const c = d.calc;
  const T = d.transport_mode ? TRANSPORT[d.transport_mode] : null;
  const estimate = d.estimated_landed_clp;
  const diff = estimate !== null ? c.landed_clp - estimate : null;
  const etaDays = d.eta ? daysBetween(todayIso(), d.eta) : null;
  const shift = d.eta_history.length ? (() => { const f = d.eta_history[0]!; const base = f.old_eta ?? f.new_eta; return d.eta ? daysBetween(base, d.eta) : 0; })() : 0;

  return (
    <div className="anim-in">
      <PageHeader
        back={<button onClick={() => goBack("/comex")} className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft size={15} /> Comercio exterior</button>}
        title={<span className="flex flex-wrap items-center gap-3"><span>Importación {d.number}</span><StageBadge stage={d.stage} />{d.has_estimates && live && <Badge tone="warning">Con costos estimados</Badge>}</span>}
        subtitle={[d.supplier_name ?? "Sin proveedor", d.incoterm && `${d.incoterm} ${d.incoterm_version ?? ""}`.trim(), T?.label, [d.origin_port ?? d.origin_country, d.destination_port].filter(Boolean).join(" → ")].filter(Boolean).join(" · ")}
        actions={write && live && (
          <>
            {d.editable && <Button variant="ghost" icon={Pencil} onClick={() => navigate(`/comex/importacion/${uid}/editar`)}>Editar</Button>}
            {d.editable && d.items.every((i) => i.received_milli === 0) && <Button variant="ghost" icon={Ban} onClick={() => setOpen({ k: "void" })}>Anular</Button>}
            {next && d.stage !== "recibida" && d.items.every((i) => i.received_milli === 0) && <Button variant="secondary" icon={Check} onClick={() => setOpen({ k: "stage", stage: next })}>{d.stage === "cotizacion" ? "Confirmar pedido" : `Pasar a ${STAGE_LABEL[next]!.toLowerCase()}`}</Button>}
            {d.receivable && <Button icon={PackageCheck} onClick={() => setOpen({ k: "receive" })}>Recibir mercadería</Button>}
            {d.stage === "recibida" && <Button icon={Lock} onClick={close}>Cerrar importación</Button>}
          </>
        )}
      />
      {d.stage === "anulada" && <div className="mb-4"><Notice tone="warning" title="Importación anulada">{d.void_reason}</Notice></div>}
      {d.stage === "recibida" && d.has_estimates && <div className="mb-4"><Notice tone="warning" title="Antes de cerrar">Reemplaza los costos estimados por los montos reales (o quítalos). Al cerrar se fija el costo final y se compara con lo estimado.</Notice></div>}

      <Stepper d={d} onPick={write && live && d.stage !== "recibida" && d.items.every((i) => i.received_milli === 0) ? (s) => setOpen({ k: "stage", stage: s }) : undefined} />

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Mercadería" value={formatMoney(c.fob_minor, d.currency_code)} hint={d.currency_code === "CLP" ? undefined : `${formatMoney(c.fob_clp)} · cambio ${formatRate(d.rate_e6)}`} />
        <Metric label={d.stage === "cerrada" ? "Costo final en bodega" : "Costo en bodega (hoy)"} value={formatMoney(c.landed_clp)} hint={c.recoverable_clp ? `IVA ${formatMoney(c.recoverable_clp)} como crédito (no es costo)` : undefined} />
        <Metric label="Estimado al confirmar" value={estimate === null ? "—" : formatMoney(estimate)}
          hint={diff === null ? (d.stage === "cotizacion" ? "Se guarda al confirmar el pedido" : undefined) : diff === 0 ? "Igual a lo estimado" : `${diff > 0 ? "+" : "−"}${formatMoney(Math.abs(diff))} (${diff > 0 ? "más caro" : "más barato"})`}
          tone={diff !== null && diff > 0 ? "warning" : diff !== null && diff < 0 ? "success" : undefined} />
        <div className="flex min-w-0 flex-col rounded-xl border border-line bg-surface p-4 shadow-card">
          <div className="flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
            <span>{d.reception_date ? "Recibida" : "Llegada estimada"}</span>
            {write && live && d.stage !== "recibida" && <button className="text-[12px] font-medium normal-case tracking-normal text-accent hover:underline" onClick={() => setOpen({ k: "eta" })}>{d.eta ? "Cambiar" : "Indicar"}</button>}
          </div>
          <div className="num mt-2 text-[22px] font-semibold leading-tight text-ink">{d.reception_date ? formatDate(d.reception_date) : formatDate(d.eta)}</div>
          <div className="mt-1 text-xs text-muted">
            {d.reception_date ? "Recibida" : etaDays === null ? "Sin fecha" : etaDays > 0 ? `En ${etaDays} días` : etaDays === 0 ? "Hoy" : `Atrasada ${-etaDays} días`}
            {shift !== 0 && <span className={shift > 0 ? "text-warning" : ""}> · cambió {d.eta_history.filter((e) => e.old_eta).length}× ({shift > 0 ? "+" : ""}{shift} d)</span>}
          </div>
        </div>
      </div>

      <div className="mt-6">
          <Card title="Costo por producto" subtitle="Cuánto te cuesta cada unidad puesta en tu bodega. Al recibir, entra a stock con este costo." padded={false}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead><tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-muted">
                  <th className="px-4 py-2.5">Producto</th><th className="px-2 text-right">Cantidad</th><th className="px-2 text-right">Mercadería</th>
                  <th className="px-2 text-right">Flete y seguro</th><th className="px-2 text-right">Derechos</th><th className="px-2 text-right">Gastos</th>
                  <th className="px-2 text-right">Total</th><th className="px-4 text-right">Unitario</th>
                </tr></thead>
                <tbody>
                  {d.items.map((it, i) => {
                    const b = c.items[i];
                    const est = it.estimated_unit_cost_e4;
                    const dd = b && est ? b.unit_cost_e4 - est : 0;
                    return (
                      <tr key={it.id} className="border-b border-line last:border-0">
                        <td className="px-4 py-2.5">
                          {it.product_uid ? <button className="text-left text-ink hover:text-accent hover:underline" onClick={() => navigate(`/inventario/producto/${it.product_uid}`)}>{it.description}</button> : <span className="text-ink">{it.description}</span>}
                          <div className="text-xs text-muted">{[it.sku, it.hs_code && `partida ${it.hs_code}`, it.duty_ppm ? `arancel ${it.duty_ppm / 10_000} %` : null].filter(Boolean).join(" · ") || "Sin producto: no entra a bodega"}</div>
                        </td>
                        <td className="num px-2 text-right">{formatQty(it.qty_milli)}{it.received_milli > 0 && <div className="text-xs text-success">recibido {formatQty(it.received_milli)}</div>}</td>
                        <td className="num px-2 text-right text-muted">{b ? formatMoney(b.fob_clp) : "—"}</td>
                        <td className="num px-2 text-right text-muted">{b ? formatMoney(b.freight_clp + b.insurance_clp) : "—"}</td>
                        <td className="num px-2 text-right text-muted">{b ? formatMoney(b.duty_clp) : "—"}</td>
                        <td className="num px-2 text-right text-muted">{b ? formatMoney(b.local_clp + b.vat_in_cost_clp) : "—"}</td>
                        <td className="num px-2 text-right">{b ? formatMoney(b.landed_clp) : "—"}</td>
                        <td className="num px-4 text-right font-semibold">{unit(b?.unit_cost_e4)}
                          {est !== null && dd !== 0 && <div className={cx("text-xs font-normal", dd > 0 ? "text-warning" : "text-success")}>est. {unit(est)}</div>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card title="Costos de la importación" subtitle="Registra primero los estimados y reemplázalos por los reales a medida que llegan las facturas."
            actions={write && live && <Button size="sm" variant="secondary" icon={Plus} onClick={() => setOpen({ k: "cost" })}>Agregar costo</Button>} padded={false}>
            {d.costs.length === 0 ? <p className="p-5 text-sm text-muted">Sin costos todavía. Agrega el flete internacional, el seguro, el agente de aduana y el transporte a tu bodega.</p> : (
              <ul className="divide-y divide-line">
                {d.costs.map((k) => {
                  const pend = (k.payable_amount_minor ?? 0) - (k.payable_paid_minor ?? 0);
                  return (
                    <li key={k.id} className={cx("flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm", k.status === "anulado" && "opacity-55")}>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-ink">{COST_LABEL[k.kind]}</span>
                          {k.description && <span className="text-muted">· {k.description}</span>}
                          {k.status === "anulado" ? <Badge>Anulado</Badge> : k.is_estimate ? <Badge tone="warning">Estimado</Badge> : <Badge tone="success">Real</Badge>}
                          {k.recoverable_tax && <Badge tone="info">Crédito</Badge>}
                          {k.payable_amount_minor !== null && k.status === "vigente" && (pend > 0 ? <Badge tone={k.payable_due && k.payable_due < todayIso() ? "danger" : "neutral"}>Por pagar {formatMoney(pend)}</Badge> : <Badge tone="success">Pagado</Badge>)}
                        </div>
                        <div className="text-xs text-muted">{[k.supplier_name, k.document_ref && `doc. ${k.document_ref}`, k.cost_date && formatDate(k.cost_date), k.allocation_basis && BASIS_LABEL[k.allocation_basis].toLowerCase(), k.payable_due && pend > 0 && `vence ${formatDate(k.payable_due)}`].filter(Boolean).join(" · ")}</div>
                      </div>
                      <div className="text-right">
                        <div className="num font-medium">{formatMoney(k.amount_clp)}</div>
                        {k.currency_code !== "CLP" && <div className="num text-xs text-muted">{formatMoney(k.amount_minor, k.currency_code)}</div>}
                      </div>
                      {write && live && k.status === "vigente" && (
                        <div className="flex items-center gap-1">
                          {pend > 0 && can("dinero.registrar") && <IconButton icon={HandCoins} label="Pagar" size={15} onClick={() => setOpen({ k: "pay", cost: k })} />}
                          {k.payable_amount_minor === null && <IconButton icon={Pencil} label="Editar" size={15} onClick={() => setOpen({ k: "cost", cost: k })} />}
                          <IconButton icon={Trash2} label={k.is_estimate ? "Quitar" : "Anular"} size={15} onClick={() => setOpen({ k: "remove", cost: k })} />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
          <AttachmentsPanel link={{ entity: "importacion", uid: d.uid }} />
        </div>

        <aside className="flex flex-col gap-4">
          <Card title="Cómo se calcula">
            <dl className="flex flex-col gap-1.5 text-sm">
              <Row label="Mercadería en pesos" v={c.fob_clp} />
              <Row label="+ Flete" v={c.freight_clp} />
              <Row label="+ Seguro" v={c.insurance_clp} />
              {c.customs_freight_clp !== c.freight_clp && <p className="text-xs text-muted">Para Aduanas: mercadería {formatMoney(c.customs_fob_clp)} y flete {formatMoney(c.customs_freight_clp)} (el del documento de transporte).</p>}
              {c.notional_insurance_clp > 0 && <Row label={`+ Seguro teórico${d.notional_insurance_ppm ? ` (${d.notional_insurance_ppm / 10_000} %)` : ""}, solo aduana`} v={c.notional_insurance_clp} />}
              <Row label="= Valor aduanero (CIF)" v={c.customs_value_clp} strong />
              <Row label={`+ Derechos${c.duty_entered ? " (de la declaración)" : " (por arancel)"}`} v={c.duty_clp} />
              <Row label={`IVA de importación${c.vat_entered ? " (de la declaración)" : d.vat_ppm !== null ? ` (${d.vat_ppm / 10_000} %)` : ""}`} v={c.vat_clp} muted={c.vat_in_cost_clp === 0} />
              <Row label="+ Gastos locales" v={c.local_clp} />
              {c.notional_insurance_clp > 0 && <Row label="− Seguro teórico (no se paga)" v={c.notional_insurance_clp} />}
              <div className="mt-1 flex items-baseline justify-between border-t border-line pt-2"><dt className="font-semibold">Costo en bodega</dt><dd className="num text-lg font-semibold">{formatMoney(c.landed_clp)}</dd></div>
            </dl>
            {c.recoverable_clp > 0 && <p className="mt-2 text-xs text-muted">{formatMoney(c.recoverable_clp)} de impuestos se recuperan como crédito: se pagan, pero no suman al costo.</p>}
            {c.notes.map((n) => <p key={n} className="mt-1 text-xs text-warning">{n}</p>)}
            <p className="mt-2 text-xs text-muted">Reparto: {BASIS_LABEL[d.allocation_basis].toLowerCase()} (el seguro, por valor). Cálculo referencial pendiente de revisión por un contador.</p>
          </Card>
          {d.incoterm_info && (
            <Card title={`${d.incoterm_info.code} · ${d.incoterm_info.name}`}>
              <p className="text-sm text-ink">{d.incoterm_info.content.nota}</p>
              <p className="mt-2 text-xs text-muted">Riesgo: {d.incoterm_info.content.riesgo}</p>
              <button className="mt-2 text-[13px] font-medium text-accent hover:underline" onClick={() => navigate("/comex?tab=incoterms")}>Ver la guía de Incoterms</button>
            </Card>
          )}
          {d.eta_history.length > 0 && (
            <Card title="Cambios de fecha de llegada">
              <ol className="flex flex-col gap-2 text-sm">
                {d.eta_history.map((e, i) => (
                  <li key={i}>
                    <div className="text-ink">{e.old_eta ? <>{formatDate(e.old_eta)} → <strong>{formatDate(e.new_eta)}</strong> <span className={daysBetween(e.old_eta, e.new_eta) > 0 ? "text-warning" : "text-success"}>({daysBetween(e.old_eta, e.new_eta) > 0 ? "+" : ""}{daysBetween(e.old_eta, e.new_eta)} d)</span></> : <>ETA {formatDate(e.new_eta)}</>}</div>
                    <div className="text-xs text-muted">{[e.reason, e.changed_by, new Date(e.changed_at).toLocaleDateString("es-CL")].filter(Boolean).join(" · ")}</div>
                  </li>
                ))}
              </ol>
            </Card>
          )}
          <Card title="Historial">
            <ol className="flex flex-col gap-2 text-sm">{d.timeline.map((x, i) => <li key={i}><div className="text-ink">{x.text}</div><div className="num text-xs text-muted">{new Date(x.at).toLocaleString("es-CL")}</div></li>)}</ol>
          </Card>
        </aside>
      </div>

      {open?.k === "stage" && <StageDialog d={d} stage={open.stage} onClose={() => setOpen(null)} onDone={(x) => done(x, `Etapa: ${STAGE_LABEL[x.stage]}.`)} />}
      {open?.k === "eta" && <EtaDialog d={d} onClose={() => setOpen(null)} onDone={(x) => done(x, "Fecha de llegada actualizada.")} />}
      {open?.k === "cost" && <CostDialog d={d} cost={open.cost} onClose={() => setOpen(null)} onDone={(x) => done(x, open.cost ? "Costo actualizado." : "Costo agregado.")} />}
      {open?.k === "remove" && <RemoveCostDialog d={d} cost={open.cost} onClose={() => setOpen(null)} onDone={(x) => done(x, open.cost.is_estimate ? "Estimado quitado." : "Costo anulado.")} />}
      {open?.k === "pay" && (
        <PayDialog title={`Pagar ${COST_LABEL[open.cost.kind].toLowerCase()}`} due={(open.cost.payable_amount_minor ?? 0) - (open.cost.payable_paid_minor ?? 0)} onClose={() => setOpen(null)}
          onPay={async (amount, method, date, acc) => { const x = await backend.payImportCost(uid, open.cost.id, amount, method, date, acc); setD(x); setOpen(null); return "Pago registrado."; }} />
      )}
      {open?.k === "receive" && <ReceiveDialog d={d} onClose={() => setOpen(null)} onDone={(x) => done(x, x.stage === "recibida" ? "Mercadería recibida: stock y costo promedio actualizados." : "Recepción parcial registrada.")} />}
      {open?.k === "void" && <VoidDialog d={d} onClose={() => setOpen(null)} onDone={(x) => done(x, "Importación anulada.")} />}
    </div>
  );
}

function Metric({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "warning" | "success" }) {
  return (
    <div className="flex min-w-0 flex-col rounded-xl border border-line bg-surface p-4 shadow-card">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="num mt-2 text-[22px] font-semibold leading-tight text-ink">{value}</div>
      {hint && <div className={cx("mt-1 text-xs", tone === "warning" ? "text-warning" : tone === "success" ? "text-success" : "text-muted")}>{hint}</div>}
    </div>
  );
}

function Row({ label, v, strong, muted }: { label: string; v: number; strong?: boolean; muted?: boolean }) {
  return (
    <div className={cx("flex justify-between gap-3", strong && "font-medium")}>
      <dt className={strong ? "text-ink" : "text-muted"}>{label}</dt>
      <dd className={cx("num", muted && "text-faint line-through")}>{formatMoney(v)}</dd>
    </div>
  );
}

function Stepper({ d, onPick }: { d: ImportDetail; onPick?: (s: ImportStage) => void }) {
  const cur = STAGES.indexOf(d.stage);
  const list = useRef<HTMLOListElement>(null);
  // Muestra la etapa actual aunque la línea de tiempo no quepa entera.
  useEffect(() => {
    const el = list.current?.querySelector<HTMLElement>("[aria-current=step]");
    if (el && list.current) list.current.scrollLeft = Math.max(0, el.offsetLeft - list.current.clientWidth / 2 + el.clientWidth / 2);
  }, [d.stage]);
  const when = (s: ImportStage) => [...d.stage_history].reverse().find((h) => h.to_stage === s)?.changed_at;
  return (
    <Card padded={false}>
      <ol ref={list} className="relative flex gap-1 overflow-x-auto px-3 py-3" aria-label="Etapas de la importación">
        {STAGES.map((s, i) => {
          const isDone = d.stage !== "anulada" && i < cur;
          const isCur = s === d.stage;
          const pickable = onPick && MANUAL_STAGES.includes(s) && !isCur;
          const at = when(s);
          const body = (
            <>
              <span className={cx("flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold",
                isCur ? "border-accent bg-accent text-white" : isDone ? "border-success bg-success-soft text-success" : "border-line text-muted")}>
                {isDone ? <CheckCircle2 size={14} aria-hidden /> : i + 1}
              </span>
              <span className="min-w-0">
                <span className={cx("block whitespace-nowrap text-[12.5px]", isCur ? "font-semibold text-ink" : isDone ? "text-ink" : "text-muted")}>{STAGE_LABEL[s]}</span>
                <span className="block whitespace-nowrap text-[11px] text-faint">{at ? new Date(at).toLocaleDateString("es-CL", { day: "numeric", month: "short" }) : isCur ? "Ahora" : ""}</span>
              </span>
            </>
          );
          return (
            <li key={s} className="shrink-0">
              {pickable ? (
                <button title={STAGE_HINT[s]} aria-current={isCur ? "step" : undefined} onClick={() => onPick(s)} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface-2">{body}</button>
              ) : (
                <div title={STAGE_HINT[s]} aria-current={isCur ? "step" : undefined} className={cx("flex items-center gap-2 rounded-lg px-2 py-1.5", isCur && "bg-accent-soft")}>{body}</div>
              )}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function StageDialog({ d, stage, onClose, onDone }: { d: ImportDetail; stage: ImportStage; onClose: () => void; onDone: (d: ImportDetail) => void }) {
  const backend = useBackend();
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const back = STAGES.indexOf(stage) < STAGES.indexOf(d.stage);
  async function go() { setBusy(true); try { onDone(await backend.setImportStage(d.uid, stage, note || undefined)); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); } }
  return (
    <Dialog open onClose={onClose} title={d.stage === "cotizacion" ? "Confirmar el pedido" : `${back ? "Volver" : "Pasar"} a “${STAGE_LABEL[stage]}”`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button icon={Check} onClick={go} disabled={busy}>Confirmar</Button></>}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">{STAGE_HINT[stage]}.{d.stage === "cotizacion" ? " Desde ahora la mercadería cuenta como stock por llegar, y NÚCLEO guarda el costo estimado de hoy para compararlo con el real al cerrar." : ""}</p>
        {d.stage === "cotizacion" && <div className="rounded-lg bg-surface-2 px-4 py-3 text-sm"><div className="flex justify-between"><span className="text-muted">Costo estimado en bodega</span><span className="num font-semibold">{formatMoney(d.calc.landed_clp)}</span></div></div>}
        <Field label="Nota" optional value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej. pago 30 % anticipo, BL recibido…" />
        {err && <Notice tone="danger">{err}</Notice>}
      </div>
    </Dialog>
  );
}

function EtaDialog({ d, onClose, onDone }: { d: ImportDetail; onClose: () => void; onDone: (d: ImportDetail) => void }) {
  const backend = useBackend();
  const [eta, setEta] = useState(d.eta ?? addDays(todayIso(), 30));
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  async function go() { try { onDone(await backend.changeImportEta(d.uid, eta, reason || undefined)); } catch (e) { setErr(errorMessage(e)); } }
  const delta = d.eta ? daysBetween(d.eta, eta) : 0;
  return (
    <Dialog open onClose={onClose} title={d.eta ? "Cambiar fecha de llegada" : "Indicar fecha de llegada"}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button icon={CalendarClock} onClick={go} disabled={!eta || (!!d.eta && !reason.trim())}>Guardar</Button></>}>
      <div className="flex flex-col gap-4">
        <Field label="Nueva fecha estimada de llegada" type="date" value={eta} onChange={(e) => setEta(e.target.value)}
          hint={d.eta && delta !== 0 ? `${delta > 0 ? "+" : ""}${delta} días respecto de ${formatDate(d.eta)}` : undefined} />
        {d.eta && <TextArea label="Motivo del cambio" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej. transbordo, retraso de la naviera, inspección en aduana" />}
        <p className="text-xs text-muted">La fecha mueve el stock por llegar y el riesgo de quiebre de los productos. Cada cambio queda en el historial.</p>
        {err && <Notice tone="danger">{err}</Notice>}
      </div>
    </Dialog>
  );
}

function CostDialog({ d, cost, onClose, onDone }: { d: ImportDetail; cost?: ImportCost; onClose: () => void; onDone: (d: ImportDetail) => void }) {
  const backend = useBackend();
  const { can } = useSession();
  const [kind, setKind] = useState<CostKind>(cost?.kind ?? "flete");
  const [description, setDescription] = useState(cost?.description ?? "");
  const [currency, setCurrency] = useState(cost?.currency_code ?? (kind === "flete" ? d.currency_code : "CLP"));
  const [amount, setAmount] = useState<number | null>(cost?.amount_minor ?? null);
  const [rate, setRate] = useState<number | null>(cost?.rate_e6 ?? null);
  const [estimate, setEstimate] = useState<"estimado" | "real">(cost ? (cost.is_estimate ? "estimado" : "real") : d.stage === "cotizacion" ? "estimado" : "real");
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [newSupplier, setNewSupplier] = useState<string | null>(null);
  const [docRef, setDocRef] = useState(cost?.document_ref ?? "");
  const [date, setDate] = useState(cost?.cost_date ?? todayIso());
  const [basis, setBasis] = useState<Basis | "">(cost?.allocation_basis ?? "");
  const [recoverable, setRecoverable] = useState(cost?.recoverable_tax ?? false);
  const [payment, setPayment] = useState<"por_pagar" | "pagado" | "no_registrar">(can("dinero.registrar") ? "por_pagar" : "no_registrar");
  const [due, setDue] = useState(addDays(todayIso(), 30));
  const [method, setMethod] = useState(PAYMENT_METHODS[1]!);
  const [account, setAccount] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (cost?.supplier_uid) backend.supplier(cost.supplier_uid).then(setSupplier).catch(() => {}); }, [backend, cost?.supplier_uid]);
  const real = estimate === "real";
  const needsRate = currency !== "CLP" && currency !== d.currency_code;
  const hint = COST_KINDS.find((k) => k.value === kind)?.hint;
  // Aviso suave: un costo mucho mayor que la mercadería suele ser un error de moneda.
  const effRate = currency === "CLP" ? 1_000_000 : rate ?? (currency === d.currency_code ? d.rate_e6 : null);
  const clp = amount && effRate ? Math.round((amount / 10 ** (currency === "CLP" ? 0 : 2)) * (effRate / 1_000_000)) : 0;
  const suspicious = d.calc.fob_clp > 0 && clp > d.calc.fob_clp * 2;
  async function go() {
    const input: ImportCostInput = {
      kind, description: description.trim() || null, supplier_uid: supplier?.uid ?? null, currency_code: currency, amount_minor: amount ?? 0,
      rate_e6: currency === "CLP" ? null : rate, is_estimate: !real, recoverable_tax: recoverable, allocation_basis: basis || null,
      document_ref: docRef.trim() || null, cost_date: date || null, payment: real && !cost ? payment : null,
      due_date: real && payment === "por_pagar" ? due : null, paid_method: real && payment === "pagado" ? method : null,
      paid_account_uid: real && payment === "pagado" && account ? account : null,
    };
    setBusy(true); setErr(null);
    try { onDone(cost ? await backend.updateImportCost(d.uid, cost.id, input) : await backend.addImportCost(d.uid, input)); }
    catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <>
      <Dialog open={newSupplier === null} onClose={onClose} title={cost ? `Editar ${COST_LABEL[cost.kind].toLowerCase()}` : "Agregar costo"} size="lg"
        footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button onClick={go} disabled={busy || !amount}>{cost ? "Guardar" : "Agregar costo"}</Button></>}>
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Tipo de costo" value={kind} onChange={(e) => {
              const k = e.target.value as CostKind; setKind(k);
              if (k === "iva_importacion") setRecoverable(d.vat_recoverable);
              if (!cost) setCurrency(k === "flete" ? d.currency_code : "CLP");
            }} options={COST_KINDS.map((k) => ({ value: k.value, label: k.label }))} hint={hint || undefined} />
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-ink">¿Es el monto real?</span>
              <Segmented label="Estimado o real" value={estimate} onChange={setEstimate} options={[{ value: "estimado", label: "Estimado" }, { value: "real", label: "Real (tengo la factura)" }]} />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Select label="Moneda" value={currency} onChange={(e) => setCurrency(e.target.value)} options={[...new Set(["CLP", d.currency_code, "USD"])].map((c) => ({ value: c, label: c }))} />
            <MoneyField label="Monto" currency={currency} value={amount} onValue={setAmount} data-autofocus />
            {currency !== "CLP" && <RateField label={needsRate ? "Tipo de cambio" : "Tipo de cambio (opcional)"} rate={rate} onRate={setRate} currency={currency} hint={needsRate ? undefined : `Vacío = el de la importación (${formatRate(d.rate_e6)})`} />}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Descripción" optional value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ej. flete LCL Ningbo–San Antonio" />
            <Select label="Repartir entre productos" value={basis} onChange={(e) => setBasis(e.target.value as Basis | "")}
              options={[{ value: "", label: `Según la importación (${BASIS_LABEL[kind === "seguro" ? "valor" : d.allocation_basis].toLowerCase()})` }, ...(["valor", "peso", "unidades"] as Basis[]).map((b) => ({ value: b, label: BASIS_LABEL[b] }))]}
              disabled={kind === "derechos" || kind === "iva_importacion"} />
          </div>
          {clp > 0 && currency !== "CLP" && <p className="-mt-2 text-xs text-muted">Equivale a {formatMoney(clp)}.</p>}
          {suspicious && <Notice tone="warning">Este costo ({formatMoney(clp)}) es más del doble del valor de la mercadería. Revisa la moneda y el monto.</Notice>}
          {(kind === "iva_importacion" || kind === "agente_aduana" || kind === "otros") && (
            <Checkbox label="Es un impuesto que recupero como crédito" hint="Se informa pero no suma al costo del producto." checked={recoverable} onChange={setRecoverable} />
          )}
          {real && (
            <>
              <div className="flex flex-col gap-1.5">
                <span className="text-[13px] font-medium text-ink">Quién lo cobra <span className="font-normal text-muted">(opcional)</span></span>
                <SupplierPicker value={supplier} onChange={setSupplier} onCreate={(n) => setNewSupplier(n)} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Nº de factura o documento" optional value={docRef} onChange={(e) => setDocRef(e.target.value)} placeholder="Ej. F-1001, DIN 51234" />
                <Field label="Fecha" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              {!cost && can("dinero.registrar") && (
                <div className="flex flex-col gap-3 rounded-lg border border-line p-4">
                  <span className="text-[13px] font-medium text-ink">En Dinero</span>
                  <Segmented label="Pago" value={payment} onChange={setPayment} options={[{ value: "por_pagar", label: "Queda por pagar" }, { value: "pagado", label: "Ya lo pagué" }, { value: "no_registrar", label: "No llevar a Dinero" }]} />
                  {payment === "por_pagar" && <Field label="Vence" type="date" value={due} onChange={(e) => setDue(e.target.value)} />}
                  {payment === "pagado" && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Select label="Medio de pago" value={method} onChange={(e) => setMethod(e.target.value)} options={PAYMENT_METHODS.map((m) => ({ value: m, label: m }))} />
                      <AccountSelect value={account} onChange={setAccount} method={method} label="Sale de la cuenta" />
                    </div>
                  )}
                  {payment === "no_registrar" && <p className="text-xs text-muted">Úsalo si ya registraste este pago como gasto o compra: así no se duplica.</p>}
                </div>
              )}
            </>
          )}
          {err && <Notice tone="danger">{err}</Notice>}
        </div>
      </Dialog>
      <SupplierFormDrawer open={newSupplier !== null} initialName={newSupplier ?? ""} onClose={() => setNewSupplier(null)} onSaved={(s) => { setSupplier(s); setNewSupplier(null); }} />
    </>
  );
}

function RemoveCostDialog({ d, cost, onClose, onDone }: { d: ImportDetail; cost: ImportCost; onClose: () => void; onDone: (d: ImportDetail) => void }) {
  const backend = useBackend();
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  async function go() { try { onDone(await backend.removeImportCost(d.uid, cost.id, reason || undefined)); } catch (e) { setErr(errorMessage(e)); } }
  return (
    <Dialog open onClose={onClose} title={cost.is_estimate ? `Quitar ${COST_LABEL[cost.kind].toLowerCase()} estimado` : `Anular ${COST_LABEL[cost.kind].toLowerCase()}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="danger" icon={Trash2} onClick={go} disabled={!cost.is_estimate && !reason.trim()}>{cost.is_estimate ? "Quitar" : "Anular costo"}</Button></>}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">{cost.is_estimate ? "El estimado deja de sumar al costo de la importación." : `Los costos reales no se borran: queda anulado con su motivo${cost.payments.length ? ", y sus pagos se anulan (el dinero vuelve a la cuenta)" : ""}.`}</p>
        {!cost.is_estimate && <TextArea label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej. factura mal digitada" />}
        {err && <Notice tone="danger">{err}</Notice>}
      </div>
    </Dialog>
  );
}

function ReceiveDialog({ d, onClose, onDone }: { d: ImportDetail; onClose: () => void; onDone: (d: ImportDetail) => void }) {
  const backend = useBackend();
  const pendingItems = d.items.filter((i) => i.product_uid && i.received_milli < i.qty_milli);
  const [qty, setQty] = useState<Record<number, string>>(() => Object.fromEntries(pendingItems.map((i) => [i.id, formatQty(i.qty_milli - i.received_milli)])));
  const [date, setDate] = useState(todayIso());
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function go() {
    const lines = pendingItems.map((i) => ({ item_id: i.id, qty_milli: parseQty(qty[i.id] ?? "") ?? -1 }));
    if (lines.some((l) => l.qty_milli < 0)) { setErr("Revisa las cantidades: escribe solo números."); return; }
    setBusy(true);
    try { onDone(await backend.receiveImport(d.uid, lines, date)); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open onClose={onClose} title="Recibir mercadería en bodega" size="lg"
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button icon={PackageCheck} onClick={go} disabled={busy}>Registrar recepción</Button></>}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">Entra a la bodega principal al costo puesto en bodega de cada producto. Si llegó una parte, indica solo esa cantidad.</p>
        {d.has_estimates && <Notice tone="warning">Hay costos estimados: el stock entrará con el costo calculado hoy. Lo ideal es registrar los montos reales antes de recibir.</Notice>}
        <table className="w-full text-sm">
          <thead><tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-muted"><th className="py-2">Producto</th><th className="px-2 text-right">Pendiente</th><th className="px-2 text-right">Costo unit.</th><th className="w-32 text-right">Llegó</th></tr></thead>
          <tbody>
            {pendingItems.map((i) => {
              const b = d.calc.items[d.items.indexOf(i)];
              return (
                <tr key={i.id} className="border-b border-line">
                  <td className="py-2 text-ink">{i.description}</td>
                  <td className="num px-2 text-right text-muted">{formatQty(i.qty_milli - i.received_milli)}</td>
                  <td className="num px-2 text-right">{unit(b?.unit_cost_e4)}</td>
                  <td className="py-1.5"><input aria-label={`Cantidad recibida de ${i.description}`} inputMode="decimal" value={qty[i.id] ?? ""} onChange={(e) => setQty({ ...qty, [i.id]: e.target.value })} className="num h-8 w-full rounded-md border border-line bg-surface px-2 text-right focus:border-accent focus:outline-none" /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <Field label="Fecha de recepción" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="max-w-xs" />
        {err && <Notice tone="danger">{err}</Notice>}
      </div>
    </Dialog>
  );
}

function VoidDialog({ d, onClose, onDone }: { d: ImportDetail; onClose: () => void; onDone: (d: ImportDetail) => void }) {
  const backend = useBackend();
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  async function go() { try { onDone(await backend.voidImport(d.uid, reason)); } catch (e) { setErr(errorMessage(e)); } }
  const paid = d.costs.some((k) => k.status === "vigente" && k.payments.length > 0);
  return (
    <Dialog open onClose={onClose} title={`Anular ${d.number}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="danger" icon={Ban} onClick={go} disabled={!reason.trim()}>Anular importación</Button></>}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">La importación deja de contar como stock por llegar. Sus costos reales se anulan{paid ? " y sus pagos también (el dinero vuelve a la cuenta)" : ""}. Nada se borra.</p>
        <TextArea label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej. el proveedor no confirmó el pedido" />
        {err && <Notice tone="danger">{err}</Notice>}
      </div>
    </Dialog>
  );
}
