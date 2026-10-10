// Liquidación de una persona en un mes: lo que cambia ese mes, la liquidación explicada línea por
// línea, emisión (con fecha de pago → código 48 del F29), anulación e impresión con el logo.
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, Ban, Info, Printer, RotateCcw, Save, Send } from "lucide-react";
import { useBackend, errorMessage, type BusinessSettings, type PayslipMonth, type PayslipView } from "../../data";
import { computePayslip, type PayLine, type PayslipResult } from "../../data/payroll";
import { formatDate, formatMoney, formatRut } from "../../lib/format";
import { goBack, navigate } from "../../lib/router";
import { useSession } from "../../lib/session";
import { MoneyField } from "../../ui/doc";
import { Button, Card, cx, Field, Notice, PageHeader, Spinner, TextArea } from "../../ui/kit";
import { Dialog, useToast } from "../../ui/overlay";
import { PrintIssuer } from "../ventas/PrintDoc";
import { CONTRACT_LABEL, ItemsEditor, ScaledField, SlipBadge, periodLabel } from "./common";

/** Recalcula en vivo con lo que se está editando (mismo cálculo que el escritorio). */
function livePreview(view: PayslipView, month: PayslipMonth): PayslipResult {
  const t = view.worker.terms;
  const input = {
    ...view.input,
    days: month.days ?? view.days_suggested,
    overtime_hours_e2: month.overtime_hours_e2,
    items: [...t.items, ...month.items],
    deductions: [...t.deductions, ...month.deductions],
    advance: month.advance,
  };
  const r = computePayslip(input);
  // Avisos que agrega el escritorio (indicadores sin confirmar, AFP sin tasa): se conservan.
  const base = new Set(computePayslip(view.input).notes.map((n) => n.text));
  const extra = view.result.notes.filter((n) => !base.has(n.text));
  r.notes = [...extra, ...r.notes];
  if (extra.some((n) => n.severity === "falta")) r.complete = false;
  return r;
}

