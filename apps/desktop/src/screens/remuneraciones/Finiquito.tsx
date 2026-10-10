// Calculadora de finiquito: feriado, aviso previo, años de servicio u obra/faena, con explicación y
// formato imprimible. No se guarda: se imprime y se firma ante un ministro de fe.
import { useEffect, useState } from "react";
import { ArrowLeft, Printer } from "lucide-react";
import { useBackend, errorMessage, type BusinessSettings, type SeveranceForm, type SeveranceView } from "../../data";
import type { PayLine } from "../../data/payroll";
import { CAUSE_LABEL, type Cause } from "../../data/severance";
import { formatDate, formatMoney, formatRut, todayIso } from "../../lib/format";
import { goBack } from "../../lib/router";
import { MoneyField } from "../../ui/doc";
import { Button, Card, Checkbox, Field, Notice, PageHeader, Select, Spinner } from "../../ui/kit";
import { Dialog } from "../../ui/overlay";
import { PrintIssuer } from "../ventas/PrintDoc";
import { ItemsEditor, ScaledField } from "./common";

const dec2 = (e2: number) => new Intl.NumberFormat("es-CL", { maximumFractionDigits: 2 }).format(e2 / 100);

export function Finiquito({ workerId }: { workerId: number }) {
  const backend = useBackend();
  const [form, setForm] = useState<SeveranceForm>({
    end_date: todayIso(), cause: "necesidades_empresa", notice_given: false, base_172: null, vacation_base: null,
    pending_vacation_days_e2: 0, vacation_taken_days_e2: 0, afc_offset: 0, deductions: [],
  });
  const [view, setView] = useState<SeveranceView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [biz, setBiz] = useState<BusinessSettings | null>(null);
  const [preview, setPreview] = useState(false);
  useEffect(() => { backend.business().then(setBiz).catch(() => {}); }, [backend]);
  useEffect(() => {
    const t = setTimeout(() => { backend.severance(workerId, form).then((v) => { setView(v); setErr(null); }).catch((e) => setErr(errorMessage(e))); }, 150);
    return () => clearTimeout(t);
  }, [backend, workerId, form]);
  if (!view && err) return <Notice tone="danger">{err}</Notice>;
  if (!view) return <Spinner />;
  const r = view.result, w = view.worker;
  const set = (p: Partial<SeveranceForm>) => setForm((f) => ({ ...f, ...p }));
  const is161 = form.cause === "necesidades_empresa" || form.cause === "desahucio";
  const falta = r.notes.filter((n) => n.severity === "falta"), avisos = r.notes.filter((n) => n.severity === "aviso"), infos = r.notes.filter((n) => n.severity === "info");

  return (
    <>
      <PrintSeverance view={view} biz={biz} />
      <div className="anim-in print:hidden">
        <PageHeader
          back={<button onClick={() => goBack("/remuneraciones?tab=personas")} className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft size={15} /> Remuneraciones</button>}
          title={`Finiquito de ${w.name}`}
          subtitle={`Ingreso el ${formatDate(w.start_date)} · antigüedad ${r.service_years} año(s), ${r.service_months} mes(es) y ${r.service_days} día(s)`}
          actions={<Button variant="secondary" icon={Printer} onClick={() => (backend.kind === "tauri" ? window.print() : setPreview(true))}>Imprimir</Button>}
        />
        {err && <div className="mb-4"><Notice tone="danger">{err}</Notice></div>}
        {falta.length > 0 && <div className="mb-4"><Notice tone="danger" title="Falta información"><ul className="list-disc pl-5">{falta.map((n) => <li key={n.text}>{n.text}</li>)}</ul></Notice></div>}
        {avisos.length > 0 && <div className="mb-4"><Notice tone="warning" title="Revisa"><ul className="list-disc pl-5">{avisos.map((n) => <li key={n.text}>{n.text}</li>)}</ul></Notice></div>}
        <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
          <Card title="Término">
            <div className="flex flex-col gap-4">
              <Field label="Último día trabajado" type="date" value={form.end_date} min={w.start_date} onChange={(e) => e.target.value && set({ end_date: e.target.value })} />
              <Select label="Causal" value={form.cause ?? ""} onChange={(e) => set({ cause: e.target.value as Cause })}
                options={(Object.keys(CAUSE_LABEL) as Cause[]).map((c) => ({ value: c, label: CAUSE_LABEL[c] }))} />
              {is161 && <Checkbox label="Se dio aviso por escrito con 30 días de anticipación" checked={form.notice_given} onChange={(v) => set({ notice_given: v })} />}
              <MoneyField label="Última remuneración mensual" value={form.base_172} placeholder={formatMoney(view.suggested_base)} onValue={(v) => set({ base_172: v })}
                hint="Sueldo y haberes fijos; sin horas extra ni asignación familiar (art. 172). Vacío = lo de la ficha." />
              <MoneyField label="Remuneración para el feriado" value={form.vacation_base} placeholder={formatMoney(w.terms.base_salary)} onValue={(v) => set({ vacation_base: v })} hint="Sueldo íntegro (art. 71)" />
              <div className="grid grid-cols-2 gap-3">
                <ScaledField label="Feriado pendiente" scale={100} suffix="días" value={form.pending_vacation_days_e2 || null} onValue={(v) => set({ pending_vacation_days_e2: v ?? 0 })} hint="Hábiles de años anteriores" />
                <ScaledField label="Ya tomados este año" scale={100} suffix="días" value={form.vacation_taken_days_e2 || null} onValue={(v) => set({ vacation_taken_days_e2: v ?? 0 })} hint="Hábiles" />
              </div>
              {is161 && <MoneyField label="Aporte del empleador a la AFC" value={form.afc_offset || null} onValue={(v) => set({ afc_offset: v ?? 0 })} hint="Del certificado de la AFC; se descuenta de los años de servicio" />}
              <div>
                <h3 className="mb-2 text-sm font-semibold text-ink">Otros descuentos</h3>
                <ItemsEditor kind="descuento" items={form.deductions} onChange={(deductions) => set({ deductions })} />
              </div>
            </div>
          </Card>
          <div className="flex min-w-0 flex-col gap-6">
            <Card title="Finiquito" subtitle={`Indicadores de ${view.indicators_period}${r.lre_cause != null ? ` · causal LRE ${r.lre_cause}` : ""}`}>
              <div className="flex flex-col gap-3 text-sm">
                {r.earnings.length === 0 && <p className="text-muted">Con estos datos no corresponden indemnizaciones.</p>}
                {r.earnings.map((l) => <Line key={l.key} l={l} />)}
                {r.deductions.length > 0 && <div className="border-t border-line pt-3 text-xs font-semibold uppercase tracking-wide text-muted">Descuentos</div>}
                {r.deductions.map((l, i) => <Line key={i} l={l} negative />)}
                <div className="mt-2 flex items-baseline justify-between border-t border-line pt-3">
                  <span className="text-[15px] font-semibold text-ink">Total a pagar</span>
                  <span className="num text-[22px] font-semibold text-ink">{formatMoney(r.to_pay)}</span>
                </div>
              </div>
              {r.vacation_business_days_e2 > 0 && <p className="mt-3 text-xs text-muted">Feriado: {dec2(r.vacation_business_days_e2)} días hábiles = {dec2(r.vacation_calendar_days_e2)} días corridos (se suman sábados, domingos y feriados).</p>}
            </Card>
            {infos.length > 0 && <Notice tone="info" title="Para que sepas"><ul className="list-disc pl-5">{infos.map((n) => <li key={n.text}>{n.text}</li>)}</ul></Notice>}
          </div>
        </div>
      </div>
      <Dialog open={preview} onClose={() => setPreview(false)} title="Vista previa de impresión" size="lg">
        <div className="overflow-x-auto rounded-lg border border-line bg-white p-4"><div className="min-w-[560px]"><PrintSeverance view={view} biz={biz} preview /></div></div>
      </Dialog>
    </>
  );
}

