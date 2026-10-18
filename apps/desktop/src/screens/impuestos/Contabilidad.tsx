// Contabilidad automática (Fase 10): libros, asientos (automáticos y manuales), cierre de meses y
// plan de cuentas con la asignación de cuentas de cada movimiento.
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, BookText, CalendarCheck, ChevronLeft, ChevronRight, FilePlus2, Lock, LockOpen, Plus, Save, Scale, Sigma, Trash2, Undo2, TriangleAlert } from "lucide-react";
import {
  useBackend, errorMessage, type AccountingMap, type JournalEntry, type LedgerAccount, type ManualEntryInput, type PeriodRow, type Report,
} from "../../data";
import { formatDate, formatMoney, parseMoney, todayIso } from "../../lib/format";
import { navigate } from "../../lib/router";
import { useSession } from "../../lib/session";
import { Badge, Button, Card, EmptyState, Field, IconButton, Kpi, Notice, Segmented, Select, Spinner, TextArea, cx, type Tone } from "../../ui/kit";
import { Dialog, Drawer, useToast } from "../../ui/overlay";

type Section = "libros" | "asientos" | "cierre" | "plan";

const monthLabel = (p: string) => new Date(`${p}-15T12:00:00`).toLocaleDateString("es-CL", { month: "long", year: "numeric" });
const shift = (p: string, n: number) => { const d = new Date(`${p}-15T12:00:00`); d.setMonth(d.getMonth() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const lastDay = (p: string) => { const [y, m] = p.split("-").map(Number); return new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10); };
const NATURE: Record<string, [Tone, string]> = { activo: ["info", "Activo"], pasivo: ["warning", "Pasivo"], patrimonio: ["accent", "Patrimonio"], ingreso: ["success", "Ingreso"], gasto: ["neutral", "Gasto"] };

export function ContabilidadTab() {
  const [section, setSection] = useState<Section>("libros");
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented label="Sección" value={section} onChange={setSection} options={[
          { value: "libros", label: "Resumen y libros" }, { value: "asientos", label: "Asientos" }, { value: "cierre", label: "Cierre de meses" }, { value: "plan", label: "Plan de cuentas" },
        ]} />
        <span className="text-sm text-muted">La contabilidad se arma sola desde tus ventas, compras, gastos, cobros, pagos, inventario y remuneraciones.</span>
      </div>
      {section === "libros" && <Books />}
      {section === "asientos" && <Entries />}
      {section === "cierre" && <Periods />}
      {section === "plan" && <Chart />}
    </div>
  );
}

/* ───────────────────────────── Resumen y libros ───────────────────────────── */

const BOOKS: { id: string; title: string; text: string; icon: typeof BookOpen }[] = [
  { id: "libro_diario", title: "Libro diario", text: "Cada asiento con su debe y haber, día a día.", icon: BookText },
  { id: "libro_mayor", title: "Libro mayor", text: "Los movimientos de cada cuenta con su saldo.", icon: BookOpen },
  { id: "balance_comprobacion", title: "Balance de comprobación (8 columnas)", text: "Sumas y saldos, inventario y resultados.", icon: Sigma },
  { id: "estado_resultados", title: "Estado de resultados", text: "Ventas, costo, margen, gastos y utilidad.", icon: Scale },
  { id: "balance_general", title: "Balance general", text: "Activo, pasivo y patrimonio a una fecha.", icon: Scale },
];