export function Liquidacion({ workerId, period }: { workerId: number; period: string }) {
  const backend = useBackend();
  const toast = useToast();
  const { can } = useSession();
  const [view, setView] = useState<PayslipView | null>(null);
  const [month, setMonth] = useState<PayslipMonth | null>(null);
  const [biz, setBiz] = useState<BusinessSettings | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<null | "emit" | "void" | "print">(null);
  const apply = (v: PayslipView) => { setView(v); setMonth(v.month); };
  const load = useCallback(() => { backend.payslip(workerId, period).then(apply).catch((e) => setErr(errorMessage(e))); }, [backend, workerId, period]);
  useEffect(load, [load]);
  useEffect(() => { backend.business().then(setBiz).catch(() => {}); }, [backend]);
  const editable = !!view && (view.status === "nueva" || view.status === "borrador") && can("remuneraciones.editar");
  const result = useMemo(() => (view && month && editable ? livePreview(view, month) : view?.result ?? null), [view, month, editable]);
  if (err) return <Notice tone="danger">{err}</Notice>;
  if (!view || !month || !result) return <Spinner />;
  const dirty = JSON.stringify(month) !== JSON.stringify(view.month);
  const w = view.worker;

  async function run(fn: () => Promise<PayslipView>, ok: string) {
    setBusy(true);
    try { apply(await fn()); toast("success", ok); setDialog(null); } catch (e) { toast("danger", errorMessage(e)); } finally { setBusy(false); }
  }

  const title = w.is_owner ? "Liquidación de sueldo empresarial" : "Liquidación de sueldo";
  const falta = result.notes.filter((n) => n.severity === "falta");
  const avisos = result.notes.filter((n) => n.severity === "aviso");
  const infos = result.notes.filter((n) => n.severity === "info");

  return (
    <>
      <PrintPayslip view={{ ...view, result }} biz={biz} />
      <div className="anim-in print:hidden">
        <PageHeader
          back={<button onClick={() => goBack(`/remuneraciones?periodo=${period}`)} className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft size={15} /> Remuneraciones</button>}
          title={<span className="flex flex-wrap items-center gap-3">{w.name}<SlipBadge status={view.status} complete={result.complete} /></span>}
          subtitle={`${title} · ${periodLabel(period)}${view.pay_date ? ` · pagada el ${formatDate(view.pay_date)}` : ""}`}
          actions={
            <>
              {editable && dirty && <Button variant="secondary" icon={Save} disabled={busy} onClick={() => run(() => backend.savePayslip(workerId, period, month), "Borrador guardado.")}>Guardar borrador</Button>}
              {editable && <Button icon={Send} disabled={busy || !result.complete} onClick={() => setDialog("emit")}>Emitir</Button>}
              {view.status !== "nueva" && <Button variant="secondary" icon={Printer} onClick={() => (backend.kind === "tauri" ? window.print() : setDialog("print"))}>Imprimir</Button>}
              {view.status === "emitida" && can("remuneraciones.editar") && <Button variant="ghost" icon={Ban} onClick={() => setDialog("void")}>Anular</Button>}
              {view.status === "anulada" && can("remuneraciones.editar") && <Button variant="secondary" icon={RotateCcw} onClick={load}>Preparar otra</Button>}
            </>
          }
        />
        {view.status === "anulada" && <div className="mb-4"><Notice tone="warning" title="Liquidación anulada">{view.void_reason}</Notice></div>}
        {falta.length > 0 && (
          <div className="mb-4"><Notice tone="danger" title="Falta información para emitir">
            <ul className="list-disc pl-5">{falta.map((n) => <li key={n.text}>{n.text}</li>)}</ul>
            {!view.indicators_saved && <button type="button" className="mt-1 font-medium text-accent hover:underline" onClick={() => navigate(`/remuneraciones?tab=indicadores&periodo=${period}`)}>Ir a los indicadores del mes</button>}
          </Notice></div>
        )}
        {avisos.length > 0 && <div className="mb-4"><Notice tone="warning" title="Revisa"><ul className="list-disc pl-5">{avisos.map((n) => <li key={n.text}>{n.text}</li>)}</ul></Notice></div>}

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="flex min-w-0 flex-col gap-6">
            <Card title="Liquidación" subtitle="Cada monto explica de dónde sale">
              <div className="grid gap-6 lg:grid-cols-2">
                <Section title="Haberes imponibles" lines={result.taxable_earnings} total={result.total_taxable} totalLabel="Total imponible" />
                <Section title="Descuentos legales" lines={result.legal_deductions} total={result.legal_deductions.reduce((a, l) => a + l.amount, 0)} totalLabel="Total cotizaciones e impuesto" />
                {result.other_earnings.length > 0 && <Section title="Haberes no imponibles" lines={result.other_earnings} />}
                {result.other_deductions.length > 0 && <Section title="Otros descuentos" lines={result.other_deductions} />}
              </div>
              <div className="mt-6 grid gap-2 rounded-lg bg-surface-2 p-4 text-sm">
                <Row label="Total haberes" value={result.total_earnings} />
                <Row label="Total descuentos" value={-result.total_deductions} />
                <Row label="Alcance líquido" value={result.net} strong />
                {result.advance > 0 && <Row label="Anticipo" value={-result.advance} />}
                <div className="mt-1 flex items-baseline justify-between border-t border-line pt-2">
                  <span className="text-[15px] font-semibold text-ink">Líquido a pagar</span>
                  <span className="num text-[22px] font-semibold text-ink">{formatMoney(result.to_pay)}</span>
                </div>
              </div>
              <p className="mt-3 text-xs text-muted">Base del impuesto único: {formatMoney(result.tax_base)}{result.tax_bracket ? ` · tramo ${result.tax_bracket}` : ""}
                {result.cap_pension ? ` · tope imponible ${formatMoney(result.cap_pension)}` : ""}</p>
            </Card>
            {infos.length > 0 && <Notice tone="info" title="Para que sepas"><ul className="list-disc pl-5">{infos.map((n) => <li key={n.text}>{n.text}</li>)}</ul></Notice>}
          </div>

          <div className="flex flex-col gap-6">
            {editable ? (
              <Card title="Este mes" subtitle="Lo que cambia respecto de su ficha">
                <div className="flex flex-col gap-4">
                  <div className="grid grid-cols-2 gap-3">
                    <ScaledField label="Días trabajados" scale={1} value={month.days} placeholder={String(view.days_suggested)}
                      onValue={(v) => setMonth({ ...month, days: v })} hint={`Mes de 30 días; por fechas: ${view.days_suggested}`} />
                    {!w.is_owner && <ScaledField label="Horas extra" scale={100} value={month.overtime_hours_e2 || null} onValue={(v) => setMonth({ ...month, overtime_hours_e2: v ?? 0 })} />}
                  </div>
                  <div>
                    <h3 className="mb-2 text-sm font-semibold text-ink">Haberes del mes</h3>
                    <ItemsEditor kind="haber" items={month.items} onChange={(items) => setMonth({ ...month, items })} />
                  </div>
                  <div>
                    <h3 className="mb-2 text-sm font-semibold text-ink">Descuentos del mes</h3>
                    <ItemsEditor kind="descuento" items={month.deductions} onChange={(deductions) => setMonth({ ...month, deductions })} />
                  </div>
                  <MoneyField label="Anticipo pagado en el mes" value={month.advance || null} onValue={(v) => setMonth({ ...month, advance: v ?? 0 })} />
                  {view.status === "borrador" && <Button variant="ghost" size="sm" icon={RotateCcw} disabled={busy} onClick={() => run(() => backend.discardPayslip(workerId, period), "Borrador descartado.")}>Descartar borrador</Button>}
                </div>
              </Card>
            ) : null}
            <Card title="Costo para la empresa" subtitle="Aportes del empleador: no se descuentan, se pagan en Previred">
              <div className="flex flex-col gap-2 text-sm">
                {result.employer.length === 0 && <p className="text-muted">Sin aportes del empleador este mes.</p>}
                {result.employer.map((l) => <Line key={l.key + l.label} l={l} />)}
                <div className="mt-1 flex justify-between border-t border-line pt-2 font-semibold"><span>Total haberes + aportes</span><span className="num">{formatMoney(result.employer_cost)}</span></div>
              </div>
            </Card>
            <Card title="Ficha">
              <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-sm">
                <dt className="text-muted">RUT</dt><dd>{formatRut(w.rut)}</dd>
                <dt className="text-muted">Contrato</dt><dd>{CONTRACT_LABEL[w.terms.contract]}</dd>
                <dt className="text-muted">AFP</dt><dd>{w.terms.afp ?? "No cotiza"}</dd>
                <dt className="text-muted">Salud</dt><dd>{w.terms.health === "isapre" ? `Isapre ${w.terms.health_name ?? ""}` : w.terms.health === "fonasa" ? "Fonasa" : "No cotiza"}</dd>
                <dt className="text-muted">Indicadores</dt><dd className="line-clamp-3" title={view.indicators_source ?? undefined}>{view.indicators_source ?? (view.indicators_saved ? "Guardados" : "Sin confirmar")}</dd>
              </dl>
              {editable && <p className="mt-3 text-xs text-muted">Para cambiar el sueldo o la previsión, edita la persona en la pestaña Personas.</p>}
            </Card>
          </div>
        </div>
      </div>

      <EmitDialog open={dialog === "emit"} onClose={() => setDialog(null)} view={view} result={result} busy={busy}
        onEmit={async (payDate) => {
          setBusy(true);
          try {
            if (dirty) await backend.savePayslip(workerId, period, month);
            apply(await backend.emitPayslip(workerId, period, payDate));
            toast("success", "Liquidación emitida. Su impuesto único ya está en el F29 del mes de pago.");
            setDialog(null);
          } catch (e) { toast("danger", errorMessage(e)); } finally { setBusy(false); }
        }} />
      <VoidDialog open={dialog === "void"} onClose={() => setDialog(null)} busy={busy}
        onVoid={(reason) => run(() => backend.voidPayslip(view.id!, reason), "Liquidación anulada.")} />
      <Dialog open={dialog === "print"} onClose={() => setDialog(null)} title="Vista previa de impresión" size="lg">
        <div className="overflow-x-auto rounded-lg border border-line bg-white p-4"><div className="min-w-[560px]"><PrintPayslip view={{ ...view, result }} biz={biz} preview /></div></div>
        <p className="mt-3 text-xs text-muted">En el programa instalado, “Imprimir” abre el diálogo de Windows para imprimir o guardar en PDF.</p>
      </Dialog>
    </>
  );
}