function Line({ l, negative }: { l: PayLine; negative?: boolean }) {
  return (
    <div>
      <div className="flex justify-between gap-3"><span className="text-ink">{l.label}</span><span className="num">{negative ? `−${formatMoney(l.amount)}` : formatMoney(l.amount)}</span></div>
      {l.detail && <div className="text-xs text-muted">{l.detail}</div>}
    </div>
  );
}

function PrintSeverance({ view, biz, preview = false }: { view: SeveranceView; biz: BusinessSettings | null; preview?: boolean }) {
  const r = view.result, w = view.worker;
  return (
    <article className={`${preview ? "block" : "hidden print:block"} bg-white p-2 text-[12px] leading-snug text-black`} aria-hidden={!preview}>
      <header className="flex items-start justify-between gap-6 border-b-2 border-black pb-3">
        <PrintIssuer biz={biz} />
        <div className="min-w-[200px] border-2 border-black p-3 text-center"><div className="text-[15px] font-bold tracking-wide">FINIQUITO</div><div className="mt-1">{formatDate(view.input.end_date)}</div></div>
      </header>
      <section className="mt-3 grid grid-cols-2 gap-x-6 gap-y-0.5">
        <div><strong>Trabajador:</strong> {w.name}</div><div><strong>RUT:</strong> {formatRut(w.rut)}</div>
        <div><strong>Fecha de ingreso:</strong> {formatDate(w.start_date)}</div><div><strong>Fecha de término:</strong> {formatDate(view.input.end_date)}</div>
        <div className="col-span-2"><strong>Causal:</strong> {CAUSE_LABEL[view.input.cause]}</div>
      </section>
      <section className="mt-4">
        {r.earnings.map((l) => <div key={l.key} className="flex justify-between border-b border-neutral-300 py-0.5"><span>{l.label}</span><span>{formatMoney(l.amount)}</span></div>)}
        {r.deductions.map((l, i) => <div key={i} className="flex justify-between border-b border-neutral-300 py-0.5"><span>{l.label}</span><span>−{formatMoney(l.amount)}</span></div>)}
        <div className="mt-1 flex justify-between border-t-2 border-black pt-1 text-[14px] font-bold"><span>TOTAL A PAGAR</span><span>{formatMoney(r.to_pay)}</span></div>
      </section>
      <p className="mt-4 text-[11px]">El trabajador declara recibir a su entera satisfacción la suma indicada y que el empleador nada le adeuda por los conceptos señalados, sin perjuicio de las reservas que deje escritas.</p>
      <section className="mt-14 grid grid-cols-3 gap-10 text-center">
        <div className="border-t border-black pt-1">Empleador</div>
        <div className="border-t border-black pt-1">{w.name}</div>
        <div className="border-t border-black pt-1">Ministro de fe</div>
      </section>
      <footer className="mt-8 border-t border-black pt-2 text-center text-[10px]">Cálculo preparado con NÚCLEO ERP: revísalo antes de firmar. www.nucleoerp.cl</footer>
    </article>
  );
}

export function FiniquitoRoute({ id }: { id: string }) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return <Notice tone="danger">Persona no encontrada.</Notice>;
  return <Finiquito key={n} workerId={n} />;
}