function Books() {
  const backend = useBackend();
  const [er, setEr] = useState<Report | null>(null);
  const [bg, setBg] = useState<Report | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const month = todayIso().slice(0, 7);
  useEffect(() => {
    backend.report({ id: "estado_resultados", from: `${month}-01`, to: todayIso() }).then(setEr).catch((e) => setErr(errorMessage(e)));
    backend.report({ id: "balance_general", from: `${month}-01`, to: todayIso() }).then(setBg).catch(() => {});
  }, [backend, month]);
  const k = (r: Report | null, i: number) => r?.kpis[i]?.value ?? 0;
  return (
    <div className="flex flex-col gap-5">
      {err && <Notice tone="danger">{err}</Notice>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label={`Ventas de ${monthLabel(month).split(" ")[0]}`} value={formatMoney(k(er, 0))} hint="Ventas netas contabilizadas" onClick={() => navigate("/analisis?r=estado_resultados")} />
        <Kpi label="Margen bruto del mes" value={formatMoney(k(er, 1))} hint="Ventas − costo de lo vendido" onClick={() => navigate("/analisis?r=estado_resultados")} />
        <Kpi label="Resultado del mes" value={formatMoney(k(er, 2))} tone={k(er, 2) < 0 ? "danger" : "success"} hint="Antes de impuesto a la renta" onClick={() => navigate("/analisis?r=estado_resultados")} />
        <Kpi label="Lo que tienes (activo)" value={formatMoney(k(bg, 0))} hint={bg ? (k(bg, 3) === 0 ? "El balance cuadra" : `Diferencia ${formatMoney(k(bg, 3))}`) : undefined} tone={bg && k(bg, 3) !== 0 ? "danger" : undefined} onClick={() => navigate("/analisis?r=balance_general")} />
      </div>
      <Card title="Libros contables" subtitle="Ábrelos con el período que necesites y expórtalos a Excel para tu contador.">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {BOOKS.map((b) => (
            <button key={b.id} onClick={() => navigate(`/analisis?r=${b.id}`)} className="group flex items-start gap-3 rounded-xl border border-line bg-surface p-4 text-left transition-colors hover:border-accent/50 hover:bg-surface-2/40">
              <b.icon size={18} className="mt-0.5 shrink-0 text-accent" aria-hidden />
              <span className="min-w-0 flex-1"><span className="block font-semibold text-ink">{b.title}</span><span className="mt-0.5 block text-sm text-muted">{b.text}</span></span>
              <ChevronRight size={18} className="mt-0.5 shrink-0 text-faint group-hover:text-accent" aria-hidden />
            </button>
          ))}
        </div>
      </Card>
      <Notice tone="info" title="¿Cómo se arma?">
        Cada documento genera su asiento: una venta carga «Clientes» y abona «Ventas» e «IVA débito», con su costo; un cobro mueve de «Clientes» a «Caja» o «Bancos»; una compra carga «Mercaderías» e «IVA crédito» contra «Proveedores»; un gasto carga su cuenta de gasto contra «Acreedores». Mientras un mes está abierto se recalcula solo; al cerrarlo queda fijo. Revisa los casos especiales con tu contador.
      </Notice>
    </div>
  );
}

/* ───────────────────────────── Asientos ───────────────────────────── */

function Entries() {
  const backend = useBackend();
  const toast = useToast();
  const { can } = useSession();
  const [period, setPeriod] = useState(todayIso().slice(0, 7));
  const [filter, setFilter] = useState<"todos" | "automaticos" | "manuales">("todos");
  const [rows, setRows] = useState<JournalEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [reversing, setReversing] = useState<JournalEntry | null>(null);
  const [reason, setReason] = useState("");
  const load = useCallback(() => { setRows(null); backend.journal(`${period}-01`, lastDay(period)).then(setRows).catch((e) => setErr(errorMessage(e))); }, [backend, period]);
  useEffect(load, [load]);
  const list = (rows ?? []).filter((e) => filter === "todos" || (filter === "manuales" ? e.origin === "manual" : e.origin !== "manual"));
  const total = list.filter((e) => e.status !== "reversado" || e.origin === "manual").reduce((a, e) => a + e.lines.reduce((x, l) => x + l.debit_minor, 0), 0);
  const editable = can("contabilidad.editar");
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <IconButton icon={ChevronLeft} label="Mes anterior" onClick={() => setPeriod(shift(period, -1))} />
        <input type="month" aria-label="Mes" value={period} max={todayIso().slice(0, 7)} onChange={(e) => e.target.value && setPeriod(e.target.value)} className="h-9 rounded-md border border-line bg-surface px-3 text-sm text-ink focus:border-accent focus:outline-none" />
        <IconButton icon={ChevronRight} label="Mes siguiente" onClick={() => setPeriod(shift(period, 1))} disabled={period >= todayIso().slice(0, 7)} />
        <Segmented label="Filtro" value={filter} onChange={setFilter} options={[{ value: "todos", label: "Todos" }, { value: "automaticos", label: "Automáticos" }, { value: "manuales", label: "Manuales" }]} />
        <span className="text-sm text-muted">{list.length} asientos · {formatMoney(total)}</span>
        <span className="flex-1" />
        {editable && <Button icon={FilePlus2} onClick={() => setCreating(true)}>Nuevo asiento manual</Button>}
      </div>
      {err && <Notice tone="danger">{err}</Notice>}
      {!rows ? <Spinner label="Armando los asientos…" /> : list.length === 0 ? <EmptyState icon={BookText} title="Sin asientos en este mes" /> : (
        <div className="overflow-auto rounded-xl border border-line bg-surface shadow-card">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="sticky top-0 bg-surface-2/95"><tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-muted">
              <th className="w-32 px-4 py-2.5">Fecha</th><th className="px-2">Cuenta</th><th className="w-32 px-2 text-right">Debe</th><th className="w-32 px-4 text-right">Haber</th>
            </tr></thead>
            <tbody>
              {list.map((e) => (
                <Fragment key={e.key}>
                  <tr className="border-t border-line bg-surface-2/40">
                    <td className="num whitespace-nowrap px-4 py-2 text-muted">{formatDate(e.date)}</td>
                    <td className="px-2 py-2" colSpan={3}>
                      <div className="flex flex-wrap items-center gap-2">
                        {e.link ? <button className="font-mono text-[12.5px] font-medium text-accent hover:underline" onClick={() => navigate(e.link!)}>{e.reference}</button> : <span className="font-mono text-[12.5px] font-medium text-ink">{e.reference}</span>}
                        <span className="text-ink">{e.description}</span>
                        {e.origin === "manual" && <Badge tone="accent">Manual</Badge>}
                        {e.origin === "apertura" && <Badge tone="info">Apertura</Badge>}
                        {e.status === "contabilizado" && e.origin !== "manual" && <Badge tone="neutral" icon={Lock}>Mes cerrado</Badge>}
                        {e.status === "reversado" && <Badge tone="danger">Reversado</Badge>}
                        <span className="flex-1" />
                        {editable && e.origin === "manual" && e.status === "contabilizado" && !e.reference.endsWith("-R") && (
                          <Button size="sm" variant="ghost" icon={Undo2} onClick={() => { setReason(""); setReversing(e); }}>Reversar</Button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {e.lines.map((l, i) => (
                    <tr key={i} className={cx(e.status === "reversado" && "text-faint line-through")}>
                      <td />
                      <td className={cx("px-2 py-1", l.credit_minor > 0 && "pl-10")}><span className="font-mono text-xs text-muted">{l.account_code}</span> <span className="text-ink">{l.account_name}</span>{l.memo && <span className="ml-2 text-xs text-muted">· {l.memo}</span>}</td>
                      <td className="num px-2 text-right">{l.debit_minor ? formatMoney(l.debit_minor) : ""}</td>
                      <td className="num px-4 text-right">{l.credit_minor ? formatMoney(l.credit_minor) : ""}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ManualEntryDrawer open={creating} defaultDate={period === todayIso().slice(0, 7) ? todayIso() : lastDay(period)} onClose={() => setCreating(false)} onSaved={(e) => { setCreating(false); toast("success", `Asiento ${e.reference} registrado.`); load(); }} />
      <Dialog open={reversing !== null} onClose={() => setReversing(null)} title={`Reversar ${reversing?.reference ?? ""}`}
        footer={<><Button variant="ghost" onClick={() => setReversing(null)}>Cancelar</Button><Button variant="danger" disabled={!reason.trim()} onClick={async () => {
          try { const r = await backend.reverseManualEntry(reversing!.key, reason); setReversing(null); toast("success", `Asiento ${r.reference} registrado como reversa.`); load(); } catch (e) { toast("danger", errorMessage(e)); }
        }}>Reversar</Button></>}>
        <p className="mb-3 text-sm text-muted">Se registra un asiento inverso con el mismo monto. El original queda marcado como reversado: nada se borra.</p>
        <TextArea label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} autoFocus />
      </Dialog>
    </div>
  );
}

interface LineDraft { account: string; debit: string; credit: string; memo: string }
const emptyLine = (): LineDraft => ({ account: "", debit: "", credit: "", memo: "" });

function ManualEntryDrawer({ open, defaultDate, onClose, onSaved }: { open: boolean; defaultDate: string; onClose: () => void; onSaved: (e: JournalEntry) => void }) {
  const backend = useBackend();
  const [accounts, setAccounts] = useState<LedgerAccount[]>([]);
  const [date, setDate] = useState(defaultDate);
  const [desc, setDesc] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine(), emptyLine()]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setDate(defaultDate); setDesc(""); setLines([emptyLine(), emptyLine()]); setErr(null); backend.ledgerAccounts().then(setAccounts).catch(() => {}); } }, [open, defaultDate, backend]);
  const opts = useMemo(() => [{ value: "", label: "Elige una cuenta…" }, ...accounts.filter((a) => a.postable && !a.archived).map((a) => ({ value: a.code, label: `${a.code} ${a.name}` }))], [accounts]);
  const amt = (t: string) => (t.trim() ? parseMoney(t) : 0);
  const d = lines.reduce((a, l) => a + (amt(l.debit) ?? 0), 0), c = lines.reduce((a, l) => a + (amt(l.credit) ?? 0), 0);
  const set = (i: number, x: Partial<LineDraft>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...x } : l)));
  async function save() {
    setErr(null);
    const input: ManualEntryInput = { date, description: desc, lines: [] };
    for (const [i, l] of lines.entries()) {
      if (!l.account && !l.debit && !l.credit) continue;
      const de = amt(l.debit), cr = amt(l.credit);
      if (de === null || cr === null) { setErr(`Línea ${i + 1}: escribe solo números.`); return; }
      input.lines.push({ account_code: l.account, debit_minor: de, credit_minor: cr, memo: l.memo || null });
    }
    setBusy(true);
    try { onSaved(await backend.addManualEntry(input)); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Drawer open={open} onClose={onClose} title="Nuevo asiento manual" subtitle="Para lo que no nace de un documento: aportes, préstamos, depreciación, ajustes de tu contador." width="w-[min(820px,100vw)]"
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button icon={Save} onClick={save} disabled={busy || d === 0 || d !== c}>{busy ? "Guardando…" : "Registrar asiento"}</Button></>}>
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
          <Field label="Fecha" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <Field label="Glosa" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Ej. aporte de capital del dueño" maxLength={200} />
        </div>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs font-semibold uppercase tracking-wide text-muted"><th className="pb-1.5">Cuenta</th><th className="w-32 pb-1.5 text-right">Debe</th><th className="w-32 pb-1.5 text-right">Haber</th><th className="w-40 pb-1.5 pl-2">Detalle</th><th className="w-9" /></tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="py-1 pr-2"><Select aria-label={`Cuenta de la línea ${i + 1}`} value={l.account} onChange={(e) => set(i, { account: e.target.value })} options={opts} /></td>
                <td className="py-1 pl-1"><input aria-label={`Debe de la línea ${i + 1}`} inputMode="numeric" value={l.debit} onChange={(e) => set(i, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} className="num h-9 w-full rounded-md border border-line bg-surface px-2 text-right focus:border-accent focus:outline-none" /></td>
                <td className="py-1 pl-1"><input aria-label={`Haber de la línea ${i + 1}`} inputMode="numeric" value={l.credit} onChange={(e) => set(i, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} className="num h-9 w-full rounded-md border border-line bg-surface px-2 text-right focus:border-accent focus:outline-none" /></td>
                <td className="py-1 pl-2"><input aria-label={`Detalle de la línea ${i + 1}`} value={l.memo} onChange={(e) => set(i, { memo: e.target.value })} className="h-9 w-full rounded-md border border-line bg-surface px-2 focus:border-accent focus:outline-none" /></td>
                <td className="py-1 pl-1">{lines.length > 2 && <IconButton icon={Trash2} label="Quitar línea" size={15} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} />}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr className="border-t border-line">
            <td className="pt-2"><Button size="sm" variant="ghost" icon={Plus} onClick={() => setLines((ls) => [...ls, emptyLine()])}>Agregar línea</Button></td>
            <td className="num pt-2 text-right font-semibold">{formatMoney(d)}</td><td className="num pt-2 text-right font-semibold">{formatMoney(c)}</td>
            <td className={cx("pt-2 pl-2 text-xs", d === c ? "text-success" : "text-danger")}>{d === c ? (d ? "Cuadra" : "") : `Diferencia ${formatMoney(Math.abs(d - c))}`}</td><td />
          </tr></tfoot>
        </table>
        {err && <Notice tone="danger">{err}</Notice>}
      </div>
    </Drawer>
  );
}

/* ───────────────────────────── Cierre de meses ───────────────────────────── */

function Periods() {
  const backend = useBackend();
  const toast = useToast();
  const { can } = useSession();
  const [rows, setRows] = useState<PeriodRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [closing, setClosing] = useState<PeriodRow | null>(null);
  const [reopening, setReopening] = useState<PeriodRow | null>(null);
  const [reason, setReason] = useState("");
  useEffect(() => { backend.accountingPeriods().then(setRows).catch((e) => setErr(errorMessage(e))); }, [backend]);
  if (err) return <Notice tone="danger">{err}</Notice>;
  if (!rows) return <Spinner />;
  const editable = can("contabilidad.editar");
  const current = todayIso().slice(0, 7);
  return (
    <div className="flex flex-col gap-4">
      <Notice tone="info">Al cerrar un mes, sus asientos quedan guardados tal como están y no se pueden agregar asientos manuales con esa fecha. Si después registras un documento con fecha de un mes cerrado, aquí verás el aviso para reabrirlo y volver a cerrarlo.</Notice>
      <div className="overflow-auto rounded-xl border border-line bg-surface shadow-card">
        <table className="w-full min-w-[680px] text-sm">
          <thead className="bg-surface-2/95"><tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-muted">
            <th className="px-4 py-2.5">Mes</th><th className="px-2">Estado</th><th className="px-2 text-right">Asientos</th><th className="px-2 text-right">Total debe</th><th className="px-2">Cerrado por</th><th className="px-4" />
          </tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.period} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5 font-medium text-ink">{(([c, ...rest]) => (c ?? "").toUpperCase() + rest.join(""))(monthLabel(p.period))}</td>
                <td className="px-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {p.status === "cerrado" ? <Badge tone="neutral" icon={Lock}>Cerrado</Badge> : p.period === current ? <Badge tone="accent">En curso</Badge> : <Badge tone="warning" icon={LockOpen}>Abierto</Badge>}
                    {p.changed && <Badge tone="danger" icon={TriangleAlert}>Cambió después del cierre ({formatMoney(p.current_debit_minor - p.debit_minor)})</Badge>}
                  </div>
                </td>
                <td className="num px-2 text-right">{p.entries}</td>
                <td className="num px-2 text-right">{formatMoney(p.debit_minor)}</td>
                <td className="px-2 text-muted">{p.closed_by ? `${p.closed_by} · ${formatDate(p.closed_at?.slice(0, 10))}` : "—"}</td>
                <td className="px-4 text-right">
                  {editable && p.status === "abierto" && p.period < current && <Button size="sm" variant="secondary" icon={CalendarCheck} onClick={() => setClosing(p)}>Cerrar mes</Button>}
                  {editable && p.status === "cerrado" && <Button size="sm" variant="ghost" icon={LockOpen} onClick={() => { setReason(""); setReopening(p); }}>Reabrir</Button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Dialog open={closing !== null} onClose={() => setClosing(null)} title={`Cerrar ${closing ? monthLabel(closing.period) : ""}`}
        footer={<><Button variant="ghost" onClick={() => setClosing(null)}>Cancelar</Button><Button icon={Lock} onClick={async () => {
          try { setRows(await backend.closePeriod(closing!.period)); toast("success", "Mes cerrado: sus asientos quedaron guardados."); setClosing(null); } catch (e) { toast("danger", errorMessage(e)); }
        }}>Cerrar mes</Button></>}>
        <p className="text-sm text-muted">Se guardarán {closing?.entries} asientos por {formatMoney(closing?.debit_minor ?? 0)}. Revisa antes el libro diario y el balance de comprobación del mes. Puedes reabrirlo después indicando el motivo.</p>
      </Dialog>
      <Dialog open={reopening !== null} onClose={() => setReopening(null)} title={`Reabrir ${reopening ? monthLabel(reopening.period) : ""}`}
        footer={<><Button variant="ghost" onClick={() => setReopening(null)}>Cancelar</Button><Button disabled={!reason.trim()} icon={LockOpen} onClick={async () => {
          try { setRows(await backend.reopenPeriod(reopening!.period, reason)); toast("success", "Mes reabierto: sus asientos se vuelven a calcular."); setReopening(null); } catch (e) { toast("danger", errorMessage(e)); }
        }}>Reabrir</Button></>}>
        <p className="mb-3 text-sm text-muted">Los asientos guardados al cerrar quedan sin efecto (no se borran) y el mes vuelve a calcularse desde los documentos.</p>
        <TextArea label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} autoFocus placeholder="Ej. venta registrada con atraso" />
      </Dialog>
    </div>
  );
}

/* ───────────────────────────── Plan de cuentas ───────────────────────────── */

const CONCEPT_LABELS: Record<string, string> = {
  caja: "Cobros y pagos en efectivo", bancos: "Cobros y pagos por banco o billetera", clientes: "Ventas por cobrar", iva_credito: "IVA de compras, gastos e importaciones",
  mercaderias: "Inventario", importaciones: "Costos de importación hasta recibir", proveedores: "Compras e importaciones por pagar", acreedores: "Gastos por pagar",
  iva_debito: "IVA de ventas", rem_por_pagar: "Sueldos líquidos por pagar", retenciones: "Imposiciones e impuestos retenidos", capital: "Saldos iniciales de caja, bancos y stock",
  aportes: "Stock agregado sin compra («Agregar stock»)", ventas: "Ventas netas", sobrantes: "Ajustes de inventario a favor", costo_ventas: "Costo de lo vendido",
  mermas: "Ajustes de inventario en contra", remuneraciones: "Remuneraciones", compras_otros: "Compras de servicios o productos sin stock", otros_gastos: "Gastos sin cuenta propia",
};

function Chart() {
  const backend = useBackend();
  const toast = useToast();
  const { can } = useSession();
  const editable = can("contabilidad.editar");
  const [accounts, setAccounts] = useState<LedgerAccount[] | null>(null);
  const [map, setMap] = useState<AccountingMap | null>(null);
  const [edit, setEdit] = useState<{ code?: string; parent?: LedgerAccount; name: string; simple: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    backend.ledgerAccounts().then(setAccounts).catch((e) => setErr(errorMessage(e)));
    backend.accountingMap().then(setMap).catch(() => {});
  }, [backend]);
  if (err) return <Notice tone="danger">{err}</Notice>;
  if (!accounts || !map) return <Spinner />;
  const opts = accounts.filter((a) => a.postable && !a.archived).map((a) => ({ value: a.code, label: `${a.code} ${a.name}` }));
  return (
    <div className="grid gap-6 2xl:grid-cols-2">
      <Card title="Plan de cuentas" subtitle="Nombre contable y, debajo, cómo se ve en la vista Simple. Agrega subcuentas para el detalle que necesites (por ejemplo, un banco por cuenta)." padded={false}>
        <ul className="divide-y divide-line">
          {accounts.map((a) => (
            <li key={a.code} className="flex items-center gap-3 px-5 py-2" style={{ paddingLeft: `${1.25 + (a.level - 1) * 1.1}rem` }}>
              <span className={cx("w-16 shrink-0 font-mono text-xs", a.postable ? "text-muted" : "font-semibold text-ink")}>{a.code}</span>
              <div className="min-w-0 flex-1">
                <div className={cx("truncate", a.postable ? "text-ink" : "font-semibold text-ink")}>{a.name}</div>
                {a.simple_name && a.simple_name !== a.name && <div className="truncate text-xs text-muted">{a.simple_name}</div>}
              </div>
              {a.level === 1 && <Badge tone={NATURE[a.nature]![0]}>{NATURE[a.nature]![1]}</Badge>}
              {editable && (
                <div className="flex shrink-0 gap-0.5">
                  <Button size="sm" variant="ghost" onClick={() => setEdit({ code: a.code, name: a.name, simple: a.simple_name ?? "" })}>Renombrar</Button>
                  {a.level < 4 && <IconButton icon={Plus} label={`Agregar subcuenta a ${a.name}`} size={15} onClick={() => setEdit({ parent: a, name: "", simple: "" })} />}
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <div className="flex flex-col gap-6">
        <Card title="Qué cuenta recibe cada movimiento" subtitle="Cambia la cuenta si tu contador usa otra. Aplica a los meses abiertos.">
          <div className="flex flex-col gap-2.5">
            {Object.keys(map.concepts).map((k) => (
              <div key={k} className="grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_16rem]">
                <span className="text-sm text-ink">{CONCEPT_LABELS[k] ?? k}</span>
                <Select aria-label={CONCEPT_LABELS[k] ?? k} value={map.concepts[k]} disabled={!editable} onChange={(e) => setMap({ ...map, concepts: { ...map.concepts, [k]: e.target.value } })} options={opts} />
              </div>
            ))}
          </div>
        </Card>
        <Card title="Gastos por grupo de categoría" subtitle="Cada gasto va a la cuenta de su grupo (Gastos → Categorías).">
          <div className="flex flex-col gap-2.5">
            {Object.keys(map.groups).map((g) => (
              <div key={g} className="grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_16rem]">
                <span className="text-sm text-ink">{g}</span>
                <Select aria-label={`Cuenta de ${g}`} value={map.groups[g]} disabled={!editable} onChange={(e) => setMap({ ...map, groups: { ...map.groups, [g]: e.target.value } })} options={opts} />
              </div>
            ))}
          </div>
          {editable && <div className="mt-4"><Button icon={Save} onClick={async () => { try { setMap(await backend.updateAccountingMap(map)); toast("success", "Asignación de cuentas guardada."); } catch (e) { toast("danger", errorMessage(e)); } }}>Guardar asignación</Button></div>}
        </Card>
      </div>
      <Dialog open={edit !== null} onClose={() => setEdit(null)} title={edit?.code ? `Renombrar ${edit.code}` : `Nueva subcuenta de ${edit?.parent?.name ?? ""}`}
        footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancelar</Button><Button disabled={!edit?.name.trim()} onClick={async () => {
          const x = edit!;
          try {
            const list = await backend.saveLedgerAccount({ code: x.code, parent_code: x.parent?.code, name: x.name, simple_name: x.simple || undefined });
            setAccounts(list); setEdit(null); toast("success", x.code ? "Cuenta renombrada." : "Subcuenta creada.");
            backend.accountingMap().then(setMap).catch(() => {});
          } catch (e) { toast("danger", errorMessage(e)); }
        }}>Guardar</Button></>}>
        <div className="flex flex-col gap-4">
          {edit?.parent?.postable && <Notice tone="info">«{edit.parent.name}» pasará a agrupar sus subcuentas: lo que hoy se registra en ella irá a la subcuenta nueva.</Notice>}
          <Field label="Nombre contable" value={edit?.name ?? ""} onChange={(e) => setEdit((x) => (x ? { ...x, name: e.target.value } : x))} placeholder="Ej. Banco Estado cuenta corriente" autoFocus />
          <Field label="Nombre en la vista Simple" optional value={edit?.simple ?? ""} onChange={(e) => setEdit((x) => (x ? { ...x, simple: e.target.value } : x))} placeholder="Ej. Dinero en BancoEstado" />
        </div>
      </Dialog>
    </div>
  );
}