function Row({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return <div className={cx("flex justify-between", strong && "font-semibold text-ink")}><span>{label}</span><span className="num">{value < 0 ? `−${formatMoney(-value)}` : formatMoney(value)}</span></div>;
}

function Line({ l }: { l: PayLine }) {
  return (
    <div>
      <div className="flex justify-between gap-3"><span className="text-ink">{l.label}</span><span className="num">{formatMoney(l.amount)}</span></div>
      {l.detail && <div className="text-xs text-muted">{l.detail}</div>}
    </div>
  );
}

function Section({ title, lines, total, totalLabel }: { title: string; lines: PayLine[]; total?: number; totalLabel?: string }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
      <div className="flex flex-col gap-2 text-sm">
        {lines.map((l, i) => <Line key={i} l={l} />)}
        {total !== undefined && <div className="flex justify-between border-t border-line pt-1.5 font-medium text-ink"><span>{totalLabel}</span><span className="num">{formatMoney(total)}</span></div>}
      </div>
    </div>
  );
}

function EmitDialog({ open, onClose, view, result, busy, onEmit }: {
  open: boolean; onClose: () => void; view: PayslipView; result: PayslipResult; busy: boolean; onEmit: (payDate: string) => void;
}) {
  const [payDate, setPayDate] = useState(view.default_pay_date);
  useEffect(() => { if (open) setPayDate(view.default_pay_date); }, [open, view.default_pay_date]);
  return (
    <Dialog open={open} onClose={onClose} title="Emitir liquidación"
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button icon={Send} disabled={busy || !payDate} onClick={() => onEmit(payDate)}>Emitir</Button></>}>
      <div className="flex flex-col gap-4">
        <Field label="Fecha de pago" type="date" value={payDate} min={`${view.period}-01`} onChange={(e) => setPayDate(e.target.value)} hint="El día en que pagas (o pagarás) el líquido" />
        <Notice tone="info" icon={Info} title={`Impuesto único: ${formatMoney(result.tax)}`}>
          Se suma al código 48 del F29 de <strong className="capitalize">{payDate ? periodLabel(payDate.slice(0, 7)) : "—"}</strong>, que declaras el mes siguiente.
          Una vez emitida, la liquidación no cambia aunque cambien los datos de la persona; para corregirla, se anula y se prepara otra.
        </Notice>
        <div className="flex justify-between text-sm"><span>Líquido a pagar</span><strong className="num">{formatMoney(result.to_pay)}</strong></div>
      </div>
    </Dialog>
  );
}

