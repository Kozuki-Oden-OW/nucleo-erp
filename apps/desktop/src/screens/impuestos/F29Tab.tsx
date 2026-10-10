// Borrador del F29 código por código, datos que ingresa la persona y "marcar como declarado".
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardCopy, Info, RotateCcw, Save, Send, Trash2 } from "lucide-react";
import { useBackend, errorMessage, type F29Inputs, type F29View } from "../../data";
import { F29_COUNT_CODES, F29_LABEL, type F29Note } from "../../data/f29";
import { formatDate, formatMoney, formatPpm } from "../../lib/format";
import { useSession } from "../../lib/session";
import { MoneyField } from "../../ui/doc";
import { Badge, Button, Card, Checkbox, cx, Field, Notice } from "../../ui/kit";
import { Dialog, useToast } from "../../ui/overlay";
import { periodLabel } from "./Impuestos";
import { RcvImportButton } from "./Registro";

/** Secciones del formulario en el orden del F29 (solo se muestran los códigos con valor). */
const SECTIONS: { title: string; codes: number[]; always?: number[] }[] = [
  { title: "Ventas y débito fiscal", codes: [585, 20, 586, 142, 714, 715, 503, 502, 716, 717, 110, 111, 758, 759, 512, 513, 509, 510, 733, 734], always: [538] },
  { title: "Compras y crédito fiscal", codes: [564, 521, 566, 560, 584, 562, 519, 520, 761, 762, 524, 525, 527, 528, 531, 532, 534, 535, 536, 553, 504], always: [537] },
  { title: "IVA del mes", codes: [], always: [89, 77] },
  { title: "Retenciones e impuesto único", codes: [50, 48, 151, 153, 49, 155] },
  { title: "Pago provisional mensual (PPM)", codes: [30, 563, 115, 68, 62, 156] },
  { title: "Resultado", codes: [], always: [595, 91] },
];
const TOTALS = new Set([538, 537, 89, 77, 595, 91]);
const SUBTRACT = new Set([510, 734, 528]);
const MANUAL: { code: number; label: string; hint: string }[] = [
  { code: 48, label: "Impuesto único de segunda categoría (48)", hint: "Del sueldo empresarial y de los trabajadores, según sus liquidaciones del mes" },
  { code: 151, label: "Retención de honorarios (151)", hint: "Retenciones de las boletas de honorarios que pagaste este mes" },
  { code: 49, label: "Retención 3 % préstamo tasa 0, trabajadores (49)", hint: "" },
  { code: 155, label: "Retención 3 % préstamo tasa 0, honorarios (155)", hint: "" },
  { code: 50, label: "Retención art. 20 N°2 (50)", hint: "Intereses y otras rentas de capital pagadas" },
  { code: 153, label: "Retención a directores (153)", hint: "" },
  { code: 156, label: "Aumento 3 % del PPM, préstamo tasa 0 (156)", hint: "" },
];

function value(code: number, v: number): string {
  if (code === 115) return formatPpm(v, 3).replace(/,?0+ %$/, " %");
  if (code === 30) return "Sí";
  return F29_COUNT_CODES.has(code) ? String(v) : formatMoney(v);
}

function NoteRow({ n }: { n: F29Note }) {
  const Icon = n.severity === "info" ? Info : AlertTriangle;
  return (
    <li className={cx("flex gap-2 text-sm", n.severity === "falta" ? "text-danger" : n.severity === "aviso" ? "text-warning" : "text-muted")}>
      <Icon size={15} className="mt-0.5 shrink-0" aria-hidden /><span className="text-ink">{n.text}</span>
    </li>
  );
}