function VoidDialog({ open, onClose, busy, onVoid }: { open: boolean; onClose: () => void; busy: boolean; onVoid: (r: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <Dialog open={open} onClose={onClose} title="Anular liquidación"
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="danger" icon={Ban} disabled={busy || reason.trim().length < 3} onClick={() => onVoid(reason)}>Anular</Button></>}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted">Su impuesto único sale del F29 del mes de pago. Si ese F29 ya está marcado como declarado, primero hay que reabrirlo.</p>
        <TextArea label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
    </Dialog>
  );
}

/* ───────────── Formato imprimible ───────────── */

function PrintPayslip({ view, biz, preview = false }: { view: PayslipView; biz: BusinessSettings | null; preview?: boolean }) {
  const r = view.result, w = view.worker;
  const rows = (ls: PayLine[]) => ls.map((l, i) => <div key={i} className="flex justify-between gap-3"><span>{l.label}</span><span>{formatMoney(l.amount)}</span></div>);
  return (
    <article className={`${preview ? "block" : "hidden print:block"} bg-white p-2 text-[12px] leading-snug text-black`} aria-hidden={!preview}>
      <header className="flex items-start justify-between gap-6 border-b-2 border-black pb-3">
        <PrintIssuer biz={biz} />
        <div className="min-w-[220px] border-2 border-black p-3 text-center">
          <div className="text-[14px] font-bold tracking-wide">{w.is_owner ? "LIQUIDACIÓN DE SUELDO EMPRESARIAL" : "LIQUIDACIÓN DE SUELDO"}</div>
          <div className="mt-1 text-[13px] font-bold capitalize">{periodLabel(view.period)}</div>
          {view.status === "anulada" && <div className="mt-1 text-[11px] font-bold text-red-700">ANULADA</div>}
        </div>
      </header>
      <section className="mt-3 grid grid-cols-2 gap-x-6 gap-y-0.5">
        <div><strong>Nombre:</strong> {w.name}</div>
        <div><strong>RUT:</strong> {formatRut(w.rut)}</div>
        {w.position && <div><strong>Cargo:</strong> {w.position}</div>}
        <div><strong>Fecha de ingreso:</strong> {formatDate(w.start_date)}</div>
        <div><strong>Días trabajados:</strong> {view.input.days}</div>
        <div><strong>AFP:</strong> {w.terms.afp ?? "No cotiza"}</div>
        <div><strong>Salud:</strong> {w.terms.health === "isapre" ? `Isapre ${w.terms.health_name ?? ""}` : w.terms.health === "fonasa" ? "Fonasa" : "No cotiza"}</div>
        {view.pay_date && <div><strong>Fecha de pago:</strong> {formatDate(view.pay_date)}</div>}
      </section>
      <section className="mt-4 grid grid-cols-2 gap-6">
        <div>
          <div className="mb-1 border-b border-black font-bold">HABERES</div>
          {rows(r.taxable_earnings)}
          <div className="flex justify-between border-t border-neutral-400 font-semibold"><span>Total imponible</span><span>{formatMoney(r.total_taxable)}</span></div>
          {r.other_earnings.length > 0 && <div className="mt-2">{rows(r.other_earnings)}</div>}
          <div className="mt-1 flex justify-between border-t border-black font-bold"><span>TOTAL HABERES</span><span>{formatMoney(r.total_earnings)}</span></div>
        </div>
        <div>
          <div className="mb-1 border-b border-black font-bold">DESCUENTOS</div>
          {rows(r.legal_deductions)}
          {r.other_deductions.length > 0 && <div className="mt-2">{rows(r.other_deductions)}</div>}
          <div className="mt-1 flex justify-between border-t border-black font-bold"><span>TOTAL DESCUENTOS</span><span>{formatMoney(r.total_deductions)}</span></div>
        </div>
      </section>
      <section className="mt-4 ml-auto w-72">
        <div className="flex justify-between"><span>Alcance líquido</span><span>{formatMoney(r.net)}</span></div>
        {r.advance > 0 && <div className="flex justify-between"><span>Anticipo</span><span>−{formatMoney(r.advance)}</span></div>}
        <div className="mt-1 flex justify-between border-t-2 border-black pt-1 text-[14px] font-bold"><span>LÍQUIDO A PAGAR</span><span>{formatMoney(r.to_pay)}</span></div>
      </section>
      <p className="mt-2 text-[10px] text-neutral-700">Base tributable {formatMoney(r.tax_base)}{r.cap_pension ? ` · tope imponible ${formatMoney(r.cap_pension)}` : ""}</p>
      <section className="mt-14 grid grid-cols-2 gap-16 text-center">
        <div className="border-t border-black pt-1">Empleador</div>
        <div className="border-t border-black pt-1">{w.name}<div className="text-[10px]">Recibí conforme el líquido de esta liquidación</div></div>
      </section>
      <footer className="mt-8 border-t border-black pt-2 text-center text-[10px]">
        <div>Liquidación preparada con NÚCLEO ERP: revísala antes de firmar y pagar. Las cotizaciones se pagan en Previred.</div>
        <div className="mt-1 text-neutral-600">www.nucleoerp.cl</div>
      </footer>
    </article>
  );
}

export function LiquidacionRoute({ id, period }: { id: string; period: string | null }) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0 || !period || !/^\d{4}-\d{2}$/.test(period)) {
    return <Notice tone="danger" icon={AlertTriangle}>Liquidación no encontrada.</Notice>;
  }
  return <Liquidacion key={`${n}-${period}`} workerId={n} period={period} />;
}