export function F29Tab({ view, onView, onGoRegistro, onGoConfig }: { view: F29View; onView: (v: F29View) => void; onGoRegistro: () => void; onGoConfig: () => void }) {
  const backend = useBackend();
  const toast = useToast();
  const { can } = useSession();
  const edit = can("contabilidad.editar") && view.status === "borrador";
  const codes = view.result.codes;
  const [inputs, setInputs] = useState<F29Inputs>(view.inputs);
  const [busy, setBusy] = useState(false);
  const [declaring, setDeclaring] = useState(false);
  const [reopening, setReopening] = useState(false);
  useEffect(() => setInputs(view.inputs), [view]);
  const dirty = JSON.stringify(inputs) !== JSON.stringify(view.inputs);
  const notes = [...view.result.notes.filter((n) => n.severity !== "info"), ...view.checks.filter((n) => n.severity !== "info")];
  const infos = [...view.result.notes.filter((n) => n.severity === "info"), ...view.checks.filter((n) => n.severity === "info")];
  const remnant = inputs.remnant_amount ?? view.remnant_suggested ?? 0;
  const setManual = (code: number, v: number | null) => setInputs((x) => {
    const manual = { ...(x.manual ?? {}) };
    if (v) manual[String(code)] = v; else delete manual[String(code)];
    return { ...x, manual };
  });

  async function save() {
    setBusy(true);
    try { onView(await backend.saveF29Inputs(view.period, inputs)); toast("success", "Datos del F29 guardados."); }
    catch (e) { toast("danger", errorMessage(e)); } finally { setBusy(false); }
  }
  async function copy() {
    const lines = Object.entries(codes).filter(([k, v]) => v !== 0 || ["91", "89"].includes(k)).map(([k, v]) => `${k}\t${F29_LABEL[Number(k)] ?? ""}\t${Number(k) === 115 ? (v / 10_000).toString().replace(".", ",") : v}`);
    try { await navigator.clipboard.writeText(`F29 ${view.period}\n${lines.join("\n")}`); toast("success", "Códigos copiados: pégalos en una planilla o tenlos a mano al llenar el F29 en sii.cl."); }
    catch { toast("danger", "No se pudo copiar al portapapeles."); }
  }

  const rows = useMemo(() => SECTIONS.map((s) => ({
    ...s,
    list: [...s.codes.filter((c) => codes[String(c)] !== undefined), ...(s.always ?? [])],
  })).filter((s) => s.list.length), [codes]);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex min-w-0 flex-col gap-6">
        {notes.length > 0 && (
          <Notice tone={notes.some((n) => n.severity === "falta") ? "danger" : "warning"} title={view.result.complete ? "Revisa antes de declarar" : "Falta información para completar el borrador"}>
            <ul className="mt-1 flex flex-col gap-1.5">{notes.map((n) => <NoteRow key={n.text} n={n} />)}</ul>
            {!view.profile.ppm_rate_ppm && <Button className="mt-3" size="sm" variant="secondary" onClick={onGoConfig}>Ingresar la tasa de PPM</Button>}
          </Notice>
        )}

        <Card title="De dónde salen los datos" subtitle="Lo más exacto es importar el Registro de Compras y Ventas que descargas de sii.cl (Servicios online → IVA → Registro de Compras y Ventas → Descargar detalles).">
          <div className="grid gap-3 md:grid-cols-2">
            {view.sources.map((s) => (
              <div key={s.direction} className="flex flex-col gap-2 rounded-lg border border-line p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-ink">{s.direction === "venta" ? "Ventas" : "Compras"}</span>
                  {s.source === "rcv" ? <Badge tone="success" icon={CheckCircle2}>Registro del SII</Badge> : <Badge tone="neutral">Datos de NÚCLEO</Badge>}
                </div>
                <p className="text-xs text-muted">
                  {s.source === "rcv" ? `${s.rows} documento(s)${s.file_name ? ` · ${s.file_name}` : ""}${s.imported_at ? ` · importado el ${formatDate(s.imported_at.slice(0, 10))}` : ""}`
                    : s.direction === "venta" ? "Ventas documentadas en NÚCLEO (factura, boleta, nota de crédito)." : "Compras, gastos con IVA e IVA real de importaciones registrados en NÚCLEO."}
                </p>
                {edit && <RcvImportButton period={view.period} direction={s.direction} onView={onView} replace={s.source === "rcv"} />}
              </div>
            ))}
          </div>
          <button type="button" onClick={onGoRegistro} className="mt-3 text-sm font-medium text-accent hover:underline">Ver los {view.docs.length} documentos del mes</button>
        </Card>

        <Card title={<span>Formulario 29 · <span className="capitalize">{periodLabel(view.period)}</span></span>} padded={false}
          subtitle="Códigos que llena NÚCLEO. Si tienes otras operaciones (cambio de sujeto, impuestos adicionales, créditos especiales), complétalas en sii.cl."
          actions={<Button size="sm" variant="secondary" icon={ClipboardCopy} onClick={copy}>Copiar códigos</Button>}>
          <div className="divide-y divide-line">
            {rows.map((s) => (
              <section key={s.title} className="px-5 py-3">
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{s.title}</h3>
                <dl className="flex flex-col">
                  {s.list.map((c) => {
                    const v = codes[String(c)] ?? 0;
                    const total = TOTALS.has(c);
                    return (
                      <div key={c} className={cx("grid grid-cols-[3.5rem_minmax(0,1fr)_auto] items-baseline gap-3 py-1 text-sm", total && "font-semibold", c === 91 && "text-base")}>
                        <dt className="font-mono text-[12px] text-muted">{c}</dt>
                        <dt className={cx("min-w-0", total ? "text-ink" : "text-muted")}>{SUBTRACT.has(c) ? "− " : ""}{F29_LABEL[c] ?? `Código ${c}`}</dt>
                        <dd className={cx("num text-right", c === 91 ? "text-accent" : "text-ink")}>{value(c, v)}</dd>
                      </div>
                    );
                  })}
                </dl>
              </section>
            ))}
          </div>
        </Card>

        <Card title="Datos que ingresas tú" subtitle="Lo que NÚCLEO no sabe por sí solo. Se guardan con el borrador de este mes."
          actions={edit && <Button size="sm" icon={Save} onClick={save} disabled={busy || !dirty}>Guardar</Button>}>
          <fieldset disabled={!edit} className="flex flex-col gap-5">
            <div>
              <h3 className="mb-2 text-sm font-semibold text-ink">Remanente de crédito fiscal del mes anterior</h3>
              <div className="grid gap-4 md:grid-cols-3">
                <MoneyField label="Remanente declarado (código 77)" value={inputs.remnant_amount ?? null} onValue={(v) => setInputs({ ...inputs, remnant_amount: v })}
                  placeholder={view.remnant_suggested !== null ? String(view.remnant_suggested) : "0"}
                  hint={view.remnant_suggested !== null ? `Declarado en ${periodLabel(view.remnant_from!)}: ${formatMoney(view.remnant_suggested)}` : "El que quedó en el F29 del mes pasado"} />
                <MoneyField label="UTM del mes anterior" value={inputs.utm_prev ?? null} onValue={(v) => setInputs({ ...inputs, utm_prev: v })} hint="sii.cl → Valores y fechas → UTM" />
                <MoneyField label="UTM de este mes" value={inputs.utm_cur ?? null} onValue={(v) => setInputs({ ...inputs, utm_cur: v })} hint="Para reajustar el remanente" />
              </div>
              {remnant > 0 && codes["504"] !== undefined && <p className="mt-2 text-xs text-muted">{formatMoney(remnant)} ÷ {formatMoney(inputs.utm_prev ?? 0)} × {formatMoney(inputs.utm_cur ?? 0)} = <strong className="text-ink">{formatMoney(codes["504"]!)}</strong> reajustado.</p>}
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold text-ink">Retenciones e impuesto único</h3>
              <div className="grid gap-4 md:grid-cols-2">
                {MANUAL.slice(0, 2).map((m) => <MoneyField key={m.code} label={m.label} hint={m.hint} value={inputs.manual?.[String(m.code)] ?? null} onValue={(v) => setManual(m.code, v)} />)}
              </div>
              <details className="mt-3">
                <summary className="cursor-pointer text-sm text-accent">Otras retenciones</summary>
                <div className="mt-3 grid gap-4 md:grid-cols-2">
                  {MANUAL.slice(2).map((m) => <MoneyField key={m.code} label={m.label} hint={m.hint || undefined} value={inputs.manual?.[String(m.code)] ?? null} onValue={(v) => setManual(m.code, v)} />)}
                </div>
              </details>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold text-ink">PPM</h3>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="flex items-end pb-2"><Checkbox label="Tengo pérdida tributaria (suspende el PPM)" hint="Código 30: si el año anterior terminó con pérdida" checked={!!inputs.ppm_loss} onChange={(v) => setInputs({ ...inputs, ppm_loss: v })} /></div>
                <MoneyField label="Crédito imputable al PPM (68)" value={inputs.ppm_credit || null} onValue={(v) => setInputs({ ...inputs, ppm_credit: v ?? 0 })} hint="PPM voluntario u otros créditos que te indique tu contador" />
              </div>
              <p className="mt-2 text-xs text-muted">Tasa de PPM: {view.profile.ppm_rate_ppm !== null ? formatPpm(view.profile.ppm_rate_ppm, 3) : "sin ingresar"} · <button type="button" className="text-accent hover:underline" onClick={onGoConfig}>cambiar</button></p>
            </div>
          </fieldset>
        </Card>
      </div>

      <aside className="flex flex-col gap-6 xl:sticky xl:top-4 xl:self-start">
        <Card title="Total a pagar">
          <div className="flex items-baseline justify-between">
            <span className="num text-3xl font-semibold text-ink">{formatMoney(codes["91"] ?? 0)}</span>
            {view.status === "declarado" ? <Badge tone="success" icon={CheckCircle2}>Declarado</Badge> : <Badge tone={view.result.complete ? "neutral" : "warning"}>{view.result.complete ? "Borrador" : "Incompleto"}</Badge>}
          </div>
          <dl className="mt-3 flex flex-col gap-1.5 text-sm">
            <div className="flex justify-between"><dt className="text-muted">IVA débito</dt><dd className="num">{formatMoney(codes["538"] ?? 0)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">− IVA crédito</dt><dd className="num">{formatMoney(codes["537"] ?? 0)}</dd></div>
            <div className="flex justify-between font-medium"><dt>= IVA a pagar</dt><dd className="num">{formatMoney(codes["89"] ?? 0)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">+ Retenciones e impuesto único</dt><dd className="num">{formatMoney((codes["595"] ?? 0) - (codes["89"] ?? 0) - (codes["62"] ?? 0))}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">+ PPM</dt><dd className="num">{formatMoney(codes["62"] ?? 0)}</dd></div>
            {(codes["77"] ?? 0) > 0 && <div className="mt-1 flex justify-between border-t border-line pt-2"><dt className="text-muted">Remanente para el mes siguiente</dt><dd className="num font-medium text-success">{formatMoney(codes["77"]!)}</dd></div>}
          </dl>
          {view.due_date && <p className="mt-3 text-xs text-muted">Vence el {formatDate(view.due_date)} (según tu configuración tributaria).</p>}
          {view.declared ? (
            <div className="mt-4 rounded-lg border border-success/30 bg-success-soft p-3 text-sm">
              <p className="font-medium text-ink">Declaraste {formatMoney(view.declared.declared_91)}{view.declared.folio ? ` · folio ${view.declared.folio}` : ""}</p>
              <p className="text-muted">Remanente declarado: {formatMoney(view.declared.declared_77)}. Se propone en el F29 del mes siguiente.</p>
              {view.declared.declared_91 !== (codes["91"] ?? 0) && <p className="mt-1 text-warning">Difiere del borrador en {formatMoney(view.declared.declared_91 - (codes["91"] ?? 0))}.</p>}
              {can("contabilidad.editar") && <Button className="mt-2" size="sm" variant="ghost" icon={RotateCcw} onClick={() => setReopening(true)}>Reabrir</Button>}
            </div>
          ) : edit && (
            <Button className="mt-4 w-full" icon={Send} onClick={() => setDeclaring(true)} disabled={dirty}>Ya lo declaré en sii.cl</Button>
          )}
          {dirty && <p className="mt-2 text-xs text-warning">Tienes cambios sin guardar.</p>}
        </Card>
        <Card title="Cómo se calcula">
          <ul className="flex flex-col gap-1.5 text-sm text-muted">
            <li><strong className="text-ink">Débito</strong>: IVA de tus facturas, boletas y notas de débito, menos el de tus notas de crédito.</li>
            <li><strong className="text-ink">Crédito</strong>: IVA de las facturas de compra con derecho, de tus importaciones (DIN) y el remanente del mes anterior reajustado.</li>
            <li><strong className="text-ink">PPM</strong>: tus ingresos netos del mes × la tasa de tu empresa.</li>
            <li>Las boletas que recibes y las compras sin derecho a crédito no rebajan el IVA.</li>
          </ul>
          {infos.length > 0 && <ul className="mt-3 flex flex-col gap-1.5 border-t border-line pt-3">{infos.map((n) => <NoteRow key={n.text} n={n} />)}</ul>}
          <p className="mt-3 text-xs text-muted">Borrador referencial según las instrucciones del F29 del SII. Revísalo con tu contador: NÚCLEO no declara ni envía nada.</p>
        </Card>
      </aside>

      {declaring && <DeclareDialog view={view} onClose={() => setDeclaring(false)} onView={onView} />}
      {reopening && <ReopenDialog period={view.period} onClose={() => setReopening(false)} onView={onView} />}
    </div>
  );
}

function DeclareDialog({ view, onClose, onView }: { view: F29View; onClose: () => void; onView: (v: F29View) => void }) {
  const backend = useBackend();
  const toast = useToast();
  const [total, setTotal] = useState<number | null>(view.result.codes["91"] ?? 0);
  const [remnant, setRemnant] = useState<number | null>(view.result.codes["77"] ?? 0);
  const [folio, setFolio] = useState("");
  const [busy, setBusy] = useState(false);
  async function confirm() {
    setBusy(true);
    try { onView(await backend.markF29Declared(view.period, remnant ?? 0, total ?? 0, folio.trim() || null)); toast("success", "F29 marcado como declarado."); onClose(); }
    catch (e) { toast("danger", errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open onClose={onClose} title="Registrar lo que declaraste"
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button icon={CheckCircle2} onClick={confirm} disabled={busy}>Marcar como declarado</Button></>}>
      <p className="mb-4 text-sm text-muted">Anota lo que quedó en sii.cl. Si difiere del borrador, usa los montos reales: el remanente declarado es el que se reajusta el mes siguiente. El borrador queda bloqueado (puedes reabrirlo).</p>
      <div className="grid gap-4 md:grid-cols-2">
        <MoneyField label="Total pagado (código 91)" value={total} onValue={setTotal} />
        <MoneyField label="Remanente para el mes siguiente (77)" value={remnant} onValue={setRemnant} />
        <Field label="Folio del formulario" optional value={folio} onChange={(e) => setFolio(e.target.value)} hint="Aparece en el certificado de declaración" />
      </div>
    </Dialog>
  );
}

function ReopenDialog({ period, onClose, onView }: { period: string; onClose: () => void; onView: (v: F29View) => void }) {
  const backend = useBackend();
  const toast = useToast();
  const [reason, setReason] = useState("");
  return (
    <Dialog open onClose={onClose} title="Reabrir el F29" size="sm"
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="danger" icon={Trash2} disabled={!reason.trim()}
        onClick={() => backend.reopenF29(period, reason).then((v) => { onView(v); onClose(); }).catch((e) => toast("danger", errorMessage(e)))}>Reabrir</Button></>}>
      <Field label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej.: rectifiqué el F29 en sii.cl" autoFocus />
    </Dialog>
  );
}


